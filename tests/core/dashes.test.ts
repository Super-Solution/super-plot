import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, renderToSvg, type Mark, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const rows: R[] = [
  { d: '2026-01-01', actual: 10, plan: 12 }, { d: '2026-02-01', actual: 14, plan: 15 },
  { d: '2026-03-01', actual: 13, plan: 18 }, { d: '2026-04-01', actual: 17, plan: 21 }
]
const line = (extra: R = {}): R => ({ type: 'line', x: 'd', y: ['actual', 'plan'], data: rows, legend: 'top', ...extra })
const scene = (spec: unknown): Scene => {
  const r = compilePlot(spec, { width: 640, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const dataPaths = (s: Scene): Extract<Mark, { type: 'path' }>[] => s.marks.filter((m): m is Extract<Mark, { type: 'path' }> => m.type === 'path' && m.role === 'data' && !!m.stroke)

describe('dashes: a line style per series', () => {
  it('draws the named series dashed and leaves the others solid', () => {
    const s = scene(line({ dashes: { plan: 'dashed' } }))
    const by = Object.fromEntries(dataPaths(s).map(m => [m.series, m.dash]))
    expect(by).toEqual({ actual: undefined, plan: '6 4' })
  })
  it('knows dotted and dashdot, and solid is the same as not naming it', () => {
    const by = (style: string): string | undefined => dataPaths(scene(line({ dashes: { plan: style } }))).find(m => m.series === 'plan')!.dash
    expect(by('dotted')).toBe('1 4')
    expect(by('dashdot')).toBe('8 4 1 4')
    expect(by('solid')).toBeUndefined()
  })
  it('draws the legend swatch of a dashed series as a dashed stroke, the others as a square', () => {
    const swatches = scene(line({ dashes: { plan: 'dashed' } })).marks.filter(m => m.role === 'legend' && m.legendKey === undefined && m.type !== 'text')
    expect(swatches.map(m => [m.type, m.series])).toEqual([['rect', 'actual'], ['line', 'plan']])
    expect(swatches[1]).toMatchObject({ dash: '6 4', stroke: expect.any(String) })
  })
  it('reaches the svg as stroke-dasharray', () => {
    const svg = renderToSvg(line({ dashes: { plan: 'dashed' } }), { width: 640, height: 400 })
    expect(svg).toMatch(/stroke-dasharray="6 4"/)
    expect(renderToSvg(line(), { width: 640, height: 400 })).not.toMatch(/stroke-dasharray/)
  })
  it('refuses anything but a line style, with the path of the entry', () => {
    const v = validatePlot(line({ dashes: { plan: '5 5; stroke:red', actual: 3 } }))
    expect(v.ok).toBe(false)
    expect(v.issues.map(i => [i.code, i.path]).sort()).toEqual([['bad_dash', 'dashes.actual'], ['bad_dash', 'dashes.plan']])
    expect(validatePlot(line({ dashes: ['dashed'] })).issues[0]).toMatchObject({ code: 'bad_type' })
  })
})
