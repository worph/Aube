import type { NormBlock, NormEvent } from './contract.js'

/** Shapes the server returns and the web renders. */

export type RunStatus = 'PENDING' | 'RUNNING' | 'READY' | 'NOTIFIED' | 'FAILED'
export type RunKind = 'scheduled' | 'manual' | 'preview'

export interface RunSummary {
  id: number
  date: string
  kind: RunKind
  status: RunStatus
  toolMode: string
  model: string
  startedAt: string
  readyAt: string | null
  notifiedAt: string | null
  failureClass: string | null
  failureText: string | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  attempts: number
  memoryReadonly: boolean
}

export interface BriefView {
  runId: number
  date: string
  title: string
  headline: string
  markdown: string
  shape: 'contract' | 'raw' | 'failure'
  sources: Array<{ name: string; ok: boolean; note?: string }>
  memoryNotes: string | null
  itemsDropped: number
  asOf: string
  events: NormEvent[]
  blocks: NormBlock[]
  run: RunSummary
  memoryChanges: Array<{ path: string; action: string; at: string }>
  sends: Array<{ channel: string; status: string; error: string | null; at: string }>
}

export interface BriefListItem {
  date: string
  runId: number
  title: string
  headline: string
  shape: 'contract' | 'raw' | 'failure'
  status: RunStatus
}

export interface ScheduleInfo {
  timezone: string
  runAt: string
  notifyAt: string
  nextRun: string | null
  nextNotify: string | null
  active: RunSummary | null
}
