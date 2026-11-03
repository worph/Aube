import Fastify from 'fastify'

/** A scripted OpenAI-compatible server. Each request takes the next step; the last one repeats. */
export type Step =
  | { status?: number; content?: string; body?: unknown; delayMs?: number; toolCalls?: unknown[] }
  | ((req: { messages: any[]; tools?: any[] }) => { status?: number; content?: string; body?: unknown; toolCalls?: unknown[] })

export async function fakeLlm(steps: Step[]) {
  const app = Fastify()
  const requests: Array<{ messages: any[]; tools?: any[]; auth?: string }> = []
  app.get('/v1/models', async () => ({ data: [{ id: 'fake-model' }] }))
  app.post('/v1/chat/completions', async (req, reply) => {
    const body = req.body as { messages: any[]; tools?: any[] }
    requests.push({ ...body, ...(req.headers.authorization ? { auth: req.headers.authorization } : {}) })
    const raw = steps[Math.min(requests.length - 1, steps.length - 1)]!
    const step = typeof raw === 'function' ? raw(body) : raw
    if ('delayMs' in step && step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs))
    if (step.body !== undefined) return reply.code(step.status ?? 200).send(step.body)
    if ((step.status ?? 200) !== 200) return reply.code(step.status!).send({ error: { message: step.content ?? 'nope' } })
    return {
      choices: [{ message: { role: 'assistant', content: step.content ?? '', ...(step.toolCalls ? { tool_calls: step.toolCalls } : {}) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => app.close() }
}

export const validAnswer = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: '☀️ Wednesday',
    headline: '3 meetings · legs at 18:30',
    brief_markdown: '## Today\n- Review at 10:00',
    events: [{ start: '10:00', end: '11:00', title: 'Review', source: 'calendar' }],
    blocks: [{ start: '08:30', end: '10:00', title: 'Deep work', kind: 'focus' }],
    sources: [{ name: 'calendar', ok: true }],
    ...extra,
  })
