// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { distinct } from '../data.js'
import type { ValidateCtx } from '../schema.js'
import { formatPercent } from '../util/format.js'
import { inkOn } from '../util/color.js'
import { toNumber } from '../util/num.js'
import { clip, fit } from '../util/text.js'
import { arc, formatter, lead, fmtList } from './shared.js'

interface Slice { key: string; value: number; other?: boolean; merged?: string[] }

function slices(spec: Record<string, any>, hidden: Set<string> = new Set()): { all: Slice[]; shown: Slice[]; order: string[] } {
  const sums = new Map<string, number>()
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.value])
    const k = String(r[spec.label] ?? '')
    if (v === null) continue
    if (v < 0) continue
    sums.set(k, (sums.get(k) ?? 0) + v)
  }
  const order = distinct((spec.data as Record<string, unknown>[]).map(r => String(r[spec.label] ?? ''))).filter(k => sums.has(k))
  let all: Slice[] = order.map(key => ({ key, value: sums.get(key)! }))
  if (spec.sort && spec.sort !== 'none') all = [...all].sort((a, b) => (spec.sort === 'asc' ? a.value - b.value : b.value - a.value))
  const max = spec.maxSlices ?? 8
  if (all.length > max) {
    // Keep the largest max-1 (by value), merge the rest; keep display order of survivors.
    const keep = new Set([...all].sort((a, b) => b.value - a.value).slice(0, max - 1).map(s => s.key))
    const rest = all.filter(s => !keep.has(s.key))
    all = [...all.filter(s => keep.has(s.key)), { key: 'Other', value: rest.reduce((q, s) => q + s.value, 0), other: true, merged: rest.map(r => r.key) }]
  }
  return { all, shown: all.filter(s => !hidden.has(s.key) && s.value > 0), order }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  // The negative_slices, zero_slices and pie_no_positive warnings come from `checkPie` (validation), so they reach `plot_validate` too.
  const { all, shown, order } = slices(s, c.hidden)
  // The merged slice keeps the key "Other" (colours, legend toggles, datum); only its label is translated.
  const series = c.makeSeries(all.map(a => a.key), Object.fromEntries(all.filter(a => a.other).map(a => [a.key, c.t('other')]))).map(si => {
    const slice = all.find(a => a.key === si.key)!
    // Colour follows the entity (position in the data), not its rank after sorting.
    const idx = slice.other ? -1 : order.indexOf(si.key)
    return { ...si, color: slice.other ? ((s.colors as Record<string, string> | undefined)?.Other ?? c.c('other')) : c.seriesColor(si.key, idx) }
  })
  const total = shown.reduce((q, a) => q + a.value, 0)
  const pct = (v: number): string => formatPercent(total ? v / total : 0, c.locale)
  const frame = c.frame({ series, alwaysLegend: true, autoSide: 'right', trailing: key => (c.hidden.has(key) ? '' : pct(all.find(a => a.key === key)!.value)) })
  const R = Math.max(20, Math.min(frame.w, frame.h) / 2 - 4)
  const cx = frame.x + frame.w / 2
  const cy = frame.y + frame.h / 2
  // Nothing to draw (every value is 0, or all were negative): say so where the pie would be, not an empty plot.
  if (!all.some(a => a.value > 0)) c.marks.push(c.text(cx, cy, fit(c.t('noPositive'), frame.w, c.size + 1, c.env.measure), { role: 'label', anchor: 'middle', baseline: 'middle', size: c.size + 1, fill: c.c('text-muted') }))
  const inner = (s.innerRadius ?? (s.type === 'donut' ? 0.62 : 0)) as number
  const r0 = inner * R
  let a = -Math.PI / 2
  for (const sl of shown) {
    const sweep = (sl.value / total) * Math.PI * 2
    const info = series.find(x => x.key === sl.key)!
    const mid = a + sweep / 2
    c.marks.push({
      type: 'path', role: 'data', series: sl.key, d: arc(cx, cy, r0, R, a, a + sweep), fill: info.color, stroke: c.c('background'), strokeWidth: c.theme.gap, anim: 'fade',
      tip: { title: info.label, rows: [{ label: s.value, value: c.format(sl.value), color: info.color }, { label: c.t('share'), value: pct(sl.value) }] },
      aria: `${info.label}: ${c.format(sl.value)} (${pct(sl.value)})`, datum: { label: sl.key, value: sl.value },
      rows: [...new Set((sl.merged ?? [sl.key]).flatMap(k => c.rowsBy([s.label], [k])))].sort((x, y) => x - y)
    })
    if (s.labels !== false) {
      const rm = r0 > 0 ? (R + r0) / 2 : R * 0.62
      const text = formatPercent(sl.value / total, c.locale, 0)
      const arcLen = sweep * rm
      const tw = c.measure(text, c.size)
      // The label must fit the ring across (slices at the sides are as wide as the text) and along the arc.
      if (arcLen > tw + 10 && R - r0 > Math.max(c.size * 2, tw + 10)) {
        const hex = sl.other ? c.theme.colors.other : c.seriesHex(sl.key, order.indexOf(sl.key))
        c.marks.push(c.text(cx + rm * Math.cos(mid), cy + rm * Math.sin(mid), text, { role: 'label', anchor: 'middle', baseline: 'middle', weight: 600, fill: inkOn(hex) }))
      }
    }
    a += sweep
  }
  if (r0 > 36 && total > 0) {
    const big = c.compact ? 18 : 24
    c.marks.push(c.text(cx, cy - 2, s.centerLabel ? clip(s.centerLabel, 24) : c.format(total), { role: 'label', anchor: 'middle', baseline: 'alphabetic', size: big, weight: 600, fill: c.c('text') }))
    if (!s.centerLabel) c.marks.push(c.text(cx, cy + c.size + 4, c.t('total'), { role: 'label', anchor: 'middle', baseline: 'alphabetic', fill: c.c('text-muted') }))
  }
  return { series }
}

/**
 * Cross-field checks of a pie or donut, on what the chart will draw (rows with the same label are summed, text that is
 * not a number is skipped, as in `slices`): `negative_slices` (rows below 0 are dropped), `pie_no_positive` (no label
 * adds up to more than 0: nothing can be drawn) and `zero_slices` (labels that add up to exactly 0 get no angle but stay
 * in the legend). All warnings; the chart is still drawn (with a message in the middle when nothing is positive).
 */
export function checkPie(spec: Record<string, any>, ctx: Pick<ValidateCtx, 'issues'>): void {
  const sums = new Map<string, number>()
  let negative = 0
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.value])
    if (v === null) continue
    if (v < 0) {
      negative++
      continue
    }
    const k = String(r[spec.label] ?? '')
    sums.set(k, (sums.get(k) ?? 0) + v)
  }
  const warn = (code: string, path: string, message: string, hint: string): void => { ctx.issues.push({ severity: 'warning', code, path, message, hint }) }
  if (negative) warn('negative_slices', 'data', `${negative} negative value(s) were skipped; a pie cannot show negatives.`, 'Use a bar chart for values that can be negative, or remove those rows with `transform`.')
  const values = [...sums.values()]
  if (!values.some(v => v > 0)) {
    warn('pie_no_positive', 'value', `No slice has a positive value, so the ${spec.type} has nothing to draw.`, `A ${spec.type} shows shares of a positive total: check the "${spec.value}" column, or use a bar chart for values that are zero or negative.`)
    return
  }
  const zero = values.filter(v => v === 0).length
  if (zero) warn('zero_slices', 'value', `${zero} slice(s) add up to 0: they get no angle and appear in the legend only.`, 'Remove those rows with `transform` to drop them from the legend too.')
}

const FIELDS: ChartDef['fields'] = {
  label: { kind: 'column', role: 'any', required: true, desc: 'Column naming each slice.' },
  value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each slice\'s size. Rows with the same label are summed; negatives are skipped.' },
  sort: { kind: 'enum', values: ['none', 'asc', 'desc'], default: 'desc', desc: 'Slice order. `desc` puts the biggest slice first; `none` keeps the data order.' },
  maxSlices: { kind: 'number', min: 2, max: 12, integer: true, default: 8, desc: 'Show at most this many slices; the smallest merge into "Other". Keeps colours distinguishable.' },
  labels: { kind: 'boolean', default: true, desc: 'Print each slice\'s percentage on it when it fits.' },
  centerLabel: { kind: 'string', max: 24, desc: 'Donut only: text in the hole (default: the total).' }
}

function describePie(spec: Record<string, any>, env: { locale: string }, name: string): string {
  const { all } = slices(spec)
  const total = all.reduce((q, a) => q + a.value, 0)
  const f = formatter(spec, env.locale)
  let t = `${lead(spec, name)} ${all.length} ${all.length === 1 ? 'slice' : 'slices'} totalling ${f(total)}.`
  if (total > 0) {
    const sorted = [...all].sort((a, b) => b.value - a.value)
    t += ` Largest: ${clip(sorted[0].key, 40)} (${formatPercent(sorted[0].value / total, env.locale)}).`
    if (sorted.length > 2) t += ` The top ${Math.min(3, sorted.length)} (${fmtList(sorted.slice(0, 3).map(x => clip(x.key, 30)), 3)}) make up ${formatPercent(sorted.slice(0, 3).reduce((q, x) => q + x.value, 0) / total, env.locale)}.`
  } else t += ' No slice has a positive value, so nothing is drawn.'
  return t
}

export const pie: ChartDef = {
  type: 'pie',
  name: 'Pie chart',
  summary: 'Shows each category\'s share of a whole as angles of a circle.',
  useWhen: 'Few (2-6) parts of one whole where the point is "who has the biggest share". Prefer a bar chart to compare sizes precisely or to show more than ~7 parts. Not for time or for values that do not add up to a whole.',
  cartesian: false,
  ref: { x: ['label'], y: ['value'], legend: 'label' },
  fields: {
    ...FIELDS,
    innerRadius: { kind: 'number', min: 0, max: 0.9, desc: 'Hole radius as a share of the outer radius. 0 for a pie. `donut` defaults to 0.62.' }
  },
  example: {
    type: 'pie', title: 'Where the budget goes', subtitle: 'Share of FY2026 operating spend',
    label: 'area', value: 'amount', format: 'currency:USD',
    data: [{ area: 'Engineering', amount: 5400000 }, { area: 'Sales', amount: 3100000 }, { area: 'Marketing', amount: 1900000 }, { area: 'Support', amount: 1200000 }, { area: 'G&A', amount: 900000 }]
  },
  check: checkPie,
  compile,
  describe: (spec, env) => describePie(spec, env, 'Pie chart')
}

export const donut: ChartDef = {
  ...pie,
  type: 'donut',
  name: 'Donut chart',
  summary: 'A pie chart with a hole; the hole shows the total.',
  useWhen: 'Same as a pie chart, when you also want to show the total in the middle.',
  example: { ...pie.example, type: 'donut', title: 'Traffic by source', subtitle: 'Sessions, last 30 days', label: 'source', value: 'sessions', format: 'compact', data: [{ source: 'Organic', sessions: 48200 }, { source: 'Direct', sessions: 21800 }, { source: 'Referral', sessions: 12400 }, { source: 'Social', sessions: 9300 }, { source: 'Email', sessions: 6100 }] },
  describe: (spec, env) => describePie(spec, env, 'Donut chart')
}
