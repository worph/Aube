import { promises as fs, lstatSync } from 'node:fs'
import path from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import { schema } from '../db/index.js'
import type { AppContext } from '../context.js'

/**
 * The memory folder (ARCHITECTURE §5): markdown and images under `data/memory/`, nothing else, and
 * every change journaled with its full before/after so any version — a deleted file included — can
 * be restored (invariant 4). Every write in Aube goes through here.
 */

export class MemoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryError'
  }
}

const TEXT_EXT = new Set(['.md'])
const IMAGE_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

export interface MemoryFile {
  path: string
  kind: 'md' | 'image'
  size: number
  modifiedAt: string
  /** False when MEMORY.md has no line pointing at this file. */
  inIndex: boolean
}

export type MemoryContent = { kind: 'md'; path: string; text: string } | { kind: 'image'; path: string; data: string; mimeType: string }

export interface Actor {
  /** `run:<id>`, `chat:<thread>`, `ui`, `mcp:unknown`. */
  by: string
  runId?: number | null
}

export interface JournalEntry {
  id: number
  path: string
  action: 'write' | 'delete' | 'restore'
  by: string
  runId: number | null
  at: string
  encoding: 'utf8' | 'base64'
  beforeSize: number | null
  afterSize: number | null
}

export const INDEX = 'MEMORY.md'

export class MemoryStore {
  constructor(private readonly ctx: AppContext) {}

  get root(): string {
    return this.ctx.paths.memory
  }

  /** Normalise a caller's path and refuse anything that could leave the folder or isn't md/image. */
  resolve(input: string): { rel: string; abs: string; kind: 'md' | 'image' } {
    if (typeof input !== 'string' || !input.trim()) throw new MemoryError('a path is required')
    if (input.includes('\0')) throw new MemoryError('invalid path')
    const cleaned = input.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
    if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) throw new MemoryError('paths are relative to the memory folder')
    const rel = path.posix.normalize(cleaned)
    if (rel === '..' || rel.startsWith('../') || rel.split('/').includes('..')) throw new MemoryError('paths cannot leave the memory folder')
    if (rel.split('/').some((seg) => seg.startsWith('.'))) throw new MemoryError('hidden files are not allowed in memory')
    const ext = path.posix.extname(rel).toLowerCase()
    const kind = TEXT_EXT.has(ext) ? 'md' : IMAGE_EXT[ext] ? 'image' : null
    if (!kind) throw new MemoryError(`only markdown (.md) and images (${Object.keys(IMAGE_EXT).join(' ')}) are allowed`)
    const abs = path.join(this.root, ...rel.split('/'))
    // No component of the path, existing or not, may be a symlink: it could point anywhere.
    let cur = this.root
    for (const seg of rel.split('/')) {
      cur = path.join(cur, seg)
      try {
        if (lstatSync(cur).isSymbolicLink()) throw new MemoryError('symbolic links are not allowed in memory')
      } catch (err) {
        if (err instanceof MemoryError) throw err
        break // does not exist yet: nothing below it exists either
      }
    }
    return { rel, abs, kind }
  }

  async list(): Promise<MemoryFile[]> {
    const out: MemoryFile[] = []
    const walk = async (dir: string, prefix: string) => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue
        const rel = prefix ? `${prefix}/${e.name}` : e.name
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) await walk(abs, rel)
        else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase()
          const kind = TEXT_EXT.has(ext) ? 'md' : IMAGE_EXT[ext] ? 'image' : null
          if (!kind) continue
          const st = await fs.stat(abs)
          out.push({ path: rel, kind, size: st.size, modifiedAt: st.mtime.toISOString(), inIndex: true })
        }
      }
    }
    await walk(this.root, '')
    const index = await this.indexText()
    for (const f of out) f.inIndex = f.path === INDEX || index.includes(f.path)
    return out.sort((a, b) => (a.path === INDEX ? -1 : b.path === INDEX ? 1 : a.path.localeCompare(b.path)))
  }

  private async indexText(): Promise<string> {
    try {
      return await fs.readFile(path.join(this.root, INDEX), 'utf8')
    } catch {
      return ''
    }
  }

  async read(input: string): Promise<MemoryContent> {
    const { rel, abs, kind } = this.resolve(input)
    let buf: Buffer
    try {
      buf = await fs.readFile(abs)
    } catch {
      throw new MemoryError(`no such memory file: ${rel}`)
    }
    if (kind === 'md') return { kind, path: rel, text: buf.toString('utf8') }
    return { kind, path: rel, data: buf.toString('base64'), mimeType: IMAGE_EXT[path.extname(rel).toLowerCase()]! }
  }

  /** Write a file: `content` is UTF-8 text for markdown, base64 for an image. */
  async write(input: string, content: string, actor: Actor): Promise<{ path: string; size: number; created: boolean }> {
    const { rel, abs, kind } = this.resolve(input)
    const cfg = this.ctx.config.get().memory
    const buf = kind === 'md' ? Buffer.from(content, 'utf8') : decodeBase64(content)
    const cap = (kind === 'md' ? cfg.max_file_kb : cfg.max_image_kb) * 1024
    if (buf.length > cap) throw new MemoryError(`${rel} is ${Math.ceil(buf.length / 1024)} KB; the limit for ${kind === 'md' ? 'markdown' : 'images'} is ${cap / 1024} KB`)
    const before = await this.rawBefore(abs)
    const total = (await this.totalBytes()) - (before?.length ?? 0) + buf.length
    if (total > cfg.max_total_mb * 1024 * 1024) throw new MemoryError(`memory would exceed its ${cfg.max_total_mb} MB limit`)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tmp, buf)
    await fs.rename(tmp, abs)
    this.journal(rel, 'write', kind, before, buf, actor)
    return { path: rel, size: buf.length, created: !before }
  }

  async delete(input: string, actor: Actor): Promise<{ path: string }> {
    const { rel, abs, kind } = this.resolve(input)
    const before = await this.rawBefore(abs)
    if (!before) throw new MemoryError(`no such memory file: ${rel}`)
    await fs.rm(abs)
    this.journal(rel, 'delete', kind, before, null, actor)
    await this.pruneEmptyDirs(path.dirname(abs))
    return { path: rel }
  }

  history(input?: string, limit = 50): JournalEntry[] {
    const j = schema.memoryJournal
    const rel = input ? this.resolve(input).rel : undefined
    const rows = this.ctx.db
      .select()
      .from(j)
      .where(rel ? eq(j.path, rel) : undefined)
      .orderBy(desc(j.id))
      .limit(limit)
      .all()
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      action: r.action,
      by: r.by,
      runId: r.runId,
      at: r.at,
      encoding: r.encoding,
      beforeSize: r.before === null ? null : sizeOf(r.before, r.encoding),
      afterSize: r.after === null ? null : sizeOf(r.after, r.encoding),
    }))
  }

  /** The content a journal entry recorded, `after` the change by default (`before` for a delete). */
  version(journalId: number, side?: 'before' | 'after'): { path: string; kind: 'md' | 'image'; content: string | null; encoding: 'utf8' | 'base64' } {
    const row = this.ctx.db.select().from(schema.memoryJournal).where(eq(schema.memoryJournal.id, journalId)).get()
    if (!row) throw new MemoryError(`no such history entry: ${journalId}`)
    const which = side ?? (row.after !== null ? 'after' : 'before')
    return { path: row.path, kind: row.encoding === 'utf8' ? 'md' : 'image', content: which === 'after' ? row.after : row.before, encoding: row.encoding }
  }

  /** Put a recorded version back (a deleted file comes back with its last content). Journaled as a restore. */
  async restore(journalId: number, actor: Actor, side?: 'before' | 'after'): Promise<{ path: string }> {
    const v = this.version(journalId, side)
    if (v.content === null) throw new MemoryError('that history entry has no content on that side (the file did not exist)')
    const { rel, abs, kind } = this.resolve(v.path)
    const buf = v.encoding === 'utf8' ? Buffer.from(v.content, 'utf8') : Buffer.from(v.content, 'base64')
    const before = await this.rawBefore(abs)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, buf)
    this.journal(rel, 'restore', kind, before, buf, actor)
    return { path: rel }
  }

  /** Files a run touched (for the run log and the "changed last night" marker). */
  touchedBy(runId: number): string[] {
    const rows = this.ctx.db
      .select({ path: schema.memoryJournal.path })
      .from(schema.memoryJournal)
      .where(and(eq(schema.memoryJournal.runId, runId)))
      .all()
    return [...new Set(rows.map((r) => r.path))]
  }

  async totalBytes(): Promise<number> {
    return (await this.list()).reduce((n, f) => n + f.size, 0)
  }

  private async rawBefore(abs: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(abs)
    } catch {
      return null
    }
  }

  private journal(rel: string, action: 'write' | 'delete' | 'restore', kind: 'md' | 'image', before: Buffer | null, after: Buffer | null, actor: Actor) {
    const encoding = kind === 'md' ? 'utf8' : 'base64'
    const enc = (b: Buffer | null) => (b === null ? null : encoding === 'utf8' ? b.toString('utf8') : b.toString('base64'))
    this.ctx.db
      .insert(schema.memoryJournal)
      .values({ path: rel, action, before: enc(before), after: enc(after), encoding, by: actor.by, runId: actor.runId ?? null, at: this.ctx.now().toISOString() })
      .run()
  }

  private async pruneEmptyDirs(dir: string) {
    while (dir.startsWith(this.root) && dir !== this.root) {
      try {
        await fs.rmdir(dir)
      } catch {
        return
      }
      dir = path.dirname(dir)
    }
  }
}

function decodeBase64(content: string): Buffer {
  const cleaned = content.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw new MemoryError('image content must be base64')
  return Buffer.from(cleaned, 'base64')
}

function sizeOf(blob: string, encoding: string): number {
  return encoding === 'utf8' ? Buffer.byteLength(blob, 'utf8') : Math.floor((blob.length * 3) / 4)
}
