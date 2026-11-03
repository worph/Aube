/**
 * Local time in a named zone, without a date library. `localParts` / `fromLocal` are ported from
 * Newsdesk `server/src/pipeline/schedule.ts`.
 */

export interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** 0 = Sunday. */
  weekday: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
    formatters.set(timezone, f)
  }
  return f
}

export function localParts(at: Date, timezone: string): LocalParts {
  const parts = formatterFor(timezone).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  }
}

/** The UTC instant at which `timezone`'s clock reads the given local time (two-pass DST settle). */
export function fromLocal(timezone: string, date: { year: number; month: number; day: number }, hour: number, minute: number): Date {
  const wanted = Date.UTC(date.year, date.month - 1, date.day, hour, minute)
  let guess = new Date(wanted)
  for (let pass = 0; pass < 2; pass++) {
    const seen = localParts(guess, timezone)
    const drift = wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute)
    if (drift === 0) break
    guess = new Date(guess.getTime() + drift)
  }
  return guess
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` of `at` in `timezone`. */
export function localDate(at: Date, timezone: string): string {
  const p = localParts(at, timezone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function localHHMM(at: Date, timezone: string): string {
  const p = localParts(at, timezone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { year: y!, month: m!, day: d! }
}

/** The instant `HH:MM` on local `date` in `timezone`. */
export function atLocal(date: string, hhmm: string, timezone: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  return fromLocal(timezone, parseDate(date), h!, m!)
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date)
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function weekdayName(date: string): string {
  const { year, month, day } = parseDate(date)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
}

/** `HH:MM` → minutes from midnight; `24:00` → 1440. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

export function fromMinutes(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}
