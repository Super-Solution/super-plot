import { describe, expect, it } from 'vitest'
import { chartCatalog, compilePlot, describePlot, validatePlot, plotTable, drawScene, buildHitIndex, plotJsonSchema, type Canvas2D, type Scene, type Mark, type Issue } from '../../packages/core/src'
import { waterfallModel } from '../../packages/core/src/charts/waterfall'
import { bumpModel } from '../../packages/core/src/charts/bump'

const result = (spec: unknown, o = {}): { scene: Scene; issues: Issue[] } => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return { scene: r.scene, issues: r.issues }
}
const compile = (spec: unknown, o = {}): Scene => result(spec, o).scene
const issues = (spec: unknown): Issue[] => validatePlot(spec).issues
const codes = (spec: unknown): string[] => issues(spec).map(i => i.code)
const ex = (t: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === t)!.example) as Record<string, any>
type RectM = Extract<Mark, { type: 'rect' }>
type LineM = Extract<Mark, { type: 'line' }>
type CircleM = Extract<Mark, { type: 'circle' }>
type TextM = Extract<Mark, { type: 'text' }>
const rects = (s: Scene): RectM[] => s.marks.filter((m): m is RectM => m.type === 'rect' && m.role === 'data')
const tipped = (s: Scene): RectM[] => rects(s).filter(m => m.tip)

describe('waterfall', () => {
  const data = [{ k: 'Open', v: 100, t: true }, { k: 'Sales', v: 30 }, { k: 'Costs', v: -50 }, { k: 'Sub', t: 'yes' }, { k: 'Tax', v: -20 }, { k: 'Close', t: 'total' }]
  const spec = { type: 'waterfall', x: 'k', y: 'v', total: 't', data }

  it('carries a running total: changes float from it, totals stand on zero', () => {
    const m = waterfallModel(validatePlot(spec).spec!)
    expect(m.steps.map(s => [s.key, s.kind, s.from, s.to])).toEqual([
      ['Open', 'total', 0, 100], ['Sales', 'increase', 100, 130], ['Costs', 'decrease', 130, 80], ['Sub', 'total', 0, 80], ['Tax', 'decrease', 80, 60], ['Close', 'total', 0, 60]
    ])
    const s = compile(spec)
    const bars = tipped(s)
    const h = (k: string): number => bars.find(b => b.tip!.title === k)!.h
    expect(h('Sales') / h('Open')).toBeCloseTo(0.3, 1)
    expect(h('Sub') / h('Open')).toBeCloseTo(0.8, 1)
    const sales = bars.find(b => b.tip!.title === 'Sales')!
    const open = bars.find(b => b.tip!.title === 'Open')!
    expect(sales.y + sales.h).toBeCloseTo(open.y, 0) // Sales starts where Open ends
  })
  it('gives increase, decrease and total their own legend entries and theme tokens', () => {
    const s = compile(spec)
    expect(s.series.map(x => [x.key, x.label])).toEqual([['increase', 'Increase'], ['decrease', 'Decrease'], ['total', 'Total']])
    expect(s.series.map(x => x.color)).toEqual(['var(--sp-positive, #12805C)', 'var(--sp-negative, #C2362B)', 'var(--sp-text-muted, #5F5F68)'])
    expect(s.marks.filter(m => m.role === 'legend' && m.legendKey).length).toBe(3)
    expect(compile({ ...spec, colors: { total: '#123456' } }).series[2].color).toBe('#123456')
  })
  it('tooltips, aria and datum carry the change and the running total', () => {
    const bar = tipped(compile(spec)).find(b => b.tip!.title === 'Costs')!
    expect(bar.tip!.rows).toEqual([{ label: 'Decrease', value: '-50', color: 'var(--sp-negative, #C2362B)' }, { label: 'Running total', value: '80' }])
    expect(bar.aria).toBe('Costs: decrease of 50, running total 80')
    expect(bar.datum).toEqual({ x: 'Costs', kind: 'decrease', change: -50, total: 80 })
  })
  it('draws dashed connectors between consecutive bars, and can leave them out', () => {
    const conn = (s: Scene): LineM[] => s.marks.filter((m): m is LineM => m.type === 'line' && m.role === 'data' && m.dash === '3 3')
    expect(conn(compile(spec))).toHaveLength(5)
    expect(conn(compile({ ...spec, connectors: false }))).toHaveLength(0)
  })
  it('takes totals as a list of step labels, with "did you mean" for a typo', () => {
    const s = compile({ type: 'waterfall', x: 'k', y: 'v', total: ['Sub', 'Close'], data })
    expect(tipped(s).filter(b => b.series === 'total').map(b => b.tip!.title)).toEqual(['Sub', 'Close'])
    const bad = issues({ type: 'waterfall', x: 'k', y: 'v', total: ['Clsoe'], data }).find(i => i.code === 'no_such_step')!
    expect(bad).toMatchObject({ severity: 'warning', path: 'total[0]', hint: 'Did you mean "Close"?' })
  })
  it('validates the flag field with codes and paths', () => {
    expect(issues({ ...spec, total: 'tt' }).find(i => i.code === 'no_such_column')).toMatchObject({ path: 'total', severity: 'error' })
    expect(issues({ ...spec, total: ['Sub', { a: 1 }] }).find(i => i.code === 'bad_type')).toMatchObject({ path: 'total[1]' })
    expect(codes({ ...spec, total: [] })).toContain('bad_type')
    expect(codes({ ...spec, total: 'k' })).toContain('no_totals')
  })
  it('starts from `start`, and draws a reported total value while warning that it differs', () => {
    const m = waterfallModel(validatePlot({ type: 'waterfall', x: 'k', y: 'v', start: 50, data: [{ k: 'a', v: 10 }, { k: 'b', v: -5 }] }).spec!)
    expect(m.end).toBe(55)
    const mis = { type: 'waterfall', x: 'k', y: 'v', total: ['T'], data: [{ k: 'a', v: 10 }, { k: 'b', v: 5 }, { k: 'T', v: 16 }] }
    expect(issues(mis).find(i => i.code === 'total_mismatch')).toMatchObject({ severity: 'warning', path: 'total' })
    const t = tipped(compile(mis)).find(b => b.series === 'total')!
    expect(t.tip!.rows.map(r => r.value)).toEqual(['16', '15'])
    expect(codes({ type: 'waterfall', x: 'k', y: 'v', total: ['T'], data: [{ k: 'a', v: 10 }, { k: 'T', v: 10 }] })).not.toContain('total_mismatch')
  })
  it('sums repeated steps with a warning, and refuses a chart with nothing to draw', () => {
    expect(codes({ type: 'waterfall', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }, { k: 'a', v: 2 }] })).toContain('duplicate_steps')
    expect(validatePlot({ type: 'waterfall', x: 'k', y: 'v', data: [{ k: 'a', v: null }, { k: 'b', v: 2 }] }).ok).toBe(true)
    const r = validatePlot({ type: 'waterfall', x: 'k', y: 'v', data: [{ k: 'a', v: null, w: 1 }] })
    expect(r.ok).toBe(false)
  })
  it('lays out horizontally with the value axis along x', () => {
    const s = compile({ ...spec, orientation: 'horizontal' })
    expect(s.axes!.x.kind).toBe('linear')
    expect(s.axes!.y.kind).toBe('band')
    const bars = tipped(s)
    expect(new Set(bars.map(b => Math.round(b.h))).size).toBe(1)
    expect(bars.find(b => b.tip!.title === 'Sales')!.x).toBeCloseTo(bars.find(b => b.tip!.title === 'Open')!.x + bars.find(b => b.tip!.title === 'Open')!.w, 0)
  })
  it('hides a kind without changing the running totals', () => {
    const all = tipped(compile(spec))
    const hid = tipped(compile(spec, { hidden: ['decrease'] }))
    expect(hid.some(b => b.series === 'decrease')).toBe(false)
    expect(hid.find(b => b.tip!.title === 'Close')!.h).toBeCloseTo(all.find(b => b.tip!.title === 'Close')!.h, 5)
  })
  it('prints signed changes and totals as labels', () => {
    const t = compile({ ...spec, labels: true }).marks.filter((m): m is TextM => m.type === 'text' && m.role === 'label').map(m => m.text)
    expect(t).toEqual(['100', '+30', '-50', '80', '-20', '60'])
  })
  it('refuses zoom on its category axis with a warning, brushes steps, textures kinds, and facets on a shared scale', () => {
    expect(result({ ...spec, zoom: 'x' }).issues.map(i => i.code)).toContain('zoom_unsupported')
    expect(compile({ ...spec, brush: 'x' }).axes!.brush).toBe('x')
    const p = tipped(compile({ ...spec, patterns: true }))
    expect(new Set(p.map(b => b.pattern))).toEqual(new Set([0, 1, 2]))
    const f = compile({ ...spec, facet: 'g', data: [...data.map(r => ({ ...r, g: 'A' })), ...data.map(r => ({ ...r, g: 'B', v: r.v === undefined ? undefined : r.v * 2 }))] })
    expect(f.panels).toHaveLength(2)
    const close = tipped(f).filter(b => b.tip!.title === 'Close')
    expect(close[1].h / close[0].h).toBeCloseTo(2, 1)
  })
  it('describes the bridge in words', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toBe('Waterfall chart. 3 changes and 3 totals, from 100 to 60 (net -40). Largest increase: Sales (+30). Largest decrease: Costs (-50). Totals: Open 100, Sub 80, Close 60.')
  })
})

describe('funnel', () => {
  const data = [{ s: 'Visit', n: 1000 }, { s: 'Cart', n: 400 }, { s: 'Pay', n: 100 }]
  const spec = { type: 'funnel', stage: 's', value: 'n', data }
  it('draws centred bars whose width is proportional to the value, in data order', () => {
    const bars = tipped(compile(spec))
    expect(bars.map(b => b.tip!.title)).toEqual(['Visit', 'Cart', 'Pay'])
    const mids = bars.map(b => b.x + b.w / 2)
    for (const m of mids) expect(m).toBeCloseTo(mids[0], 5)
    expect(bars[1].w / bars[0].w).toBeCloseTo(0.4, 5)
    expect(bars[2].w / bars[0].w).toBeCloseTo(0.1, 5)
    expect(bars[0].y).toBeLessThan(bars[1].y)
  })
  it('labels value and share of the first stage; the tooltip adds the share of the stage before', () => {
    const s = compile(spec)
    const texts = s.marks.filter((m): m is TextM => m.type === 'text' && m.role === 'label').map(m => m.text)
    expect(texts).toContain('1,000 · 100%')
    expect(texts).toContain('400 · 40%')
    const cart = tipped(s)[1]
    expect(cart.tip!.rows.map(r => [r.label, r.value])).toEqual([['n', '400'], ['Of the first stage', '40%'], ['Of the stage before', '40%']])
    expect(cart.aria).toBe('Cart: 400, 40% of the first stage, 40% of the stage before')
    expect(cart.datum).toEqual({ stage: 'Cart', value: 400, ofFirst: 0.4, ofPrevious: 0.4 })
    expect(compile({ ...spec, labels: false }).marks.filter(m => m.role === 'label')).toHaveLength(0)
  })
  it('warns when a stage is larger than the one before, and still draws it', () => {
    const up = { ...spec, data: [...data, { s: 'Repeat', n: 300 }] }
    const i = issues(up).find(x => x.code === 'funnel_increases')!
    expect(i).toMatchObject({ severity: 'warning', path: 'value' })
    expect(i.message).toContain('"Repeat" is larger than the stage before it ("Pay")')
    expect(tipped(compile(up))).toHaveLength(4)
  })
  it('skips negatives, sums repeated stages, and refuses too many stages', () => {
    expect(codes({ ...spec, data: [...data, { s: 'Bad', n: -3 }] })).toContain('negative_values')
    expect(codes({ ...spec, data: [...data, { s: 'Pay', n: 1 }] })).toContain('duplicate_stages')
    const many = Array.from({ length: 41 }, (_, i) => ({ s: `s${i}`, n: 100 - i }))
    expect(issues({ ...spec, data: many }).find(i => i.code === 'too_many_stages')).toMatchObject({ severity: 'error', path: 'stage' })
  })
  it('shades the drop-off between bars, without texture or tooltip', () => {
    const s = compile({ ...spec, patterns: true })
    const links = s.marks.filter(m => m.type === 'path' && m.role === 'data')
    expect(links).toHaveLength(2)
    expect(links.every(l => l.tip === undefined && l.pattern === undefined)).toBe(true)
    expect(tipped(s).every(b => b.pattern === 0)).toBe(true)
    expect(compile({ ...spec, connectors: false }).marks.filter(m => m.type === 'path' && m.role === 'data')).toHaveLength(0)
  })
  it('splits into small multiples, each against its own first stage; zoom is not a funnel field', () => {
    const f = compile({ ...spec, facet: 'g', data: [...data.map(r => ({ ...r, g: 'Web' })), ...data.map(r => ({ ...r, g: 'App', n: r.n / 2 }))] })
    expect(f.panels!.map(p => p.key)).toEqual(['Web', 'App'])
    expect(tipped(f).filter(b => b.tip!.title === 'Cart').map(b => b.tip!.rows[1].value)).toEqual(['40%', '40%'])
    expect(issues({ ...spec, zoom: 'x' }).find(i => i.code === 'unknown_field')).toMatchObject({ severity: 'error', path: 'zoom' })
  })
  it('describes the conversion and the largest drop', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toBe('Funnel chart. 3 stages (Visit, Cart, Pay), from 1,000 at Visit to 100 at Pay: 10% of the first stage reach the last. Largest drop: Cart to Pay, 25% continue.')
  })
})

describe('bullet', () => {
  const data = [{ m: 'A', v: 60, t: 80, p: 40, o: 70, g: 100 }, { m: 'B', v: 90, t: 75, p: 50, o: 80, g: 100 }]
  const spec = { type: 'bullet', x: 'm', value: 'v', target: 't', ranges: ['p', 'o', 'g'], data }
  const ranges = (s: Scene): RectM[] => rects(s).filter(r => r.series === undefined)
  it('draws ranges darkest first, the value as a bar and the target as a tick on one scale', () => {
    const s = compile(spec)
    const rs = ranges(s).slice(0, 3)
    expect(rs.map(r => r.opacity)).toEqual([0.34, 0.22, 0.1])
    expect(rs.every(r => r.fill === 'var(--sp-text-muted, #5F5F68)')).toBe(true)
    const vals = tipped(s)
    expect(vals.map(v => v.series)).toEqual(['v', 'v'])
    expect(vals[1].w / vals[0].w).toBeCloseTo(1.5, 5)
    expect(vals[0].h).toBeLessThan(rs[0].h)
    const ticks = s.marks.filter((m): m is LineM => m.type === 'line' && m.series === 't')
    expect(ticks).toHaveLength(2)
    expect(ticks[0].x1 - vals[0].x).toBeCloseTo((vals[0].w * 80) / 60, 3)
    expect(s.series.map(x => x.key)).toEqual(['v', 't'])
  })
  it('answers hover anywhere on a row with every number', () => {
    const s = compile(spec)
    const hits = s.marks.filter((m): m is RectM => m.type === 'rect' && m.role === 'hit')
    expect(hits).toHaveLength(2)
    expect(hits[0].tip!.rows.map(r => `${r.label}=${r.value}`)).toEqual(['v=60', 't=80', 'Of target=75%', 'p=up to 40', 'o=up to 70', 'g=up to 100', 'In range=o'])
    expect(tipped(s)[0].aria).toBe('A: v 60, t 80, in range o')
    expect(tipped(s)[0].datum).toEqual({ x: 'A', value: 60, target: 80, ranges: { p: 40, o: 70, g: 100 } })
  })
  it('gives every measure its own scale and ticks with `scale: "each"`', () => {
    const mixed = { ...spec, scale: 'each', data: [data[0], { m: 'C', v: 6000, t: 8000, p: 4000, o: 7000, g: 10000 }] }
    const r = result({ ...mixed, brush: 'x' })
    const vals = tipped(r.scene)
    expect(vals[0].w).toBeCloseTo(vals[1].w, 3) // 60/100 and 6000/10000 fill the same share
    expect(r.scene.axes).toBeUndefined()
    expect(r.issues.map(i => i.code)).toContain('brush_unsupported')
    const ticks = r.scene.marks.filter((m): m is TextM => m.type === 'text' && m.role === 'axis-label').map(m => m.text)
    expect(ticks).toContain('100')
    expect(ticks).toContain('10K')
  })
  it('stands up as columns, but only on a shared scale', () => {
    const s = compile({ ...spec, orientation: 'vertical' })
    expect(s.axes!.x.kind).toBe('band')
    expect(tipped(s)[1].h / tipped(s)[0].h).toBeCloseTo(1.5, 5)
    expect(result({ ...spec, orientation: 'vertical', scale: 'each' }).issues.map(i => i.code)).toContain('scale_each_horizontal')
  })
  it('hides the target from the legend toggle, and warns about unordered ranges or a missing target', () => {
    expect(compile(spec, { hidden: ['t'] }).marks.filter(m => m.type === 'line' && m.series === 't')).toHaveLength(0)
    expect(codes({ ...spec, data: [{ m: 'A', v: 1, t: 2, p: 5, o: 3, g: 9 }] })).toContain('ranges_not_increasing')
    expect(codes({ type: 'bullet', x: 'm', value: 'v', data })).toContain('prefer_bar')
    expect(codes({ ...spec, data: [...data, { m: 'A', v: 1 }] })).toContain('duplicate_measures')
  })
  it('shares the value range across small multiples even when horizontal', () => {
    const f = compile({ ...spec, facet: 'grp', data: [{ ...data[0], grp: 'x', v: 100 }, { ...data[0], grp: 'y', v: 300, g: 300 }] })
    const vals = tipped(f)
    expect(vals[1].w / vals[0].w).toBeCloseTo(3, 1)
  })
  it('describes each measure against its target and range', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toBe('Bullet chart. 2 measures (A, B) against targets, with ranges p, o, g. A: 60 against 80 (75% of target), in o. B: 90 against 75 (120% of target), in g.')
  })
})

describe('bump', () => {
  const data = [
    { r: 1, s: 'a', v: 10 }, { r: 1, s: 'b', v: 20 }, { r: 1, s: 'c', v: 5 },
    { r: 2, s: 'a', v: 30 }, { r: 2, s: 'b', v: 15 }, { r: 2, s: 'c', v: 1 },
    { r: 3, s: 'a', v: 12 }, { r: 3, s: 'b', v: 12 }, { r: 3, s: 'c', v: 40 }
  ]
  const spec = { type: 'bump', x: 'r', y: 'v', series: 's', data }
  const dots = (s: Scene): CircleM[] => s.marks.filter((m): m is CircleM => m.type === 'circle' && m.role === 'data')
  it('ranks values per x, highest first, ties by series order, rank 1 on top', () => {
    const m = bumpModel(validatePlot(spec).spec!)
    expect([...m.ranks.get('a')!.values()]).toEqual([2, 1, 2])
    expect([...m.ranks.get('b')!.values()]).toEqual([1, 2, 3])
    expect([...m.ranks.get('c')!.values()]).toEqual([3, 3, 1])
    const s = compile(spec)
    const at = (series: string, x: string): CircleM => dots(s).find(d => d.series === series && (d.datum as { x: string }).x === x)!
    expect(at('b', '1').cy).toBeLessThan(at('a', '1').cy)
    expect(at('c', '3').cy).toBeLessThan(at('a', '3').cy)
    const asc = bumpModel(validatePlot({ ...spec, rankBy: 'asc' }).spec!)
    expect([...asc.ranks.get('c')!.values()]).toEqual([1, 1, 3])
  })
  it('reads a rank column, which needs series; either rank or y is required', () => {
    const r = bumpModel(validatePlot({ type: 'bump', x: 'r', rank: 'k', series: 's', data: [{ r: 1, s: 'a', k: 2 }, { r: 1, s: 'b', k: 1 }, { r: 2, s: 'a', k: 1 }, { r: 2, s: 'b', k: 2 }] }).spec!)
    expect([...r.ranks.get('a')!.values()]).toEqual([2, 1])
    expect(issues({ type: 'bump', x: 'r', series: 's', data }).find(i => i.code === 'missing_required')).toMatchObject({ severity: 'error', path: 'y' })
    expect(issues({ type: 'bump', x: 'r', rank: 'v', data }).find(i => i.code === 'missing_required')).toMatchObject({ path: 'series' })
    expect(codes({ ...spec, rank: 'v' })).toContain('y_ignored')
    expect(codes({ type: 'bump', x: 'r', rank: 'k', series: 's', data: [{ r: 1, s: 'a', k: 0 }, { r: 1, s: 'b', k: 1 }, { r: 2, s: 'a', k: 1 }] })).toContain('bad_rank')
  })
  it('labels each line at its end and puts a dot with rank, value and movement on every point', () => {
    const s = compile(spec)
    const labels = s.marks.filter((m): m is TextM => m.type === 'text' && m.role === 'label')
    expect(labels.map(l => l.text)).toEqual(['a', 'b', 'c'])
    const lastA = dots(s).filter(d => d.series === 'a').at(-1)!
    expect(labels[0].x).toBeGreaterThan(lastA.cx)
    expect(labels[0].y).toBeCloseTo(lastA.cy, 5)
    expect(dots(s)).toHaveLength(9)
    const a2 = dots(s).find(d => d.series === 'a' && (d.datum as { x: string }).x === '2')!
    expect(a2.tip!.rows.map(r => r.value)).toEqual(['#1', '30', 'up 1'])
    expect(a2.aria).toBe('a, 2: rank 1, 30, up 1')
    expect(compile({ ...spec, labels: false }).marks.filter(m => m.role === 'label')).toHaveLength(0)
  })
  it('leaves a gap where a series is missing, and sorts numeric x', () => {
    const gap = [...data.filter(r => !(r.s === 'a' && r.r === 2))].reverse()
    const s = compile({ ...spec, data: gap })
    expect(s.marks.filter(m => m.type === 'path' && m.series === 'a')).toHaveLength(0)
    expect(s.marks.filter(m => m.type === 'path' && m.series === 'b')).toHaveLength(1)
    expect(s.axes!.x.domain).toEqual(['1', '2', '3'])
  })
  it('draws at most LIMITS.maxSeries series (best average rank) and says so', () => {
    const many = Array.from({ length: 10 }, (_, i) => [1, 2].map(r => ({ r, s: `s${i}`, v: 100 - i + r }))).flat()
    const sp = { ...spec, data: many }
    expect(issues(sp).find(i => i.code === 'too_many_series')).toMatchObject({ severity: 'warning', path: 'series' })
    const s = compile(sp)
    expect(s.series.map(x => x.key)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'])
    expect(result(sp).issues.filter(i => i.code === 'too_many_series')).toHaveLength(1)
  })
  it('hides a series without re-ranking the others', () => {
    const all = dots(compile(spec)).filter(d => d.series === 'a').map(d => d.cy)
    const hid = compile(spec, { hidden: ['b'] })
    expect(dots(hid).some(d => d.series === 'b')).toBe(false)
    expect(dots(hid).filter(d => d.series === 'a').map(d => d.cy)).toEqual(all)
  })
  it('refuses patterns and zoom with warnings, brushes x, and facets', () => {
    expect(codes({ ...spec, patterns: true })).toContain('patterns_unsupported')
    expect(result({ ...spec, zoom: 'x' }).issues.map(i => i.code)).toContain('zoom_unsupported')
    expect(compile({ ...spec, brush: 'x' }).axes!.brush).toBe('x')
    const f = compile({ ...spec, facet: 'g', data: [...data.map(r => ({ ...r, g: 'p' })), ...data.map(r => ({ ...r, g: 'q', v: -r.v }))] })
    expect(f.panels).toHaveLength(2)
  })
  it('describes the final order and the biggest moves', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toBe('Bump chart. Ranks of 3 series (a, b, c) over 3 steps from 1 to 3, ranked by v, highest first. At 3: 1. c, 2. a, 3. b. Biggest climb: c, from 3 to 1. Biggest fall: b, from 1 to 3.')
  })
})

describe('the new charts on every surface', () => {
  const types = ['waterfall', 'funnel', 'bullet', 'bump']
  it('draw on a 2D context and index their marks for hover', () => {
    const calls: string[] = []
    const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '' }
    for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fill', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'bezierCurveTo', 'quadraticCurveTo', 'rect', 'clip']) ctx[k] = () => calls.push(k)
    for (const t of types) {
      const s = compile(ex(t))
      expect(() => drawScene(ctx as unknown as Canvas2D, s)).not.toThrow()
      const idx = buildHitIndex(s)
      const i = s.marks.findIndex(m => m.role === 'data' && m.tip && m.type === 'rect')
      if (i >= 0) {
        const m = s.marks[i] as RectM
        expect(idx.at(m.x + m.w / 2, m.y + m.h / 2)).toBeGreaterThanOrEqual(i)
      }
    }
    expect(calls).toContain('fillText')
  })
  it('every data mark with a tooltip has aria text and a datum', () => {
    for (const t of types) for (const m of compile(ex(t)).marks) if (m.role === 'data' && m.tip) {
      expect(m.aria, `${t} ${JSON.stringify(m.tip)}`).toBeTruthy()
      expect(m.datum).toBeDefined()
    }
  })
  it('list the columns they read in the data table (a flag column too, a label list not)', () => {
    expect(plotTable({ type: 'waterfall', x: 'k', y: 'v', total: 't', data: [{ k: 'a', v: 1, t: false }] })!.columns.map(c => c.key)).toEqual(['k', 'v', 't'])
    expect(plotTable({ type: 'waterfall', x: 'k', y: 'v', total: ['a'], data: [{ k: 'a', v: 1 }] })!.columns.map(c => c.key)).toEqual(['k', 'v'])
    expect(plotTable(ex('bullet'))!.columns.map(c => c.key)).toEqual(['kpi', 'actual', 'target', 'poor', 'fair', 'good'])
  })
  it('declare the flag field in the JSON Schema as a column or a list', () => {
    const branch = (plotJsonSchema().oneOf as { properties: Record<string, any>; title: string }[]).find(b => b.title === 'Waterfall chart')!
    expect(branch.properties.total.oneOf.map((o: { type: string }) => o.type)).toEqual(['string', 'array'])
  })
})
