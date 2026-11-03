import { z } from 'zod'

/**
 * The shape of `data/config.yaml` (IMPLEMENTATION §3).
 *
 * Shared because the Settings page edits the same object the server validates. Secrets are never
 * literal: a field listed in `SECRET_PATHS` must be empty or hold a `${VAR}` reference, resolved
 * from the environment at use time (ARCHITECTURE §9, invariant "secrets don't round-trip").
 */

export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24h)')

export const ConnectionSchema = z
  .object({
    transport: z.enum(['http', 'stdio']).default('http'),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    /** `beacon`: tools are namespaced `server__tool` and called through Beacon's `call` meta-tool. */
    via: z.enum(['direct', 'beacon']).default('direct'),
  })
  .superRefine((c, ctx) => {
    if (c.transport === 'http' && !c.url) ctx.addIssue({ code: 'custom', message: 'http connection needs a url', path: ['url'] })
    if (c.transport === 'stdio' && !c.command)
      ctx.addIssue({ code: 'custom', message: 'stdio connection needs a command', path: ['command'] })
  })
export type Connection = z.infer<typeof ConnectionSchema>

export const AddonSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  connection: z.string().min(1),
  tool: z.string().min(1),
  mode: z.enum(['headline', 'full']).default('headline'),
  format: z.enum(['telegram-markdown', 'plain']).default('plain'),
  args: z.record(z.unknown()).default({}),
})
export type Addon = z.infer<typeof AddonSchema>

export const ConfigSchema = z.object({
  timezone: z.string().default('Europe/Paris'),
  run_at: HHMM.default('05:00'),
  notify_at: HHMM.default('07:00'),
  public_url: z.string().optional(),
  llm: z
    .object({
      base_url: z.string().default(''),
      api_key: z.string().default(''),
      model: z.string().default(''),
      tool_mode: z.enum(['backend', 'aube']).default('backend'),
      timeout_s: z.number().int().positive().default(1800),
      extra_body: z.record(z.unknown()).default({}),
      tool_connections: z.array(z.string()).default([]),
      max_tool_rounds: z.number().int().positive().default(30),
    })
    .default({}),
  connections: z.record(ConnectionSchema).default({}),
  mcp_endpoint: z
    .object({
      enabled: z.boolean().default(false),
      token: z.string().default(''),
    })
    .default({}),
  memory: z
    .object({
      max_file_kb: z.number().int().positive().default(256),
      max_image_kb: z.number().int().positive().default(2048),
      max_total_mb: z.number().int().positive().default(50),
    })
    .default({}),
  retention: z.object({ artifact_days: z.number().int().positive().default(30) }).default({}),
  addons: z.array(AddonSchema).default([]),
})
export type AubeConfig = z.infer<typeof ConfigSchema>

/**
 * Fields that hold credentials. `*` matches any key at that level. A value there must be empty or
 * contain a `${VAR}` reference — a literal secret is refused at save time.
 */
export const SECRET_PATHS: string[][] = [
  ['llm', 'api_key'],
  ['mcp_endpoint', 'token'],
  ['connections', '*', 'headers', '*'],
  ['connections', '*', 'env', '*'],
]

const REF = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/

/** Paths (dotted) whose value is a literal secret, i.e. non-empty without a `${VAR}` reference. */
export function literalSecrets(cfg: unknown): string[] {
  const found: string[] = []
  const walk = (node: unknown, pattern: string[], at: string[]) => {
    if (pattern.length === 0) {
      if (typeof node === 'string' && node !== '' && !REF.test(node)) found.push(at.join('.'))
      return
    }
    if (!node || typeof node !== 'object') return
    const [head, ...rest] = pattern
    const keys = head === '*' ? Object.keys(node) : [head!]
    for (const k of keys) walk((node as Record<string, unknown>)[k], rest, [...at, k])
  }
  for (const p of SECRET_PATHS) walk(cfg, p, [])
  return found
}

/** Template variables available to add-on args. */
export const ADDON_VARS = ['content', 'headline', 'title', 'url', 'date'] as const
