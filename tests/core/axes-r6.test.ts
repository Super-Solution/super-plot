import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, describePlot, renderToSvg, drawScene, buildHitIndex, applyTransform, type Canvas2D, type Issue, type Scene, type Mark } from '../../packages/core/src'
import { alignZero, brokenScale, BREAK_GAP } from '../../packages/core/src/charts/valueaxes'

type R = Record<string, unknown>
const codes = (spec: unknown): [string, string, string][] => validatePlot(spec).issues.map(i => [i.severity, i.code, i.path])
const compiled = (spec: unknown, o = {}): { scene: Scene; issues: Issue[] } => {
  const r = compilePlot(spec, { width: 640, height: 400, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return { scene: r.scene, issues: r.issues }
}
const texts = (s: Scene): Extract<Mark, { type: 'text' }>[] => s.marks.filter((m): m is Extract<Mark, { type: 'text' }> => m.type === 'text')

const weeks: R[] = [
  { w: '2026-09-07', orders: 1180, conv: 0.031 }, { w: '2026-09-14', orders: 1240, conv: 0.032 },
  { w: '2026-09-21', orders: 1225, conv: 0.029 }, { w: '2026-09-28', orders: 1310, conv: 0.034 }
]
const dual = (extra: R = {}): R => ({ type: 'line', x: 'w', y: 'orders', yRight: 'conv', formatRight: 'percent', yLabel: 'Orders', yRightLabel: 'Conversion', data: weeks, ...extra })

describe('yRight: a second value axis', () => {
  it('always carries a dual_axis info issue that names the risk and the safer alternatives', () => {
    const v = validatePlot(dual())
    expect(v.ok).toBe(true)
    const info = v.issues.find(i => i.code === 'dual_axis')!
    expect(info).toMatchObject({ severity: 'info', path: 'yRight' })
    expect(info.message).toMatch(/choice of the two ranges/)
    expect(info.hint).toMatch(/index/)
    expect(info.hint).toMatch(/sync/)
  })
  it('draws the right series on its own scale, with its axis, ink, legend label and tooltip format', () => {
    const { scene } = compiled(dual())
    const ax = scene.axes!
    expect(ax.y2).toMatchObject({ kind: 'linear', field: 'conv' })
    expect((ax.y2!.domain as number[])[1]).toBeLessThan(1)
    expect((ax.y.domain as number[])[1]).toBeGreaterThan(1000)
    // Identity is not colour alone: the legend says which series uses the right axis.
    expect(scene.series.map(s => s.label)).toEqual(['orders', 'conv (right axis)'])
    // Right tick labels sit right of the plot and are percentages, in the right axis's ink.
    const right = texts(scene).filter(t => t.x > ax.plot.x + ax.plot.w && t.role === 'axis-label' && !t.rotate)
    expect(right.length).toBeGreaterThan(2)
    expect(right.every(t => t.text.endsWith('%'))).toBe(true)
    expect(right[0].fill).toBe(ax.y2!.ink)
    const title = texts(scene).find(t => t.text === 'Conversion')!
    expect(title).toMatchObject({ rotate: 90, fill: ax.y2!.ink })
    expect(texts(scene).find(t => t.text === 'Orders')!.fill).toBe(ax.y.ink)
    // Tooltips: each value in its own axis's format.
    const hit = scene.marks.find(m => m.role === 'hit')!
    expect(hit.tip!.rows).toEqual([expect.objectContaining({ label: 'orders', value: '1,180' }), expect.objectContaining({ label: 'conv (right axis)', value: '3.1%' })])
    // The focus dot of the right series sits where its own scale puts it (top of the right range for the maximum).
    expect(hit.focus).toHaveLength(2)
  })
  it('mixes a light series colour towards the text colour so the labels stay readable', () => {
    const { scene } = compiled(dual())
    expect(scene.axes!.y2!.ink).toMatch(/^#[0-9a-f]{6}$/i)
    const dark = compiled(dual(), { theme: 'dark' }).scene
    expect(dark.axes!.y2!.ink).toMatch(/var\(--sp-series-2/)
  })
  it('the description says which series is on which axis, with units and ranges', () => {
    const d = describePlot(dual())
    expect(d.ok && d.text).toContain('conv (right axis): from 3.1%')
    expect(d.ok && d.text).toContain('the left axis (Orders) shows orders (1,180 to 1,310); the right axis (Conversion) shows conv (2.9% to 3.4%)')
    expect(d.ok && d.text).toContain('depends on the two chosen ranges')
  })
  it('rightDomain fixes the right range; with several series per axis the labels stay neutral', () => {
    const { scene } = compiled(dual({ rightDomain: [0, 0.05] }))
    expect(scene.axes!.y2!.domain).toEqual([0, 0.05])
    const two = compiled({ type: 'line', x: 'w', y: 'orders', yRight: ['conv', 'c2'], data: weeks.map((r, i) => ({ ...r, c2: i })) }).scene
    expect(two.axes!.y2!.ink).toBeUndefined()
    expect(two.axes!.y2!.field).toBeUndefined()
    expect(two.axes!.y.ink).toBeDefined()
  })
  it('keeps zoom and brush on x and refuses them on y with a warning', () => {
    const { scene, issues } = compiled(dual({ zoom: 'xy', brush: 'xy' }))
    expect(scene.axes).toMatchObject({ zoom: 'x', brush: 'x' })
    expect(issues.filter(i => i.code.endsWith('_refused')).map(i => [i.severity, i.code, i.path])).toEqual([['warning', 'zoom_refused', 'zoom'], ['warning', 'brush_refused', 'brush']])
    expect(compiled(dual({ zoom: 'x', brush: 'x' })).issues.some(i => i.code.endsWith('_refused'))).toBe(false)
    // Zooming x still works: the view overrides xDomain, both axes refit.
    const z = compiled(dual({ zoom: 'x' }), { view: { x: [Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 21)] } }).scene
    expect(z.axes!.x.domain).toEqual([Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 21)])
  })
  it('works on unstacked areas and refuses stacked ones and log axes', () => {
    expect(compiled({ type: 'area', x: 'w', y: 'orders', yRight: 'conv', data: weeks }).scene.axes!.y2).toBeDefined()
    expect(codes({ type: 'area', x: 'w', y: ['orders', 'conv'], yRight: 'x', stack: 'stack', data: weeks.map(r => ({ ...r, x: 1 })) })).toContainEqual(['error', 'dual_axis_refused', 'yRight'])
    expect(codes(dual({ yScale: 'log' }))).toContainEqual(['error', 'dual_axis_refused', 'yRight'])
  })
  it('refuses a column on both axes; warns about right-axis fields without yRight', () => {
    expect(codes(dual({ y: ['orders', 'conv'] }))).toContainEqual(['error', 'dual_axis_overlap', 'yRight'])
    expect(codes({ type: 'line', x: 'w', y: 'orders', rightDomain: [0, 1], data: weeks })).toEqual([['warning', 'right_axis_unused', 'rightDomain']])
  })
  it('a hidden right series keeps its axis where it was', () => {
    const a = compiled(dual()).scene.axes!.y2!.domain
    const b = compiled(dual(), { hidden: ['conv'] }).scene.axes!.y2!.domain
    expect(b).toEqual(a)
  })
  it('bars: lines on the right axis, zero on both axes and the two zeros lined up', () => {
    const data = [{ k: 'a', v: -40, r: 3 }, { k: 'b', v: 120, r: 7 }, { k: 'c', v: 80, r: 5 }]
    const { scene } = compiled({ type: 'bar', x: 'k', y: 'v', yRight: 'r', data })
    const ax = scene.axes!
    const zero = (d: number[], range: number[]): number => range[0] + ((0 - d[0]) / (d[1] - d[0])) * (range[1] - range[0])
    expect(zero(ax.y.domain as number[], ax.y.range)).toBeCloseTo(zero(ax.y2!.domain as number[], ax.y2!.range), 6)
    expect((ax.y2!.domain as number[])[0]).toBeLessThan(0)
    expect(scene.series.map(s => s.label)).toEqual(['v', 'r (right axis)'])
    const pts = scene.marks.filter(m => m.type === 'circle' && m.series === 'r')
    expect(pts).toHaveLength(3)
    expect(pts[0].tip!.rows[0].label).toBe('r (right axis)')
    expect(alignZero([0, 10], [0, 5])).toEqual([[0, 10], [0, 5]])
    const [l, r] = alignZero([-5, 10], [0, 4])
    expect(l).toEqual([-5, 10])
    expect(r[0]).toBeCloseTo(-2, 9)
    expect(alignZero([10, 20], [-1, 4])).toEqual([[10, 20], [-1, 4]])
  })
  it('bars: ignored with a warning on horizontal and 100% stacked bars', () => {
    const data = [{ k: 'a', v: 4, r: 3 }]
    expect(codes({ type: 'bar', x: 'k', y: 'v', yRight: 'r', orientation: 'horizontal', data })).toEqual([['warning', 'dual_axis_ignored', 'yRight']])
    expect(compiled({ type: 'bar', x: 'k', y: 'v', yRight: 'r', orientation: 'horizontal', data }).scene.axes!.y2).toBeUndefined()
  })
  it('facets: every panel gets two axes, the right range is shared, the right title is drawn once', () => {
    const data = weeks.flatMap(r => [{ ...r, g: 'A' }, { ...r, g: 'B', conv: (r.conv as number) * 3 }])
    const { scene, issues } = compiled(dual({ data, facet: 'g' }))
    expect(issues.map(i => i.code)).toEqual(['dual_axis'])
    expect(scene.panels).toHaveLength(2)
    expect(texts(scene).filter(t => t.text === 'Conversion' && t.rotate === 90)).toHaveLength(1)
    // The largest right tick label (shared range) is the same in both panels.
    const right = (p: { x: number; w: number }): string[] => texts(scene).filter(t => t.role === 'axis-label' && !t.rotate && t.x > p.x + p.w && t.x < p.x + p.w + 60).map(t => t.text)
    const [a, b] = scene.panels!.map(p => right(p.plot))
    expect(a.length).toBeGreaterThan(1)
    expect(a).toEqual(b)
  })
  it('is deterministic and draws on canvas with the same hit marks', () => {
    expect(renderToSvg(dual())).toBe(renderToSvg(dual()))
    const { scene } = compiled(dual())
    const calls: string[] = []
    const ctx: Record<string, unknown> = { globalAlpha: 1 }
    for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fill', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash']) ctx[k] = () => calls.push(k)
    drawScene(ctx as unknown as Canvas2D, scene)
    expect(calls).toContain('rotate')
    const idx = buildHitIndex(scene)
    const hit = scene.marks.findIndex(m => m.role === 'hit')
    const h = scene.marks[hit]
    if (h.type !== 'rect') throw new Error('hit strips are rects')
    expect(idx.at(h.x + 1, h.y + 1)).toBe(hit)
  })
})

const svc = [{ k: 'Search', v: 960 }, { k: 'Auth', v: 31 }, { k: 'Billing', v: 12 }]
const broken = (extra: R = {}): R => ({ type: 'bar', x: 'k', y: 'v', yBreak: [40, 900], data: svc, ...extra })

describe('yBreak: a broken value axis', () => {
  it('always carries an axis_break info issue with the hidden span', () => {
    const v = validatePlot(broken())
    expect(v.issues.map(i => [i.severity, i.code, i.path])).toEqual([['info', 'axis_break', 'yBreak']])
    expect(v.issues[0].message).toContain('from 40 to 900: a span of 860 is not drawn')
  })
  it('draws the cut: a gap across the plot and zigzags, ticks on both sides, real values in tips', () => {
    const { scene } = compiled(broken({ labels: true }))
    const ax = scene.axes!
    expect(ax.y.breaks).toEqual([40, 900])
    const ann = scene.marks.filter(m => m.role === 'annotation' && m.type === 'path')
    expect(ann).toHaveLength(3)
    expect(ann[0].type === 'path' && ann[0].fill).toMatch(/background/)
    expect(ann.slice(1).every(m => m.type === 'path' && m.stroke)).toBe(true)
    // The gap comes after the bars, so it cuts across the one that crosses it.
    const iGap = scene.marks.indexOf(ann[0])
    expect(scene.marks.findIndex(m => m.role === 'data' && m.series === 'v')).toBeLessThan(iGap)
    const ticks = texts(scene).filter(t => t.role === 'axis-label' && t.x < ax.plot.x).map(t => Number(t.text.replace(/,/g, '')))
    expect(ticks.some(v => v < 40)).toBe(true)
    expect(ticks.some(v => v >= 900)).toBe(true)
    expect(ticks.some(v => v > 40 && v < 900)).toBe(false)
    const search = scene.marks.find(m => m.role === 'data' && m.tip?.title === 'Search')!
    expect(search.tip!.rows[0].value).toBe('960')
    expect(search.aria).toBe('Search, v: 960')
    expect(texts(scene).some(t => t.role === 'label' && t.text === '960')).toBe(true)
  })
  it('keeps the same pixels per unit on both sides of the gap', () => {
    const s = brokenScale([0, 1000], [40, 900], 18)
    s.range = [400, 0]
    const k1 = (s.at(0) - s.at(40)) / 40
    const k2 = (s.at(900) - s.at(1000)) / 100
    expect(k1).toBeCloseTo(k2, 9)
    expect(s.at(40) - s.at(900)).toBeCloseTo(BREAK_GAP, 9)
    for (const v of [0, 13, 40, 470, 900, 955, 1000]) expect(s.invert(s.at(v))).toBeCloseTo(v, 9)
  })
  it('refuses a break that cuts out zero (bars lose their baseline)', () => {
    expect(codes(broken({ yBreak: [0, 900] }))).toEqual([['error', 'break_misleading', 'yBreak']])
    expect(codes({ type: 'bar', x: 'k', y: 'v', yBreak: [-5, 5], data: [{ k: 'a', v: -4 }, { k: 'b', v: 80 }] })).toEqual([['error', 'break_misleading', 'yBreak']])
    // Below zero, for negative bars, it is fine.
    const neg = compiled({ type: 'bar', x: 'k', y: 'v', yBreak: [-900, -40], data: [{ k: 'a', v: -12 }, { k: 'b', v: -960 }] })
    expect(neg.scene.axes!.y.breaks).toEqual([-900, -40])
  })
  it('a value inside the cut: a warning with the count, drawn at the edge and marked', () => {
    const spec = broken({ data: [...svc, { k: 'Media', v: 500 }] })
    const w = validatePlot(spec).issues.find(i => i.code === 'break_hides_values')!
    expect(w).toMatchObject({ severity: 'warning', path: 'yBreak' })
    expect(w.message).toMatch(/^1 value lies inside the cut-out span \(500\)/)
    const { scene } = compiled(spec)
    const media = scene.marks.find(m => m.role === 'data' && m.tip?.title === 'Media')!
    expect(media.tip!.rows[0].value).toBe('500 (inside the axis break, drawn at its edge)')
    expect(media.aria).toContain('inside the axis break')
    expect(scene.marks.some(m => m.role === 'annotation' && m.type === 'rect' && m.series === 'v' && m.fill === 'none')).toBe(true)
    expect(describePlot(spec).ok && (describePlot(spec) as { text: string }).text).toContain('1 value lies inside the cut and is drawn at its edge')
  })
  it('a break with nothing beyond it is dropped with a warning', () => {
    const v = validatePlot(broken({ yBreak: [970, 990] }))
    expect(v.issues.map(i => i.code)).toEqual(['break_outside'])
    expect(v.spec!.yBreak).toBeUndefined()
    expect(compiled(broken({ yBreak: [970, 990] })).scene.axes!.y.breaks).toBeUndefined()
  })
  it('refuses log, stacked and two-axis charts, and an open end', () => {
    expect(codes(broken({ y: ['v', 'w'], stack: 'stack', data: svc.map(r => ({ ...r, w: 1 })) }))).toContainEqual(['error', 'break_refused', 'yBreak'])
    expect(codes({ type: 'line', x: 'k', y: 'v', yScale: 'log', yBreak: [40, 900], data: svc })).toContainEqual(['error', 'break_refused', 'yBreak'])
    expect(codes(broken({ yRight: 'w', data: svc.map(r => ({ ...r, w: 1 })) }))).toContainEqual(['error', 'break_refused', 'yBreak'])
    expect(codes(broken({ yBreak: [40, null] }))).toEqual([['error', 'bad_value', 'yBreak']])
  })
  it('horizontal bars break along x; a brush there is refused', () => {
    const { scene, issues } = compiled(broken({ orientation: 'horizontal', brush: 'x' }))
    expect(scene.axes!.x.breaks).toEqual([40, 900])
    expect(scene.axes!.brush).toBeUndefined()
    expect(issues.map(i => i.code)).toContain('brush_refused')
  })
  it('lines: the gap, a ring for a point inside it, zoom on y refused, zoom on x kept', () => {
    const data = [{ x: 1, v: 10 }, { x: 2, v: 20 }, { x: 3, v: 950 }, { x: 4, v: 500 }, { x: 5, v: 30 }]
    const spec = { type: 'line', x: 'x', y: 'v', xType: 'linear', yBreak: [40, 900], zoom: 'xy', data }
    const { scene, issues } = compiled(spec)
    expect(scene.axes).toMatchObject({ zoom: 'x' })
    expect(issues.map(i => i.code)).toEqual(['break_hides_values', 'axis_break', 'zoom_refused'])
    expect(scene.marks.filter(m => m.role === 'annotation' && m.type === 'circle')).toHaveLength(1)
    const hit = scene.marks.find(m => m.role === 'hit' && (m.datum as { x: number }).x === 4)!
    expect(hit.tip!.rows[0].value).toContain('inside the axis break')
    expect(describePlot(spec).ok && (describePlot(spec) as { text: string }).text).toContain('so changes across it look smaller than they are')
  })
  it('on canvas the gap does not take the hover from the bar it crosses', () => {
    const { scene } = compiled(broken())
    const i = scene.marks.findIndex(m => m.role === 'data' && m.tip?.title === 'Search')
    const bar = scene.marks[i]
    if (bar.type !== 'rect') throw new Error('bars are rects')
    const s = brokenScale([0, 1000], [40, 900], 18)
    s.range = scene.axes!.y.range
    expect(buildHitIndex(scene).at(bar.x + bar.w / 2, (s.at(40) + s.at(900)) / 2)).toBe(i)
  })
  it('lollipops inside the cut keep their dot above the gap, as a data mark', () => {
    const { scene } = compiled(broken({ mark: 'lollipop', data: [...svc, { k: 'Media', v: 500 }] }))
    const gap = scene.marks.findIndex(m => m.role === 'annotation' && m.type === 'path')
    const dot = scene.marks.findIndex(m => m.type === 'circle' && m.role === 'data' && m.tip?.title === 'Media')
    expect(dot).toBeGreaterThan(gap)
  })
})

describe('index transform step', () => {
  const rows: R[] = [
    { d: '2026-02-01', g: 'big', v: 4400 }, { d: '2026-01-01', g: 'big', v: 4000 }, { d: '2026-01-01', g: 'small', v: 200 },
    { d: '2026-02-01', g: 'small', v: 260 }, { d: '2026-03-01', g: 'small', v: 'n/a' }
  ]
  const run = (step: R, data = rows): { rows: R[] | null; issues: Issue[] } => {
    const issues: Issue[] = []
    return { rows: applyTransform([{ index: step }], data, issues), issues }
  }
  it('rescales each group so its first value in sortBy order is the base', () => {
    const out = run({ field: 'v', groupBy: ['g'], sortBy: 'd' }).rows!
    expect(out.map(r => r.v)).toEqual([110, 100, 100, 130, null])
    expect(out.map(r => r.d)).toEqual(rows.map(r => r.d))
  })
  it('takes another base, a base row by value, and a new column', () => {
    const out = run({ field: 'v', groupBy: ['g'], sortBy: 'd', at: '2026-02-01', base: 1, as: 'ratio' }).rows!
    expect(out.map(r => r.ratio)).toEqual([1, 4000 / 4400, 200 / 260, 1, null])
    expect(out[0].v).toBe(4400)
  })
  it('drops a group whose base is zero, missing, negative or absent, naming each', () => {
    const data = [...rows, { d: '2026-01-01', g: 'zero', v: 0 }, { d: '2026-02-01', g: 'zero', v: 3 }, { d: '2026-01-01', g: 'gap', v: null }, { d: '2026-01-01', g: 'neg', v: -1 }]
    const { rows: out, issues } = run({ field: 'v', groupBy: ['g'], sortBy: 'd' }, data)
    expect(out!.map(r => r.g)).toEqual(['big', 'big', 'small', 'small', 'small'])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning', code: 'index_group_dropped', path: 'transform[0].index.field' })
    expect(issues[0].message).toContain('3 groups have no usable base value')
    expect(issues[0].message).toContain('"zero" (base is 0), "gap" (base is missing), "neg" (base is negative)')
    expect(run({ field: 'v', groupBy: ['g'], sortBy: 'd', at: '2026-03-01' }).issues[0].message).toContain('"big" (no row at "2026-03-01"), "small" (base is not a number)')
  })
  it('validates its keys with codes, paths and hints', () => {
    const first = (step: R): [string, string] => { const i = run(step).issues[0]; return [i.code, i.path] }
    expect(first({ field: 'v', at: '2026-01-01' })).toEqual(['missing_required', 'transform[0].index.sortBy'])
    expect(first({ field: 'v', base: 0 })).toEqual(['bad_value', 'transform[0].index.base'])
    expect(first({ field: 'v', sortBy: 'd', at: [1] })).toEqual(['bad_type', 'transform[0].index.at'])
    expect(first({ field: 'g' })).toEqual(['not_numeric', 'transform[0].index.field'])
    expect(first({ field: 'v', groupBy: ['gg'] })).toEqual(['no_such_column', 'transform[0].index.groupBy[0]'])
    expect(run({ field: 'v', bse: 1 }).issues[0]).toMatchObject({ code: 'unknown_field', hint: 'Did you mean "base"?' })
  })
  it('feeds a chart: two series of different size on one axis, both from 100', () => {
    const spec = { type: 'line', x: 'd', y: 'v', series: 'g', data: rows, transform: [{ index: { field: 'v', groupBy: ['g'], sortBy: 'd' } }] }
    const { scene, issues } = compiled(spec)
    expect(issues).toEqual([])
    expect((scene.axes!.y.domain as number[])[0]).toBeLessThanOrEqual(100)
    expect(describePlot(spec).ok && (describePlot(spec) as { text: string }).text).toContain('big: from 100')
    // Every group dropped: the chart has nothing left to plot.
    expect(codes({ ...spec, transform: [{ index: { field: 'v', groupBy: ['g'], sortBy: 'd', at: '1999-01-01' } }] }).map(c => c[1])).toEqual(['index_group_dropped', 'empty_after_transform'])
  })
})
