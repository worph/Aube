import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runConfirmed, runTurn } from '../src/chat/loop.js'
import { listMessages, settleConfirmation, startThread } from '../src/chat/thread.js'
import { deepMerge } from '../src/tools/chat.js'
import { makeServices } from '../src/services.js'
import { fakeLlm, type Step } from './fake-llm.js'
import { makeContext } from './helpers.js'

let closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})

const say = (s: string, call: { tool: string; args?: object } | null = null) => ({ content: JSON.stringify({ say: s, call }) })

async function setup(steps: Step[]) {
  const fake = await fakeLlm(steps)
  closers.push(fake.close)
  const ctx = makeContext()
  await ctx.config.save({ ...ctx.config.raw(), llm: { ...ctx.config.raw().llm, base_url: fake.url, model: 'm', api_key: '' } })
  const svc = makeServices(ctx)
  const threadId = startThread(ctx)
  const turn = (msg: string) => runTurn(ctx, svc, threadId, msg)
  const rows = () => listMessages(ctx, threadId)
  return { ctx, svc, fake, threadId, turn, rows }
}

describe('admin chat', () => {
  it('runs a tool, writes its row, then answers', async () => {
    const { turn, rows, svc, fake } = await setup([say('', { tool: 'memory_write', args: { path: 'food.md', content: 'Fish on Fridays' } }), say('Noted in food.md.')])
    await turn('remember I eat fish on Fridays')
    expect(rows().map((r) => [r.role, r.tool, r.ok])).toEqual([
      ['user', null, null],
      ['tool', 'memory_write', true],
      ['assistant', null, null],
    ])
    expect(await svc.memory.read('food.md')).toMatchObject({ text: 'Fish on Fridays' })
    expect(svc.memory.history('food.md')[0]!.by).toMatch(/^chat:/)
    // The second round saw the first tool row in its history.
    expect(fake.requests[1]!.messages[0].content).toContain('tool memory_write (result)')
    expect(fake.requests[0]!.messages[0].content).toContain('**prompt_save** (writes, needs confirmation)')
  })

  it('offers a confirm-gated tool instead of running it, then runs it on confirmation', async () => {
    const { turn, rows, svc, ctx } = await setup([say('', { tool: 'memory_write', args: { path: 'old.md', content: 'x' } }), say('I propose deleting it.', { tool: 'memory_delete', args: { path: 'old.md' } })])
    await turn('forget old.md')
    const offer = rows().at(-1)!
    expect(offer.confirmWith).toMatch(/Delete old.md/)
    expect(existsSync(path.join(ctx.paths.memory, 'old.md'))).toBe(true)
    const step = await runConfirmed(offer, { ctx, svc, by: 'chat:1', runId: null })
    settleConfirmation(ctx, offer.id, step.text, step.ok)
    expect(step.ok).toBe(true)
    expect(existsSync(path.join(ctx.paths.memory, 'old.md'))).toBe(false)
  })

  it('refuses unknown tools, bad arguments and run-only surfaces, feeding the refusal back', async () => {
    const { turn, rows } = await setup([say('', { tool: 'rm_rf', args: {} }), say('', { tool: 'memory_read', args: { nope: 1 } }), say('Sorry.')])
    await turn('hi')
    const tools = rows().filter((r) => r.role === 'tool')
    expect(tools.map((t) => t.ok)).toEqual([false, false])
    expect(tools[0]!.result).toMatch(/no tool called "rm_rf"/)
  })

  it('validates a settings change before offering it', async () => {
    const { turn, rows } = await setup([say('', { tool: 'settings_save', args: { patch: { llm: { api_key: 'sk-literal' } } } }), say('That needs a ${VAR}.')])
    await turn('set my key to sk-literal')
    const t = rows().find((r) => r.role === 'tool')!
    expect(t.ok).toBe(false)
    expect(t.confirmWith).toBeNull()
    expect(t.result).toMatch(/secrets must be/)
  })

  it('stops after the call bound', async () => {
    const { turn, rows } = await setup([say('', { tool: 'memory_list' })])
    await turn('loop forever')
    expect(rows().filter((r) => r.role === 'tool')).toHaveLength(8)
    expect(rows().at(-1)!.body).toMatch(/I did the steps above.*8 tool calls/)
  })

  it('reports the work done when the backend dies mid-turn', async () => {
    const { turn, rows } = await setup([say('', { tool: 'memory_write', args: { path: 'a.md', content: 'a' } }), { status: 500 }])
    await turn('write a')
    expect(rows().at(-1)!.body).toMatch(/^I did the steps above, but could not finish the rest/)
  })

  it('retries an unusable answer once', async () => {
    const { turn, rows } = await setup([{ content: 'sure thing!' }, say('Hello.')])
    await turn('hi')
    expect(rows().at(-1)!.body).toBe('Hello.')
  })

  it('merges settings patches, null removing a key', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, d: 3 }, { a: { c: null, e: 4 } })).toEqual({ a: { b: 1, e: 4 }, d: 3 })
  })
})
