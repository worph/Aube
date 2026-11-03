import { desc, eq } from 'drizzle-orm'
import { schema } from '../db/index.js'
import type { AppContext } from '../context.js'

/**
 * Chat threads, append-only (ported in shape from Newsdesk `chat/thread.ts`). "New conversation"
 * starts a thread and keeps the old one: its rows record why something was done. A thread idle
 * for eight hours rolls on the next turn.
 */
export const IDLE_ROLL_MS = 8 * 3600_000
export const HISTORY_MESSAGES = 30

export interface ChatMessage {
  id: number
  threadId: number
  role: 'user' | 'assistant' | 'tool'
  body: string
  tool: string | null
  args: unknown
  result: string | null
  ok: boolean | null
  confirmWith: string | null
  confirmedAt: string | null
  at: string
}

type Row = typeof schema.chatMessages.$inferSelect

function toMessage(r: Row): ChatMessage {
  return { ...r, args: r.args ? JSON.parse(r.args) : null }
}

export function currentThread(ctx: AppContext): number | undefined {
  return ctx.db.select({ id: schema.chatThreads.id }).from(schema.chatThreads).orderBy(desc(schema.chatThreads.id)).limit(1).get()?.id
}

export function startThread(ctx: AppContext): number {
  const now = ctx.now().toISOString()
  return ctx.db.insert(schema.chatThreads).values({ createdAt: now, lastAt: now }).returning().get().id
}

/** The thread a new turn goes into: the current one unless it has gone idle. */
export function threadForTurn(ctx: AppContext): number {
  const t = ctx.db.select().from(schema.chatThreads).orderBy(desc(schema.chatThreads.id)).limit(1).get()
  if (t && ctx.now().getTime() - new Date(t.lastAt).getTime() < IDLE_ROLL_MS) return t.id
  return startThread(ctx)
}

export function listThreads(ctx: AppContext, limit = 30) {
  return ctx.db.select().from(schema.chatThreads).orderBy(desc(schema.chatThreads.id)).limit(limit).all()
}

export function appendMessage(
  ctx: AppContext,
  m: { threadId: number; role: ChatMessage['role']; body?: string; tool?: string; args?: unknown; result?: string; ok?: boolean | null; confirmWith?: string },
): ChatMessage {
  const at = ctx.now().toISOString()
  const row = ctx.db
    .insert(schema.chatMessages)
    .values({
      threadId: m.threadId,
      role: m.role,
      body: m.body ?? '',
      tool: m.tool ?? null,
      args: m.args === undefined ? null : JSON.stringify(m.args),
      result: m.result ?? null,
      ok: m.ok ?? null,
      confirmWith: m.confirmWith ?? null,
      at,
    })
    .returning()
    .get()
  ctx.db.update(schema.chatThreads).set({ lastAt: at }).where(eq(schema.chatThreads.id, m.threadId)).run()
  return toMessage(row)
}

export function listMessages(ctx: AppContext, threadId: number, last?: number): ChatMessage[] {
  const rows = ctx.db.select().from(schema.chatMessages).where(eq(schema.chatMessages.threadId, threadId)).orderBy(desc(schema.chatMessages.id)).limit(last ?? 10_000).all()
  return rows.reverse().map(toMessage)
}

export function getMessage(ctx: AppContext, id: number): ChatMessage | undefined {
  const r = ctx.db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, id)).get()
  return r ? toMessage(r) : undefined
}

export function settleConfirmation(ctx: AppContext, id: number, result: string, ok: boolean): void {
  ctx.db.update(schema.chatMessages).set({ confirmedAt: ctx.now().toISOString(), result, ok }).where(eq(schema.chatMessages.id, id)).run()
}
