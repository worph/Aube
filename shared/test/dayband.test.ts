import { describe, expect, it } from 'vitest'
import { initialScrollMin, layoutLane } from '../src/dayband.js'

const s = (startMin: number, endMin: number, id = `${startMin}`) => ({ id, startMin, endMin })

describe('day band layout', () => {
  it('keeps non-overlapping items in one column', () => {
    const out = layoutLane([s(60, 120), s(120, 180)])
    expect(out.map((p) => [p.col, p.cols])).toEqual([
      [0, 1],
      [0, 1],
    ])
  })

  it('places two and three overlapping items side by side', () => {
    expect(layoutLane([s(60, 180), s(90, 120)]).map((p) => [p.col, p.cols])).toEqual([
      [0, 2],
      [1, 2],
    ])
    expect(layoutLane([s(60, 180), s(70, 180), s(80, 180)]).map((p) => p.cols)).toEqual([3, 3, 3])
  })

  it('reuses a freed column within a chain cluster', () => {
    // A(0-60) overlaps B(30-90); C(60-120) starts when A ends → column 0 again; all share 2 columns.
    const out = layoutLane([s(0, 60, 'A'), s(30, 90, 'B'), s(60, 120, 'C')])
    const byId = Object.fromEntries(out.map((p) => [p.item.id, p]))
    expect(byId.C!.col).toBe(0)
    expect(out.every((p) => p.cols === 2)).toBe(true)
  })

  it('scrolls to now, the first item, or 07:00', () => {
    expect(initialScrollMin([], 600)).toBe(540)
    expect(initialScrollMin([s(480, 500)], null)).toBe(450)
    expect(initialScrollMin([], null)).toBe(420)
  })
})
