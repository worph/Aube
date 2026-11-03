import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { desc, eq } from 'drizzle-orm'
import { schema } from '../db/index.js'
import type { AppContext } from '../context.js'

/**
 * The master prompt: `data/master-prompt.md` is the current text (hand-editable), every save is a
 * row in `prompt_versions`. A hand edit of the file is adopted as a new version the next time it
 * is read, so the history never silently misses one.
 */
export interface PromptVersion {
  id: number
  body: string
  savedAt: string
  savedBy: 'ui' | 'chat' | 'boot'
  note: string | null
}

export function currentPrompt(ctx: AppContext): { body: string; version: PromptVersion } {
  const body = existsSync(ctx.paths.masterPrompt) ? readFileSync(ctx.paths.masterPrompt, 'utf8') : ''
  const latest = ctx.db.select().from(schema.promptVersions).orderBy(desc(schema.promptVersions.id)).limit(1).get()
  if (latest && latest.body === body) return { body, version: latest }
  const row = ctx.db
    .insert(schema.promptVersions)
    .values({ body, savedBy: 'boot', note: latest ? 'edited on disk' : 'initial' })
    .returning()
    .get()
  return { body, version: row }
}

export function savePrompt(ctx: AppContext, body: string, by: 'ui' | 'chat', note?: string): PromptVersion {
  const current = currentPrompt(ctx)
  if (current.body === body) return current.version
  const tmp = `${ctx.paths.masterPrompt}.tmp-${process.pid}`
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, ctx.paths.masterPrompt)
  return ctx.db.insert(schema.promptVersions).values({ body, savedBy: by, note: note ?? null }).returning().get()
}

export function listPromptVersions(ctx: AppContext, limit = 50): PromptVersion[] {
  currentPrompt(ctx)
  return ctx.db.select().from(schema.promptVersions).orderBy(desc(schema.promptVersions.id)).limit(limit).all()
}

export function getPromptVersion(ctx: AppContext, id: number): PromptVersion | undefined {
  return ctx.db.select().from(schema.promptVersions).where(eq(schema.promptVersions.id, id)).get()
}
