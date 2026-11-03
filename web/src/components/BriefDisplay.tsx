import { useRef, useState } from 'react'
import type { BriefView } from '@aube/shared'
import { DayBand } from './DayBand'
import { Markdown } from './Markdown'
import { RunPanel } from './RunPanel'

/** One brief: the day band beside the markdown (stacked on a phone, band first; omitted when empty), and its run panel. */
export function BriefDisplay({ brief, timezone, today }: { brief: BriefView; timezone: string; today: string }) {
  const md = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState<Element | null>(null)
  // An empty band (a failure brief, or a day with nothing timed) only takes space.
  const hasBand = brief.events.length + brief.blocks.length > 0

  const highlight = (title: string) => {
    const root = md.current
    if (!root) return
    const needle = title.toLowerCase()
    const hit = [...root.querySelectorAll('p,li,h1,h2,h3,h4,td')].find((el) => el.textContent?.toLowerCase().includes(needle))
    if (!hit) return
    flash?.classList.remove('bg-amber-100', 'dark:bg-amber-900/40')
    hit.classList.add('bg-amber-100', 'dark:bg-amber-900/40')
    hit.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(hit)
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">{brief.title}</h2>
        <p className="text-sm text-ink-500">{brief.headline}</p>
      </div>
      {brief.shape !== 'contract' && (
        <div className={`rounded-md p-2 text-sm ${brief.shape === 'failure' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>
          {brief.shape === 'failure' ? 'This is a failure brief: the run could not produce one.' : 'Shown as the backend wrote it: the answer was not in the expected shape.'}
        </div>
      )}
      <div className={`grid gap-4 ${hasBand ? 'md:grid-cols-[minmax(260px,340px)_1fr]' : ''}`}>
        {hasBand && (
          <div className="md:sticky md:top-16 md:self-start">
            <DayBand date={brief.date} timezone={timezone} events={brief.events} blocks={brief.blocks} asOf={brief.asOf} isToday={brief.date === today} onSelect={highlight} />
            {brief.itemsDropped > 0 && <p className="mt-1 text-xs text-ink-500">{brief.itemsDropped} item(s) could not be placed.</p>}
          </div>
        )}
        <div className="min-w-0 rounded-lg border border-ink-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
          <Markdown ref={md} text={brief.markdown} />
        </div>
      </div>
      <RunPanel brief={brief} />
    </div>
  )
}
