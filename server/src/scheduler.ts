import { Cron } from 'croner'
import { addDays, atLocal, localDate, type RunPhase, type ScheduleInfo } from '@aube/shared'
import { getRun, hasPhaseRun, pruneArtifacts, toSummary } from './run/store.js'
import { RunBusy, type Runner } from './run/runner.js'
import type { Notifier } from './notify/index.js'
import type { AppContext } from './context.js'

/**
 * Aube's own clock (IMPLEMENTATION §10), in the configured timezone, rebuilt whenever the config is
 * saved:
 *  - `run_at`: the morning run for today (unless `morning_run: false`);
 *  - `notify_at`: notify the day's brief if it has not been yet;
 *  - `evening_at` (optional, v1.1): the evening preview for tomorrow, notified as soon as it is ready.
 * "Already ran" is per phase. On boot it catches up on all three.
 */
export class Scheduler {
  private run: Cron | null = null
  private notify: Cron | null = null
  private evening: Cron | null = null
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
    this.prune()
  }

  prune(): void {
    const n = pruneArtifacts(this.ctx, this.ctx.config.get().retention.artifact_days)
    if (n) this.ctx.log(`retention: removed ${n} run artifact(s)`)
  }

  stop(): void {
    for (const j of this.jobs) j.stop()
    this.jobs = []
    this.run = this.notify = this.evening = null
  }

  rebuild(): void {
    this.stop()
    const cfg = this.ctx.config.get()
    const opts = { timezone: cfg.timezone, protect: true }
    const cron = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number)
      return `${m} ${h} * * *`
    }
    if (cfg.morning_run) this.run = new Cron(cron(cfg.run_at), opts, () => this.fireRun())
    this.notify = new Cron(cron(cfg.notify_at), opts, () => this.fireNotify())
    if (cfg.evening_at) this.evening = new Cron(cron(cfg.evening_at), opts, () => this.fireEvening())
    this.jobs = [this.run, this.notify, this.evening, new Cron('30 3 * * *', opts, () => this.prune())].filter((j): j is Cron => j !== null)
  }

  today(): string {
    return localDate(this.ctx.now(), this.ctx.config.get().timezone)
  }

  tomorrow(): string {
    return addDays(this.today(), 1)
  }

  fireRun(): void {
    this.fire('morning', this.today())
  }

  fireEvening(): void {
    this.fire('evening', this.tomorrow())
  }

  private fire(phase: RunPhase, date: string): void {
    if (hasPhaseRun(this.ctx, date, phase)) return
    // Not configured is not a failure: a fresh install should not greet you with a failure brief.
    if (!this.ctx.config.get().llm.base_url) {
      this.ctx.log(`scheduled ${phase} run for ${date} skipped: no LLM endpoint configured (Settings → LLM)`)
      return
    }
    try {
      this.runner.start('scheduled', date, phase)
    } catch (err) {
      if (!(err instanceof RunBusy)) throw err
      this.ctx.log(`scheduled ${phase} run skipped: ${err.message}`)
    }
  }

  fireNotify(): void {
    this.notifier.notifyDue(this.today())
  }

  catchUp(): void {
    const cfg = this.ctx.config.get()
    const now = this.ctx.now()
    const date = this.today()
    const log = (what: string) => cfg.llm.base_url && this.ctx.log(`catch-up: ${what}, starting one`)
    if (cfg.morning_run && now >= atLocal(date, cfg.run_at, cfg.timezone) && !hasPhaseRun(this.ctx, date, 'morning')) {
      log(`no morning run yet for ${date}`)
      this.fireRun()
    }
    // Past evening_at, before midnight (the next day's evening_at is still to come).
    if (cfg.evening_at && now >= atLocal(date, cfg.evening_at, cfg.timezone) && !hasPhaseRun(this.ctx, this.tomorrow(), 'evening')) {
      log(`no evening preview yet for ${this.tomorrow()}`)
      this.fireEvening()
    }
    if (now >= atLocal(date, cfg.notify_at, cfg.timezone)) this.notifier.notifyDue(date)
  }

  /**
   * A run finished. An evening preview is notified at once (the alarm is set tonight); a morning
   * run whose notify time has already passed is notified now (a late brief).
   */
  onRunDone(runId: number): void {
    const run = getRun(this.ctx, runId)
    if (!run || run.kind === 'preview') return
    if (run.phase === 'evening') {
      this.notifier.notifyRun(runId)
      return
    }
    const cfg = this.ctx.config.get()
    if (this.ctx.now() >= atLocal(run.date, cfg.notify_at, cfg.timezone)) this.notifier.notifyDue(run.date)
  }

  info(): ScheduleInfo {
    const cfg = this.ctx.config.get()
    const active = this.runner.activeRunId()
    const run = active !== null ? getRun(this.ctx, active) : undefined
    return {
      timezone: cfg.timezone,
      runAt: cfg.run_at,
      notifyAt: cfg.notify_at,
      morningRun: cfg.morning_run,
      eveningAt: cfg.evening_at,
      nextRun: this.run?.nextRun()?.toISOString() ?? null,
      nextNotify: this.notify?.nextRun()?.toISOString() ?? null,
      nextEvening: this.evening?.nextRun()?.toISOString() ?? null,
      active: run ? toSummary(run) : null,
    }
  }
}
