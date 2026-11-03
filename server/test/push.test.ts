import { afterEach, describe, expect, it, vi } from 'vitest'
import webpush from 'web-push'
import { addArtifact, createRun, pruneArtifacts, saveBrief, updateRun } from '../src/run/store.js'
import { makeServices } from '../src/services.js'
import { makeContext } from './helpers.js'

afterEach(() => vi.restoreAllMocks())

const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } })

function readyRun(ctx: ReturnType<typeof makeContext>) {
  const run = createRun(ctx, { date: '2026-11-04', kind: 'scheduled', toolMode: 'backend', model: 'm' })
  saveBrief(ctx, run.id, '2026-11-04', {
    shape: 'contract',
    asOf: ctx.now().toISOString(),
    answer: { title: '☀️ Wed', headline: '3 meetings', markdown: 'x', sources: [], events: [], blocks: [], dropped: 0 },
  })
  updateRun(ctx, run.id, { status: 'READY' })
  return run.id
}

describe('web push', () => {
  it('generates VAPID keys once and keeps them', () => {
    const ctx = makeContext()
    const a = makeServices(ctx).push.publicKey()
    expect(makeServices(ctx).push.publicKey()).toBe(a)
  })

  it('sends the brief headline with a deep link, and prunes gone subscriptions', async () => {
    const ctx = makeContext()
    const svc = makeServices(ctx)
    svc.push.subscribe(sub(1))
    svc.push.subscribe(sub(2))
    const calls: Array<{ endpoint: string; payload: any }> = []
    vi.spyOn(webpush, 'sendNotification').mockImplementation(async (s: any, payload: any) => {
      calls.push({ endpoint: s.endpoint, payload: JSON.parse(payload) })
      if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 })
      return { statusCode: 201, body: '', headers: {} }
    })
    const id = readyRun(ctx)
    expect(svc.notifier.notifyRun(id)).toBe(true)
    await svc.notifier.lastSend
    expect(calls).toHaveLength(2)
    expect(calls[0]!.payload).toEqual({ title: '☀️ Wed', body: '3 meetings', url: '/briefs/2026-11-04' })
    expect(svc.push.count()).toBe(1)
  })

  it('records a push failure on the run without failing the brief', async () => {
    const ctx = makeContext()
    const svc = makeServices(ctx)
    svc.push.subscribe(sub(1))
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }))
    const id = readyRun(ctx)
    svc.notifier.notifyRun(id)
    await svc.notifier.lastSend
    const sends = ctx.db.select().from((await import('../src/db/schema.js')).notifySends).all()
    expect(sends.map((s) => [s.channel, s.status])).toEqual([
      ['in-app', 'ok'],
      ['push', 'failed'],
    ])
    expect(svc.push.count()).toBe(1)
  })

  it('skips the push channel when no device is subscribed', async () => {
    const ctx = makeContext()
    const svc = makeServices(ctx)
    const id = readyRun(ctx)
    svc.notifier.notifyRun(id)
    await svc.notifier.lastSend
    const sends = ctx.db.select().from((await import('../src/db/schema.js')).notifySends).all()
    expect(sends.map((s) => s.channel)).toEqual(['in-app'])
  })
})

describe('retention', () => {
  it('prunes old artifacts and keeps briefs', () => {
    const ctx = makeContext()
    const id = readyRun(ctx)
    addArtifact(ctx, id, 'raw_answer', 'old')
    let clock = new Date(Date.now() + 31 * 86_400_000)
    ctx.now = () => clock
    addArtifact(ctx, id, 'raw_answer', 'new')
    expect(pruneArtifacts(ctx, 30)).toBe(1)
    clock = new Date(clock)
  })
})
