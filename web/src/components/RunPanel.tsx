import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BriefView } from '@aube/shared'
import { getRun } from '../api'

/** What happened during the run behind a brief: status, timing, usage, sources, memory, sends, raw answer. */
export function RunPanel({ brief }: { brief: BriefView }) {
  const [open, setOpen] = useState(false)
  const r = brief.run
  const detail = useQuery({ queryKey: ['run', r.id], queryFn: () => getRun(r.id), enabled: open })
  const raw = detail.data?.artifacts.filter((a) => a.kind === 'raw_answer') ?? []
  return (
    <details className="rounded-lg border border-ink-200 bg-white p-3 text-sm dark:border-ink-800 dark:bg-ink-900" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none">
        Run #{r.id} · {r.kind}{r.phase === 'evening' ? ' · evening' : ''} · {r.status}
        {r.failureClass ? ` [${r.failureClass}]` : ''}
        {r.durationMs !== null ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ''}
        {r.inputTokens ? ` · ${r.inputTokens}→${r.outputTokens} tokens` : ''}
      </summary>
      <div className="mt-3 space-y-3">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-500">Model</dt>
          <dd>{r.model || '—'} ({r.toolMode} tools)</dd>
          <dt className="text-ink-500">Attempts</dt>
          <dd>{r.attempts}</dd>
          <dt className="text-ink-500">Memory</dt>
          <dd>{r.memoryReadonly ? 'read-only this run' : 'writable'}</dd>
          {r.failureText && (
            <>
              <dt className="text-ink-500">Failure</dt>
              <dd className="whitespace-pre-wrap text-red-600">{r.failureText}</dd>
            </>
          )}
        </dl>
        {brief.sources.length > 0 && (
          <div>
            <div className="font-medium">Sources</div>
            <ul className="flex flex-wrap gap-2">
              {brief.sources.map((s) => (
                <li key={s.name} className={s.ok ? 'text-emerald-600' : 'text-red-600'}>
                  {s.ok ? '✓' : '✗'} {s.name}
                  {s.note ? ` (${s.note})` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {brief.memoryChanges.length > 0 && (
          <div>
            <div className="font-medium">Memory changes</div>
            <ul>
              {brief.memoryChanges.map((m, i) => (
                <li key={i}>
                  {m.action} <code>{m.path}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {brief.memoryNotes && <p className="text-ink-500">Memory note: {brief.memoryNotes}</p>}
        {brief.sends.length > 0 && (
          <div>
            <div className="font-medium">Notifications</div>
            <ul>
              {brief.sends.map((s, i) => (
                <li key={i} className={s.status === 'ok' ? '' : 'text-red-600'}>
                  {s.channel}: {s.status}
                  {s.error ? ` — ${s.error}` : ''} <span className="text-ink-500">{new Date(s.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {raw.map((a, i) => (
          <details key={a.id}>
            <summary className="cursor-pointer text-ink-500">Raw answer {i + 1}</summary>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-ink-100 p-2 text-xs dark:bg-ink-950">{a.body}</pre>
          </details>
        ))}
      </div>
    </details>
  )
}
