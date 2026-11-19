import type { ChartCtx } from '../context.js'
import type { ChartDef } from '../registry.js'
import type { Mark } from '../scene.js'
import { bandScale, linearScale, niceLinear, type LinearScale } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis, type Axis } from '../cartesian.js'
import { detectXKind, distinct, observations, xKey, type XKind } from '../data.js'
import { toTime, formatTime, hasTimeOfDay } from '../util/time.js'
import { toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatPercent } from '../util/format.js'
import { areaPath, curvePath, decimate, runs, type Curve, type Pt } from './curve.js'
import { fmtList, formatter, lead } from './shared.js'

interface Pnt { xv: number | string; px: number; y: number | null; y0?: number; y1?: number }

function xValues(kind: XKind, raw: unknown[]): (number | string)[] {
  if (kind === 'category') return distinct(raw.map(xKey))
  const nums = raw.map(v => (kind === 'time' ? toTime(v) : toNumber(v))).filter((v): v is number => v !== null)
  return distinct(nums).sort((a, b) => a - b)
}

function compileSeries(c: ChartCtx, area: boolean): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const obs = observations(s.data, s.x, s.y, s.series)
  const kind = detectXKind(s.xType, obs.map(o => o.x))
  const keys = distinct(obs.map(o => o.s))
  const series = c.makeSeries(keys)
  const visible = keys.filter(k => !c.hidden.has(k))
  let xs = xValues(kind, obs.map(o => o.x))
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
  const xKeyOf = (raw: unknown): number | string | null => (kind === 'category' ? xKey(raw) : kind === 'time' ? toTime(raw) : toNumber(raw))

  // y by series by x (summing duplicates).
  const val = new Map<string, Map<number | string, number>>()
  for (const o of obs) {
    const k = xKeyOf(o.x)
    if (k === null || o.y === null) continue
    let row = val.get(o.s)
    if (!row) val.set(o.s, (row = new Map()))
    row.set(k, (row.get(k) ?? 0) + o.y)
  }

  // Stacking (areas only), over visible series in order.
  const lower = new Map<string, Map<number | string, number>>()
  const upper = new Map<string, Map<number | string, number>>()
  const totalAt = new Map<number | string, number>()
  if (stack !== 'none') {
    for (const x of xs) totalAt.set(x, visible.reduce((q, k) => q + Math.max(0, val.get(k)?.get(x) ?? 0), 0))
    const acc = new Map<number | string, number>()
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
    for (const k of visible) for (const [x, v] of val.get(k) ?? []) {
      if (!inX(x)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
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
  const yScale = override && (override[0] !== null || override[1] !== null)
    ? linearScale([override[0] ?? lo, override[1] ?? hi])
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
      d0 -= 1
      d1 += 1
    }
    const ls = linearScale([d0, d1], kind === 'time' ? 'time' : 'linear')
    xScale = ls
    xAxis = valueAxis(c, ls, { title: s.xLabel, vertical: false, format: 'auto', grid: false })
  }
  const yAxis = valueAxis(c, yScale, { title: s.yLabel, vertical: true, format: yfmt })

  const frame = c.frame({ series, autoSide: 'top' })
  const plot = layoutCartesian(c, frame, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)
  // Lines that run past a fixed range are cut at the plot's edge.
  const clipTo = xFixed || (override && (override[0] !== null || override[1] !== null)) ? 'plot' : undefined
  if (clipTo) c.clips.plot = `M${plot.x} ${plot.y}h${plot.w}v${plot.h}h${-plot.w}Z`

  const fmt = c.format
  const intraday = kind === 'time' && hasTimeOfDay(xs as number[])
  const xTitle = (x: number | string): string => (kind === 'time' ? formatTime(x as number, intraday ? 'datetime' : 'full', c.locale) : kind === 'linear' ? new Intl.NumberFormat(c.locale, { maximumFractionDigits: 4 }).format(x as number) : clip(String(x), 60))
  const px = (x: number | string): number => (xScale.at as (v: number | string) => number)(x)

  const marks: Mark[] = []
  const hits: Mark[] = []
  const draw = [...visible]
  // Areas: draw the first series first so later ones sit above.
  for (const k of draw) {
    const si = keys.indexOf(k)
    const color = series[si].color
    const pts: Pnt[] = xs.map(x => {
      const v = val.get(k)?.get(x)
      if (stack !== 'none') return { xv: x, px: px(x), y: yScale.at(upper.get(k)!.get(x) ?? 0), y0: yScale.at(lower.get(k)!.get(x) ?? 0), y1: yScale.at(upper.get(k)!.get(x) ?? 0) }
      return { xv: x, px: px(x), y: v === undefined ? null : yScale.at(v) }
    })
    const pr = runs(pts.map(p => ({ ...p, y: stack !== 'none' ? (p.y as number) : p.y })))
    for (const run of pr) {
      const top: Pt[] = decimate(run.map(p => [p.px, p.y as number] as Pt), plot.w)
      if (area) {
        const bottom: Pt[] = decimate(run.map(p => [p.px, stack !== 'none' ? p.y0! : yScale.at(Math.max(yScale.domain[0], Math.min(0, yScale.domain[1])))] as Pt), plot.w)
        marks.push({ type: 'path', role: 'data', series: k, d: areaPath(top, bottom, curve), fill: color, opacity: 0.16, anim: 'fade', ...(clipTo ? { clip: clipTo } : {}) })
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
    const rows = visible.flatMap(k => {
      const v = val.get(k)?.get(x)
      if (v === undefined) return []
      const sv = series[keys.indexOf(k)]
      const shown = stack === 'normalize' ? `${fmt(v)} (${formatPercent(totalAt.get(x) ? Math.max(0, v) / totalAt.get(x)! : 0, c.locale)})` : fmt(v)
      return [{ label: sv.label, value: shown, color: sv.color }]
    })
    if (!rows.length) return
    const focus = visible.flatMap(k => {
      const v = val.get(k)?.get(x)
      if (v === undefined) return []
      const y = stack !== 'none' ? yScale.at(upper.get(k)!.get(x) ?? 0) : yScale.at(v)
      return [{ x: cx[i], y, color: series[keys.indexOf(k)].color }]
    })
    hits.push({ type: 'rect', role: 'hit', x: left, y: plot.y, w: Math.max(1, right - left), h: plot.h, fill: 'transparent', tip: { title: xTitle(x), rows }, guide: { x1: cx[i], y1: plot.y, x2: cx[i], y2: plot.y + plot.h }, focus, aria: `${xTitle(x)}: ${rows.map(r => `${r.label} ${r.value}`).join(', ')}`, datum: { x } })
  })
  c.marks.push(...marks, ...hits)
  return { series }
}

function describeSeries(spec: Record<string, any>, env: { locale: string }, name: string): string {
  const obs = observations(spec.data, spec.x, spec.y, spec.series)
  const kind = detectXKind(spec.xType, obs.map(o => o.x))
  const keys = distinct(obs.map(o => o.s))
  const f = formatter(spec, env.locale)
  const xk = (r: unknown): number | string | null => (kind === 'category' ? xKey(r) : kind === 'time' ? toTime(r) : toNumber(r))
  const label = (x: number | string): string => (kind === 'time' ? formatTime(x as number, 'full', env.locale) : String(x))
  let t = `${lead(spec, name)} ${keys.length} ${keys.length === 1 ? 'series' : 'series'}${keys.length > 1 ? ` (${fmtList(keys)})` : ''} over ${kind === 'category' ? 'categories' : kind === 'time' ? 'time' : 'a numeric x axis'}.`
  for (const k of keys.slice(0, 4)) {
    const pts = obs.filter(o => o.s === k && o.y !== null && xk(o.x) !== null).map(o => ({ x: xk(o.x)!, y: o.y! }))
    if (kind !== 'category') pts.sort((a, b) => (a.x as number) - (b.x as number))
    if (!pts.length) continue
    const first = pts[0]
    const last = pts[pts.length - 1]
    const max = pts.reduce((a, b) => (b.y > a.y ? b : a))
    const min = pts.reduce((a, b) => (b.y < a.y ? b : a))
    const change = first.y !== 0 ? ` (${(((last.y - first.y) / Math.abs(first.y)) * 100).toFixed(1)}%)` : ''
    t += ` ${clip(k, 40)}: from ${f(first.y)} at ${label(first.x)} to ${f(last.y)} at ${label(last.x)}${pts.length > 1 ? change : ''}; peak ${f(max.y)} at ${label(max.x)}, low ${f(min.y)} at ${label(min.x)}.`
  }
  return t
}

const SERIES_FIELDS: ChartDef['fields'] = {
  x: { kind: 'column', role: 'x', required: true, desc: 'Column for the horizontal position: numbers, dates (ISO 8601 strings or timestamps) or category names. The kind is detected; override with `xType`.' },
  y: { kind: 'columns', role: 'number', required: true, desc: 'Numeric column to plot. Several columns give one line per column (wide-form data).' },
  series: { kind: 'column', role: 'any', desc: 'Column that splits the data into one line per value (long-form data).' },
  xType: { kind: 'enum', values: ['auto', 'category', 'linear', 'time'], default: 'auto', desc: 'How to read `x`. `auto` detects numbers, ISO dates and categories.' },
  xDomain: { kind: 'domain', desc: 'Fix the horizontal range of a numeric or time x axis (dates as ISO strings). Lines run to the edge and are cut there.' },
  yDomain: { kind: 'domain', desc: 'Fix the vertical range, e.g. [0, 100]. Lines may start anywhere; areas always include 0.' },
  curve: { kind: 'enum', values: ['linear', 'smooth', 'step'], default: 'linear', desc: '`smooth` is monotone (never overshoots the data); `step` holds each value until the next point.' }
}

const seriesCheck: NonNullable<ChartDef['check']> = (spec, ctx) => {
  if (Array.isArray(spec.y) && spec.y.length > 1 && spec.series) {
    ctx.issues.push({ severity: 'warning', code: 'series_ignored', path: 'series', message: '`series` is ignored when `y` lists several columns.' })
  }
}

export const line: ChartDef = {
  type: 'line',
  name: 'Line chart',
  summary: 'Shows how one or more numbers change along an ordered x axis, usually time.',
  useWhen: 'Trends over time or any ordered numeric x, up to ~8 series. Use area for cumulative or part-to-whole over time, bar for comparing separate categories, scatter when both axes are measurements. For prices (OHLC, indicators, drawings) use Super Chart.',
  cartesian: true,
  fields: {
    ...SERIES_FIELDS,
    points: { kind: 'boolean', desc: 'Force markers on (`true`) or off (`false`). Default: markers when there are few points, otherwise only the last point.' }
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
  check: seriesCheck,
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
    stack: { kind: 'enum', values: ['none', 'stack', 'normalize'], default: 'none', desc: '`stack` adds series on top of each other; `normalize` shows each series as a share of 100%.' }
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
  check: seriesCheck,
  compile: c => compileSeries(c, true),
  describe: (spec, env) => describeSeries(spec, env, spec.stack === 'normalize' ? 'Stacked area chart (100%)' : spec.stack === 'stack' ? 'Stacked area chart' : 'Area chart')
}
