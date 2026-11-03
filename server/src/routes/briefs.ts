import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { briefView, dayRunId, getRun, listArtifacts, listBriefs, listRuns, toSummary } from '../run/store.js'
import { RunBusy } from '../run/runner.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Briefs page: one brief per day, the run log, Run now / Preview, the schedule. */
export function registerBriefRoutes(app: FastifyInstance, ctx: AppContext, svc: Services) {
  app.get('/api/v1/briefs', async () => ({ briefs: listBriefs(ctx), schedule: svc.scheduler.info(), today: svc.scheduler.today() }))

  app.get<{ Params: { date: string } }>('/api/v1/briefs/:date', async (req, reply) => {
    if (!DATE.test(req.params.date)) return reply.code(400).send({ error: 'expected YYYY-MM-DD' })
    const id = dayRunId(ctx, req.params.date)
    const view = id !== undefined ? briefView(ctx, id) : undefined
    if (!view) return reply.code(404).send({ error: `no brief for ${req.params.date}` })
    return view
  })

  app.get<{ Querystring: { date?: string } }>('/api/v1/runs', async (req) => ({ runs: listRuns(ctx, req.query.date) }))

  app.get<{ Params: { id: string } }>('/api/v1/runs/:id', async (req, reply) => {
    const run = getRun(ctx, Number(req.params.id))
    if (!run) return reply.code(404).send({ error: 'no such run' })
    return { run: toSummary(run), brief: briefView(ctx, run.id) ?? null, artifacts: listArtifacts(ctx, run.id) }
  })

  const StartBody = z.object({
    kind: z.enum(['manual', 'preview']).default('manual'),
    phase: z.enum(['morning', 'evening']).default('morning'),
    date: z.string().regex(DATE).optional(),
  })
  app.post('/api/v1/runs', async (req, reply) => {
    const body = StartBody.safeParse(req.body ?? {})
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message })
    try {
      const runId = svc.runner.start(body.data.kind, body.data.date, body.data.phase)
      return { runId }
    } catch (err) {
      if (err instanceof RunBusy) return reply.code(409).send({ error: err.message, activeRunId: err.activeRunId })
      throw err
    }
  })

  app.get('/api/v1/schedule', async () => svc.scheduler.info())
}
