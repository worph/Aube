import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { CONTRACT_EXAMPLE, localHHMM, weekdayName, type AubeConfig } from '@aube/shared'
import { fillPrompt, loadPrompt } from '../prompts/load.js'
import { currentPrompt } from '../prompt/store.js'
import { previousHeadlines } from './store.js'
import type { ChatMessage } from '../llm/client.js'
import type { AppContext } from '../context.js'

/**
 * The two messages of a run (IMPLEMENTATION §9). The system message is versioned in git; its hash
 * is stored on every run next to the master prompt version, so a change in briefs can be traced to
 * either one.
 */
export interface RunMessages {
  messages: ChatMessage[]
  systemHash: string
  promptVersionId: number
  /** True when the backend has no way to write memory this run. */
  memoryReadonly: boolean
}

export function aubeToolsNote(cfg: AubeConfig): { text: string; readonly: boolean } {
  if (cfg.llm.tool_mode === 'aube') {
    return {
      text: 'Aube\'s tools are offered to you directly: `memory_list`, `memory_read`, `memory_write`, `memory_delete`, `memory_history`, `memory_restore` (the memory folder) and `brief_list`, `brief_get` (past briefs).',
      readonly: false,
    }
  }
  if (cfg.mcp_endpoint.enabled) {
    return {
      text: 'Aube serves its own tools over MCP, reachable through your connections (e.g. Beacon) as `aube__memory_list`, `aube__memory_read`, `aube__memory_write`, `aube__memory_delete`, `aube__memory_history`, `aube__memory_restore` (the memory folder) and `aube__brief_list`, `aube__brief_get` (past briefs). If you cannot reach them, the memory is read-only for this run: use the index below.',
      readonly: false,
    }
  }
  return {
    text: "Aube's memory tools are not enabled: the memory is read-only for this run. Its index is in the user message.",
    readonly: true,
  }
}

export function buildRunMessages(ctx: AppContext, date: string): RunMessages {
  const cfg = ctx.config.get()
  const tools = aubeToolsNote(cfg)
  const system = fillPrompt(loadPrompt('run-system'), {
    AUBE_TOOLS: tools.text,
    CONTRACT: JSON.stringify(CONTRACT_EXAMPLE, null, 2),
  })
  const prompt = currentPrompt(ctx)
  const memoryIndexFile = path.join(ctx.paths.memory, 'MEMORY.md')
  const memoryIndex = existsSync(memoryIndexFile) ? readFileSync(memoryIndexFile, 'utf8').trim() : '(empty)'
  const previous = previousHeadlines(ctx, date)

  const user = [
    '# Date',
    `date: ${date} (${weekdayName(date)})`,
    `timezone: ${cfg.timezone}`,
    `now: ${localHHMM(ctx.now(), cfg.timezone)}`,
    `the brief will be read at: ${cfg.notify_at}`,
    '',
    '# Memory index (MEMORY.md)',
    memoryIndex,
    '',
    '# Previous briefs',
    previous.length ? previous.map((p) => `- ${p.date}: ${p.headline}`).join('\n') : '(none yet)',
    '',
    '# Master prompt',
    '<master_prompt>',
    prompt.body.trim(),
    '</master_prompt>',
  ].join('\n')

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    systemHash: createHash('sha256').update(loadPrompt('run-system')).digest('hex').slice(0, 12),
    promptVersionId: prompt.version.id,
    memoryReadonly: tools.readonly,
  }
}
