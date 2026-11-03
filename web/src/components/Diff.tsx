import { lineDiff } from '../diff'

export function Diff({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after)
  if (!lines.some((l) => l.op !== ' ')) return <p className="text-sm text-ink-500">No difference.</p>
  return (
    <pre className="max-h-96 overflow-auto rounded bg-ink-100 p-2 text-xs dark:bg-ink-950">
      {lines.map((l, i) => (
        <div key={i} className={l.op === '+' ? 'bg-emerald-100 dark:bg-emerald-950' : l.op === '-' ? 'bg-red-100 dark:bg-red-950' : ''}>
          {l.op} {l.text}
        </div>
      ))}
    </pre>
  )
}
