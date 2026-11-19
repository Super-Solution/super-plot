import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, validatePlot, renderToSvg, drawScene, buildHitIndex, type Canvas2D, type Scene, type Mark } from '../../packages/core/src'
import { waffleCells, waffleGrid } from '../../packages/core/src/charts/waffle'
import { dodge, BEESWARM_MAX } from '../../packages/core/src/charts/beeswarm'

const compile = (spec: unknown, o = {}): { scene: Scene; issues: { code: string; path: string; severity: string; message: string; hint?: string }[] } => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return { scene: r.scene, issues: r.issues }
}
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => i.code)
const data = (spec: Scene): Mark[] => spec.marks.filter(m => m.role === 'data')
type Circle = Extract<Mark, { type: 'circle' }>
const circles = (s: Scene): Circle[] => s.marks.filter((m): m is Circle => m.type === 'circle' && m.role === 'data')
/** Rounded squares in a waffle path: one `M` per cell. */
const cellCount = (m: Mark): number => (m.type === 'path' ? (m.d.match(/M/g) ?? []).length : 0)

function recorder(): { ctx: Canvas2D; calls: string[] } {
  const calls: string[] = []
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '' }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fill', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash']) ctx[k] = () => calls.push(k)
  return { ctx: ctx as unknown as Canvas2D, calls }
}

describe('waffle', () => {
  const base = { type: 'waffle', label: 'k', value: 'v', data: [{ k: 'A', v: 1 }, { k: 'B', v: 1 }, { k: 'C', v: 1 }] }

  it('shares cells out by largest remainder, always summing to the cell count', () => {
    expect(waffleCells([1, 1, 1], 100)).toEqual([34, 33, 33]) // tie in remainder: data order wins
    expect(waffleCells([2, 1, 1], 100)).toEqual([50, 25, 25])
    expect(waffleCells([0.4, 0.4, 99.2], 100)).toEqual([1, 0, 99]) // equal remainders .4: the first one gets the spare cell
    expect(waffleCells([3, 0, -1], 100)).toEqual([100, 0, 0])
    expect(waffleCells([0, 0], 100)).toEqual([0, 0])
    for (const n of [50, 100, 230, 400]) {
      const vals = Array.from({ length: 8 }, (_, i) => ((i * 7919) % 97) + 0.37 * i)
      expect(waffleCells(vals, n).reduce((q, v) => q + v, 0)).toBe(n)
    }
  })

  it('fixes the grid by the cell count', () => {
    expect(waffleGrid(100)).toEqual({ cols: 10, rows: 10 })
    expect(waffleGrid(50)).toEqual({ cols: 10, rows: 5 })
    expect(waffleGrid(200)).toEqual({ cols: 20, rows: 10 })
    expect(waffleGrid(400)).toEqual({ cols: 40, rows: 10 })
  })

  it('draws one path per category whose cells add up, with tip, aria and datum', () => {
    const { scene } = compile(base)
    const marks = data(scene)
    expect(marks).toHaveLength(3)
    expect(marks.map(cellCount)).toEqual([34, 33, 33])
    for (const m of marks) {
      expect(m.tip?.rows.find(r => r.label === 'Cells')).toBeTruthy()
      expect(m.aria).toMatch(/of 100 cells/)
      expect(m.datum).toMatchObject({ label: expect.any(String), cells: expect.any(Number) })
    }
    // Legend with percentages.
    expect(scene.marks.some(m => m.type === 'text' && m.role === 'legend' && m.text === '33.3%')).toBe(true)
  })

  it('fills in reading order: the first category takes the first cells, row by row', () => {
    const { scene } = compile({ ...base, data: [{ k: 'A', v: 15 }, { k: 'B', v: 85 }], sort: 'none' })
    const [a, b] = data(scene) as Extract<Mark, { type: 'path' }>[]
    const starts = (d: string): [number, number][] => [...d.matchAll(/M([\d.]+) ([\d.]+)/g)].map(m => [+m[1], +m[2]])
    const pa = starts(a.d)
    const pb = starts(b.d)
    expect(pa).toHaveLength(15)
    // A: the whole first row and half the second; B starts right after.
    expect(pa.slice(0, 10).every(p => p[1] === pa[0][1])).toBe(true)
    expect(pa[10][1]).toBeGreaterThan(pa[0][1])
    expect(pb[0][1]).toBe(pa[10][1])
    expect(pb[0][0]).toBeGreaterThan(pa[14][0])
  })

  it('accepts 50..400 cells in multiples of ten and refuses the rest with a code', () => {
    expect(data(compile({ ...base, cells: 400 }).scene).reduce((q, m) => q + cellCount(m), 0)).toBe(400)
    expect(codes({ ...base, cells: 250 })).toEqual([])
    expect(codes({ ...base, cells: 125 })).toContain('bad_value')
    expect(validatePlot({ ...base, cells: 125 }).issues[0]).toMatchObject({ path: 'cells', hint: 'Try 130.' })
    expect(codes({ ...base, cells: 40 })).toContain('out_of_range')
    expect(codes({ ...base, cells: 500 })).toContain('out_of_range')
    expect(codes({ ...base, data: [{ k: 'A', v: 0 }] })).toContain('no_positive_values')
  })

  it('folds categories past the series limit into "Other" with a warning, like pie', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ k: `c${i}`, v: 100 - i }))
    const { scene, issues } = compile({ ...base, data: rows })
    expect(scene.series.map(s => s.key)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'Other'])
    expect(issues.find(i => i.code === 'many_categories')).toMatchObject({ path: 'label', severity: 'warning' })
    expect(data(scene).reduce((q, m) => q + cellCount(m), 0)).toBe(100)
  })

  it('warns when a category rounds to no cell and keeps it in the legend', () => {
    const { scene, issues } = compile({ ...base, data: [{ k: 'Big', v: 998 }, { k: 'Tiny', v: 2 }] })
    expect(issues.find(i => i.code === 'rounded_to_zero')).toMatchObject({ path: 'cells' })
    expect(data(scene)).toHaveLength(1)
    expect(scene.series.map(s => s.key)).toContain('Tiny')
  })

  it('re-shares the cells among the categories left when one is hidden, keeping colours', () => {
    const all = compile(base).scene
    const hid = compile(base, { hidden: ['A'] }).scene
    expect(data(hid).map(cellCount)).toEqual([50, 50])
    expect(hid.series.find(s => s.key === 'B')!.color).toBe(all.series.find(s => s.key === 'B')!.color)
    const none = compile(base, { hidden: ['A', 'B', 'C'] }).scene
    expect(data(none)).toHaveLength(0)
    expect(none.marks.some(m => m.role === 'grid' && cellCount(m) === 100)).toBe(true)
  })

  it('textures each category with patterns and works under facet', () => {
    const { scene } = compile({ ...base, patterns: true })
    expect(data(scene).map(m => m.pattern)).toEqual([0, 1, 2])
    const rows = ['North', 'South'].flatMap(r => [{ r, k: 'A', v: r === 'North' ? 3 : 1 }, { r, k: 'B', v: 1 }])
    const f = compile({ ...base, data: rows, facet: 'r' })
    expect(f.scene.panels?.map(p => p.key)).toEqual(['North', 'South'])
    expect(data(f.scene).reduce((q, m) => q + cellCount(m), 0)).toBe(200)
    const colorOf = (key: string): Set<string | undefined> => new Set(data(f.scene).filter(m => m.series === key).map(m => (m as { fill?: string }).fill))
    expect(colorOf('A').size).toBe(1)
  })

  it('describes counts and shares, renders to SVG and canvas deterministically', () => {
    const d = describePlot({ ...base, data: [{ k: 'A', v: 3 }, { k: 'B', v: 1 }] })
    expect(d.ok && d.text).toMatch(/2 categories totalling 4, as 100 cells \(10 by 10; one cell is 1%\)\. A 75% \(75 cells\), B 25% \(25 cells\)\./)
    expect(renderToSvg(base)).toBe(renderToSvg(base))
    const { scene } = compile(base)
    const { ctx, calls } = recorder()
    drawScene(ctx, scene, { Path2D: class { constructor(public d?: string) {} } })
    expect(calls).toContain('fill')
    const slice = scene.marks.findIndex(m => m.type === 'path' && m.tip)
    expect(buildHitIndex(scene).at(1, 1, i => i === slice)).toBe(slice)
  })
})

describe('beeswarm', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ v: Math.round(((i * 37) % 50) + (i % 7) * 0.5), g: i % 3 === 0 ? 'a' : 'b', s: i % 2 ? 'odd' : 'even', w: (i % 5) + 1, id: `p${i}` }))
  const base = { type: 'beeswarm', x: 'v', data: rows }

  it('dodge: no two circles overlap, each sits as close to the centre as it can, and the result is reproducible', () => {
    const xs = Array.from({ length: 200 }, (_, i) => ((i * 7919) % 300) / 3)
    const rs = xs.map((_, i) => 2 + (i % 3))
    const ys = dodge(xs, rs, 1)
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      expect(Math.hypot(xs[i] - xs[j], ys[i] - ys[j])).toBeGreaterThanOrEqual(rs[i] + rs[j] + 1 - 1e-6)
    }
    expect(dodge(xs, rs, 1)).toEqual(ys)
    // Three equal values stack: centre, then up (negative), then down.
    expect(dodge([5, 5, 5], [2, 2, 2], 0)).toEqual([0, -4, 4])
    // Far apart values all stay on the centre line.
    expect(dodge([0, 10, 20], [2, 2, 2], 1)).toEqual([0, 0, 0])
  })

  it('draws one dot per row with tip, aria and datum', () => {
    const { scene } = compile({ ...base, label: 'id', size: 'w' })
    const dots = circles(scene)
    expect(dots).toHaveLength(60)
    for (const d of dots.slice(0, 5)) {
      expect(d.tip?.rows[0].label).toBe('v')
      expect(d.aria).toMatch(/^p\d+: v \d/)
      expect(d.datum).toMatchObject({ x: expect.any(Number), size: expect.any(Number), label: expect.any(String), row: expect.any(Number) })
    }
    // Every dot keeps its value's x position.
    const xs = scene.axes!.x
    const [d0, d1] = xs.domain as [number, number]
    const at = (v: number): number => xs.range[0] + ((v - d0) / (d1 - d0)) * (xs.range[1] - xs.range[0])
    dots.forEach(d => expect(d.cx).toBeCloseTo(at((d.datum as { x: number }).x), 1))
  })

  it('puts each group in its own lane and colours by series with a legend', () => {
    const { scene } = compile({ ...base, y: 'g', series: 's' })
    expect(scene.axes!.y).toMatchObject({ kind: 'band', domain: ['a', 'b'], field: 'g' })
    expect(scene.series.map(s => s.key)).toEqual(['even', 'odd'])
    expect(scene.marks.some(m => m.legendKey === 'odd')).toBe(true)
    const band = (cy: number): number => (cy < (scene.axes!.y.range[0] + scene.axes!.y.range[1]) / 2 ? 0 : 1)
    for (const d of circles(scene)) expect(['a', 'b'][band(d.cy)]).toBe((d.datum as { y: string }).y)
    const hidden = compile({ ...base, y: 'g', series: 's' }, { hidden: ['odd'] }).scene
    expect(circles(hidden)).toHaveLength(30)
  })

  it('keeps dots apart inside a lane at the default size', () => {
    const { scene } = compile({ ...base, y: 'g' })
    const dots = circles(scene)
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
      const a = dots[i], b = dots[j]
      expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThanOrEqual(a.r + b.r + 0.9)
    }
  })

  it('caps the dots with a warning and a hint, and warns when a lane overflows', () => {
    const many = Array.from({ length: BEESWARM_MAX + 500 }, (_, i) => ({ v: (i * 13) % 1000 }))
    const { scene, issues } = compile({ type: 'beeswarm', x: 'v', data: many })
    expect(circles(scene)).toHaveLength(BEESWARM_MAX)
    expect(issues.find(i => i.code === 'too_many_points')).toMatchObject({ path: 'data', hint: expect.stringMatching(/histogram/) })
    const tight = compile({ type: 'beeswarm', x: 'v', data: Array.from({ length: 400 }, () => ({ v: 1 })) }, { height: 160 })
    expect(tight.issues.find(i => i.code === 'swarm_overflow')).toMatchObject({ path: 'radius' })
  })

  it('validates its fields with codes', () => {
    expect(codes({ type: 'beeswarm', x: 'g', data: rows })).toContain('not_numeric')
    expect(codes({ type: 'beeswarm', y: 'g', data: rows })).toContain('missing_required')
    expect(codes({ ...base, radius: 20 })).toContain('out_of_range')
  })

  it('describes the values, zooms on x, works under facet and on canvas', () => {
    const d = describePlot({ ...base, y: 'g' })
    expect(d.ok && d.text).toMatch(/^Beeswarm plot\. 60 values of v, one dot each, in 2 groups by g \(a, b\)\. Overall median/)
    const { scene } = compile({ ...base, zoom: 'x', brush: 'x' })
    expect(scene.axes).toMatchObject({ zoom: 'x', brush: 'x' })
    const f = compile({ ...base, y: 'g', facet: 's' }).scene
    expect(f.panels).toHaveLength(2)
    expect(circles(f)).toHaveLength(60)
    const { ctx, calls } = recorder()
    drawScene(ctx, compile(base).scene)
    expect(calls).toContain('arc')
    expect(renderToSvg(base)).toBe(renderToSvg(base))
  })
})
