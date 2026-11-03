import { publicUrl } from '../config/public-url.js'
import { eq } from 'drizzle-orm'
import type { Addon, AubeConfig } from '@aube/shared'
import { schema } from '../db/index.js'
import { callTool, McpError } from '../mcp/client.js'
import { fillArgs, LIMITS, notifyHeadline, render, split, escapeTelegram, toPlain } from './render.js'
import type { AppContext } from '../context.js'
import type { Channel } from './index.js'

/**
 * Notification add-ons (ARCHITECTURE §8): an MCP tool call per message, e.g.
 * `telegram-mcp__send_message`. Send-only; a failure is logged on the run and never touches the brief.
 */
export interface BriefText {
  title: string
  headline: string
  markdown: string
  date: string
}

export function messagesFor(addon: Addon, b: BriefText, cfg: AubeConfig): string[] {
  const url = publicUrl(cfg) ? `${publicUrl(cfg)}/briefs/${b.date}` : ''
  const fmt = addon.format
  if (addon.mode === 'headline') {
    const lines = fmt === 'telegram-markdown' ? [`*${escapeTelegram(b.title)}*`, escapeTelegram(b.headline), ...(url ? [escapeTelegram(url)] : [])] : [b.title, b.headline, ...(url ? [url] : [])]
    return [lines.join('\n')]
  }
  const head = fmt === 'telegram-markdown' ? `*${escapeTelegram(b.title)}*` : toPlain(b.title)
  const tail = url ? `\n\n${fmt === 'telegram-markdown' ? escapeTelegram(url) : url}` : ''
  return split(`${head}\n\n${render(b.markdown, fmt)}${tail}`, LIMITS[fmt])
}

export async function sendAddon(ctx: AppContext, addon: Addon, b: BriefText): Promise<number> {
  const cfg = ctx.config.get()
  const conn = cfg.connections[addon.connection]
  if (!conn) throw new McpError(`add-on "${addon.name}": no connection named "${addon.connection}"`, false)
  const url = publicUrl(cfg) ? `${publicUrl(cfg)}/briefs/${b.date}` : ''
  const msgs = messagesFor(addon, b, cfg)
  for (const content of msgs) {
    const args = fillArgs(addon.args, { content, headline: b.headline, title: b.title, url, date: b.date }) as Record<string, unknown>
    await callTool(conn, addon.tool, args, { timeoutMs: 30_000 })
  }
  return msgs.length
}

/** One channel per enabled add-on, read from the config at send time. */
export function addonChannels(ctx: AppContext): Channel[] {
  return ctx.config
    .get()
    .addons.filter((a) => a.enabled)
    .map((addon) => ({
      name: `addon:${addon.name}`,
      send: async (runId: number) => {
        const brief = ctx.db.select().from(schema.briefs).where(eq(schema.briefs.runId, runId)).get()
        if (!brief) return 'skip' as const
        await sendAddon(ctx, addon, { ...brief, headline: notifyHeadline(brief) })
        return undefined
      },
    }))
}
