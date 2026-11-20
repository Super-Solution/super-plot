import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, type Mark, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']
const rows: R[] = months.map((d, i) => ({ d, a: i + 1, b: 9 - i }))
const line = (extra: R = {}): R => ({ type: 'line', x: 'd', y: ['a', 'b'], data: rows, ...extra })
const scene = (spec: unknown): Scene => {
  const r = compilePlot(spec, { width: 640, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const pieces = (s: Scene, series: string): number => s.marks.filter((m): m is Extract<Mark, { type: 'path' }> => m.type === 'path' && m.role === 'data' && m.series === series && !!m.stroke && !m.fill).length

describe('splits: cut only the named series', () => {
  it('cuts the named series and leaves the others whole', () => {
    const s = scene(line({ splits: { a: ['2026-03-01'] } }))
    expect(pieces(s, 'a')).toBe(2)
    expect(pieces(s, 'b')).toBe(1)
  })
  it('adds up with splitAt, which cuts every series', () => {
    const s = scene(line({ splitAt: ['2026-02-01'], splits: { b: ['2026-04-01'] } }))
    expect(pieces(s, 'a')).toBe(2)
    expect(pieces(s, 'b')).toBe(3)
  })
  it('works with long-form series, and ignores a name that is not a series', () => {
    const long = months.flatMap((d, i) => [{ d, g: 'x', v: i }, { d, g: 'y', v: 5 - i }])
    const s = scene({ type: 'line', x: 'd', y: 'v', series: 'g', data: long, splits: { y: ['2026-03-01'], nobody: ['2026-02-01'] } })
    expect(pieces(s, 'x')).toBe(1)
    expect(pieces(s, 'y')).toBe(2)
  })
  it('validates its shape, entry by entry', () => {
    expect(validatePlot(line({ splits: { a: ['2026-03-01'], b: [3] } })).ok).toBe(true)
    expect(validatePlot(line({ splits: ['x'] })).issues[0]).toMatchObject({ code: 'bad_type', path: 'splits' })
    const v = validatePlot(line({ splits: { a: 'x', b: ['ok', true], c: Array.from({ length: 33 }, (_, i) => i) } }))
    expect(v.issues.map(i => [i.code, i.path]).sort()).toEqual([['bad_type', 'splits.a'], ['bad_type', 'splits.b[1]'], ['too_many', 'splits.c']])
  })
})
