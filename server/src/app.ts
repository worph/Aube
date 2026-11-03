import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { AppContext } from './context.js'
import { registerConfigRoutes } from './routes/config.js'

/**
 * The HTTP surface. No login: Aube sits behind AppShield (ARCHITECTURE invariant 9) and never
 * binds a host port itself.
 */
export async function buildApp(ctx: AppContext, opts: { serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 })

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) ctx.log(`error: ${err.stack ?? err.message}`)
    reply.code(status).send({ error: err.message })
  })

  /** Liveness only: touches no port, so it stays green with Beacon and the LLM down. */
  app.get('/health', async () => ({ ok: true }))

  registerConfigRoutes(app, ctx)

  if (opts.serveWeb) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
    if (existsSync(root)) {
      await app.register(fastifyStatic, { root, wildcard: false })
      // SPA fallback: any non-API GET serves index.html.
      app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && !req.url.startsWith('/api/') && req.url !== '/mcp') return reply.sendFile('index.html')
        reply.code(404).send({ error: 'not found' })
      })
    }
  }
  return app
}
