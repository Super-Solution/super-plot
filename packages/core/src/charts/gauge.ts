// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, SeriesInfo, Tip } from '../scene.js'
import type { Row, ValidateCtx } from '../schema.js'
import { xKey } from '../data.js'
import { niceDomain, r2, toNumber } from '../util/num.js'
import { formatPercent } from '../util/format.js'
import { clip, fit } from '../util/text.js'
import { arc, fmtList, formatter, lead } from './shared.js'

/** At most this many gauges in one chart (one per row); the rest are left out with a warning. */
export const MAX_GAUGES = 6

export interface GaugeBand { name: string; from: number; to: number; tone: 'negative' | 'warning' | 'positive' }

export interface GaugeItem {
  key: string
  value: number | null
  target: number | null
  /** Bands in order along the arc, from `min`; each ends at its column's threshold (sorted ascending). */
  bands: GaugeBand[]
  /** The row it came from. */
  row?: Record<string, unknown>
}

export interface GaugeScale {
  min: number
  max: number
  /** True when `max` was not given and was rounded up from the largest value (see {@link gaugeScale}). */
  derived: boolean
  /** The largest of every value, target and threshold (what a derived `max` is rounded up from). */
  largest: number | null
}

const cols = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])

/** Tones of 2 or 3 bands, worst first: critical (negative), warning, good (positive). */
const TONES: Record<number, GaugeBand['tone'][]> = { 2: ['negative', 'positive'], 3: ['negative', 'warning', 'positive'] }

/**
 * One gauge per row, in data order, at most {@link MAX_GAUGES}; a repeated `label` keeps its first row. Band
 * thresholds are read from the `bands` columns of each row, sorted ascending (unordered ones are reported), and
 * named by their column. Tones go worst first along the arc (`bandOrder: "worst-first"`, the default) or best first.
 */
export function gaugeItems(spec: Record<string, any>): { items: GaugeItem[]; extra: number; duplicates: number; unordered: string[] } {
  const rows = spec.data as Row[]
  const names = cols(spec.bands)
  const tones = TONES[names.length] ?? []
  const order = spec.bandOrder === 'best-first' ? [...tones].reverse() : tones
  const seen = new Set<string>()
  const items: GaugeItem[] = []
  const unordered: string[] = []
  let duplicates = 0
  let extra = 0
  rows.forEach((r, i) => {
    // Without `label` (one row) the gauge is named by its value column.
    const key = typeof spec.label === 'string' ? xKey(r[spec.label]) : i ? `${spec.value} ${i + 1}` : String(spec.value)
    if (seen.has(key)) {
      duplicates++
      return
    }
    seen.add(key)
    if (items.length >= MAX_GAUGES) {
      extra++
      return
    }
    const given = names.flatMap(n => {
      const v = toNumber(r[n])
      return v === null ? [] : [[n, v] as [string, number]]
    })
    if (given.some((g, j) => j && g[1] < given[j - 1][1])) unordered.push(key)
    const sorted = [...given].sort((a, b) => a[1] - b[1])
    // Tones follow the column order (worst first), not the sorted order, so a band keeps its meaning.
    const toneOf = new Map(names.map((n, j) => [n, order[j]]))
    items.push({ row: r, key, value: toNumber(r[spec.value]), target: typeof spec.target === 'string' ? toNumber(r[spec.target]) : null, bands: [] })
    let prev = -Infinity
    for (const [n, t] of sorted) {
      items[items.length - 1].bands.push({ name: n, from: prev, to: t, tone: toneOf.get(n) ?? 'warning' })
      prev = t
    }
  })
  return { items, extra, duplicates, unordered }
}

/**
 * The value range of every gauge: `min` (default 0) to `max`. Without `max`, it is the top of
 * `niceDomain(min, largest, 5)` where `largest` is the largest value, target or band threshold of the drawn
 * rows: a round number at or above the data, so the arc's full length then means "the data's own top", not a
 * capacity or a goal (a `max_derived` warning says so). `largest` at or below `min` gives no range (null max).
 */
export function gaugeScale(spec: Record<string, any>, items: GaugeItem[]): GaugeScale & { ok: boolean } {
  const min = typeof spec.min === 'number' ? spec.min : 0
  let largest: number | null = null
  for (const it of items) for (const v of [it.value, it.target, ...it.bands.map(b => b.to)]) if (v !== null && (largest === null || v > largest)) largest = v
  if (typeof spec.max === 'number') return { min, max: spec.max, derived: false, largest, ok: spec.max > min }
  if (largest === null || largest <= min) return { min, max: min, derived: true, largest, ok: false }
  return { min, max: niceDomain(min, largest, 5)[1], derived: true, largest, ok: true }
}

/** Where `v` falls: the first band whose threshold reaches it (from `min`), or null when above every band. */
const bandOf = (it: GaugeItem, v: number): GaugeBand | null => it.bands.find(b => v <= b.to) ?? null

/** The share of the range the arc shows for `v`: clamped to 0..1, so a value outside the range fills nothing or everything. */
const shareOf = (v: number, s: GaugeScale): number => Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min)))

function compile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const { items } = gaugeItems(s)
  const sc = gaugeScale(s, items)
  const vKey = String(s.value)
  const tKey = typeof s.target === 'string' ? s.target : undefined
  const colors = (s.colors ?? {}) as Record<string, string>
  const series: SeriesInfo[] = [{ key: vKey, label: clip(vKey, 60), color: c.seriesColor(vKey, 0), hidden: c.hidden.has(vKey) }]
  if (tKey && tKey !== vKey) series.push({ key: tKey, label: clip(tKey, 60), color: colors[tKey] ?? c.c('text'), hidden: c.hidden.has(tKey) })
  const vColor = series[0].color
  const tColor = series[1]?.color ?? c.c('text')
  const f = c.format
  const area = c.frame({ series, autoSide: 'top' })
  if (!sc.ok) return { series }
  const span = Math.max(1, Math.min(360, (s.arc ?? 240) as number)) * Math.PI / 180
  // The gap is centred at the bottom; angles grow clockwise on screen (y points down).
  const a0 = Math.PI * 1.5 - span / 2
  const a1 = a0 + span
  const low = Math.max(0, Math.sin(a0))
  const at = (v: number): number => a0 + span * shareOf(v, sc)
  const range = c.t('fromTo', { from: f(sc.min), to: f(sc.max) })

  const n = Math.max(1, items.length)
  const small = Math.max(9, c.size - 2)
  const hasBands = items.some(it => it.bands.length > 0)
  const named = typeof s.label === 'string'
  const bandLabelW = hasBands ? Math.max(0, ...items.flatMap(it => it.bands.map(b => c.measure(clip(b.name, 16), small)))) : 0
  // Pick the grid (columns x rows) that gives the largest gauges.
  let best = { cols: 1, R: -Infinity }
  for (let k = 1; k <= n; k++) {
    const rows = Math.ceil(n / k)
    const cw = area.w / k
    const ch = area.h / rows
    const mx = hasBands ? Math.min(cw * 0.22, bandLabelW + 8) : 4
    const my = hasBands ? small + 6 : 4
    const R = Math.min((cw - mx * 2) / 2, (ch - my - small - 8 - (named ? c.size + 4 : 0)) / (1 + Math.max(low, 0.5)))
    if (R > best.R + 1e-9) best = { cols: k, R }
  }
  const gridCols = best.cols
  const gridRows = Math.ceil(n / gridCols)
  const cw = area.w / gridCols
  const ch = area.h / gridRows
  const R = Math.max(16, best.R)
  if (best.R < 40) c.warn('gauge_cramped', 'data', `${n} gauge(s) leave each a radius of about ${Math.max(0, Math.round(best.R))} px.`, 'Make the chart larger, or show fewer rows.')
  const bandW = hasBands ? Math.max(3, Math.round(R * 0.06)) : 0
  const outer = hasBands ? R - bandW - 2 : R
  const thick = Math.max(6, Math.min(R * 0.18, outer - 6))
  const inner = outer - thick
  const big = Math.round(Math.max(14, Math.min(40, R * 0.36)))
  const my = hasBands ? small + 6 : 4
  const blockH = R * (1 + Math.max(low, 0.5)) + small + 8 + (named ? c.size + 4 : 0)

  const tipOf = (it: GaugeItem): Tip => {
    const rows: Tip['rows'] = []
    rows.push({ label: series[0].label, value: it.value === null ? '–' : f(it.value), color: vColor })
    if (it.target !== null && tKey) rows.push({ label: clip(tKey, 60), value: f(it.target), color: tColor })
    if (it.value !== null) rows.push({ label: c.t('ofRange'), value: formatPercent(shareOf(it.value, sc), c.locale) })
    rows.push({ label: c.t('range'), value: range })
    for (const b of it.bands) rows.push({ label: clip(b.name, 40), value: c.t('upTo', { value: f(b.to) }) })
    if (it.value !== null && it.bands.length) {
      const b = bandOf(it, it.value)
      rows.push({ label: c.t('band'), value: clip(b ? b.name : c.t('aboveEveryBand'), 40) })
    }
    if (it.value !== null && (it.value > sc.max || it.value < sc.min)) rows.push({ label: c.t('note'), value: it.value > sc.max ? c.t('aboveMax', { max: f(sc.max) }) : c.t('belowMin', { min: f(sc.min) }) })
    return { title: clip(it.key, 60), rows }
  }
  const ariaOf = (it: GaugeItem): string => {
    if (it.value === null) return `${it.key}: ${c.t('noValue', { name: vKey })}`
    const parts = [c.t('gaugeAria', { value: f(it.value), share: formatPercent(shareOf(it.value, sc), c.locale), range })]
    if (it.value > sc.max) parts.push(c.t('aboveMax', { max: f(sc.max) }))
    if (it.value < sc.min) parts.push(c.t('belowMin', { min: f(sc.min) }))
    if (it.bands.length) {
      const b = bandOf(it, it.value)
      parts.push(b ? c.t('inBandAria', { band: b.name }) : c.t('aboveEveryBand'))
    }
    if (it.target !== null && tKey) parts.push(`${tKey} ${f(it.target)}`)
    return `${it.key}: ${parts.join(', ')}`
  }

  const datumOf = (it: GaugeItem): Record<string, unknown> => {
    const b = it.value === null ? null : bandOf(it, it.value)
    return { label: it.key, value: it.value, min: sc.min, max: sc.max, share: it.value === null ? null : shareOf(it.value, sc), target: it.target, ...(it.bands.length ? { band: b?.name ?? null } : {}) }
  }

  const marks: Mark[] = []
  items.forEach((it, i) => {
    // An incomplete last row is centred.
    const row = Math.floor(i / gridCols)
    const inRow = row === gridRows - 1 ? n - row * gridCols : gridCols
    const cx = area.x + ((gridCols - inRow) * cw) / 2 + (i % gridCols) * cw + cw / 2
    const top = area.y + Math.floor(i / gridCols) * ch
    const cy = top + Math.max(0, (ch - blockH) / 2) + my + R
    // The track: the whole range, in a neutral tone.
    marks.push({ type: 'path', role: 'grid', d: arc(cx, cy, inner, outer, a0, a1), fill: c.c('grid') })
    // Bands: a thin ring outside the track, each in its status tone and named in text beside it. No tooltip of
    // their own (that would add three keyboard stops per gauge): the gauge's tooltip names the band of the value.
    for (const b of it.bands) {
      const from = Math.max(sc.min, b.from)
      const to = Math.min(sc.max, b.to)
      if (!(to > from)) continue
      const b0 = at(from)
      const b1 = at(to)
      const text = c.t('fromTo', { from: b.from === -Infinity ? f(sc.min) : f(b.from), to: f(b.to) })
      marks.push({ type: 'path', role: 'annotation', d: arc(cx, cy, R - bandW, R, b0, b1), fill: c.c(b.tone), aria: `${b.name}: ${text}` })
      const mid = (b0 + b1) / 2
      const cos = Math.cos(mid)
      const sin = Math.sin(mid)
      const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
      const room = anchor === 'middle' ? Math.max(24, (b1 - b0) * R) : Math.max(24, cw / 2 - R - 6)
      marks.push(c.text(cx + (R + 4) * cos, cy + (R + 4) * sin, fit(clip(b.name, 16), room, small, c.env.measure), { role: 'label', size: small, anchor, baseline: sin < -0.25 ? 'alphabetic' : sin > 0.25 ? 'hanging' : 'middle', fill: c.c('text-muted') }))
    }
    const rows = c.rowsOf(it.row ? [it.row] : [])
    // The value: a filled arc whose length is the value's share of the range, always from `min`.
    if (it.value !== null && !c.hidden.has(vKey)) {
      const av = at(it.value)
      if (av > a0 + 1e-9) marks.push({ type: 'path', role: 'data', series: vKey, d: arc(cx, cy, inner, outer, a0, av), fill: vColor, anim: 'fade', datum: datumOf(it), rows })
    }
    if (it.target !== null && tKey && !c.hidden.has(tKey)) {
      const ta = at(it.target)
      marks.push({ type: 'line', role: 'data', series: tKey, x1: r2(cx + (inner - 3) * Math.cos(ta)), y1: r2(cy + (inner - 3) * Math.sin(ta)), x2: r2(cx + (outer + 3) * Math.cos(ta)), y2: r2(cy + (outer + 3) * Math.sin(ta)), stroke: tColor, strokeWidth: 3, rows })
    }
    // One transparent shape over the whole track carries the tooltip, the spoken name and the datum, so the
    // gauge answers hover and keyboard focus even when its value is at the minimum (no filled arc).
    marks.push({ type: 'path', role: 'data', d: arc(cx, cy, inner, outer, a0, a1), fill: 'transparent', tip: tipOf(it), aria: ariaOf(it), datum: datumOf(it), rows })

    // The number, printed truthfully even when the arc is clamped.
    const numberY = span <= Math.PI * 1.1 ? cy - big * 0.45 : cy
    const number = it.value === null ? '–' : f(it.value)
    // A long number gets a smaller font, never an ellipsis: the printed value is the exact one.
    const numberRoom = Math.max(30, inner * 1.6)
    const numberW = c.measure(number, big, 600)
    const numberSize = numberW > numberRoom ? Math.max(small, Math.floor((big * numberRoom) / numberW)) : big
    marks.push(c.text(cx, numberY, number, { role: 'label', anchor: 'middle', baseline: 'middle', size: numberSize, weight: 600, fill: c.c('text') }))
    let y = numberY + big / 2 + 4
    if (named) {
      marks.push(c.text(cx, y, fit(clip(it.key, 60), Math.max(30, inner * 1.7), c.size, c.env.measure, 500), { role: 'label', anchor: 'middle', baseline: 'hanging', weight: 500, fill: c.c('text') }))
      y += c.size + 4
    }
    let note = ''
    if (it.value !== null && it.value > sc.max) note = c.t('aboveMax', { max: f(sc.max) })
    else if (it.value !== null && it.value < sc.min) note = c.t('belowMin', { min: f(sc.min) })
    else if (it.value !== null && it.bands.length) {
      const b = bandOf(it, it.value)
      note = b ? b.name : c.t('aboveEveryBand')
    }
    if (note) marks.push(c.text(cx, y, fit(clip(note, 60), Math.max(30, inner * 1.7), small, c.env.measure), { role: 'label', anchor: 'middle', baseline: 'hanging', size: small }))
    // The two ends of the range, under the ends of the arc.
    const mid = (inner + outer) / 2
    const end = (a: number, v: number, anchor: 'start' | 'middle' | 'end'): void => {
      marks.push(c.text(cx + mid * Math.cos(a), cy + mid * Math.sin(a) + thick / 2 + 4, f(v), { role: 'axis-label', anchor, baseline: 'hanging', size: small }))
    }
    const wide = span > Math.PI * 1.5
    end(a0, sc.min, wide ? 'end' : 'middle')
    end(a1, sc.max, wide ? 'start' : 'middle')
  })
  c.marks.push(...marks)
  return { series }
}

function check(spec: Record<string, any>, ctx: ValidateCtx): void {
  const push = (severity: 'error' | 'warning', code: string, path: string, message: string, hint?: string): void => { ctx.issues.push({ severity, code, path, message, ...(hint ? { hint } : {}) }) }
  if (ctx.rows.length > 1 && typeof spec.label !== 'string') {
    return push('error', 'missing_required', 'label', `There are ${ctx.rows.length} rows, so ${ctx.rows.length} gauges: give \`label\`, the column that names each one.`, 'Or filter to one row with `transform`.')
  }
  const min = typeof spec.min === 'number' ? spec.min : 0
  if (typeof spec.max === 'number' && spec.max <= min) return push('error', 'bad_range', 'max', `max (${spec.max}) must be above min (${min}).`, 'Set `min` too when the whole range is negative.')
  const all = { ...spec, data: ctx.rows }
  const { items, extra, duplicates, unordered } = gaugeItems(all)
  const sc = gaugeScale(all, items)
  if (!sc.ok) return push('error', 'max_required', 'max', `Every value is at or below min (${sc.min}), so no range can be derived.`, 'Give `max`: the capacity or goal the arc stands for.')
  if (sc.derived) push('warning', 'max_derived', 'max', `No max was given; the arc ends at ${sc.max}, rounded up from the largest value (${sc.largest}). The share of the arc then says nothing about capacity or a goal.`, 'Set `max` to what a full arc means (100%, the capacity, the plan).')
  if (extra) push('warning', 'too_many_gauges', 'data', `${extra + MAX_GAUGES} gauges; only the first ${MAX_GAUGES} are drawn.`, 'Use a bullet chart (`type: "bullet"`) to compare many measures, or filter with `transform`.')
  if (duplicates) push('warning', 'duplicate_measures', 'label', `${duplicates} row(s) repeat a gauge label; only the first row of each is drawn.`)
  if (unordered.length) push('warning', 'bands_not_increasing', 'bands', `The thresholds of ${unordered.slice(0, 3).map(k => `"${clip(k, 40)}"`).join(', ')} do not increase in column order; they were sorted (each band keeps its tone).`, 'List band columns in order along the arc, each threshold higher than the one before.')
  const out = items.filter(it => it.value !== null && (it.value < sc.min || it.value > sc.max))
  if (out.length) push('warning', 'value_outside_range', 'value', `${fmtList(out.map(it => `"${clip(it.key, 30)}" (${it.value})`), 3)} ${out.length === 1 ? 'is' : 'are'} outside ${sc.min} to ${sc.max}: the arc is clamped (full or empty) and the number shows the true value.`, 'Widen `min`/`max` if the range is wrong.')
  const tout = items.filter(it => it.target !== null && (it.target < sc.min || it.target > sc.max))
  if (tout.length) push('warning', 'target_outside_range', 'target', `The target of ${fmtList(tout.map(it => `"${clip(it.key, 30)}"`), 3)} is outside ${sc.min} to ${sc.max}; its tick sits at the end of the arc.`)
}

function describe(spec: Record<string, any>, env: { locale: string }): string {
  const { items, extra } = gaugeItems(spec)
  const sc = gaugeScale(spec, items)
  const f = formatter(spec, env.locale)
  const n = items.length
  let t = `${lead(spec, 'Gauge')} ${n === 1 ? 'One value' : `${n} values`} on ${n === 1 ? 'an arc' : 'arcs'} from ${f(sc.min)} to ${f(sc.max)}${sc.derived ? ' (the maximum was rounded up from the data, not given)' : ''}; a filled arc's length is the value's share of that range.`
  for (const it of items) {
    const name = clip(it.key, 30)
    if (it.value === null) {
      t += ` ${name}: no value.`
      continue
    }
    t += ` ${name}: ${f(it.value)}`
    if (it.value > sc.max) t += `, above the maximum of ${f(sc.max)} (the arc is full)`
    else if (it.value < sc.min) t += `, below the minimum of ${f(sc.min)} (the arc is empty)`
    else t += `, ${formatPercent(shareOf(it.value, sc), env.locale)} of the range`
    if (it.bands.length) {
      const b = bandOf(it, it.value)
      t += b ? `, in band "${clip(b.name, 30)}" (${b.from === -Infinity ? `up to ${f(b.to)}` : `${f(b.from)} to ${f(b.to)}`})` : ', above every band'
    }
    if (it.target !== null) t += `, target ${f(it.target)}`
    t += '.'
  }
  if (extra) t += ` ${extra} more ${extra === 1 ? 'row is' : 'rows are'} not drawn.`
  return t
}

export const gauge: ChartDef = {
  type: 'gauge',
  name: 'Gauge',
  summary: 'Shows one value (or up to six, one per row) as the filled length of an arc between a minimum and a maximum, with an optional target tick and named status bands.',
  useWhen: 'A single headline value against a known range or capacity (utilisation, a score out of 100), on a dashboard where the arc shape is expected. A stat tile reads faster for a lone number, and a one-row `bullet` chart compares a value with a target and ranges more precisely in less space; use a `bullet` or `bar` chart to compare more than a few measures. Always give `max`: a derived one only says "the top of the data".',
  cartesian: false,
  ref: { x: ['label'], y: ['value'] },
  fields: {
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column with the value of each gauge. A value outside `min`..`max` is clamped on the arc but printed as it is.' },
    label: { kind: 'column', role: 'any', desc: 'Column naming each gauge; required with more than one row (one gauge per row, at most 6, in data order).' },
    min: { kind: 'number', default: 0, desc: 'Start of the range: where every arc starts filling.' },
    max: { kind: 'number', desc: 'End of the range: what a full arc means (100%, the capacity, the plan). Without it the top is rounded up from the largest value, with a `max_derived` warning.' },
    target: { kind: 'column', role: 'number', desc: 'Numeric column with a target, drawn as a tick across the arc.' },
    bands: { kind: 'columns', role: 'number', min: 2, max: 3, desc: 'Two or three columns holding the upper threshold of each status band, in order along the arc from `min`, e.g. ["critical","warning","good"]. Each band is named by its column (printed beside it) and coloured with the theme\'s negative, warning and positive tones per `bandOrder`.' },
    bandOrder: { kind: 'enum', values: ['worst-first', 'best-first'], default: 'worst-first', desc: '`worst-first`: the first band is critical and the last good (higher is better); `best-first` for measures where lower is better (latency, load).' },
    arc: { kind: 'number', min: 90, max: 330, integer: true, default: 240, desc: 'Sweep of the arc in degrees, open at the bottom: 180 is a half circle.' }
  },
  example: {
    type: 'gauge',
    title: 'Cluster utilisation',
    subtitle: 'Share of provisioned capacity in use, now',
    label: 'resource', value: 'used', target: 'plan', bands: ['good', 'busy', 'saturated'], bandOrder: 'best-first',
    min: 0, max: 1, format: 'percent',
    data: [
      { resource: 'CPU', used: 0.72, plan: 0.7, good: 0.6, busy: 0.85, saturated: 1 },
      { resource: 'Memory', used: 0.54, plan: 0.7, good: 0.6, busy: 0.85, saturated: 1 },
      { resource: 'Disk', used: 0.91, plan: 0.7, good: 0.6, busy: 0.85, saturated: 1 }
    ]
  },
  check,
  compile,
  describe
}
