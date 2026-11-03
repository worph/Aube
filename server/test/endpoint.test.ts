import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildApp } from '../src/app.js'
import { makeServices } from '../src/services.js'
import { defineTool, registerTools, text } from '../src/tools/index.js'
import { makeContext } from './helpers.js'

registerTools([
  defineTool({ name: 'test_chat_only', title: 't', description: 't', input: { x: z.string().optional() }, scope: ['chat'], writes: true, handler: async () => text('ran') }),
])

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
let close: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(close.map((c) => c()))
  close = []
})

async function serve(enabled = true, admin = false) {
  const ctx = makeContext()
  process.env.TEST_MCP_TOKEN = 'tok-123'
  process.env.TEST_ADMIN_TOKEN = 'adm-456'
  await ctx.config.save({ ...ctx.config.raw(), mcp_endpoint: { enabled, token: '${TEST_MCP_TOKEN}' }, admin_endpoint: { enabled: admin, token: '${TEST_ADMIN_TOKEN}' } })
  const svc = makeServices(ctx)
  const app = await buildApp(ctx, svc)
  await app.listen({ port: 0, host: '127.0.0.1' })
  close.push(() => app.close())
  const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/mcp`
  return { ctx, svc, url, adminUrl: `${url}/admin` }
}

const running = (svc: { runner: unknown }) => (svc.runner as { running: Set<number> }).running
const textOf = (r: { content: unknown }) => (r.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? '').join('\n')

async function connect(url: string, token: string) {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  close.push(() => client.close())
  return client
}

describe('Aube MCP endpoint', () => {
  it('is a 404 when disabled and a 401 with a wrong token', async () => {
    const off = await serve(false)
    expect((await fetch(off.url, { method: 'POST', body: '{}' })).status).toBe(404)
    const on = await serve(true)
    expect((await fetch(on.url, { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' })).status).toBe(401)
  })

  it('serves the run toolset only', async () => {
    const { url } = await serve()
    const client = await connect(url, 'tok-123')
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['brief_get', 'brief_list', 'memory_delete', 'memory_history', 'memory_list', 'memory_read', 'memory_restore', 'memory_write'])
    const r = await client.callTool({ name: 'test_chat_only', arguments: {} })
    expect(r.isError).toBe(true)
  })

  it('writes and reads memory, images as image blocks, attributed to the run in progress', async () => {
    const { url, svc } = await serve()
    const client = await connect(url, 'tok-123')
    // Pretend a run is in progress so the call is attributed to it.
    ;(svc.runner as unknown as { running: Set<number> }).running.add(42)
    const w = await client.callTool({ name: 'memory_write', arguments: { path: 'images/dot.png', content: PNG } })
    expect(w.isError).toBeFalsy()
    ;(svc.runner as unknown as { running: Set<number> }).running.delete(42)
    const r = await client.callTool({ name: 'memory_read', arguments: { path: 'images/dot.png' } })
    expect((r.content as Array<{ type: string }>)[0]!.type).toBe('image')
    expect(svc.memory.history('images/dot.png')[0]).toMatchObject({ by: 'run:42', runId: 42 })
    const bad = await client.callTool({ name: 'memory_write', arguments: { path: '../escape.md', content: 'x' } })
    expect(bad.isError).toBe(true)
  })
})

describe('Aube admin MCP endpoint', () => {
  it('is a 404 when disabled, a 401 with the run token, and keeps /mcp to the run toolset', async () => {
    const off = await serve(true, false)
    expect((await fetch(off.adminUrl, { method: 'POST', body: '{}' })).status).toBe(404)
    const on = await serve(true, true)
    expect((await fetch(on.adminUrl, { method: 'POST', headers: { authorization: 'Bearer tok-123' }, body: '{}' })).status).toBe(401)
    const run = await connect(on.url, 'tok-123')
    expect((await run.listTools()).tools.map((t) => t.name)).not.toContain('prompt_save')
  })

  it('serves the chat toolset plus the admin-only tools', async () => {
    const { adminUrl } = await serve(true, true)
    const client = await connect(adminUrl, 'adm-456')
    const tools = (await client.listTools()).tools
    const names = tools.map((t) => t.name)
    for (const n of ['prompt_get', 'prompt_save', 'settings_get', 'settings_save', 'llm_test', 'run_preview', 'memory_write', 'brief_list', 'secrets_list', 'secret_set', 'run_list', 'run_get']) expect(names).toContain(n)
    expect(tools.find((t) => t.name === 'prompt_save')!.annotations?.readOnlyHint).toBe(false)
  })

  it('saves the master prompt and settings, attributed to mcp', async () => {
    const { adminUrl, ctx } = await serve(true, true)
    const client = await connect(adminUrl, 'adm-456')
    const w = await client.callTool({ name: 'prompt_save', arguments: { body: 'Organise my day.\nFish on Friday.', note: 'from claude' } })
    expect(w.isError).toBeFalsy()
    const r = await client.callTool({ name: 'prompt_get', arguments: {} })
    expect(textOf(r)).toContain('Fish on Friday.')
    const v = await client.callTool({ name: 'prompt_versions', arguments: {} })
    expect(textOf(v)).toContain('"savedBy": "mcp"')
    const s = await client.callTool({ name: 'settings_save', arguments: { patch: { notify_at: '07:30' } } })
    expect(s.isError).toBeFalsy()
    expect(ctx.config.raw().notify_at).toBe('07:30')
    const bad = await client.callTool({ name: 'settings_save', arguments: { patch: { llm: { api_key: 'sk-literal' } } } })
    expect(bad.isError).toBe(true)
  })

  it('refuses writes while a run is in progress, but still reads', async () => {
    const { adminUrl, svc } = await serve(true, true)
    const client = await connect(adminUrl, 'adm-456')
    running(svc).add(7)
    const w = await client.callTool({ name: 'prompt_save', arguments: { body: 'hijacked' } })
    expect(w.isError).toBe(true)
    expect(textOf(w)).toContain('run #7 is in progress')
    expect((await client.callTool({ name: 'secret_set', arguments: { name: 'LLM_API_KEY', value: 'x' } })).isError).toBe(true)
    expect((await client.callTool({ name: 'prompt_get', arguments: {} })).isError).toBeFalsy()
    running(svc).delete(7)
    expect(textOf(await client.callTool({ name: 'prompt_get', arguments: {} }))).not.toContain('hijacked')
  })

  it('sets secrets write-only and refuses the endpoint tokens', async () => {
    const { adminUrl } = await serve(true, true)
    const client = await connect(adminUrl, 'adm-456')
    const ok = await client.callTool({ name: 'secret_set', arguments: { name: 'ADMIN_TEST_SECRET', value: 'v1' } })
    expect(ok.isError).toBeFalsy()
    expect(textOf(ok)).not.toContain('v1')
    expect((await client.callTool({ name: 'secret_set', arguments: { name: 'AUBE_ADMIN_MCP_TOKEN', value: 'x' } })).isError).toBe(true)
    expect(textOf(await client.callTool({ name: 'secrets_list', arguments: {} }))).toContain('LLM_API_KEY')
  })
})
