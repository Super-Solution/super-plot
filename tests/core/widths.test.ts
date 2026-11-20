import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, type Mark, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const rows: R[] = [
  { d: '2026-01-01', total: 30, a: 10, b: 20 }, { d: '2026-02-01', total: 34, a: 12, b: 22 },
  { d: '2026-03-01', total: 31, a: 9, b: 22 }, { d: '2026-04-01', total: 40, a: 15, b: 25 }
]
const line = (extra: R = {}): R => ({ type: 'line', x: 'd', y: ['total', 'a', 'b'], data: rows, ...extra })
const scene = (spec: unknown): Scene => {
  const r = compilePlot(spec, { width: 640, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const widthsOf = (s: Scene): Record<string, number | undefined> =>
  Object.fromEntries(s.marks.filter((m): m is Extract<Mark, { type: 'path' }> => m.type === 'path' && m.role === 'data' && !!m.stroke).map(m => [m.series, m.strokeWidth]))

describe('widths: a line width per series', () => {
  it('gives the named series its width and the others the theme width', () => {
    const base = widthsOf(scene(line()))
    expect(new Set(Object.values(base)).size).toBe(1)
    const theme = base.a
    const w = widthsOf(scene(line({ widths: { total: 4, b: 0.5 } })))
    expect(w).toEqual({ total: 4, a: theme, b: 0.5 })
  })
  it('refuses a width outside 0.5 to 8 px, a non-number or a non-object, naming the entry', () => {
    const v = validatePlot(line({ widths: { total: 12, a: '3', b: 0.1, ok: 2 } }))
    expect(v.ok).toBe(false)
    expect(v.issues.map(i => [i.code, i.path]).sort()).toEqual([['bad_width', 'widths.a'], ['bad_width', 'widths.b'], ['bad_width', 'widths.total']])
    expect(validatePlot(line({ widths: [2] })).issues[0]).toMatchObject({ code: 'bad_type' })
  })
})
