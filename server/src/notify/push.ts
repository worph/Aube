import { publicUrl } from '../config/public-url.js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import webpush from 'web-push'
import { schema } from '../db/index.js'
import { getRun } from '../run/store.js'
import type { AppContext } from '../context.js'
import type { Channel } from './index.js'

/**
 * Web push (ARCHITECTURE §8). VAPID keys are generated on first use into `data/vapid.json`
 * (Touchstone's `services/push.ts`); subscriptions are rows; a 404/410 (or 401/403) from the push
 * service prunes the subscription (Newsdesk's `notifyAll`).
 */
export interface PushPayload {
  title: string
  body: string
  url: string
}

export class PushService {
  private keys: { publicKey: string; privateKey: string } | null = null

  constructor(private readonly ctx: AppContext) {}

  vapid(): { publicKey: string; privateKey: string } {
    if (this.keys) return this.keys
    const file = this.ctx.paths.vapid
    if (existsSync(file)) {
      this.keys = JSON.parse(readFileSync(file, 'utf8'))
    } else {
      this.keys = webpush.generateVAPIDKeys()
      writeFileSync(file, JSON.stringify(this.keys, null, 2), { mode: 0o600 })
    }
    return this.keys!
  }

  publicKey(): string {
    return this.vapid().publicKey
  }

  subscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): void {
    this.ctx.db
      .insert(schema.pushSubs)
      .values({ endpoint: sub.endpoint, keysJson: JSON.stringify(sub.keys), userAgent: userAgent ?? null, createdAt: this.ctx.now().toISOString() })
      .onConflictDoUpdate({ target: schema.pushSubs.endpoint, set: { keysJson: JSON.stringify(sub.keys), userAgent: userAgent ?? null } })
      .run()
  }

  unsubscribe(endpoint: string): void {
    this.ctx.db.delete(schema.pushSubs).where(eq(schema.pushSubs.endpoint, endpoint)).run()
  }

  count(): number {
    return this.ctx.db.select().from(schema.pushSubs).all().length
  }

  has(endpoint: string): boolean {
    return !!this.ctx.db.select().from(schema.pushSubs).where(eq(schema.pushSubs.endpoint, endpoint)).get()
  }

  /** Send to every subscription (or one). Returns how many were delivered and pruned. */
  async send(payload: PushPayload, only?: string): Promise<{ sent: number; pruned: number; failed: string[] }> {
    const { publicKey, privateKey } = this.vapid()
    const cfg = this.ctx.config.get()
    const subject = publicUrl(cfg).startsWith('https://') ? publicUrl(cfg) : 'mailto:aube@localhost'
    const subs = this.ctx.db.select().from(schema.pushSubs).all().filter((s) => !only || s.endpoint === only)
    let sent = 0
    let pruned = 0
    const failed: string[] = []
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keysJson) }, JSON.stringify(payload), {
            vapidDetails: { subject, publicKey, privateKey },
            TTL: 12 * 3600,
          })
          sent++
          this.ctx.db.update(schema.pushSubs).set({ lastOkAt: this.ctx.now().toISOString() }).where(eq(schema.pushSubs.endpoint, s.endpoint)).run()
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410 || status === 401 || status === 403) {
            this.unsubscribe(s.endpoint)
            pruned++
          } else failed.push(`${new URL(s.endpoint).host}: ${status ?? ''} ${(err as Error).message}`.trim())
        }
      }),
    )
    return { sent, pruned, failed }
  }

  /** The push channel of the notifier. */
  channel(): Channel {
    return {
      name: 'push',
      send: async (runId) => {
        if (this.count() === 0) return 'skip'
        const run = getRun(this.ctx, runId)
        const brief = this.ctx.db.select().from(schema.briefs).where(eq(schema.briefs.runId, runId)).get()
        if (!run || !brief) return 'skip'
        const r = await this.send({ title: brief.title, body: brief.headline, url: `/briefs/${brief.date}` })
        if (r.sent === 0 && r.failed.length) throw new Error(r.failed.join('; '))
        return undefined
      },
    }
  }
}
