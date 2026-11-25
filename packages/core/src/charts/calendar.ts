// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { toNumber } from '../util/num.js'
import { formatTime, formatWeekday, toTime, toWall } from '../util/time.js'
import { estimateWidth, fit } from '../util/text.js'
import { resolveTheme } from '../theme.js'
import { formatter, lead, seqLegend, seqScale } from './shared.js'

const DAY = 864e5
/** At most this many years get a row of their own; older years are left out with a warning. */
export const MAX_CALENDAR_YEARS = 5
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const yearOf = (day: number): number => new Date(day * DAY).getUTCFullYear()
const iso = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10)

const DATE_ONLY = /^\s*\d{4}-\d{2}(?:-\d{2})?\s*$/

/**
 * Sum of `value` per calendar day (day number = floor(ms / 86400000) of the date's midnight). Dates may be ISO
 * strings or epoch milliseconds; a time of day is dropped, so several readings on one day add up. Rows without a
 * date or a numeric value are skipped. With a `timeZone` other than UTC an instant (a timestamp, or an ISO string
 * with a time) counts on its local day there; a date-only string is already a calendar day and keeps it.
 */
export function calendarDays(rows: Record<string, unknown>[], x: string, value: string, timeZone = 'UTC', src?: Map<number, Record<string, unknown>[]>): Map<number, number> {
  const out = new Map<number, number>()
  for (const r of rows) {
    const raw = r[x]
    const t = toTime(raw)
    const v = toNumber(r[value])
    if (t === null || v === null) continue
    const d = Math.floor((typeof raw === 'string' && DATE_ONLY.test(raw) ? t : toWall(t, timeZone)) / DAY)
    out.set(d, (out.get(d) ?? 0) + v)
    if (src) src.set(d, [...(src.get(d) ?? []), r])
  }
  return out
}

function years(days: Map<number, number>): { all: number[]; shown: number[] } {
  const all = [...new Set([...days.keys()].map(yearOf))].sort((a, b) => a - b)
  return { all, shown: all.slice(-MAX_CALENDAR_YEARS) }
}

/** A row of weeks: the whole year, a few months, or (on a narrow chart) a part of a year. */
interface Seg { year: number; start: number; end: number; colStart: number; cols: number; first: boolean }

/** A cell this small or smaller is too small to read or touch: a year is cut into rows rather than drawn smaller. */
export const MIN_CALENDAR_CELL = 8

/**
 * One row per year (a single year shows only the months that have data, several show whole years so the same week
 * lines up from one row to the next), then each row wider than `maxCols` weeks cut into the fewest equal rows that fit.
 * `weekday(day)` is the row of a day in its week (0 = the first weekday). Pure: the layout and the default height read it.
 */
function segments(days: Map<number, number>, weekday: (d: number) => number, maxCols: number): Seg[] {
  const shown = years(days).shown
  const kept = [...days.keys()].filter(d => shown.includes(yearOf(d)))
  if (!kept.length) return []
  const first = Math.min(...kept)
  const last = Math.max(...kept)
  const out: Seg[] = []
  for (const y of shown) {
    let start = Date.UTC(y, 0, 1) / DAY
    let end = Date.UTC(y, 11, 31) / DAY
    if (shown.length === 1) {
      const a = new Date(first * DAY)
      const b = new Date(last * DAY)
      start = Date.UTC(y, a.getUTCMonth(), 1) / DAY
      end = Date.UTC(y, b.getUTCMonth() + 1, 0) / DAY
    }
    const colStart = start - weekday(start)
    const cols = Math.floor((end - colStart) / 7) + 1
    const rows = Math.ceil(cols / Math.max(1, maxCols))
    const per = Math.ceil(cols / rows)
    for (let k = 0; k < rows; k++) {
      const c0 = colStart + k * per * 7
      out.push({ year: y, start: Math.max(start, c0), end: Math.min(end, c0 + per * 7 - 1), colStart: c0, cols: Math.min(per, cols - k * per), first: k === 0 })
    }
  }
  return out
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const src = new Map<number, Record<string, unknown>[]>()
  const days = calendarDays(s.data, s.x, s.value, c.timeZone, src)
  const { shown } = years(days)
  const kept = [...days].filter(([d]) => shown.includes(yearOf(d)))
  const vals = kept.map(([, v]) => v)
  const dom = s.domain as [number | null, number | null] | undefined
  const lo = dom?.[0] ?? Math.min(...vals)
  const hi = dom?.[1] ?? Math.max(...vals)
  const color = seqScale(c, lo, hi)
  const frame = c.frame({ series: [] })
  const fmt = c.format
  const ws = s.weekStart === 'sunday' ? 0 : 1
  const weekday = (day: number): number => (new Date(day * DAY).getUTCDay() - ws + 7) % 7

  const size = c.size - 1
  const rowNames = [0, 1, 2, 3, 4, 5, 6].map(r => formatWeekday(((ws + r + 3) % 7) * DAY, 'short', c.locale))
  // Monday, Wednesday and Friday are labelled, as on a contribution graph.
  const labelRows = ws === 1 ? [0, 2, 4] : [1, 3, 5]
  const gutter = Math.max(...labelRows.map(r => c.measure(rowNames[r], size))) + 8
  const legendW = c.compact ? 0 : 72
  const headH = size + 8
  const gapY = 12
  // A narrow chart keeps its cells at least MIN_CALENDAR_CELL px: a year that would not fit is cut into rows of weeks.
  const maxCols = Math.max(8, Math.floor((frame.w - gutter - legendW) / MIN_CALENDAR_CELL))
  const segs = segments(days, weekday, maxCols)
  const cols = Math.max(...segs.map(p => p.cols))
  // Without room beside the weeks the colour scale goes in a row under them.
  const legendRow = legendW ? 0 : size + 14
  const heads = segs.reduce((q, p) => q + headH * (p.first ? 2 : 1) + gapY, 0) - gapY + legendRow
  const cellW = (frame.w - gutter - legendW) / cols
  const cellH = (frame.h - heads) / (7 * segs.length)
  const cell = Math.max(2, Math.min(24, cellW, cellH))
  if (cell < 6) c.warn('calendar_cramped', 'x', `Each day gets only ${Math.round(cell * 10) / 10} px.`, segs.length > 1 ? 'Make the chart larger or show fewer years with a `transform` filter.' : 'Make the chart larger.')
  const pad = cell >= 8 ? 2 : 1
  const r = Math.min(2, cell / 4)
  const empty = c.c('background')
  const grid = c.c('grid')
  const muted = c.c('text-muted')

  let y0 = frame.y
  for (const p of segs) {
    const x0 = frame.x + gutter
    // The year is named on its first row; a row that continues it (the second half) gets no caption of its own.
    if (p.first) c.marks.push(c.text(frame.x, y0, String(p.year), { role: 'title', baseline: 'hanging', weight: 600, fill: c.c('text'), size }))
    const monthsY = y0 + (p.first ? headH : 0)
    const top = monthsY + headH
    // Month labels at the week of the 1st, skipped when they would touch the one before.
    let lastEnd = -Infinity
    for (let m = 0; m < 12; m++) {
      const d = Date.UTC(p.year, m, 1) / DAY
      if (d < p.start || d > p.end) continue
      const label = formatTime(d * DAY, 'month', c.locale)
      // The last column's month is pulled in so its name stays inside the chart.
      const x = Math.min(x0 + Math.floor((d - p.colStart) / 7) * cell, frame.x + frame.w - c.measure(label, size))
      if (x < lastEnd + 4) continue
      c.marks.push(c.text(x, monthsY, label, { baseline: 'hanging', fill: muted, size }))
      lastEnd = x + c.measure(label, size)
    }
    for (const row of labelRows) {
      c.marks.push(c.text(frame.x + gutter - 6, top + row * cell + cell / 2, fit(rowNames[row], gutter - 6, size, c.env.measure), { anchor: 'end', baseline: 'middle', fill: muted, size }))
    }
    for (let d = p.start; d <= p.end; d++) {
      const x = x0 + Math.floor((d - p.colStart) / 7) * cell + pad / 2
      const y = top + weekday(d) * cell + pad / 2
      const w = cell - pad
      const v = days.get(d)
      if (v === undefined) {
        // No data is an outlined empty cell, not the colour of zero.
        c.marks.push({ type: 'rect', role: 'grid', x: x + 0.5, y: y + 0.5, w: Math.max(0, w - 1), h: Math.max(0, w - 1), r, fill: empty, stroke: grid, strokeWidth: 1 })
        continue
      }
      const fill = color(v)
      const date = formatTime(d * DAY, 'full', c.locale)
      c.marks.push({
        type: 'rect', role: 'data', x, y, w, h: w, r, fill, anim: 'fade',
        tip: { title: date, rows: [{ label: String(s.value), value: fmt(v), color: fill }, { label: c.t('weekday'), value: formatWeekday(d * DAY, 'long', c.locale) }] },
        aria: `${date}: ${fmt(v)}`, datum: { date: iso(d), value: v }, rows: c.rowsOf(src.get(d) ?? [])
      })
    }
    y0 = top + 7 * cell + gapY
  }

  if (legendW) {
    const x = frame.x + gutter + cols * cell + 22
    const h = Math.max(40, Math.min(y0 - gapY - frame.y - headH * 2, 120))
    const ly = frame.y + headH * 2
    seqLegend(c, x, ly, h, lo, hi)
    c.marks.push({ type: 'rect', role: 'legend', x: x + 0.5, y: ly + h + 10.5, w: 11, h: 11, r: 2, fill: empty, stroke: grid, strokeWidth: 1 })
    c.marks.push(c.text(x + 18, ly + h + 16, c.t('noData'), { role: 'legend', baseline: 'middle', size }))
  } else {
    // Narrow: the lowest value, five steps of the scale, the highest, and the "no data" cell, in one row under the weeks.
    const ly = y0 - gapY + 10 + size / 2
    const x1 = frame.x + gutter
    const lowT = fmt(lo)
    const highT = fmt(hi)
    let x = x1
    c.marks.push(c.text(x, ly, lowT, { role: 'legend', baseline: 'middle', size }))
    x += c.measure(lowT, size) + 6
    for (let i = 0; i < 5; i++) {
      c.marks.push({ type: 'rect', role: 'legend', x: x + i * 12, y: ly - 5, w: 11, h: 10, r: 2, fill: color(lo + ((hi - lo) * i) / 4) })
    }
    x += 5 * 12 + 4
    c.marks.push(c.text(x, ly, highT, { role: 'legend', baseline: 'middle', size }))
    x += c.measure(highT, size) + 16
    c.marks.push({ type: 'rect', role: 'legend', x: x + 0.5, y: ly - 4.5, w: 10, h: 10, r: 2, fill: empty, stroke: grid, strokeWidth: 1 })
    c.marks.push(c.text(x + 16, ly, fit(c.t('noData'), Math.max(20, frame.x + frame.w - x - 16), size, c.env.measure), { role: 'legend', baseline: 'middle', size }))
  }
  return { series: [] }
}

export const calendar: ChartDef = {
  type: 'calendar',
  name: 'Calendar heatmap',
  summary: 'One cell per day, weeks as columns and weekdays as rows, coloured by a number: a year of activity at a glance.',
  useWhen: 'Daily values over months or years where weekly rhythm and streaks matter (commits, sales per day, sleep, energy use). Days without data stay empty, distinct from zero. Not for a few weeks (use a bar or line chart) or more than 5 years.',
  cartesian: false,
  ref: { x: ['x'], y: ['value'] },
  fields: {
    x: { kind: 'column', role: 'x', required: true, desc: 'Date column: ISO dates ("2026-03-14") or epoch milliseconds. A time of day is dropped and rows on the same day are summed. Instants (timestamps, ISO strings with a time) count on their day in the render time zone (UTC by default); date-only strings keep their date.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each day\'s colour.' },
    weekStart: { kind: 'enum', values: ['monday', 'sunday'], default: 'monday', desc: 'First weekday, the top row.' },
    domain: { kind: 'domain', desc: 'Fix the colour scale range, e.g. [0, 20], to compare several calendars.' }
  },
  example: {
    type: 'calendar', title: 'Commits per day', subtitle: '2026, one repository', x: 'date', value: 'commits',
    data: Array.from({ length: 365 }, (_, i) => {
      const t = Date.UTC(2026, 0, 1) + i * DAY
      const wd = new Date(t).getUTCDay()
      const u = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1
      return { date: new Date(t).toISOString().slice(0, 10), commits: wd === 0 || wd === 6 ? Math.round(u * 2) : Math.round(2 + u * 8 + (i > 150 && i < 200 ? 4 : 0)) }
    }).filter((_, i) => i % 23 !== 5)
  },
  check(spec, ctx) {
    const x = spec.x as string
    let seen = 0
    let bad = 0
    for (const r of ctx.rows) {
      const v = r[x]
      if (v === null || v === undefined || v === '') continue
      seen++
      if (toTime(v) === null) bad++
    }
    if (seen && bad === seen) ctx.issues.push({ severity: 'error', code: 'not_time', path: 'x', message: `Column "${x}" has no dates.`, hint: 'Use ISO dates such as "2026-03-14" or epoch milliseconds.' })
    else if (bad) ctx.issues.push({ severity: 'warning', code: 'some_not_time', path: 'x', message: `${bad} of ${seen} values in "${x}" are not dates and will be skipped.` })
    const days = calendarDays(ctx.rows, x, spec.value as string)
    if (seen && bad < seen && !days.size) ctx.issues.push({ severity: 'error', code: 'no_values', path: 'value', message: 'No row has both a date and a numeric value.' })
    const ys = years(days)
    if (ys.all.length > MAX_CALENDAR_YEARS) ctx.issues.push({ severity: 'warning', code: 'too_many_years', path: 'x', message: `The data spans ${ys.all.length} years; only the last ${MAX_CALENDAR_YEARS} (${ys.shown[0]} to ${ys.shown[ys.shown.length - 1]}) are drawn.`, hint: 'Filter with `transform`, or aggregate to weeks or months and use a line or bar chart.' })
    if (spec.patterns === true) ctx.issues.push({ severity: 'warning', code: 'patterns_unsupported', path: 'patterns', message: 'A calendar has one colour scale and no series, so patterns is ignored.' })
  },
  height(spec, width) {
    // Only when a year had to be cut into rows (a narrow chart): the rows need a taller box than the width-based default.
    if (!Array.isArray(spec.data) || typeof spec.x !== 'string' || typeof spec.value !== 'string') return undefined
    const days = calendarDays(spec.data, spec.x, spec.value)
    const theme = resolveTheme('light')
    const compact = width < 420
    const ws = spec.weekStart === 'sunday' ? 0 : 1
    const weekday = (day: number): number => (new Date(day * DAY).getUTCDay() - ws + 7) % 7
    const body = (compact ? theme.fontSize - 1 : theme.fontSize)
    const size = body - 1
    const pad = compact ? 12 : 16
    const gutter = estimateWidth('Wed', size) + 8
    const legendW = compact ? 0 : 72
    const inner = width - pad * 2
    const segs = segments(days, weekday, Math.max(8, Math.floor((inner - gutter - legendW) / MIN_CALENDAR_CELL)))
    if (segs.length <= years(days).shown.length) return undefined
    const headH = size + 8
    const heads = segs.reduce((q, p) => q + headH * (p.first ? 2 : 1) + 12, 0) - 12 + (legendW ? 0 : size + 14)
    const cell = Math.min(24, (inner - gutter - legendW) / Math.max(...segs.map(p => p.cols)))
    const chrome = pad * 2 + (spec.title ? (compact ? theme.titleSize - 2 : theme.titleSize) * 1.3 : 0) + (spec.subtitle ? body * 1.5 + 2 : 0) + (spec.title || spec.subtitle ? 8 : 0) + (spec.source ? body + 6 : 0)
    return Math.ceil(chrome + heads + 7 * cell * segs.length)
  },
  compile,
  describe(spec, env) {
    const f = formatter(spec, env.locale)
    const all = calendarDays(spec.data, spec.x, spec.value, env.timeZone)
    const ys = years(all)
    const kept = [...all].filter(([d]) => ys.shown.includes(yearOf(d))).sort((a, b) => a[0] - b[0])
    if (!kept.length) return `${lead(spec, 'Calendar heatmap')} No days with data.`
    const date = (d: number): string => formatTime(d * DAY, 'full', env.locale)
    const first = kept[0][0]
    const last = kept[kept.length - 1][0]
    const span = last - first + 1
    const total = kept.reduce((q, [, v]) => q + v, 0)
    const max = kept.reduce((a, b) => (b[1] > a[1] ? b : a))
    const min = kept.reduce((a, b) => (b[1] < a[1] ? b : a))
    let t = `${lead(spec, 'Calendar heatmap')} ${kept.length} days with data from ${date(first)} to ${date(last)}, coloured by ${spec.value}, totalling ${f(total)}.`
    if (span > kept.length) t += ` ${span - kept.length} days in that span have no data.`
    t += ` Highest: ${date(max[0])} (${f(max[1])}). Lowest: ${date(min[0])} (${f(min[1])}).`
    const sums = [0, 0, 0, 0, 0, 0, 0]
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (const [d, v] of kept) {
      const w = new Date(d * DAY).getUTCDay()
      sums[w] += v
      counts[w]++
    }
    const avg = sums.map((q, i) => (counts[i] ? q / counts[i] : null))
    const ranked = avg.map((v, i) => ({ v, i })).filter((a): a is { v: number; i: number } => a.v !== null).sort((a, b) => b.v - a.v || a.i - b.i)
    if (ranked.length > 1) t += ` On average ${WEEKDAYS[ranked[0].i]} is highest (${f(ranked[0].v)}) and ${WEEKDAYS[ranked[ranked.length - 1].i]} lowest (${f(ranked[ranked.length - 1].v)}).`
    if (ys.all.length > ys.shown.length) t += ` Only the last ${ys.shown.length} of ${ys.all.length} years are drawn.`
    return t
  }
}
