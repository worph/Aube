/**
 * `${VAR}` references, resolved from the environment at use time.
 *
 * The file keeps the reference; only the in-memory copy the server works with holds the value, so
 * a secret never reaches `config.yaml`, the API or the browser. An unset variable resolves to ''
 * — the probe that uses it then fails with a readable reason instead of the boot failing.
 */
const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export function interpolateString(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(REF, (_m, name: string) => env[name] ?? '')
}

export function interpolate<T>(node: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof node === 'string') return interpolateString(node, env) as T
  if (Array.isArray(node)) return node.map((n) => interpolate(n, env)) as T
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) out[k] = interpolate(v, env)
    return out as T
  }
  return node
}

/** Names of the variables a tree references and the environment leaves unset. */
export function missingVars(node: unknown, env: NodeJS.ProcessEnv = process.env): string[] {
  const missing = new Set<string>()
  const walk = (n: unknown) => {
    if (typeof n === 'string') {
      for (const m of n.matchAll(REF)) if (!env[m[1]!]) missing.add(m[1]!)
    } else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') Object.values(n).forEach(walk)
  }
  walk(node)
  return [...missing]
}

/** Every variable name a tree references, in first-seen order. */
export function referencedVars(node: unknown): string[] {
  const seen = new Set<string>()
  const walk = (n: unknown) => {
    if (typeof n === 'string') for (const m of n.matchAll(REF)) seen.add(m[1]!)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') Object.values(n).forEach(walk)
  }
  walk(node)
  return [...seen]
}
