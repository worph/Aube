import { z } from 'zod'
import { loadPrompt } from '../prompts/load.js'
import { defineTool, error, text } from './registry.js'

/**
 * `aube_guide` (ARCHITECTURE §6.4): what Aube is and how to use it, as a tool. Beacon passes on a
 * server's one-line description and its tools, never its MCP `instructions`, so product knowledge an
 * assistant needs to answer "what is Aube? how do I start?" has to be reachable as a tool call.
 * The prose is `prompts/guide.md`, one `## <topic>` section per topic.
 */
export const GUIDE_TOPICS = ['overview', 'getting-started', 'master-prompt', 'settings', 'sources', 'notifications', 'troubleshooting'] as const

export function guideSections(): Map<string, string> {
  const sections = new Map<string, string>()
  for (const part of loadPrompt('guide').split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n')
    sections.set(part.slice(0, nl).trim(), part.slice(nl + 1).trim())
  }
  return sections
}

export const guideTools = [
  defineTool({
    name: 'aube_guide',
    title: 'Aube guide',
    description:
      'Start here when asked what Aube is, what it can do or how to set it up. Aube is a self-hosted morning brief prepared overnight by an LLM. Topics: overview, getting-started, master-prompt (how to write one, example), settings (every key, add-ons), sources (where the data comes from), notifications (phone push), troubleshooting. Without a topic, the whole guide.',
    input: { topic: z.enum(GUIDE_TOPICS).optional() },
    scope: ['chat', 'admin'],
    writes: false,
    handler: async ({ topic }) => {
      const sections = guideSections()
      if (!topic) return text([...sections].map(([k, v]) => `## ${k}\n\n${v}`).join('\n\n'))
      const s = sections.get(topic)
      return s ? text(`## ${topic}\n\n${s}`) : error(`no guide section "${topic}"`)
    },
  }),
]
