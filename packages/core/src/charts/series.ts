// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartCtx } from '../context.js'
import type { ChartDef } from '../registry.js'
import type { Mark, Tip } from '../scene.js'
import { bandScale, linearScale, logScale, niceLinear, niceLog, type LinearScale } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis, warnZoneDates, type Axis } from '../cartesian.js'
import { detectXKind, distinct, observations, xKey, type XKind } from '../data.js'
import { toTime, formatTime, hasTimeOfDay } from '../util/time.js'
import { toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatPercent } from '../util/format.js'
import { areaPath, curvePath, decimate, runs, type Curve, type Pt } from './curve.js'
import { fmtList, formatter, lead } from './shared.js'
import { intervalCheck, intervalFields, intervalText, logDomain, logNonPositive, refuseLog, scaleField, zeroBaselineScale } from './extras.js'

interface Pnt { xv: number | string; px: number; y: number | null; y0?: number; y1?: number }

function xValues(kind: XKind, raw: unknown[], logX = false): (number | string)[] {
  if (kind === 'category') return distinct(raw.map(xKey))
  const nums = raw.map(v => (kind === 'time' ? toTime(v) : toNumber(v))).filter((v): v is number => v !== null && (!logX || v > 0))
  return distinct(nums).sort((a, b) => a - b)
}

/** Shaded intervals behind lines: only with one `y` column, and not on stacked areas (validation warns). */
const hasBand = (s: Record<string, any>): boolean => !!s.yLower && !!s.yUpper && !(Array.isArray(s.y) && s.y.length > 1) && (s.stack ?? 'none') === 'none'

function compileSeries(c: ChartCtx, area: boolean): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const obs = observations(s.data, s.x, s.y, s.series)
  const kind = detectXKind(s.xType, obs.map(o => o.x))
  const keys = distinct(obs.map(o => o.s))
  const series = c.makeSeries(keys)
  const visible = keys.filter(k => !c.hidden.has(k))
  const logY = !area && s.yScale === 'log'
  const logX = !area && s.xScale === 'log' && kind === 'linear'
  const band = hasBand(s)
  const gaps = (s.gaps ?? 'break') as 'break' | 'connect' | 'zero'
  let xs = xValues(kind, obs.map(o => o.x), logX)
  // A fixed (or zoomed) x range: keep the points inside plus one neighbour each side, so lines run to the edge.
  const xd = kind !== 'category' ? (s.xDomain as [number | null, number | null] | undefined) : undefined
  const xFixed = !!xd && (xd[0] !== null || xd[1] !== null)
  if (xFixed && xs.length) {
    const nums = xs as number[]
    const lo = xd![0] ?? nums[0]
    const hi = xd![1] ?? nums[nums.length - 1]
    let a = nums.findIndex(v => v >= lo)
    if (a < 0) a = nums.length
    let b = nums.length - 1
    while (b >= 0 && nums[b] > hi) b--
    xs = nums.slice(Math.max(0, a - 1), Math.min(nums.length, b + 2))
  }
  const stack = area ? ((s.stack ?? 'none') as string) : 'none'
  const curve = (s.curve ?? 'linear') as Curve
  const xKeyOf = (raw: unknown): number | string | null => {
    const k = kind === 'category' ? xKey(raw) : kind === 'time' ? toTime(raw) : toNumber(raw)
    return logX && typeof k === 'number' && !(k > 0) ? null : k
  }

  // y by series by x (summing duplicates). On a log axis, values at or below zero are left out (validation warns).
  const val = new Map<string, Map<number | string, number>>()
  // The interval behind each value, summed like the values.
  const lowV = new Map<string, Map<number | string, number>>()
  const highV = new Map<string, Map<number | string, number>>()
  const addTo = (m: Map<string, Map<number | string, number>>, sk: string, k: number | string, v: number): void => {
    let row = m.get(sk)
    if (!row) m.set(sk, (row = new Map()))
    row.set(k, (row.get(k) ?? 0) + v)
  }
  for (const o of obs) {
    const k = xKeyOf(o.x)
    if (k === null || o.y === null || (logY && !(o.y > 0))) continue
    addTo(val, o.s, k, o.y)
    if (band) {
      const a = toNumber(o.row[s.yLower])
      const b = toNumber(o.row[s.yUpper])
      if (a !== null && b !== null) {
        addTo(lowV, o.s, k, Math.min(a, b))
        addTo(highV, o.s, k, Math.max(a, b))
      }
    }
  }
  // `gaps: "zero"` draws a missing value as 0 (stacked areas always do).
  const valueAt = (k: string, x: number | string): number | undefined => val.get(k)?.get(x) ?? (gaps === 'zero' && !logY ? 0 : undefined)

  // Stacking (areas only), over visible series in order.
  const lower = new Map<string, Map<number | string, number>>()
  const upper = new Map<string, Map<number | string, number>>()
  const totalAt = new Map<number | string, number>()
  if (stack !== 'none') {
    for (const x of xs) totalAt.set(x, visible.reduce((q, k) => q + Math.max(0, val.get(k)?.get(x) ?? 0), 0))
    // A stream graph starts each x at minus half its total, so the layers sit centred on the middle line.
    const acc = new Map<number | string, number>(stack === 'center' ? xs.map(x => [x, -(totalAt.get(x) ?? 0) / 2]) : [])
    for (const k of visible) {
      const lo = new Map<number | string, number>()
      const up = new Map<number | string, number>()
      for (const x of xs) {
        const a = acc.get(x) ?? 0
        const raw = Math.max(0, val.get(k)?.get(x) ?? 0)
        const v = stack === 'normalize' ? (totalAt.get(x) ? raw / totalAt.get(x)! : 0) : raw
        lo.set(x, a)
        up.set(x, a + v)
        acc.set(x, a + v)
      }
      lower.set(k, lo)
      upper.set(k, up)
    }
  }

  // y extent (inside the x range when it is fixed).
  let lo = Infinity
  let hi = -Infinity
  const inX = (x: number | string): boolean => !xFixed || ((xd![0] === null || (x as number) >= xd![0]) && (xd![1] === null || (x as number) <= xd![1]))
  if (stack === 'none') {
    for (const k of visible) for (const m of [val, ...(band ? [lowV, highV] : [])]) for (const [x, v] of m.get(k) ?? []) {
      if (!inX(x) || (logY && !(v > 0))) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (gaps === 'zero' && !logY && visible.some(k => xs.some(x => inX(x) && val.get(k)?.get(x) === undefined))) {
      lo = Math.min(lo, 0)
      hi = Math.max(hi, 0)
    }
  } else if (stack === 'center') {
    hi = Math.max(0, ...[...totalAt.entries()].filter(([x]) => inX(x)).map(([, v]) => v / 2))
    lo = -hi
    if (hi === 0) {
      lo = -0.5
      hi = 0.5
    }
  } else {
    lo = 0
    hi = stack === 'normalize' ? 1 : Math.max(0, ...[...upper.values()].flatMap(m => [...m.values()]))
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  const override = s.yDomain as [number | null, number | null] | undefined
  const fixedY = !!override && (override[0] !== null || override[1] !== null)
  const yScale = logY
    ? (fixedY ? logScale([override![0] ?? (lo > 0 ? lo : 1), override![1] ?? (hi > 0 ? hi : 10)]) : niceLog(lo > 0 ? lo : 1, hi > 0 ? hi : 10))
    : fixedY
      ? linearScale([override![0] ?? lo, override![1] ?? hi])
      : stack === 'center'
        ? linearScale([lo, hi])
        : niceLinear(lo, hi, { zero: area || (lo >= 0 && lo < hi * 0.5) })
  const yfmt = stack === 'normalize' ? 'percent' : s.format

  // x scale.
  let xScale: LinearScale | ReturnType<typeof bandScale>
  let xAxis: Axis
  if (kind === 'category') {
    const bs = bandScale(xs as string[], 0)
    xScale = bs
    xAxis = bandAxis(bs, Object.fromEntries((xs as string[]).map(k => [k, clip(k, 60)])), s.xLabel, c.locale)
  } else {
    const nums = xs as number[]
    let d0 = xFixed && xd![0] !== null ? xd![0] : nums[0] ?? 0
    let d1 = xFixed && xd![1] !== null ? xd![1] : nums[nums.length - 1] ?? 1
    if (d0 === d1) {
      d0 = logX ? d0 / 10 : d0 - 1
      d1 = logX ? d1 * 10 : d1 + 1
    }
    const ls = logX ? logScale([d0, d1]) : linearScale([d0, d1], kind === 'time' ? 'time' : 'linear')
    xScale = ls
    xAxis = valueAxis(c, ls, { title: s.xLabel, vertical: false, format: 'auto', grid: false })
  }
  // A stream graph's vertical position has no zero: the middle is half of each total. Tick values would read as
  // amounts that do not exist, so the axis shows no ticks or gridlines; the tooltip gives each value and the total.
  const yAxis: Axis = stack === 'center' ? { scale: yScale, title: s.yLabel, grid: false, ticks: () => [] } : valueAxis(c, yScale, { title: s.yLabel, vertical: true, format: yfmt })

  const frame = c.frame({ series, autoSide: 'top' })
  const plot = layoutCartesian(c, frame, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)
  // Lines that run past a fixed range are cut at the plot's edge.
  const clipTo = xFixed || (override && (override[0] !== null || override[1] !== null)) ? 'plot' : undefined
  if (clipTo) c.clips.plot = `M${plot.x} ${plot.y}h${plot.w}v${plot.h}h${-plot.w}Z`

  const fmt = c.format
  if (kind === 'time') warnZoneDates(c, xs as number[], 'x')
  const intraday = kind === 'time' && hasTimeOfDay(xs as number[], c.timeZone)
  const xTitle = (x: number | string): string => (kind === 'time' ? formatTime(x as number, intraday ? 'datetime' : 'full', c.locale, c.timeZone) : kind === 'linear' ? new Intl.NumberFormat(c.locale, { maximumFractionDigits: 4 }).format(x as number) : clip(String(x), 60))
  const px = (x: number | string): number => (xScale.at as (v: number | string) => number)(x)

  const marks: Mark[] = []
  const bands: Mark[] = []
  const hits: Mark[] = []
  const draw = [...visible]
  const yMin = yScale.domain[0]
  // Lines break at a missing value, unless `gaps: "connect"` joins over it.
  const split = <T extends { y: number | null }>(pts: T[]): T[][] => (gaps === 'connect' ? [pts.filter(p => p.y !== null)].filter(r => r.length) : runs(pts))
  // Areas: draw the first series first so later ones sit above.
  for (const k of draw) {
    const si = keys.indexOf(k)
    const color = series[si].color
    if (band) {
      const bp = xs.map(x => {
        const a = lowV.get(k)?.get(x)
        const b = highV.get(k)?.get(x)
        return { px: px(x), y: a === undefined || b === undefined ? null : yScale.at(Math.max(a, logY ? yMin : -Infinity)), y1: b === undefined ? 0 : yScale.at(b) }
      })
      for (const run of split(bp)) {
        const top: Pt[] = decimate(run.map(p => [p.px, p.y1] as Pt), plot.w)
        const bottom: Pt[] = decimate(run.map(p => [p.px, p.y as number] as Pt), plot.w)
        bands.push({ type: 'path', role: 'data', series: k, d: run.length > 1 ? areaPath(top, bottom, curve) : `M${Math.round(run[0].px * 100) / 100} ${Math.round(run[0].y1 * 100) / 100}V${Math.round((run[0].y as number) * 100) / 100}`, fill: color, stroke: run.length > 1 ? undefined : color, strokeWidth: run.length > 1 ? undefined : 2, opacity: 0.14, anim: 'fade', ...(clipTo ? { clip: clipTo } : {}) })
      }
    }
    const pts: Pnt[] = xs.map(x => {
      const v = valueAt(k, x)
      if (stack !== 'none') return { xv: x, px: px(x), y: yScale.at(upper.get(k)!.get(x) ?? 0), y0: yScale.at(lower.get(k)!.get(x) ?? 0), y1: yScale.at(upper.get(k)!.get(x) ?? 0) }
      return { xv: x, px: px(x), y: v === undefined ? null : yScale.at(v) }
    })
    const pr = stack !== 'none' ? runs(pts) : split(pts)
    for (const run of pr) {
      const top: Pt[] = decimate(run.map(p => [p.px, p.y as number] as Pt), plot.w)
      if (area) {
        const bottom: Pt[] = decimate(run.map(p => [p.px, stack !== 'none' ? p.y0! : yScale.at(Math.max(yScale.domain[0], Math.min(0, yScale.domain[1])))] as Pt), plot.w)
        marks.push({ type: 'path', role: 'data', series: k, d: areaPath(top, bottom, curve), fill: color, opacity: 0.16, anim: 'fade', ...(clipTo ? { clip: clipTo } : {}) })
        // A stream graph's lowest layer floats too: outline its lower edge as well, or the shape reads lopsided.
        if (stack === 'center' && k === draw[0]) marks.push({ type: 'path', role: 'data', series: k, d: curvePath(bottom, curve), stroke: color, strokeWidth: c.theme.lineWidth, anim: 'draw', ...(clipTo ? { clip: clipTo } : {}) })
      }
      marks.push({ type: 'path', role: 'data', series: k, d: curvePath(top, curve), stroke: color, strokeWidth: c.theme.lineWidth, anim: 'draw', ...(clipTo ? { clip: clipTo } : {}) })
    }
    // Markers: every point when sparse, otherwise only the last one.
    const real = pts.filter(p => p.y !== null) as (Pnt & { y: number })[]
    const dense = real.length > 40 || (s.points === false)
    const show = s.points === true || (!dense && s.points !== false && !area) ? real : real.length && !area && s.points !== false ? [real[real.length - 1]] : []
    for (const p of show) {
      if (p.px < plot.x - 0.5 || p.px > plot.x + plot.w + 0.5 || p.y < plot.y - 0.5 || p.y > plot.y + plot.h + 0.5) continue
      marks.push({ type: 'circle', role: 'data', series: k, cx: p.px, cy: p.y, r: 4, fill: color, stroke: c.c('background'), strokeWidth: 2, anim: 'fade' })
    }
  }

  // Shared tooltip + crosshair, one hit strip per x (thinned to about 400 strips on dense data).
  const cx = xs.map(px)
  const inside: number[] = []
  for (let i = 0; i < xs.length; i++) if (cx[i] >= plot.x - 0.5 && cx[i] <= plot.x + plot.w + 0.5) inside.push(i)
  const stride = Math.max(1, Math.ceil(inside.length / 400))
  const anchors: number[] = []
  for (let i = 0; i < inside.length; i += stride) anchors.push(inside[i])
  anchors.forEach((i, ai) => {
    const x = xs[i]
    const left = ai === 0 ? plot.x : (cx[anchors[ai - 1]] + cx[i]) / 2
    const right = ai === anchors.length - 1 ? plot.x + plot.w : (cx[i] + cx[anchors[ai + 1]]) / 2
    const rows: Tip['rows'] = visible.flatMap(k => {
      const v = val.get(k)?.get(x)
      const sv = series[keys.indexOf(k)]
      if (v === undefined) return stack === 'none' && gaps === 'zero' && !logY && val.has(k) ? [{ label: sv.label, value: c.t('missing', { value: fmt(0) }), color: sv.color }] : []
      const a = lowV.get(k)?.get(x)
      const b = highV.get(k)?.get(x)
      const shown = stack === 'normalize' ? `${fmt(v)} (${formatPercent(totalAt.get(x) ? Math.max(0, v) / totalAt.get(x)! : 0, c.locale)})` : a !== undefined && b !== undefined ? `${fmt(v)} (${intervalText(fmt, a, b)})` : fmt(v)
      return [{ label: sv.label, value: shown, color: sv.color }]
    })
    if (!rows.length) return
    if (stack === 'center' && rows.length > 1) rows.push({ label: c.t('total'), value: fmt(totalAt.get(x) ?? 0) })
    const focus = visible.flatMap(k => {
      const v = stack === 'none' ? valueAt(k, x) : val.get(k)?.get(x)
      if (v === undefined) return []
      const y = stack !== 'none' ? yScale.at(upper.get(k)!.get(x) ?? 0) : yScale.at(v)
      return [{ x: cx[i], y, color: series[keys.indexOf(k)].color }]
    })
    hits.push({ type: 'rect', role: 'hit', x: left, y: plot.y, w: Math.max(1, right - left), h: plot.h, fill: 'transparent', tip: { title: xTitle(x), rows }, guide: { x1: cx[i], y1: plot.y, x2: cx[i], y2: plot.y + plot.h }, focus, aria: `${xTitle(x)}: ${rows.map(r => `${r.label} ${r.value}`).join(', ')}`, datum: { x } })
  })
  c.marks.push(...bands, ...marks, ...hits)
  return { series }
}

function describeSeries(spec: Record<string, any>, env: { locale: string; timeZone?: string }, name: string): string {
  const obs = observations(spec.data, spec.x, spec.y, spec.series)
  const kind = detectXKind(spec.xType, obs.map(o => o.x))
  const keys = distinct(obs.map(o => o.s))
  const f = formatter(spec, env.locale)
  const xk = (r: unknown): number | string | null => (kind === 'category' ? xKey(r) : kind === 'time' ? toTime(r) : toNumber(r))
  const label = (x: number | string): string => (kind === 'time' ? formatTime(x as number, 'full', env.locale, env.timeZone) : String(x))
  let t = `${lead(spec, name)} ${keys.length} ${keys.length === 1 ? 'series' : 'series'}${keys.length > 1 ? ` (${fmtList(keys)})` : ''} over ${kind === 'category' ? 'categories' : kind === 'time' ? 'time' : 'a numeric x axis'}.`
  for (const k of keys.slice(0, 4)) {
    const pts = obs.filter(o => o.s === k && o.y !== null && xk(o.x) !== null && (spec.yScale !== 'log' || o.y > 0) && (spec.xScale !== 'log' || kind !== 'linear' || (xk(o.x) as number) > 0)).map(o => ({ x: xk(o.x)!, y: o.y! }))
    if (kind !== 'category') pts.sort((a, b) => (a.x as number) - (b.x as number))
    if (!pts.length) continue
    const first = pts[0]
    const last = pts[pts.length - 1]
    const max = pts.reduce((a, b) => (b.y > a.y ? b : a))
    const min = pts.reduce((a, b) => (b.y < a.y ? b : a))
    const change = first.y !== 0 ? ` (${(((last.y - first.y) / Math.abs(first.y)) * 100).toFixed(1)}%)` : ''
    t += ` ${clip(k, 40)}: from ${f(first.y)} at ${label(first.x)} to ${f(last.y)} at ${label(last.x)}${pts.length > 1 ? change : ''}; peak ${f(max.y)} at ${label(max.x)}, low ${f(min.y)} at ${label(min.x)}.`
  }
  return t + seriesNotes(spec)
}

const SERIES_FIELDS: ChartDef['fields'] = {
  x: { kind: 'column', role: 'x', required: true, desc: 'Column for the horizontal position: numbers, dates (ISO 8601 strings or timestamps) or category names. The kind is detected; override with `xType`.' },
  y: { kind: 'columns', role: 'number', required: true, desc: 'Numeric column to plot. Several columns give one line per column (wide-form data).' },
  series: { kind: 'column', role: 'any', desc: 'Column that splits the data into one line per value (long-form data).' },
  xType: { kind: 'enum', values: ['auto', 'category', 'linear', 'time'], default: 'auto', desc: 'How to read `x`. `auto` detects numbers, ISO dates and categories.' },
  xDomain: { kind: 'domain', desc: 'Fix the horizontal range of a numeric or time x axis (dates as ISO strings). Lines run to the edge and are cut there.' },
  yDomain: { kind: 'domain', desc: 'Fix the vertical range, e.g. [0, 100]. Lines may start anywhere; areas always include 0.' },
  curve: { kind: 'enum', values: ['linear', 'smooth', 'step'], default: 'linear', desc: '`smooth` is monotone (never overshoots the data); `step` holds each value until the next point.' },
  gaps: { kind: 'enum', values: ['break', 'connect', 'zero'], desc: 'Default break. What a missing or null y does: `break` leaves a gap in the line, `connect` joins the points on either side, `zero` draws it as 0 (the tooltip says "missing"). Stacked areas always count a missing value as 0.' },
  ...intervalFields('y', 'a shaded band behind each line (one band per series; with long-form `series`, not with several `y` columns)')
}

const seriesCheck = (area: boolean): NonNullable<ChartDef['check']> => (spec, ctx) => {
  const multi = Array.isArray(spec.y) && spec.y.length > 1
  if (multi && spec.series) {
    ctx.issues.push({ severity: 'warning', code: 'series_ignored', path: 'series', message: '`series` is ignored when `y` lists several columns.' })
  }
  if (intervalCheck(spec, ctx, 'y')) {
    if (multi) ctx.issues.push({ severity: 'warning', code: 'interval_needs_one_y', path: 'yLower', message: 'yLower and yUpper describe one column; with several `y` columns no band is drawn.', hint: 'Fold the columns into long form (a `fold` step) and use `series`, with one lower and one upper column.' })
    else if (spec.stack === 'stack' || spec.stack === 'normalize' || spec.stack === 'center') ctx.issues.push({ severity: 'warning', code: 'interval_ignored_stacked', path: 'yLower', message: 'An interval cannot be shown on a stacked area (the band would sit on the series below); no band is drawn.', hint: 'Set stack to "none", or use a line chart.' })
  }
  if (area) {
    refuseLog(spec, ctx, 'yScale', 'an area is filled down to zero, which a log axis cannot show.', 'Use a line chart for values spanning several orders of magnitude.')
    return
  }
  const ys = (Array.isArray(spec.y) ? spec.y : [spec.y]) as string[]
  if (spec.yScale === 'log') {
    logNonPositive(ctx.rows, ys, 'y', ctx)
    logDomain(spec, ctx, 'yScale', 'yDomain')
    if (spec.gaps === 'zero') ctx.issues.push({ severity: 'warning', code: 'gaps_zero_log', path: 'gaps', message: 'A log axis has no zero, so missing values break the line instead.' })
  }
  if (spec.xScale === 'log') {
    const kind = detectXKind(spec.xType as string | undefined, ctx.rows.map(r => r[spec.x as string]))
    if (kind !== 'linear') refuseLog(spec, ctx, 'xScale', `x reads as ${kind === 'time' ? 'dates' : 'categories'}; a log axis needs numbers.`, 'Use a numeric x column (set xType to "linear" if the numbers are stored as text), or drop xScale.')
    else {
      logNonPositive(ctx.rows, [spec.x as string], 'x', ctx)
      logDomain(spec, ctx, 'xScale', 'xDomain')
    }
  }
}

/** One sentence on log axes and bands, for the description. */
function seriesNotes(spec: Record<string, any>): string {
  let t = ''
  const axes = [spec.yScale === 'log' && spec.type === 'line' ? 'y' : '', spec.xScale === 'log' && spec.type === 'line' ? 'x' : ''].filter(Boolean)
  if (axes.length) t += ` The ${axes.join(' and ')} axis ${axes.length > 1 ? 'are' : 'is'} logarithmic.`
  if (hasBand(spec) && spec.yLower) t += ` A shaded band shows ${clip(String(spec.yLower), 40)} to ${clip(String(spec.yUpper), 40)}.`
  return t
}

export const line: ChartDef = {
  type: 'line',
  name: 'Line chart',
  summary: 'Shows how one or more numbers change along an ordered x axis, usually time.',
  useWhen: 'Trends over time or any ordered numeric x, up to ~8 series. Use area for cumulative or part-to-whole over time, bar for comparing separate categories, scatter when both axes are measurements. For prices (OHLC, indicators, drawings) use Super Chart.',
  cartesian: true,
  fields: {
    ...SERIES_FIELDS,
    points: { kind: 'boolean', desc: 'Force markers on (`true`) or off (`false`). Default: markers when there are few points, otherwise only the last point.' },
    yScale: scaleField('y', 'growth, orders of magnitude'),
    xScale: { ...scaleField('x', 'sizes, frequencies'), desc: `${scaleField('x', 'sizes, frequencies').desc} Only for a numeric x; dates and categories are refused.` }
  },
  example: {
    type: 'line',
    title: 'Weekly active users',
    subtitle: 'Thousands, last 12 weeks',
    x: 'week',
    y: ['Web', 'Mobile'],
    yLabel: 'Users (k)',
    annotations: [{ axis: 'y', value: 150, label: 'Target', tone: 'info' }],
    data: [
      { week: '2026-08-31', Web: 92, Mobile: 61 }, { week: '2026-09-07', Web: 95, Mobile: 68 },
      { week: '2026-09-14', Web: 99, Mobile: 74 }, { week: '2026-09-21', Web: 97, Mobile: 83 },
      { week: '2026-09-28', Web: 104, Mobile: 90 }, { week: '2026-10-05', Web: 110, Mobile: 97 },
      { week: '2026-10-12', Web: 108, Mobile: 109 }, { week: '2026-10-19', Web: 116, Mobile: 118 },
      { week: '2026-10-26', Web: 121, Mobile: 127 }, { week: '2026-11-02', Web: 119, Mobile: 139 },
      { week: '2026-11-09', Web: 127, Mobile: 148 }, { week: '2026-11-16', Web: 131, Mobile: 158 }
    ]
  },
  check: seriesCheck(false),
  compile: c => compileSeries(c, false),
  describe: (spec, env) => describeSeries(spec, env, 'Line chart')
}

export const areaChart: ChartDef = {
  type: 'area',
  name: 'Area chart',
  summary: 'A line chart with the area under it filled; stacked areas show how parts add up over time.',
  useWhen: 'Volume or cumulative quantity over time, and composition over time (`stack: "stack"` or `"normalize"`). Avoid overlapping unstacked areas for more than 2 series; use lines instead.',
  cartesian: true,
  fields: {
    ...SERIES_FIELDS,
    stack: { kind: 'enum', values: ['none', 'stack', 'normalize', 'center'], default: 'none', desc: '`stack` adds series on top of each other; `normalize` shows each series as a share of 100%; `center` is a stream graph: the stack is centred on a middle line (each x starts at minus half its total), so the outline shows how the total and its parts flow over time. A centred stack has no zero, so its value axis shows no ticks; the tooltip gives every value and the total.' },
    yScale: zeroBaselineScale('An area')
  },
  example: {
    type: 'area',
    title: 'Energy mix',
    subtitle: 'Annual generation by source',
    x: 'year',
    y: ['Solar', 'Wind', 'Hydro', 'Gas'],
    stack: 'stack',
    curve: 'smooth',
    xType: 'linear',
    yLabel: 'Generation (TWh)',
    data: [
      { year: 2018, Solar: 12, Wind: 30, Hydro: 40, Gas: 60 }, { year: 2019, Solar: 16, Wind: 36, Hydro: 41, Gas: 57 },
      { year: 2020, Solar: 24, Wind: 41, Hydro: 39, Gas: 52 }, { year: 2021, Solar: 33, Wind: 47, Hydro: 42, Gas: 49 },
      { year: 2022, Solar: 47, Wind: 52, Hydro: 38, Gas: 46 }, { year: 2023, Solar: 63, Wind: 60, Hydro: 40, Gas: 41 },
      { year: 2024, Solar: 82, Wind: 68, Hydro: 43, Gas: 36 }, { year: 2025, Solar: 104, Wind: 75, Hydro: 41, Gas: 31 }
    ]
  },
  check: seriesCheck(true),
  compile: c => compileSeries(c, true),
  describe: (spec, env) => describeSeries(spec, env, spec.stack === 'normalize' ? 'Stacked area chart (100%)' : spec.stack === 'stack' ? 'Stacked area chart' : spec.stack === 'center' ? 'Stream graph' : 'Area chart') + (spec.stack === 'center' ? ' The layers are stacked around a centre line, so the vertical axis has no zero; the thickness of each layer is its value.' : '')
}
