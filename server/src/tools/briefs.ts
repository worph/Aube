import { z } from 'zod'
import { fromMinutes } from '@aube/shared'
import { briefView, dayRunId, listBriefs } from '../run/store.js'
import { defineTool, error, json, text } from './registry.js'

/** brief_* (run + chat): the archive. What was said on a day, never a source of truth for state. */
export const briefTools = [
  defineTool({
    name: 'brief_list',
    title: 'List past briefs',
    description: 'Past daily briefs, newest first: date and headline.',
    input: { limit: z.number().int().min(1).max(90).optional() },
    scope: ['run', 'chat'],
    writes: false,
    handler: async ({ limit }, t) => json(listBriefs(t.ctx, limit ?? 14).map((b) => ({ date: b.date, headline: b.headline, shape: b.shape }))),
  }),
  defineTool({
    name: 'brief_get',
    title: 'Read a past brief',
    description: 'The brief of one day (YYYY-MM-DD): its text and its day band (events and proposed plan) as of when it was prepared.',
    input: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
    scope: ['run', 'chat'],
    writes: false,
    handler: async ({ date }, t) => {
      const id = dayRunId(t.ctx, date)
      const b = id !== undefined ? briefView(t.ctx, id) : undefined
      if (!b) return error(`no brief for ${date}`)
      const band = [
        ...b.events.map((e) => (e.allDay ? `- event (all day): ${e.title}` : `- event ${fromMinutes(e.startMin!)}–${fromMinutes(e.endMin!)}: ${e.title}`)),
        ...b.blocks.map((k) => `- plan ${fromMinutes(k.startMin)}–${fromMinutes(k.endMin)} [${k.kind}]: ${k.title}`),
      ]
      return text(`# ${b.title}\n${b.headline}\n(as of ${b.asOf})\n\n${b.markdown}\n\n## Day band\n${band.join('\n') || '(empty)'}`)
    },
  }),
]
