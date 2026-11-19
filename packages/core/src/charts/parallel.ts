import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Row } from '../schema.js'
import { niceLinear } from '../scale.js'
import { distinct, xKey } from '../data.js'
import { correlation, r2, toNumber } from '../util/num.js'
import { tickFormatter } from '../util/format.js'
import { clip, fit } from '../util/text.js'
import { fmtList, formatter, lead } from './shared.js'

/** Lines drawn at most. Past it every k-th complete row is drawn, k = ceil(rows / MAX_LINES), starting at the first. */
export const MAX_LINES = 2000
export const MAX_DIMENSIONS = 12

const dimsOf = (spec: Record<string, any>): string[] => (Array.isArray(spec.dimensions) ? spec.dimensions : [spec.dimensions])

/** Rows with a number in every dimension, each with its values in dimension order. */
function complete(rows: Row[], dims: string[]): { row: Row; index: number; values: number[] }[] {
  const out: { row: Row; index: number; values: number[] }[] = []
  rows.forEach((row, index) => {
    const values: number[] = []
    for (const d of dims) {
      const v = toNumber(row[d])
      if (v === null) break
      values.push(v)
    }
    if (values.length === dims.length) out.push({ row, index, values })
  })
  return out
}

/** The rows actually drawn: all of them up to {@link MAX_LINES}, else every k-th (deterministic, keeps the order). */
export function sampleRows<T>(rows: T[], max = MAX_LINES): { rows: T[]; step: number } {
  if (rows.length <= max) return { rows, step: 1 }
  const step = Math.ceil(rows.length / max)
  return { rows: rows.filter((_, i) => i % step === 0), step }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const dims = dimsOf(s)
  const all = complete(s.data, dims)
  const grouped = typeof s.series === 'string'
  const keys = grouped ? distinct(all.map(r => xKey(r.row[s.series]))) : []
  const series = grouped ? c.makeSeries(keys) : []
  const frame = c.frame({ series })
  const fmt = c.format
  const size = c.size
  const scales = dims.map((_, i) => {
    let lo = Infinity
    let hi = -Infinity
    for (const r of all) {
      lo = Math.min(lo, r.values[i])
      hi = Math.max(hi, r.values[i])
    }
    return niceLinear(lo, hi)
  })

  const titleH = size + 10
  const top = frame.y + titleH
  const bottom = frame.y + frame.h - size / 2 - 2
  const plotH = Math.max(40, bottom - top)
  const count = Math.max(2, Math.round(plotH / (c.compact ? 34 : 42)))
  const ticks = scales.map(sc => {
    sc.range = [top + plotH, top]
    const f = tickFormatter(s.format, c.locale, sc.domain, count)
    return sc.ticks(count).map(v => ({ v, label: f(v) }))
  })
  const firstW = Math.max(0, ...ticks[0].map(t => c.measure(t.label, size - 1)))
  const lastTitle = Math.min(c.measure(dims[dims.length - 1], size, 600), 120) / 2
  const left = frame.x + Math.max(firstW + 8, Math.min(c.measure(dims[0], size, 600), 120) / 2)
  const right = frame.x + frame.w - Math.max(8, lastTitle)
  const gap = (right - left) / (dims.length - 1)
  const xs = dims.map((_, i) => left + i * gap)

  // Lines first, axes over them so the scales stay readable.
  const { rows: drawn } = sampleRows(all)
  const n = drawn.length
  const opacity = n <= 100 ? 0.8 : Math.max(0.15, 0.8 * Math.sqrt(100 / n))
  const single = c.seriesColor(String(dims[0]), 0)
  const colorOf = new Map(series.map(x => [x.key, x.color]))
  for (const { row, index, values } of drawn) {
    const key = grouped ? xKey(row[s.series]) : undefined
    if (key !== undefined && c.hidden.has(key)) continue
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${r2(xs[i])} ${r2(scales[i].at(v))}`).join('')
    const title = key !== undefined ? clip(key, 60) : c.t('rowName', { n: index + 1 })
    const stroke = key !== undefined ? colorOf.get(key)! : single
    c.marks.push({
      type: 'path', role: 'data', series: key, d, fill: 'none', stroke, strokeWidth: 1.25, opacity, anim: 'fade',
      tip: { title, rows: dims.map((dim, i) => ({ label: clip(dim, 40), value: fmt(values[i]) })) },
      aria: `${title}: ${dims.map((dim, i) => `${dim} ${fmt(values[i])}`).join(', ')}`, datum: row
    })
  }

  const axis = c.c('axis')
  const muted = c.c('text-muted')
  dims.forEach((dim, i) => {
    const x = xs[i]
    c.marks.push({ type: 'line', role: 'axis', x1: x, x2: x, y1: top, y2: top + plotH, stroke: axis })
    for (const t of ticks[i]) {
      const y = scales[i].at(t.v)
      c.marks.push({ type: 'line', role: 'axis', x1: x - 3, x2: x, y1: y, y2: y, stroke: axis })
      c.marks.push(c.text(x - 5, y, t.label, { anchor: 'end', baseline: 'middle', fill: muted, size: size - 1 }))
    }
    c.marks.push(c.text(x, frame.y, fit(dim, Math.max(24, Math.min(gap - 6, 160)), size, c.env.measure, 600), { anchor: 'middle', baseline: 'hanging', weight: 600, fill: c.c('text') }))
  })
  return { series }
}

export const parallel: ChartDef = {
  type: 'parallel',
  name: 'Parallel coordinates',
  summary: 'Draws each row as a line across several vertical axes, one per measure, to compare many measures at once.',
  useWhen: 'Rows described by 3 to 12 numeric measures (cars by price, power, weight and range; runs by their metrics), looking for clusters, trade-offs and outliers. Each axis has its own scale. Not for two measures (use a scatter plot) or for exact values.',
  cartesian: false,
  fields: {
    dimensions: { kind: 'columns', role: 'number', min: 2, max: MAX_DIMENSIONS, required: true, desc: `Numeric columns, one vertical axis each, left to right (2 to ${MAX_DIMENSIONS}). Each axis gets its own rounded scale.` },
    series: { kind: 'column', role: 'any', desc: 'Optional column that colours the lines by group, with a legend.' }
  },
  example: {
    type: 'parallel', title: 'Cars: price, power, weight and range', subtitle: 'Each line is one model', dimensions: ['price', 'power', 'weight', 'range'], series: 'drive',
    data: Array.from({ length: 36 }, (_, i) => {
      const drive = ['Electric', 'Hybrid', 'Petrol'][i % 3]
      const u = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1
      const w = Math.abs(Math.sin((i + 3) * 78.233) * 12345.6789) % 1
      const price = Math.round(22 + u * 40 + (drive === 'Electric' ? 12 : 0))
      return { model: `M${i + 1}`, drive, price, power: Math.round(90 + price * 3.1 + w * 60), weight: Math.round(1250 + (drive === 'Electric' ? 420 : drive === 'Hybrid' ? 180 : 0) + w * 300), range: Math.round(drive === 'Electric' ? 330 + u * 220 : 650 + w * 350) }
    })
  },
  check(spec, ctx) {
    const dims = dimsOf(spec)
    const seen = new Set<string>()
    dims.forEach((d, i) => {
      if (seen.has(d)) ctx.issues.push({ severity: 'error', code: 'duplicate_column', path: `dimensions[${i}]`, message: `"${d}" appears twice in dimensions.`, hint: 'Each axis needs its own column.' })
      seen.add(d)
    })
    const all = complete(ctx.rows, dims)
    const skipped = ctx.rows.length - all.length
    if (!all.length) ctx.issues.push({ severity: 'error', code: 'no_values', path: 'dimensions', message: 'No row has a number in every dimension.', hint: 'Fill or filter out rows with missing values.' })
    else if (skipped) ctx.issues.push({ severity: 'warning', code: 'incomplete_rows', path: 'dimensions', message: `${skipped} row(s) lack a number in some dimension and are not drawn.` })
    const { rows, step } = sampleRows(all)
    if (step > 1) ctx.issues.push({ severity: 'warning', code: 'lines_sampled', path: 'data', message: `${all.length} lines would be ink, not information: one row in every ${step} is drawn (${rows.length} lines). The axes still span every row.`, hint: 'Filter or aggregate with `transform`, or colour by `series` and hide groups from the legend.' })
    if (spec.patterns === true) ctx.issues.push({ severity: 'warning', code: 'patterns_unsupported', path: 'patterns', message: 'Parallel coordinates draw lines, which have no fill to texture; patterns is ignored. Groups stay apart by the legend and the tooltip.' })
  },
  compile,
  describe(spec, env) {
    const dims = dimsOf(spec)
    const all = complete(spec.data, dims)
    const f = formatter(spec, env.locale)
    if (!all.length) return `${lead(spec, 'Parallel coordinates')} No complete rows.`
    const groups = typeof spec.series === 'string' ? distinct(all.map(r => xKey(r.row[spec.series]))) : []
    let t = `${lead(spec, 'Parallel coordinates')} ${all.length} rows across ${dims.length} measures (${fmtList(dims, 6)})${groups.length ? `, in ${groups.length} groups by ${spec.series} (${fmtList(groups)})` : ''}.`
    const ranges = dims.slice(0, 6).map((d, i) => {
      const v = all.map(r => r.values[i])
      return `${clip(d, 30)} ${f(Math.min(...v))} to ${f(Math.max(...v))}`
    })
    t += ` Ranges: ${ranges.join('; ')}.`
    let best: { a: string; b: string; r: number } | null = null
    for (let i = 0; i + 1 < dims.length; i++) {
      const r = correlation(all.map(x => x.values[i]), all.map(x => x.values[i + 1]))
      if (r !== null && (!best || Math.abs(r) > Math.abs(best.r))) best = { a: dims[i], b: dims[i + 1], r }
    }
    if (best) t += ` Strongest link between neighbouring axes: ${clip(best.a, 30)} and ${clip(best.b, 30)} (r = ${best.r.toFixed(2)}).`
    const { step, rows } = sampleRows(all)
    if (step > 1) t += ` One row in every ${step} is drawn (${rows.length} lines).`
    return t
  }
}
