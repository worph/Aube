import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConfigRejected, ConfigStore } from '../src/config/store.js'
import { interpolate, missingVars } from '../src/config/interpolate.js'
import { makeContext } from './helpers.js'

describe('config store', () => {
  it('boots from the template with defaults', () => {
    const ctx = makeContext()
    const cfg = ctx.config.raw()
    expect(cfg.run_at).toBe('05:00')
    expect(cfg.llm.tool_mode).toBe('backend')
    expect(cfg.llm.api_key).toBe('${LLM_API_KEY}')
  })

  it('keeps comments and untouched keys when saving', async () => {
    const ctx = makeContext()
    const next = ctx.config.raw()
    next.notify_at = '06:45'
    next.connections = { beacon: { transport: 'http', url: 'http://beacon:9300/mcp/', via: 'beacon' } }
    await ctx.config.save(next)
    const text = readFileSync(ctx.paths.config, 'utf8')
    expect(text).toContain('notify_at: "06:45"')
    expect(text).toContain('# when the brief is prepared')
    expect(text).toContain('# Aube configuration.')
    expect(text).toContain('url: http://beacon:9300/mcp/')
    // The template's empty {} becomes a block map once filled, not one long flow line.
    expect(text).toMatch(/^connections:\n  beacon:\n/m)
    expect(new ConfigStore(ctx.paths.config).raw().connections.beacon?.via).toBe('beacon')
  })

  it('adds settings from a newer version next to their neighbours, times quoted', async () => {
    const ctx = makeContext()
    // A v1.0 file: no morning_run / evening_at yet.
    const v10 = readFileSync(ctx.paths.config, 'utf8').replace(/^morning_run:.*\n/m, '').replace(/^evening_at:.*\n/m, '')
    writeFileSync(ctx.paths.config, v10)
    const store = new ConfigStore(ctx.paths.config)
    await store.save({ ...store.raw(), evening_at: '21:00' })
    const text = readFileSync(ctx.paths.config, 'utf8')
    expect(text).toMatch(/^notify_at: "07:00".*\nmorning_run: true\nevening_at: "21:00"\n/m)
    expect(new ConfigStore(ctx.paths.config).raw().evening_at).toBe('21:00')
  })

  it('refuses a schedule where nothing ever runs', async () => {
    const ctx = makeContext()
    await expect(ctx.config.save({ ...ctx.config.raw(), morning_run: false, evening_at: '' })).rejects.toBeInstanceOf(ConfigRejected)
    await expect(ctx.config.save({ ...ctx.config.raw(), morning_run: false, evening_at: '21:00' })).resolves.toBeTruthy()
  })

  it('refuses literal secrets and invalid values, leaving the file alone', async () => {
    const ctx = makeContext()
    const before = readFileSync(ctx.paths.config, 'utf8')
    const literal = { ...ctx.config.raw(), llm: { ...ctx.config.raw().llm, api_key: 'sk-123' } }
    await expect(ctx.config.save(literal)).rejects.toBeInstanceOf(ConfigRejected)
    await expect(ctx.config.save({ ...ctx.config.raw(), run_at: '25:00' })).rejects.toThrow(/run_at/)
    const header = { ...ctx.config.raw(), connections: { x: { transport: 'http', url: 'http://x', headers: { Authorization: 'Bearer ${TOKEN}' } } } }
    await expect(ctx.config.save(header)).resolves.toBeTruthy()
    expect(readFileSync(ctx.paths.config, 'utf8')).not.toBe(before)
  })

  it('refuses a file that does not parse instead of rewriting it', async () => {
    const ctx = makeContext()
    writeFileSync(ctx.paths.config, 'run_at: [unclosed\n')
    await expect(ctx.config.save(ctx.config.raw())).rejects.toThrow(/does not parse/)
  })

  it('resolves ${VAR} references at use time only', () => {
    const env = { A: 'one' }
    expect(interpolate({ x: 'Bearer ${A}', y: ['${B}'] }, env)).toEqual({ x: 'Bearer one', y: [''] })
    expect(missingVars({ x: '${A}', y: '${B}' }, env)).toEqual(['B'])
  })

  it('generates the MCP token on first boot', () => {
    delete process.env.AUBE_MCP_TOKEN
    delete process.env.AUBE_ADMIN_MCP_TOKEN
    const ctx = makeContext()
    expect(readFileSync(ctx.paths.secrets, 'utf8')).toMatch(/^AUBE_MCP_TOKEN=[0-9a-f]{64}$/m)
    expect(readFileSync(ctx.paths.secrets, 'utf8')).toMatch(/^AUBE_ADMIN_MCP_TOKEN=[0-9a-f]{64}$/m)
  })
})
