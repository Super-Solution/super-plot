// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, SeriesInfo, Tip } from '../scene.js'
import { LIMITS, type Row } from '../schema.js'
import { bandScale } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian } from '../cartesian.js'
import { detectXKind, distinct, observations, xKey } from '../data.js'
import { r2, toNumber } from '../util/num.js'
import { toTime } from '../util/time.js'
import { clip, fit } from '../util/text.js'
import { fmtList, lead } from './shared.js'

export interface BumpModel {
  /** x keys in order (data order for categories, ascending for numbers and dates). */
  xs: string[]
  /** Every series, in order of first appearance. */
  all: string[]
  /** The series drawn: at most `LIMITS.maxSeries`, those with the best mean rank. */
  keys: string[]
  /** Series to x key to rank (1 is best). Ranks are over every series, drawn or not. */
  ranks: Map<string, Map<string, number>>
  /** Series to x key to the value ranked (only when ranks come from `y`). */
  values: Map<string, Map<string, number>> | null
  maxRank: number
  duplicates: number
  badRanks: number
}

const meanRank = (m: Map<string, number> | undefined): number => {
  if (!m || !m.size) return Infinity
  let t = 0
  for (const v of m.values()) t += v
  return t / m.size
}

/** Ranks per x, from a `rank` column or by ranking `y` among the series present at that x (ties: series order). */
export function bumpModel(spec: Record<string, any>): BumpModel {
  const rows = spec.data as Row[]
  const kind = detectXKind('auto', rows.map(r => r[spec.x]))
  let xs = distinct(rows.map(r => r[spec.x]).filter(v => v !== null && v !== undefined && v !== '').map(xKey))
  if (kind !== 'category') {
    const num = (k: string): number => (kind === 'time' ? toTime(k) : toNumber(k)) ?? 0
    xs = [...xs].sort((a, b) => num(a) - num(b))
  }
  const ranks = new Map<string, Map<string, number>>()
  let values: Map<string, Map<string, number>> | null = null
  let duplicates = 0
  let badRanks = 0
  let all: string[]
  if (spec.rank) {
    all = distinct(rows.map(r => xKey(r[spec.series])))
    for (const r of rows) {
      const x = r[spec.x]
      if (x === null || x === undefined || x === '') continue
      const v = toNumber(r[spec.rank])
      if (v === null) continue
      if (v < 1) {
        badRanks++
        continue
      }
      const s = xKey(r[spec.series])
      let m = ranks.get(s)
      if (!m) ranks.set(s, (m = new Map()))
      if (m.has(xKey(x))) duplicates++
      else m.set(xKey(x), v)
    }
  } else {
    const obs = observations(rows, spec.x, spec.y, spec.series)
    all = distinct(obs.map(o => o.s))
    values = new Map()
    for (const o of obs) {
      if (o.y === null || o.x === null || o.x === undefined || o.x === '') continue
      let m = values.get(o.s)
      if (!m) values.set(o.s, (m = new Map()))
      const k = xKey(o.x)
      if (m.has(k)) duplicates++
      m.set(k, (m.get(k) ?? 0) + o.y)
    }
    const desc = spec.rankBy !== 'asc'
    for (const x of xs) {
      const present = all.filter(s => values!.get(s)?.has(x)).map((s, i) => ({ s, v: values!.get(s)!.get(x)!, i }))
      present.sort((a, b) => (desc ? b.v - a.v : a.v - b.v) || a.i - b.i)
      present.forEach((p, i) => {
        let m = ranks.get(p.s)
        if (!m) ranks.set(p.s, (m = new Map()))
        m.set(x, i + 1)
      })
    }
  }
  all = all.filter(s => ranks.get(s)?.size)
  let keys = all
  if (all.length > LIMITS.maxSeries) {
    const best = new Set([...all].sort((a, b) => meanRank(ranks.get(a)) - meanRank(ranks.get(b)) || all.indexOf(a) - all.indexOf(b)).slice(0, LIMITS.maxSeries))
    keys = all.filter(s => best.has(s))
  }
  let maxRank = 1
  for (const s of keys) for (const v of ranks.get(s)?.values() ?? []) maxRank = Math.max(maxRank, Math.ceil(v))
  return { xs, all, keys, ranks, values, maxRank, duplicates, badRanks }
}

/** Horizontal tangents at every point: lines ease from one rank to the next (d3's curveBumpX). */
function bumpPath(pts: [number, number][], smooth: boolean): string {
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const xm = (x0 + x1) / 2
    d += smooth ? `C${r2(xm)} ${r2(y0)} ${r2(xm)} ${r2(y1)} ${r2(x1)} ${r2(y1)}` : `L${r2(x1)} ${r2(y1)}`
  }
  return d
}

function compile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const m = bumpModel(s)
  const series = c.makeSeries(m.keys)
  const visible = m.keys.filter(k => !c.hidden.has(k))
  const fmt = c.format
  const yName = Array.isArray(s.y) ? undefined : (s.y as string | undefined)
  const area = c.frame({ series, autoSide: 'top' })
  // Room on the right for the direct labels at the line ends (measured over every series, so toggling does not move the plot).
  const labels = s.labels !== false
  const reserve = labels ? Math.min(area.w * 0.3, Math.max(0, ...series.map(x => c.measure(x.label))) + 14) : 0
  const xScale = bandScale(m.xs, 0)
  const ranks = Array.from({ length: m.maxRank }, (_, i) => String(i + 1))
  const yScale = bandScale(ranks, 0)
  const xAxis = bandAxis(xScale, Object.fromEntries(m.xs.map(k => [k, clip(k, 60)])), s.xLabel, c.locale)
  const yAxis = bandAxis(yScale, Object.fromEntries(ranks.map(k => [k, k])), s.yLabel ?? c.t('rank'), c.locale)
  const plot = layoutCartesian(c, { ...area, w: Math.max(40, area.w - reserve) }, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)
  const stepY = plot.h / m.maxRank
  const yOf = (rank: number): number => plot.y + (rank - 0.5) * stepY
  for (const k of ranks) c.marks.push({ type: 'line', role: 'grid', x1: plot.x, x2: plot.x + plot.w, y1: yOf(Number(k)), y2: yOf(Number(k)), stroke: c.c('grid') })

  const shown = new Map(xAxis.ticks(plot.w).map(t => [String(t.key), t.label]))
  const xTitle = (x: string): string => clip(shown.get(x) ?? x, 60)
  const lines: Mark[] = []
  const dots: Mark[] = []
  const texts: Mark[] = []
  const r = Math.max(2.5, Math.min(5, stepY / 4))
  const smooth = s.curve !== 'linear'
  for (const k of visible) {
    const si = m.keys.indexOf(k)
    const color = series[si].color
    const label = series[si].label
    const rk = m.ranks.get(k)!
    const pts = m.xs.map((x, i) => ({ x, i, rank: rk.get(x) }))
    // Continuous runs only: a series missing at some x leaves a gap.
    let run: [number, number][] = []
    const flush = (): void => {
      if (run.length > 1) lines.push({ type: 'path', role: 'data', series: k, d: bumpPath(run, smooth), stroke: color, strokeWidth: c.theme.lineWidth + 1, anim: 'draw' })
      run = []
    }
    let prev: number | undefined
    let last: { px: number; py: number } | null = null
    for (const p of pts) {
      if (p.rank === undefined) {
        flush()
        prev = undefined
        continue
      }
      const px = xScale.at(p.x)
      const py = yOf(p.rank)
      run.push([px, py])
      last = { px, py }
      const value = m.values?.get(k)?.get(p.x)
      const move = prev === undefined ? '' : prev === p.rank ? c.t('noChange') : prev > p.rank ? c.t('rankUp', { n: r2(prev - p.rank) }) : c.t('rankDown', { n: r2(p.rank - prev) })
      const tipRows: Tip['rows'] = [{ label, value: `#${r2(p.rank)}`, color }]
      if (value !== undefined) tipRows.push({ label: yName ?? c.t('value'), value: fmt(value) })
      if (move) tipRows.push({ label: c.t('sinceStepBefore'), value: move })
      dots.push({
        type: 'circle', role: 'data', series: k, cx: px, cy: py, r, fill: color, stroke: c.c('background'), strokeWidth: 2, anim: 'fade',
        tip: { title: xTitle(p.x), rows: tipRows },
        aria: `${label}, ${xTitle(p.x)}: ${c.t('rankAria', { rank: r2(p.rank) })}${value !== undefined ? `, ${fmt(value)}` : ''}${move ? `, ${move}` : ''}`,
        datum: { x: p.x, series: k, rank: p.rank, ...(value !== undefined ? { value } : {}) }
      })
      prev = p.rank
    }
    flush()
    if (labels && last) texts.push(c.text(last.px + r + 6, last.py, fit(label, reserve - 8, c.size, c.env.measure), { role: 'label', series: k, baseline: 'middle', fill: c.c('text') }))
  }
  c.marks.push(...lines, ...dots, ...texts)
  return { series }
}

export const bump: ChartDef = {
  type: 'bump',
  name: 'Bump chart',
  summary: 'Shows how the rank of each series changes along an ordered x: rank 1 on top, one line per series, labelled at its end.',
  useWhen: 'Rankings over time or rounds (league tables, top products per month) for 3 to 8 series, when the order matters more than the gaps between values. Use a line chart when the values themselves matter.',
  cartesian: true,
  fields: {
    x: { kind: 'column', role: 'x', required: true, desc: 'Column for the ordered steps (rounds, years, dates). Numbers and dates are sorted; categories keep the data order.' },
    series: { kind: 'column', role: 'any', desc: 'Column naming the series (long-form data). Not needed when `y` lists several columns.' },
    rank: { kind: 'column', role: 'number', desc: 'Column holding a rank (1 is best) per series and x. Give this or `y`.' },
    y: { kind: 'columns', role: 'number', desc: 'Numeric column(s) to rank per x instead of a `rank` column; several columns give one series per column (wide-form data).' },
    rankBy: { kind: 'enum', values: ['desc', 'asc'], default: 'desc', desc: 'With `y`: `desc` ranks the highest value 1, `asc` the lowest (times, positions). Ties keep the series order.' },
    curve: { kind: 'enum', values: ['smooth', 'linear'], default: 'smooth', desc: '`smooth` eases each line flat into every point; `linear` draws straight segments.' },
    labels: { kind: 'boolean', default: true, desc: 'Name each series at the end of its line (direct labels), so the reader does not need the legend.' }
  },
  example: {
    type: 'bump',
    title: 'Most used languages',
    subtitle: 'Rank by share of new repositories',
    x: 'year',
    y: 'share',
    series: 'language',
    data: [
      ['Python', [17, 19, 21, 23, 25]], ['JavaScript', [21, 20, 19, 18, 17]], ['TypeScript', [9, 12, 15, 17, 19]],
      ['Java', [14, 13, 11, 10, 9]], ['Go', [6, 7, 8, 9, 10]], ['Rust', [3, 4, 6, 8, 11]]
    ].flatMap(([language, shares]) => (shares as number[]).map((share, i) => ({ year: 2022 + i, language, share })))
  },
  check(spec, ctx) {
    const issue = (severity: 'error' | 'warning', code: string, path: string, message: string, hint?: string): void => {
      ctx.issues.push({ severity, code, path, message, ...(hint ? { hint } : {}) })
    }
    if (!spec.rank && !spec.y) return issue('error', 'missing_required', 'y', 'A bump chart needs `rank` (a column of ranks) or `y` (values to rank per x).', 'E.g. "y": "points", "series": "team".')
    if (spec.rank && !spec.series) return issue('error', 'missing_required', 'series', '`rank` needs `series`: the column naming whose rank each row is.')
    if (spec.rank && spec.y) issue('warning', 'y_ignored', 'y', '`y` is ignored when `rank` is given.')
    if (!spec.rank && Array.isArray(spec.y) && spec.y.length > 1 && spec.series) issue('warning', 'series_ignored', 'series', '`series` is ignored when `y` lists several columns.')
    if (spec.rankBy !== undefined && spec.rankBy !== 'desc' && spec.rank) issue('warning', 'rank_by_ignored', 'rankBy', '`rankBy` only applies when ranks come from `y`.')
    if (spec.patterns === true) issue('warning', 'patterns_unsupported', 'patterns', 'A bump chart has lines and dots, no filled areas, so patterns do not apply; series are told apart by their end labels.')
    const m = bumpModel({ ...spec, data: ctx.rows })
    if (m.badRanks) issue('warning', 'bad_rank', 'rank', `${m.badRanks} rank(s) below 1 were skipped; rank 1 is the best.`)
    if (m.duplicates) issue('warning', 'duplicate_points', spec.rank ? 'rank' : 'y', `${m.duplicates} row(s) repeat a series at the same x; ${spec.rank ? 'the first rank was kept' : 'their values were summed before ranking'}.`)
    if (m.all.length > LIMITS.maxSeries) issue('warning', 'too_many_series', 'series', `${m.all.length} series; only the ${LIMITS.maxSeries} with the best average rank are drawn (ranks still count every series).`, 'Filter first, e.g. a `top` step in `transform`.')
    else if (m.all.length === 1) issue('warning', 'single_series', 'series', 'A bump chart compares ranks; with one series it is always first.', 'Add `series`, or use a line chart.')
    if (m.xs.length < 2) issue('warning', 'single_step', 'x', 'Only one x value: there is no change of rank to show.')
  },
  compile,
  describe(spec) {
    const m = bumpModel(spec)
    const first = m.xs[0]
    const last = m.xs[m.xs.length - 1]
    let t = `${lead(spec, 'Bump chart')} Ranks of ${m.keys.length} series (${fmtList(m.keys.map(k => clip(k, 30)))}) over ${m.xs.length} steps from ${clip(first, 30)} to ${clip(last, 30)}`
    t += spec.rank ? '.' : `, ranked by ${Array.isArray(spec.y) ? 'value' : clip(spec.y, 40)}, ${spec.rankBy === 'asc' ? 'lowest' : 'highest'} first.`
    const at = (x: string): string[] => m.keys.filter(k => m.ranks.get(k)?.has(x)).sort((a, b) => m.ranks.get(a)!.get(x)! - m.ranks.get(b)!.get(x)!)
    const end = at(last)
    if (end.length) t += ` At ${clip(last, 30)}: ${end.slice(0, 5).map(k => `${r2(m.ranks.get(k)!.get(last)!)}. ${clip(k, 30)}`).join(', ')}.`
    let up: { k: string; from: number; to: number } | null = null
    let down: { k: string; from: number; to: number } | null = null
    for (const k of m.keys) {
      const rk = m.ranks.get(k)!
      const seen = m.xs.filter(x => rk.has(x))
      if (seen.length < 2) continue
      const from = rk.get(seen[0])!
      const to = rk.get(seen[seen.length - 1])!
      if (to < from && (!up || from - to > up.from - up.to)) up = { k, from, to }
      if (to > from && (!down || to - from > down.to - down.from)) down = { k, from, to }
    }
    if (up) t += ` Biggest climb: ${clip(up.k, 30)}, from ${r2(up.from)} to ${r2(up.to)}.`
    if (down) t += ` Biggest fall: ${clip(down.k, 30)}, from ${r2(down.from)} to ${r2(down.to)}.`
    return t
  }
}
