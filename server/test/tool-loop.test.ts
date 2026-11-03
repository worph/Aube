import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { functionName } from '../src/llm/tool-loop.js'
import { briefView, getRun, listArtifacts } from '../src/run/store.js'
import { makeServices } from '../src/services.js'
import { fakeLlm, validAnswer } from './fake-llm.js'
import { makeContext } from './helpers.js'

let close: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(close.map((c) => c()))
  close = []
})

const call = (id: string, name: string, args: object) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

async function setup(steps: Parameters<typeof fakeLlm>[0], maxRounds = 30) {
  const fake = await fakeLlm(steps)
  close.push(fake.close)
  const ctx = makeContext()
  process.env.LOOP_TOKEN = 'loop'
  const svc = makeServices(ctx)
  const app = await buildApp(ctx, svc)
  await app.listen({ port: 0, host: '127.0.0.1' })
  close.push(() => app.close())
  const mcp = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/mcp`
  await ctx.config.save({
    ...ctx.config.raw(),
    llm: { ...ctx.config.raw().llm, base_url: fake.url, model: 'plain', api_key: '', tool_mode: 'aube', tool_connections: ['self'], max_tool_rounds: maxRounds },
    mcp_endpoint: { enabled: true, token: '${LOOP_TOKEN}' },
    connections: { self: { transport: 'http', url: mcp, via: 'direct', headers: { Authorization: 'Bearer ${LOOP_TOKEN}' } } },
  })
  const run = async () => {
    const id = svc.runner.start('manual', '2026-11-04')
    await svc.runner.finished.get(id)
    return id
  }
  return { ctx, svc, fake, run }
}

describe('tool mode aube', () => {
  it('runs Aube tools and connection tools, then stores the answer with a trace', async () => {
    const { ctx, svc, fake, run } = await setup([
      { toolCalls: [call('a', 'memory_write', { path: 'notes.md', content: 'learned something' }), call('b', 'self__brief_list', {})] },
      { content: validAnswer() },
    ])
    const id = await run()
    expect(getRun(ctx, id)!.status).toBe('READY')
    expect(briefView(ctx, id)!.shape).toBe('contract')
    const offered = (fake.requests[0]!.tools ?? []).map((t: any) => t.function.name)
    expect(offered).toEqual(expect.arrayContaining(['memory_write', 'brief_get', 'self__memory_list', 'self__brief_list']))
    expect(offered).not.toContain('settings_save')
    // The tool results went back to the model.
    const toolMsgs = fake.requests[1]!.messages.filter((m: any) => m.role === 'tool')
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(['a', 'b'])
    expect(await svc.memory.read('notes.md')).toMatchObject({ text: 'learned something' })
    expect(svc.memory.history('notes.md')[0]).toMatchObject({ by: `run:${id}`, runId: id })
    const trace = JSON.parse(listArtifacts(ctx, id).find((a) => a.kind === 'tool_trace')!.body)
    expect(trace.calls.map((c: any) => [c.name, c.ok])).toEqual([
      ['memory_write', true],
      ['self__brief_list', true],
    ])
  })

  it('asks for the answer once the round budget is spent', async () => {
    const { ctx, fake, run } = await setup(
      [
        (req) => (req.tools ? { toolCalls: [call(`c${Math.random()}`, 'memory_list', {})] } : { content: validAnswer() }),
      ],
      3,
    )
    const id = await run()
    expect(briefView(ctx, id)!.shape).toBe('contract')
    expect(fake.requests).toHaveLength(4)
    expect(fake.requests[3]!.tools).toBeUndefined()
  })

  it('makes valid, unique function names', () => {
    const taken = new Set<string>()
    expect(functionName('beacon__beacon-yunderalabs.claude-code__query_claude', taken)).toBe('beacon__beacon-yunderalabs_claude-code__query_claude')
    const long = 'x'.repeat(80)
    const a = functionName(long, taken)
    const b = functionName(long, taken)
    expect(a).toHaveLength(64)
    expect(b).not.toBe(a)
    expect(b.length).toBeLessThanOrEqual(64)
  })
})
