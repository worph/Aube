import { Cron } from 'croner'
import { and, eq, ne } from 'drizzle-orm'
import { atLocal, localDate, type ScheduleInfo } from '@aube/shared'
import { schema } from './db/index.js'
import { getRun, toSummary } from './run/store.js'
import { RunBusy, type Runner } from './run/runner.js'
import type { Notifier } from './notify/index.js'
import type { AppContext } from './context.js'

/**
 * Aube's own clock (IMPLEMENTATION §10): one job at `run_at`, one at `notify_at`, in the configured
 * timezone, rebuilt whenever the config is saved. On boot it catches up: past `run_at` with no run
 * for today → run now; past `notify_at` with an un-notified brief → notify now.
 */
export class Scheduler {
  private jobs: Cron[] = []

  constructor(
    private readonly ctx: AppContext,
    private readonly runner: Runner,
    private readonly notifier: Notifier,
  ) {}

  start(): void {
    this.rebuild()
    this.ctx.config.onChange(() => this.rebuild())
    this.catchUp()
  }

  stop(): void {
    for (const j of this.jobs) j.stop()
    this.jobs = []
  }

  rebuild(): void {
    this.stop()
    const cfg = this.ctx.config.get()
    const cron = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number)
      return `${m} ${h} * * *`
    }
    this.jobs = [
      new Cron(cron(cfg.run_at), { timezone: cfg.timezone, name: 'run', protect: true }, () => this.fireRun()),
      new Cron(cron(cfg.notify_at), { timezone: cfg.timezone, name: 'notify', protect: true }, () => this.fireNotify()),
    ]
  }

  today(): string {
    return localDate(this.ctx.now(), this.ctx.config.get().timezone)
  }

  fireRun(): void {
    const date = this.today()
    if (this.hasRealRun(date)) return
    // Not configured is not a failure: a fresh install should not greet you with a failure brief.
    if (!this.ctx.config.get().llm.base_url) {
      this.ctx.log(`scheduled run for ${date} skipped: no LLM endpoint configured (Settings → LLM)`)
      return
    }
    try {
      this.runner.start('scheduled', date)
    } catch (err) {
      if (!(err instanceof RunBusy)) throw err
      this.ctx.log(`scheduled run skipped: ${err.message}`)
    }
  }

  fireNotify(): void {
    this.notifier.notifyDue(this.today())
  }

  catchUp(): void {
    const cfg = this.ctx.config.get()
    const now = this.ctx.now()
    const date = this.today()
    if (now >= atLocal(date, cfg.run_at, cfg.timezone) && !this.hasRealRun(date)) {
      this.ctx.log(`catch-up: no run yet for ${date}, starting one`)
      this.fireRun()
    }
    if (now >= atLocal(date, cfg.notify_at, cfg.timezone)) this.notifier.notifyDue(date)
  }

  /** A run finished: if its notify time has already passed, notify now (a late brief). */
  onRunDone(runId: number): void {
    const run = getRun(this.ctx, runId)
    if (!run || run.kind === 'preview') return
    const cfg = this.ctx.config.get()
    if (this.ctx.now() >= atLocal(run.date, cfg.notify_at, cfg.timezone)) this.notifier.notifyRun(runId)
  }

  hasRealRun(date: string): boolean {
    return !!this.ctx.db
      .select({ id: schema.runs.id })
      .from(schema.runs)
      .where(and(eq(schema.runs.date, date), ne(schema.runs.kind, 'preview')))
      .get()
  }

  info(): ScheduleInfo {
    const cfg = this.ctx.config.get()
    const active = this.runner.activeRunId()
    const run = active !== null ? getRun(this.ctx, active) : undefined
    return {
      timezone: cfg.timezone,
      runAt: cfg.run_at,
      notifyAt: cfg.notify_at,
      nextRun: this.jobs[0]?.nextRun()?.toISOString() ?? null,
      nextNotify: this.jobs[1]?.nextRun()?.toISOString() ?? null,
      active: run ? toSummary(run) : null,
    }
  }
}
