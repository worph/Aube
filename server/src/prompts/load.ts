import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Prompts are prose in `.md` files next to this module (copied into dist by
 * scripts/copy-assets.mjs). Ported from Newsdesk `server/src/prompts/load.ts`.
 */
const here = dirname(fileURLToPath(import.meta.url))
const cache = new Map<string, string>()

export function loadPrompt(name: string): string {
  let text = cache.get(name)
  if (text === undefined) {
    text = readFileSync(join(here, `${name}.md`), 'utf8')
    cache.set(name, text)
  }
  return text
}

/** Replace `{{KEY}}` placeholders. Unknown keys are left as written, so a typo is visible. */
export function fillPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => values[key] ?? m)
}
