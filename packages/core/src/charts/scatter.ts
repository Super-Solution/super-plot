// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, Rect } from '../scene.js'
import { tokenValue } from '../theme.js'
import { mix } from '../util/color.js'
import { linearScale, logScale, niceLinear, niceLog, type LinearScale } from '../scale.js'
import { drawAnnotations, layoutCartesian, valueAxis, warnZoneDates } from '../cartesian.js'
import { distinct } from '../data.js'
import { correlation, extent, linearFit, toNumber } from '../util/num.js'
import { formatTime, hasTimeOfDay, toTime } from '../util/time.js'
import { clip } from '../util/text.js'
import { JITTER_MAX, jitterUnit } from '../util/jitter.js'
import { formatter, lead } from './shared.js'
import { loess } from '../util/loess.js'
import { intervalCheck, intervalFields, intervalText, logDomain, logNonPositive, refuseLog, scaleField } from './extras.js'

interface P { row: Record<string, unknown>; /** Position of the row in the data (before anything is hidden): what jitter is keyed on. */ i: number; x: number; y: number; s: string; size: number | null; name: string | null; ord?: number; ylo?: number; yhi?: number; xlo?: number; xhi?: number }

/** `density: "auto"` switches to hexagons above this many visible points. */
export const DENSITY_AUTO = 10_000

/** Whether `jitter` moves points in this chart: set, above 0, and not a chart that draws hexagons or joins points by a line. */
const jittered = (spec: Record<string, any>): boolean => typeof spec.jitter === 'number' && spec.jitter > 0 && spec.density !== 'hex' && !spec.order

/** Hexagonal bins in pixel space (pointy top), coloured from `seq-low` to `seq-high` by count, with a ramp legend. */
function hexbin(c: ChartCtx, pts: P[], xs: LinearScale, ys: LinearScale, plot: Rect, rampW: number, groups: number): void {
  const R = c.compact ? 6 : 7
  const dx = Math.sqrt(3) * R
  const dy = 1.5 * R
  const bins = new Map<string, { i: number; j: number; n: number; rows: P['row'][] }>()
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
    if (b) {
      b.n++
      b.rows.push(p.row)
    } else bins.set(key, { i: pi, j: pj, n: 1, rows: [p.row] })
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
    c.marks.push({ type: 'path', role: 'data', d, fill, clip: 'plot', anim: 'fade', tip: { title: c.t(b.n === 1 ? 'pointCountOne' : 'pointCount', { n: count.format(b.n) }), rows: [{ label: String(c.spec.x), value: `${fmt(x0)} – ${fmt(x1)}` }, { label: String(c.spec.y), value: `${fmt(y0)} – ${fmt(y1)}` }] }, aria: c.t('binNearAria', { n: count.format(b.n), x: String(c.spec.x), xValue: fmt((x0 + x1) / 2), y: String(c.spec.y), yValue: fmt((y0 + y1) / 2) }), datum: { count: b.n, x: [x0, x1], y: [y0, y1] }, rows: c.rowsOf(b.rows) })
  }
  if (rampW) {
    const x = plot.x + plot.w + 22
    const y0 = plot.y + 8
    const h = Math.min(plot.h - 16, 220)
    const n = 24
    for (let i = 0; i < n; i++) c.marks.push({ type: 'rect', role: 'legend', x, y: y0 + (h / n) * i, w: 12, h: h / n + 0.5, fill: mix(high, low, i / (n - 1)) })
    c.marks.push(c.text(x + 18, y0 + 4, count.format(max), { role: 'legend', baseline: 'middle', size: c.size - 1 }))
    c.marks.push(c.text(x + 18, y0 + h - 4, '1', { role: 'legend', baseline: 'middle', size: c.size - 1 }))
    c.marks.push(c.text(x, y0 - 8, c.t('points'), { role: 'legend', size: c.size - 1 }))
  }
  if (groups > 1) c.warn('density_merges_series', 'density', `Hexagons count all ${groups} groups together; colour shows density, not group.`, 'Facet by the group column to compare densities per group.')
}

/** The position of a row on a connected path: a number, or a date read as time; null leaves the row off the path. */
function orderKey(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  return toNumber(v) ?? (typeof v === 'string' ? toTime(v) : null)
}

function points(spec: Record<string, any>): { pts: P[]; kind: 'linear' | 'time' } {
  const kind: 'linear' | 'time' = spec.xType === 'time' ? 'time' : spec.xType === 'linear' ? 'linear' : (spec.data as Record<string, unknown>[]).some(r => typeof r[spec.x] === 'string' && toNumber(r[spec.x]) === null) ? 'time' : 'linear'
  const pts: P[] = []
  const logX = spec.xScale === 'log' && kind === 'linear'
  const logY = spec.yScale === 'log'
  const yi = !!spec.yLower && !!spec.yUpper
  const xi = !!spec.xLower && !!spec.xUpper
  for (const [i, r] of (spec.data as Record<string, unknown>[]).entries()) {
    const x = kind === 'time' ? toTime(r[spec.x]) : toNumber(r[spec.x])
    const y = toNumber(r[spec.y])
    if (x === null || y === null || (logX && !(x > 0)) || (logY && !(y > 0))) continue
    const p: P = { row: r, i, x, y, s: spec.series ? String(r[spec.series] ?? '') : String(spec.y), size: spec.size ? toNumber(r[spec.size]) : null, name: spec.label ? String(r[spec.label] ?? '') : null }
    if (spec.order) {
      const o = orderKey(r[spec.order])
      if (o !== null) p.ord = o
    }
    if (yi) {
      const a = toNumber(r[spec.yLower])
      const b = toNumber(r[spec.yUpper])
      if (a !== null && b !== null) { p.ylo = Math.min(a, b); p.yhi = Math.max(a, b) }
    }
    if (xi) {
      const a = kind === 'time' ? toTime(r[spec.xLower]) : toNumber(r[spec.xLower])
      const b = kind === 'time' ? toTime(r[spec.xUpper]) : toNumber(r[spec.xUpper])
      if (a !== null && b !== null) { p.xlo = Math.min(a, b); p.xhi = Math.max(a, b) }
    }
    pts.push(p)
  }
  return { pts, kind }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const { pts, kind } = points(s)
  const keys = distinct(pts.map(p => p.s))
  const series = c.makeSeries(keys)
  const show = pts.filter(p => !c.hidden.has(p.s))
  const logX = s.xScale === 'log' && kind === 'linear'
  const logY = s.yScale === 'log'
  // Intervals widen the axes; on a log axis only their positive ends count.
  const pos = (v: number | undefined, log: boolean): v is number => v !== undefined && (!log || v > 0)
  const ex = extent(show.flatMap(p => [p.x, ...[p.xlo, p.xhi].filter(v => pos(v, logX)) as number[]])) ?? [0, 1]
  const ey = extent(show.flatMap(p => [p.y, ...[p.ylo, p.yhi].filter(v => pos(v, logY)) as number[]])) ?? [0, 1]
  const xd = s.xDomain as [number | null, number | null] | undefined
  const yd = s.yDomain as [number | null, number | null] | undefined
  const xScale: LinearScale = xd && (xd[0] !== null || xd[1] !== null)
    ? (logX ? logScale([xd[0] ?? ex[0], xd[1] ?? ex[1]]) : linearScale([xd[0] ?? ex[0], xd[1] ?? ex[1]], kind))
    : logX ? niceLog(ex[0], ex[1]) : kind === 'time' ? linearScale(ex[0] === ex[1] ? [ex[0] - 864e5, ex[1] + 864e5] : ex, 'time') : niceLinear(ex[0], ex[1])
  const yScale: LinearScale = yd && (yd[0] !== null || yd[1] !== null)
    ? (logY ? logScale([yd[0] ?? ey[0], yd[1] ?? ey[1]]) : linearScale([yd[0] ?? ey[0], yd[1] ?? ey[1]]))
    : logY ? niceLog(ey[0], ey[1]) : niceLinear(ey[0], ey[1])
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
  if (kind === 'time') warnZoneDates(c, show.map(p => p.x), 'x')
  const intraday = kind === 'time' && hasTimeOfDay(show.map(p => p.x), c.timeZone)
  const xnf = new Intl.NumberFormat(c.locale, { maximumFractionDigits: 4 })
  const xfmt = (v: number): string => (kind === 'time' ? formatTime(v, intraday ? 'datetime' : 'full', c.locale, c.timeZone) : xnf.format(v))
  // A trend that runs past a fixed range is cut at the plot's edge.
  const clipTrend = !!(xd && (xd[0] !== null || xd[1] !== null))
  if (clipTrend) c.clips.plot = `M${plot.x} ${plot.y}h${plot.w}v${plot.h}h${-plot.w}Z`
  const withAria = show.length <= 2000 // tens of thousands of tab stops help nobody; the description and tooltips still carry the data
  const dots: Mark[] = []
  const bars: Mark[] = []
  const hits: Mark[] = []
  const hitOk = show.length <= 1500
  const cap = 4
  const jit = jittered(s) ? (s.jitter as number) : 0
  const nudgeX = jit > 0 && s.jitterAxis !== 'y'
  const nudgeY = jit > 0 && s.jitterAxis !== 'x'
  const clampX = (v: number): number => Math.max(plot.x, Math.min(plot.x + plot.w, v))
  const clampY = (v: number): number => Math.max(plot.y, Math.min(plot.y + plot.h, v))
  // A log axis cannot place an interval end at or below zero: the bar runs to the plot's edge (no cap there).
  const yPx = (v: number): number => (logY && !(v > 0) ? plot.y + plot.h : clampY(yScale.at(v)))
  const xPx = (v: number): number => (logX && !(v > 0) ? plot.x : clampX(xScale.at(v)))
  for (const p of show) {
    const si = keys.indexOf(p.s)
    const color = series[si].color
    const tx0 = xScale.at(p.x)
    const ty0 = yScale.at(p.y)
    if (tx0 < plot.x - 1 || tx0 > plot.x + plot.w + 1 || ty0 < plot.y - 1 || ty0 > plot.y + plot.h + 1) continue
    // Jitter nudges the drawn dot only (kept inside the plot); the datum, the tooltip and the description keep the true values.
    const cx = nudgeX ? clampX(tx0 + jit * jitterUnit(p.i, 'x')) : tx0
    const cy = nudgeY ? clampY(ty0 + jit * jitterUnit(p.i, 'y')) : ty0
    const r = radius(p)
    const yInt = p.ylo !== undefined ? ` (${intervalText(fmt, p.ylo, p.yhi!)})` : ''
    const xInt = p.xlo !== undefined ? ` (${intervalText(xfmt, p.xlo, p.xhi!)})` : ''
    const rows = [
      { label: String(s.x), value: xfmt(p.x) + xInt, color: undefined as unknown as string },
      { label: String(s.y), value: fmt(p.y) + yInt, color: undefined as unknown as string },
      ...(s.size && p.size !== null ? [{ label: String(s.size), value: fmt(p.size), color: undefined as unknown as string }] : [])
    ]
    const tip = { title: clip(p.name ?? (keys.length > 1 ? series[si].label : ''), 60) || undefined, rows }
    const own = c.rowsOf([p.row])
    const datum = { x: p.x, y: p.y, series: p.s, ...(p.ylo !== undefined ? { yLower: p.ylo, yUpper: p.yhi } : {}), ...(p.xlo !== undefined ? { xLower: p.xlo, xUpper: p.xhi } : {}) }
    if (p.ylo !== undefined) {
      const y0 = yPx(p.ylo), y1 = yPx(p.yhi!)
      bars.push({ type: 'line', role: 'data', series: p.s, x1: cx, x2: cx, y1: y0, y2: y1, stroke: color, strokeWidth: 1.25, anim: 'fade', rows: own })
      for (const [v, e] of [[p.ylo, y0], [p.yhi!, y1]] as const) if (!logY || v > 0) bars.push({ type: 'line', role: 'data', series: p.s, x1: cx - cap, x2: cx + cap, y1: e, y2: e, stroke: color, strokeWidth: 1.25, anim: 'fade', rows: own })
    }
    if (p.xlo !== undefined) {
      const x0 = xPx(p.xlo), x1 = xPx(p.xhi!)
      bars.push({ type: 'line', role: 'data', series: p.s, x1: x0, x2: x1, y1: cy, y2: cy, stroke: color, strokeWidth: 1.25, anim: 'fade', rows: own })
      for (const [v, e] of [[p.xlo, x0], [p.xhi!, x1]] as const) if (!logX || v > 0) bars.push({ type: 'line', role: 'data', series: p.s, x1: e, x2: e, y1: cy - cap, y2: cy + cap, stroke: color, strokeWidth: 1.25, anim: 'fade', rows: own })
    }
    dots.push({ type: 'circle', role: 'data', series: p.s, cx, cy, r, fill: color, opacity: dense && p.size === null ? (n > 20000 ? 0.5 : 0.6) : p.size !== null || show.length > 200 ? 0.62 : 0.85, ...(dense && p.size === null ? {} : { stroke: c.c('background'), strokeWidth: 1.5 }), tip, ...(withAria ? { aria: `${p.name ?? ''} ${s.x} ${xfmt(p.x)}${xInt}, ${s.y} ${fmt(p.y)}${yInt}`.trim() } : {}), anim: 'fade', datum, rows: own })
    if (hitOk && r < 8) hits.push({ type: 'circle', role: 'hit', series: p.s, cx, cy, r: 10, fill: 'transparent', tip, datum, rows: own })
  }
  const trend: Mark[] = []
  // Fits run in the axes' own space (log10 on a log axis), so the drawn curve is the fit of what is shown.
  const tx = (v: number): number => (logX ? Math.log10(v) : v)
  const ty = (v: number): number => (logY ? Math.log10(v) : v)
  const ux = (v: number): number => (logX ? 10 ** v : v)
  const uy = (v: number): number => (logY ? 10 ** v : v)
  if (s.trend === 'linear' || s.trend === 'loess') {
    for (const k of keys) {
      if (c.hidden.has(k)) continue
      const own = pts.filter(p => p.s === k)
      const color = series[keys.indexOf(k)].color
      if (s.trend === 'loess') {
        const curve = loess(own.map(p => tx(p.x)), own.map(p => ty(p.y)), (s.trendBandwidth as number | undefined) ?? 0.3)
        if (curve.length < 2) continue
        const d = curve.map(([gx, gy], i) => `${i ? 'L' : 'M'}${Math.round(xScale.at(ux(gx)) * 100) / 100} ${Math.round(clampY(yScale.at(uy(gy))) * 100) / 100}`).join('')
        trend.push({ type: 'path', role: 'annotation', d, stroke: color, strokeWidth: 2, dash: '6 4', series: k, ...(clipTrend ? { clip: 'plot' } : {}) })
        continue
      }
      const fit = linearFit(own.map(p => tx(p.x)), own.map(p => ty(p.y)))
      const e = extent(own.map(p => p.x))
      if (!fit || !e) continue
      const y0 = uy(fit.intercept + fit.slope * tx(e[0]))
      const y1 = uy(fit.intercept + fit.slope * tx(e[1]))
      trend.push({ type: 'line', role: 'annotation', x1: xScale.at(e[0]), y1: Math.max(plot.y, Math.min(plot.y + plot.h, yScale.at(y0))), x2: xScale.at(e[1]), y2: Math.max(plot.y, Math.min(plot.y + plot.h, yScale.at(y1))), stroke: color, strokeWidth: 1.5, dash: '6 4', series: k })
    }
  }
  // `order`: join each series' points, in the order of that column, with a line under the dots.
  const paths: Mark[] = []
  if (s.order) {
    for (const k of keys) {
      if (c.hidden.has(k)) continue
      const own = show.filter(p => p.s === k && p.ord !== undefined).map((p, i) => ({ p, i })).sort((a, b) => a.p.ord! - b.p.ord! || a.i - b.i).map(e => e.p)
      if (own.length < 2) continue
      const d = own.map((p, i) => `${i ? 'L' : 'M'}${Math.round(xScale.at(p.x) * 100) / 100} ${Math.round(yScale.at(p.y) * 100) / 100}`).join('')
      paths.push({ type: 'path', role: 'data', series: k, d, stroke: series[keys.indexOf(k)].color, strokeWidth: c.theme.lineWidth, opacity: 0.7, anim: 'draw', rows: c.rowsOf(own.map(p => p.row)), ...(clipTrend ? { clip: 'plot' } : {}) })
    }
  }
  c.marks.push(...trend, ...paths, ...bars, ...dots, ...hits)
  if (pts.length > 5000) c.warn('many_marks', 'data', `${pts.length} points are fine in the browser (the web binding switches to canvas) but make a heavy SVG file.`, 'Set `density: "auto"` to draw hexagons by count past 10,000 points, or aggregate with `transform`.')
  return { series }
}

export const scatter: ChartDef = {
  type: 'scatter',
  name: 'Scatter plot',
  summary: 'Plots each row as a point by two numbers to show relationships, clusters and outliers; optional bubble size and trend line.',
  useWhen: 'Asking whether two measures move together, or finding outliers. Add `size` for a third measure (bubble), `series` for groups, `trend: "linear"` for the fit. Not for ordered time series (use line) or part-to-whole.',
  cartesian: true,
  ref: { x: ['x'], y: ['y'], series: 'series' },
  fields: {
    x: { kind: 'column', role: 'x', required: true, desc: 'Numeric (or date) column for the horizontal position.' },
    y: { kind: 'column', role: 'number', required: true, desc: 'Numeric column for the vertical position.' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours points by group.' },
    size: { kind: 'column', role: 'number', desc: 'Numeric column mapped to bubble area.' },
    label: { kind: 'column', role: 'any', desc: 'Column used as each point\'s name in the tooltip.' },
    order: { kind: 'column', role: 'any', desc: 'Column that gives the order of the points: each series is joined by a line through its points from the lowest value to the highest (a connected scatter, e.g. a cycle over time). A date or a number; a row without a value stays a dot off the line. Ties keep the order of the data.' },
    trend: { kind: 'enum', values: ['none', 'linear', 'loess'], default: 'none', desc: 'Draw a fit per series: `linear` is a least-squares line, `loess` a local regression curve (tricube weights, local linear fits, evaluated on 50 points; see `trendBandwidth`). On a log axis the fit is made in log space.' },
    trendBandwidth: { kind: 'number', min: 0.05, max: 1, desc: 'Default 0.3. For `trend: "loess"`: the share of the points each local fit uses. Smaller follows the data more closely, larger is smoother.' },
    yScale: scaleField('y', 'incomes, populations, response times'),
    xScale: { ...scaleField('x', 'sizes, counts'), desc: `${scaleField('x', 'sizes, counts').desc} Only for a numeric x; dates are refused.` },
    ...intervalFields('y', 'a vertical error bar with caps through each point'),
    ...intervalFields('x', 'a horizontal error bar with caps through each point'),
    jitter: { kind: 'number', min: 0, max: JITTER_MAX, desc: `Default 0 (off). Nudge each dot by a fixed, repeatable offset of up to this many pixels so points that sit on the same spot show (whole-number scores, rounded measures). The offset depends only on the row's position in the data, so the same data draws the same way every time and hiding a series moves nothing. Only the drawing moves: tooltips, hover, the description and the data table keep the true values, and a dot is kept inside the plot. Ignored with \`density: "hex"\` or \`order\`.` },
    jitterAxis: { kind: 'enum', values: ['x', 'y', 'both'], default: 'both', desc: 'Which direction `jitter` moves points: `x` (sideways: the y values are the ones that repeat, as in a score from 1 to 5 against a date), `y`, or `both`.' },
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
    const { kind } = points({ ...spec, data: ctx.rows })
    if (spec.xScale === 'log' && kind === 'time') refuseLog(spec, ctx, 'xScale', 'x reads as dates; a log axis needs numbers.', 'Use a numeric x column, or drop xScale.')
    for (const a of ['x', 'y'] as const) {
      if (spec[`${a}Scale`] !== 'log' || (a === 'x' && kind === 'time')) continue
      logNonPositive(ctx.rows, [spec[a] as string], a, ctx)
      logDomain(spec, ctx, `${a}Scale`, `${a}Domain`)
    }
    intervalCheck(spec, ctx, 'y')
    intervalCheck(spec, ctx, 'x')
    if (spec.order && spec.density === 'hex') ctx.issues.push({ severity: 'warning', code: 'order_ignored_density', path: 'order', message: 'Hexagons count points, so no line joins them; `order` is ignored while hexagons are drawn.', hint: 'Use `density: "points"` (or leave it out) for a connected scatter.' })
    if (spec.trendBandwidth !== undefined && spec.trend !== 'loess') ctx.issues.push({ severity: 'warning', code: 'trend_bandwidth_ignored', path: 'trendBandwidth', message: 'trendBandwidth only applies to `trend: "loess"`; it is ignored.' })
    if (typeof spec.jitter === 'number' && spec.jitter > 0 && !jittered(spec)) ctx.issues.push({ severity: 'warning', code: 'jitter_ignored', path: 'jitter', message: spec.order ? 'A line joins the points of a connected scatter, so jitter would pull them off it; `jitter` is ignored.' : 'Hexagons count points, so there are no dots to nudge; `jitter` is ignored while hexagons are drawn.', hint: spec.order ? 'Drop `order` to jitter the dots, or drop `jitter`.' : 'Use `density: "points"` (or leave it out) to jitter the dots.' })
    if (spec.jitterAxis !== undefined && !(typeof spec.jitter === 'number' && spec.jitter > 0)) ctx.issues.push({ severity: 'warning', code: 'jitter_axis_ignored', path: 'jitterAxis', message: 'jitterAxis only applies when `jitter` is above 0; it is ignored.' })
    if (ctx.issues.some(i => i.severity === 'error')) return
    if (!points({ ...spec, data: ctx.rows }).pts.length) ctx.issues.push({ severity: 'error', code: 'no_points', path: 'data', message: spec.xScale === 'log' || spec.yScale === 'log' ? 'No row has a numeric x and y that a log axis can place (above zero).' : 'No row has both a numeric x and y.' })
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
    const logs = [spec.xScale === 'log' && points(spec).kind === 'linear' ? 'x' : '', spec.yScale === 'log' ? 'y' : ''].filter(Boolean)
    if (logs.length) t += ` The ${logs.join(' and ')} axis ${logs.length > 1 ? 'are' : 'is'} logarithmic.`
    const bars = [spec.yLower && spec.yUpper ? 'vertical' : '', spec.xLower && spec.xUpper ? 'horizontal' : ''].filter(Boolean)
    if (bars.length) t += ` Points carry ${bars.join(' and ')} error bars.`
    if (spec.order && spec.density !== 'hex') t += ` Points are joined by a line in the order of ${spec.order}.`
    if (jittered(spec)) t += ` Points are nudged slightly${spec.jitterAxis === 'x' ? ' sideways' : spec.jitterAxis === 'y' ? ' up and down' : ''} so that overlapping points show; their drawn positions are approximate, the values exact.`
    if (spec.trend === 'loess') t += ' A LOESS curve shows the local trend.'
    return t
  }
}
