import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AddonSchema, ConnectionSchema, type AubeConfig } from '@aube/shared'
import { testAddon } from '../notify/addons.js'
import { ConfigRejected } from '../config/store.js'
import { interpolate, missingVars, referencedVars } from '../config/interpolate.js'
import { SecretRefused, secretSource, setSecret } from '../config/secrets.js'
import { discoverCatalogue, listTools, looksLikeBeacon } from '../mcp/client.js'
import { probe } from '../llm/client.js'
import type { AppContext } from '../context.js'

/** Settings (IMPLEMENTATION §11): read, validate + save, and Test without saving. */
export function registerConfigRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/config', async () => {
    const raw = ctx.config.raw()
    return { config: raw, missingVars: missingVars(raw) }
  })

  // The ${VAR}s config.yaml references and where each value comes from. Never the values.
  app.get('/api/v1/secrets', async () => ({
    secrets: referencedVars(ctx.config.raw()).map((name) => ({ name, source: secretSource(name) })),
  }))

  // Write-only: set (or clear, with '') one variable in data/secrets.env.
  app.put<{ Params: { name: string } }>('/api/v1/secrets/:name', async (req, reply) => {
    const body = z.object({ value: z.string().max(4096) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'expected {"value": "…"}' })
    try {
      setSecret(ctx.paths.secrets, req.params.name, body.data.value.trim())
      ctx.log(`secret ${req.params.name} ${body.data.value.trim() ? 'set' : 'cleared'} from Settings`)
      return { name: req.params.name, source: secretSource(req.params.name) }
    } catch (err) {
      if (err instanceof SecretRefused) return reply.code(409).send({ error: err.message })
      throw err
    }
  })

  app.put('/api/v1/config', async (req, reply) => {
    try {
      const saved = await ctx.config.save(req.body)
      return { config: saved, missingVars: missingVars(saved) }
    } catch (err) {
      if (err instanceof ConfigRejected) return reply.code(422).send({ error: err.message, issues: err.issues })
      throw err
    }
  })

  const TestBody = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('llm'), llm: z.record(z.unknown()).optional() }),
    z.object({ kind: z.literal('connection'), connection: ConnectionSchema }),
    z.object({ kind: z.literal('beacon'), connection: ConnectionSchema }),
    z.object({ kind: z.literal('addon'), addon: AddonSchema }),
  ])

  app.post('/api/v1/config/test', async (req, reply) => {
    const parsed = TestBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    const body = parsed.data
    const started = Date.now()
    if (body.kind === 'llm') {
      const llm = interpolate({ ...ctx.config.raw().llm, ...(body.llm ?? {}) } as AubeConfig['llm'])
      return probe({ baseUrl: llm.base_url, apiKey: llm.api_key, model: llm.model, timeoutS: llm.timeout_s, extraBody: llm.extra_body })
    }
    if (body.kind === 'addon') return testAddon(ctx, body.addon)
    const conn = interpolate(body.connection)
    try {
      if (body.kind === 'connection') {
        const tools = await listTools(conn)
        return { ok: true, ms: Date.now() - started, beacon: looksLikeBeacon(tools), tools: tools.map((t) => t.name) }
      }
      const cat = await discoverCatalogue(conn)
      return { ok: true, ms: Date.now() - started, catalogue: cat }
    } catch (err) {
      return { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
