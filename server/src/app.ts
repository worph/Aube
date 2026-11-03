import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { AppContext } from './context.js'
import { registerConfigRoutes } from './routes/config.js'
import { registerBriefRoutes } from './routes/briefs.js'
import { registerPromptRoutes } from './routes/prompt.js'
import type { Services } from './services.js'
import { registerMcpEndpoint } from './mcp/endpoint.js'
import { registerChatRoutes } from './routes/chat.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerPushRoutes } from './routes/push.js'

/**
 * The HTTP surface. No login: Aube sits behind AppShield (ARCHITECTURE invariant 9) and never
 * binds a host port itself.
 */
export async function buildApp(ctx: AppContext, svc: Services, opts: { serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 })

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
    if (status >= 500) ctx.log(`error: ${err.stack ?? err.message}`)
    reply.code(status).send({ error: err.message })
  })

  /** Liveness only: touches no port, so it stays green with Beacon and the LLM down. */
  app.get('/health', async () => ({ ok: true }))

  registerConfigRoutes(app, ctx)
  registerBriefRoutes(app, ctx, svc)
  registerPromptRoutes(app, ctx)
  registerMcpEndpoint(app, ctx, svc)
  registerChatRoutes(app, ctx, svc)
  registerMemoryRoutes(app, ctx, svc)
  registerPushRoutes(app, svc)

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
