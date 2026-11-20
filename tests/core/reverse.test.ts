import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const rows: R[] = [
  { d: '2026-01-01', rank: 3, price: 10 }, { d: '2026-02-01', rank: 1, price: 12 },
  { d: '2026-03-01', rank: 5, price: 14 }, { d: '2026-04-01', rank: 2, price: 13 }
]
const spec = (extra: R = {}): R => ({ type: 'line', x: 'd', y: 'rank', data: rows, ...extra })
const scene = (s: unknown): Scene => {
  const r = compilePlot(s, { width: 640, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}

describe('yReverse and rightReverse: value axes drawn upside down', () => {
  it('puts the larger value lower on the left axis, ticks and marks agree', () => {
    const up = scene(spec()).axes!
    const down = scene(spec({ yReverse: true })).axes!
    const [top, bottom] = [down.plot.y, down.plot.y + down.plot.h]
    expect(up.y.range).toEqual([bottom, top])
    expect(down.y.range).toEqual([top, bottom])
    expect(down.y.domain).toEqual(up.y.domain)
  })
  it('turns the right axis over on its own, the left one stays', () => {
    const a = scene(spec({ yRight: 'price', rightReverse: true })).axes!
    const [top, bottom] = [a.plot.y, a.plot.y + a.plot.h]
    expect(a.y.range).toEqual([bottom, top])
    expect(a.y2!.range).toEqual([top, bottom])
  })
  it('draws the smallest value at the top of a reversed axis and the largest at the bottom', () => {
    const ys = (extra: R): number[] => {
      const m = scene(spec(extra)).marks.find(m => m.type === 'path' && m.role === 'data')!
      return [...(m as { d: string }).d.matchAll(/[ML]\s*[\d.]+[ ,]([\d.]+)/g)].map(x => Number(x[1]))
    }
    const normal = ys({})
    const flipped = ys({ yReverse: true })
    expect(normal).toHaveLength(4)
    // rows: rank 3, 1, 5, 2; the smallest (index 1) is lowest on the page normally, highest when reversed
    expect(normal[1]).toBe(Math.max(...normal))
    expect(flipped[1]).toBe(Math.min(...flipped))
    expect(flipped[2]).toBe(Math.max(...flipped))
  })
  it('a right-axis option without yRight is flagged; yReverse with yBreak is refused', () => {
    expect(validatePlot(spec({ rightReverse: true })).issues.map(i => i.code)).toContain('right_axis_unused')
    const v = validatePlot(spec({ yReverse: true, yBreak: [2, 4] }))
    expect(v.issues.map(i => i.code)).toContain('break_refused')
  })
})
