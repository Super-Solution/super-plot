import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, type Mark, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const rows: R[] = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'].map((d, i) => ({ d, v: i + 1 }))
const line = (extra: R = {}): R => ({ type: 'line', x: 'd', y: 'v', data: rows, ...extra })
const scene = (spec: unknown): Scene => {
  const r = compilePlot(spec, { width: 640, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const lines = (s: Scene): Extract<Mark, { type: 'path' }>[] => s.marks.filter((m): m is Extract<Mark, { type: 'path' }> => m.type === 'path' && m.role === 'data' && !!m.stroke && !m.fill)

describe('splitAt: lines cut at given x values', () => {
  it('draws one piece without a cut and one more piece per cut', () => {
    expect(lines(scene(line()))).toHaveLength(1)
    expect(lines(scene(line({ splitAt: ['2026-03-01'] })))).toHaveLength(2)
    expect(lines(scene(line({ splitAt: ['2026-02-01', '2026-04-01'] })))).toHaveLength(3)
  })
  it('starts the new piece at the cut value, and a cut between two points starts it at the next one', () => {
    const at = scene(line({ splitAt: ['2026-03-01'] }))
    const between = scene(line({ splitAt: ['2026-02-15'] }))
    expect(lines(at).map(m => m.d.split('M').length - 1)).toEqual([1, 1])
    // 2 points then 3 points in both
    const pts = (m: { d: string }): number => new Set(m.d.match(/-?\d+(\.\d+)?(?= )/g)).size
    expect(lines(at).map(pts)).toEqual([2, 3])
    expect(lines(between).map(pts)).toEqual([2, 3])
  })
  it('cuts every series, keeps the legend and the rows of each piece', () => {
    const s = scene({ type: 'line', x: 'd', y: ['v', 'w'], data: rows.map(r => ({ ...r, w: 9 - (r.v as number) })), splitAt: ['2026-03-01'] })
    expect(lines(s)).toHaveLength(4)
    expect(new Set(lines(s).map(m => m.series))).toEqual(new Set(['v', 'w']))
  })
  it('cuts a category axis at the category that starts the new piece, and works with gaps: connect', () => {
    const cat = scene({ type: 'line', x: 'q', y: 'v', data: ['a', 'b', 'c', 'd'].map((q, i) => ({ q, v: i })), splitAt: ['c'] })
    expect(lines(cat)).toHaveLength(2)
    const holes = scene(line({ gaps: 'connect', splitAt: ['2026-04-01'], data: rows.map((r, i) => (i === 1 ? { ...r, v: null } : r)) }))
    expect(lines(holes)).toHaveLength(2)
  })
  it('ignores a value outside the data, and cuts areas the same way', () => {
    expect(lines(scene(line({ splitAt: ['2030-01-01'] })))).toHaveLength(1)
    const a = scene(line({ type: 'area', splitAt: ['2026-03-01'] }))
    expect(a.marks.filter(m => m.type === 'path' && m.role === 'data' && m.fill)).toHaveLength(2)
  })
  it('validates its type and size', () => {
    expect(validatePlot(line({ splitAt: ['2026-03-01'] })).ok).toBe(true)
    expect(validatePlot(line({ splitAt: '2026-03-01' })).issues[0]).toMatchObject({ code: 'bad_type', path: 'splitAt' })
    expect(validatePlot(line({ splitAt: Array.from({ length: 33 }, (_, i) => i) })).issues[0]).toMatchObject({ code: 'too_many' })
  })
})
