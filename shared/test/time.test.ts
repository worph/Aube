import { describe, expect, it } from 'vitest'
import { addDays, atLocal, localDate, localHHMM, weekdayName } from '../src/time.js'

describe('time in a zone', () => {
  it('maps local times to instants across DST', () => {
    // Paris is UTC+1 in winter, UTC+2 in summer.
    expect(atLocal('2026-11-04', '05:00', 'Europe/Paris').toISOString()).toBe('2026-11-04T04:00:00.000Z')
    expect(atLocal('2026-07-01', '05:00', 'Europe/Paris').toISOString()).toBe('2026-07-01T03:00:00.000Z')
    // 2026-03-29 02:30 does not exist in Paris: lands on the next valid time.
    expect(localHHMM(atLocal('2026-03-29', '02:30', 'Europe/Paris'), 'Europe/Paris')).toBe('03:30')
  })

  it('formats local dates', () => {
    expect(localDate(new Date('2026-11-03T23:30:00Z'), 'Europe/Paris')).toBe('2026-11-04')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekdayName('2026-11-04')).toBe('Wednesday')
  })
})
