// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { roundedRectPath } from '../scene.js'
import { CARTESIAN_FIELDS, LIMITS } from '../schema.js'
import { distinct } from '../data.js'
import { formatPercent } from '../util/format.js'
import { toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatter, lead, fmtList } from './shared.js'

interface Part { key: string; value: number; other?: boolean }

/** Cell counts a waffle accepts: multiples of 10 from 50 to 400. */
export const WAFFLE_CELLS = { min: 50, max: 400, step: 10 } as const

/**
 * The fixed grid for a cell count: 10 columns and `cells / 10` rows up to 100 cells, then 10 rows and
 * `cells / 10` columns (100 is 10 x 10, 50 is 10 x 5, 200 is 20 x 10, 400 is 40 x 10).
 */
export function waffleGrid(cells: number): { cols: number; rows: number } {
  const cols = Math.max(10, cells / 10)
  return { cols, rows: cells / cols }
}

/**
 * Largest-remainder (Hamilton) apportionment: each part gets the floor of its exact share of `cells`, then
 * the cells left over go one each to the parts with the largest fractional remainder. Ties in the remainder
 * go to the part that comes first in `values` (data order). The result always sums to exactly `cells`
 * (when any value is positive) and is the same for the same input.
 */
export function waffleCells(values: readonly number[], cells: number): number[] {
  const total = values.reduce((q, v) => q + (v > 0 ? v : 0), 0)
  if (!(total > 0)) return values.map(() => 0)
  const exact = values.map(v => (v > 0 ? (v / total) * cells : 0))
  const out = exact.map(Math.floor)
  let left = cells - out.reduce((q, v) => q + v, 0)
  const order = exact.map((e, i) => ({ i, rem: e - Math.floor(e) })).sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  return out
}

function parts(spec: Record<string, any>): { all: Part[]; order: string[]; skipped: number; merged: number } {
  const sums = new Map<string, number>()
  let skipped = 0
  for (const r of spec.data as Record<string, unknown>[]) {
    const n = toNumber(r[spec.value])
    if (n === null) continue
    if (n < 0) {
      skipped++
      continue
    }
    const k = String(r[spec.label] ?? '')
    sums.set(k, (sums.get(k) ?? 0) + n)
  }
  const order = distinct((spec.data as Record<string, unknown>[]).map(r => String(r[spec.label] ?? ''))).filter(k => sums.has(k))
  let all: Part[] = order.map(key => ({ key, value: sums.get(key)! }))
  if (spec.sort && spec.sort !== 'none') all = [...all].sort((a, b) => (spec.sort === 'asc' ? a.value - b.value : b.value - a.value))
  let merged = 0
  const max = LIMITS.maxSeries
  if (all.length > max) {
    // Same rule as pie's maxSlices: keep the largest max-1 (stable, so ties keep data order), merge the rest.
    const keep = new Set([...all].sort((a, b) => b.value - a.value).slice(0, max - 1).map(p => p.key))
    const rest = all.filter(p => !keep.has(p.key))
    merged = rest.length
    all = [...all.filter(p => keep.has(p.key)), { key: 'Other', value: rest.reduce((q, p) => q + p.value, 0), other: true }]
  }
  return { all, order, skipped, merged }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const cells = (s.cells ?? 100) as number
  const { all, order, skipped, merged } = parts(s)
  if (skipped) c.warn('negative_slices', 'data', `${skipped} negative value(s) were skipped; a waffle cannot show negatives.`)
  if (merged) c.warn('many_categories', 'label', `${merged + LIMITS.maxSeries - 1} categories is more than ${LIMITS.maxSeries} distinct colours; the ${merged} smallest were merged into "Other".`, 'Filter or group with `transform` first, or use a bar chart to compare many categories.')
  const colors = s.colors as Record<string, string> | undefined
  // The merged part keeps the key "Other" (colours, toggles, datum); only its label is translated.
  const series = c.makeSeries(all.map(p => p.key), Object.fromEntries(all.filter(a => a.other).map(a => [a.key, c.t('other')]))).map(si => {
    const p = all.find(a => a.key === si.key)!
    // Colour follows the entity (position in the data), not its rank after sorting, as on a pie.
    return { ...si, color: p.other ? (colors?.Other ?? c.c('other')) : c.seriesColor(si.key, order.indexOf(si.key)) }
  })
  const shown = all.filter(p => !c.hidden.has(p.key))
  const total = shown.reduce((q, p) => q + p.value, 0)
  const counts = waffleCells(shown.map(p => p.value), cells)
  const pct = (v: number): string => formatPercent(total ? v / total : 0, c.locale)
  const zero = shown.filter((p, i) => p.value > 0 && counts[i] === 0)
  if (zero.length) c.warn('rounded_to_zero', 'cells', `${fmtList(zero.map(p => `"${clip(p.key, 30)}"`), 3)} ${zero.length === 1 ? 'is' : 'are'} under half a cell and get${zero.length === 1 ? 's' : ''} no cell; ${zero.length === 1 ? 'it stays' : 'they stay'} in the legend.`, `Raise \`cells\` (now ${cells}, at most ${WAFFLE_CELLS.max}), or use a bar chart for small shares.`)

  const frame = c.frame({ series, alwaysLegend: true, autoSide: 'right', trailing: key => (c.hidden.has(key) ? '' : pct(all.find(a => a.key === key)!.value)) })
  const { cols, rows } = waffleGrid(cells)
  const step = Math.max(2, Math.min(frame.w / cols, frame.h / rows))
  const gap = step >= 10 ? c.theme.gap : step >= 5 ? 1 : 0
  const side = step - gap
  const r = Math.min(2, side / 4)
  const x0 = frame.x + (frame.w - step * cols) / 2 + gap / 2
  const y0 = frame.y + (frame.h - step * rows) / 2 + gap / 2
  const cell = (i: number): string => roundedRectPath(x0 + (i % cols) * step, y0 + Math.floor(i / cols) * step, side, side, [r, r, r, r])

  if (!(total > 0)) {
    // Nothing to apportion (all hidden or all zero): the empty grid keeps the chart's shape.
    let d = ''
    for (let i = 0; i < cells; i++) d += cell(i)
    c.marks.push({ type: 'path', role: 'grid', d, fill: c.c('grid') })
    return { series }
  }
  let at = 0
  shown.forEach((p, k) => {
    const n = counts[k]
    if (!n) return
    let d = ''
    for (let i = at; i < at + n; i++) d += cell(i)
    at += n
    const info = series.find(x => x.key === p.key)!
    c.marks.push({
      type: 'path', role: 'data', series: p.key, d, fill: info.color, anim: 'fade',
      tip: { title: clip(p.key, 60), rows: [{ label: String(s.value), value: c.format(p.value), color: info.color }, { label: 'Share', value: pct(p.value) }, { label: 'Cells', value: `${n} of ${cells}` }] },
      aria: `${p.key}: ${c.format(p.value)} (${pct(p.value)}), ${n} of ${cells} cells`,
      datum: { label: p.key, value: p.value, cells: n, share: p.value / total }
    })
  })
  return { series }
}

function describe(spec: Record<string, any>, env: { locale: string }): string {
  const { all } = parts(spec)
  const cells = (spec.cells ?? 100) as number
  const total = all.reduce((q, p) => q + p.value, 0)
  const f = formatter(spec, env.locale)
  const { cols, rows } = waffleGrid(cells)
  let t = `${lead(spec, 'Waffle chart')} ${all.length} ${all.length === 1 ? 'category' : 'categories'} totalling ${f(total)}, as ${cells} cells (${cols} by ${rows}; one cell is ${formatPercent(1 / cells, env.locale, 2)}).`
  if (total > 0) {
    const counts = waffleCells(all.map(p => p.value), cells)
    const ranked = all.map((p, i) => ({ ...p, n: counts[i] })).sort((a, b) => b.value - a.value)
    t += ` ${ranked.slice(0, 5).map(p => `${clip(p.key, 30)} ${formatPercent(p.value / total, env.locale)} (${p.n} ${p.n === 1 ? 'cell' : 'cells'})`).join(', ')}${ranked.length > 5 ? ` and ${ranked.length - 5} more` : ''}.`
  }
  return t
}

export const waffle: ChartDef = {
  type: 'waffle',
  name: 'Waffle chart',
  summary: 'Shows each category\'s share of a whole as a count of squares in a fixed grid (100 by default, so one square is 1%).',
  useWhen: 'Few (2-8) parts of one whole when readers should be able to count the share ("37 in 100"), or to compare several wholes with `facet`. Easier to read exactly than a pie. Not for many parts (use a bar or treemap), negative values, or tiny shares under one cell.',
  cartesian: false,
  fields: {
    label: { kind: 'column', role: 'any', required: true, desc: 'Column naming each category (as on a pie). Rows with the same label are summed.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each category\'s size. Negatives are skipped.' },
    cells: { kind: 'number', min: WAFFLE_CELLS.min, max: WAFFLE_CELLS.max, integer: true, default: 100, desc: 'Number of squares, a multiple of 10 from 50 to 400. The grid is fixed by the count: 10 wide up to 100 (50 is 10 x 5), then 10 tall (200 is 20 x 10). Cells are shared out by largest remainder, so they always add up.' },
    sort: { kind: 'enum', values: ['none', 'asc', 'desc'], default: 'desc', desc: 'Fill order. `desc` fills the biggest category first, in reading order; `none` keeps the data order.' },
    facet: CARTESIAN_FIELDS.facet
  },
  example: {
    type: 'waffle', title: 'How commuters get to work', subtitle: 'Share of 2,400 survey answers; one square is 1%',
    label: 'mode', value: 'answers', format: 'integer',
    data: [{ mode: 'Transit', answers: 888 }, { mode: 'Car', answers: 672 }, { mode: 'Bicycle', answers: 408 }, { mode: 'Walk', answers: 312 }, { mode: 'Remote', answers: 120 }]
  },
  check(spec, ctx) {
    const cells = spec.cells as number | undefined
    if (cells !== undefined && cells % WAFFLE_CELLS.step !== 0) {
      const near = Math.min(WAFFLE_CELLS.max, Math.max(WAFFLE_CELLS.min, Math.round(cells / WAFFLE_CELLS.step) * WAFFLE_CELLS.step))
      ctx.issues.push({ severity: 'error', code: 'bad_value', path: 'cells', message: `cells must be a multiple of ${WAFFLE_CELLS.step} so the grid is a full rectangle; got ${cells}.`, hint: `Try ${near}.` })
    }
    if (!parts({ ...spec, data: ctx.rows }).all.some(p => p.value > 0)) ctx.issues.push({ severity: 'error', code: 'no_positive_values', path: 'value', message: 'No category has a positive value; a waffle needs a whole to share out.', hint: 'Check the value column, or the transform that produced it.' })
  },
  compile,
  describe
}
