import { z } from 'zod'
import { complete, LlmError, type LlmEndpoint } from '../llm/client.js'
import { extractJson } from '../llm/extract.js'
import { fillPrompt, loadPrompt } from '../prompts/load.js'
import { findTool, jsonSchemaOf, resultText, runTool, toolsFor, validateArgs, type ToolContext } from '../tools/index.js'
import { appendMessage, HISTORY_MESSAGES, listMessages, type ChatMessage } from './thread.js'
import { chatStatus } from './status.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/**
 * One turn of the administrator chat (ARCHITECTURE §7), ported from Newsdesk `chat/loop.ts`:
 * Aube owns the loop and the tools; the model only chooses which to call next. It answers one JSON
 * object naming at most one tool, the server runs it, and the result is written as a row *before*
 * the next round reads it back — the prompt is rebuilt from the rows every round, so what the user
 * sees and what the model is shown cannot disagree.
 *
 * Text mode only (no `tools` field), whatever the run's tool mode: this keeps the chat working
 * with any backend.
 */
export const MAX_CALLS = 8
export const TURN_MS = 120_000
const CALL_TIMEOUT_MS = 60_000
export const RESULT_EXCERPT_CHARS = 4_000

const Answer = z.object({
  say: z.string().default(''),
  call: z.object({ tool: z.string().min(1), args: z.record(z.unknown()).default({}) }).nullable().default(null),
})

const SHAPE = [
  '{',
  '  "say": string,          // what to tell the user; "" if you are only calling a tool',
  '  "call": {               // the one tool to run now, or null when the turn is over',
  '    "tool": string,       // a name from the catalogue, exactly',
  '    "args": object        // its arguments',
  '  } | null',
  '}',
].join('\n')

export function renderCatalogue(): string {
  return toolsFor('chat')
    .map((t) => {
      const flags = [t.writes ? 'writes' : 'read-only', ...(t.confirm ? ['needs confirmation'] : [])].join(', ')
      const props = (jsonSchemaOf(t).properties ?? {}) as Record<string, unknown>
      const args = Object.keys(props).length ? JSON.stringify(props) : '{}'
      return `- **${t.name}** (${flags}): ${t.description}\n  args: ${args}`
    })
    .join('\n')
}

function excerpt(text: string): string {
  return text.length <= RESULT_EXCERPT_CHARS ? text : `${text.slice(0, RESULT_EXCERPT_CHARS)}\n…(cut, ${text.length - RESULT_EXCERPT_CHARS} more characters)`
}

function renderHistory(messages: ChatMessage[]): string {
  if (!messages.length) return '(nothing yet)'
  return messages
    .map((m) => {
      if (m.role !== 'tool') return `**${m.role}:** ${m.body}`
      const state = m.confirmWith ? (m.confirmedAt ? `confirmed by the user → ${m.ok ? 'done' : 'failed'}` : 'offered to the user, awaiting confirmation') : m.ok ? 'result' : 'refused'
      return `**tool ${m.tool} (${state})** args: ${JSON.stringify(m.args ?? {})}\n${excerpt(m.result ?? m.body)}`
    })
    .join('\n\n')
}

export interface StepResult {
  ok: boolean
  text: string
  confirmWith?: string
}

/** Run one call, or refuse it, or offer it for confirmation. Only registered chat tools can run. */
export async function dispatch(call: { tool: string; args: Record<string, unknown> }, t: ToolContext): Promise<StepResult> {
  const tool = findTool(call.tool, 'chat')
  if (!tool) return { ok: false, text: `There is no tool called "${call.tool}". Use a name from the catalogue, exactly.` }
  const v = validateArgs(tool, call.args)
  if (!v.ok) return { ok: false, text: `Those arguments were rejected by ${tool.name}: ${v.error}` }
  if (tool.confirm) {
    try {
      const summary = await tool.confirm(v.data as never, t)
      return { ok: true, confirmWith: summary, text: `${tool.name} was offered to the user for confirmation. It runs only if they confirm.` }
    } catch (err) {
      return { ok: false, text: err instanceof Error ? err.message : String(err) }
    }
  }
  const r = await runTool(tool, v.data, t)
  return { ok: r.isError !== true, text: resultText(r) }
}

/** Run a confirmed call. Arguments are re-validated: they were written by a model. */
export async function runConfirmed(m: ChatMessage, t: ToolContext): Promise<StepResult> {
  const tool = m.tool ? findTool(m.tool, 'chat') : undefined
  if (!tool) return { ok: false, text: `There is no tool called "${m.tool}".` }
  const r = await runTool(tool, m.args, t)
  return { ok: r.isError !== true, text: resultText(r) }
}

export function endpointOf(ctx: AppContext): LlmEndpoint {
  const llm = ctx.config.get().llm
  return { baseUrl: llm.base_url, apiKey: llm.api_key, model: llm.model, timeoutS: llm.timeout_s, extraBody: llm.extra_body }
}

export interface TurnOptions {
  onMessage?: (m: ChatMessage) => void
  turnMs?: number
}

export async function runTurn(ctx: AppContext, svc: Services, threadId: number, message: string, opts: TurnOptions = {}): Promise<void> {
  const deadline = Date.now() + (opts.turnMs ?? TURN_MS)
  const emit = (m: ChatMessage) => opts.onMessage?.(m)
  const t: ToolContext = { ctx, svc, by: `chat:${threadId}`, runId: null }
  const userRow = appendMessage(ctx, { threadId, role: 'user', body: message })
  emit(userRow)

  let calls = 0
  let didWork = false
  let failure: string | null = null

  for (let round = 1; round <= MAX_CALLS + 1; round++) {
    if (Date.now() >= deadline) {
      failure = `this turn ran out of time after ${calls} call(s)`
      break
    }
    const prompt = fillPrompt(loadPrompt('chat'), {
      CATALOGUE: renderCatalogue(),
      STATUS: await chatStatus(ctx, svc),
      // The message being answered is shown under its own heading, not in the history.
      HISTORY: renderHistory(listMessages(ctx, threadId, HISTORY_MESSAGES).filter((m) => m.id !== userRow.id)),
      MESSAGE: message,
      SHAPE,
      BUDGET: `Call ${calls + 1} of ${MAX_CALLS}; ${Math.max(0, Math.round((deadline - Date.now()) / 1000))} s left in this turn.`,
    })

    let answer: z.infer<typeof Answer> | undefined
    let lastError = ''
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      try {
        const c = await complete(endpointOf(ctx), [{ role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nYour previous answer could not be used (${lastError}). Reply with the JSON object only.` }], {
          timeoutMs: Math.max(1_000, Math.min(CALL_TIMEOUT_MS, deadline - Date.now())),
        })
        const parsed = Answer.safeParse(extractJson(c.content))
        if (parsed.success) answer = parsed.data
        else lastError = extractJson(c.content) === undefined ? 'no JSON object found' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      } catch (err) {
        failure = err instanceof LlmError ? `the LLM ${err.cls === 'unreachable' ? 'could not be reached' : `failed (${err.cls})`}: ${err.message}` : String(err)
        break
      }
    }
    if (failure) break
    if (!answer) {
      failure = `the answer could not be used twice (${lastError})`
      break
    }

    if (answer.say.trim()) emit(appendMessage(ctx, { threadId, role: 'assistant', body: answer.say.trim() }))
    if (!answer.call) return
    if (calls >= MAX_CALLS) {
      failure = `this turn made ${MAX_CALLS} tool calls without finishing`
      break
    }
    calls++
    const step = await dispatch(answer.call, t)
    if (step.ok && !step.confirmWith) didWork = true
    emit(
      appendMessage(ctx, {
        threadId,
        role: 'tool',
        tool: answer.call.tool,
        args: answer.call.args,
        result: step.text,
        ok: step.confirmWith ? null : step.ok,
        ...(step.confirmWith ? { confirmWith: step.confirmWith } : {}),
      }),
    )
    // An offer ends the turn: the next move is the user's.
    if (step.confirmWith) return
  }

  if (failure) {
    // A turn that already did real work reports the work first (Touchstone §9.4): "I could not
    // finish" alone would read as if nothing happened.
    const prefix = didWork ? 'I did the steps above, but could not finish the rest' : 'I could not finish that'
    emit(appendMessage(ctx, { threadId, role: 'assistant', body: `${prefix}: ${failure}.` }))
  }
}
