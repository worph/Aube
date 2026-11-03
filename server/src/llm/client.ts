/**
 * One protocol: OpenAI-compatible `POST {base_url}/chat/completions` (ARCHITECTURE §6.3).
 *
 * Nothing here knows what is behind the endpoint. Failures are classified from HTTP alone, plus one
 * text check: some backends report a dead login in the body of an otherwise ordinary answer, and
 * Touchstone's `AUTH_RE` (src/server/runner/agent.ts) is the list of ways they say it.
 */

export type FailureClass = 'auth' | 'unreachable' | 'busy' | 'error' | 'parse-failed'

export class LlmError extends Error {
  constructor(
    message: string,
    readonly cls: FailureClass,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

export const AUTH_RE =
  /failed to authenticate|oauth session|not logged in|please run \/login|invalid api key|authentication_error|unauthori[sz]ed|invalid_api_key/i

export interface LlmEndpoint {
  baseUrl: string
  apiKey: string
  model: string
  timeoutS: number
  extraBody?: Record<string, unknown>
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export interface CompleteOptions {
  tools?: ToolDef[]
  timeoutMs?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface Usage {
  input: number
  output: number
}

export interface Completion {
  content: string
  toolCalls: ToolCall[]
  usage?: Usage
  finishReason?: string
}

export function chatUrl(baseUrl: string): string {
  return `${normaliseBase(baseUrl)}/chat/completions`
}

export function normaliseBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

function classifyStatus(status: number): FailureClass {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'unreachable'
  if (status === 429 || status === 503) return 'busy'
  return 'error'
}

function classifyThrown(err: unknown, timeoutMs: number): LlmError {
  if (err instanceof LlmError) return err
  const e = err as Error & { cause?: { code?: string } }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return new LlmError(`no answer within ${Math.round(timeoutMs / 1000)} s`, 'error')
  const code = e?.cause?.code ?? ''
  const msg = `${e?.message ?? String(err)}${code ? ` (${code})` : ''}`
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ECONNRESET/.test(code) || /fetch failed/i.test(e?.message ?? ''))
    return new LlmError(`cannot reach the endpoint: ${msg}`, 'unreachable')
  return new LlmError(msg, 'error')
}

export async function complete(ep: LlmEndpoint, messages: ChatMessage[], opts: CompleteOptions = {}): Promise<Completion> {
  if (!ep.baseUrl) throw new LlmError('no LLM endpoint configured (Settings → LLM)', 'unreachable')
  const timeoutMs = opts.timeoutMs ?? ep.timeoutS * 1000
  const body: Record<string, unknown> = {
    ...(ep.extraBody ?? {}),
    model: ep.model,
    messages,
    stream: false,
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  }
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  let res: Response
  try {
    res = await fetch(chatUrl(ep.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    throw classifyThrown(err, timeoutMs)
  }
  let text: string
  try {
    text = await res.text()
  } catch (err) {
    throw classifyThrown(err, timeoutMs)
  }
  if (!res.ok) {
    const detail = errorMessageOf(text) ?? text.slice(0, 300)
    const cls = AUTH_RE.test(detail) ? 'auth' : classifyStatus(res.status)
    throw new LlmError(`HTTP ${res.status}: ${detail}`, cls, res.status)
  }
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new LlmError(`answer is not JSON: ${text.slice(0, 200)}`, 'error', res.status)
  }
  if (json?.error) {
    const detail = errorMessageOf(text) ?? 'error'
    throw new LlmError(detail, AUTH_RE.test(detail) ? 'auth' : 'error', res.status)
  }
  const choice = json?.choices?.[0]
  if (!choice) throw new LlmError('answer has no choices', 'error', res.status)
  const msg = choice.message ?? {}
  const content = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: any) => p?.text ?? '').join('') : ''
  const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
  if (!content.trim() && toolCalls.length === 0) throw new LlmError('empty answer', 'error', res.status)
  const usage = json.usage
    ? { input: Number(json.usage.prompt_tokens ?? json.usage.input_tokens ?? 0), output: Number(json.usage.completion_tokens ?? json.usage.output_tokens ?? 0) }
    : undefined
  return { content, toolCalls, ...(usage ? { usage } : {}), ...(choice.finish_reason ? { finishReason: choice.finish_reason } : {}) }
}

function errorMessageOf(text: string): string | undefined {
  try {
    const j = JSON.parse(text)
    const e = j?.error
    if (typeof e === 'string') return e
    if (e?.message) return String(e.message)
    if (j?.message) return String(j.message)
  } catch {
    /* not JSON */
  }
  return undefined
}

export interface ProbeResult {
  ok: boolean
  models?: string[]
  reply?: string
  error?: string
  cls?: FailureClass
  ms: number
}

/** Settings → Test: list models (tolerated if absent), then a one-line completion. */
export async function probe(ep: LlmEndpoint): Promise<ProbeResult> {
  const started = Date.now()
  let models: string[] | undefined
  try {
    const res = await fetch(`${normaliseBase(ep.baseUrl)}/models`, {
      headers: ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `HTTP ${res.status} on /models: the key was refused`, cls: 'auth', ms: Date.now() - started }
    }
    if (res.ok) {
      const j: any = await res.json().catch(() => null)
      if (Array.isArray(j?.data)) models = j.data.map((m: any) => String(m.id))
    }
  } catch (err) {
    const e = classifyThrown(err, 10_000)
    if (e.cls === 'unreachable') return { ok: false, error: e.message, cls: e.cls, ms: Date.now() - started }
  }
  try {
    const c = await complete(ep, [{ role: 'user', content: 'Reply with the single word OK.' }], {
      maxTokens: 5,
      timeoutMs: Math.min(ep.timeoutS * 1000, 120_000),
    })
    if (AUTH_RE.test(c.content) && c.content.length < 300) return { ok: false, error: c.content, cls: 'auth', ms: Date.now() - started, ...(models ? { models } : {}) }
    return { ok: true, reply: c.content.slice(0, 200), ms: Date.now() - started, ...(models ? { models } : {}) }
  } catch (err) {
    const e = err instanceof LlmError ? err : classifyThrown(err, 120_000)
    return { ok: false, error: e.message, cls: e.cls, ms: Date.now() - started, ...(models ? { models } : {}) }
  }
}
