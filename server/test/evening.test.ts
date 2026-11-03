import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'
import { briefView, dayRunId, getRun, hasPhaseRun, listBriefs } from '../src/run/store.js'
import { makeServices } from '../src/services.js'
import { notifyHeadline } from '../src/notify/render.js'
import { fakeLlm, validAnswer, type Step } from './fake-llm.js'
import { makeContext, tempDir } from './helpers.js'

/** v1.1: the evening preview for tomorrow, its wake-up time, and the day-brief rule. */

let closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})

const EVENING = new Date('2026-11-03T20:00:00Z') // Tue 21:00 Paris
const MORNING = new Date('2026-11-04T04:00:00Z') // Wed 05:00 Paris
const NOTIFY = new Date('2026-11-04T06:00:00Z') // Wed 07:00 Paris

const eveningAnswer = (extra: Record<string, unknown> = {}) =>
  validAnswer({ title: '🌙 Wednesday', headline: '⏰ 06:40 · Review at 10:00', wake_up: { time: '06:40', reason: 'Review at 10:00, deep work first' }, ...extra })

async function setup(steps: Step[], cfg: Record<string, unknown> = {}) {
  const fake = await fakeLlm(steps)
  closers.push(fake.close)
  const ctx = makeContext()
  let clock = EVENING
  ctx.now = () => clock
  const raw = ctx.config.raw()
  await ctx.config.save({ ...raw, evening_at: '21:00', ...cfg, llm: { ...raw.llm, base_url: fake.url, model: 'fake-model', api_key: '' } })
  const svc = makeServices(ctx, { sleep: async () => {} })
  const settle = async () => {
    for (const p of svc.runner.finished.values()) await p
    await svc.notifier.lastSend
  }
  return { ctx, svc, fake, settle, setClock: (d: Date) => (clock = d) }
}

describe('evening preview', () => {
  it('prepares tomorrow with a wake-up time and notifies at once', async () => {
    const { ctx, svc, fake, settle } = await setup([{ content: eveningAnswer() }])
    svc.scheduler.fireEvening()
    await settle()
    const id = dayRunId(ctx, '2026-11-04')!
    const run = getRun(ctx, id)!
    expect(run).toMatchObject({ date: '2026-11-04', phase: 'evening', kind: 'scheduled', status: 'NOTIFIED' })
    const view = briefView(ctx, id)!
    expect(view.phase).toBe('evening')
    expect(view.wakeUp).toEqual({ time: '06:40', timeMin: 400, reason: 'Review at 10:00, deep work first' })
    const user = fake.requests[0]!.messages[1].content as string
    expect(user).toContain('phase: evening')
    expect(user).toContain('date: 2026-11-04 (Wednesday)')
    expect(fake.requests[0]!.messages[0].content).toContain('## Wake-up time')
    expect(listBriefs(ctx)[0]).toMatchObject({ date: '2026-11-04', phase: 'evening', wakeTime: '06:40' })
  })

  it('runs once per evening, and catches up after a restart', async () => {
    const { ctx, svc, fake, settle, setClock } = await setup([{ content: eveningAnswer() }], { morning_run: false })
    setClock(new Date('2026-11-03T21:30:00Z')) // 22:30, missed the 21:00 job
    svc.scheduler.catchUp()
    await settle()
    expect(hasPhaseRun(ctx, '2026-11-04', 'evening')).toBe(true)
    svc.scheduler.fireEvening()
    svc.scheduler.catchUp()
    await settle()
    expect(fake.requests).toHaveLength(1)
  })

  it('keeps the morning run off when morning_run is false, and does not notify twice', async () => {
    const { ctx, svc, fake, settle, setClock } = await setup([{ content: eveningAnswer() }], { morning_run: false })
    svc.scheduler.fireEvening()
    await settle()
    svc.scheduler.rebuild()
    closers.push(async () => svc.scheduler.stop())
    expect(svc.scheduler.info()).toMatchObject({ morningRun: false, nextRun: null, eveningAt: '21:00' })
    expect(svc.scheduler.info().nextNotify).not.toBeNull()
    expect(svc.scheduler.info().nextEvening).not.toBeNull()
    setClock(MORNING)
    svc.scheduler.catchUp()
    setClock(NOTIFY)
    svc.scheduler.fireNotify()
    await settle()
    expect(fake.requests).toHaveLength(1)
    const sends = briefView(ctx, dayRunId(ctx, '2026-11-04')!)!.sends.filter((s) => s.channel === 'in-app')
    expect(sends).toHaveLength(1)
  })
})

describe('the morning after', () => {
  it('sees the evening preview, replaces it, and is notified at notify_at', async () => {
    const { ctx, svc, fake, settle, setClock } = await setup([{ content: eveningAnswer() }, { content: validAnswer() }])
    svc.scheduler.fireEvening()
    await settle()
    const evening = dayRunId(ctx, '2026-11-04')!
    setClock(MORNING)
    svc.scheduler.fireRun()
    await settle()
    const morning = dayRunId(ctx, '2026-11-04')!
    expect(morning).not.toBe(evening)
    expect(getRun(ctx, morning)!.phase).toBe('morning')
    const user = fake.requests[1]!.messages[1].content as string
    expect(user).toContain("# Last evening's preview of this date")
    expect(user).toContain('recommended wake-up: 06:40 (Review at 10:00, deep work first)')
    setClock(NOTIFY)
    svc.scheduler.fireNotify()
    expect(getRun(ctx, morning)!.notifiedAt).not.toBeNull()
  })

  it('a failed morning run does not hide a good evening preview', async () => {
    const { ctx, svc, settle, setClock } = await setup([{ content: eveningAnswer() }, { status: 401 }])
    svc.scheduler.fireEvening()
    await settle()
    const evening = dayRunId(ctx, '2026-11-04')!
    setClock(MORNING)
    svc.scheduler.fireRun()
    await settle()
    expect(dayRunId(ctx, '2026-11-04')).toBe(evening)
    expect(listBriefs(ctx)[0]!.runId).toBe(evening)
  })

  it('shows the latest failure when every run of the date failed', async () => {
    const { ctx, svc, settle, setClock } = await setup([{ status: 401 }])
    svc.scheduler.fireEvening()
    await settle()
    setClock(MORNING)
    svc.scheduler.fireRun()
    await settle()
    const id = dayRunId(ctx, '2026-11-04')!
    expect(getRun(ctx, id)!.phase).toBe('morning')
    expect(briefView(ctx, id)!.shape).toBe('failure')
  })

  it('a bad wake-up is dropped and counted, never the brief', async () => {
    const { ctx, svc, settle } = await setup([{ content: eveningAnswer({ wake_up: { time: '6h40' } }) }])
    svc.scheduler.fireEvening()
    await settle()
    const view = briefView(ctx, dayRunId(ctx, '2026-11-04')!)!
    expect(view.shape).toBe('contract')
    expect(view.wakeUp).toBeUndefined()
    expect(view.itemsDropped).toBe(1)
  })
})

describe('notification headline', () => {
  it('puts the wake-up time in front unless the headline already says it', () => {
    expect(notifyHeadline({ headline: 'Review at 10:00', wakeTime: '06:40' })).toBe('⏰ 06:40 · Review at 10:00')
    expect(notifyHeadline({ headline: '⏰ 06:40 · Review', wakeTime: '06:40' })).toBe('⏰ 06:40 · Review')
    expect(notifyHeadline({ headline: 'Review', wakeTime: null })).toBe('Review')
  })
})

describe('migration 0001', () => {
  it('upgrades a v1.0 database: existing runs become morning runs', () => {
    const dir = tempDir()
    const migrations = path.join(dir, 'drizzle-1.0')
    const real = path.resolve(import.meta.dirname, '../drizzle')
    mkdirSync(path.join(migrations, 'meta'), { recursive: true })
    cpSync(path.join(real, '0000_baseline.sql'), path.join(migrations, '0000_baseline.sql'))
    const journal = JSON.parse(readFileSync(path.join(real, 'meta/_journal.json'), 'utf8'))
    journal.entries = journal.entries.slice(0, 1)
    writeFileSync(path.join(migrations, 'meta/_journal.json'), JSON.stringify(journal))

    const file = path.join(dir, 'aube.db')
    const old = new Database(file)
    migrate(drizzle(old), { migrationsFolder: migrations })
    old.prepare(`insert into runs (date, kind, status, tool_mode) values ('2026-11-01', 'scheduled', 'READY', 'backend')`).run()
    old.close()

    const db = openDb(file)
    expect(db.$client.prepare('select phase from runs').get()).toEqual({ phase: 'morning' })
    db.$client.close()
  })
})
