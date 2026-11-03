import { z } from 'zod'
import { defineTool, json, text } from './registry.js'

/** memory_* (run + chat). Deletes and restores are confirmed in the chat; the nightly run has full access. */
export const memoryTools = [
  defineTool({
    name: 'memory_list',
    title: 'List memory files',
    description: 'List the files in Aube\'s memory folder (markdown and images) with size, last change, and whether MEMORY.md (the index) mentions them.',
    input: {},
    scope: ['run', 'chat'],
    writes: false,
    handler: async (_a, t) => json(await t.svc.memory.list()),
  }),
  defineTool({
    name: 'memory_read',
    title: 'Read a memory file',
    description: 'Read one memory file. Markdown comes back as text, an image as an image.',
    input: { path: z.string().describe('Path relative to the memory folder, e.g. "health.md" or "images/gym.jpg"') },
    scope: ['run', 'chat'],
    writes: false,
    handler: async ({ path }, t) => {
      const c = await t.svc.memory.read(path)
      return c.kind === 'md' ? text(c.text) : { content: [{ type: 'image', data: c.data, mimeType: c.mimeType }] }
    },
  }),
  defineTool({
    name: 'memory_write',
    title: 'Write a memory file',
    description:
      'Create or replace a memory file. Memory holds context no other tool knows (preferences, an injury, a photo of a timetable) — never the status of a task, event, mail or monitor: ask that tool instead. Keep MEMORY.md (the index) current: one line per file.',
    input: {
      path: z.string().describe('e.g. "food.md" or "images/timetable.jpg"'),
      content: z.string().describe('Markdown text, or base64 for an image'),
    },
    scope: ['run', 'chat'],
    writes: true,
    handler: async ({ path, content }, t) => {
      const r = await t.svc.memory.write(path, content, { by: t.by, runId: t.runId })
      return text(`${r.created ? 'Created' : 'Updated'} ${r.path} (${r.size} bytes).`)
    },
  }),
  defineTool({
    name: 'memory_delete',
    title: 'Delete a memory file',
    description: 'Delete a memory file. It stays in the history and can be restored.',
    input: { path: z.string() },
    scope: ['run', 'chat'],
    writes: true,
    confirm: ({ path }) => `Delete ${path} from memory? (It stays in the history and can be restored.)`,
    handler: async ({ path }, t) => {
      const r = await t.svc.memory.delete(path, { by: t.by, runId: t.runId })
      return text(`Deleted ${r.path}. It can be restored from its history.`)
    },
  }),
  defineTool({
    name: 'memory_history',
    title: 'Memory history',
    description: 'The change history of the memory, or of one file: who changed it (a run, the chat or MCP), when, and the entry id to restore.',
    input: { path: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    scope: ['run', 'chat'],
    writes: false,
    handler: async ({ path, limit }, t) => json(t.svc.memory.history(path, limit ?? 30)),
  }),
  defineTool({
    name: 'memory_restore',
    title: 'Restore a memory version',
    description: 'Put back the content recorded by a history entry (from memory_history). A deleted file comes back with its last content.',
    input: { journal_id: z.number().int() },
    scope: ['run', 'chat'],
    writes: true,
    confirm: ({ journal_id }, t) => {
      const v = t.svc.memory.version(journal_id)
      return `Restore ${v.path} to the version recorded in history entry #${journal_id}?`
    },
    handler: async ({ journal_id }, t) => {
      const r = await t.svc.memory.restore(journal_id, { by: t.by, runId: t.runId })
      return text(`Restored ${r.path} from history entry #${journal_id}.`)
    },
  }),
]
