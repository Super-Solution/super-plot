// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark } from '../scene.js'
import { bandScale, linearScale, niceLinear } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { distinct } from '../data.js'
import { extent, quantile, r2, toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatter, lead, fmtList } from './shared.js'

interface P { row: Record<string, unknown>; i: number; x: number; g: string; s: string; size: number | null; name: string | null }

/** A beeswarm draws one dot per row; past this many visible dots an evenly spaced sample is drawn. */
export const BEESWARM_MAX = 2000

/**
 * Deterministic dodge (the beeswarm layout). Points are placed one at a time in order of `xs` (ties in input
 * order). Each goes to the offset from the lane centre with the smallest absolute value at which it overlaps
 * no point placed before it: the candidates are 0 and, for every placed neighbour j close enough in x, the two
 * offsets where the new circle just touches j (y_j +- sqrt(D^2 - dx^2), D = r_i + r_j + pad). Equal distances
 * prefer the negative offset (up on screen). Returns one offset per input, in pixels.
 */
export function dodge(xs: readonly number[], rs: readonly number[], pad = 1): number[] {
  const n = xs.length
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b)
  const out = new Array<number>(n).fill(0)
  const placed: number[] = []
  const rMax = rs.reduce((q, r) => Math.max(q, r), 0)
  for (const i of order) {
    const near: number[] = []
    for (let k = placed.length - 1; k >= 0; k--) {
      const j = placed[k]
      const dx = xs[i] - xs[j]
      if (dx >= rs[i] + rMax + pad) break
      if (dx < rs[i] + rs[j] + pad) near.push(j)
    }
    const cands = [0]
    for (const j of near) {
      const D = rs[i] + rs[j] + pad
      const dx = xs[i] - xs[j]
      const h = Math.sqrt(Math.max(0, D * D - dx * dx))
      cands.push(out[j] - h, out[j] + h)
    }
    cands.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
    let best = cands[cands.length - 1]
    for (const y of cands) {
      let ok = true
      for (const j of near) {
        const D = rs[i] + rs[j] + pad
        const dx = xs[i] - xs[j]
        const dy = y - out[j]
        if (dx * dx + dy * dy < D * D - 1e-6) { ok = false; break }
      }
      if (ok) { best = y; break }
    }
    out[i] = best
    placed.push(i)
  }
  return out
}

function points(spec: Record<string, any>): P[] {
  const pts: P[] = []
  ;(spec.data as Record<string, unknown>[]).forEach((r, i) => {
    const x = toNumber(r[spec.x])
    if (x === null) return
    pts.push({ row: r, i, x, g: spec.y ? String(r[spec.y] ?? '') : '', s: spec.series ? String(r[spec.series] ?? '') : String(spec.x), size: spec.size ? toNumber(r[spec.size]) : null, name: spec.label ? String(r[spec.label] ?? '') : null })
  })
  return pts
}

/** Every k-th point, k = n / max, so a capped swarm keeps the spread of the data in row order. */
const sample = <T>(list: T[], max: number): T[] => (list.length <= max ? list : Array.from({ length: max }, (_, k) => list[Math.floor((k * list.length) / max)]))

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const pts = points(s)
  const keys = distinct(pts.map(p => p.s))
  const lanes = distinct(pts.map(p => p.g))
  const series = c.makeSeries(keys)
  let show = pts.filter(p => !c.hidden.has(p.s))
  if (show.length > BEESWARM_MAX) {
    c.warn('too_many_points', 'data', `${show.length} dots is more than a beeswarm can keep apart; an evenly spaced sample of ${BEESWARM_MAX} is drawn (the description still uses every value).`, 'Use a histogram, violin or box plot for this many values, or filter with `transform`.')
    show = sample(show, BEESWARM_MAX)
  }
  const ex = extent(show.map(p => p.x)) ?? [0, 1]
  const xd = s.xDomain as [number | null, number | null] | undefined
  const xScale = xd && (xd[0] !== null || xd[1] !== null) ? linearScale([xd[0] ?? ex[0], xd[1] ?? ex[1]]) : niceLinear(ex[0], ex[1])
  const cats = bandScale(lanes, lanes.length > 1 ? 0.08 : 0)
  c.axisFields = { x: s.x, y: s.y }
  const frame = c.frame({ series: s.series ? series : [], autoSide: 'top' })
  const xAxis = valueAxis(c, xScale, { title: s.xLabel ?? String(s.x), vertical: false, format: s.format })
  const yAxis = bandAxis(cats, Object.fromEntries(lanes.map(k => [k, clip(k, 60)])), s.y ? s.yLabel ?? String(s.y) : s.yLabel, c.locale)
  const plot = layoutCartesian(c, frame, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)

  const n = show.length
  const base = (s.radius as number | undefined) ?? (n > 1000 ? 2.5 : n > 300 ? 3.5 : 4.5)
  const sz = extent(show.map(p => p.size).filter((v): v is number => v !== null))
  const radius = (p: P): number => (p.size === null || !sz ? base : sz[0] === sz[1] ? base * 1.6 : base * 0.6 + base * 2 * Math.sqrt((p.size - sz[0]) / (sz[1] - sz[0])))
  const half = Math.max(2, cats.bandwidth / 2 - 1)
  const fmt = c.format
  const marks: Mark[] = []
  let overflow = 0
  const layout = (k: number): { own: { p: P; px: number }[]; xs: number[]; rs: number[]; ys: number[]; reach: number }[] => lanes.map(lane => {
    const own = show.filter(p => p.g === lane).map(p => ({ p, px: xScale.at(p.x) })).filter(o => o.px >= plot.x - 1 && o.px <= plot.x + plot.w + 1)
    const xs = own.map(o => o.px)
    const rs = own.map(o => radius(o.p) * k)
    const ys = dodge(xs, rs)
    return { own, xs, rs, ys, reach: ys.reduce((q, y, i) => Math.max(q, Math.abs(y) + rs[i]), 0) }
  })
  // Too tall for a lane: shrink every dot by the same factor (never below 35 %), so sizes compare across lanes.
  // The gap between dots does not shrink, so this takes a few rounds (at most 4).
  let k = 1
  let swarms = layout(k)
  for (let round = 0; round < 4; round++) {
    const reach = Math.max(0, ...swarms.map(w => w.reach))
    if (reach <= half + 0.5 || k <= 0.35) break
    k = Math.max(0.35, (k * half) / reach)
    swarms = layout(k)
  }
  for (const [li, lane] of lanes.entries()) {
    const { own, xs, rs, ys } = swarms[li]
    if (!own.length) continue
    const mid = cats.at(lane)
    own.forEach(({ p }, k) => {
      let y = ys[k]
      if (Math.abs(y) + rs[k] > half + 0.5) {
        overflow++
        y = Math.sign(y) * Math.max(0, half - rs[k])
      }
      const si = keys.indexOf(p.s)
      const color = series[si].color
      const title = clip(p.name ?? (keys.length > 1 ? series[si].label : lane), 60) || undefined
      const rows = [
        { label: String(s.x), value: fmt(p.x) },
        ...(s.y && (p.name !== null || keys.length > 1) ? [{ label: String(s.y), value: clip(lane, 40) }] : []),
        ...(s.series && p.name !== null ? [{ label: String(s.series), value: clip(series[si].label, 40), color }] : []),
        ...(s.size && p.size !== null ? [{ label: String(s.size), value: fmt(p.size) }] : [])
      ]
      const r = r2(rs[k])
      marks.push({
        type: 'circle', role: 'data', series: p.s, cx: r2(xs[k]), cy: r2(mid + y), r, fill: color, opacity: 0.85,
        ...(r >= 3 ? { stroke: c.c('background'), strokeWidth: 1 } : {}),
        tip: { title, rows }, anim: 'fade',
        aria: `${[p.name, s.y ? lane : '', keys.length > 1 && s.series ? series[si].label : ''].filter(Boolean).join(', ')}${p.name || s.y || (keys.length > 1 && s.series) ? ': ' : ''}${s.x} ${fmt(p.x)}`,
        datum: { x: p.x, ...(s.y ? { y: lane } : {}), ...(s.series ? { series: p.s } : {}), ...(p.size !== null ? { size: p.size } : {}), ...(p.name !== null ? { label: p.name } : {}), row: p.i },
        rows: c.rowsOf([p.row])
      })
    })
  }
  if (overflow) c.warn('swarm_overflow', 'radius', `${overflow} dots did not fit their lane and overlap at its edge.`, 'Make the chart taller, set a smaller `radius`, filter the data, or use a histogram or violin plot.')
  c.marks.push(...marks)
  return { series }
}

function describe(spec: Record<string, any>, env: { locale: string }): string {
  const pts = points(spec)
  const f = formatter(spec, env.locale)
  const lanes = distinct(pts.map(p => p.g))
  let t = `${lead(spec, 'Beeswarm plot')} ${pts.length} ${pts.length === 1 ? 'value' : 'values'} of ${spec.x}, one dot each${spec.y ? `, in ${lanes.length} ${lanes.length === 1 ? 'group' : 'groups'} by ${spec.y} (${fmtList(lanes.map(l => clip(l, 30)))})` : ''}.`
  const stat = (xs: number[]): string => {
    const v = [...xs].sort((a, b) => a - b)
    return `median ${f(quantile(v, 0.5))}, range ${f(v[0])} to ${f(v[v.length - 1])}`
  }
  if (pts.length) t += ` Overall ${stat(pts.map(p => p.x))}.`
  if (spec.y && lanes.length > 1) for (const l of lanes.slice(0, 6)) {
    const xs = pts.filter(p => p.g === l).map(p => p.x)
    t += ` ${clip(l, 30)}: ${xs.length} ${xs.length === 1 ? 'value' : 'values'}, ${stat(xs)}.`
  }
  return t
}

export const beeswarm: ChartDef = {
  type: 'beeswarm',
  name: 'Beeswarm plot',
  summary: 'Places one dot per row along a number axis, pushed aside so no dot hides another; optional lanes per group.',
  useWhen: 'Showing every value of one measure (tens to about 2,000 rows) so readers see clusters, gaps and individual outliers, optionally compared across a few groups. Use a histogram, violin or box plot for more values or to read a summary; a scatter plot when there are two measures.',
  cartesian: true,
  ref: { x: ['x'], y: ['y'], yRow: true, series: 'series' },
  fields: {
    x: { kind: 'column', role: 'number', required: true, desc: 'Numeric column for the horizontal position: one dot per row.' },
    y: { kind: 'column', role: 'any', desc: 'Column that splits the dots into lanes, one swarm per value. Omit for a single swarm.' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours dots by group (with a legend).' },
    size: { kind: 'column', role: 'number', desc: 'Numeric column mapped to dot area.' },
    label: { kind: 'column', role: 'any', desc: 'Column used as each dot\'s name in the tooltip.' },
    radius: { kind: 'number', min: 1, max: 12, desc: 'Dot radius in px. Default 4.5, 3.5 past 300 dots, 2.5 past 1,000. Dots shrink (to 35% at most) when a lane is too short.' },
    xDomain: { kind: 'domain', desc: 'Fix the horizontal range.' }
  },
  example: {
    type: 'beeswarm', title: 'Response time by region', subtitle: 'One dot per request sample, milliseconds',
    x: 'ms', y: 'region', series: 'cache', label: 'id', xLabel: 'Response time (ms)',
    data: ['Europe', 'Americas', 'Asia'].flatMap((region, ri) => Array.from({ length: 40 }, (_, i) => {
      const u = Math.abs(Math.sin((i + 1) * (ri + 2.3) * 12.9898) * 43758.5453) % 1
      const hit = i % 3 !== 2
      return { id: `${region.slice(0, 2).toUpperCase()}-${i + 1}`, region, cache: hit ? 'Hit' : 'Miss', ms: Math.round((hit ? 40 + ri * 12 : 140 + ri * 30) + u * (hit ? 45 : 90)) }
    }))
  },
  check(spec, ctx) {
    if (!points({ ...spec, data: ctx.rows }).length) ctx.issues.push({ severity: 'error', code: 'no_points', path: 'x', message: 'No row has a numeric x.', hint: 'Pick a numeric column for x.' })
  },
  compile,
  describe
}
