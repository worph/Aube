import type { AubeConfig, Connection } from '@aube/shared'

/** Fetch wrapper in the API's error envelope (`{ error, issues? }`), ported from Newsdesk web/src/api.ts. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: string[] = [],
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  })
  const text = await res.text()
  const body = text ? safeJson(text) : null
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; issues?: string[] }
    throw new ApiError(b.error ?? (res.statusText || `HTTP ${res.status}`), res.status, b.issues ?? [])
  }
  return body as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 300) }
  }
}

/** Read an SSE stream of `data: {json}` frames from a POST, calling `onEvent` per frame. */
export async function streamPost(path: string, json: unknown, onEvent: (event: any) => void): Promise<void> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
  if (!res.ok || !res.body) {
    const b = safeJson(await res.text()) as { error?: string }
    throw new ApiError(b?.error ?? `HTTP ${res.status}`, res.status)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (data) onEvent(safeJson(data))
    }
  }
}

export interface ConfigResponse {
  config: AubeConfig
  missingVars: string[]
}

export interface LlmProbe {
  ok: boolean
  models?: string[]
  reply?: string
  error?: string
  cls?: string
  ms: number
}

export interface DiscoveredTool {
  name: string
  description?: string
}

export interface ConnectionProbe {
  ok: boolean
  ms: number
  error?: string
  beacon?: boolean
  tools?: string[]
  catalogue?: { kind: 'beacon' | 'plain'; servers: Array<{ name: string; tools: DiscoveredTool[] }> }
}

export interface SecretStatus {
  name: string
  /** env: the container environment (wins); file: set from Settings into data/secrets.env; null: unset. */
  source: 'env' | 'file' | null
}
export const getSecrets = () => api<{ secrets: SecretStatus[] }>('/api/v1/secrets')
export const putSecret = (name: string, value: string) => api<SecretStatus>(`/api/v1/secrets/${encodeURIComponent(name)}`, { method: 'PUT', json: { value } })

export const getConfig = () => api<ConfigResponse>('/api/v1/config')
export const saveConfig = (config: AubeConfig) => api<ConfigResponse>('/api/v1/config', { method: 'PUT', json: config })
export const testLlm = (llm: AubeConfig['llm']) => api<LlmProbe>('/api/v1/config/test', { method: 'POST', json: { kind: 'llm', llm } })
export const testConnection = (connection: Connection, kind: 'connection' | 'beacon') =>
  api<ConnectionProbe>('/api/v1/config/test', { method: 'POST', json: { kind, connection } })

import type { BriefListItem, BriefView, RunSummary, ScheduleInfo } from '@aube/shared'

export interface BriefsResponse {
  briefs: BriefListItem[]
  schedule: ScheduleInfo
  today: string
}
export interface RunDetail {
  run: RunSummary
  brief: BriefView | null
  artifacts: Array<{ id: number; kind: string; body: string; at: string }>
}
export interface PromptVersionMeta {
  id: number
  savedAt: string
  savedBy: string
  note: string | null
}
export interface PromptResponse {
  body: string
  versionId: number
  versions: PromptVersionMeta[]
}

export const getBriefs = () => api<BriefsResponse>('/api/v1/briefs')
export const getBrief = (date: string) => api<BriefView>(`/api/v1/briefs/${date}`)
export const getRun = (id: number) => api<RunDetail>(`/api/v1/runs/${id}`)
export const startRun = (kind: 'manual' | 'preview', date?: string, phase: 'morning' | 'evening' = 'morning') =>
  api<{ runId: number }>('/api/v1/runs', { method: 'POST', json: { kind, phase, ...(date ? { date } : {}) } })
export const getPrompt = () => api<PromptResponse>('/api/v1/prompt')
export const getPromptVersion = (id: number) => api<PromptVersionMeta & { body: string }>(`/api/v1/prompt/versions/${id}`)
export const savePrompt = (body: string, note?: string) => api<{ versionId: number }>('/api/v1/prompt', { method: 'PUT', json: { body, ...(note ? { note } : {}) } })
export const restorePrompt = (id: number) => api<{ versionId: number }>(`/api/v1/prompt/versions/${id}/restore`, { method: 'POST' })

export const isRunning = (s?: string) => s === 'PENDING' || s === 'RUNNING'

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
export interface ChatState {
  threadId: number | null
  messages: ChatMessage[]
  running: boolean
  inference: { available: true } | { available: false; reason: string }
  threads: Array<{ id: number; createdAt: string; lastAt: string }>
}
export const getChat = (thread?: number) => api<ChatState>(`/api/v1/chat${thread ? `?thread=${thread}` : ''}`)
export const newThread = () => api<{ threadId: number }>('/api/v1/chat/new', { method: 'POST' })
export const confirmProposal = (messageId: number, decision: 'confirm' | 'cancel') => api<{ message: ChatMessage }>('/api/v1/chat/confirm', { method: 'POST', json: { messageId, decision } })

export interface MemoryFile {
  path: string
  kind: 'md' | 'image'
  size: number
  modifiedAt: string
  inIndex: boolean
}
export interface MemoryState {
  files: MemoryFile[]
  lastRun: { runId: number; date: string; touched: string[] } | null
  totalBytes: number
  maxTotalBytes: number
}
export interface JournalEntry {
  id: number
  path: string
  action: 'write' | 'delete' | 'restore'
  by: string
  runId: number | null
  at: string
  encoding: 'utf8' | 'base64'
  beforeSize: number | null
  afterSize: number | null
}
export type MemoryContent = { kind: 'md'; path: string; text: string } | { kind: 'image'; path: string; data: string; mimeType: string }
export const getMemory = () => api<MemoryState>('/api/v1/memory')
export const getMemoryFile = (path: string) => api<MemoryContent>(`/api/v1/memory/file?path=${encodeURIComponent(path)}`)
export const getMemoryHistory = (path?: string) => api<{ entries: JournalEntry[] }>(`/api/v1/memory/history${path ? `?path=${encodeURIComponent(path)}` : ''}`)
export const getMemoryVersion = (id: number, side: 'before' | 'after') =>
  api<{ path: string; kind: 'md' | 'image'; content: string | null; encoding: string }>(`/api/v1/memory/versions/${id}?side=${side}`)
export const restoreMemory = (journalId: number, side?: 'before' | 'after') => api<{ path: string }>('/api/v1/memory/restore', { method: 'POST', json: { journalId, ...(side ? { side } : {}) } })
export const memoryImageUrl = (path: string) => `/api/v1/memory/raw?path=${encodeURIComponent(path)}`

import type { Addon } from '@aube/shared'
export const testAddon = (addon: Addon) => api<{ ok: boolean; ms: number; sent?: number; error?: string }>('/api/v1/config/test', { method: 'POST', json: { kind: 'addon', addon } })
