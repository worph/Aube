import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AubeConfig } from '@aube/shared'
import { error, runTool, toolsFor, type AubeTool, type Scope, type ToolContext, type ToolResult } from '../tools/index.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/**
 * Aube's two MCP endpoints (ARCHITECTURE §6.4). Ported from Newsdesk `api/admin-mcp.ts`: stateless
 * (a fresh server and transport per request, which is what a beaconify proxy needs), bearer-token
 * authenticated, GET/DELETE answered 405. Each is off unless enabled in Settings: then every call is
 * a 404, as if the route did not exist. Each has its own token and its own beaconify sidecar.
 *
 * - `/mcp` (`mcp_endpoint`): the `run` toolset — memory and past briefs, never settings or the
 *   master prompt. Calls are attributed to the run in progress when there is exactly one, so a
 *   night's memory changes show in its run log.
 * - `/mcp/admin` (`admin_endpoint`): the `admin` toolset — everything the administrator chat can do
 *   (master prompt, settings, tests, previews, memory) plus secrets and the run log, for an operator
 *   driving Aube from another assistant. There is no confirmation card here: the calling client's
 *   own approval of a write (readOnlyHint false) is the confirmation. **Writes are refused while a run is in progress**: the nightly backend usually sees
 *   the same Beacon, and must not be able to rewrite its own prompt, settings or secrets.
 */
export function registerMcpEndpoint(app: FastifyInstance, ctx: AppContext, svc: Services) {
  serve(app, ctx, {
    path: '/mcp',
    scope: 'run',
    config: (c) => c.mcp_endpoint,
    disabled: 'the MCP endpoint is disabled (Settings → Aube MCP endpoint)',
    name: 'aube',
    instructions:
      "Aube's memory and past briefs. Memory is a folder of markdown files and images holding context no other tool knows; MEMORY.md is its index. Never store the status of a task, event or mail in memory: the tool that owns it is the truth.",
    context: () => {
      const inProgress = svc.runner.inProgress()
      const runId = inProgress.length === 1 ? inProgress[0]! : null
      return { ctx, svc, by: runId !== null ? `run:${runId}` : 'mcp:unknown', runId }
    },
    call: runTool,
  })

  serve(app, ctx, {
    path: '/mcp/admin',
    scope: 'admin',
    config: (c) => c.admin_endpoint,
    disabled: 'the admin MCP endpoint is disabled (Settings → Admin MCP endpoint)',
    name: 'aube-admin',
    instructions:
      'Administration of Aube, a self-hosted morning brief: the master prompt (prompt_get, prompt_save — always send the full text), settings (settings_get, settings_save with a partial patch; secrets are ${VAR} references, set with secret_set), connection tests, previews (run_preview, then run_get to read the result), the memory and past briefs. Aube never copies the state of tasks, events or mail: the tools that own them are the truth.',
    context: () => ({ ctx, svc, by: 'mcp:admin', runId: null }),
    call: async (tool, args, t) => {
      if (tool.writes) {
        const busy = svc.runner.inProgress()
        if (busy.length) return error(`refused: run #${busy.join(', #')} is in progress, and admin writes wait until no run is running. Try again when it has finished (run_get).`)
      }
      return runTool(tool, args, t)
    },
  })
}

interface Surface {
  path: string
  scope: Scope
  config: (c: AubeConfig) => { enabled: boolean; token: string }
  disabled: string
  name: string
  instructions: string
  context: () => ToolContext
  call: (tool: AubeTool, args: unknown, t: ToolContext) => Promise<ToolResult>
}

function serve(app: FastifyInstance, ctx: AppContext, s: Surface) {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const cfg = s.config(ctx.config.get())
    if (!cfg.enabled) return reply.code(404).send({ error: s.disabled })
    const header = req.headers.authorization ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!cfg.token || !presented || !safeEqual(presented, cfg.token)) {
      return reply.code(401).send({ jsonrpc: '2.0', error: { code: -32001, message: 'invalid or missing bearer token' }, id: null })
    }
  }

  app.post(s.path, { preHandler: guard }, async (req, reply) => {
    const server = new McpServer({ name: s.name, version: '1.1.0' }, { instructions: s.instructions })
    const t = s.context()
    for (const tool of toolsFor(s.scope)) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: { readOnlyHint: !tool.writes } },
        (async (args: unknown) => s.call(tool, args, t)) as never,
      )
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    reply.hijack()
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })

  for (const method of ['get', 'delete'] as const) {
    app[method](s.path, { preHandler: guard }, async (_req, reply) =>
      reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'this endpoint is stateless — use POST' }, id: null }),
    )
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
