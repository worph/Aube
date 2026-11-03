import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { Paths } from './paths.js'
import { CONFIG_TEMPLATE, MASTER_PROMPT_TEMPLATE, MEMORY_INDEX_TEMPLATE } from './config/template.js'
import { loadSecrets } from './config/secrets.js'

/**
 * A fresh volume gets the files Aube needs to boot and be configured from the browser
 * (IMPLEMENTATION §14). Nothing existing is ever overwritten.
 *
 * `secrets.env` holds generated secrets (the MCP endpoint token) as KEY=VALUE lines. It is loaded
 * into `process.env` for variables the container environment does not already set, so a value in
 * compose always wins.
 */
export function firstBoot(paths: Paths, log: (msg: string) => void = console.log): void {
  mkdirSync(paths.root, { recursive: true })
  mkdirSync(paths.memory, { recursive: true })
  const write = (file: string, text: string, what: string) => {
    if (existsSync(file)) return
    writeFileSync(file, text, 'utf8')
    log(`first boot: wrote ${what}`)
  }
  write(paths.config, CONFIG_TEMPLATE, 'config.yaml')
  write(paths.masterPrompt, MASTER_PROMPT_TEMPLATE, 'master-prompt.md')
  write(`${paths.memory}/MEMORY.md`, MEMORY_INDEX_TEMPLATE, 'memory/MEMORY.md')

  loadSecrets(paths.secrets)
  // Not only on first boot: an install that predates the admin endpoint gets its token on upgrade.
  for (const name of ['AUBE_MCP_TOKEN', 'AUBE_ADMIN_MCP_TOKEN']) {
    if (process.env[name]) continue
    const token = randomBytes(32).toString('hex')
    appendFileSync(paths.secrets, `${name}=${token}\n`, { mode: 0o600 })
    process.env[name] = token
    log(`generated ${name} into ${paths.secrets} (give it to its beaconify sidecar)`)
  }
}
