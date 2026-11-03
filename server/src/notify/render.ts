/**
 * Brief → channel text (IMPLEMENTATION §10). Two formats: `plain` (ntfy, mail, anything) and
 * `telegram-markdown` (MarkdownV2: every reserved character escaped, headings bold). Long text is
 * split at line boundaries under the channel's limit.
 */
export type Format = 'plain' | 'telegram-markdown'

export const LIMITS: Record<Format, number> = { plain: 4000, 'telegram-markdown': 4096 }

/** Markdown → readable plain text: headings and emphasis markers dropped, links as "text (url)". */
export function toPlain(md: string): string {
  return md
    .replace(/```[a-z]*\n?/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const TG_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g
export const escapeTelegram = (s: string) => s.replace(TG_RESERVED, '\\$&')

export function toTelegram(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      const h = /^#{1,6}\s+(.*)$/.exec(line)
      if (h) return `*${escapeTelegram(toPlain(h[1]!))}*`
      return escapeTelegram(toPlain(line))
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function render(md: string, format: Format): string {
  return format === 'telegram-markdown' ? toTelegram(md) : toPlain(md)
}

/** Split under `limit` at line boundaries (a single over-long line is hard-cut). */
export function split(text: string, limit: number): string[] {
  if (text.length <= limit) return [text]
  const parts: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    let l = line
    while (l.length > limit) {
      if (cur) {
        parts.push(cur)
        cur = ''
      }
      parts.push(l.slice(0, limit))
      l = l.slice(limit)
    }
    if (cur && cur.length + 1 + l.length > limit) {
      parts.push(cur)
      cur = l
    } else cur = cur ? `${cur}\n${l}` : l
  }
  if (cur) parts.push(cur)
  return parts
}

/** Fill `{{var}}` in every string of an args object. */
export function fillArgs(args: unknown, vars: Record<string, string>): unknown {
  if (typeof args === 'string') return args.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m)
  if (Array.isArray(args)) return args.map((a) => fillArgs(a, vars))
  if (args && typeof args === 'object') return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, fillArgs(v, vars)]))
  return args
}
