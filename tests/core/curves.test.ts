import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, type Mark, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const rows: R[] = [
  { d: '2026-01-01', rate: 2, target: 2 }, { d: '2026-02-01', rate: 3, target: 2 },
  { d: '2026-03-01', rate: 2.5, target: 3 }, { d: '2026-04-01', rate: 4, target: 3 }
]
const line = (extra: R = {}): R => ({ type: 'line', x: 'd', y: ['rate', 'target'], data: rows, ...extra })
const scene = (spec: unknown): Scene => {
  const r = compilePlot(spec, { width: 640, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const pathOf = (s: Scene, series: string): string =>
  (s.marks.find((m): m is Extract<Mark, { type: 'path' }> => m.type === 'path' && m.role === 'data' && m.series === series && !!m.stroke))!.d

describe('curves: a curve per series', () => {
  it('draws the named series with its curve, the others with `curve`', () => {
    const plain = scene(line())
    const mixed = scene(line({ curves: { target: 'step' } }))
    expect(pathOf(mixed, 'rate')).toBe(pathOf(plain, 'rate'))
    expect(pathOf(mixed, 'target')).not.toBe(pathOf(plain, 'target'))
    // a step holds each value until the next point: it has horizontal and vertical runs
    expect(pathOf(mixed, 'target')).toMatch(/[HV]/)
    expect(pathOf(plain, 'target')).not.toMatch(/[HV]/)
  })
  it('overrides a chart-wide curve for the series it names', () => {
    const s = scene(line({ curve: 'smooth', curves: { target: 'linear' } }))
    expect(pathOf(s, 'target')).not.toMatch(/C/)
    expect(pathOf(s, 'rate')).toMatch(/C/)
  })
  it('refuses a curve it does not know, naming the entry and suggesting the nearest', () => {
    const v = validatePlot(line({ curves: { target: 'stepp', rate: 3 } }))
    expect(v.ok).toBe(false)
    expect(v.issues.map(i => [i.code, i.path]).sort()).toEqual([['bad_enum', 'curves.rate'], ['bad_enum', 'curves.target']])
    expect(v.issues.find(i => i.path === 'curves.target')!.hint).toBe('Did you mean "step"?')
    expect(validatePlot(line({ curves: ['step'] })).issues[0]).toMatchObject({ code: 'bad_type' })
  })
})
