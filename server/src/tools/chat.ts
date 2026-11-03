import { z } from 'zod'
import { ConnectionSchema, type AubeConfig } from '@aube/shared'
import { validate } from '../config/store.js'
import { interpolate, missingVars } from '../config/interpolate.js'
import { complete } from '../llm/client.js'
import { probe } from '../llm/client.js'
import { discoverCatalogue, listTools, looksLikeBeacon } from '../mcp/client.js'
import { currentPrompt, listPromptVersions, savePrompt } from '../prompt/store.js'
import { RunBusy } from '../run/runner.js'
import { defineTool, error, json, text } from './registry.js'

/** Chat tools (ARCHITECTURE §6.4): also served by the admin MCP endpoint; never by the run's endpoint or tool loop. */

export function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === null) return undefined
  if (!isObj(base) || !isObj(patch)) return patch
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    const merged = deepMerge(base[k], v)
    if (merged === undefined) delete out[k]
    else out[k] = merged
  }
  return out
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Changed leaves between two configs, `path: before → after`. */
export function configChanges(before: unknown, after: unknown, at = ''): string[] {
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    return [...keys].flatMap((k) => configChanges(before[k], after[k], at ? `${at}.${k}` : k))
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [`${at}: ${JSON.stringify(before) ?? '(unset)'} → ${JSON.stringify(after) ?? '(removed)'}`]
}

function lineSummary(before: string, after: string): string {
  const a = new Set(before.split('\n'))
  const b = new Set(after.split('\n'))
  const removed = before.split('\n').filter((l) => !b.has(l) && l.trim())
  const added = after.split('\n').filter((l) => !a.has(l) && l.trim())
  return [...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].join('\n') || '(no change)'
}

export const chatTools = [
  defineTool({
    name: 'prompt_get',
    title: 'Read the master prompt',
    description: 'The current master prompt (what goes into the brief) and its version id.',
    input: {},
    scope: ['chat'],
    writes: false,
    handler: async (_a, t) => {
      const p = currentPrompt(t.ctx)
      return text(`Version #${p.version.id}:\n\n${p.body}`)
    },
  }),
  defineTool({
    name: 'prompt_versions',
    title: 'Master prompt history',
    description: 'Saved versions of the master prompt: id, when, by whom, note.',
    input: {},
    scope: ['chat'],
    writes: false,
    handler: async (_a, t) => json(listPromptVersions(t.ctx, 20).map(({ body: _b, ...v }) => v)),
  }),
  defineTool({
    name: 'prompt_save',
    title: 'Save the master prompt',
    description: 'Replace the master prompt with a new full text, saved as a new version (the old one stays in history). The user confirms after seeing the change.',
    input: { body: z.string().min(1).max(100_000), note: z.string().max(200).optional() },
    scope: ['chat'],
    writes: true,
    confirm: ({ body }, t) => `Save the master prompt as a new version:\n\n${lineSummary(currentPrompt(t.ctx).body, body)}`,
    handler: async ({ body, note }, t) => {
      const v = savePrompt(t.ctx, body, t.by.startsWith('mcp:') ? 'mcp' : 'chat', note)
      return text(`Saved as version #${v.id}. The next run uses it.`)
    },
  }),
  defineTool({
    name: 'settings_get',
    title: 'Read the settings',
    description: 'The current configuration (secrets appear as ${VAR} references) and the environment variables it references that are unset.',
    input: {},
    scope: ['chat'],
    writes: false,
    handler: async (_a, t) => {
      const raw = t.ctx.config.raw()
      return json({ config: raw, missingVars: missingVars(raw) })
    },
  }),
  defineTool({
    name: 'settings_save',
    title: 'Change settings',
    description:
      'Change the configuration with a partial object merged into the current one (null removes a key). Example: {"llm":{"base_url":"http://claude-code:9091/v1","model":"sonnet"}}. Secrets must be ${VAR} references. Validated before it is offered; the user confirms.',
    input: { patch: z.record(z.unknown()) },
    scope: ['chat'],
    writes: true,
    confirm: ({ patch }, t) => {
      const before = t.ctx.config.raw()
      const next = validate(deepMerge(before, patch))
      return `Change these settings:\n\n${configChanges(before, next).join('\n') || '(no change)'}`
    },
    handler: async ({ patch }, t) => {
      const before = t.ctx.config.raw()
      const saved = await t.ctx.config.save(deepMerge(before, patch))
      return text(`Saved:\n${configChanges(before, saved).join('\n') || '(no change)'}`)
    },
  }),
  defineTool({
    name: 'llm_test',
    title: 'Test the LLM endpoint',
    description: 'Probe the configured LLM endpoint (or a candidate given as a partial llm object): list models, then a one-word completion.',
    input: { llm: z.record(z.unknown()).optional() },
    scope: ['chat'],
    writes: false,
    handler: async ({ llm }, t) => {
      const l = interpolate({ ...t.ctx.config.raw().llm, ...(llm ?? {}) } as AubeConfig['llm'])
      return json(await probe({ baseUrl: l.base_url, apiKey: l.api_key, model: l.model, timeoutS: Math.min(l.timeout_s, 60), extraBody: l.extra_body }))
    },
  }),
  defineTool({
    name: 'connection_test',
    title: 'Test an MCP connection',
    description: 'Probe an MCP connection: a configured one by name, or a candidate {transport, url, via}. Lists its tools and says whether it is a Beacon.',
    input: { name: z.string().optional(), connection: ConnectionSchema.optional() },
    scope: ['chat'],
    writes: false,
    handler: async ({ name, connection }, t) => {
      const conn = connection ?? (name ? t.ctx.config.raw().connections[name] : undefined)
      if (!conn) return error(name ? `no connection named "${name}"` : 'give a connection name or a connection object')
      const tools = await listTools(interpolate(conn))
      return json({ ok: true, beacon: looksLikeBeacon(tools), tools: tools.map((x) => x.name) })
    },
  }),
  defineTool({
    name: 'beacon_discover',
    title: 'Discover a Beacon',
    description: 'List the servers and tools behind a Beacon (a configured connection by name, or a candidate connection).',
    input: { name: z.string().optional(), connection: ConnectionSchema.optional() },
    scope: ['chat'],
    writes: false,
    handler: async ({ name, connection }, t) => {
      const conn = connection ?? (name ? t.ctx.config.raw().connections[name] : undefined)
      if (!conn) return error(name ? `no connection named "${name}"` : 'give a connection name or a connection object')
      const cat = await discoverCatalogue(interpolate(conn))
      return text(cat.servers.map((s) => `## ${s.name}\n${s.tools.map((x) => `- ${x.name}${x.description ? ` — ${x.description.slice(0, 120)}` : ''}`).join('\n')}`).join('\n\n'))
    },
  }),
  defineTool({
    name: 'backend_ask',
    title: 'Ask the nightly backend',
    description:
      'Send one plain question to the LLM backend that prepares the brief, with its own tools available (e.g. "Which MCP tools can you use? List them."). Its answer is its own description, not a guarantee.',
    input: { question: z.string().min(1).max(4000) },
    scope: ['chat'],
    writes: false,
    handler: async ({ question }, t) => {
      const llm = t.ctx.config.get().llm
      const c = await complete({ baseUrl: llm.base_url, apiKey: llm.api_key, model: llm.model, timeoutS: 90, extraBody: llm.extra_body }, [{ role: 'user', content: question }])
      return text(c.content)
    },
  }),
  defineTool({
    name: 'run_preview',
    title: 'Preview the brief',
    description:
      "Start a preview run now (does not notify, does not replace the day's brief). phase 'evening' previews tomorrow's evening run (with the wake-up time). Returns at once; the result appears on the Master prompt page.",
    input: { phase: z.enum(['morning', 'evening']).optional() },
    scope: ['chat'],
    writes: false,
    handler: async (a, t) =>
      text(`Preview run #${t.svc.runner.start('preview', undefined, a.phase ?? 'morning')} started. It can take several minutes; open the Master prompt page to see it.`),
  }),
  defineTool({
    name: 'run_now',
    title: 'Run the brief now',
    description:
      "Run today's brief now (phase 'morning', the default; it replaces today's brief and notifies if the notify time has passed), or prepare tomorrow's evening preview now (phase 'evening'; notified when ready).",
    input: { phase: z.enum(['morning', 'evening']).optional() },
    scope: ['chat'],
    writes: true,
    confirm: (a) =>
      a.phase === 'evening'
        ? "Prepare tomorrow's evening preview now? You are notified when it is ready."
        : "Run today's brief now? It replaces today's brief and notifies you if the notify time has already passed.",
    handler: async (a, t) => {
      try {
        return text(`Run #${t.svc.runner.start('manual', undefined, a.phase ?? 'morning')} started. It appears on the Briefs page when ready.`)
      } catch (err) {
        if (err instanceof RunBusy) return error(err.message)
        throw err
      }
    },
  }),
]
