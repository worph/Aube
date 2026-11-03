import { useEffect, useMemo, useRef, useState } from 'react'
import { fromMinutes, initialScrollMin, layoutLane, localParts, type NormBlock, type NormEvent } from '@aube/shared'

/**
 * The day band (ARCHITECTURE §4): a 00:00–24:00 timeline with two lanes on one scale — events
 * (solid) and the proposed plan (light tint). Layout is the pure `layoutLane` from shared; this
 * component only draws. A snapshot as of the run: nothing here is live or editable.
 */

const PX_PER_MIN = 1.1
const MIN_ITEM_PX = 20

const PALETTE = ['bg-sky-600', 'bg-violet-600', 'bg-emerald-600', 'bg-rose-600', 'bg-amber-600', 'bg-teal-600', 'bg-indigo-600', 'bg-fuchsia-600']
function sourceColor(source?: string): string {
  if (!source) return 'bg-ink-600'
  let h = 0
  for (const c of source) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

const KIND: Record<string, { icon: string; cls: string }> = {
  focus: { icon: '🎯', cls: 'bg-indigo-100 border-indigo-300 text-indigo-900 dark:bg-indigo-950/60 dark:border-indigo-800 dark:text-indigo-100' },
  task: { icon: '✅', cls: 'bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-950/60 dark:border-sky-800 dark:text-sky-100' },
  'meeting-prep': { icon: '📋', cls: 'bg-slate-100 border-slate-300 text-slate-900 dark:bg-slate-900/60 dark:border-slate-700 dark:text-slate-100' },
  sport: { icon: '🏋️', cls: 'bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-950/60 dark:border-orange-800 dark:text-orange-100' },
  meal: { icon: '🍽️', cls: 'bg-lime-100 border-lime-300 text-lime-900 dark:bg-lime-950/60 dark:border-lime-800 dark:text-lime-100' },
  travel: { icon: '🚶', cls: 'bg-yellow-100 border-yellow-300 text-yellow-900 dark:bg-yellow-950/60 dark:border-yellow-800 dark:text-yellow-100' },
  break: { icon: '☕', cls: 'bg-stone-100 border-stone-300 text-stone-900 dark:bg-stone-900/60 dark:border-stone-700 dark:text-stone-100' },
  other: { icon: '•', cls: 'bg-ink-100 border-ink-300 text-ink-900 dark:bg-ink-900/60 dark:border-ink-700 dark:text-ink-100' },
}

export interface DayBandProps {
  date: string
  timezone: string
  events: NormEvent[]
  blocks: NormBlock[]
  asOf: string
  isToday: boolean
  onSelect?: (title: string) => void
}

export function DayBand({ date, timezone, events, blocks, asOf, isToday, onSelect }: DayBandProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [nowMin, setNowMin] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [popover, setPopover] = useState<string | null>(null)

  useEffect(() => {
    if (!isToday) return setNowMin(null)
    const tick = () => {
      const p = localParts(new Date(), timezone)
      setNowMin(p.hour * 60 + p.minute)
    }
    tick()
    const t = setInterval(tick, 60_000)
    return () => clearInterval(t)
  }, [isToday, timezone])

  const timed = useMemo(() => events.filter((e) => !e.allDay && e.startMin !== null) as Array<NormEvent & { startMin: number; endMin: number }>, [events])
  const allDay = events.filter((e) => e.allDay)
  const eventLane = useMemo(() => layoutLane(timed), [timed])
  const planLane = useMemo(() => layoutLane(blocks), [blocks])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = initialScrollMin([...timed, ...blocks], nowMin) * PX_PER_MIN
    // Only on open / date change, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, timed.length, blocks.length, isToday])

  const asOfLocal = (() => {
    const p = localParts(new Date(asOf), timezone)
    return fromMinutes(p.hour * 60 + p.minute)
  })()

  const select = (title: string) => {
    setPopover((cur) => (cur === title ? null : title))
    onSelect?.(title)
  }

  const item = (key: string, top: number, height: number, col: number, cols: number, cls: string, body: React.ReactNode, title: string, extra = '') => (
    <button
      key={key}
      type="button"
      onClick={() => select(title)}
      title={title}
      className={`absolute overflow-hidden rounded px-1 text-left text-[11px] leading-tight ${cls} ${extra}`}
      style={{ top, height: Math.max(height, MIN_ITEM_PX), left: `calc(${(col / cols) * 100}% + 1px)`, width: `calc(${100 / cols}% - 2px)` }}
    >
      {body}
    </button>
  )

  return (
    <div className="flex flex-col rounded-lg border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-200 px-2 py-1 text-xs text-ink-500 dark:border-ink-800">
        <span>as of {asOfLocal}</span>
        <button type="button" className="sm:hidden" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-ink-200 p-1 dark:border-ink-800">
          {allDay.map((e, i) => (
            <span key={i} className={`rounded px-1.5 py-0.5 text-[11px] text-white ${sourceColor(e.source)}`}>
              {e.title}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[2.5rem_1fr_1fr] border-b border-ink-200 text-[11px] font-medium text-ink-500 dark:border-ink-800">
        <span />
        <span className="px-1">Events</span>
        <span className="px-1">Plan</span>
      </div>
      <div ref={scroller} className={`relative overflow-y-auto ${expanded ? 'max-h-[75vh]' : 'max-h-[360px]'} sm:max-h-[75vh]`}>
        <div className="relative grid grid-cols-[2.5rem_1fr_1fr]" style={{ height: 1440 * PX_PER_MIN }}>
          {/* hour lines */}
          {Array.from({ length: 25 }, (_, h) => (
            <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-ink-100 dark:border-ink-800" style={{ top: h * 60 * PX_PER_MIN }}>
              <span className="absolute -top-2 left-1 bg-white px-0.5 text-[10px] text-ink-400 dark:bg-ink-900">{String(h).padStart(2, '0')}</span>
            </div>
          ))}
          <div />
          <div className="relative border-l border-ink-100 dark:border-ink-800">
            {eventLane.map(({ item: e, col, cols }, i) =>
              item(
                `e${i}`,
                e.startMin * PX_PER_MIN,
                (e.endMin - e.startMin) * PX_PER_MIN,
                col,
                cols,
                `text-white ${sourceColor(e.source)}`,
                <>
                  <span className="font-semibold">{fromMinutes(e.startMin)}</span> {e.title}
                  {e.crossesMidnight && ' ↓'}
                </>,
                e.title,
                e.openEnd ? 'border-b-2 border-dashed border-white/70' : '',
              ),
            )}
          </div>
          <div className="relative border-l border-ink-100 dark:border-ink-800">
            {planLane.map(({ item: b, col, cols }, i) => {
              const k = KIND[b.kind] ?? KIND.other!
              return item(
                `b${i}`,
                b.startMin * PX_PER_MIN,
                (b.endMin - b.startMin) * PX_PER_MIN,
                col,
                cols,
                `border ${k.cls}`,
                <>
                  {k.icon} {b.title}
                </>,
                b.title,
                `${b.overlapsEvent ? 'outline-2 outline-dashed outline-red-400' : ''} ${b.openEnd ? 'border-b-2 border-b-dashed' : ''}`,
              )
            })}
          </div>
          {nowMin !== null && (
            <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: nowMin * PX_PER_MIN }}>
              <span className="absolute -top-2.5 left-0 rounded bg-red-500 px-1 text-[10px] text-white">now</span>
            </div>
          )}
        </div>
      </div>
      {popover && <div className="border-t border-ink-200 p-2 text-xs dark:border-ink-800">{popover}</div>}
      {timed.length === 0 && blocks.length === 0 && <div className="p-2 text-xs text-ink-500">Nothing reported for the band.</div>}
    </div>
  )
}
