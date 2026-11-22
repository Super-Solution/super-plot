import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, isValueFormat, validatePlot, valueFormatter } from '../../packages/core/src'

const fmt = (f: string, locale = 'en') => valueFormatter(f, locale)

describe('format prefix', () => {
  it('prints the prefix before the value, after the minus sign', () => {
    expect(fmt('NT$^integer')(1234.4)).toBe('NT$1,234')
    expect(fmt('NT$^integer')(-1234.4)).toBe('-NT$1,234')
    expect(fmt('£^fixed:2')(5)).toBe('£5.00')
    expect(fmt('HK$^compact~ B')(2.5e3)).toBe('HK$2.5K B')
    expect(fmt('$^percent:1')(0.25)).toBe('$25.0%')
  })
  it('is part of the same grammar, with limits', () => {
    expect(isValueFormat('NT$^integer~ B')).toBe(true)
    expect(isValueFormat('^integer')).toBe(false)
    expect(isValueFormat('123456789^integer')).toBe(false)
    expect(isValueFormat('a^b^integer')).toBe(false)
    expect(isValueFormat('NT$^money')).toBe(false)
  })
  it('a suffix may hold a caret, and axis ticks carry the prefix', () => {
    expect(fmt('integer~x^2')(3)).toBe('3x^2')
    const r = compilePlot({ type: 'line', x: 'q', y: ['a'], format: '£^integer', data: [{ q: 'x', a: 40 }, { q: 'y', a: 90 }] }, { width: 600, height: 300 })
    if (!r.ok) throw new Error('compile')
    const ticks = r.scene.marks.filter(m => m.type === 'text' && (m as any).role === 'axis-label').map(m => (m as any).text as string)
    expect(ticks.some(t => /^£\d/.test(t))).toBe(true)
  })
})

const CYCLE = [
  { t: '2020', g: 'a', x: 1, y: 2 }, { t: '2022', g: 'a', x: 4, y: 3 }, { t: '2021', g: 'a', x: 3, y: 6 }, { t: '2023', g: 'a', x: 6, y: 1 },
  { t: '2020', g: 'b', x: 2, y: 8 }, { t: '2021', g: 'b', x: 5, y: 7 }
]
const scene = (spec: Record<string, unknown>) => {
  const r = compilePlot(spec as never, { width: 600, height: 400 })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}
const say = (spec: Record<string, unknown>): string => {
  const d = describePlot(spec)
  if (!d.ok) throw new Error(JSON.stringify(d.issues))
  return d.text
}
const pathsOf = (r: ReturnType<typeof scene>) => r.scene.marks.filter(m => m.type === 'path' && (m as any).role === 'data') as any[]

describe('scatter order', () => {
  it('joins each series in the order of the column, not the order of the rows', () => {
    const r = scene({ type: 'scatter', x: 'x', y: 'y', series: 'g', order: 't', data: CYCLE })
    const paths = pathsOf(r)
    expect(paths.map(p => p.series).sort()).toEqual(['a', 'b'])
    const a = paths.find(p => p.series === 'a').d as string
    // 4 points, so 1 M and 3 L; x increases along the path because order follows the year.
    expect(a.match(/[ML]/g)).toHaveLength(4)
    const xs = [...a.matchAll(/[ML]([\d.]+) /g)].map(m => Number(m[1]))
    expect(xs).toEqual([...xs].sort((p, q) => p - q))
  })
  it('draws no line without order, and none for a series of one point', () => {
    expect(pathsOf(scene({ type: 'scatter', x: 'x', y: 'y', series: 'g', data: CYCLE }))).toHaveLength(0)
    const one = scene({ type: 'scatter', x: 'x', y: 'y', series: 'g', order: 't', data: [...CYCLE.slice(0, 1), CYCLE[4], CYCLE[5]] })
    expect(pathsOf(one).map(p => p.series)).toEqual(['b'])
  })
  it('leaves a row with no order value as a dot off the line', () => {
    const rows = CYCLE.map((r, i) => (i === 1 ? { ...r, t: null } : r))
    const a = pathsOf(scene({ type: 'scatter', x: 'x', y: 'y', series: 'g', order: 't', data: rows })).find(p => p.series === 'a').d as string
    expect(a.match(/[ML]/g)).toHaveLength(3)
  })
  it('is said in the description, and warned about with hexagons', () => {
    expect(say({ type: 'scatter', x: 'x', y: 'y', order: 't', data: CYCLE })).toContain('joined by a line in the order of t')
    const v = validatePlot({ type: 'scatter', x: 'x', y: 'y', order: 't', density: 'hex', data: CYCLE } as never)
    expect(v.issues.some(i => i.code === 'order_ignored_density')).toBe(true)
  })
})

describe('region annotations', () => {
  const base = { type: 'scatter', x: 'x', y: 'y', xDomain: [0, 10], yDomain: [0, 10], data: CYCLE }
  const rects = (r: ReturnType<typeof scene>) => r.scene.marks.filter(m => m.type === 'rect' && (m as any).role === 'annotation') as any[]

  it('one corner makes a quadrant that runs to the edge of the plot', () => {
    const r = scene({ ...base, annotations: [{ xFrom: 5, yFrom: 5, label: 'Expansion' }] })
    const [q] = rects(r)
    const plot = r.scene.axes!.plot as { x: number; y: number; w: number; h: number }
    expect(q.x).toBeCloseTo(plot.x + plot.w / 2, 0)
    expect(q.x + q.w).toBeCloseTo(plot.x + plot.w, 0)
    expect(q.y).toBeCloseTo(plot.y, 0)
    expect(q.y + q.h).toBeCloseTo(plot.y + plot.h / 2, 0)
    expect(r.scene.marks.some(m => m.type === 'text' && (m as any).text === 'Expansion')).toBe(true)
  })
  it('four quadrants tile the plot', () => {
    const r = scene({ ...base, annotations: [{ xTo: 5, yTo: 5 }, { xFrom: 5, yTo: 5 }, { xTo: 5, yFrom: 5 }, { xFrom: 5, yFrom: 5 }] })
    const area = rects(r).reduce((s, q) => s + q.w * q.h, 0)
    const plot = r.scene.axes!.plot as { w: number; h: number }
    expect(area).toBeCloseTo(plot.w * plot.h, -1)
  })
  it('cuts a region at the plot and skips one wholly outside, with a warning', () => {
    const r = scene({ ...base, annotations: [{ xFrom: 8, xTo: 50, label: 'Wide' }, { xFrom: 20, xTo: 30, label: 'Out' }] })
    expect(rects(r)).toHaveLength(1)
    expect(r.issues.some(i => i.code === 'annotation_out_of_range' && i.path === 'annotations[1]')).toBe(true)
  })
  it('reads dates on a time axis', () => {
    const r = scene({ type: 'line', x: 'd', y: ['v'], annotations: [{ xFrom: '2026-02-01', xTo: '2026-03-01', label: 'Window' }], data: [{ d: '2026-01-01', v: 1 }, { d: '2026-02-15', v: 3 }, { d: '2026-04-01', v: 2 }] })
    expect(rects(r)).toHaveLength(1)
  })
  it('is skipped on a category axis, with a warning', () => {
    const r = scene({ type: 'bar', x: 'k', y: ['v'], annotations: [{ yFrom: 1, label: 'High' }, { xFrom: 1, label: 'No' }], data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }] })
    expect(r.issues.some(i => i.code === 'annotation_out_of_range')).toBe(true)
  })
  it('validates its own fields', () => {
    const bad = (a: unknown) => validatePlot({ ...base, annotations: [a] } as never).issues.filter(i => i.severity === 'error').map(i => i.code)
    expect(bad({ xFrom: 1, label: 'ok' })).toEqual([])
    expect(bad({ xFrom: null })).toEqual(['bad_type'])
    expect(bad({ yTo: true })).toEqual(['bad_type'])
    expect(bad({ xFrom: 1, to: 3 })).toEqual(['unknown_field'])
    expect(bad({ xFrom: 1, x: 2, y: 3, label: 'm' })).toContain('unknown_field')
    expect(bad({ xFrom: 1, tone: 'loud' })).toEqual(['bad_enum'])
  })
  it('is described, and by an assistant is said so', () => {
    const t = say({ ...base, annotations: [{ xFrom: 5, yFrom: 5, label: 'Expansion' }, { yTo: 2, label: 'Slump', by: 'assistant' }] })
    expect(t).toContain('Shaded: "Expansion" (x 5 to highest, y 5 to highest); "Slump" (y lowest to 2) (added by the assistant).')
  })
})
