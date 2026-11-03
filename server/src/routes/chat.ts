import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { runConfirmed, runTurn } from '../chat/loop.js'
import { appendMessage, currentThread, getMessage, listMessages, listThreads, settleConfirmation, startThread, threadForTurn } from '../chat/thread.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/**
 * The administrator chat over HTTP (ported from Newsdesk `api/admin-chat.ts`, minus the session —
 * AppShield owns access). A turn streams its rows as SSE while they land; the rows are the record,
 * so a dropped stream loses nothing.
 */
const inFlight = new Set<number>()

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext, svc: Services) {
  const inference = () => {
    const llm = ctx.config.get().llm
    return llm.base_url ? { available: true as const } : { available: false as const, reason: 'No LLM endpoint is configured yet. Set one in Settings → LLM and press Test.' }
  }

  app.get<{ Querystring: { thread?: string } }>('/api/v1/chat', async (req) => {
    const threadId = req.query.thread ? Number(req.query.thread) : currentThread(ctx)
    return {
      threadId: threadId ?? null,
      messages: threadId ? listMessages(ctx, threadId) : [],
      running: threadId ? inFlight.has(threadId) : false,
      inference: inference(),
      threads: listThreads(ctx),
    }
  })

  app.post('/api/v1/chat/new', async (_req, reply) => {
    const cur = currentThread(ctx)
    if (cur && inFlight.has(cur)) return reply.code(409).send({ error: 'this conversation is still thinking — wait for it to finish' })
    return { threadId: startThread(ctx) }
  })

  const Message = z.object({ message: z.string().min(1).max(8000) })
  app.post('/api/v1/chat/messages', async (req, reply) => {
    const body = Message.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'a message is required' })
    const inf = inference()
    if (!inf.available) return reply.code(409).send({ error: inf.reason })
    const threadId = threadForTurn(ctx)
    if (inFlight.has(threadId)) return reply.code(409).send({ error: 'this conversation is still thinking — wait for it to finish' })

    inFlight.add(threadId)
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    const send = (data: unknown) => {
      if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    const heartbeat = setInterval(() => !raw.writableEnded && raw.write(': ping\n\n'), 15_000)
    send({ type: 'thread', threadId })
    try {
      await runTurn(ctx, svc, threadId, body.data.message, { onMessage: (m) => send({ type: 'message', message: m }) })
    } catch (err) {
      send({ type: 'message', message: appendMessage(ctx, { threadId, role: 'assistant', body: `Something broke: ${(err as Error).message}` }) })
    } finally {
      inFlight.delete(threadId)
      clearInterval(heartbeat)
      send({ type: 'done' })
      raw.end()
    }
  })

  const Confirm = z.object({ messageId: z.number().int(), decision: z.enum(['confirm', 'cancel']) })
  app.post('/api/v1/chat/confirm', async (req, reply) => {
    const body = Confirm.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'messageId and decision are required' })
    const m = getMessage(ctx, body.data.messageId)
    if (!m || !m.confirmWith) return reply.code(404).send({ error: 'no such proposal' })
    if (m.confirmedAt) return reply.code(409).send({ error: 'already settled' })
    if (body.data.decision === 'cancel') {
      settleConfirmation(ctx, m.id, 'Cancelled by the user.', false)
      return { message: getMessage(ctx, m.id) }
    }
    const step = await runConfirmed(m, { ctx, svc, by: `chat:${m.threadId}`, runId: null })
    settleConfirmation(ctx, m.id, step.text, step.ok)
    return { message: getMessage(ctx, m.id) }
  })
}
