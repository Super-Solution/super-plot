import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark } from '../scene.js'
import { linearScale, niceLinear, type LinearScale } from '../scale.js'
import { drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { distinct } from '../data.js'
import { correlation, extent, linearFit, toNumber } from '../util/num.js'
import { formatTime, hasTimeOfDay, toTime } from '../util/time.js'
import { clip } from '../util/text.js'
import { formatter, lead } from './shared.js'

interface P { x: number; y: number; s: string; size: number | null; name: string | null }

function points(spec: Record<string, any>): { pts: P[]; kind: 'linear' | 'time' } {
  const kind: 'linear' | 'time' = spec.xType === 'time' ? 'time' : spec.xType === 'linear' ? 'linear' : (spec.data as Record<string, unknown>[]).some(r => typeof r[spec.x] === 'string' && toNumber(r[spec.x]) === null) ? 'time' : 'linear'
  const pts: P[] = []
  for (const r of spec.data as Record<string, unknown>[]) {
    const x = kind === 'time' ? toTime(r[spec.x]) : toNumber(r[spec.x])
    const y = toNumber(r[spec.y])
    if (x === null || y === null) continue
    pts.push({ x, y, s: spec.series ? String(r[spec.series] ?? '') : String(spec.y), size: spec.size ? toNumber(r[spec.size]) : null, name: spec.label ? String(r[spec.label] ?? '') : null })
  }
  return { pts, kind }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const { pts, kind } = points(s)
  const keys = distinct(pts.map(p => p.s))
  const series = c.makeSeries(keys)
  const show = pts.filter(p => !c.hidden.has(p.s))
  const ex = extent(show.map(p => p.x)) ?? [0, 1]
  const ey = extent(show.map(p => p.y)) ?? [0, 1]
  const xd = s.xDomain as [number | null, number | null] | undefined
  const yd = s.yDomain as [number | null, number | null] | undefined
  const xScale: LinearScale = xd && (xd[0] !== null || xd[1] !== null)
    ? linearScale([xd[0] ?? ex[0], xd[1] ?? ex[1]], kind)
    : kind === 'time' ? linearScale(ex[0] === ex[1] ? [ex[0] - 864e5, ex[1] + 864e5] : ex, 'time') : niceLinear(ex[0], ex[1])
  const yScale: LinearScale = yd && (yd[0] !== null || yd[1] !== null) ? linearScale([yd[0] ?? ey[0], yd[1] ?? ey[1]]) : niceLinear(ey[0], ey[1])
  const frame = c.frame({ series, autoSide: 'top' })
  const xAxis = valueAxis(c, xScale, { title: s.xLabel ?? String(s.x), vertical: false, format: 'auto', grid: true })
  const yAxis = valueAxis(c, yScale, { title: s.yLabel ?? String(s.y), vertical: true, format: s.format })
  const plot = layoutCartesian(c, frame, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)

  const sizes = show.map(p => p.size).filter((v): v is number => v !== null)
  const sz = extent(sizes)
  const radius = (p: P): number => (p.size === null || !sz ? 5 : sz[0] === sz[1] ? 9 : 4 + 14 * Math.sqrt((p.size - sz[0]) / (sz[1] - sz[0])))
  const fmt = c.format
  const intraday = kind === 'time' && hasTimeOfDay(show.map(p => p.x))
  const xnf = new Intl.NumberFormat(c.locale, { maximumFractionDigits: 4 })
  const xfmt = (v: number): string => (kind === 'time' ? formatTime(v, intraday ? 'datetime' : 'full', c.locale) : xnf.format(v))
  const withAria = show.length <= 2000 // tens of thousands of tab stops help nobody; the description and tooltips still carry the data
  const dots: Mark[] = []
  const hits: Mark[] = []
  const hitOk = show.length <= 1500
  for (const p of show) {
    const si = keys.indexOf(p.s)
    const color = series[si].color
    const cx = xScale.at(p.x)
    const cy = yScale.at(p.y)
    if (cx < plot.x - 1 || cx > plot.x + plot.w + 1 || cy < plot.y - 1 || cy > plot.y + plot.h + 1) continue
    const r = radius(p)
    const rows = [
      { label: String(s.x), value: xfmt(p.x), color: undefined as unknown as string },
      { label: String(s.y), value: fmt(p.y), color: undefined as unknown as string },
      ...(s.size && p.size !== null ? [{ label: String(s.size), value: fmt(p.size), color: undefined as unknown as string }] : [])
    ]
    const tip = { title: clip(p.name ?? (keys.length > 1 ? series[si].label : ''), 60) || undefined, rows }
    dots.push({ type: 'circle', role: 'data', series: p.s, cx, cy, r, fill: color, opacity: p.size !== null || show.length > 200 ? 0.62 : 0.85, stroke: c.c('background'), strokeWidth: 1.5, tip, ...(withAria ? { aria: `${p.name ?? ''} ${s.x} ${xfmt(p.x)}, ${s.y} ${fmt(p.y)}`.trim() } : {}), anim: 'fade', datum: { x: p.x, y: p.y, series: p.s } })
    if (hitOk && r < 8) hits.push({ type: 'circle', role: 'hit', series: p.s, cx, cy, r: 10, fill: 'transparent', tip })
  }
  const trend: Mark[] = []
  if (s.trend === 'linear') {
    for (const k of keys) {
      if (c.hidden.has(k)) continue
      const own = pts.filter(p => p.s === k)
      const fit = linearFit(own.map(p => p.x), own.map(p => p.y))
      const e = extent(own.map(p => p.x))
      if (!fit || !e) continue
      const y0 = fit.intercept + fit.slope * e[0]
      const y1 = fit.intercept + fit.slope * e[1]
      trend.push({ type: 'line', role: 'annotation', x1: xScale.at(e[0]), y1: Math.max(plot.y, Math.min(plot.y + plot.h, yScale.at(y0))), x2: xScale.at(e[1]), y2: Math.max(plot.y, Math.min(plot.y + plot.h, yScale.at(y1))), stroke: series[keys.indexOf(k)].color, strokeWidth: 1.5, dash: '6 4', series: k })
    }
  }
  c.marks.push(...trend, ...dots, ...hits)
  if (pts.length > 5000) c.warn('many_marks', 'data', `${pts.length} points are fine in the browser (the web binding switches to canvas) but make a heavy SVG file; aggregate or sample before exporting SVG.`)
  return { series }
}

export const scatter: ChartDef = {
  type: 'scatter',
  name: 'Scatter plot',
  summary: 'Plots each row as a point by two numbers to show relationships, clusters and outliers; optional bubble size and trend line.',
  useWhen: 'Asking whether two measures move together, or finding outliers. Add `size` for a third measure (bubble), `series` for groups, `trend: "linear"` for the fit. Not for ordered time series (use line) or part-to-whole.',
  cartesian: true,
  fields: {
    x: { kind: 'column', role: 'x', required: true, desc: 'Numeric (or date) column for the horizontal position.' },
    y: { kind: 'column', role: 'number', required: true, desc: 'Numeric column for the vertical position.' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours points by group.' },
    size: { kind: 'column', role: 'number', desc: 'Numeric column mapped to bubble area.' },
    label: { kind: 'column', role: 'any', desc: 'Column used as each point\'s name in the tooltip.' },
    trend: { kind: 'enum', values: ['none', 'linear'], default: 'none', desc: 'Draw a least-squares line per series.' },
    xType: { kind: 'enum', values: ['auto', 'linear', 'time'], default: 'auto', desc: 'How to read `x`.' },
    xDomain: { kind: 'domain', desc: 'Fix the horizontal range.' },
    yDomain: { kind: 'domain', desc: 'Fix the vertical range.' }
  },
  example: {
    type: 'scatter',
    title: 'Ad spend vs. signups',
    subtitle: 'One point per campaign; bubble = budget',
    x: 'spend', y: 'signups', series: 'channel', size: 'budget', label: 'campaign', trend: 'linear',
    xLabel: 'Spend (USD k)', yLabel: 'Signups',
    data: [
      { campaign: 'Search A', channel: 'Search', spend: 12, signups: 340, budget: 15 }, { campaign: 'Search B', channel: 'Search', spend: 18, signups: 470, budget: 20 },
      { campaign: 'Search C', channel: 'Search', spend: 25, signups: 610, budget: 30 }, { campaign: 'Search D', channel: 'Search', spend: 31, signups: 720, budget: 35 },
      { campaign: 'Social A', channel: 'Social', spend: 8, signups: 150, budget: 10 }, { campaign: 'Social B', channel: 'Social', spend: 15, signups: 260, budget: 18 },
      { campaign: 'Social C', channel: 'Social', spend: 22, signups: 330, budget: 25 }, { campaign: 'Social D', channel: 'Social', spend: 35, signups: 420, budget: 40 },
      { campaign: 'Video A', channel: 'Video', spend: 20, signups: 210, budget: 25 }, { campaign: 'Video B', channel: 'Video', spend: 30, signups: 380, budget: 35 },
      { campaign: 'Video C', channel: 'Video', spend: 40, signups: 480, budget: 45 }, { campaign: 'Video D', channel: 'Video', spend: 52, signups: 690, budget: 60 }
    ]
  },
  check(spec, ctx) {
    if (!points({ ...spec, data: ctx.rows }).pts.length) ctx.issues.push({ severity: 'error', code: 'no_points', path: 'data', message: 'No row has both a numeric x and y.' })
  },
  compile,
  describe(spec, env) {
    const { pts } = points(spec)
    const f = formatter(spec, env.locale)
    const keys = distinct(pts.map(p => p.s))
    let t = `${lead(spec, 'Scatter plot')} ${pts.length} points of ${spec.y} against ${spec.x}${keys.length > 1 ? `, in ${keys.length} groups (${keys.slice(0, 5).join(', ')})` : ''}.`
    const r = correlation(pts.map(p => p.x), pts.map(p => p.y))
    if (r !== null) t += ` Correlation ${r.toFixed(2)} (${Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : 'weak'} ${r >= 0 ? 'positive' : 'negative'}).`
    const ey = extent(pts.map(p => p.y))
    if (ey) t += ` ${spec.y} ranges from ${f(ey[0])} to ${f(ey[1])}.`
    return t
  }
}
