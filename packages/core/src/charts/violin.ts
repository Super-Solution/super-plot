import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark } from '../scene.js'
import { bandScale, linearScale, niceLinear } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { distinct } from '../data.js'
import { quantile, r2 } from '../util/num.js'
import { clip } from '../util/text.js'
import { boxStats, checkPoints, groups, pointMarks, pointsMode } from './box.js'
import { formatter, lead, fmtList } from './shared.js'

/**
 * How many points a density is evaluated at, evenly spaced from the smallest to the largest value, both ends
 * included: at least 64, more when the bandwidth is narrow for the range so that no peak falls between two
 * points (at least two points per bandwidth), at most 512.
 */
export const DENSITY_POINTS = 64
export const MAX_DENSITY_POINTS = 512

/** The grid size {@link kde} uses by default: clamp(ceil(2 * (max - min) / h) + 1, 64, 512). */
export const densityPoints = (range: number, h: number): number => (h > 0 ? Math.min(MAX_DENSITY_POINTS, Math.max(DENSITY_POINTS, Math.ceil((2 * range) / h) + 1)) : DENSITY_POINTS)

export interface Density {
  /** Kernel bandwidth used, in data units (0 when every value is the same). */
  bandwidth: number
  /** Where the density was evaluated, ascending. */
  grid: number[]
  /** Estimated density at each grid point. */
  density: number[]
}

/**
 * Silverman's rule of thumb for a Gaussian kernel: h = 0.9 * min(sd, IQR / 1.34) * n^(-1/5), where sd is the
 * sample standard deviation (divisor n - 1) and IQR = Q3 - Q1 with the type-7 quantile of `quantile` (the box
 * plot's). When that minimum is 0 (more than half the values equal) the non-zero one of sd and IQR / 1.34 is
 * used; with fewer than 2 values or no spread at all it is 0. `values` need not be sorted.
 */
export function silverman(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const v = [...values].sort((a, b) => a - b)
  let m = 0
  for (const x of v) m += x
  m /= n
  let ss = 0
  for (const x of v) ss += (x - m) ** 2
  const sd = Math.sqrt(ss / (n - 1))
  const iqr = (quantile(v, 0.75) - quantile(v, 0.25)) / 1.34
  const a = Math.min(sd, iqr) > 0 ? Math.min(sd, iqr) : Math.max(sd, iqr)
  return 0.9 * a * n ** -0.2
}

/**
 * Gaussian kernel density estimate, for violins (and any port that wants the same numbers):
 *   f(t) = 1 / (n h) * sum_i exp(-((t - x_i) / h)^2 / 2) / sqrt(2 pi)
 * evaluated at `points` grid values t_k = min + (max - min) * k / (points - 1), k = 0 .. points - 1, so the
 * estimate never reaches past the observed range. `h` is `bandwidth` when given (> 0), else {@link silverman};
 * `points` defaults to {@link densityPoints}.
 * When all values are equal (or `h` is 0) there is no density: the grid is that one value and the density [1]
 * marks a point mass. Null for no values.
 */
export function kde(values: number[], bandwidth?: number, points?: number): Density | null {
  const n = values.length
  if (!n) return null
  let lo = Infinity
  let hi = -Infinity
  for (const x of values) {
    if (x < lo) lo = x
    if (x > hi) hi = x
  }
  const h = bandwidth !== undefined && bandwidth > 0 ? bandwidth : silverman(values)
  if (hi === lo || !(h > 0)) return { bandwidth: h > 0 ? h : 0, grid: [lo], density: [1] }
  const k = Math.max(2, Math.floor(points ?? densityPoints(hi - lo, h)))
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI))
  const grid: number[] = []
  const density: number[] = []
  for (let i = 0; i < k; i++) {
    const t = lo + ((hi - lo) * i) / (k - 1)
    let sum = 0
    for (const x of values) {
      const u = (t - x) / h
      sum += Math.exp(-0.5 * u * u)
    }
    grid.push(t)
    density.push(sum * norm)
  }
  return { bandwidth: h, grid, density }
}

/** Density at `v`, linearly interpolated between grid points. */
function densityAt(d: Density, v: number): number {
  const { grid, density } = d
  if (grid.length === 1) return density[0]
  if (v <= grid[0]) return density[0]
  if (v >= grid[grid.length - 1]) return density[density.length - 1]
  const step = (grid[grid.length - 1] - grid[0]) / (grid.length - 1)
  const i = Math.min(grid.length - 2, Math.floor((v - grid[0]) / step))
  const t = (v - grid[i]) / step
  return density[i] + t * (density[i + 1] - density[i])
}

const peak = (d: Density): number => Math.max(...d.density)

/**
 * Grid values where the density has a local maximum of at least a quarter of its highest value (an end of the
 * grid counts when it is above its one neighbour), in ascending order. What the description calls the peaks.
 */
export function densityPeaks(d: Density): number[] {
  const { grid, density: y } = d
  if (grid.length === 1) return [grid[0]]
  const top = peak(d)
  const out: number[] = []
  for (let i = 0; i < y.length; i++) {
    const left = i === 0 ? -Infinity : y[i - 1]
    const right = i === y.length - 1 ? -Infinity : y[i + 1]
    if (y[i] > left && y[i] >= right && y[i] >= top * 0.25) out.push(grid[i])
  }
  return out.length ? out : [grid[y.indexOf(top)]]
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const g = groups(s)
  const keys = [...g.keys()]
  const stats = new Map(keys.map(k => [k, boxStats(g.get(k)!)!]))
  const dens = new Map(keys.map(k => [k, kde(g.get(k)!, s.bandwidth)!]))
  const horizontal = s.orientation === 'horizontal'
  if (horizontal) c.axisFields = { x: s.y, y: s.x }
  const mode = pointsMode(s, 'none')
  let lo = Infinity
  let hi = -Infinity
  for (const st of stats.values()) {
    lo = Math.min(lo, st.min)
    hi = Math.max(hi, st.max)
  }
  const override = s.yDomain as [number | null, number | null] | undefined
  const vScale = override && (override[0] !== null || override[1] !== null) ? linearScale([override[0] ?? lo, override[1] ?? hi]) : niceLinear(lo, hi)
  const cats = bandScale(keys, 0.2)
  const frame = c.frame({ series: [] })
  const vAxis = valueAxis(c, vScale, { title: horizontal ? s.xLabel ?? String(s.y) : s.yLabel ?? String(s.y), vertical: !horizontal, format: s.format })
  const cAxis = bandAxis(cats, Object.fromEntries(keys.map(k => [k, clip(k, 60)])), horizontal ? s.yLabel : s.xLabel, c.locale)
  const plot = horizontal ? layoutCartesian(c, frame, vAxis, cAxis) : layoutCartesian(c, frame, cAxis, vAxis)
  drawAnnotations(c, plot, horizontal ? vAxis : cAxis, horizontal ? cAxis : vAxis)

  const fmt = c.format
  const half = Math.min(60, cats.bandwidth * 0.48)
  const out: Mark[] = []
  const P = (v: number): number => vScale.at(v)
  // (value, offset across) to pixels.
  const xy = (mid: number, v: number, off: number): string => (horizontal ? `${r2(P(v))} ${r2(mid + off)}` : `${r2(mid + off)} ${r2(P(v))}`)
  for (const k of keys) {
    const st = stats.get(k)!
    const d = dens.get(k)!
    const col = (s.colors?.[k] as string | undefined) ?? c.seriesColor(String(s.y), 0)
    const mid = cats.at(k)
    const top = peak(d)
    const w = (v: number): number => (top > 0 ? (half * densityAt(d, v)) / top : 0)
    const tip = {
      title: clip(k, 60),
      rows: [['Max', st.max], ['Q3', st.q3], ['Median', st.median], ['Q1', st.q1], ['Min', st.min]].map(([label, v]) => ({ label: label as string, value: fmt(v as number) })).concat([{ label: 'n', value: String(st.n) }, { label: 'Bandwidth', value: fmt(d.bandwidth) }])
    }
    const aria = `${k}: ${st.n} values, median ${fmt(st.median)}, Q1 ${fmt(st.q1)}, Q3 ${fmt(st.q3)}, range ${fmt(st.min)} to ${fmt(st.max)}`
    const datum = { group: k, ...st, bandwidth: d.bandwidth }
    if (d.grid.length === 1) {
      // Every value is the same: a point mass, drawn as a bar across the violin's width.
      out.push({ type: 'path', role: 'data', series: k, d: `M${xy(mid, d.grid[0], -half)}L${xy(mid, d.grid[0], half)}`, fill: 'none', stroke: col, strokeWidth: 2.5, tip, aria, datum, anim: 'fade' })
    } else {
      const side = d.grid.map((v, i) => xy(mid, v, (half * d.density[i]) / top))
      const other = d.grid.map((v, i) => xy(mid, v, (-half * d.density[i]) / top)).reverse()
      out.push({ type: 'path', role: 'data', series: k, d: `M${side.join('L')}L${other.join('L')}Z`, fill: col, opacity: 0.22, stroke: col, strokeWidth: 1.5, tip, aria, datum, anim: 'fade' })
    }
    const across = (v: number, len: number, width: number, dash?: string): Mark => horizontal
      ? { type: 'line', role: 'data', series: k, x1: P(v), x2: P(v), y1: mid - len, y2: mid + len, stroke: col, strokeWidth: width, ...(dash ? { dash } : {}) }
      : { type: 'line', role: 'data', series: k, x1: mid - len, x2: mid + len, y1: P(v), y2: P(v), stroke: col, strokeWidth: width, ...(dash ? { dash } : {}) }
    if (s.inner === 'box' && d.grid.length > 1) {
      const bw = Math.max(3, Math.min(10, half * 0.16))
      out.push(horizontal
        ? { type: 'line', role: 'data', series: k, x1: P(st.lowWhisker), x2: P(st.highWhisker), y1: mid, y2: mid, stroke: col, strokeWidth: 1.5 }
        : { type: 'line', role: 'data', series: k, x1: mid, x2: mid, y1: P(st.lowWhisker), y2: P(st.highWhisker), stroke: col, strokeWidth: 1.5 })
      out.push(horizontal
        ? { type: 'rect', role: 'data', series: k, x: Math.min(P(st.q1), P(st.q3)), y: mid - bw / 2, w: Math.abs(P(st.q3) - P(st.q1)), h: bw, r: 1, fill: col }
        : { type: 'rect', role: 'data', series: k, x: mid - bw / 2, y: Math.min(P(st.q1), P(st.q3)), w: bw, h: Math.abs(P(st.q3) - P(st.q1)), r: 1, fill: col })
      out.push({ type: 'circle', role: 'data', series: k, cx: horizontal ? P(st.median) : mid, cy: horizontal ? mid : P(st.median), r: Math.max(2, bw / 2 - 0.5), fill: c.c('background'), stroke: col, strokeWidth: 1 })
    } else if (s.inner === 'quartiles' && d.grid.length > 1) {
      out.push(across(st.q1, w(st.q1), 1, '3 3'), across(st.median, w(st.median), 2), across(st.q3, w(st.q3), 1, '3 3'))
    }
    if (mode !== 'none') out.push(...pointMarks(c, { key: k, values: g.get(k)!, outliers: mode === 'all' ? null : st.outliers, mid, at: P, horizontal, color: col, spread: v => w(v) * 0.8, column: String(s.y) }))
  }
  c.marks.push(...out)
  return { series: [] }
}

export const violin: ChartDef = {
  type: 'violin',
  name: 'Violin plot',
  summary: 'Shows the shape of a number\'s distribution for each group as a mirrored density curve, with a thin box plot inside.',
  useWhen: 'Comparing distributions across groups when the shape matters: two peaks, a long tail, a cluster that a box plot would hide. Needs ~20+ values per group; with fewer, the smoothing invents shape, so use a box plot or points: "all".',
  cartesian: true,
  fields: {
    x: { kind: 'column', role: 'any', desc: 'Column that defines the groups (one violin each). Omit for a single violin.' },
    y: { kind: 'column', role: 'number', required: true, desc: 'Numeric column whose distribution is drawn.' },
    bandwidth: { kind: 'number', min: 0, desc: 'Gaussian kernel bandwidth in the units of y (must be above 0). Default: Silverman\'s rule, 0.9 x min(sd, IQR / 1.34) x n^(-1/5), per group. Larger is smoother.' },
    inner: { kind: 'enum', values: ['box', 'quartiles', 'none'], default: 'box', desc: 'What to draw inside each violin: a thin box plot (quartile box, whiskers, a dot at the median), dashed quartile lines with a solid median, or nothing.' },
    points: { kind: 'enum', values: ['outliers', 'all', 'none'], default: 'none', desc: 'Observations drawn as dots: none, the outliers beyond the box plot\'s whiskers (1.5 x IQR), or all of them, spread across the violin\'s width at that value by a fixed jitter (the same every time).' },
    orientation: { kind: 'enum', values: ['vertical', 'horizontal'], default: 'vertical', desc: '`horizontal` suits long group names.' },
    yDomain: { kind: 'domain', desc: 'Fix the value axis range.' }
  },
  example: {
    type: 'violin', title: 'Session length by plan', subtitle: 'Minutes per session; Team users split into two habits', x: 'plan', y: 'minutes', yLabel: 'Minutes',
    data: ['Free', 'Pro', 'Team'].flatMap((plan, pi) => Array.from({ length: 60 }, (_, i) => {
      const u = (Math.abs(Math.sin((i + 1) * (pi + 2.3) * 12.9898) * 43758.5453) % 1)
      const w = (Math.abs(Math.sin((i + 7) * (pi + 5.1) * 78.233) * 12345.6789) % 1)
      const base = pi === 2 ? (i % 2 ? 9 : 32) + (u + w - 1) * 8 : 8 + pi * 7 + (u + w - 1) * (6 + pi * 3) + (u > 0.93 ? 25 : 0)
      return { plan, minutes: Math.round(Math.max(1, base) * 10) / 10 }
    }))
  },
  check(spec, ctx) {
    checkPoints(spec, ctx)
    if (spec.bandwidth === 0) ctx.issues.push({ severity: 'error', code: 'out_of_range', path: 'bandwidth', message: 'bandwidth must be above 0.', hint: 'Leave it out for Silverman\'s rule, or give a positive width in the units of y.' })
    const few = [...groups({ ...spec, data: ctx.rows }).entries()].filter(([, v]) => v.length < 5).map(([k]) => k)
    if (few.length) ctx.issues.push({ severity: 'warning', code: 'few_values', path: 'y', message: `${few.length} group(s) have fewer than 5 values (${fmtList(few.map(k => clip(k, 30)), 3)}); their violin shape is mostly smoothing.`, hint: 'Use a box plot or points: "all" for small groups.' })
  },
  compile,
  describe(spec, env) {
    const g = groups(spec)
    const f = formatter(spec, env.locale)
    const keys = distinct([...g.keys()])
    let t = `${lead(spec, 'Violin plot')} Distribution of ${spec.y}${spec.x ? ` for ${keys.length} groups (${fmtList(keys)})` : ''}, as a Gaussian kernel density${spec.bandwidth ? ` with bandwidth ${f(spec.bandwidth)}` : ' (bandwidth by Silverman\'s rule)'}.`
    for (const k of keys.slice(0, 6)) {
      const v = g.get(k)!
      const st = boxStats(v)
      const d = kde(v, spec.bandwidth)
      if (!st || !d) continue
      const pk = densityPeaks(d)
      t += ` ${clip(k, 30)}: median ${f(st.median)}, middle half ${f(st.q1)} to ${f(st.q3)}, range ${f(st.min)} to ${f(st.max)}, ${pk.length > 1 ? `${pk.length} peaks, near ${fmtList(pk.map(f), 4)}` : `densest near ${f(pk[0])}`}.`
    }
    return t
  }
}
