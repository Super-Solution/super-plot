import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, drawScene, renderToSvg, validatePlot, logTicks, niceLogDomain, loess, binEdges, binCounts, type Canvas2D, type Mark, type Scene, type CircleMark, type LineMark, type PathMark, type TextMark } from '../../packages/core/src'

const compile = (spec: unknown, o = {}): { scene: Scene; codes: string[] } => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return { scene: r.scene, codes: r.issues.map(i => i.code) }
}
const issues = (spec: unknown): { code: string; path: string; severity: string }[] => validatePlot(spec).issues.map(i => ({ code: i.code, path: i.path, severity: i.severity }))
const data = (m: Mark[]): Mark[] => m.filter(x => x.role === 'data')
const inPlot = (s: Scene, x: number, y: number): boolean => { const p = s.axes!.plot; return x >= p.x - 0.01 && x <= p.x + p.w + 0.01 && y >= p.y - 0.01 && y <= p.y + p.h + 0.01 }

const growth = Array.from({ length: 30 }, (_, i) => ({ x: i + 1, y: 2 ** (i / 3), lo: 2 ** (i / 3) * 0.8, hi: 2 ** (i / 3) * 1.25, g: i % 2 ? 'a' : 'b' }))

describe('log scales', () => {
  it('ticks at powers of ten, with 2 and 5 between on short ranges', () => {
    expect(logTicks(1, 1e6, 5)).toEqual([1, 100, 1e4, 1e6])
    expect(logTicks(1, 1000, 8)).toEqual([1, 10, 100, 1000])
    expect(logTicks(1, 100, 8)).toEqual([1, 2, 5, 10, 20, 50, 100])
    expect(logTicks(0.01, 1, 9)).toEqual([0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1])
    expect(logTicks(20, 80, 5).length).toBeGreaterThanOrEqual(2)
    expect(niceLogDomain(3, 800)).toEqual([1, 1000])
    expect(niceLogDomain(10, 10)).toEqual([1, 100])
  })

  it('a log line drops values at or below zero with a counted warning, and says so in the description', () => {
    const spec = { type: 'line', x: 'x', y: 'y', yScale: 'log', data: [...growth, { x: 31, y: 0 }, { x: 32, y: -4 }] }
    const w = validatePlot(spec).issues.find(i => i.code === 'log_nonpositive')!
    expect(w).toMatchObject({ severity: 'warning', path: 'y' })
    expect(w.message).toContain('2 of 32')
    const { scene } = compile(spec)
    expect(scene.axes!.y).toMatchObject({ kind: 'linear', scale: 'log', domain: [1, 1000] })
    const ticks = scene.marks.filter((m): m is TextMark => m.type === 'text' && m.role === 'axis-label').map(m => m.text)
    expect(ticks).toEqual(expect.arrayContaining(['1', '10', '100', '1,000']))
    // Every point is placed inside the plot (none at -Infinity for 0 or below).
    for (const m of data(scene.marks)) if (m.type === 'circle') expect(inPlot(scene, m.cx, m.cy)).toBe(true)
    expect(scene.description).toContain('The y axis is logarithmic.')
    expect(scene.description).not.toContain('low 0')
  })

  it('all values at or below zero is an error; a non-positive domain is refused', () => {
    expect(issues({ type: 'scatter', x: 'x', y: 'y', yScale: 'log', data: [{ x: 1, y: 0 }, { x: 2, y: -1 }] })).toContainEqual({ code: 'log_nonpositive', path: 'y', severity: 'error' })
    expect(issues({ type: 'line', x: 'x', y: 'y', yScale: 'log', yDomain: [0, 100], data: growth })).toContainEqual({ code: 'log_bad_domain', path: 'yDomain', severity: 'error' })
  })

  it('log x on a scatter and on a numeric line; refused on dates', () => {
    const { scene } = compile({ type: 'scatter', x: 'x', y: 'y', xScale: 'log', yScale: 'log', data: growth })
    expect(scene.axes!.x.scale).toBe('log')
    expect(scene.axes!.y.scale).toBe('log')
    expect(compile({ type: 'line', x: 'x', y: 'y', xScale: 'log', data: growth }).scene.axes!.x.scale).toBe('log')
    const dates = [{ d: '2026-01-01', v: 1 }, { d: '2026-02-01', v: 2 }]
    expect(issues({ type: 'line', x: 'd', y: 'v', xScale: 'log', data: dates })).toContainEqual({ code: 'log_scale_refused', path: 'xScale', severity: 'error' })
    expect(issues({ type: 'scatter', x: 'd', y: 'v', xScale: 'log', data: dates })).toContainEqual({ code: 'log_scale_refused', path: 'xScale', severity: 'error' })
  })

  it('bars, areas and histograms refuse log: their marks start at zero', () => {
    for (const spec of [
      { type: 'bar', x: 'g', y: 'y', yScale: 'log', data: growth },
      { type: 'area', x: 'x', y: 'y', yScale: 'log', data: growth },
      { type: 'histogram', value: 'y', yScale: 'log', data: growth }
    ]) {
      const r = validatePlot(spec)
      expect(r.ok).toBe(false)
      const i = r.issues.find(x => x.code === 'log_scale_refused')!
      expect(i).toMatchObject({ severity: 'error', path: 'yScale' })
      expect(i.message).toMatch(/zero/)
      expect(i.hint).toBeTruthy()
    }
    // `linear` is accepted on them.
    expect(validatePlot({ type: 'bar', x: 'g', y: 'y', yScale: 'linear', data: growth }).ok).toBe(true)
  })

  it('zoom on a log axis keeps it logarithmic (the view is in data units)', () => {
    const r = compilePlot({ type: 'scatter', x: 'x', y: 'y', yScale: 'log', zoom: 'xy', data: growth }, { width: 600, height: 400, view: { y: [3, 300] } })
    if (!r.ok) throw new Error('compile')
    expect(r.scene.axes!.y).toMatchObject({ scale: 'log', domain: [3, 300] })
    expect(r.scene.axes!.zoom).toBe('xy')
  })

  it('linear and loess fits run in log space on log axes (a power law is a straight line)', () => {
    const pow = Array.from({ length: 20 }, (_, i) => ({ x: i + 1, y: 3 * (i + 1) ** 2 }))
    const { scene } = compile({ type: 'scatter', x: 'x', y: 'y', xScale: 'log', yScale: 'log', trend: 'linear', data: pow })
    const t = scene.marks.find((m): m is LineMark => m.type === 'line' && m.role === 'annotation' && m.dash === '6 4')!
    const first = scene.marks.find((m): m is CircleMark => m.type === 'circle' && m.role === 'data')!
    expect(t.x1).toBeCloseTo(first.cx, 6)
    expect(t.y1).toBeCloseTo(first.cy, 6)
  })
})

describe('intervals', () => {
  it('a line gets one shaded band per series behind it, and the axis includes the interval', () => {
    const long = growth.flatMap(r => [{ ...r, g: 'b' }, { ...r, g: 'a', y: r.y / 2, lo: r.lo / 2, hi: r.hi / 2 }])
    const { scene } = compile({ type: 'line', x: 'x', y: 'y', series: 'g', yLower: 'lo', yUpper: 'hi', data: long })
    const d = data(scene.marks)
    const bands = d.filter((m): m is PathMark => m.type === 'path' && m.fill !== undefined && m.opacity === 0.14)
    expect(bands.map(b => b.series)).toEqual(['b', 'a'])
    // Bands come before every line.
    const firstLine = d.findIndex(m => m.type === 'path' && (m as PathMark).stroke !== undefined && m.opacity === undefined)
    expect(d.indexOf(bands[1])).toBeLessThan(firstLine)
    expect((scene.axes!.y.domain as number[])[1]).toBeGreaterThanOrEqual(812.7 * 1.25)
    const hit = scene.marks.find(m => m.role === 'hit')!
    expect(hit.tip!.rows[0].value).toMatch(/\(.+ – .+\)/)
    expect(scene.description).toContain('A shaded band shows lo to hi.')
  })

  it('refuses honestly: incomplete pairs, several y columns, stacked areas', () => {
    expect(issues({ type: 'line', x: 'x', y: 'y', yLower: 'lo', data: growth })).toContainEqual({ code: 'interval_incomplete', path: 'yUpper', severity: 'error' })
    expect(issues({ type: 'line', x: 'x', y: ['y', 'hi'], yLower: 'lo', yUpper: 'hi', data: growth })).toContainEqual({ code: 'interval_needs_one_y', path: 'yLower', severity: 'warning' })
    expect(issues({ type: 'area', x: 'x', y: 'y', series: 'g', stack: 'stack', yLower: 'lo', yUpper: 'hi', data: growth })).toContainEqual({ code: 'interval_ignored_stacked', path: 'yLower', severity: 'warning' })
    expect(issues({ type: 'bar', x: 'g', y: 'y', stack: 'stack', yLower: 'lo', yUpper: 'hi', data: growth })).toContainEqual({ code: 'interval_ignored_stacked', path: 'yLower', severity: 'warning' })
    expect(issues({ type: 'scatter', x: 'x', y: 'y', yLower: 'hi', yUpper: 'lo', data: growth })).toContainEqual({ code: 'interval_reversed', path: 'yLower', severity: 'warning' })
    const multi = compile({ type: 'line', x: 'x', y: ['y', 'hi'], yLower: 'lo', yUpper: 'hi', data: growth }).scene
    expect(data(multi.marks).some(m => m.opacity === 0.14)).toBe(false)
  })

  it('a scatter gets vertical and horizontal error bars with caps; the tip and the datum carry the interval', () => {
    const rows = [{ x: 2, y: 5, ylo: 4, yhi: 7, xlo: 1.5, xhi: 2.5 }, { x: 4, y: 8, ylo: 6, yhi: 9, xlo: 3, xhi: 5 }]
    const { scene } = compile({ type: 'scatter', x: 'x', y: 'y', yLower: 'ylo', yUpper: 'yhi', xLower: 'xlo', xUpper: 'xhi', data: rows })
    const lines = data(scene.marks).filter((m): m is LineMark => m.type === 'line')
    expect(lines).toHaveLength(12) // 2 points x (bar + 2 caps) x 2 directions
    const dot = scene.marks.find((m): m is CircleMark => m.type === 'circle' && m.role === 'data')!
    expect(dot.datum).toMatchObject({ yLower: 4, yUpper: 7, xLower: 1.5, xUpper: 2.5 })
    expect(dot.tip!.rows[1].value).toBe('5 (4 – 7)')
    expect(dot.aria).toContain('(4 – 7)')
    expect((scene.axes!.x.domain as number[])[1]).toBeGreaterThanOrEqual(5)
  })

  it('grouped bars get whiskers; the label clears the whisker', () => {
    const rows = [{ k: 'A', v: 10, lo: 8, hi: 12 }, { k: 'B', v: 14, lo: 11, hi: 18 }]
    const { scene } = compile({ type: 'bar', x: 'k', y: 'v', yLower: 'lo', yUpper: 'hi', labels: true, data: rows })
    const w = data(scene.marks).filter((m): m is LineMark => m.type === 'line')
    expect(w).toHaveLength(6)
    const bar = scene.marks.find(m => m.type === 'rect' && m.role === 'data')!
    expect(bar.datum).toEqual({ x: 'A', series: 'v', value: 10, lower: 8, upper: 12 })
    expect(bar.tip!.rows[0].value).toBe('10 (8 – 12)')
    expect((scene.axes!.y.domain as number[])[1]).toBeGreaterThanOrEqual(18)
    const label = scene.marks.find((m): m is TextMark => m.type === 'text' && m.role === 'label' && m.text === '10')!
    const top = Math.min(...w.filter(l => l.x1 === l.x2 && Math.abs(l.x1 - label.x) < 1).map(l => Math.min(l.y1, l.y2)))
    expect(label.y).toBeLessThan(top)
  })
})

describe('point annotations', () => {
  const line = (annotations: unknown[]): Record<string, unknown> => ({ type: 'line', x: 'x', y: 'y', data: growth, annotations })

  it('validates with codes and paths; the line and band forms are unchanged', () => {
    expect(validatePlot(line([{ x: 5, y: 3, label: 'Here' }, { axis: 'y', value: 100, to: 200, label: 'Band' }])).ok).toBe(true)
    expect(issues(line([{ x: 5, label: 'Here' }]))).toContainEqual({ code: 'missing_required', path: 'annotations[0].y', severity: 'error' })
    expect(issues(line([{ x: 5, y: 3 }]))).toContainEqual({ code: 'missing_required', path: 'annotations[0].label', severity: 'error' })
    expect(issues(line([{ x: true, y: 3, label: 'a' }]))).toContainEqual({ code: 'bad_type', path: 'annotations[0].x', severity: 'error' })
    expect(issues(line([{ x: 5, y: 3, label: 'a', value: 2 }]))).toContainEqual({ code: 'unknown_field', path: 'annotations[0].value', severity: 'error' })
    expect(issues(line([{ x: 5, y: 3, label: 'a', tone: 'loud' }]))).toContainEqual({ code: 'bad_enum', path: 'annotations[0].tone', severity: 'error' })
    expect(issues(line([{ axis: 'y', value: 1, x: 3 }]))).toContainEqual({ code: 'unknown_field', path: 'annotations[0].x', severity: 'error' })
  })

  it('draws a marker, a leader and a label inside the plot, flipping near the edges', () => {
    const { scene } = compile(line([{ x: 2, y: 2, label: 'Start of the run' }, { x: 30, y: 990, label: 'A long label at the top right corner' }]))
    const notes = scene.marks.filter(m => m.role === 'annotation')
    expect(notes.filter(m => m.type === 'circle')).toHaveLength(2)
    const texts = notes.filter((m): m is TextMark => m.type === 'text')
    expect(texts[0].anchor).toBe('start')
    expect(texts[1].anchor).toBe('end')
    const p = scene.axes!.plot
    for (const t of texts) {
      const w = t.text.length * t.size * 0.6
      const left = t.anchor === 'end' ? t.x - w : t.x
      expect(left).toBeGreaterThanOrEqual(p.x - 1)
      expect(t.y).toBeGreaterThanOrEqual(p.y)
      expect(t.y).toBeLessThanOrEqual(p.y + p.h)
    }
    // Near the top the leader goes down.
    const leader = notes.filter((m): m is LineMark => m.type === 'line')[1]
    expect(leader.y2).toBeGreaterThan(leader.y1)
    expect(scene.description).toContain('Marked: "Start of the run" at 2, 2;')
    expect(describePlot(line([{ x: 2, y: 2, label: 'Go' }])).ok && (describePlot(line([{ x: 2, y: 2, label: 'Go' }])) as { text: string }).text).toContain('Marked: "Go" at 2, 2.')
  })

  it('takes categories and ISO dates, and warns when the point is off the axes', () => {
    const bars = compile({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'A', v: 3 }, { k: 'B', v: 5 }], annotations: [{ x: 'B', y: 5, label: 'Best' }, { x: 'Z', y: 1, label: 'Nope' }] })
    expect(bars.scene.marks.filter(m => m.role === 'annotation' && m.type === 'circle')).toHaveLength(1)
    expect(bars.codes).toContain('annotation_out_of_range')
    const days = compile({ type: 'line', x: 'd', y: 'v', data: [{ d: '2026-01-01', v: 1 }, { d: '2026-03-01', v: 4 }], annotations: [{ x: '2026-02-01', y: 2, label: 'Launch' }] })
    expect(days.codes).not.toContain('annotation_out_of_range')
  })
})

describe('gaps', () => {
  const rows = [{ x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: null }, { x: 4, y: 4 }, { x: 5, y: 6 }]
  const paths = (s: Scene): PathMark[] => data(s.marks).filter((m): m is PathMark => m.type === 'path' && m.stroke !== undefined)

  it('break is the default and draws exactly what old specs drew', () => {
    const old = compile({ type: 'line', x: 'x', y: 'y', data: rows }).scene
    expect(paths(old)).toHaveLength(2)
    expect(compile({ type: 'line', x: 'x', y: 'y', gaps: 'break', data: rows }).scene).toEqual(old)
  })

  it('connect joins over the gap; zero drops to zero and says "missing"', () => {
    expect(paths(compile({ type: 'line', x: 'x', y: 'y', gaps: 'connect', data: rows }).scene)).toHaveLength(1)
    const z = compile({ type: 'area', x: 'x', y: 'y', gaps: 'zero', data: rows }).scene
    expect(paths(z)).toHaveLength(1)
    const tip = z.marks.find(m => m.role === 'hit' && (m.datum as { x: number }).x === 3)!.tip!
    expect(tip.rows[0].value).toBe('0 (missing)')
    const zl = compile({ type: 'line', x: 'x', y: 'y', gaps: 'zero', data: [{ x: 1, y: 3 }, { x: 2, y: null }, { x: 3, y: 4 }] }).scene
    expect((zl.axes!.y.domain as number[])[0]).toBe(0)
  })

  it('zero on a log axis breaks instead, with a warning', () => {
    expect(issues({ type: 'line', x: 'x', y: 'y', yScale: 'log', gaps: 'zero', data: rows })).toContainEqual({ code: 'gaps_zero_log', path: 'gaps', severity: 'warning' })
  })
})

describe('loess', () => {
  it('reproduces a straight line exactly, on a 50-point grid from min to max x', () => {
    const xs = Array.from({ length: 40 }, (_, i) => i * 0.5)
    const out = loess(xs, xs.map(x => 2 * x + 1))
    expect(out).toHaveLength(50)
    expect(out[0][0]).toBe(0)
    expect(out[49][0]).toBe(19.5)
    for (const [x, y] of out) expect(y).toBeCloseTo(2 * x + 1, 9)
  })

  it('is deterministic, ignores input order and non-finite pairs, and needs three points', () => {
    const xs = [5, 1, 3, 2, 4, 8, 6, 7, 9, 10]
    const ys = [2, 9, 4, 7, 3, 6, 1, 8, 5, 2]
    const a = loess(xs, ys, 0.5, 10)
    const order = xs.map((_, i) => i).reverse()
    expect(loess(order.map(i => xs[i]), order.map(i => ys[i]), 0.5, 10)).toEqual(a)
    expect(loess([...xs, NaN], [...ys, 4], 0.5, 10)).toEqual(a)
    expect(loess([1, 2], [3, 4])).toEqual([])
    // Pinned values (the Go and Python ports must match these).
    expect(a.map(p => Math.round(p[1] * 1e6) / 1e6)).toMatchInlineSnapshot(`
      [
        9.036444,
        6.766155,
        4.572621,
        3,
        2,
        3.290484,
        5.423205,
        6.286311,
        4.335388,
        2.34658,
      ]
    `)
  })

  it('draws one curve per series; trendBandwidth is checked and warned about without loess', () => {
    const { scene } = compile({ type: 'scatter', x: 'x', y: 'y', series: 'g', trend: 'loess', trendBandwidth: 0.5, data: growth })
    const curves = scene.marks.filter((m): m is PathMark => m.type === 'path' && m.role === 'annotation')
    expect(curves.map(c => c.series)).toEqual(['b', 'a'])
    expect(curves[0].d.split('L')).toHaveLength(50)
    expect(issues({ type: 'scatter', x: 'x', y: 'y', trendBandwidth: 0.5, data: growth })).toContainEqual({ code: 'trend_bandwidth_ignored', path: 'trendBandwidth', severity: 'warning' })
    expect(issues({ type: 'scatter', x: 'x', y: 'y', trend: 'loess', trendBandwidth: 0.01, data: growth })).toContainEqual({ code: 'out_of_range', path: 'trendBandwidth', severity: 'error' })
  })
})

describe('lollipop', () => {
  const rows = [{ k: 'A', a: 12, b: 9 }, { k: 'B', a: 7, b: -3 }]
  it('draws a stem and a dot per value, grouped side by side; the dot carries tip, aria and datum', () => {
    const { scene } = compile({ type: 'bar', x: 'k', y: ['a', 'b'], mark: 'lollipop', labels: true, data: rows })
    const d = data(scene.marks)
    expect(d.filter(m => m.type === 'rect')).toHaveLength(0)
    expect(d.filter(m => m.type === 'line')).toHaveLength(4)
    const dots = d.filter((m): m is CircleMark => m.type === 'circle')
    expect(dots).toHaveLength(4)
    expect(dots[0]).toMatchObject({ aria: 'A, a: 12', datum: { x: 'A', series: 'a', value: 12 } })
    expect(dots[0].cx).not.toBe(dots[1].cx)
    expect(scene.marks.filter(m => m.role === 'label')).toHaveLength(4)
    expect(scene.description).toMatch(/^Lollipop chart\./)
    const h = compile({ type: 'bar', x: 'k', y: 'a', mark: 'lollipop', orientation: 'horizontal', sort: 'asc', data: rows }).scene
    const hd = data(h.marks).filter((m): m is CircleMark => m.type === 'circle')
    expect(hd.map(m => (m.datum as { x: string }).x)).toEqual(['B', 'A'])
  })
  it('falls back to bars with a warning when stacked', () => {
    const r = compile({ type: 'bar', x: 'k', y: ['a', 'b'], mark: 'lollipop', stack: 'stack', data: rows })
    expect(r.codes).toContain('lollipop_stacked')
    expect(data(r.scene.marks).filter(m => m.type === 'rect').length).toBeGreaterThan(0)
  })
})

describe('the new marks draw in every renderer', () => {
  it('SVG and canvas take the scenes as they are', () => {
    const specs = [
      { type: 'line', x: 'x', y: 'y', yScale: 'log', yLower: 'lo', yUpper: 'hi', gaps: 'connect', annotations: [{ x: 4, y: 3, label: 'Note' }], data: growth },
      { type: 'scatter', x: 'x', y: 'y', xScale: 'log', yLower: 'lo', yUpper: 'hi', trend: 'loess', data: growth },
      { type: 'bar', x: 'g', y: 'y', mark: 'lollipop', yLower: 'lo', yUpper: 'hi', data: growth.slice(0, 2) }
    ]
    for (const spec of specs) {
      const svg = renderToSvg(spec, { width: 500, height: 320 })
      expect(svg).not.toMatch(/NaN|Infinity/)
      const calls: string[] = []
      const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '' }
      for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fill', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'bezierCurveTo', 'clip']) ctx[k] = (...a: unknown[]) => { calls.push(k); if (a.some(v => typeof v === 'number' && !Number.isFinite(v))) throw new Error(`${k} got ${a}`) }
      const r = compilePlot(spec, { width: 500, height: 320 })
      if (!r.ok) throw new Error('compile')
      drawScene(ctx as unknown as Canvas2D, r.scene, { Path2D: class { constructor(readonly d?: string) { if (d && /NaN|Infinity/.test(d)) throw new Error(d) } } })
      ctx.clip = () => calls.push('clip')
      expect(calls).toContain('stroke')
    }
  })
})

describe('bin edges match the histogram', () => {
  it('the bin step and the histogram share their binning', () => {
    const vals = [1, 2, 2, 3, 3, 3, 4, 4, 5, 9]
    const r = validatePlot({ type: 'bar', x: 'b0', y: 'n', data: vals.map(v => ({ v })), transform: [{ bin: { field: 'v', maxbins: 5, as: ['b0', 'b1'] } }, { aggregate: { groupBy: ['b0', 'b1'], count: 'n' } }] })
    expect(r.ok).toBe(true)
    // Five histogram bins of width 2 fit under maxbins 5, so the step uses exactly the histogram's edges and counts.
    const edges = binEdges(vals, 5)
    const counts = binCounts(vals, edges)
    expect(r.spec!.data).toEqual(edges.slice(0, -1).map((e, i) => ({ b0: e, b1: edges[i + 1], n: counts[i] })).filter(x => x.n > 0))
  })
})
