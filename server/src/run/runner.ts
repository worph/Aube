import { addDays, atLocal, localDate, weekdayName, parseAnswer, type ParsedAnswer, type RunKind, type RunPhase } from '@aube/shared'
import { AUTH_RE, complete, LlmError, type ChatMessage, type Completion, type FailureClass, type LlmEndpoint } from '../llm/client.js'
import { extractJson } from '../llm/extract.js'
import { buildRunMessages } from './messages.js'
import { addArtifact, createRun, getRun, saveBrief, updateRun } from './store.js'
import type { AppContext } from '../context.js'

/**
 * The nightly run (ARCHITECTURE §3): prompt → backend → validate → brief. Whatever happens, a
 * brief is stored: the contract's, else the backend's raw text, else a failure brief that says
 * what broke (invariant 3).
 *
 * Retry policy per failure class (IMPLEMENTATION §8.1):
 *  - auth, unreachable → fail now (waiting changes nothing);
 *  - busy → back off with jitter until the deadline (notify time; a preview does not wait);
 *  - error → retry once;
 *  - parse-failed → retry once with the validation errors appended, then keep the raw text.
 */

export type ToolLoop = (ctx: AppContext, ep: LlmEndpoint, messages: ChatMessage[], runId: number) => Promise<Completion>

export interface RunnerOptions {
  sleep?: (ms: number) => Promise<void>
  /** Called once a non-preview run has a stored brief (READY or FAILED). */
  onDone?: (runId: number) => void
  /** Tool mode `aube` (M6). Absent → plain completion. */
  toolLoop?: ToolLoop
}

export class RunBusy extends Error {
  constructor(readonly activeRunId: number) {
    super(`a run is already in progress (#${activeRunId})`)
  }
}

export class Runner {
  /** The one real (non-preview) run allowed at a time. */
  private active: number | null = null
  /** Every run in progress, previews included (attribution of MCP calls). */
  private running = new Set<number>()
  private readonly sleep: (ms: number) => Promise<void>
  /** Resolves when the run finishes; for tests and the chat's run_preview. */
  readonly finished = new Map<number, Promise<void>>()

  constructor(
    private readonly ctx: AppContext,
    private readonly opts: RunnerOptions = {},
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  activeRunId(): number | null {
    return this.active
  }

  inProgress(): number[] {
    return [...this.running]
  }

  /**
   * Start a run in the background and return its id. Throws RunBusy for a second real run.
   * The morning phase defaults to today; the evening phase (v1.1) to tomorrow.
   */
  start(kind: RunKind, date?: string, phase: RunPhase = 'morning'): number {
    const cfg = this.ctx.config.get()
    const today = localDate(this.ctx.now(), cfg.timezone)
    const target = date ?? (phase === 'evening' ? addDays(today, 1) : today)
    if (kind !== 'preview' && this.active !== null) throw new RunBusy(this.active)
    const run = createRun(this.ctx, { date: target, kind, phase, toolMode: cfg.llm.tool_mode, model: cfg.llm.model })
    if (kind !== 'preview') this.active = run.id
    this.running.add(run.id)
    const done = this.execute(run.id, kind, target, phase)
      .catch((err) => this.ctx.log(`run #${run.id} crashed: ${(err as Error).stack ?? err}`))
      .finally(() => {
        if (this.active === run.id) this.active = null
        this.running.delete(run.id)
        if (kind !== 'preview') this.opts.onDone?.(run.id)
      })
    this.finished.set(run.id, done)
    return run.id
  }

  private async execute(runId: number, kind: RunKind, date: string, phase: RunPhase): Promise<void> {
    const ctx = this.ctx
    const cfg = ctx.config.get()
    const started = ctx.now()
    const ep: LlmEndpoint = { baseUrl: cfg.llm.base_url, apiKey: cfg.llm.api_key, model: cfg.llm.model, timeoutS: cfg.llm.timeout_s, extraBody: cfg.llm.extra_body }
    // A busy backend is waited out until the brief is due: notify_at in the morning; midnight for
    // an evening preview (its day starts then). A Preview never waits.
    const deadline = kind === 'preview' ? started : phase === 'evening' ? atLocal(date, '00:00', cfg.timezone) : atLocal(date, cfg.notify_at, cfg.timezone)

    let built
    try {
      built = buildRunMessages(ctx, date, phase)
    } catch (err) {
      return this.fail(runId, date, started, 'error', `could not assemble the prompt: ${(err as Error).message}`)
    }
    updateRun(ctx, runId, { status: 'RUNNING', systemHash: built.systemHash, promptVersionId: built.promptVersionId, memoryReadonly: built.memoryReadonly })
    const messages = [...built.messages]
    addArtifact(ctx, runId, 'messages', messages)

    let attempts = 0
    let errorRetried = false
    let parseRetried = false
    let busyWaitMs = 15_000
    let tokensIn = 0
    let tokensOut = 0

    for (;;) {
      attempts++
      updateRun(ctx, runId, { attempts })
      let completion: Completion
      try {
        completion = this.opts.toolLoop && cfg.llm.tool_mode === 'aube' ? await this.opts.toolLoop(ctx, ep, messages, runId) : await complete(ep, messages)
      } catch (err) {
        const e = err instanceof LlmError ? err : new LlmError((err as Error).message, 'error')
        if (e.cls === 'busy' && ctx.now().getTime() + busyWaitMs < deadline.getTime()) {
          ctx.log(`run #${runId}: backend busy, retrying in ${Math.round(busyWaitMs / 1000)} s`)
          await this.sleep(busyWaitMs + Math.floor(Math.random() * 5_000))
          busyWaitMs = Math.min(busyWaitMs * 2, 5 * 60_000)
          continue
        }
        if (e.cls === 'error' && !errorRetried) {
          errorRetried = true
          continue
        }
        return this.fail(runId, date, started, e.cls, e.message, { tokensIn, tokensOut })
      }
      tokensIn += completion.usage?.input ?? 0
      tokensOut += completion.usage?.output ?? 0
      addArtifact(ctx, runId, 'raw_answer', completion.content)

      const json = extractJson(completion.content)
      const parsed = json === undefined ? { ok: false as const, errors: ['no JSON object found in the answer'] } : parseAnswer(json)
      if (parsed.ok) return this.succeed(runId, date, started, 'contract', parsed.answer, { tokensIn, tokensOut })

      // A short answer that is a login complaint is the backend's state, not the brief (Touchstone).
      if (AUTH_RE.test(completion.content) && completion.content.length < 500) {
        return this.fail(runId, date, started, 'auth', completion.content.trim(), { tokensIn, tokensOut })
      }
      if (!parseRetried) {
        parseRetried = true
        messages.push({ role: 'assistant', content: completion.content })
        messages.push({
          role: 'user',
          content: `Your previous answer failed validation:\n- ${parsed.errors.join('\n- ')}\nReturn the corrected JSON object only, nothing else.`,
        })
        continue
      }
      ctx.log(`run #${runId}: answer not in the contract shape after a retry; keeping the raw text`)
      return this.succeed(
        runId,
        date,
        started,
        'raw',
        {
          title: `${phase === 'evening' ? '🌙' : '☀️'} ${weekdayName(date)} ${date}`,
          headline: firstLine(completion.content),
          markdown: `> ⚠️ This brief is not in the expected shape (${parsed.errors.slice(0, 3).join('; ')}). Shown as the backend wrote it.\n\n${completion.content}`,
          sources: [],
          events: [],
          blocks: [],
          dropped: 0,
        },
        { tokensIn, tokensOut },
        'parse-failed',
      )
    }
  }

  private succeed(
    runId: number,
    date: string,
    started: Date,
    shape: 'contract' | 'raw',
    answer: ParsedAnswer,
    usage: { tokensIn: number; tokensOut: number },
    failureClass?: FailureClass,
  ) {
    const now = this.ctx.now()
    saveBrief(this.ctx, runId, date, { shape, answer, asOf: started.toISOString() })
    updateRun(this.ctx, runId, {
      status: 'READY',
      readyAt: now.toISOString(),
      durationMs: now.getTime() - started.getTime(),
      inputTokens: usage.tokensIn || null,
      outputTokens: usage.tokensOut || null,
      failureClass: failureClass ?? null,
    })
  }

  private fail(runId: number, date: string, started: Date, cls: FailureClass, text: string, usage?: { tokensIn: number; tokensOut: number }) {
    const now = this.ctx.now()
    const evening = getRun(this.ctx, runId)?.phase === 'evening'
    const what = evening ? 'evening preview' : 'brief'
    const why: Record<FailureClass, string> = {
      auth: 'the LLM backend refused the login',
      unreachable: 'the LLM backend could not be reached',
      busy: evening ? 'the LLM backend stayed busy until midnight' : 'the LLM backend stayed busy until the notification time',
      error: 'the LLM backend failed twice',
      'parse-failed': 'the answer could not be used',
    }
    saveBrief(this.ctx, runId, date, {
      shape: 'failure',
      asOf: started.toISOString(),
      answer: {
        title: `⚠️ ${weekdayName(date)} ${date}: no ${what}`,
        headline: evening ? `No evening preview: ${why[cls]}.` : `No brief today: ${why[cls]}.`,
        markdown: `## No ${what}${evening ? '' : ' today'}\n\nThe ${what} could not be prepared because ${why[cls]}.\n\n**Class:** \`${cls}\`\n\n**Detail:**\n\n\`\`\`\n${text.slice(0, 2000)}\n\`\`\`\n\nCheck Settings → LLM and press **Test**, then **Run now** on the Briefs page.`,
        sources: [],
        events: [],
        blocks: [],
        dropped: 0,
      },
    })
    updateRun(this.ctx, runId, {
      status: 'FAILED',
      readyAt: now.toISOString(),
      durationMs: now.getTime() - started.getTime(),
      failureClass: cls,
      failureText: text.slice(0, 2000),
      inputTokens: usage?.tokensIn || null,
      outputTokens: usage?.tokensOut || null,
    })
    this.ctx.log(`run #${runId} failed [${cls}]: ${text.slice(0, 200)}`)
  }

  status(runId: number) {
    return getRun(this.ctx, runId)?.status
  }
}

function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? 'Brief'
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}
