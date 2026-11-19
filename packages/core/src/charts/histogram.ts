import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { linearScale, niceLinear } from '../scale.js'
import { drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { distinct } from '../data.js'
import { mean, quantile, toNumber } from '../util/num.js'
import { binCounts, binEdges } from '../util/bins.js'
import { formatPercent } from '../util/format.js'
import { fmtList, formatter, lead } from './shared.js'
import { refuseLog, zeroBaselineScale } from './extras.js'

export { binEdges, binCounts }

function groups(spec: Record<string, any>): Map<string, number[]> {
  const g = new Map<string, number[]>()
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.value])
    if (v === null) continue
    const k = spec.series ? String(r[spec.series] ?? '') : String(spec.value)
    let a = g.get(k)
    if (!a) g.set(k, (a = []))
    a.push(v)
  }
  return g
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  c.axisFields = { x: s.value }
  const g = groups(s)
  const keys = [...g.keys()]
  const series = c.makeSeries(keys)
  const visible = keys.filter(k => !c.hidden.has(k))
  const all = [...g.values()].flat()
  const edges = binEdges(all, s.bins ?? 'auto', s.binWidth)
  const mode = (s.mode ?? 'count') as 'count' | 'density' | 'percent'
  const width = edges[1] - edges[0]
  const heights = new Map<string, number[]>()
  for (const k of keys) {
    const vals = g.get(k)!
    const counts = binCounts(vals, edges)
    heights.set(k, counts.map(n => (mode === 'count' ? n : mode === 'percent' ? (n / vals.length) * 100 : n / (vals.length * width))))
  }
  const top = Math.max(0, ...visible.flatMap(k => heights.get(k)!))
  const yScale = niceLinear(0, top || 1, { zero: true })
  const xScale = linearScale([edges[0], edges[edges.length - 1]])
  const frame = c.frame({ series, autoSide: 'top' })
  const yTitle = s.yLabel ?? (mode === 'count' ? 'Count' : mode === 'percent' ? 'Share of values (%)' : 'Density')
  const xAxis = valueAxis(c, xScale, { title: s.xLabel ?? String(s.value), vertical: false, format: 'auto', grid: false })
  const yAxis = valueAxis(c, yScale, { title: yTitle, vertical: true, format: mode === 'density' ? 'auto' : 'integer' })
  const plot = layoutCartesian(c, frame, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)

  const xf = (v: number): string => new Intl.NumberFormat(c.locale, { maximumFractionDigits: 4 }).format(v)
  const overlap = visible.length > 1
  const inset = Math.min(c.theme.gap / 2, 1)
  for (const k of visible) {
    const si = keys.indexOf(k)
    const h = heights.get(k)!
    const n = g.get(k)!.length
    h.forEach((v, i) => {
      if (v <= 0) return
      const x0 = xScale.at(edges[i]) + inset
      const x1 = xScale.at(edges[i + 1]) - inset
      const y = yScale.at(v)
      const w = Math.max(1, x1 - x0)
      const r = Math.min(3, w / 2, (plot.y + plot.h - y) / 2)
      const count = Math.round(mode === 'count' ? v : mode === 'percent' ? (v / 100) * n : v * n * width)
      c.marks.push({
        type: 'rect', role: 'data', series: k, x: x0, y, w, h: plot.y + plot.h - y, r: [r, r, 0, 0], fill: series[si].color, opacity: overlap ? 0.6 : 1, anim: 'y',
        tip: { title: `${xf(edges[i])} to ${xf(edges[i + 1])}`, rows: [{ label: overlap ? series[si].label : 'Count', value: String(count), color: series[si].color }, { label: 'Share', value: formatPercent(count / n, c.locale) }] },
        aria: `${xf(edges[i])} to ${xf(edges[i + 1])}: ${count} values`, datum: { from: edges[i], to: edges[i + 1], count, series: k }
      })
    })
  }
  if (s.showMean) {
    const m = mean(visible.flatMap(k => g.get(k)!))
    if (Number.isFinite(m) && m >= edges[0] && m <= edges[edges.length - 1]) {
      const px = xScale.at(m)
      c.marks.push({ type: 'line', role: 'annotation', x1: px, x2: px, y1: plot.y, y2: plot.y + plot.h, stroke: c.c('text'), strokeWidth: 1.5, dash: '5 4' })
      const label = `Mean ${xf(Math.round(m * 100) / 100)}`
      const right = px + 6 + c.measure(label, c.size - 1) < plot.x + plot.w
      c.marks.push(c.text(right ? px + 6 : px - 6, plot.y + 4, label, { role: 'annotation', baseline: 'hanging', anchor: right ? 'start' : 'end', size: c.size - 1, fill: c.c('text') }))
    }
  }
  return { series }
}

export const histogram: ChartDef = {
  type: 'histogram',
  name: 'Histogram',
  summary: 'Shows how one measure is distributed by counting values into equal-width bins.',
  useWhen: 'Understanding the shape, centre and spread of a single numeric column (response times, prices, ages). Compare groups with `series` (up to 3 overlap legibly) or use a box plot to compare many. Not for comparing categories.',
  cartesian: true,
  fields: {
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column to bin.' },
    series: { kind: 'column', role: 'any', desc: 'Column that splits the values into overlaid histograms sharing one set of bins.' },
    bins: { kind: 'bins', default: 'auto', desc: '`auto` (Freedman-Diaconis, 5-40 bins) or a target bin count (1-200). Edges are rounded to nice numbers.' },
    binWidth: { kind: 'number', min: 1e-9, desc: 'Exact bin width; overrides `bins`.' },
    mode: { kind: 'enum', values: ['count', 'percent', 'density'], default: 'count', desc: 'What bar height means: number of values, percent of values, or probability density.' },
    showMean: { kind: 'boolean', default: false, desc: 'Draw a dashed line at the mean.' },
    yScale: zeroBaselineScale('A bin\'s height (its count)')
  },
  check(spec, ctx) {
    refuseLog(spec, ctx, 'yScale', 'a bin\'s bar must start at zero, and a log axis has no zero; an empty bin could not be drawn at all.', 'Keep the linear scale; to show a long tail, filter it with `transform` or bin the log of the value upstream.')
  },
  example: {
    type: 'histogram', title: 'API response time', subtitle: 'Milliseconds, 200 requests', value: 'ms', showMean: true, xLabel: 'Response time (ms)',
    data: Array.from({ length: 200 }, (_, i) => ({ ms: Math.round(80 + 55 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) + 70 * Math.abs(Math.sin(i * 78.233) * 12543.1 % 1) ** 3) }))
  },
  compile,
  describe(spec, env) {
    const g = groups(spec)
    const all = [...g.values()].flat()
    const f = formatter({ format: 'auto' }, env.locale)
    if (!all.length) return `${lead(spec, 'Histogram')} No numeric values.`
    const edges = binEdges(all, spec.bins ?? 'auto', spec.binWidth)
    const counts = binCounts(all, edges)
    const peak = counts.indexOf(Math.max(...counts))
    const sorted = [...all].sort((a, b) => a - b)
    let t = `${lead(spec, 'Histogram')} ${all.length} values of ${spec.value} in ${counts.length} bins of width ${f(edges[1] - edges[0])}. Mean ${f(mean(all))}, median ${f(quantile(sorted, 0.5))}, range ${f(sorted[0])} to ${f(sorted[sorted.length - 1])}. Most common bin: ${f(edges[peak])} to ${f(edges[peak + 1])} (${counts[peak]} values).`
    const keys = distinct([...g.keys()])
    if (keys.length > 1) t += ` Groups: ${fmtList(keys)}.`
    return t
  }
}
