import { describe, expect, it } from 'vitest'
import { compilePlot, renderToSvg, validatePlot, applyTransform, resolveTheme, drawScene, type Scene, type Mark, type Issue } from '../../packages/core/src'

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => i.code)
const data = (m: Mark[]): Mark[] => m.filter(x => x.role === 'data')

const sales = [
  { date: '2026-01-05', region: 'APAC', revenue: 10 }, { date: '2026-01-20', region: 'APAC', revenue: 14 },
  { date: '2026-02-03', region: 'APAC', revenue: 12 }, { date: '2026-02-17', region: 'EMEA', revenue: 8 },
  { date: '2026-03-02', region: 'EMEA', revenue: 11 }, { date: '2026-03-30', region: 'APAC', revenue: 20 },
  { date: '2026-01-11', region: 'EMEA', revenue: 6 }, { date: '2026-02-25', region: 'LATAM', revenue: 3 }
]

describe('transform', () => {
  it('filters, buckets by month and aggregates before the chart reads its columns', () => {
    const r = validatePlot({
      type: 'line', x: 'month', y: 'revenue', series: 'region', data: sales,
      transform: [
        { filter: { field: 'region', oneOf: ['APAC', 'EMEA'] } },
        { timeUnit: { field: 'date', unit: 'month', as: 'month' } },
        { aggregate: { groupBy: ['month', 'region'], fields: { revenue: 'sum' }, count: 'n' } }
      ]
    })
    expect(r.ok).toBe(true)
    const rows = r.spec!.data as Record<string, unknown>[]
    expect(rows).toContainEqual({ month: '2026-01-01', region: 'APAC', revenue: 24, n: 2 })
    expect(rows).toContainEqual({ month: '2026-03-01', region: 'EMEA', revenue: 11, n: 1 })
    expect(rows.some(x => x.region === 'LATAM')).toBe(false)
  })

  it('checks each step against the columns of the step before', () => {
    const r = validatePlot({ type: 'bar', x: 'region', y: 'total', data: sales, transform: [{ aggregate: { groupBy: ['region'], fields: { revenue: 'sum' } } }, { sort: { field: 'date' } }] })
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toMatchObject({ code: 'no_such_column', path: 'transform[1].sort.field' })
  })

  it('points at the bad operation with a suggestion', () => {
    const r = validatePlot({ type: 'bar', x: 'region', y: 'revenue', data: sales, transform: [{ filtr: { field: 'region', equal: 'APAC' } }] })
    expect(r.issues[0]).toMatchObject({ code: 'bad_transform', path: 'transform[0]', hint: 'Did you mean "filter"?' })
    expect(codes({ type: 'bar', x: 'region', y: 'revenue', data: sales, transform: [{ aggregate: { groupBy: ['region'], fields: { revenue: 'avg' } } }] })).toContain('bad_enum')
  })

  it('ranges are from inclusive, to exclusive, and read ISO dates', () => {
    const out = applyTransform([{ filter: { field: 'date', range: ['2026-02-01', '2026-03-02'] } }], sales, [])!
    expect(out.map(r => r.date).sort()).toEqual(['2026-02-03', '2026-02-17', '2026-02-25'])
  })

  it('top keeps the n largest rows; an empty result is an error', () => {
    const out = applyTransform([{ top: { n: 2, by: 'revenue' } }], sales, [])!
    expect(out.map(r => r.revenue)).toEqual([20, 14])
    expect(codes({ type: 'bar', x: 'region', y: 'revenue', data: sales, transform: [{ filter: { field: 'revenue', gt: 1000 } }] })).toContain('empty_after_transform')
  })

  it('median, mean and distinct', () => {
    const issues: Issue[] = []
    const out = applyTransform([{ aggregate: { groupBy: ['region'], fields: { revenue: 'median', date: 'distinct' } } }], sales, issues)!
    expect(out.find(r => r.region === 'APAC')).toEqual({ region: 'APAC', revenue: 13, date: 4 })
  })
})

describe('facet (small multiples)', () => {
  const spec = { type: 'scatter', x: 'date', y: 'revenue', facet: 'region', data: sales, title: 'By region' }
  it('draws one panel per value, sharing axes, colours and one legend', () => {
    const s = compile(spec)
    expect(s.panels?.map(p => p.key)).toEqual(['APAC', 'EMEA', 'LATAM'])
    expect(s.description).toContain('Split into 3 panels by region')
    // Panels do not overlap.
    const [a, b] = s.panels!
    expect(a.plot.x + a.plot.w <= b.plot.x || a.plot.y + a.plot.h <= b.plot.y).toBe(true)
    // Same y ticks in every panel: shared domain.
    const labels = s.marks.filter(m => m.type === 'text' && m.role === 'axis-label').map(m => (m as { text: string }).text)
    expect(labels.filter(t => t === '20').length).toBe(3)
    expect(data(s.marks)).toHaveLength(sales.length)
  })
  it('warns past 12 panels and ignores zoom', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ k: `g${i}`, x: i, y: i }))
    const r = compilePlot({ type: 'scatter', x: 'x', y: 'y', facet: 'k', zoom: 'x', data: many }, { width: 900, height: 700 })
    expect(r.ok && r.issues.map(i => i.code)).toEqual(expect.arrayContaining(['too_many_facets', 'zoom_unsupported']))
    expect(r.ok && r.scene.panels).toHaveLength(12)
  })
})

describe('axes, zoom and brush in the scene', () => {
  const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 }))
  it('records the plot and both scales', () => {
    const s = compile({ type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'xy', brush: 'x' })
    expect(s.axes).toMatchObject({ x: { kind: 'linear', field: 'x' }, y: { kind: 'linear', field: 'y' }, zoom: 'xy', brush: 'x' })
  })
  it('a view override narrows the x range of a line and cuts it at the plot edge', () => {
    const s = compile({ type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { view: { x: [10, 20] } })
    expect(s.axes!.x.domain).toEqual([10, 20])
    expect(s.clips?.plot).toBeDefined()
    expect(s.marks.filter(m => m.role === 'hit').length).toBeLessThanOrEqual(12)
  })
  it('categories cannot zoom; they can be brushed', () => {
    const r = compilePlot({ type: 'bar', x: 'region', y: 'revenue', data: sales, zoom: 'x', brush: 'x' })
    expect(r.ok && r.issues.map(i => i.code)).toContain('zoom_unsupported')
    expect(r.ok && r.scene.axes).toMatchObject({ x: { kind: 'band', field: 'region' }, brush: 'x' })
    expect(r.ok && r.scene.axes?.zoom).toBeUndefined()
  })
  it('domains accept ISO dates', () => {
    const r = validatePlot({ type: 'line', x: 'date', y: 'revenue', data: sales, xDomain: ['2026-02-01', null] })
    expect(r.spec?.xDomain).toEqual([Date.UTC(2026, 1, 1), null])
  })
})

describe('combo: lines over bars', () => {
  const rows = [{ m: 'Jan', sales: 10, target: 12 }, { m: 'Feb', sales: 14, target: 12 }, { m: 'Mar', sales: 9, target: 13 }]
  it('draws the line column on the same axis, in the legend', () => {
    const s = compile({ type: 'bar', x: 'm', y: 'sales', line: 'target', data: rows })
    expect(s.series.map(x => x.key)).toEqual(['sales', 'target'])
    expect(s.marks.filter(m => m.type === 'circle' && m.series === 'target')).toHaveLength(3)
    expect(s.marks.some(m => m.type === 'path' && m.series === 'target')).toBe(true)
  })
  it('is ignored with a warning on horizontal bars', () => {
    expect(codes({ type: 'bar', x: 'm', y: 'sales', line: 'target', orientation: 'horizontal', data: rows })).toContain('line_ignored')
  })
})

describe('scatter density', () => {
  const many = Array.from({ length: 12000 }, (_, i) => ({ x: Math.sin(i) * 100, y: Math.cos(i * 1.3) * 50 }))
  it('auto switches to hexagons past 10,000 points, with a count legend', () => {
    const s = compile({ type: 'scatter', x: 'x', y: 'y', data: many, density: 'auto' })
    const hexes = data(s.marks)
    expect(hexes.length).toBeGreaterThan(50)
    expect(hexes.length).toBeLessThan(5000)
    expect(hexes.every(m => m.type === 'path')).toBe(true)
    const total = hexes.reduce((a, m) => a + ((m.datum as { count: number }).count), 0)
    expect(total).toBe(12000)
  })
  it('points stay points by default', () => {
    const s = compile({ type: 'scatter', x: 'x', y: 'y', data: many.slice(0, 3000) })
    expect(data(s.marks).every(m => m.type === 'circle')).toBe(true)
  })
})

describe('patterns', () => {
  const spec = { type: 'bar', x: 'region', y: ['Q1', 'Q2'], patterns: true, data: [{ region: 'A', Q1: 1, Q2: 2 }, { region: 'B', Q1: 3, Q2: 1 }] }
  it('gives each series its own texture, on bars and legend swatches', () => {
    const s = compile(spec)
    const bars = data(s.marks)
    expect(new Set(bars.map(b => b.pattern))).toEqual(new Set([0, 1]))
    expect(s.marks.filter(m => m.role === 'legend' && m.pattern !== undefined)).toHaveLength(2)
  })
  it('SVG defines the patterns and draws them over the fill', () => {
    const svg = renderToSvg(spec)
    expect(svg).toContain('<pattern id="sp-p0"')
    expect(svg).toContain('fill="url(#sp-p1)"')
  })
})

describe('plugins', () => {
  it('afterCompile can add marks; a throwing plugin becomes a warning', () => {
    const r = compilePlot({ type: 'bar', x: 'region', y: 'revenue', data: sales }, {
      plugins: [
        { name: 'stamp', afterCompile: s => ({ ...s, marks: [...s.marks, { type: 'text', role: 'annotation', x: 10, y: 10, text: 'DRAFT', size: 12, fill: 'red' }] }) },
        { name: 'broken', afterCompile: () => { throw new Error('nope') } }
      ]
    })
    expect(r.ok && r.scene.marks.some(m => m.type === 'text' && m.text === 'DRAFT')).toBe(true)
    expect(r.ok && r.issues.find(i => i.code === 'plugin_error')?.message).toContain('broken')
  })
})

describe('shadcn theme', () => {
  it('reads --chart-N for the first five series and keeps maths on plain colours', () => {
    const t = resolveTheme('shadcn')
    expect(t.palette[0]).toBe('var(--chart-1, #6C4AF2)')
    const s = compile({ type: 'bar', x: 'region', y: 'revenue', data: sales, labels: true }, { theme: 'shadcn' })
    expect(s.series[0].color).toBe('var(--sp-series-1, var(--chart-1, #6C4AF2))')
    expect(renderToSvg({ type: 'bar', x: 'region', y: 'revenue', data: sales }, { theme: 'shadcn' })).not.toContain('var(')
  })
})

describe('fast dots hook', () => {
  it('hands long runs of plain dots to the hook instead of drawing paths', () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ x: i, y: (i * 7919) % 1000 }))
    const s = compile({ type: 'scatter', x: 'x', y: 'y', data: many })
    const calls: number[] = []
    let arcs = 0
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'arc' ? () => { arcs++ } : () => {}), set: () => true }) as never
    drawScene(ctx, s, { dots: run => { calls.push(run.cx.length); return true } })
    expect(calls).toEqual([3000])
    expect(arcs).toBe(0)
  })
})

describe('date categories', () => {
  it('ISO bucket starts read like a time axis; other labels are left alone', async () => {
    const { dateLabels } = await import('../../packages/core/src/cartesian')
    expect(Object.values(dateLabels(['2026-01-01', '2026-02-01', '2026-03-01'], {}, 'en')!)).toEqual(['2026', 'Feb', 'Mar'])
    expect(Object.values(dateLabels(['2026-01-05', '2026-01-06'], {}, 'en')!)).toEqual(['Jan 5', 'Jan 6'])
    expect(Object.values(dateLabels(['2025-01-01', '2026-01-01'], {}, 'en')!)).toEqual(['2025', '2026'])
    expect(dateLabels(['2026-01-01', 'Q2'], {}, 'en')).toBeNull()
    expect(dateLabels(['2026-01-01'], { '2026-01-01': 'Launch' }, 'en')).toBeNull()
    const s = compile({ type: 'bar', x: 'month', y: 'revenue', data: sales, transform: [{ timeUnit: { field: 'date', unit: 'month', as: 'month' } }, { aggregate: { groupBy: ['month'], fields: { revenue: 'sum' } } }] })
    const labels = s.marks.filter(m => m.type === 'text' && m.role === 'axis-label').map(m => (m as { text: string }).text)
    expect(labels).toEqual(expect.arrayContaining(['2026', 'Feb', 'Mar']))
  })
})

describe('transform edge cases', () => {
  it('a column named "" is a column like any other', () => {
    const r = validatePlot({ type: 'bar', x: 'k', y: 'v', data: [{ '': 'b', k: 'x', v: 1 }, { '': 'a', k: 'y', v: 2 }], transform: [{ sort: { field: '' } }] })
    expect(r.ok).toBe(true)
    expect((r.spec!.data as { k: string }[]).map(x => x.k)).toEqual(['y', 'x'])
  })
  it('buckets early years correctly and refuses times outside years 1 to 9999', async () => {
    const { bucket } = await import('../../packages/core/src/transforms')
    expect(bucket(Date.parse('0050-06-15T00:00:00Z'), 'month')).toBe('0050-06-01')
    expect(bucket(Date.parse('0050-06-15T00:00:00Z'), 'year')).toBe('0050-01-01')
    const issues: Issue[] = []
    const out = applyTransform([{ timeUnit: { field: 't', unit: 'day' } }], [{ t: 1e16 }, { t: '2026-01-02' }], issues)!
    expect(out.map(r => r.t)).toEqual([null, '2026-01-02'])
    expect(issues.map(i => i.code)).toContain('some_not_time')
  })
})

describe('times a Date cannot hold', () => {
  it('are not times, so describing never throws', async () => {
    const { toTime } = await import('../../packages/core/src/util/time')
    expect(toTime(8.64e15)).toBe(8.64e15)
    expect(toTime(1e16)).toBeNull()
    const { describePlot } = await import('../../packages/core/src')
    expect(() => describePlot({ type: 'line', x: 't', y: 'v', data: [{ t: '2026-01-01', v: 1 }, { t: 1e16, v: 2 }] })).not.toThrow()
  })
})
