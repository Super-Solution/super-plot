import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { bandScale } from '../scale.js'
import { bandAxis, layoutCartesian } from '../cartesian.js'
import { distinct } from '../data.js'
import { inkOn } from '../util/color.js'
import { toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatter, lead, seqLegend, seqScale } from './shared.js'

interface Cell { x: string; y: string; v: number }

function cells(spec: Record<string, any>): { cells: Cell[]; xs: string[]; ys: string[] } {
  const sums = new Map<string, number>()
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.value])
    if (v === null) continue
    const key = `${String(r[spec.x] ?? '')}\u0000${String(r[spec.y] ?? '')}`
    sums.set(key, (sums.get(key) ?? 0) + v)
  }
  const out: Cell[] = [...sums].map(([k, v]) => {
    const [x, y] = k.split('\u0000')
    return { x, y, v }
  })
  const rows = spec.data as Record<string, unknown>[]
  return { cells: out, xs: distinct(rows.map(r => String(r[spec.x] ?? ''))), ys: distinct(rows.map(r => String(r[spec.y] ?? ''))) }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const { cells: cs, xs, ys } = cells(s)
  const vals = cs.map(q => q.v)
  const dom = s.domain as [number | null, number | null] | undefined
  const lo = dom?.[0] ?? Math.min(...vals)
  const hi = dom?.[1] ?? Math.max(...vals)
  const color = seqScale(c, lo, hi)
  const frame = c.frame({ series: [] })
  const barW = c.compact ? 0 : 64
  const area = { ...frame, w: frame.w - barW }
  const xScale = bandScale(xs, 0.06)
  const yScale = bandScale(ys, 0.06)
  const plot = layoutCartesian(c, area, bandAxis(xScale, Object.fromEntries(xs.map(k => [k, clip(k, 40)])), s.xLabel ?? String(s.x), c.locale), bandAxis(yScale, Object.fromEntries(ys.map(k => [k, clip(k, 40)])), s.yLabel ?? String(s.y), c.locale))
  const fmt = c.format
  const cw = xScale.bandwidth
  const ch = yScale.bandwidth
  for (const q of cs) {
    const fill = color(q.v)
    c.marks.push({ type: 'rect', role: 'data', x: xScale.start(q.x), y: yScale.start(q.y), w: cw, h: ch, r: Math.min(3, cw / 4, ch / 4), fill, anim: 'fade', tip: { title: `${clip(q.x, 40)} / ${clip(q.y, 40)}`, rows: [{ label: String(s.value), value: fmt(q.v), color: fill }] }, aria: `${q.x}, ${q.y}: ${fmt(q.v)}`, datum: { x: q.x, y: q.y, value: q.v } })
    if (s.labels !== false) {
      const t = fmt(q.v)
      if (cw > c.measure(t, c.size - 1) + 6 && ch > c.size + 2) {
        c.marks.push(c.text(xScale.at(q.x), yScale.at(q.y), t, { role: 'label', anchor: 'middle', baseline: 'middle', size: c.size - 1, fill: inkOn(fill) }))
      }
    }
  }
  if (barW) {
    const x = plot.x + plot.w + 22
    const h = Math.min(plot.h, 160)
    const y0 = plot.y + (plot.h - h) / 2
    seqLegend(c, x, y0, h, lo, hi)
  }
  return { series: [] }
}

export const heatmap: ChartDef = {
  type: 'heatmap',
  name: 'Heatmap',
  summary: 'Colours a grid of cells by a number: one axis per category, darker means larger.',
  useWhen: 'Spotting patterns across two categorical dimensions (weekday x hour, product x region, correlation matrix). Order the categories meaningfully in the data. Not for few cells, where a bar chart is clearer.',
  cartesian: false,
  fields: {
    x: { kind: 'column', role: 'any', required: true, desc: 'Column for the horizontal categories.' },
    y: { kind: 'column', role: 'any', required: true, desc: 'Column for the vertical categories (first value at the top).' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each cell\'s colour. Rows with the same x and y are summed.' },
    labels: { kind: 'boolean', default: true, desc: 'Print the value in each cell that is large enough.' },
    domain: { kind: 'domain', desc: 'Fix the colour scale range, e.g. [0, 100], to compare several heatmaps.' },
    xLabel: { kind: 'string', max: 80, desc: 'Title of the horizontal axis (default: the x column).' },
    yLabel: { kind: 'string', max: 80, desc: 'Title of the vertical axis (default: the y column).' }
  },
  example: {
    type: 'heatmap', title: 'Support tickets by weekday and hour', subtitle: 'Average tickets per hour', x: 'hour', y: 'day', value: 'tickets',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].flatMap((day, di) => ['09', '11', '13', '15', '17'].map((hour, hi) => ({ day, hour: `${hour}:00`, tickets: Math.round(12 + 30 * Math.exp(-((hi - 1.6) ** 2) / 1.8) + di * 2 + (di === 1 && hi === 2 ? 14 : 0)) })))
  },
  compile,
  describe(spec, env) {
    const { cells: cs, xs, ys } = cells(spec)
    const f = formatter(spec, env.locale)
    if (!cs.length) return `${lead(spec, 'Heatmap')} No numeric cells.`
    const max = cs.reduce((a, b) => (b.v > a.v ? b : a))
    const min = cs.reduce((a, b) => (b.v < a.v ? b : a))
    return `${lead(spec, 'Heatmap')} ${cs.length} cells, ${xs.length} columns by ${ys.length} rows, coloured by ${spec.value}. Highest: ${clip(max.x, 30)} / ${clip(max.y, 30)} (${f(max.v)}). Lowest: ${clip(min.x, 30)} / ${clip(min.y, 30)} (${f(min.v)}).`
  }
}
