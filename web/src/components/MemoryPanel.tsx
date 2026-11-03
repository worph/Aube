import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getMemory, getMemoryFile, getMemoryHistory, getMemoryVersion, memoryImageUrl, restoreMemory, type JournalEntry } from '../api'
import { Diff } from './Diff'
import { Markdown } from './Markdown'
import { Button, Status } from './ui'

/**
 * The memory panel (ARCHITECTURE §5.4): files, preview, history with diffs and Restore. Read-only
 * apart from Restore; editing goes through the chat.
 */
export function MemoryPanel() {
  const qc = useQueryClient()
  const mem = useQuery({ queryKey: ['memory'], queryFn: getMemory, refetchInterval: 15_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'file' | 'history'>('file')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['memory'] })
    void qc.invalidateQueries({ queryKey: ['memory-file'] })
    void qc.invalidateQueries({ queryKey: ['memory-history'] })
  }

  if (mem.isError) return <Status ok={false}>{(mem.error as Error).message}</Status>
  const touched = new Set(mem.data?.lastRun?.touched ?? [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Memory</h2>
        {mem.data && (
          <span className="text-xs text-ink-500">
            {mem.data.files.length} files · {Math.round(mem.data.totalBytes / 1024)} KB of {Math.round(mem.data.maxTotalBytes / 1024 / 1024)} MB
          </span>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => { setSelected(null); setTab('history') }}>
          All changes
        </Button>
      </div>
      {msg && <Status ok={msg.ok}>{msg.text}</Status>}
      <ul className="max-h-56 overflow-auto rounded border border-ink-200 dark:border-ink-800">
        {mem.data?.files.map((f) => {
          const depth = f.path.split('/').length - 1
          return (
            <li key={f.path}>
              <button
                className={`flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-ink-100 dark:hover:bg-ink-800 ${selected === f.path ? 'bg-ink-100 dark:bg-ink-800' : ''}`}
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => {
                  setSelected(f.path)
                  setTab('file')
                }}
              >
                <span>{f.kind === 'image' ? '🖼️' : '📄'}</span>
                <span className="flex-1 truncate font-mono text-xs">{f.path}</span>
                {touched.has(f.path) && <span title={`changed by the run of ${mem.data?.lastRun?.date}`} className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-900 dark:text-amber-100">last night</span>}
                {!f.inIndex && <span title="MEMORY.md does not mention this file" className="text-[10px] text-ink-400">not indexed</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {selected && (
        <div className="flex gap-1">
          <Button variant={tab === 'file' ? 'default' : 'ghost'} onClick={() => setTab('file')}>
            Content
          </Button>
          <Button variant={tab === 'history' ? 'default' : 'ghost'} onClick={() => setTab('history')}>
            History
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded border border-ink-200 p-2 dark:border-ink-800">
        {tab === 'file' && selected && <FileView path={selected} />}
        {tab === 'file' && !selected && <p className="text-ink-500">Select a file. Ask the chat to change memory.</p>}
        {tab === 'history' && (
          <History
            path={selected}
            onRestored={(text) => {
              setMsg({ ok: true, text })
              refresh()
            }}
            onError={(text) => setMsg({ ok: false, text })}
          />
        )}
      </div>
    </div>
  )
}

function FileView({ path }: { path: string }) {
  const q = useQuery({ queryKey: ['memory-file', path], queryFn: () => getMemoryFile(path) })
  if (q.isError) return <Status ok={false}>{(q.error as Error).message}</Status>
  if (!q.data) return <p className="text-ink-500">Loading…</p>
  if (q.data.kind === 'image') return <img src={memoryImageUrl(path)} alt={path} className="max-w-full rounded" />
  return <Markdown text={q.data.text} />
}

function History({ path, onRestored, onError }: { path: string | null; onRestored: (t: string) => void; onError: (t: string) => void }) {
  const q = useQuery({ queryKey: ['memory-history', path], queryFn: () => getMemoryHistory(path ?? undefined) })
  const [open, setOpen] = useState<number | null>(null)
  if (q.isError) return <Status ok={false}>{(q.error as Error).message}</Status>
  if (!q.data) return <p className="text-ink-500">Loading…</p>
  if (!q.data.entries.length) return <p className="text-ink-500">No changes recorded yet.</p>
  return (
    <ul className="space-y-1">
      {q.data.entries.map((e) => (
        <li key={e.id} className="rounded border border-ink-100 p-1.5 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <button className="flex-1 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className={e.action === 'delete' ? 'text-red-600' : e.action === 'restore' ? 'text-emerald-600' : ''}>{e.action}</span>{' '}
              {!path && <code className="text-xs">{e.path}</code>} <span className="text-xs text-ink-500">by {e.by} · {new Date(e.at).toLocaleString()}</span>
            </button>
            <Button
              onClick={async () => {
                try {
                  const r = await restoreMemory(e.id, e.action === 'delete' ? 'before' : 'after')
                  onRestored(`Restored ${r.path} (history #${e.id}).`)
                } catch (err) {
                  onError((err as Error).message)
                }
              }}
              title={e.action === 'delete' ? 'Bring the deleted file back' : 'Put this version back'}
            >
              Restore
            </Button>
          </div>
          {open === e.id && <EntryDiff entry={e} />}
        </li>
      ))}
    </ul>
  )
}

function EntryDiff({ entry }: { entry: JournalEntry }) {
  const before = useQuery({ queryKey: ['memv', entry.id, 'before'], queryFn: () => getMemoryVersion(entry.id, 'before') })
  const after = useQuery({ queryKey: ['memv', entry.id, 'after'], queryFn: () => getMemoryVersion(entry.id, 'after') })
  if (!before.data || !after.data) return <p className="text-ink-500">Loading…</p>
  if (entry.encoding === 'base64') {
    return (
      <div className="mt-1 flex gap-2">
        {[before.data, after.data].map((v, i) => (
          <div key={i} className="flex-1 text-xs text-ink-500">
            {i ? 'after' : 'before'}: {v.content ? <img alt="" className="max-h-32" src={`data:image/*;base64,${v.content}`} /> : '(none)'}
          </div>
        ))}
      </div>
    )
  }
  return <Diff before={before.data.content ?? ''} after={after.data.content ?? ''} />
}
