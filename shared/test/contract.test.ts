import { describe, expect, it } from 'vitest'
import { parseAnswer } from '../src/contract.js'

const base = { title: 'T', headline: 'H', brief_markdown: 'B' }

describe('answer contract', () => {
  it('accepts a full answer and normalises the band', () => {
    const r = parseAnswer({
      ...base,
      events: [
        { start: '10:00', end: '11:00', title: 'Review' },
        { all_day: true, title: 'Birthday' },
        { start: '14:30', title: 'Dentist' },
        { start: '23:00', end: '01:00', title: 'Night deploy' },
      ],
      blocks: [
        { start: '08:30', end: '10:00', title: 'Deep work', kind: 'focus' },
        { start: '10:30', end: '11:30', title: 'Prep', kind: 'weird' },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const a = r.answer
    expect(a.events.map((e) => e.title)).toEqual(['Birthday', 'Review', 'Dentist', 'Night deploy'])
    const dentist = a.events.find((e) => e.title === 'Dentist')!
    expect(dentist).toMatchObject({ startMin: 870, endMin: 900, openEnd: true })
    expect(a.events.find((e) => e.title === 'Night deploy')).toMatchObject({ endMin: 1440, crossesMidnight: true })
    expect(a.blocks[0]).toMatchObject({ kind: 'focus', overlapsEvent: false })
    expect(a.blocks[1]).toMatchObject({ kind: 'other', overlapsEvent: true })
    expect(a.dropped).toBe(0)
  })

  it('drops bad items without failing the brief, and collapses duplicates', () => {
    const r = parseAnswer({
      ...base,
      events: [{ start: '25:00', title: 'x' }, { title: 'no time' }, 'nonsense', { start: '09:00', end: '10:00', title: 'A' }, { start: '09:00', end: '10:00', title: 'A' }],
      blocks: [{ start: '9am', title: 'y' }],
    })
    expect(r.ok && r.answer.dropped).toBe(4)
    expect(r.ok && r.answer.events.length).toBe(1)
  })

  it('rejects an answer without the required brief fields', () => {
    const r = parseAnswer({ title: 'T', brief_markdown: 'B' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join()).toMatch(/headline/)
    expect(parseAnswer({ ...base, headline: 'x'.repeat(141) }).ok).toBe(false)
  })

  it('keeps a valid wake-up time and drops a bad one without failing the brief', () => {
    const ok = parseAnswer({ ...base, wake_up: { time: '06:40', reason: 'Review at 10:00' } })
    expect(ok.ok && ok.answer.wakeUp).toEqual({ time: '06:40', timeMin: 400, reason: 'Review at 10:00' })
    for (const bad of [{ time: '6:40' }, { time: '24:00' }, { reason: 'no time' }, '06:40']) {
      const r = parseAnswer({ ...base, wake_up: bad })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.answer.wakeUp).toBeUndefined()
        expect(r.answer.dropped).toBe(1)
      }
    }
    const none = parseAnswer(base)
    expect(none.ok && none.answer.wakeUp).toBeUndefined()
  })

  it('treats missing lists as empty', () => {
    const r = parseAnswer(base)
    expect(r.ok && r.answer.events).toEqual([])
  })
})
