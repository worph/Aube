import { promises as fs, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { ConfigSchema, literalSecrets, type AubeConfig } from '@aube/shared'
import { interpolate } from './interpolate.js'

/**
 * `data/config.yaml`, validated, comment-preserving.
 *
 * Saving rewrites only what changed: the new object is applied leaf by leaf onto the parsed YAML
 * document, so comments and key order of untouched keys survive (the property Touchstone's
 * `configfile.ts` keeps for single keys, generalised to a whole-object save). Writes are serialised
 * and land by rename.
 *
 * `raw()` is the file's content as validated (references intact) — what the API and the browser
 * see. `get()` is the same with `${VAR}` resolved — what the server uses. Both are re-read from
 * memory per call, so callers pick up a save without a restart.
 */

export class ConfigRejected extends Error {
  constructor(readonly issues: string[]) {
    super(`config rejected: ${issues.join('; ')}`)
    this.name = 'ConfigRejected'
  }
}

let seq = 0

export class ConfigStore {
  private current: AubeConfig
  private chain: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(cfg: AubeConfig) => void>()

  constructor(readonly file: string) {
    this.current = this.load()
  }

  /** Validated config with `${VAR}` references intact. */
  raw(): AubeConfig {
    return structuredClone(this.current)
  }

  /** Validated config with references resolved from the environment. */
  get(): AubeConfig {
    return interpolate(this.current)
  }

  onChange(fn: (cfg: AubeConfig) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Re-read the file (hand edits). Invalid content keeps the previous config and throws. */
  reload(): AubeConfig {
    this.current = this.load()
    this.emit()
    return this.raw()
  }

  /** Validate `next` and write it. Resolves with the saved (raw) config. */
  save(next: unknown): Promise<AubeConfig> {
    const run = this.chain.then(() => this.write(next))
    this.chain = run.catch(() => undefined)
    return run
  }

  private load(): AubeConfig {
    const text = existsSync(this.file) ? readFileSync(this.file, 'utf8') : ''
    const doc = YAML.parseDocument(text)
    if (doc.errors.length) throw new ConfigRejected([`config.yaml does not parse: ${doc.errors[0]!.message}`])
    return validate(doc.toJS() ?? {})
  }

  private async write(next: unknown): Promise<AubeConfig> {
    const parsed = validate(next)
    let text = ''
    try {
      text = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const doc = YAML.parseDocument(text) as unknown as YAML.Document
    if (doc.errors.length) throw new ConfigRejected([`config.yaml does not parse, so it was not changed: ${doc.errors[0]!.message}`])
    if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({}) as never
    applyMap(doc, doc.contents as unknown as YAML.YAMLMap, next as Record<string, unknown>)

    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${++seq}`
    try {
      await fs.writeFile(tmp, doc.toString({ lineWidth: 0 }), 'utf8')
      await fs.rename(tmp, this.file)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
    this.current = parsed
    this.emit()
    return this.raw()
  }

  private emit() {
    const cfg = this.get()
    for (const fn of this.listeners) {
      try {
        fn(cfg)
      } catch {
        /* a listener failing must not fail the save */
      }
    }
  }
}

export function validate(input: unknown): AubeConfig {
  const result = ConfigSchema.safeParse(input ?? {})
  if (!result.success) {
    throw new ConfigRejected(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`))
  }
  const literal = literalSecrets(input)
  if (literal.length) {
    throw new ConfigRejected(literal.map((p) => `${p}: secrets must be a \${VAR} reference, not a literal value`))
  }
  return result.data
}

/**
 * Apply `value` onto a YAML map in place: keys absent from `value` are deleted, nested plain
 * objects recurse (so their comments survive), everything else (scalars, arrays) is replaced.
 */
function applyMap(doc: YAML.Document, map: YAML.YAMLMap, value: Record<string, unknown>) {
  for (const item of [...map.items]) {
    const key = YAML.isScalar(item.key) ? String(item.key.value) : String(item.key)
    if (!(key in value) || value[key] === undefined) map.delete(key)
  }
  let prev: string | undefined
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue
    const existing = map.get(key, true)
    const after = prev
    prev = key
    if (existing === undefined) {
      insertAfter(map, after, key, newNode(doc, v))
      continue
    }
    if (isPlainObject(v) && YAML.isMap(existing)) {
      // A template's empty `{}` would otherwise stay a one-line flow map once filled.
      if (existing.flow && existing.items.length === 0 && Object.keys(v).length > 0) existing.flow = false
      applyMap(doc, existing, v)
    } else if (YAML.isScalar(existing) && (v === null || typeof v !== 'object')) {
      // In place, so the scalar keeps its quoting style ("05:00") and its comment.
      if (existing.value !== v) existing.value = v
    } else if (!sameValue(existing, v)) {
      const node = newNode(doc, v)
      if (existing && YAML.isNode(existing)) {
        node.comment = existing.comment
        node.commentBefore = existing.commentBefore
      }
      map.set(key, node)
    }
  }
}

/** Times are written quoted: a YAML 1.1 reader takes a bare `21:00` for a base-60 number. */
function newNode(doc: YAML.Document, v: unknown): YAML.Node {
  const node = doc.createNode(v) as YAML.Node
  if (YAML.isScalar(node) && typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) node.type = 'QUOTE_DOUBLE'
  return node
}

/**
 * A key the file does not have yet (a setting added in a later version) goes after its neighbour in
 * the saved object, not at the end of the file, so it sits with the settings it belongs to.
 */
function insertAfter(map: YAML.YAMLMap, after: string | undefined, key: string, node: YAML.Node) {
  const pair = new YAML.Pair(new YAML.Scalar(key), node)
  const idx = after === undefined ? -1 : map.items.findIndex((i) => (YAML.isScalar(i.key) ? String(i.key.value) : String(i.key)) === after)
  if (after !== undefined && idx === -1) map.items.push(pair)
  else map.items.splice(idx + 1, 0, pair)
}

function sameValue(node: unknown, v: unknown): boolean {
  if (node === undefined) return false
  const js = YAML.isNode(node) ? node.toJSON() : node
  return JSON.stringify(js) === JSON.stringify(v)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
