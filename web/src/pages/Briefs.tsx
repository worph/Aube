import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, getBrief, getBriefs, isRunning, startRun } from '../api'
import { BriefDisplay } from '../components/BriefDisplay'
import { Button, Status } from '../components/ui'

/** One brief per day, newest first (ARCHITECTURE §8). Renders from the archive alone: no port needed. */
export function BriefsPage({ header }: { header?: ReactNode }) {
  const params = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['briefs'],
    queryFn: getBriefs,
    refetchInterval: (q) => (isRunning(q.state.data?.schedule.active?.status) ? 3000 : 60_000),
  })
  const date = params.date ?? list.data?.briefs[0]?.date
  const brief = useQuery({ queryKey: ['brief', date], queryFn: () => getBrief(date!), enabled: !!date })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const runNow = async () => {
    setMsg(null)
    try {
      const { runId } = await startRun('manual')
      setMsg({ ok: true, text: `Run #${runId} started. The brief appears here when it is ready.` })
      await qc.invalidateQueries({ queryKey: ['briefs'] })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) })
    }
  }

  const s = list.data?.schedule
  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Briefs</h1>
        {s && (
          <span className="text-sm text-ink-500">
            Next: prepared {fmt(s.nextRun)}, notified {fmt(s.nextNotify)} ({s.timezone})
          </span>
        )}
        <div className="flex-1" />
        {s?.active && <span className="text-sm text-amber-600">Run #{s.active.id} {s.active.status.toLowerCase()}…</span>}
        <Button variant="primary" onClick={runNow} disabled={!!s?.active}>
          Run now
        </Button>
      </div>
      {header}
      {msg && <Status ok={msg.ok}>{msg.text}</Status>}
      {list.isError && <Status ok={false}>{(list.error as Error).message}</Status>}

      <div className="grid gap-4 lg:grid-cols-[12rem_1fr]">
        <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {list.data?.briefs.length === 0 && <p className="text-sm text-ink-500">No brief yet. Set up the LLM in Settings, write a master prompt, then Run now.</p>}
          {list.data?.briefs.map((b) => (
            <Link
              key={b.date}
              to={`/briefs/${b.date}`}
              className={`shrink-0 rounded-md px-2 py-1.5 text-sm ${b.date === date ? 'bg-ink-200 dark:bg-ink-800' : 'hover:bg-ink-100 dark:hover:bg-ink-900'}`}
            >
              <div className="font-medium">
                {b.shape === 'failure' ? '⚠️ ' : ''}
                {b.date === list.data?.today ? 'Today' : new Date(`${b.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
              </div>
              <div className="hidden truncate text-xs text-ink-500 lg:block">{b.headline}</div>
            </Link>
          ))}
        </nav>
        <div className="min-w-0">
          {brief.isError && date && (
            <Status ok={false}>
              {(brief.error as Error).message}{' '}
              <button className="underline" onClick={() => navigate('/briefs')}>
                Latest
              </button>
            </Status>
          )}
          {brief.data && s && <BriefDisplay brief={brief.data} timezone={s.timezone} today={list.data!.today} />}
        </div>
      </div>
    </div>
  )
}
