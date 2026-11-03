import { z } from 'zod'
import { AddonSchema } from '@aube/shared'
import { setupChecklist, chatStatus } from '../chat/status.js'
import { publicUrl } from '../config/public-url.js'
import { testAddon } from '../notify/addons.js'
import { referencedVars } from '../config/interpolate.js'
import { SecretRefused, secretSource, setSecret } from '../config/secrets.js'
import { briefView, getRun, listRuns, toSummary } from '../run/store.js'
import { defineTool, error, json, text } from './registry.js'

/**
 * Admin-only tools (ARCHITECTURE §6.4): served by the admin MCP endpoint, never by the chat (whose
 * pages already show these) nor by the run. They stand in for what the browser does without a model:
 * the Secrets form and the run log.
 */
export const adminTools = [
  defineTool({
    name: 'aube_status',
    title: 'Aube status',
    description:
      "What is set up and what is missing, in one call: the app's address (for the user to open it), LLM endpoint, schedule, endpoints, add-ons, push devices, master prompt, memory, last brief and run, and a setup checklist with the next step for each missing item. Call it before advising on setup or problems.",
    input: {},
    scope: ['admin'],
    writes: false,
    handler: async (_a, t) => {
      const checks = setupChecklist(t.ctx, t.svc)
      const url = publicUrl(t.ctx.config.get())
      return text(
        [
          `# Aube status`,
          url ? `App: ${url} (behind the box's login; Briefs page: ${url}/briefs)` : 'App address: unknown — set public_url',
          '',
          await chatStatus(t.ctx, t.svc),
          '',
          '## Setup checklist',
          ...checks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.label}${c.ok ? '' : ` — next: ${c.next}`}`),
        ].join('\n'),
      )
    },
  }),
  defineTool({
    name: 'secrets_list',
    title: 'List secrets',
    description: 'The ${VAR}s config.yaml references and where each value comes from (env, file, or unset). Never the values.',
    input: {},
    scope: ['admin'],
    writes: false,
    handler: async (_a, t) => json(referencedVars(t.ctx.config.raw()).map((name) => ({ name, source: secretSource(name) }))),
  }),
  defineTool({
    name: 'secret_set',
    title: 'Set a secret',
    description:
      'Set (or clear, with an empty value) one variable in data/secrets.env, e.g. LLM_API_KEY. Write-only: the value is never shown again. A variable set in the container environment cannot be changed here.',
    input: { name: z.string().min(1).max(100), value: z.string().max(4096) },
    scope: ['admin'],
    writes: true,
    handler: async ({ name, value }, t) => {
      try {
        setSecret(t.ctx.paths.secrets, name, value.trim())
        t.ctx.log(`secret ${name} ${value.trim() ? 'set' : 'cleared'} over the admin MCP endpoint`)
        return text(`${name} ${value.trim() ? 'set' : 'cleared'} (source: ${secretSource(name) ?? 'unset'}).`)
      } catch (err) {
        if (err instanceof SecretRefused) return error(err.message)
        throw err
      }
    },
  }),
  defineTool({
    name: 'run_list',
    title: 'List runs',
    description: 'Recent runs (nightly, manual, previews), newest first: id, date, kind, phase, status, duration, failure.',
    input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.number().int().min(1).max(50).optional() },
    scope: ['admin'],
    writes: false,
    handler: async ({ date, limit }, t) =>
      json(listRuns(t.ctx, date, limit ?? 10).map((r) => ({ id: r.id, date: r.date, kind: r.kind, phase: r.phase, status: r.status, startedAt: r.startedAt, durationMs: r.durationMs, failure: r.failureClass ? `${r.failureClass}: ${r.failureText ?? ''}` : null }))),
  }),
  defineTool({
    name: 'run_get',
    title: 'Read a run',
    description: 'One run (by id; the latest when omitted): its status and, once ready, the brief it produced — the way to read the result of run_preview.',
    input: { id: z.number().int().positive().optional() },
    scope: ['admin'],
    writes: false,
    handler: async ({ id }, t) => {
      const runId = id ?? listRuns(t.ctx, undefined, 1)[0]?.id
      const run = runId !== undefined ? getRun(t.ctx, runId) : undefined
      if (!run) return error(id ? `no run #${id}` : 'no run yet')
      const s = toSummary(run)
      const b = briefView(t.ctx, run.id)
      const head = `Run #${s.id} — ${s.kind}, ${s.phase}, ${s.date}: ${s.status}${s.durationMs ? ` in ${Math.round(s.durationMs / 1000)} s` : ''}${s.failureClass ? `\nfailure: ${s.failureClass} — ${s.failureText ?? ''}` : ''}`
      if (!b) return text(`${head}\n\n(no brief${t.svc.runner.inProgress().includes(s.id) ? ' yet: still running' : ''})`)
      const wake = b.wakeUp ? `\nrecommended wake-up: ${b.wakeUp.time}${b.wakeUp.reason ? ` (${b.wakeUp.reason})` : ''}` : ''
      return text(`${head}\n\n# ${b.title}\n${b.headline}${wake}\n\n${b.markdown}`)
    },
  }),
  defineTool({
    name: 'addon_test',
    title: 'Test a notification add-on',
    description:
      'Send a real test message through a notification add-on (e.g. Telegram): a configured one by name, or a candidate add-on object (shape in aube_guide topic settings) before saving it.',
    input: { name: z.string().optional(), addon: AddonSchema.optional() },
    scope: ['chat', 'admin'],
    writes: true,
    handler: async ({ name, addon }, t) => {
      const a = addon ?? (name ? t.ctx.config.raw().addons.find((x) => x.name === name) : undefined)
      if (!a) return error(name ? `no add-on named "${name}"` : 'give an add-on name or an add-on object')
      const r = await testAddon(t.ctx, a)
      return r.ok ? text(`Sent ${r.sent} test message(s) through "${a.name}" in ${r.ms} ms.`) : error(`"${a.name}" failed: ${r.error}`)
    },
  }),
]
