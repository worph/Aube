import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { addDays } from '@aube/shared'
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
  // The day's run id is in the key: when a newer run replaces that day's brief, the detail refetches.
  const dayRunId = list.data?.briefs.find((b) => b.date === date)?.runId
  const brief = useQuery({ queryKey: ['brief', date, dayRunId], queryFn: () => getBrief(date!), enabled: !!date })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const runNow = async (phase: 'morning' | 'evening') => {
    setMsg(null)
    try {
      // No success note: the header shows "Run #N running…" for as long as it runs.
      await startRun('manual', undefined, phase)
      await qc.invalidateQueries({ queryKey: ['briefs'] })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) })
    }
  }

  const s = list.data?.schedule
  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
  const next = s
    ? [
        ...(s.morningRun ? [`prepared ${fmt(s.nextRun)}`] : []),
        `notified ${fmt(s.nextNotify)}`,
        ...(s.eveningAt ? [`evening preview ${fmt(s.nextEvening)}`] : []),
      ].join(', ')
    : ''
  const today = list.data?.today
  const tomorrow = today ? addDays(today, 1) : undefined
  const dayLabel = (d: string) =>
    d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Briefs</h1>
        {s && (
          <span className="text-sm text-ink-500">
            Next: {next} ({s.timezone})
          </span>
        )}
        <div className="flex-1" />
        {s?.active && <span className="text-sm text-amber-600">Run #{s.active.id} {s.active.status.toLowerCase()}…</span>}
        <Button onClick={() => runNow('evening')} disabled={!!s?.active} title="Prepare tomorrow's evening preview now, with a wake-up time">
          🌙 Prepare tomorrow
        </Button>
        <Button variant="primary" onClick={() => runNow('morning')} disabled={!!s?.active} title="Run today's brief now">
          Run now
        </Button>
      </div>
      {header}
      {msg && <Status ok={msg.ok}>{msg.text}</Status>}
      {list.isError && <Status ok={false}>{(list.error as Error).message}</Status>}

      {list.data?.briefs.length === 0 && (
        <div className="rounded-lg border border-dashed border-ink-300 p-8 text-center text-sm text-ink-500 dark:border-ink-700">
          No brief yet. Set up the LLM in{' '}
          <Link to="/settings" className="underline">
            Settings
          </Link>
          , write a{' '}
          <Link to="/prompt" className="underline">
            master prompt
          </Link>
          , then <strong>Run now</strong>.
        </div>
      )}
      <div className={`grid gap-4 lg:grid-cols-[12rem_1fr] ${list.data?.briefs.length === 0 ? 'hidden' : ''}`}>
        <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {list.data?.briefs.map((b) => (
            <Link
              key={b.date}
              to={`/briefs/${b.date}`}
              className={`shrink-0 rounded-md px-2 py-1.5 text-sm ${b.date === date ? 'bg-ink-200 dark:bg-ink-800' : 'hover:bg-ink-100 dark:hover:bg-ink-900'}`}
            >
              <div className="font-medium">
                {b.shape === 'failure' ? '⚠️ ' : ''}
                {dayLabel(b.date)}
                {b.phase === 'evening' && <span title="Evening preview"> 🌙</span>}
                {b.wakeTime && <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400">⏰ {b.wakeTime}</span>}
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
