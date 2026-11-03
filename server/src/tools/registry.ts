import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ContentBlock } from '../mcp/client.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/**
 * Aube's toolset, defined once (ARCHITECTURE §6.3, invariant 5). Four surfaces render it — the MCP
 * endpoint (`run` scope), the administrator chat (`chat` scope), the admin MCP endpoint (`admin`
 * scope: every `chat` tool plus the few marked `admin`) and the function-calling loop of tool mode
 * `aube` (`run` scope). The interface follows Newsdesk's `admin/registry.ts`, with
 * Touchstone's `writes` flag and an explicit scope instead of `chatOnly`.
 */

export type Scope = 'run' | 'chat' | 'admin'

export interface ToolContext {
  ctx: AppContext
  svc: Services
  /** Who is calling, for the memory journal: `run:<id>`, `chat:<thread>`, `mcp:unknown`, `mcp:admin`. */
  by: string
  runId: number | null
}

export interface ToolResult {
  content: ContentBlock[]
  isError?: boolean
}

export interface AubeTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string
  title: string
  description: string
  input: S
  scope: Scope[]
  writes: boolean
  /**
   * Chat only: a write that must be confirmed by the operator. Returns the summary (or diff) shown
   * on the confirmation card; the tool runs only after the operator confirms.
   */
  confirm?: (args: z.infer<z.ZodObject<S>>, t: ToolContext) => Promise<string> | string
  handler: (args: z.infer<z.ZodObject<S>>, t: ToolContext) => Promise<ToolResult>
}

export function defineTool<S extends z.ZodRawShape>(tool: AubeTool<S>): AubeTool {
  return tool as unknown as AubeTool
}

const registry: AubeTool[] = []

export function registerTools(tools: AubeTool[]): void {
  for (const t of tools) {
    if (registry.some((r) => r.name === t.name)) continue
    registry.push(t)
  }
}

/** `admin` is a superset: whatever the chat may do, plus tools that make sense only without a UI. */
export function toolsFor(scope: Scope): AubeTool[] {
  if (scope === 'admin') return registry.filter((t) => t.scope.includes('chat') || t.scope.includes('admin'))
  return registry.filter((t) => t.scope.includes(scope))
}

export function findTool(name: string, scope: Scope): AubeTool | undefined {
  return toolsFor(scope).find((t) => t.name === name)
}

export const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] })
export const json = (v: unknown): ToolResult => text(JSON.stringify(v, null, 2))
export const error = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }], isError: true })

/** Validate arguments and run a tool. Errors become tool errors, never exceptions. */
export async function runTool(tool: AubeTool, args: unknown, t: ToolContext): Promise<ToolResult> {
  const parsed = z.object(tool.input).strict().safeParse(args ?? {})
  if (!parsed.success) return error(`invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  try {
    return await tool.handler(parsed.data, t)
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err))
  }
}

export function validateArgs(tool: AubeTool, args: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const parsed = z.object(tool.input).strict().safeParse(args ?? {})
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }
}

export function jsonSchemaOf(tool: AubeTool): Record<string, unknown> {
  const { $schema: _s, ...schema } = zodToJsonSchema(z.object(tool.input)) as Record<string, unknown>
  return schema
}

/** All text of a result, for the chat transcript and the LLM tool loop. Images are summarised. */
export function resultText(r: ToolResult): string {
  return r.content.map((b) => (b.type === 'text' ? b.text : `[image ${b.mimeType}, ${Math.round((b.data.length * 3) / 4 / 1024)} KB]`)).join('\n')
}
