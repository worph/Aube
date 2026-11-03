import type { AubeConfig, Connection } from '@aube/shared'
import { interpolate } from '../config/interpolate.js'
import { callTool, listTools, looksLikeBeacon, parseOverviewServers, type DiscoveredTool } from '../mcp/client.js'
import { addArtifact } from '../run/store.js'
import type { ToolLoop } from '../run/runner.js'
import { jsonSchemaOf, resultText, runTool, toolsFor, type AubeTool } from '../tools/index.js'
import { complete, type ChatMessage, type Completion, type ToolDef } from './client.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/**
 * Tool mode `aube` (ARCHITECTURE §6.3, IMPLEMENTATION §8.2): for a plain model with no tools of its
 * own, Aube offers its run toolset plus the tools of the connections listed in
 * `llm.tool_connections`, runs every call the model makes, and loops until the model answers
 * without calling a tool (or the round budget runs out). Every call lands in the run's tool trace,
 * which is the visibility the `backend` mode cannot give.
 */

const RESULT_CHARS = 20_000

type Target = { kind: 'aube'; tool: AubeTool } | { kind: 'mcp'; conn: Connection; connName: string; tool: string }

export interface TraceEntry {
  round: number
  name: string
  args: unknown
  ok: boolean
  result: string
  ms: number
}

/** OpenAI function names must match ^[a-zA-Z0-9_-]{1,64}$. */
export function functionName(raw: string, taken: Set<string>): string {
  let base = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 60)}_${i}`
  taken.add(name)
  return name
}

/** Tools of one connection, with schemas. Behind a Beacon they come from `server_doc` per server. */
export async function connectionTools(conn: Connection): Promise<Array<DiscoveredTool & { callName: string }>> {
  const top = await listTools(conn)
  if (!looksLikeBeacon(top)) return top.map((t) => ({ ...t, callName: t.name }))
  const direct = { ...conn, via: 'direct' as const }
  const overview = await callTool(direct, 'overview', {}, { timeoutMs: 30_000 })
  const out: Array<DiscoveredTool & { callName: string }> = []
  for (const server of parseOverviewServers(overview.text)) {
    try {
      const doc = JSON.parse((await callTool(direct, 'server_doc', { server_name: server }, { timeoutMs: 30_000 })).text) as {
        tools?: Array<{ name?: string; description?: string; inputSchema?: unknown }>
      }
      for (const t of doc.tools ?? []) {
        if (!t.name) continue
        // server_doc may list bare or namespaced names; Beacon routes the namespaced one.
        const callName = t.name.includes('__') ? t.name : `${server}__${t.name}`
        out.push({ name: callName, callName, ...(t.description ? { description: t.description } : {}), ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}) })
      }
    } catch {
      // One server without a usable doc must not cost the others.
    }
  }
  return out
}

async function buildToolset(cfg: AubeConfig, log: (m: string) => void): Promise<{ defs: ToolDef[]; targets: Map<string, Target> }> {
  const taken = new Set<string>()
  const defs: ToolDef[] = []
  const targets = new Map<string, Target>()
  for (const tool of toolsFor('run')) {
    const name = functionName(tool.name, taken)
    defs.push({ type: 'function', function: { name, description: tool.description, parameters: jsonSchemaOf(tool) } })
    targets.set(name, { kind: 'aube', tool })
  }
  for (const connName of cfg.llm.tool_connections) {
    const raw = cfg.connections[connName]
    if (!raw) continue
    const conn = interpolate(raw)
    try {
      for (const t of await connectionTools(conn)) {
        const name = functionName(`${connName}__${t.callName}`, taken)
        defs.push({
          type: 'function',
          function: { name, description: (t.description ?? t.callName).slice(0, 1000), parameters: (t.inputSchema as object) ?? { type: 'object', properties: {} } },
        })
        targets.set(name, { kind: 'mcp', conn, connName, tool: t.callName })
      }
    } catch (err) {
      log(`tool loop: connection "${connName}" unavailable: ${(err as Error).message}`)
    }
  }
  return { defs, targets }
}

export function makeToolLoop(services: () => Services): ToolLoop {
  return async (ctx: AppContext, ep, initial: ChatMessage[], runId: number): Promise<Completion> => {
    const cfg = ctx.config.get()
    const svc = services()
    const { defs, targets } = await buildToolset(cfg, ctx.log)
    const messages = [...initial]
    const trace: TraceEntry[] = []
    const usage = { input: 0, output: 0 }
    const add = (c: Completion) => {
      usage.input += c.usage?.input ?? 0
      usage.output += c.usage?.output ?? 0
    }
    const finish = (c: Completion): Completion => {
      addArtifact(ctx, runId, 'tool_trace', { tools: defs.map((d) => d.function.name), calls: trace })
      return { ...c, usage }
    }

    for (let round = 1; round <= cfg.llm.max_tool_rounds; round++) {
      const c = await complete(ep, messages, { tools: defs })
      add(c)
      if (!c.toolCalls.length) return finish(c)
      messages.push({ role: 'assistant', content: c.content || null, tool_calls: c.toolCalls })
      for (const call of c.toolCalls) {
        const started = Date.now()
        let args: unknown = {}
        let ok = false
        let result: string
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
          const target = targets.get(call.function.name)
          if (!target) result = `There is no tool called "${call.function.name}".`
          else if (target.kind === 'aube') {
            const r = await runTool(target.tool, args, { ctx, svc, by: `run:${runId}`, runId })
            ok = r.isError !== true
            result = resultText(r)
          } else {
            const r = await callTool(target.conn, target.tool, args as Record<string, unknown>, { timeoutMs: 120_000 })
            ok = true
            result = r.text || '(empty result)'
          }
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        const clipped = result.length > RESULT_CHARS ? `${result.slice(0, RESULT_CHARS)}\n…(cut)` : result
        trace.push({ round, name: call.function.name, args, ok, result: clipped.slice(0, 2000), ms: Date.now() - started })
        messages.push({ role: 'tool', tool_call_id: call.id, content: clipped })
      }
    }

    // Out of rounds: one last call without tools, asking for the answer.
    messages.push({ role: 'user', content: 'The tool budget for this run is spent. Answer now with the JSON object, using what you have gathered.' })
    const last = await complete(ep, messages)
    add(last)
    return finish(last)
  }
}
