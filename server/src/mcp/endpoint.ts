import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { runTool, toolsFor, type ToolContext } from '../tools/index.js'
import type { AppContext } from '../context.js'
import type { Services } from '../services.js'

/**
 * Aube's own MCP endpoint at `/mcp` (ARCHITECTURE §6.4): the `run` toolset only — memory and past
 * briefs, never settings or the master prompt. Ported from Newsdesk `api/admin-mcp.ts`: stateless
 * (a fresh server and transport per request, which is what a beaconify proxy needs), bearer-token
 * authenticated, GET/DELETE answered 405.
 *
 * Off unless `mcp_endpoint.enabled`: then every call is a 404, as if the route did not exist.
 * Calls are attributed to the run in progress when there is exactly one, so a night's memory
 * changes show in its run log.
 */
export function registerMcpEndpoint(app: FastifyInstance, ctx: AppContext, svc: Services) {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const cfg = ctx.config.get().mcp_endpoint
    if (!cfg.enabled) return reply.code(404).send({ error: 'the MCP endpoint is disabled (Settings → Aube MCP endpoint)' })
    const header = req.headers.authorization ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!cfg.token || !presented || !safeEqual(presented, cfg.token)) {
      return reply.code(401).send({ jsonrpc: '2.0', error: { code: -32001, message: 'invalid or missing bearer token' }, id: null })
    }
  }

  app.post('/mcp', { preHandler: guard }, async (req, reply) => {
    const server = new McpServer(
      { name: 'aube', version: '0.1.0' },
      {
        instructions:
          "Aube's memory and past briefs. Memory is a folder of markdown files and images holding context no other tool knows; MEMORY.md is its index. Never store the status of a task, event or mail in memory: the tool that owns it is the truth.",
      },
    )
    const inProgress = svc.runner.inProgress()
    const runId = inProgress.length === 1 ? inProgress[0]! : null
    const t: ToolContext = { ctx, svc, by: runId !== null ? `run:${runId}` : 'mcp:unknown', runId }
    for (const tool of toolsFor('run')) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: { readOnlyHint: !tool.writes } },
        (async (args: unknown) => runTool(tool, args, t)) as never,
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
    app[method]('/mcp', { preHandler: guard }, async (_req, reply) =>
      reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'this endpoint is stateless — use POST' }, id: null }),
    )
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
