import { afterEach, describe, expect, it } from 'vitest'
import { briefView, dayRunId, getRun } from '../src/run/store.js'
import { makeServices } from '../src/services.js'
import { fakeLlm, validAnswer, type Step } from './fake-llm.js'
import { makeContext } from './helpers.js'

let closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})

/** A context pointed at a scripted backend, with a clock that `sleep` advances. */
async function setup(steps: Step[], llm: Record<string, unknown> = {}) {
  const fake = await fakeLlm(steps)
  closers.push(fake.close)
  const ctx = makeContext()
  let clock = new Date('2026-11-04T04:00:00Z') // 05:00 Paris
  ctx.now = () => clock
  await ctx.config.save({ ...ctx.config.raw(), llm: { ...ctx.config.raw().llm, base_url: fake.url, model: 'fake-model', api_key: '', ...llm } })
  const slept: number[] = []
  const svc = makeServices(ctx, {
    sleep: async (ms) => {
      slept.push(ms)
      clock = new Date(clock.getTime() + ms)
    },
  })
  const run = async (kind: 'scheduled' | 'manual' | 'preview' = 'scheduled') => {
    const id = svc.runner.start(kind, '2026-11-04')
    await svc.runner.finished.get(id)
    return { id, run: getRun(ctx, id)!, view: briefView(ctx, id)! }
  }
  return { ctx, svc, fake, run, slept, setClock: (d: Date) => (clock = d) }
}

describe('nightly run', () => {
  it('stores a contract brief with its day band', async () => {
    const { run, fake } = await setup([{ content: validAnswer() }])
    const { run: r, view } = await run()
    expect(r.status).toBe('READY')
    expect(view.shape).toBe('contract')
    expect(view.events[0]).toMatchObject({ title: 'Review', startMin: 600, endMin: 660 })
    expect(view.blocks[0]).toMatchObject({ kind: 'focus', overlapsEvent: false })
    expect(r.inputTokens).toBe(100)
    const user = fake.requests[0]!.messages[1].content as string
    expect(user).toContain('date: 2026-11-04 (Wednesday)')
    expect(user).toContain('<master_prompt>')
    expect(fake.requests[0]!.messages[0].content).toContain('"blocks"')
  })

  it('accepts JSON wrapped in prose or a fence', async () => {
    const { run } = await setup([{ content: `Here you go:\n\`\`\`json\n${validAnswer()}\n\`\`\`` }])
    expect((await run()).view.shape).toBe('contract')
  })

  it('retries once with the validation error, then succeeds', async () => {
    const { run, fake } = await setup([{ content: '{"title":"x"}' }, { content: validAnswer() }])
    const { run: r, view } = await run()
    expect(view.shape).toBe('contract')
    expect(r.attempts).toBe(2)
    expect(fake.requests[1]!.messages.at(-1).content).toMatch(/failed validation[\s\S]*headline/)
  })

  it('keeps the raw text after two unusable answers', async () => {
    const { run } = await setup([{ content: 'Bonjour! Today you have a review at 10.' }])
    const { run: r, view } = await run()
    expect(r.status).toBe('READY')
    expect(view.shape).toBe('raw')
    expect(view.headline).toBe('Bonjour! Today you have a review at 10.')
    expect(view.markdown).toContain('not in the expected shape')
  })

  it('fails at once on 401 with a failure brief', async () => {
    const { run, fake } = await setup([{ status: 401, content: 'bad key' }])
    const { run: r, view } = await run()
    expect(r.status).toBe('FAILED')
    expect(r.failureClass).toBe('auth')
    expect(view.shape).toBe('failure')
    expect(fake.requests).toHaveLength(1)
  })

  it('classifies a 200 "Not logged in" answer as auth', async () => {
    const { run } = await setup([{ content: 'Not logged in · Please run /login' }])
    expect((await run()).run.failureClass).toBe('auth')
  })

  it('retries an error once', async () => {
    const { run, fake } = await setup([{ status: 500 }, { content: validAnswer() }])
    expect((await run()).view.shape).toBe('contract')
    expect(fake.requests).toHaveLength(2)
  })

  it('backs off while busy and gives up at the notify time', async () => {
    const { run, slept } = await setup([{ status: 429 }])
    const { run: r } = await run()
    expect(r.failureClass).toBe('busy')
    expect(slept.length).toBeGreaterThan(3)
    // 05:00 → 07:00: the waits never cross the deadline.
    expect(slept.reduce((a, b) => a + b, 0)).toBeLessThan(2 * 3600_000)
  })

  it('does not wait for a busy backend on a preview', async () => {
    const { run, slept } = await setup([{ status: 503 }])
    expect((await run('preview')).run.failureClass).toBe('busy')
    expect(slept).toHaveLength(0)
  })

  it('times out, retries once, then fails', async () => {
    const { run, fake } = await setup([{ delayMs: 1500, content: validAnswer() }], { timeout_s: 1 })
    const { run: r } = await run()
    expect(r.failureClass).toBe('error')
    expect(r.failureText).toMatch(/no answer within/)
    expect(fake.requests).toHaveLength(2)
  })

  it('fails as unreachable with no endpoint', async () => {
    const { run, ctx } = await setup([{ content: validAnswer() }])
    await ctx.config.save({ ...ctx.config.raw(), llm: { ...ctx.config.raw().llm, base_url: '' } })
    expect((await run()).run.failureClass).toBe('unreachable')
  })

  it('allows one real run at a time, previews alongside', async () => {
    const { svc } = await setup([{ delayMs: 300, content: validAnswer() }])
    const a = svc.runner.start('manual', '2026-11-04')
    expect(() => svc.runner.start('manual', '2026-11-04')).toThrow(/already in progress/)
    const p = svc.runner.start('preview', '2026-11-04')
    await Promise.all([svc.runner.finished.get(a), svc.runner.finished.get(p)])
  })

  it('a preview never becomes the day brief', async () => {
    const { run, ctx } = await setup([{ content: validAnswer() }])
    await run('preview')
    expect(dayRunId(ctx, '2026-11-04')).toBeUndefined()
    const { id } = await run('manual')
    expect(dayRunId(ctx, '2026-11-04')).toBe(id)
  })
})

describe('scheduler', () => {
  it('catches up a missed run and notifies a late brief once ready', async () => {
    const { svc, ctx, setClock } = await setup([{ content: validAnswer() }])
    setClock(new Date('2026-11-04T08:00:00Z')) // 09:00 Paris: past run_at and notify_at
    svc.scheduler.catchUp()
    const id = svc.runner.activeRunId()!
    expect(id).toBeTypeOf('number')
    await svc.runner.finished.get(id)
    expect(getRun(ctx, id)!.status).toBe('NOTIFIED')
    // A second catch-up does nothing: the day has its run.
    svc.scheduler.catchUp()
    expect(svc.runner.activeRunId()).toBeNull()
  })

  it('holds a ready brief until notify_at', async () => {
    const { svc, ctx, run, setClock } = await setup([{ content: validAnswer() }])
    const { id } = await run('scheduled')
    expect(getRun(ctx, id)!.status).toBe('READY')
    setClock(new Date('2026-11-04T06:00:00Z')) // 07:00 Paris
    svc.scheduler.fireNotify()
    expect(getRun(ctx, id)!.status).toBe('NOTIFIED')
    expect(svc.notifier.notifyRun(id)).toBe(false)
  })

  it('notifies a failure brief too', async () => {
    const { svc, ctx, run, setClock } = await setup([{ status: 401 }])
    const { id } = await run('scheduled')
    setClock(new Date('2026-11-04T06:00:00Z'))
    svc.scheduler.fireNotify()
    expect(getRun(ctx, id)!.notifiedAt).not.toBeNull()
  })
})

describe('scheduler without an LLM', () => {
  it('skips the scheduled run instead of failing it', async () => {
    const { svc, ctx, setClock } = await setup([{ content: validAnswer() }])
    await ctx.config.save({ ...ctx.config.raw(), llm: { ...ctx.config.raw().llm, base_url: '' } })
    setClock(new Date('2026-11-04T08:00:00Z'))
    svc.scheduler.catchUp()
    expect(svc.runner.activeRunId()).toBeNull()
    expect(svc.scheduler.hasRealRun('2026-11-04')).toBe(false)
  })
})
