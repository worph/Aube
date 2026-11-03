import { missingVars } from '../config/interpolate.js'
import { currentPrompt } from '../prompt/store.js'
import { listBriefs } from '../run/store.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/** What the chat model is told about the install, rebuilt every round. */
export async function chatStatus(ctx: AppContext, svc: Services): Promise<string> {
  const raw = ctx.config.raw()
  const files = await svc.memory.list()
  const last = listBriefs(ctx, 1)[0]
  const sched = svc.scheduler.info()
  const lines = [
    `- LLM endpoint: ${raw.llm.base_url || 'NOT CONFIGURED — nothing can run until it is set and tested'}${raw.llm.model ? `, model ${raw.llm.model}` : ''}, tool mode ${raw.llm.tool_mode}`,
    `- Connections: ${Object.entries(raw.connections).map(([n, c]) => `${n} (${c.transport}${c.url ? ` ${c.url}` : ''}, via ${c.via})`).join('; ') || 'none'}`,
    `- Aube MCP endpoint: ${raw.mcp_endpoint.enabled ? 'enabled' : 'disabled (memory is read-only for the nightly run)'}`,
    `- Admin MCP endpoint (/mcp/admin, for another assistant): ${raw.admin_endpoint.enabled ? 'enabled' : 'disabled'}`,
    `- Schedule: prepared at ${raw.run_at}, notified at ${raw.notify_at} (${raw.timezone}); next run ${sched.nextRun ?? '?'}`,
    `- Master prompt: ${currentPrompt(ctx).body.length} characters, version #${currentPrompt(ctx).version.id}`,
    `- Memory: ${files.length} file(s): ${files.slice(0, 30).map((f) => f.path).join(', ')}`,
    `- Last brief: ${last ? `${last.date} — ${last.headline} (${last.shape})` : 'none yet'}`,
  ]
  const missing = missingVars(raw)
  if (missing.length) lines.push(`- Environment variables referenced but unset: ${missing.join(', ')}`)
  if (sched.active) lines.push(`- A run is in progress: #${sched.active.id} (${sched.active.kind})`)
  return lines.join('\n')
}
