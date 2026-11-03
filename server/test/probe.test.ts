import { describe, expect, it } from 'vitest'
import { probe } from '../src/llm/client.js'
import { listTools } from '../src/mcp/client.js'

describe('probes against an unreachable endpoint', () => {
  it('LLM probe reports unreachable with a reason', async () => {
    const r = await probe({ baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'x', timeoutS: 5 })
    expect(r.ok).toBe(false)
    expect(r.cls).toBe('unreachable')
    expect(r.error).toMatch(/reach/)
  })

  it('MCP probe throws a classified error', async () => {
    await expect(listTools({ transport: 'http', url: 'http://127.0.0.1:1/mcp', via: 'direct' })).rejects.toMatchObject({ name: 'McpError' })
  })
})
