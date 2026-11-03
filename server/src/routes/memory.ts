import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MemoryError } from '../memory/store.js'
import { dayRunId, listBriefs } from '../run/store.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/**
 * The memory panel (ARCHITECTURE §5.4): read-only, plus Restore — the one write it does directly,
 * because undoing must not depend on a working LLM. Renders from the folder and the journal alone.
 */
export function registerMemoryRoutes(app: FastifyInstance, ctx: AppContext, svc: Services) {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof MemoryError) return reply.code(400).send({ error: err.message })
    throw err
  }

  app.get('/api/v1/memory', async () => {
    const files = await svc.memory.list()
    const last = listBriefs(ctx, 1)[0]
    const lastRunId = last ? dayRunId(ctx, last.date) : undefined
    const cfg = ctx.config.get().memory
    return {
      files,
      lastRun: lastRunId ? { runId: lastRunId, date: last!.date, touched: svc.memory.touchedBy(lastRunId) } : null,
      totalBytes: files.reduce((n, f) => n + f.size, 0),
      maxTotalBytes: cfg.max_total_mb * 1024 * 1024,
    }
  })

  app.get<{ Querystring: { path: string } }>('/api/v1/memory/file', async (req, reply) => {
    try {
      return await svc.memory.read(req.query.path)
    } catch (err) {
      return fail(reply, err)
    }
  })

  /** Image bytes, for `<img src>`. */
  app.get<{ Querystring: { path: string } }>('/api/v1/memory/raw', async (req, reply) => {
    try {
      const c = await svc.memory.read(req.query.path)
      if (c.kind !== 'image') return reply.code(400).send({ error: 'not an image' })
      return reply.header('content-type', c.mimeType).header('cache-control', 'no-store').send(Buffer.from(c.data, 'base64'))
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get<{ Querystring: { path?: string } }>('/api/v1/memory/history', async (req, reply) => {
    try {
      return { entries: svc.memory.history(req.query.path || undefined, 100) }
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.get<{ Params: { id: string }; Querystring: { side?: 'before' | 'after' } }>('/api/v1/memory/versions/:id', async (req, reply) => {
    try {
      return svc.memory.version(Number(req.params.id), req.query.side)
    } catch (err) {
      return fail(reply, err)
    }
  })

  const Restore = z.object({ journalId: z.number().int(), side: z.enum(['before', 'after']).optional() })
  app.post('/api/v1/memory/restore', async (req, reply) => {
    const body = Restore.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'journalId is required' })
    try {
      return await svc.memory.restore(body.data.journalId, { by: 'ui' }, body.data.side)
    } catch (err) {
      return fail(reply, err)
    }
  })
}
