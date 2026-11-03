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
  if (!process.env.AUBE_MCP_TOKEN) {
    const token = randomBytes(32).toString('hex')
    appendFileSync(paths.secrets, `AUBE_MCP_TOKEN=${token}\n`, { mode: 0o600 })
    process.env.AUBE_MCP_TOKEN = token
    log(`first boot: generated AUBE_MCP_TOKEN into ${paths.secrets} (give it to the beaconify sidecar)`)
  }
}
