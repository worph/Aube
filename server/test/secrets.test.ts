import { readFileSync, statSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { makeServices } from '../src/services.js'
import { interpolate } from '../src/config/interpolate.js'
import { makeContext } from './helpers.js'

const NAMES = ['TEST_SECRET_KEY', 'TEST_ENV_KEY']
afterEach(() => {
  for (const n of NAMES) delete process.env[n]
})

async function setup() {
  const ctx = makeContext()
  await ctx.config.save({ ...ctx.config.raw(), llm: { ...ctx.config.raw().llm, api_key: '${TEST_SECRET_KEY}' } })
  const app = await buildApp(ctx, makeServices(ctx))
  return { ctx, app }
}

describe('secrets set from Settings', () => {
  it('stores a value write-only and resolves it at use time', async () => {
    const { ctx, app } = await setup()
    let r = await app.inject({ method: 'GET', url: '/api/v1/secrets' })
    expect(r.json().secrets).toContainEqual({ name: 'TEST_SECRET_KEY', source: null })

    r = await app.inject({ method: 'PUT', url: '/api/v1/secrets/TEST_SECRET_KEY', payload: { value: 'sk-abc' } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ name: 'TEST_SECRET_KEY', source: 'file' })

    expect(readFileSync(ctx.paths.secrets, 'utf8')).toContain('TEST_SECRET_KEY=sk-abc')
    expect(statSync(ctx.paths.secrets).mode & 0o777).toBe(0o600)
    expect(interpolate(ctx.config.get().llm).api_key).toBe('sk-abc')
    // Nothing the browser can read carries the value.
    for (const url of ['/api/v1/secrets', '/api/v1/config']) {
      expect((await app.inject({ method: 'GET', url })).body).not.toContain('sk-abc')
    }
    expect(readFileSync(ctx.paths.config, 'utf8')).not.toContain('sk-abc')

    // Replace, then clear.
    await app.inject({ method: 'PUT', url: '/api/v1/secrets/TEST_SECRET_KEY', payload: { value: 'sk-new' } })
    expect(readFileSync(ctx.paths.secrets, 'utf8').match(/TEST_SECRET_KEY=/g)).toHaveLength(1)
    r = await app.inject({ method: 'PUT', url: '/api/v1/secrets/TEST_SECRET_KEY', payload: { value: '' } })
    expect(r.json().source).toBeNull()
    expect(readFileSync(ctx.paths.secrets, 'utf8')).not.toContain('TEST_SECRET_KEY')
    await app.close()
  })

  it('leaves the container environment and reserved names alone', async () => {
    const { app } = await setup()
    process.env.TEST_ENV_KEY = 'from-compose'
    let r = await app.inject({ method: 'PUT', url: '/api/v1/secrets/TEST_ENV_KEY', payload: { value: 'x' } })
    expect(r.statusCode).toBe(409)
    expect(process.env.TEST_ENV_KEY).toBe('from-compose')

    r = await app.inject({ method: 'PUT', url: '/api/v1/secrets/AUBE_MCP_TOKEN', payload: { value: 'x' } })
    expect(r.statusCode).toBe(409)
    r = await app.inject({ method: 'PUT', url: '/api/v1/secrets/TEST_SECRET_KEY', payload: { value: 'a\nB=c' } })
    expect(r.statusCode).toBe(409)
    await app.close()
  })
})
