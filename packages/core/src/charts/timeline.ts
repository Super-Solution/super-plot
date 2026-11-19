import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, SeriesInfo, Tip } from '../scene.js'
import type { Row } from '../schema.js'
import { LIMITS } from '../schema.js'
import { bandScale, linearScale } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis, warnZoneDates } from '../cartesian.js'
import { detectXKind, distinct, xKey } from '../data.js'
import { toNumber } from '../util/num.js'
import { formatDuration, formatTime, hasTimeOfDay, toTime } from '../util/time.js'
import { clip, fit } from '../util/text.js'
import { inkOn } from '../util/color.js'
import { valueFormatter } from '../util/format.js'
import { DEFAULT_STRINGS } from '../strings.js'
import { fmtList, lead } from './shared.js'

const DAY = 864e5

export interface TimelineItem {
  lane: string
  start: number
  end: number
  series: string
  label: string | null
  /** Start and end were given the other way round and were swapped. */
  swapped: boolean
}

export interface TimelineData {
  items: TimelineItem[]
  kind: 'time' | 'linear' | 'category'
  /** Lanes in order of first appearance (all of them; the chart draws the first `LIMITS.maxCategories`). */
  lanes: string[]
  /** Rows without a usable start or end. */
  skipped: number
  reversed: number
  /** Lanes in which two ranges overlap (they would hide each other). */
  overlapping: string[]
}

/**
 * The ranges of a timeline spec: one item per row with a start and an end in the same units (dates or numbers).
 * Ends before starts are swapped (and counted); rows missing either end are skipped (and counted).
 */
export function timelineItems(spec: Record<string, any>): TimelineData {
  const rows = (spec.data ?? []) as Row[]
  const kind = detectXKind(spec.xType, rows.flatMap(r => [r[spec.start], r[spec.end]]))
  const items: TimelineItem[] = []
  let skipped = 0
  let reversed = 0
  if (kind !== 'category') for (const r of rows) {
    const read = (v: unknown): number | null => (kind === 'time' ? toTime(v) : toNumber(v))
    const a = read(r[spec.start])
    const b = read(r[spec.end])
    if (a === null || b === null) {
      skipped++
      continue
    }
    const swapped = b < a
    if (swapped) reversed++
    items.push({ lane: xKey(r[spec.y]), start: Math.min(a, b), end: Math.max(a, b), series: spec.series ? xKey(r[spec.series]) : String(spec.y), label: spec.label ? clip(xKey(r[spec.label]), 60) : null, swapped })
  }
  const lanes = distinct(items.map(i => i.lane))
  const overlapping: string[] = []
  const byLane = new Map<string, TimelineItem[]>()
  for (const it of items) {
    let l = byLane.get(it.lane)
    if (!l) byLane.set(it.lane, (l = []))
    l.push(it)
  }
  for (const [lane, list] of byLane) {
    const sorted = [...list].sort((p, q) => p.start - q.start || p.end - q.end)
    let reach = -Infinity
    for (const it of sorted) {
      if (it.start < reach) {
        overlapping.push(lane)
        break
      }
      reach = Math.max(reach, it.end)
    }
  }
  return { items, kind, lanes, skipped, reversed, overlapping }
}

function compile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const data = timelineItems(s)
  const lanes = data.lanes.slice(0, LIMITS.maxCategories)
  const shownLanes = new Set(lanes)
  const items = data.items.filter(i => shownLanes.has(i.lane))
  const time = data.kind === 'time'
  const keys = distinct(items.map(i => i.series))
  const series = c.makeSeries(keys)
  const colorOf = new Map(series.map(x => [x.key, x.color]))
  const hexOf = new Map(keys.map((k, i) => [k, c.seriesHex(k, i)]))

  // x range: the data's, unless fixed (or zoomed) with xDomain.
  const xd = s.xDomain as [number | null, number | null] | undefined
  const xFixed = !!xd && (xd[0] !== null || xd[1] !== null)
  let d0 = Math.min(...items.map(i => i.start))
  let d1 = Math.max(...items.map(i => i.end))
  if (xFixed) {
    d0 = xd![0] ?? d0
    d1 = xd![1] ?? d1
  }
  if (!(d1 > d0)) {
    const pad = time ? DAY : 1
    d0 -= pad
    d1 += pad
  }
  const xScale = linearScale([d0, d1], time ? 'time' : 'linear')
  const yScale = bandScale(lanes, 0.3)
  c.axisFields = { y: s.y }
  const xAxis = valueAxis(c, xScale, { title: s.xLabel, vertical: false, format: time ? 'auto' : s.format })
  const yAxis = bandAxis(yScale, Object.fromEntries(lanes.map(k => [k, clip(k, 60)])), s.yLabel, c.locale)
  const frame = c.frame({ series, autoSide: 'top' })
  const plot = layoutCartesian(c, frame, xAxis, yAxis)
  drawAnnotations(c, plot, xAxis, yAxis)
  if (xFixed) c.clips.plot = `M${plot.x} ${plot.y}h${plot.w}v${plot.h}h${-plot.w}Z`
  if (yScale.bandwidth < 4) c.warn('timeline_cramped', 'y', `${lanes.length} lanes leave each about ${Math.round(yScale.bandwidth * 10) / 10} px.`, 'Make the chart taller, filter lanes with `transform`, or split it with `facet`.')

  if (time) warnZoneDates(c, items.flatMap(i => [i.start, i.end]), 'start')
  const intraday = time && hasTimeOfDay(items.flatMap(i => [i.start, i.end]), c.timeZone)
  const when = (v: number): string => (time ? formatTime(v, intraday ? 'datetime' : 'full', c.locale, c.timeZone) : c.format(v))
  const units = { day: c.t('unitDay'), hour: c.t('unitHour'), minute: c.t('unitMinute'), second: c.t('unitSecond') }
  const long = (a: number, b: number): string => (time ? formatDuration(b - a, c.locale, units) : c.format(b - a))
  const iso = (v: number): string | number => (time ? new Date(v).toISOString() : v)

  const bars: Mark[] = []
  const labels: Mark[] = []
  const h = Math.max(1, Math.min(yScale.bandwidth, 36))
  for (const it of items) {
    if (c.hidden.has(it.series)) continue
    if (it.end < d0 || it.start > d1) continue
    const x0 = xScale.at(it.start)
    const x1 = xScale.at(it.end)
    // A zero-length range (a milestone) still gets a visible sliver.
    const w = Math.max(2, x1 - x0)
    const x = x1 - x0 < 2 ? (x0 + x1) / 2 - 1 : x0
    const y = yScale.at(it.lane) - h / 2
    const color = colorOf.get(it.series)!
    const name = it.label ?? it.lane
    const rows: Tip['rows'] = [
      ...(keys.length > 1 || s.series ? [{ label: clip(String(s.series ?? s.y), 40), value: clip(it.series, 60), color }] : []),
      ...(it.label !== null ? [{ label: clip(String(s.y), 40), value: clip(it.lane, 60) }] : []),
      { label: c.t('start'), value: when(it.start) },
      { label: c.t('end'), value: when(it.end) },
      { label: c.t('duration'), value: long(it.start, it.end) }
    ]
    bars.push({
      type: 'rect', role: 'data', series: it.series, x, y, w, h, r: Math.min(3, h / 4, w / 2), fill: color, anim: 'x',
      ...(xFixed ? { clip: 'plot' } : {}),
      tip: { title: clip(name, 60), rows },
      aria: c.t('timelineAria', { task: s.series ? `${name}, ${it.series}` : name, start: when(it.start), end: when(it.end), duration: long(it.start, it.end) }),
      datum: { y: it.lane, start: iso(it.start), end: iso(it.end), series: it.series, ...(it.label !== null ? { label: it.label } : {}) }
    })
    if (s.labels) {
      const text = it.label ?? long(it.start, it.end)
      const size = c.size - 1
      const vx0 = Math.max(x, plot.x)
      const vx1 = Math.min(x + w, plot.x + plot.w)
      const tw = c.measure(text, size)
      if (h >= size + 2 && vx1 - vx0 >= tw + 10) labels.push(c.text(vx0 + 5, y + h / 2, text, { role: 'label', baseline: 'middle', size, fill: inkOn(hexOf.get(it.series)!) }))
      else if (h >= size - 2 && x + w + 4 + Math.min(tw, 120) <= plot.x + plot.w && x + w >= plot.x) labels.push(c.text(x + w + 4, y + h / 2, fit(text, plot.x + plot.w - x - w - 6, size, c.env.measure), { role: 'label', baseline: 'middle', size, fill: c.c('text') }))
    }
  }
  c.marks.push(...bars, ...labels)
  return { series }
}

export const timeline: ChartDef = {
  type: 'timeline',
  name: 'Timeline',
  summary: 'Floating horizontal bars from a start to an end, one lane per task or resource: a Gantt chart, a schedule, a history of states.',
  useWhen: 'Tasks, bookings, shifts, releases or incidents with a start and an end (dates or numbers), a few to a few hundred bars in up to ~40 lanes. Add `series` to colour by phase or owner, and an x annotation for "today". Use a bar chart for durations without positions in time, a calendar for daily values.',
  cartesian: true,
  fields: {
    y: { kind: 'column', role: 'any', required: true, desc: 'Column naming the lane (task, resource, room) each bar sits in; lanes keep the order of first appearance. Several rows may share a lane (phases one after another).' },
    start: { kind: 'column', role: 'x', required: true, desc: 'Column with where each bar starts: ISO dates or timestamps, or plain numbers (days, minutes, versions). The kind is detected from start and end together; override with `xType`.' },
    end: { kind: 'column', role: 'x', required: true, desc: 'Column with where each bar ends, in the same units as `start`. An end before its start is swapped (`range_reversed`); a row without either is skipped (`missing_range`).' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours the bars (phase, owner, status) and gives them a legend; toggling an entry hides its bars.' },
    label: { kind: 'column', role: 'any', desc: 'Column naming each bar (shown in its tooltip, and on the bar with `labels`). Default: the lane.' },
    labels: { kind: 'boolean', default: false, desc: 'Print each bar\'s label (or, without `label`, its duration) inside the bar, or just after it when it does not fit.' },
    xType: { kind: 'enum', values: ['auto', 'linear', 'time'], default: 'auto', desc: 'How to read `start` and `end`. `auto` detects numbers and ISO dates.' },
    xDomain: { kind: 'domain', desc: 'Fix the visible range of the time axis (dates as ISO strings). Bars running past it are cut at the edge; `zoom: "x"` lets the viewer change it.' }
  },
  example: {
    type: 'timeline',
    title: 'Release 4.2 plan',
    subtitle: 'Work by team, March to May 2026',
    y: 'task',
    start: 'from',
    end: 'to',
    series: 'team',
    annotations: [{ axis: 'x', value: '2026-04-06', label: 'Today', tone: 'warning' }],
    data: [
      { task: 'Research', team: 'Design', from: '2026-03-02', to: '2026-03-20' },
      { task: 'Wireframes', team: 'Design', from: '2026-03-16', to: '2026-04-03' },
      { task: 'API', team: 'Backend', from: '2026-03-23', to: '2026-04-24' },
      { task: 'Web app', team: 'Frontend', from: '2026-04-06', to: '2026-05-08' },
      { task: 'Load tests', team: 'Backend', from: '2026-04-27', to: '2026-05-08' },
      { task: 'Docs', team: 'Frontend', from: '2026-04-20', to: '2026-05-15' },
      { task: 'Launch', team: 'Design', from: '2026-05-15', to: '2026-05-19' }
    ]
  },
  check(spec, ctx) {
    const d = timelineItems({ ...spec, data: ctx.rows })
    if (d.kind === 'category') {
      ctx.issues.push({ severity: 'error', code: 'not_time_or_number', path: 'start', message: `"${spec.start}" and "${spec.end}" are not both dates or both numbers.`, hint: 'Use ISO dates ("2026-03-14", "2026-03-14T09:30Z"), timestamps, or plain numbers in both columns; set xType to say which.' })
      return
    }
    if (!d.items.length) {
      ctx.issues.push({ severity: 'error', code: 'no_ranges', path: 'end', message: 'No row has both a start and an end.', hint: `Fill "${spec.start}" and "${spec.end}" in the same units${spec.xType && spec.xType !== 'auto' ? `, or check xType "${spec.xType}"` : ''}.` })
      return
    }
    if (d.skipped) ctx.issues.push({ severity: 'warning', code: 'missing_range', path: 'end', message: `${d.skipped} ${d.skipped === 1 ? 'row has' : 'rows have'} no usable start or end and ${d.skipped === 1 ? 'is' : 'are'} skipped.`, hint: 'Give both ends; for a point in time (a milestone) use the same value twice.' })
    if (d.reversed) ctx.issues.push({ severity: 'warning', code: 'range_reversed', path: 'end', message: `In ${d.reversed} ${d.reversed === 1 ? 'row' : 'rows'} the end is before the start; ${d.reversed === 1 ? 'it was' : 'they were'} swapped.`, hint: 'Check the column order: `start` is the earlier one.' })
    if (d.lanes.length > LIMITS.maxCategories) ctx.issues.push({ severity: 'warning', code: 'too_many_lanes', path: 'y', message: `${d.lanes.length} lanes; only the first ${LIMITS.maxCategories} are drawn.`, hint: 'Filter with `transform`, group lanes, or split the chart with `facet`.' })
    if (d.overlapping.length) ctx.issues.push({ severity: 'warning', code: 'overlapping_ranges', path: 'y', message: `Bars overlap in ${d.overlapping.length} ${d.overlapping.length === 1 ? 'lane' : 'lanes'} (${fmtList(d.overlapping.map(l => `"${clip(l, 30)}"`), 3)}); a later bar covers part of an earlier one.`, hint: 'Give overlapping items their own lane, e.g. one lane per task instead of per resource.' })
  },
  compile,
  describe(spec, env) {
    const d = timelineItems(spec)
    if (!d.items.length) return `${lead(spec, 'Timeline')} No ranges.`
    const time = d.kind === 'time'
    const tz = env.timeZone ?? 'UTC'
    const f = valueFormatter(spec.format, env.locale)
    const intraday = time && hasTimeOfDay(d.items.flatMap(i => [i.start, i.end]), tz)
    const when = (v: number): string => (time ? formatTime(v, intraday ? 'datetime' : 'full', env.locale, tz) : f(v))
    const units = { day: DEFAULT_STRINGS.unitDay, hour: DEFAULT_STRINGS.unitHour, minute: DEFAULT_STRINGS.unitMinute, second: DEFAULT_STRINGS.unitSecond }
    const long = (it: TimelineItem): string => (time ? formatDuration(it.end - it.start, env.locale, units) : f(it.end - it.start))
    const first = d.items.reduce((a, b) => (b.start < a.start ? b : a))
    const last = d.items.reduce((a, b) => (b.end > a.end ? b : a))
    const longest = d.items.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a))
    const keys = spec.series ? distinct(d.items.map(i => i.series)) : []
    const name = (it: TimelineItem): string => clip(it.label ?? it.lane, 40)
    let t = `${lead(spec, 'Timeline')} ${d.items.length} ${d.items.length === 1 ? 'range' : 'ranges'} in ${d.lanes.length} ${d.lanes.length === 1 ? 'lane' : 'lanes'} (${fmtList(d.lanes.map(l => clip(l, 30)))})${keys.length ? `, coloured by ${spec.series} (${fmtList(keys.map(k => clip(k, 30)))})` : ''}, from ${when(first.start)} to ${when(last.end)}.`
    t += ` First: ${name(first)} at ${when(first.start)}. Last to end: ${name(last)} at ${when(last.end)}. Longest: ${name(longest)} (${long(longest)}).`
    if (d.overlapping.length) t += ` Ranges overlap in ${d.overlapping.length} ${d.overlapping.length === 1 ? 'lane' : 'lanes'}.`
    if (d.lanes.length > LIMITS.maxCategories) t += ` Only the first ${LIMITS.maxCategories} lanes are drawn.`
    return t
  }
}
