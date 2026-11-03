import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentPrompt, getPromptVersion, listPromptVersions, savePrompt } from '../prompt/store.js'
import type { AppContext } from '../context.js'

/** Master prompt page: current text, versions, save, restore. */
export function registerPromptRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/v1/prompt', async () => {
    const cur = currentPrompt(ctx)
    return { body: cur.body, versionId: cur.version.id, versions: listPromptVersions(ctx).map(({ body: _b, ...v }) => v) }
  })

  app.get<{ Params: { id: string } }>('/api/v1/prompt/versions/:id', async (req, reply) => {
    const v = getPromptVersion(ctx, Number(req.params.id))
    return v ?? reply.code(404).send({ error: 'no such version' })
  })

  const Save = z.object({ body: z.string().max(100_000), note: z.string().max(200).optional() })
  app.put('/api/v1/prompt', async (req, reply) => {
    const b = Save.safeParse(req.body)
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0]?.message })
    const v = savePrompt(ctx, b.data.body, 'ui', b.data.note)
    return { versionId: v.id }
  })

  app.post<{ Params: { id: string } }>('/api/v1/prompt/versions/:id/restore', async (req, reply) => {
    const v = getPromptVersion(ctx, Number(req.params.id))
    if (!v) return reply.code(404).send({ error: 'no such version' })
    const saved = savePrompt(ctx, v.body, 'ui', `restored version ${v.id}`)
    return { versionId: saved.id }
  })
}
