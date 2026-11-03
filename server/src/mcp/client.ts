import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Connection } from '@aube/shared'

/**
 * The MCP client every outward call goes through: Settings probes, add-ons, and the tool loop of
 * tool mode `aube`.
 *
 * Ported from Newsdesk `server/src/ports/mcp/client.ts` (connection per call, error
 * classification, Beacon discovery), with Touchstone's `services/mcp.ts` envelope for
 * `via: beacon` connections — `call {tool_name, arguments}` plus `__beacon_timeout` — and two
 * additions: stdio transport, and image content blocks kept rather than dropped (memory images).
 *
 * Connections are opened per call and closed after. Aube makes a handful of calls a night; a
 * stale pooled session failing on the one call that mattered is the worse trade.
 */

export interface NamedConnection extends Connection {
  name: string
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'McpError'
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

export function classifyError(err: unknown): McpError {
  if (err instanceof McpError) return err
  const message = err instanceof Error ? err.message : String(err)
  const status = Number(/\b(4\d\d|5\d\d)\b/.exec(message)?.[1] ?? Number.NaN)
  if (!Number.isNaN(status)) return new McpError(message, RETRYABLE_STATUS.has(status), status)
  const lowered = message.toLowerCase()
  const transport = ['timed out', 'timeout', 'aborted', 'econnreset', 'econnrefused', 'socket hang up', 'fetch failed', 'enotfound'].some(
    (k) => lowered.includes(k),
  )
  return new McpError(message, transport)
}

function transportFor(conn: Connection): Transport {
  if (conn.transport === 'stdio') {
    return new StdioClientTransport({
      command: conn.command!,
      args: conn.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(conn.env ?? {}) },
      stderr: 'ignore',
    })
  }
  const headers = conn.headers ?? {}
  return new StreamableHTTPClientTransport(new URL(conn.url!), {
    ...(Object.keys(headers).length ? { requestInit: { headers } } : {}),
  })
}

export async function withClient<T>(conn: Connection, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'aube', version: '0.1.0' })
  try {
    await client.connect(transportFor(conn))
    return await fn(client)
  } catch (err) {
    throw classifyError(err)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface ToolResult {
  /** All text blocks, joined. */
  text: string
  /** Every text and image block, in order. */
  content: ContentBlock[]
}

function blocksOf(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return []
  const out: ContentBlock[] = []
  for (const b of content as Array<Record<string, unknown>>) {
    if (b.type === 'text' && typeof b.text === 'string') out.push({ type: 'text', text: b.text })
    else if (b.type === 'image' && typeof b.data === 'string')
      out.push({ type: 'image', data: b.data, mimeType: String(b.mimeType ?? 'image/png') })
  }
  return out
}

export interface CallOptions {
  timeoutMs?: number
}

/**
 * Call `tool` on a connection. For `via: beacon`, `tool` is the namespaced `server__tool` name and
 * the call goes through Beacon's `call` meta-tool, with the timeout passed on as
 * `__beacon_timeout` so Beacon does not cut a slow tool short before we do.
 */
export async function callTool(
  conn: Connection,
  tool: string,
  args: Record<string, unknown>,
  options: CallOptions = {},
): Promise<ToolResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const [name, callArgs] =
    conn.via === 'beacon' && !BEACON_META.has(tool)
      ? ['call', { tool_name: tool, arguments: { ...args, __beacon_timeout: Math.ceil(timeoutMs / 1000) } }]
      : [tool, args]
  return withClient(conn, async (client) => {
    const result = await client.callTool({ name, arguments: callArgs }, undefined, { timeout: timeoutMs + 5_000 })
    const content = blocksOf(result.content)
    const text = content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (result.isError) throw new McpError(text || `tool "${tool}" reported an error`, false)
    return { text, content }
  })
}

export interface DiscoveredTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export async function listTools(conn: Connection): Promise<DiscoveredTool[]> {
  return withClient(conn, async (client) => {
    const { tools } = await client.listTools()
    return tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    }))
  })
}

/** Beacon's own tools. It does not advertise the tools it aggregates in `tools/list`. */
const BEACON_META = new Set(['overview', 'tool_doc', 'server_doc', 'call'])

export function looksLikeBeacon(tools: DiscoveredTool[]): boolean {
  const names = new Set(tools.map((t) => t.name))
  return ['overview', 'server_doc', 'call'].every((n) => names.has(n))
}

/** `## server-name` headings of Beacon's markdown `overview`. */
export function parseOverviewServers(text: string): string[] {
  const names: string[] = []
  for (const line of text.split('\n')) {
    const m = /^##\s+(\S+)\s*$/.exec(line)
    if (m?.[1]) names.push(m[1])
  }
  return names
}

/** `- server__tool — description` lines of Beacon's `overview`, grouped by `## server`. */
export function parseOverviewTools(text: string): Array<{ name: string; tools: DiscoveredTool[] }> {
  const servers: Array<{ name: string; tools: DiscoveredTool[] }> = []
  for (const line of text.split('\n')) {
    const head = /^##\s+(\S+)\s*$/.exec(line)
    if (head?.[1]) {
      servers.push({ name: head[1], tools: [] })
      continue
    }
    const item = /^-\s+(\S+)\s+—\s*(.*)$/.exec(line)
    if (item?.[1] && servers.length) {
      servers[servers.length - 1]!.tools.push({ name: item[1], ...(item[2] ? { description: item[2] } : {}) })
    }
  }
  return servers
}

export interface Catalogue {
  kind: 'beacon' | 'plain'
  servers: Array<{ name: string; tools: DiscoveredTool[] }>
  discoveredAt: string
}

/** What a connection offers: server → tools. For a Beacon, read through `overview`. */
export async function discoverCatalogue(conn: Connection): Promise<Catalogue> {
  const top = await listTools(conn)
  const discoveredAt = new Date().toISOString()
  if (!looksLikeBeacon(top)) {
    return { kind: 'plain', servers: [{ name: '(direct)', tools: top }], discoveredAt }
  }
  const overview = await callTool({ ...conn, via: 'direct' }, 'overview', {}, { timeoutMs: 30_000 })
  return { kind: 'beacon', servers: parseOverviewTools(overview.text), discoveredAt }
}

/** `server__tool` → `server`. */
export function serverOf(toolName: string): string | undefined {
  const i = toolName.indexOf('__')
  return i > 0 ? toolName.slice(0, i) : undefined
}
