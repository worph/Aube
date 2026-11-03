import { z } from 'zod'
import { toMinutes } from './time.js'

/**
 * The answer contract of a run (ARCHITECTURE §3, IMPLEMENTATION §5).
 *
 * Validation is layered: the brief fields decide whether the answer is usable at all (and a retry
 * is spent on them); events and blocks are validated one by one, and a bad one is dropped and
 * counted — it costs an item on the day band, never the brief.
 */

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'expected HH:MM')

export const EventSchema = z.union([
  z.object({
    all_day: z.literal(true),
    title: z.string().min(1),
    location: z.string().optional(),
    source: z.string().optional(),
  }),
  z.object({
    all_day: z.literal(false).optional(),
    title: z.string().min(1),
    start: Time.refine((t) => t !== '24:00', 'an event cannot start at 24:00'),
    end: Time.optional(),
    location: z.string().optional(),
    source: z.string().optional(),
  }),
])

export const BLOCK_KINDS = ['focus', 'task', 'meeting-prep', 'sport', 'meal', 'travel', 'break', 'other'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

export const BlockSchema = z.object({
  title: z.string().min(1),
  start: Time.refine((t) => t !== '24:00', 'a block cannot start at 24:00'),
  end: Time.optional(),
  kind: z.string().optional(),
})

/** The recommended wake-up time (v1.1, mostly from the evening phase). */
export const WakeUpSchema = z.object({
  time: Time.refine((t) => t !== '24:00', 'a wake-up time cannot be 24:00'),
  reason: z.string().max(200).optional(),
})

export interface WakeUp {
  time: string
  timeMin: number
  reason?: string
}

export const SourceSchema = z.object({ name: z.string(), ok: z.boolean(), note: z.string().optional() })

export const BriefSchema = z.object({
  title: z.string().min(1).max(120),
  headline: z.string().min(1).max(140),
  brief_markdown: z.string().min(1),
  events: z.array(z.unknown()).optional(),
  blocks: z.array(z.unknown()).optional(),
  sources: z.array(SourceSchema).optional(),
  memory_notes: z.string().optional(),
  // Validated alone below: a bad wake-up is dropped and counted, never the brief.
  wake_up: z.unknown().optional(),
})

export interface NormEvent {
  title: string
  allDay: boolean
  startMin: number | null
  endMin: number | null
  openEnd: boolean
  crossesMidnight: boolean
  location?: string
  source?: string
}

export interface NormBlock {
  title: string
  kind: BlockKind
  startMin: number
  endMin: number
  openEnd: boolean
  crossesMidnight: boolean
  overlapsEvent: boolean
}

export interface ParsedAnswer {
  title: string
  headline: string
  markdown: string
  sources: z.infer<typeof SourceSchema>[]
  memoryNotes?: string
  events: NormEvent[]
  blocks: NormBlock[]
  wakeUp?: WakeUp
  dropped: number
}

export type ParseResult = { ok: true; answer: ParsedAnswer } | { ok: false; errors: string[] }

export const DEFAULT_LENGTH_MIN = 30

function span(start: string, end: string | undefined): { startMin: number; endMin: number; openEnd: boolean; crossesMidnight: boolean } {
  const startMin = toMinutes(start)
  if (!end) return { startMin, endMin: Math.min(startMin + DEFAULT_LENGTH_MIN, 1440), openEnd: true, crossesMidnight: startMin + DEFAULT_LENGTH_MIN > 1440 }
  const endMin = toMinutes(end)
  if (endMin <= startMin) return { startMin, endMin: 1440, openEnd: false, crossesMidnight: endMin < startMin }
  return { startMin, endMin, openEnd: false, crossesMidnight: false }
}

/** Validate an already-extracted JSON value against the contract and normalise its day band. */
export function parseAnswer(value: unknown): ParseResult {
  const r = BriefSchema.safeParse(value)
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
  const b = r.data
  let dropped = 0

  const events: NormEvent[] = []
  const seenEvents = new Set<string>()
  for (const raw of b.events ?? []) {
    const e = EventSchema.safeParse(raw)
    if (!e.success) {
      dropped++
      continue
    }
    const v = e.data
    const ev: NormEvent =
      v.all_day === true
        ? { title: v.title, allDay: true, startMin: null, endMin: null, openEnd: false, crossesMidnight: false }
        : { title: v.title, allDay: false, ...span(v.start, v.end) }
    if (v.location) ev.location = v.location
    if (v.source) ev.source = v.source
    const key = `${ev.title}|${ev.startMin}|${ev.endMin}|${ev.allDay}`
    if (seenEvents.has(key)) continue
    seenEvents.add(key)
    events.push(ev)
  }

  const timed = events.filter((e) => !e.allDay)
  const blocks: NormBlock[] = []
  const seenBlocks = new Set<string>()
  for (const raw of b.blocks ?? []) {
    const p = BlockSchema.safeParse(raw)
    if (!p.success) {
      dropped++
      continue
    }
    const v = p.data
    const s = span(v.start, v.end)
    const kind = (BLOCK_KINDS as readonly string[]).includes(v.kind ?? '') ? (v.kind as BlockKind) : 'other'
    const key = `${v.title}|${s.startMin}|${s.endMin}`
    if (seenBlocks.has(key)) continue
    seenBlocks.add(key)
    const overlapsEvent = timed.some((e) => e.startMin! < s.endMin && s.startMin < e.endMin!)
    blocks.push({ title: v.title, kind, ...s, overlapsEvent })
  }

  let wakeUp: WakeUp | undefined
  if (b.wake_up !== undefined && b.wake_up !== null) {
    const w = WakeUpSchema.safeParse(b.wake_up)
    if (w.success) wakeUp = { time: w.data.time, timeMin: toMinutes(w.data.time), ...(w.data.reason ? { reason: w.data.reason } : {}) }
    else dropped++
  }

  return {
    ok: true,
    answer: {
      title: b.title,
      headline: b.headline,
      markdown: b.brief_markdown,
      sources: b.sources ?? [],
      ...(b.memory_notes ? { memoryNotes: b.memory_notes } : {}),
      events: events.sort((a, z) => (a.startMin ?? -1) - (z.startMin ?? -1)),
      blocks: blocks.sort((a, z) => a.startMin - z.startMin),
      ...(wakeUp ? { wakeUp } : {}),
      dropped,
    },
  }
}

/** The contract as the run prompt states it. */
export const CONTRACT_EXAMPLE = {
  title: '☀️ Wednesday 4 November',
  headline: '1 monitor down · 3 meetings · legs at 18:30 · fish tonight',
  brief_markdown: '## 🚨 Infra\n…\n## 📅 Today\n…',
  events: [
    { start: '10:00', end: '11:00', title: 'Sprint review', location: 'Meet', source: 'calendar' },
    { all_day: true, title: "Paul's birthday", source: 'calendar' },
  ],
  blocks: [
    { start: '08:30', end: '10:00', title: 'Deep work: invoice export', kind: 'focus' },
    { start: '12:30', end: '13:15', title: 'Lunch', kind: 'meal' },
  ],
  sources: [
    { name: 'calendar', ok: true },
    { name: 'uptime', ok: false, note: 'timeout' },
  ],
  wake_up: { time: '06:40', reason: 'optional in the morning; required in the evening phase: one line on why' },
  memory_notes: 'optional: what you wrote to memory, in one line',
}
