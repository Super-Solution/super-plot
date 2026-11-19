import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, Rect } from '../scene.js'
import { tokenValue } from '../theme.js'
import { mix } from '../util/color.js'
import { linearScale, niceLinear, type LinearScale } from '../scale.js'
import { drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { distinct } from '../data.js'
import { correlation, extent, linearFit, toNumber } from '../util/num.js'
import { formatTime, hasTimeOfDay, toTime } from '../util/time.js'
import { clip } from '../util/text.js'
import { formatter, lead } from './shared.js'

interface P { x: number; y: number; s: string; size: number | null; name: string | null }

/** `density: "auto"` switches to hexagons above this many visible points. */
export const DENSITY_AUTO = 10_000

/** Hexagonal bins in pixel space (pointy top), coloured from `seq-low` to `seq-high` by count, with a ramp legend. */
function hexbin(c: ChartCtx, pts: P[], xs: LinearScale, ys: LinearScale, plot: Rect, rampW: number, groups: number): void {
  const R = c.compact ? 6 : 7
  const dx = Math.sqrt(3) * R
  const dy = 1.5 * R
  const bins = new Map<string, { i: number; j: number; n: number }>()
  for (const p of pts) {
    const px = xs.at(p.x) - plot.x
    const py = ys.at(p.y) - plot.y
    if (px < -0.5 || px > plot.w + 0.5 || py < -0.5 || py > plot.h + 0.5) continue
    // Nearest of the two candidate rows (d3-hexbin's method).
    let pj = Math.round(py / dy)
    let pi = Math.round(px / dx - (pj & 1) / 2)
    const py1 = py / dy - pj
    if (Math.abs(py1) * 3 > 1) {
      const px1 = px / dx - pi - (pj & 1) / 2
      const pi2 = pi + (px / dx - pi < 0 ? -1 : 1) / 2
      const pj2 = pj + (py1 < 0 ? -1 : 1)
      const px2 = px / dx - pi2 - (pj2 & 1) / 2
      const py2 = py / dy - pj2
      if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
        pi = pi2 + ((pj & 1) ? 1 : -1) / 2
        pj = pj2
      }
    }
    const key = `${pi},${pj}`
    const b = bins.get(key)
    if (b) b.n++
    else bins.set(key, { i: pi, j: pj, n: 1 })
  }
  const max = Math.max(1, ...[...bins.values()].map(b => b.n))
  const low = tokenValue(c.theme, 'seq-low')
  const high = tokenValue(c.theme, 'seq-high')
  const color = (n: number): string => mix(low, high, max === 1 ? 1 : Math.sqrt((n - 1) / (max - 1)))
  const corners = [0, 1, 2, 3, 4, 5].map(k => [Math.sin((k * Math.PI) / 3) * R, -Math.cos((k * Math.PI) / 3) * R])
  const fmt = c.format
  const count = new Intl.NumberFormat(c.locale)
  c.clips.plot = `M${plot.x} ${plot.y}h${plot.w}v${plot.h}h${-plot.w}Z`
  for (const b of bins.values()) {
    const cx = plot.x + (b.i + (b.j & 1) / 2) * dx
    const cy = plot.y + b.j * dy
    const d = corners.map(([ox, oy], k) => `${k ? 'L' : 'M'}${Math.round((cx + ox) * 100) / 100} ${Math.round((cy + oy) * 100) / 100}`).join('') + 'Z'
    const x0 = xs.invert(cx - dx / 2), x1 = xs.invert(cx + dx / 2)
    const y0 = ys.invert(cy + R), y1 = ys.invert(cy - R)
    const fill = color(b.n)
    c.marks.push({ type: 'path', role: 'data', d, fill, clip: 'plot', anim: 'fade', tip: { title: `${count.format(b.n)} ${b.n === 1 ? 'point' : 'points'}`, rows: [{ label: String(c.spec.x), value: `${fmt(x0)} – ${fmt(x1)}` }, { label: String(c.spec.y), value: `${fmt(y0)} – ${fmt(y1)}` }] }, aria: `${count.format(b.n)} points near ${c.spec.x} ${fmt((x0 + x1) / 2)}, ${c.spec.y} ${fmt((y0 + y1) / 2)}`, datum: { count: b.n, x: [x0, x1], y: [y0, y1] } })
  }
  if (rampW) {
    const x = plot.x + plot.w + 22
    const y0 = plot.y + 8
    const h = Math.min(plot.h - 16, 220)
    const n = 24
    for (let i = 0; i < n; i++) c.marks.push({ type: 'rect', role: 'legend', x, y: y0 + (h / n) * i, w: 12, h: h / n + 0.5, fill: mix(high, low, i / (n - 1)) })
    c.marks.push(c.text(x + 18, y0 + 4, count.format(max), { role: 'legend', baseline: 'middle', size: c.size - 1 }))
    c.marks.push(c.text(x + 18, y0 + h - 4, '1', { role: 'legend', baseline: 'middle', size: c.size - 1 }))
    c.marks.push(c.text(x, y0 - 8, 'Points', { role: 'legend', size: c.size - 1 }))
  }
  if (groups > 1) c.warn('density_merges_series', 'density', `Hexagons count all ${groups} groups together; colour shows density, not group.`, 'Facet by the group column to compare densities per group.')
}

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
  // Density: past the threshold (or when asked), hexagons coloured by how many points fall in each.
  const hex = s.density === 'hex' || (s.density === 'auto' && show.length > DENSITY_AUTO)
  const frame = c.frame({ series: hex ? [] : series, autoSide: 'top' })
  const rampW = hex && !c.compact ? 64 : 0
  const xAxis = valueAxis(c, xScale, { title: s.xLabel ?? String(s.x), vertical: false, format: 'auto', grid: true })
  const yAxis = valueAxis(c, yScale, { title: s.yLabel ?? String(s.y), vertical: true, format: s.format })
  const plot = layoutCartesian(c, { ...frame, w: frame.w - rampW }, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)
  if (hex) {
    hexbin(c, show, xScale, yScale, plot, rampW, keys.length)
    return { series }
  }

  const sizes = show.map(p => p.size).filter((v): v is number => v !== null)
  const sz = extent(sizes)
  // Density-adaptive dots: past a few thousand points, smaller dots without the surface ring overlap less
  // (the cloud stays readable) and cost far less to draw.
  const n = show.length
  const dense = n > 2000
  const baseR = n > 20000 ? 2 : n > 8000 ? 2.5 : dense ? 3.5 : 5
  const radius = (p: P): number => (p.size === null || !sz ? baseR : sz[0] === sz[1] ? 9 : 4 + 14 * Math.sqrt((p.size - sz[0]) / (sz[1] - sz[0])))
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
    dots.push({ type: 'circle', role: 'data', series: p.s, cx, cy, r, fill: color, opacity: dense && p.size === null ? (n > 20000 ? 0.5 : 0.6) : p.size !== null || show.length > 200 ? 0.62 : 0.85, ...(dense && p.size === null ? {} : { stroke: c.c('background'), strokeWidth: 1.5 }), tip, ...(withAria ? { aria: `${p.name ?? ''} ${s.x} ${xfmt(p.x)}, ${s.y} ${fmt(p.y)}`.trim() } : {}), anim: 'fade', datum: { x: p.x, y: p.y, series: p.s } })
    if (hitOk && r < 8) hits.push({ type: 'circle', role: 'hit', series: p.s, cx, cy, r: 10, fill: 'transparent', tip, datum: { x: p.x, y: p.y, series: p.s } })
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
  if (pts.length > 5000) c.warn('many_marks', 'data', `${pts.length} points are fine in the browser (the web binding switches to canvas) but make a heavy SVG file.`, 'Set `density: "auto"` to draw hexagons by count past 10,000 points, or aggregate with `transform`.')
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
    density: { kind: 'enum', values: ['points', 'hex', 'auto'], desc: 'Default points. `hex` draws hexagons coloured by how many points fall in each (with a count legend); `auto` does so above 10,000 visible points. Hexagons merge groups.' },
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
