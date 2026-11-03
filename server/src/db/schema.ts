import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** IMPLEMENTATION §4. Timestamps are ISO-8601 UTC strings; dates are local `YYYY-MM-DD`. */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

export const runs = sqliteTable(
  'runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    kind: text('kind', { enum: ['scheduled', 'manual', 'preview'] }).notNull(),
    status: text('status', { enum: ['PENDING', 'RUNNING', 'READY', 'NOTIFIED', 'FAILED'] }).notNull(),
    toolMode: text('tool_mode').notNull(),
    model: text('model').notNull().default(''),
    startedAt: text('started_at').notNull().default(now),
    readyAt: text('ready_at'),
    notifiedAt: text('notified_at'),
    failureClass: text('failure_class'),
    failureText: text('failure_text'),
    promptVersionId: integer('prompt_version_id'),
    systemHash: text('system_hash'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    attempts: integer('attempts').notNull().default(0),
    memoryReadonly: integer('memory_readonly', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('runs_date').on(t.date)],
)

export const runArtifacts = sqliteTable(
  'run_artifacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['messages', 'raw_answer', 'tool_trace'] }).notNull(),
    body: text('body').notNull(),
    at: text('at').notNull().default(now),
  },
  (t) => [index('run_artifacts_run').on(t.runId)],
)

/** One brief per run that produced output (previews included). The day's brief is derived. */
export const briefs = sqliteTable(
  'briefs',
  {
    runId: integer('run_id').primaryKey().references(() => runs.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    title: text('title').notNull(),
    headline: text('headline').notNull(),
    markdown: text('markdown').notNull(),
    shape: text('shape', { enum: ['contract', 'raw', 'failure'] }).notNull(),
    sourcesJson: text('sources_json').notNull().default('[]'),
    memoryNotes: text('memory_notes'),
    itemsDropped: integer('items_dropped').notNull().default(0),
    asOf: text('as_of').notNull(),
  },
  (t) => [index('briefs_date').on(t.date)],
)

export const briefEvents = sqliteTable(
  'brief_events',
  {
    runId: integer('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    title: text('title').notNull(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    startMin: integer('start_min'),
    endMin: integer('end_min'),
    openEnd: integer('open_end', { mode: 'boolean' }).notNull().default(false),
    crossesMidnight: integer('crosses_midnight', { mode: 'boolean' }).notNull().default(false),
    location: text('location'),
    source: text('source'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.idx] })],
)

export const briefBlocks = sqliteTable(
  'brief_blocks',
  {
    runId: integer('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('other'),
    startMin: integer('start_min').notNull(),
    endMin: integer('end_min').notNull(),
    openEnd: integer('open_end', { mode: 'boolean' }).notNull().default(false),
    crossesMidnight: integer('crosses_midnight', { mode: 'boolean' }).notNull().default(false),
    overlapsEvent: integer('overlaps_event', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.runId, t.idx] })],
)

export const memoryJournal = sqliteTable(
  'memory_journal',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    path: text('path').notNull(),
    action: text('action', { enum: ['write', 'delete', 'restore'] }).notNull(),
    before: text('before_blob'),
    after: text('after_blob'),
    encoding: text('encoding', { enum: ['utf8', 'base64'] }).notNull().default('utf8'),
    by: text('by').notNull(),
    runId: integer('run_id'),
    at: text('at').notNull().default(now),
  },
  (t) => [index('memory_journal_path').on(t.path), index('memory_journal_run').on(t.runId)],
)

export const promptVersions = sqliteTable('prompt_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  body: text('body').notNull(),
  savedAt: text('saved_at').notNull().default(now),
  savedBy: text('saved_by', { enum: ['ui', 'chat', 'boot'] }).notNull(),
  note: text('note'),
})

export const chatThreads = sqliteTable('chat_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: text('created_at').notNull().default(now),
  lastAt: text('last_at').notNull().default(now),
})

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    threadId: integer('thread_id').notNull().references(() => chatThreads.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
    body: text('body').notNull().default(''),
    tool: text('tool'),
    args: text('args'),
    result: text('result'),
    ok: integer('ok', { mode: 'boolean' }),
    /** Set on a proposed write awaiting the operator's confirmation. */
    confirmWith: text('confirm_with'),
    confirmedAt: text('confirmed_at'),
    at: text('at').notNull().default(now),
  },
  (t) => [index('chat_messages_thread').on(t.threadId)],
)

export const notifySends = sqliteTable('notify_sends', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  status: text('status', { enum: ['ok', 'failed'] }).notNull(),
  error: text('error'),
  at: text('at').notNull().default(now),
})

export const pushSubs = sqliteTable('push_subs', {
  endpoint: text('endpoint').primaryKey(),
  keysJson: text('keys_json').notNull(),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().default(now),
  lastOkAt: text('last_ok_at'),
})
