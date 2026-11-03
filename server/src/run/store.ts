import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import type { BriefListItem, BriefView, NormBlock, NormEvent, ParsedAnswer, RunKind, RunPhase, RunStatus, RunSummary } from '@aube/shared'
import { toMinutes } from '@aube/shared'
import { schema } from '../db/index.js'
import type { AppContext } from '../context.js'

/** Reads and writes of runs, briefs and their day band. The day's brief is derived, never stored twice. */

type RunRow = typeof schema.runs.$inferSelect

export function toSummary(r: RunRow): RunSummary {
  return {
    id: r.id,
    date: r.date,
    kind: r.kind,
    phase: r.phase,
    status: r.status,
    toolMode: r.toolMode,
    model: r.model,
    startedAt: r.startedAt,
    readyAt: r.readyAt,
    notifiedAt: r.notifiedAt,
    failureClass: r.failureClass,
    failureText: r.failureText,
    durationMs: r.durationMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    attempts: r.attempts,
    memoryReadonly: r.memoryReadonly,
  }
}

export function createRun(ctx: AppContext, v: { date: string; kind: RunKind; phase?: RunPhase; toolMode: string; model: string }): RunRow {
  return ctx.db
    .insert(schema.runs)
    .values({ ...v, status: 'PENDING', startedAt: ctx.now().toISOString() })
    .returning()
    .get()
}

export function updateRun(ctx: AppContext, id: number, patch: Partial<typeof schema.runs.$inferInsert>): void {
  ctx.db.update(schema.runs).set(patch).where(eq(schema.runs.id, id)).run()
}

export function getRun(ctx: AppContext, id: number): RunRow | undefined {
  return ctx.db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
}

export function addArtifact(ctx: AppContext, runId: number, kind: 'messages' | 'raw_answer' | 'tool_trace', body: unknown): void {
  ctx.db
    .insert(schema.runArtifacts)
    .values({ runId, kind, body: typeof body === 'string' ? body : JSON.stringify(body, null, 2), at: ctx.now().toISOString() })
    .run()
}

export function listArtifacts(ctx: AppContext, runId: number) {
  return ctx.db.select().from(schema.runArtifacts).where(eq(schema.runArtifacts.runId, runId)).orderBy(schema.runArtifacts.id).all()
}

export interface BriefInput {
  shape: 'contract' | 'raw' | 'failure'
  answer: Pick<ParsedAnswer, 'title' | 'headline' | 'markdown' | 'sources' | 'events' | 'blocks' | 'dropped' | 'wakeUp'> & { memoryNotes?: string }
  asOf: string
}

export function saveBrief(ctx: AppContext, runId: number, date: string, b: BriefInput): void {
  ctx.db.transaction((tx) => {
    tx.insert(schema.briefs)
      .values({
        runId,
        date,
        title: b.answer.title,
        headline: b.answer.headline,
        markdown: b.answer.markdown,
        shape: b.shape,
        sourcesJson: JSON.stringify(b.answer.sources),
        memoryNotes: b.answer.memoryNotes ?? null,
        itemsDropped: b.answer.dropped,
        asOf: b.asOf,
        wakeTime: b.answer.wakeUp?.time ?? null,
        wakeReason: b.answer.wakeUp?.reason ?? null,
      })
      .run()
    b.answer.events.forEach((e, idx) =>
      tx
        .insert(schema.briefEvents)
        .values({ runId, idx, title: e.title, allDay: e.allDay, startMin: e.startMin, endMin: e.endMin, openEnd: e.openEnd, crossesMidnight: e.crossesMidnight, location: e.location ?? null, source: e.source ?? null })
        .run(),
    )
    b.answer.blocks.forEach((k, idx) =>
      tx
        .insert(schema.briefBlocks)
        .values({ runId, idx, title: k.title, kind: k.kind, startMin: k.startMin, endMin: k.endMin, openEnd: k.openEnd, crossesMidnight: k.crossesMidnight, overlapsEvent: k.overlapsEvent })
        .run(),
    )
  })
}

const DONE: RunStatus[] = ['READY', 'NOTIFIED', 'FAILED']

/** Failure briefs sort after every other brief (ARCHITECTURE §3: a failed run never hides a good one). */
const failureLast = sql`case when ${schema.briefs.shape} = 'failure' then 1 else 0 end`

/**
 * The run whose brief is the day's: the latest finished non-preview run of that date whose brief is
 * not a failure; the latest failure only when every run of the date failed.
 */
export function dayRunId(ctx: AppContext, date: string): number | undefined {
  const row = ctx.db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .innerJoin(schema.briefs, eq(schema.briefs.runId, schema.runs.id))
    .where(and(eq(schema.runs.date, date), ne(schema.runs.kind, 'preview'), inArray(schema.runs.status, DONE)))
    .orderBy(failureLast, desc(schema.runs.id))
    .limit(1)
    .get()
  return row?.id
}

/** Whether `date` already has a real (non-preview) run of `phase`, finished or not. For the scheduler. */
export function hasPhaseRun(ctx: AppContext, date: string, phase: RunPhase): boolean {
  return !!ctx.db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.date, date), eq(schema.runs.phase, phase), ne(schema.runs.kind, 'preview')))
    .get()
}

/** The latest good evening preview of `date`, for the morning run's prompt. */
export function eveningPreview(ctx: AppContext, date: string): { headline: string; wakeTime: string | null; wakeReason: string | null } | undefined {
  return ctx.db
    .select({ headline: schema.briefs.headline, wakeTime: schema.briefs.wakeTime, wakeReason: schema.briefs.wakeReason })
    .from(schema.runs)
    .innerJoin(schema.briefs, eq(schema.briefs.runId, schema.runs.id))
    .where(and(eq(schema.runs.date, date), eq(schema.runs.phase, 'evening'), ne(schema.runs.kind, 'preview'), ne(schema.briefs.shape, 'failure')))
    .orderBy(desc(schema.runs.id))
    .limit(1)
    .get()
}

export function briefView(ctx: AppContext, runId: number): BriefView | undefined {
  const b = ctx.db.select().from(schema.briefs).where(eq(schema.briefs.runId, runId)).get()
  const run = getRun(ctx, runId)
  if (!b || !run) return undefined
  const events: NormEvent[] = ctx.db
    .select()
    .from(schema.briefEvents)
    .where(eq(schema.briefEvents.runId, runId))
    .orderBy(schema.briefEvents.idx)
    .all()
    .map((e) => ({
      title: e.title,
      allDay: e.allDay,
      startMin: e.startMin,
      endMin: e.endMin,
      openEnd: e.openEnd,
      crossesMidnight: e.crossesMidnight,
      ...(e.location ? { location: e.location } : {}),
      ...(e.source ? { source: e.source } : {}),
    }))
  const blocks: NormBlock[] = ctx.db
    .select()
    .from(schema.briefBlocks)
    .where(eq(schema.briefBlocks.runId, runId))
    .orderBy(schema.briefBlocks.idx)
    .all()
    .map((k) => ({ title: k.title, kind: k.kind as NormBlock['kind'], startMin: k.startMin, endMin: k.endMin, openEnd: k.openEnd, crossesMidnight: k.crossesMidnight, overlapsEvent: k.overlapsEvent }))
  const memoryChanges = ctx.db
    .select({ path: schema.memoryJournal.path, action: schema.memoryJournal.action, at: schema.memoryJournal.at })
    .from(schema.memoryJournal)
    .where(eq(schema.memoryJournal.runId, runId))
    .orderBy(schema.memoryJournal.id)
    .all()
  const sends = ctx.db
    .select({ channel: schema.notifySends.channel, status: schema.notifySends.status, error: schema.notifySends.error, at: schema.notifySends.at })
    .from(schema.notifySends)
    .where(eq(schema.notifySends.runId, runId))
    .orderBy(schema.notifySends.id)
    .all()
  return {
    runId,
    date: b.date,
    title: b.title,
    headline: b.headline,
    markdown: b.markdown,
    shape: b.shape,
    sources: JSON.parse(b.sourcesJson),
    memoryNotes: b.memoryNotes,
    itemsDropped: b.itemsDropped,
    asOf: b.asOf,
    phase: run.phase,
    ...(b.wakeTime ? { wakeUp: { time: b.wakeTime, timeMin: toMinutes(b.wakeTime), ...(b.wakeReason ? { reason: b.wakeReason } : {}) } } : {}),
    events,
    blocks,
    run: toSummary(run),
    memoryChanges,
    sends,
  }
}

export function listBriefs(ctx: AppContext, limit = 90): BriefListItem[] {
  const rows = ctx.db
    .select({
      date: schema.briefs.date,
      runId: schema.briefs.runId,
      title: schema.briefs.title,
      headline: schema.briefs.headline,
      shape: schema.briefs.shape,
      status: schema.runs.status,
      phase: schema.runs.phase,
      wakeTime: schema.briefs.wakeTime,
    })
    .from(schema.briefs)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.briefs.runId))
    .where(and(ne(schema.runs.kind, 'preview'), inArray(schema.runs.status, DONE)))
    // Per date, the first row is the day's brief (same rule as dayRunId).
    .orderBy(desc(schema.briefs.date), failureLast, desc(schema.briefs.runId))
    .all()
  const seen = new Set<string>()
  const out: BriefListItem[] = []
  for (const r of rows) {
    if (seen.has(r.date)) continue
    seen.add(r.date)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

export function listRuns(ctx: AppContext, date?: string, limit = 50): RunSummary[] {
  const q = ctx.db.select().from(schema.runs)
  const rows = (date ? q.where(eq(schema.runs.date, date)) : q).orderBy(desc(schema.runs.id)).limit(limit).all()
  return rows.map(toSummary)
}

/** Headlines of the last `n` day briefs before `date`, for the run prompt. */
export function previousHeadlines(ctx: AppContext, date: string, n = 3): Array<{ date: string; headline: string }> {
  return listBriefs(ctx, 30)
    .filter((b) => b.date < date && b.shape !== 'failure')
    .slice(0, n)
    .map((b) => ({ date: b.date, headline: b.headline }))
}

/** Retention (IMPLEMENTATION §4): artifacts (prompts, raw answers, traces) after `days`; briefs stay. */
export function pruneArtifacts(ctx: AppContext, days: number): number {
  const cutoff = new Date(ctx.now().getTime() - days * 86_400_000).toISOString()
  return ctx.db.delete(schema.runArtifacts).where(lt(schema.runArtifacts.at, cutoff)).run().changes
}
