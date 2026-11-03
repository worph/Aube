import { missingVars } from '../config/interpolate.js'
import { publicUrl } from '../config/public-url.js'
import { MASTER_PROMPT_TEMPLATE } from '../config/template.js'
import { currentPrompt } from '../prompt/store.js'
import { listBriefs, listRuns } from '../run/store.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

export interface CheckItem {
  ok: boolean
  label: string
  /** What to do when it is not done: the tool to call, or the step in the app. */
  next: string
}

/** The setup checklist (aube_guide topic getting-started), shared by the chat status and aube_status. */
export function setupChecklist(ctx: AppContext, svc: Services): CheckItem[] {
  const raw = ctx.config.raw()
  const missing = missingVars(raw)
  const runs = listRuns(ctx, undefined, 50)
  return [
    {
      ok: !!raw.llm.base_url && !!raw.llm.model,
      label: 'LLM endpoint and model configured',
      next: 'settings_save {"llm":{"base_url":"http://…/v1","model":"…"}}, then llm_test',
    },
    { ok: missing.length === 0, label: 'every referenced secret has a value', next: `secret_set for: ${missing.join(', ')}` },
    {
      ok: currentPrompt(ctx).body.trim() !== MASTER_PROMPT_TEMPLATE.trim(),
      label: 'master prompt written (not the default template)',
      next: 'prompt_save the full text (aube_guide topic master-prompt)',
    },
    {
      ok: raw.mcp_endpoint.enabled || raw.llm.tool_mode === 'aube',
      label: 'memory tools reachable by the nightly run',
      next: 'settings_save {"mcp_endpoint":{"enabled":true}}',
    },
    {
      ok: runs.some((r) => r.status === 'READY' || r.status === 'NOTIFIED'),
      label: 'at least one brief produced',
      next: 'run_preview, then run_get after 1–5 minutes',
    },
    {
      ok: svc.push.count() > 0,
      label: `phone/browser notifications (${svc.push.count()} device(s) subscribed)`,
      next: 'open the app on the device → Briefs → enable notifications (aube_guide topic notifications)',
    },
    { ok: !!publicUrl(ctx.config.get()), label: "the app's address is known", next: 'settings_save {"public_url":"https://aube-…"}' },
  ]
}

/** What the chat model (and aube_status) is told about the install, rebuilt every call. */
export async function chatStatus(ctx: AppContext, svc: Services): Promise<string> {
  const raw = ctx.config.raw()
  const files = await svc.memory.list()
  const last = listBriefs(ctx, 1)[0]
  const lastRun = listRuns(ctx, undefined, 1)[0]
  const sched = svc.scheduler.info()
  const url = publicUrl(ctx.config.get())
  const lines = [
    `- App address: ${url || 'unknown (public_url is not set)'}`,
    `- LLM endpoint: ${raw.llm.base_url || 'NOT CONFIGURED — nothing can run until it is set and tested'}${raw.llm.model ? `, model ${raw.llm.model}` : ''}, tool mode ${raw.llm.tool_mode}`,
    `- Connections: ${Object.entries(raw.connections).map(([n, c]) => `${n} (${c.transport}${c.url ? ` ${c.url}` : ''}, via ${c.via})`).join('; ') || 'none'}`,
    `- Aube MCP endpoint: ${raw.mcp_endpoint.enabled ? 'enabled' : 'disabled (memory is read-only for the nightly run)'}`,
    `- Admin MCP endpoint (/mcp/admin, for another assistant): ${raw.admin_endpoint.enabled ? 'enabled' : 'disabled'}`,
    `- Schedule: ${raw.morning_run ? `prepared at ${raw.run_at}, notified at ${raw.notify_at}` : 'morning run off'}; evening preview ${raw.evening_at ? `at ${raw.evening_at}` : 'off'} (${raw.timezone}); next run ${sched.nextRun ?? '?'}`,
    `- Notification add-ons: ${raw.addons.map((a) => `${a.name}${a.enabled ? '' : ' (off)'}`).join(', ') || 'none'}; push devices: ${svc.push.count()}`,
    `- Master prompt: ${currentPrompt(ctx).body.length} characters, version #${currentPrompt(ctx).version.id}`,
    `- Memory: ${files.length} file(s): ${files.slice(0, 30).map((f) => f.path).join(', ')}`,
    `- Last brief: ${last ? `${last.date} — ${last.headline} (${last.shape})` : 'none yet'}`,
    `- Last run: ${lastRun ? `#${lastRun.id} ${lastRun.kind} ${lastRun.phase} ${lastRun.date}: ${lastRun.status}${lastRun.failureClass ? ` (${lastRun.failureClass})` : ''}` : 'none yet'}`,
  ]
  const missing = missingVars(raw)
  if (missing.length) lines.push(`- Environment variables referenced but unset: ${missing.join(', ')}`)
  if (sched.active) lines.push(`- A run is in progress: #${sched.active.id} (${sched.active.kind})`)
  const todo = setupChecklist(ctx, svc).filter((c) => !c.ok)
  lines.push(`- Setup: ${todo.length ? `still to do: ${todo.map((c) => c.label).join('; ')}` : 'complete'}`)
  return lines.join('\n')
}
