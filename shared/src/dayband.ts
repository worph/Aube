/**
 * Day band layout (IMPLEMENTATION §11.1): items that overlap within one lane are placed side by
 * side. The standard sweep — sort by start, group into clusters of transitively overlapping items,
 * give each item the first free column of its cluster; its width is 1 / the cluster's columns.
 * Pure, so it is tested here and the component only draws.
 */

export interface Span {
  startMin: number
  endMin: number
}

export interface Placed<T extends Span> {
  item: T
  col: number
  cols: number
}

export function layoutLane<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const out: Placed<T>[] = []
  let cluster: Placed<T>[] = []
  let clusterEnd = -1
  let colEnds: number[] = []

  const flush = () => {
    const cols = Math.max(1, colEnds.length)
    for (const p of cluster) p.cols = cols
    out.push(...cluster)
    cluster = []
    colEnds = []
  }

  for (const item of sorted) {
    // Zero-length items still take one minute of space.
    const end = Math.max(item.endMin, item.startMin + 1)
    if (cluster.length && item.startMin >= clusterEnd) flush()
    let col = colEnds.findIndex((e) => e <= item.startMin)
    if (col < 0) {
      col = colEnds.length
      colEnds.push(end)
    } else colEnds[col] = end
    cluster.push({ item, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, end)
  }
  if (cluster.length) flush()
  return out
}

/** Where to scroll on open: now (today), else the first item or the wake-up time, else 07:00. */
export function initialScrollMin(items: Span[], nowMin: number | null, wakeMin: number | null = null): number {
  if (nowMin !== null) return Math.max(0, nowMin - 60)
  // Another day (an evening preview of tomorrow): open on the wake-up time when it comes first.
  const first = items.reduce((m, i) => Math.min(m, i.startMin), wakeMin ?? Infinity)
  return Number.isFinite(first) ? Math.max(0, first - 30) : 7 * 60
}
