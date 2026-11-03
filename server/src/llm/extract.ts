/**
 * The JSON value inside a model's text answer. Ported from Newsdesk
 * `server/src/ports/inference/structured.ts`: prefer the last fenced block, then the whole text,
 * then scan for the first balanced, string-aware `{…}` / `[…]` that parses, trying each opener in
 * turn so prose containing a stray brace does not hide the real object.
 */
export function extractJson(text: string): unknown | undefined {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]!.trim())
  for (const candidate of [...fenced.reverse(), text.trim()]) {
    const found = scan(candidate)
    if (found !== undefined) return found
  }
  return undefined
}

function scan(source: string): unknown | undefined {
  if (source.startsWith('{') || source.startsWith('[')) {
    try {
      return JSON.parse(source)
    } catch {
      /* fall through to scanning */
    }
  }
  for (let start = 0; start < source.length; start++) {
    const opener = source[start]
    if (opener !== '{' && opener !== '[') continue
    const closer = opener === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < source.length; i++) {
      const c = source[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === opener) depth++
      else if (c === closer) {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  return undefined
}
