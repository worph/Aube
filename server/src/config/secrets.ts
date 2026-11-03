import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * `data/secrets.env`: values for the `${VAR}` references in config.yaml that the container
 * environment leaves unset (ARCHITECTURE §9 rule 6). Two writers: first boot (the generated MCP
 * token) and Settings, which can set a variable from the browser so an install needs no shell.
 * Values only go in; nothing here ever returns one.
 *
 * Precedence: a non-empty value in the container environment always wins. A variable set there
 * cannot be changed from the browser, which says so instead.
 */

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Managed by Aube itself (and by the store's secret generator); not editable from the browser. */
const RESERVED = new Set(['AUBE_MCP_TOKEN', 'AUBE_ADMIN_MCP_TOKEN'])

/** Names whose current value came from secrets.env, not from the container environment. */
const fromFile = new Set<string>()

export function loadSecrets(file: string): void {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m) continue
    const [, name, value] = m as unknown as [string, string, string]
    if (!process.env[name] || fromFile.has(name)) {
      process.env[name] = value
      fromFile.add(name)
    }
  }
}

export type SecretSource = 'env' | 'file' | null

export function secretSource(name: string): SecretSource {
  if (!process.env[name]) return null
  return fromFile.has(name) ? 'file' : 'env'
}

export class SecretRefused extends Error {}

/** Set (or, with an empty value, clear) one variable in secrets.env and in this process. */
export function setSecret(file: string, name: string, value: string): void {
  if (!NAME.test(name)) throw new SecretRefused(`"${name}" is not a variable name`)
  if (RESERVED.has(name)) throw new SecretRefused(`${name} is managed by Aube and cannot be set here`)
  if (/[\r\n]/.test(value)) throw new SecretRefused('the value must be a single line')
  if (secretSource(name) === 'env') throw new SecretRefused(`${name} is set in the container environment, which always wins; change it there`)

  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '') : []
  const kept = lines.filter((l) => !new RegExp(`^\\s*${name}\\s*=`).test(l))
  if (value) kept.push(`${name}=${value}`)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 })
  renameSync(tmp, file)
  chmodSync(file, 0o600)

  if (value) {
    process.env[name] = value
    fromFile.add(name)
  } else {
    delete process.env[name]
    fromFile.delete(name)
  }
}
