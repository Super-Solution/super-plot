import { describe, expect, it, vi } from 'vitest'
import { compilePlot, describePlot, validatePlot, renderToSvg, chartCatalog, drawScene, buildHitIndex, plotJsonSchema, kde, silverman, densityPeaks, jitter, hierarchy, calendarDays, sampleRows, quantile, type Canvas2D, type Scene, type Mark } from '../../packages/core/src'

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const issues = (spec: unknown, o = {}): { code: string; path: string; severity: string }[] => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  return r.issues
}
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => i.code)
type M<T extends Mark['type']> = Extract<Mark, { type: T }>
const of = <T extends Mark['type']>(s: Scene, type: T, role = 'data'): M<T>[] => s.marks.filter((m): m is M<T> => m.type === type && m.role === role)
const ex = (type: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === type)!.example)

// ---- density ---------------------------------------------------------------------------------------

describe('kde and silverman', () => {
  const values = [1, 2, 2, 3, 3, 3, 4, 4, 5, 9]
  it('follows Silverman\'s rule with the box plot\'s quantiles', () => {
    const v = [...values].sort((a, b) => a - b)
    const m = v.reduce((a, b) => a + b) / v.length
    const sd = Math.sqrt(v.reduce((q, x) => q + (x - m) ** 2, 0) / (v.length - 1))
    const iqr = quantile(v, 0.75) - quantile(v, 0.25)
    expect(silverman(values)).toBeCloseTo(0.9 * Math.min(sd, iqr / 1.34) * v.length ** -0.2, 12)
    // More than half the values equal: the IQR is 0, so the standard deviation is used.
    const tied = [5, 5, 5, 5, 5, 5, 5, 9]
    const tm = tied.reduce((a, b) => a + b) / tied.length
    const tsd = Math.sqrt(tied.reduce((q, x) => q + (x - tm) ** 2, 0) / 7)
    expect(silverman(tied)).toBeCloseTo(0.9 * tsd * 8 ** -0.2, 12)
    expect(silverman([3])).toBe(0)
    expect(silverman([2, 2, 2])).toBe(0)
  })
  it('evaluates the Gaussian sum on 64 evenly spaced points over the observed range', () => {
    const d = kde(values)!
    expect(d.grid).toHaveLength(64)
    expect(d.grid[0]).toBe(1)
    expect(d.grid[63]).toBe(9)
    const h = d.bandwidth
    const t = d.grid[20]
    const want = values.reduce((q, x) => q + Math.exp(-0.5 * ((t - x) / h) ** 2), 0) / (values.length * h * Math.sqrt(2 * Math.PI))
    expect(d.density[20]).toBeCloseTo(want, 14)
  })
  it('integrates to about 1 when the grid covers the tails, and is symmetric for symmetric data', () => {
    const sym = [-2, -1, -1, 0, 0, 0, 1, 1, 2, -20, 20]
    const d = kde(sym, 1.5, 801)!
    const step = d.grid[1] - d.grid[0]
    expect(d.density.reduce((a, b) => a + b) * step).toBeGreaterThan(0.85)
    for (let i = 0; i < d.density.length; i++) expect(d.density[i]).toBeCloseTo(d.density[d.density.length - 1 - i], 12)
  })
  it('takes a bandwidth, and treats equal values as a point mass', () => {
    expect(kde(values, 0.5)!.bandwidth).toBe(0.5)
    expect(kde([4, 4, 4])).toEqual({ bandwidth: 0, grid: [4], density: [1] })
    expect(kde([])).toBeNull()
  })
  it('finds two peaks in two clusters', () => {
    const two = [...Array.from({ length: 30 }, (_, i) => 10 + (i % 5) * 0.4), ...Array.from({ length: 30 }, (_, i) => 30 + (i % 5) * 0.4)]
    const pk = densityPeaks(kde(two)!)
    expect(pk).toHaveLength(2)
    expect(pk[0]).toBeGreaterThan(9)
    expect(pk[0]).toBeLessThan(13)
    expect(pk[1]).toBeGreaterThan(29)
  })
})

// ---- violin ----------------------------------------------------------------------------------------

describe('violin', () => {
  const spec = ex('violin')
  it('draws one filled density shape per group with stats in the tooltip and datum', () => {
    const s = compile(spec)
    const shapes = of(s, 'path')
    expect(shapes).toHaveLength(3)
    for (const p of shapes) {
      expect(p.tip!.rows.map(r => r.label)).toEqual(['Max', 'Q3', 'Median', 'Q1', 'Min', 'n', 'Bandwidth'])
      expect(p.aria).toMatch(/median/)
      expect((p.datum as { bandwidth: number }).bandwidth).toBeGreaterThan(0)
    }
    // 64 points down one side and 64 back up the other.
    expect(shapes[0].d.split('L')).toHaveLength(128)
  })
  it('is widest where the values are densest', () => {
    // A bell around 10 with a few stragglers either side.
    const data = [...Array.from({ length: 120 }, (_, i) => ({ v: 10 + ((i * 0.618) % 1 + (i * 0.414) % 1 + (i * 0.732) % 1 - 1.5) * 3 })), { v: 2 }, { v: 18 }]
    const s = compile({ type: 'violin', y: 'v', data, inner: 'none' })
    const pts = of(s, 'path')[0].d.replace(/[MZ]/g, '').split('L').map(p => p.split(' ').map(Number))
    const right = pts.slice(0, pts.length / 2)
    const widest = right.reduce((a, b) => (b[0] > a[0] ? b : a))
    const mid = (Math.min(...right.map(p => p[1])) + Math.max(...right.map(p => p[1]))) / 2
    expect(Math.abs(widest[1] - mid)).toBeLessThan(10)
  })
  it('draws a thin box, quartile lines or nothing inside', () => {
    const box = compile(spec)
    expect(of(box, 'rect')).toHaveLength(3)
    const q = compile({ ...spec, inner: 'quartiles' })
    expect(of(q, 'rect')).toHaveLength(0)
    expect(of(q, 'line').filter(l => l.dash === '3 3')).toHaveLength(6)
    const none = compile({ ...spec, inner: 'none' })
    expect(none.marks.filter(m => m.role === 'data')).toHaveLength(3)
  })
  it('draws every value as a jittered dot inside the shape, the same every time', () => {
    const a = compile({ ...spec, points: 'all', inner: 'none' })
    const dots = of(a, 'circle')
    expect(dots).toHaveLength(spec.data.length)
    expect(new Set(dots.map(d => Math.round(d.cx))).size).toBeGreaterThan(30)
    expect(compile({ ...spec, points: 'all', inner: 'none' })).toEqual(a)
    const out = compile({ ...spec, points: 'outliers' })
    expect(of(out, 'circle').length).toBeGreaterThan(0)
    expect(of(out, 'circle').filter(d => d.tip).every(d => (d.tip!.title ?? '').endsWith('outlier'))).toBe(true)
  })
  it('lays out horizontally, and draws a bar for a group whose values are all equal', () => {
    const s = compile({ type: 'violin', x: 'g', y: 'v', orientation: 'horizontal', data: [{ g: 'a', v: 3 }, { g: 'a', v: 3 }, { g: 'b', v: 1 }, { g: 'b', v: 5 }, { g: 'b', v: 4 }] })
    expect(s.axes!.x.kind).toBe('linear')
    expect(s.axes!.y.kind).toBe('band')
    const flat = of(s, 'path').find(p => p.series === 'a')!
    expect(flat.fill).toBe('none')
  })
  it('validates bandwidth and warns about small groups, patterns and outliers', () => {
    expect(codes({ ...spec, bandwidth: 0 })).toContain('out_of_range')
    expect(codes({ ...spec, bandwidth: -1 })).toContain('out_of_range')
    expect(codes({ type: 'violin', y: 'v', data: [{ v: 1 }, { v: 2 }] })).toContain('few_values')
    expect(codes({ ...spec, patterns: true })).toContain('patterns_unsupported')
    expect(validatePlot(spec).spec).toMatchObject({ inner: 'box', points: 'none', orientation: 'vertical' })
  })
  it('works as small multiples with a shared value axis', () => {
    const data = spec.data.map((r: Record<string, unknown>, i: number) => ({ ...r, half: i % 2 ? 'A' : 'B' }))
    const s = compile({ ...spec, data, facet: 'half' })
    expect(s.panels).toHaveLength(2)
    expect(of(s, 'path')).toHaveLength(6)
  })
  it('describes the shape, including two peaks', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toMatch(/Silverman/)
    expect(d.ok && d.text).toMatch(/Team: .*2 peaks/)
  })
})

// ---- box points --------------------------------------------------------------------------------------

describe('box points', () => {
  const spec = ex('box')
  const outliers = (sc: Scene): M<'circle'>[] => of(sc, 'circle')
  it('keeps the old behaviour: outliers by default, none with outliers: false', () => {
    const s = compile(spec)
    const n = spec.data.length
    expect(outliers(s).length).toBeGreaterThan(0)
    expect(outliers(s).length).toBeLessThan(n / 4)
    expect(outliers(compile({ ...spec, outliers: false }))).toHaveLength(0)
    expect(outliers(compile({ ...spec, points: 'outliers' }))).toEqual(outliers(s))
    expect(validatePlot(spec).spec).not.toHaveProperty('points')
  })
  it('points: all draws every value with a deterministic jitter, no randomness', () => {
    const rnd = vi.spyOn(Math, 'random')
    const s = compile({ ...spec, points: 'all' })
    expect(rnd).not.toHaveBeenCalled()
    rnd.mockRestore()
    const dots = outliers(s)
    expect(dots).toHaveLength(spec.data.length)
    const box = of(s, 'rect')[0]
    const aero = dots.filter(d => d.series === 'Aero')
    for (const d of aero) {
      expect(d.cx).toBeGreaterThanOrEqual(box.x - 0.01)
      expect(d.cx).toBeLessThanOrEqual(box.x + box.w + 0.01)
      expect(d.datum).toMatchObject({ group: 'Aero' })
    }
    expect(renderToSvg({ ...spec, points: 'all' })).toBe(renderToSvg({ ...spec, points: 'all' }))
  })
  it('points wins over outliers, and says so', () => {
    expect(outliers(compile({ ...spec, points: 'none' }))).toHaveLength(0)
    expect(outliers(compile({ ...spec, points: 'all', outliers: false }))).toHaveLength(spec.data.length)
    expect(codes({ ...spec, points: 'all', outliers: false })).toContain('outliers_ignored')
    expect(codes({ ...spec, points: 'none', outliers: false })).not.toContain('outliers_ignored')
    expect(codes({ ...spec, points: 'every' })).toContain('bad_enum')
  })
  it('jitter is the golden-ratio sequence in [-0.5, 0.5)', () => {
    const js = Array.from({ length: 200 }, (_, i) => jitter(i))
    expect(js[0]).toBe(-0.5)
    expect(js[1]).toBeCloseTo(0.1180339887, 9)
    for (const j of js) {
      expect(j).toBeGreaterThanOrEqual(-0.5)
      expect(j).toBeLessThan(0.5)
    }
    // Spread evenly: every tenth of the interval gets a share.
    const buckets = new Array(10).fill(0)
    for (const j of js) buckets[Math.floor((j + 0.5) * 10)]++
    expect(Math.min(...buckets)).toBeGreaterThan(14)
  })
})

// ---- calendar ------------------------------------------------------------------------------------

describe('calendar', () => {
  const days = (from: string, n: number, f: (i: number) => number | null = i => i % 5): Record<string, unknown>[] =>
    Array.from({ length: n }, (_, i) => ({ d: new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10), v: f(i) }))
  it('draws one cell per day of the months covered, empty days distinct from zero', () => {
    const data = days('2026-03-03', 20).filter((_, i) => i !== 4)
    const s = compile({ type: 'calendar', x: 'd', value: 'v', data })
    const cells = of(s, 'rect')
    const empty = s.marks.filter((m): m is M<'rect'> => m.type === 'rect' && m.role === 'grid')
    expect(cells).toHaveLength(19)
    expect(cells.length + empty.length).toBe(31) // March
    const zero = cells.find(c => (c.datum as { value: number }).value === 0)!
    expect(zero.fill).not.toBe(empty[0].fill)
    expect(empty[0].stroke).toBeDefined()
    expect(cells[0].datum).toEqual({ date: '2026-03-03', value: 0 })
    expect(cells[0].tip!.title).toBe('Mar 3, 2026')
    expect(cells[0].tip!.rows[1]).toEqual({ label: 'Weekday', value: 'Tuesday' })
  })
  it('puts weekdays in rows, starting on Monday or Sunday, and weeks in columns', () => {
    const data = days('2026-03-01', 14) // a Sunday
    const row = (sc: Scene, date: string): number => of(sc, 'rect').find(c => (c.datum as { date: string }).date === date)!.y
    const col = (sc: Scene, date: string): number => of(sc, 'rect').find(c => (c.datum as { date: string }).date === date)!.x
    const mon = compile({ type: 'calendar', x: 'd', value: 'v', data })
    expect(row(mon, '2026-03-02')).toBeLessThan(row(mon, '2026-03-01')) // Monday on top, Sunday at the bottom
    expect(col(mon, '2026-03-02')).toBeGreaterThan(col(mon, '2026-03-01'))
    const sun = compile({ type: 'calendar', x: 'd', value: 'v', data, weekStart: 'sunday' })
    expect(row(sun, '2026-03-01')).toBeLessThan(row(sun, '2026-03-02'))
    expect(col(sun, '2026-03-02')).toBe(col(sun, '2026-03-01'))
  })
  it('sums timestamps into UTC days', () => {
    const t = Date.UTC(2026, 4, 1, 23, 30)
    const m = calendarDays([{ t, v: 2 }, { t: t + 60 * 60e3, v: 3 }, { t: '2026-05-01T08:00:00Z', v: 1 }, { t: '2026-05-02T01:00:00+02:00', v: 4 }, { t: 'nope', v: 1 }, { t, v: null }], 't', 'v')
    // 01:00 at +02:00 is still the 1st in UTC.
    expect([...m]).toEqual([[Math.floor(t / 864e5), 7], [Math.floor(t / 864e5) + 1, 3]])
  })
  it('draws one row of panels per year, at most five, with a warning', () => {
    const two = compile({ type: 'calendar', x: 'd', value: 'v', data: [{ d: '2025-06-01', v: 1 }, { d: '2026-02-01', v: 2 }] })
    expect(of(two, 'text', 'title').map(t => t.text)).toEqual(['2025', '2026'])
    expect(two.marks.filter(m => m.type === 'rect' && (m.role === 'grid' || m.role === 'data'))).toHaveLength(365 + 365)
    const seven = Array.from({ length: 7 }, (_, i) => ({ d: `${2020 + i}-03-01`, v: i }))
    expect(codes({ type: 'calendar', x: 'd', value: 'v', data: seven })).toContain('too_many_years')
    const s = compile({ type: 'calendar', x: 'd', value: 'v', data: seven })
    expect(of(s, 'text', 'title').map(t => t.text)).toEqual(['2022', '2023', '2024', '2025', '2026'])
    expect(describePlot({ type: 'calendar', x: 'd', value: 'v', data: seven }).ok).toBe(true)
  })
  it('refuses columns without dates and warns about some', () => {
    expect(codes({ type: 'calendar', x: 'd', value: 'v', data: [{ d: 'monday', v: 1 }] })).toContain('not_time')
    expect(codes({ type: 'calendar', x: 'd', value: 'v', data: [{ d: '2026-01-01', v: 1 }, { d: 'x', v: 2 }] })).toContain('some_not_time')
    expect(codes({ type: 'calendar', x: 'd', value: 'v', data: [{ d: '2026-01-01', v: 1 }], patterns: true })).toContain('patterns_unsupported')
    expect(codes({ type: 'calendar', x: 'd', value: 'v', data: [{ d: '2026-01-01', v: 1 }], facet: 'd' })).toContain('unknown_field')
  })
  it('shares the heatmap colour ramp, with a no-data swatch', () => {
    const s = compile(ex('calendar'))
    const ramp = of(s, 'rect', 'legend')
    expect(ramp.length).toBe(25)
    expect(of(s, 'text', 'legend').map(t => t.text)).toContain('No data')
  })
  it('describes the span, the extremes and the weekly rhythm', () => {
    const d = describePlot(ex('calendar'))
    expect(d.ok && d.text).toMatch(/349 days with data from Jan 1, 2026 to Dec 31, 2026/)
    expect(d.ok && d.text).toMatch(/16 days in that span have no data/)
    expect(d.ok && d.text).toMatch(/Sunday lowest/)
  })
})

// ---- sunburst ------------------------------------------------------------------------------------

describe('sunburst', () => {
  const rows = [
    { a: 'X', b: 'x1', c: 'p', v: 3 }, { a: 'X', b: 'x1', c: 'q', v: 1 }, { a: 'X', b: 'x2', c: 'r', v: 4 },
    { a: 'Y', b: 'y1', c: 's', v: 2 }, { a: 'Y', b: '', c: 't', v: 2 }, { a: 'Y', b: 'y1', c: 's', v: 1 }, { a: 'Z', b: 'z', c: 'u', v: -5 }
  ]
  const spec = { type: 'sunburst', path: ['a', 'b', 'c'], value: 'v', data: rows }
  it('sums along the path; a row stops at its first empty level', () => {
    const { root } = hierarchy(rows, ['a', 'b', 'c'], 'v')
    expect(root.value).toBe(13)
    expect(root.children.map(n => [n.name, n.value])).toEqual([['X', 8], ['Y', 5]])
    const y = root.children[1]
    expect(y.children.map(n => [n.name, n.value])).toEqual([['y1', 3]])
    expect(y.children[0].children).toEqual([{ name: 's', path: ['Y', 'y1', 's'], value: 3, children: [] }])
  })
  it('splits each ring by share of the parent, coloured by the first level and lighter outside', () => {
    const s = compile(spec)
    const arcs = of(s, 'path')
    expect(arcs.map(a => (a.datum as { path: string[] }).path.join('/'))).toEqual(['X', 'X/x1', 'X/x1/p', 'X/x1/q', 'X/x2', 'X/x2/r', 'Y', 'Y/y1', 'Y/y1/s'])
    expect(arcs.every(a => a.series === (a.datum as { path: string[] }).path[0])).toBe(true)
    expect(arcs[0].fill).not.toBe(arcs[1].fill)
    expect(arcs[1].fill).not.toBe(arcs[2].fill)
    expect(arcs[4].fill).toBe(arcs[1].fill) // same level, same branch: same shade
    const x1 = arcs[1]
    expect(x1.tip!.rows.map(r => [r.label, r.value])).toEqual([['v', '4'], ['Share of parent', '50%'], ['Share of total', '30.8%']])
    expect(x1.aria).toBe('X > x1: 4, 50% of X, 30.8% of the total')
    expect(s.series.map(x => x.key)).toEqual(['X', 'Y'])
  })
  it('hides a first-level branch from the legend and redistributes the circle', () => {
    const s = compile(spec, { hidden: ['X'] })
    const arcs = of(s, 'path')
    expect(arcs.every(a => a.series === 'Y')).toBe(true)
    expect(arcs[0].tip!.rows.at(-1)).toEqual({ label: 'Share of total', value: '100%' })
  })
  it('labels only arcs that are large enough', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ a: 'A', b: `leaf${i}`, v: i === 0 ? 400 : 1 }))
    const s = compile({ type: 'sunburst', path: ['a', 'b'], value: 'v', data: many })
    const labels = of(s, 'text', 'label').map(t => t.text)
    expect(labels).toContain('A')
    expect(labels).toContain('leaf0')
    expect(labels).not.toContain('leaf7')
    expect(codes({ type: 'sunburst', path: ['a', 'b'], value: 'v', data: many })).not.toContain('many_children')
    expect(issues({ type: 'sunburst', path: ['a', 'b'], value: 'v', data: many }).map(i => i.code)).toContain('many_children')
    expect(of(s, 'path').map(a => (a.datum as { path: string[] }).path.at(-1))).toContain('Other')
  })
  it('validates the path list', () => {
    expect(codes({ ...spec, path: ['a', 'a'] })).toContain('duplicate_column')
    expect(codes({ ...spec, path: ['a', 'b', 'c', 'a', 'b', 'c', 'v'] })).toContain('too_many_columns')
    expect(codes({ ...spec, path: [] })).toContain('bad_type')
    expect(codes({ ...spec, path: ['a', 'nope'] })).toContain('no_such_column')
    expect(codes(spec)).toContain('negative_slices')
    expect(validatePlot({ ...spec, path: 'a' }).ok).toBe(true)
  })
  it('supports patterns per first-level branch', () => {
    const s = compile({ ...spec, patterns: true })
    const arcs = of(s, 'path')
    expect(arcs.filter(a => a.series === 'X').every(a => a.pattern === 0)).toBe(true)
    expect(arcs.filter(a => a.series === 'Y').every(a => a.pattern === 1)).toBe(true)
  })
  it('describes levels, leaves and the largest parts', () => {
    const d = describePlot(ex('sunburst'))
    expect(d.ok && d.text).toBe('Sunburst "Sales by region, country and city". 3 levels (region > country > city), 15 leaves totalling 3.4K. First level: 3 groups, largest Asia (39%), Europe (34.2%), Americas (26.8%). Largest leaf: Asia > Japan > Tokyo (460, 13.7%).')
  })
})

// ---- parallel coordinates --------------------------------------------------------------------------

describe('parallel', () => {
  const spec = ex('parallel')
  it('draws one polyline per row through every axis, each with its own nice scale', () => {
    const s = compile(spec)
    const lines = of(s, 'path')
    expect(lines).toHaveLength(spec.data.length)
    expect(lines[0].d.split('L')).toHaveLength(4)
    expect(lines[0].fill).toBe('none')
    expect(lines[0].tip!.rows.map(r => r.label)).toEqual(['price', 'power', 'weight', 'range'])
    expect(lines[0].datum).toBe(validatePlot(spec).spec!.data[0])
    const axes = s.marks.filter((m): m is M<'line'> => m.type === 'line' && m.role === 'axis' && m.x1 === m.x2)
    expect(axes).toHaveLength(4)
    const tickLabels = of(s, 'text', 'axis-label').map(t => t.text)
    expect(tickLabels).toContain('1,000') // range axis is rounded to 300..1,000
  })
  it('colours by series, and the legend hides a group', () => {
    const s = compile(spec)
    expect(s.series.map(x => x.key)).toEqual(['Electric', 'Hybrid', 'Petrol'])
    const hid = compile(spec, { hidden: ['Hybrid'] })
    expect(of(hid, 'path').some(l => l.series === 'Hybrid')).toBe(false)
    expect(of(hid, 'path')).toHaveLength(24)
  })
  it('samples every k-th row past 2,000 lines and says so', () => {
    const data = Array.from({ length: 5000 }, (_, i) => ({ a: i, b: (i * 7) % 101, c: (i * 13) % 97 }))
    const big = { type: 'parallel', dimensions: ['a', 'b', 'c'], data }
    expect(codes(big)).toContain('lines_sampled')
    const s = compile(big)
    const lines = of(s, 'path')
    expect(lines).toHaveLength(1667)
    expect((lines[1].datum as { a: number }).a).toBe(3)
    expect(sampleRows([1, 2, 3, 4, 5], 2)).toEqual({ rows: [1, 4], step: 3 })
    const d = describePlot(big)
    expect(d.ok && d.text).toMatch(/One row in every 3 is drawn \(1667 lines\)/)
  })
  it('skips incomplete rows with a warning, and checks the dimension list', () => {
    expect(codes({ type: 'parallel', dimensions: ['a', 'b'], data: [{ a: 1, b: 2 }, { a: 3 }] })).toContain('incomplete_rows')
    expect(codes({ type: 'parallel', dimensions: ['a'], data: [{ a: 1, b: 2 }] })).toContain('too_few_columns')
    expect(codes({ type: 'parallel', dimensions: 'a', data: [{ a: 1, b: 2 }] })).toContain('too_few_columns')
    const wide = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`c${i}`, i]))
    expect(codes({ type: 'parallel', dimensions: Object.keys(wide), data: [wide] })).toContain('too_many_columns')
    expect(codes({ type: 'parallel', dimensions: ['a', 'a'], data: [{ a: 1 }] })).toContain('duplicate_column')
    expect(codes({ type: 'parallel', dimensions: ['a', 'b'], data: [{ a: 1, b: 2 }], patterns: true })).toContain('patterns_unsupported')
  })
  it('describes ranges and the strongest neighbouring link', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toMatch(/36 rows across 4 measures/)
    expect(d.ok && d.text).toMatch(/price and power \(r = 0\.\d\d\)/)
  })
})

// ---- shared ------------------------------------------------------------------------------------------

describe('new charts in every renderer', () => {
  it('the columns DSL limits reach the JSON Schema', () => {
    const schema = plotJsonSchema() as { oneOf: { title: string; properties: Record<string, any> }[] }
    const par = schema.oneOf.find(b => b.title === 'Parallel coordinates')!
    expect(par.properties.dimensions).toMatchObject({ type: 'array', minItems: 2, maxItems: 12 })
    const sun = schema.oneOf.find(b => b.title === 'Sunburst')!
    expect(sun.properties.path.oneOf[1]).toMatchObject({ type: 'array', minItems: 1, maxItems: 6 })
  })
  it('draws on a 2D context and hit-tests their marks', () => {
    for (const t of ['violin', 'calendar', 'sunburst', 'parallel']) {
      const s = compile(ex(t))
      const calls: string[] = []
      const ctx: Record<string, unknown> = { globalAlpha: 1 }
      for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fill', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash']) ctx[k] = () => calls.push(k)
      class P { constructor(readonly d?: string) {} }
      drawScene(ctx as unknown as Canvas2D, s, { Path2D: P })
      expect(calls.filter(c => c === 'fill' || c === 'stroke').length).toBeGreaterThan(10)
      const idx = buildHitIndex(s)
      const target = s.marks.findIndex(m => m.role === 'data' && m.tip && m.type === 'rect')
      if (target >= 0) {
        const m = s.marks[target] as M<'rect'>
        expect(idx.at(m.x + m.w / 2, m.y + m.h / 2)).toBe(target)
      }
      for (const m of s.marks) if (m.role === 'data' && m.tip) expect(m.aria, t).toBeTruthy()
    }
  })
})
