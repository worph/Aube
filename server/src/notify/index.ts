import { schema } from '../db/index.js'
import { dayRunId, getRun, updateRun } from '../run/store.js'
import type { AppContext } from '../context.js'

/**
 * Delivery (ARCHITECTURE §8). In-app is always on: notifying a run marks it delivered, which is
 * what the Briefs page shows. Channels (web push, MCP add-ons) register themselves and are sent in
 * parallel; a failed channel is logged on the run and never changes the brief.
 */
export interface Channel {
  name: string
  /** Resolve 'skip' when there was nothing to send on this channel (not recorded). */
  send: (runId: number) => Promise<void | 'skip'>
}

export class Notifier {
  private channels: Channel[] = []
  private providers: Array<() => Channel[]> = []
  /** Resolves when the last notification's channels have settled (tests). */
  lastSend: Promise<void> = Promise.resolve()

  constructor(private readonly ctx: AppContext) {}

  addChannel(channel: Channel): void {
    this.channels.push(channel)
  }

  /** Channels resolved at send time (add-ons follow the config without a restart). */
  addProvider(provider: () => Channel[]): void {
    this.providers.push(provider)
  }

  /** Notify the day's brief of `date`, once. */
  notifyDue(date: string): boolean {
    const id = dayRunId(this.ctx, date)
    return id !== undefined && this.notifyRun(id)
  }

  /** Notify one run's brief unless already notified (or a preview). Returns true if it sent. */
  notifyRun(runId: number): boolean {
    const run = getRun(this.ctx, runId)
    if (!run || run.kind === 'preview' || run.notifiedAt) return false
    if (run.status !== 'READY' && run.status !== 'FAILED') return false
    const at = this.ctx.now().toISOString()
    updateRun(this.ctx, runId, { notifiedAt: at, ...(run.status === 'READY' ? { status: 'NOTIFIED' as const } : {}) })
    this.record(runId, 'in-app', null)
    this.lastSend = Promise.allSettled(
      [...this.channels, ...this.providers.flatMap((p) => p())].map((c) =>
        c.send(runId).then(
          (r) => r !== 'skip' && this.record(runId, c.name, null),
          (err: unknown) => {
            this.record(runId, c.name, err instanceof Error ? err.message : String(err))
            this.ctx.log(`notify #${runId} via ${c.name} failed: ${err instanceof Error ? err.message : err}`)
          },
        ),
      ),
    ).then(() => undefined)
    return true
  }

  private record(runId: number, channel: string, error: string | null) {
    this.ctx.db
      .insert(schema.notifySends)
      .values({ runId, channel, status: error ? 'failed' : 'ok', error, at: this.ctx.now().toISOString() })
      .run()
  }
}
