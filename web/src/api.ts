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

export const getConfig = () => api<ConfigResponse>('/api/v1/config')
export const saveConfig = (config: AubeConfig) => api<ConfigResponse>('/api/v1/config', { method: 'PUT', json: config })
export const testLlm = (llm: AubeConfig['llm']) => api<LlmProbe>('/api/v1/config/test', { method: 'POST', json: { kind: 'llm', llm } })
export const testConnection = (connection: Connection, kind: 'connection' | 'beacon') =>
  api<ConnectionProbe>('/api/v1/config/test', { method: 'POST', json: { kind, connection } })
