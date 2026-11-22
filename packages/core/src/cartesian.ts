// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartCtx } from './context.js'
import type { AxisInfo, Rect, Tip } from './scene.js'
import type { BandScale, LinearScale } from './scale.js'
import { fit } from './util/text.js'
import { REGION_BOUNDS } from './schema.js'
import { toTime, zoneOffset } from './util/time.js'

const DAY = 864e5
import { toNumber } from './util/num.js'
import { timeTickList } from './scale.js'
import { tickLabel } from './util/time.js'
import { tickFormatter, valueFormatter } from './util/format.js'

export interface AxisTick { key: number | string; label: string }

export interface Axis {
  scale: LinearScale | BandScale
  title?: string
  /** Draw gridlines across the plot for this axis. */
  grid: boolean
  /** Ticks for an axis `length` px long. */
  ticks(length: number): AxisTick[]
  /** A value axis drawn upside down: larger values lower (`yReverse`, `rightReverse`). */
  reverse?: boolean
}

/**
 * Lay out two axes inside `area`, draw gridlines, axes and labels, set the scale ranges, and
 * return the plot rectangle. `x` is the bottom axis, `y` the left axis; either may be a band
 * (categories) or continuous.
 */
export interface CartesianExtras {
  /** A second value axis on the right (`yRight`): tick labels right of the plot, no gridlines of its own. */
  right?: Axis
  /** Colour of the left (`left`) and right (`right`) axis titles and tick labels, when an axis takes its series' colour. */
  ink?: { left?: string; right?: string }
}

export function layoutCartesian(c: ChartCtx, area: Rect, x: Axis, y: Axis, extras: CartesianExtras = {}): Rect {
  const size = c.size
  const labelPad = 8
  const titleH = (a: Axis): number => (a.title ? size + 8 : 0)
  const right = extras.right

  // Pass 1: left margin from y labels, using a provisional height.
  const provH = Math.max(40, area.h - 48)
  const yTicks0 = y.ticks(provH)
  let yLabelW = Math.max(0, ...yTicks0.map(t => c.measure(t.label)))
  if (y.scale.kind === 'band') yLabelW = Math.min(yLabelW, area.w * 0.36)
  const left = area.x + (y.title ? size + 8 : 0) + yLabelW + labelPad
  const xTop = 6

  // Pass 2: x labels with a provisional width.
  const provW = Math.max(40, area.x + area.w - left - 12)
  const xTicks0 = x.ticks(provW)
  const lastHalf = x.scale.kind === 'band' ? 0 : c.measure(xTicks0[xTicks0.length - 1]?.label ?? '') / 2
  const rightLabelW = right ? Math.max(0, ...right.ticks(provH).map(t => c.measure(t.label))) : 0
  const rightPad = Math.max(10, Math.ceil(lastHalf) + 2, right ? labelPad + rightLabelW + (right.title ? size + 8 : 0) + 4 : 0)
  const plotW = Math.max(40, area.x + area.w - left - rightPad)
  // The range first: a broken axis thins the tick labels next to its gap by their pixel distance.
  x.scale.range = [left, left + plotW]
  const xTicks = x.ticks(plotW)
  const xl = xLabelLayout(c, x, xTicks, plotW)
  const bottomH = xl.height + labelPad + titleH(x)
  // `bare`: no axes at all; the plot takes the whole area, less a margin for the stroke and the last marker.
  const bare = c.spec.bare === true
  const m = 4
  const plot: Rect = bare ? { x: area.x + m, y: area.y + m, w: Math.max(1, area.w - 2 * m), h: Math.max(1, area.h - 2 * m) } : { x: left, y: area.y + xTop, w: plotW, h: Math.max(40, area.h - xTop - bottomH) }

  x.scale.range = [plot.x, plot.x + plot.w]
  y.scale.range = y.scale.kind === 'band' || y.reverse ? [plot.y, plot.y + plot.h] : [plot.y + plot.h, plot.y]
  if (right) right.scale.range = right.reverse ? [plot.y, plot.y + plot.h] : [plot.y + plot.h, plot.y]
  const info = (a: Axis, field: unknown, ink?: string): AxisInfo => {
    const s = a.scale
    const f = typeof field === 'string' ? { field } : {}
    if (s.kind === 'band') return { kind: 'band', domain: [...(s as BandScale).domain], range: [...s.range] as [number, number], ...f }
    const br = (s as LinearScale & { breaks?: [number, number] }).breaks
    return { kind: s.kind, domain: [...(s as LinearScale).domain] as [number, number], range: [...s.range] as [number, number], ...f, ...((s as LinearScale).log ? { scale: 'log' as const } : {}), ...(br ? { breaks: [...br] as [number, number] } : {}), ...(ink ? { ink } : {}) }
  }
  const ink = extras.ink ?? {}
  // A horizontal chart draws its value axis along x: a break there is on the x axis.
  c.axes = { plot: { ...plot }, x: info(x, c.axisFields?.x ?? c.spec.x), y: info(y, c.axisFields?.y ?? (typeof c.spec.y === 'string' ? c.spec.y : undefined), right ? ink.left : undefined) }
  if (right) c.axes.y2 = info(right, c.axisFields?.y2, ink.right)
  if (bare) return plot
  const yTicks = y.ticks(plot.h)

  const grid = c.c('grid')
  const axis = c.c('axis')
  const muted = c.c('text-muted')
  // Gridlines first so data draws above them.
  if (y.grid) for (const t of yTicks) {
    const py = y.scale.at(t.key as never)
    c.marks.push({ type: 'line', role: 'grid', x1: plot.x, x2: plot.x + plot.w, y1: py, y2: py, stroke: grid })
  }
  if (x.grid) for (const t of xTicks) {
    const px = x.scale.at(t.key as never)
    c.marks.push({ type: 'line', role: 'grid', x1: px, x2: px, y1: plot.y, y2: plot.y + plot.h, stroke: grid })
  }
  c.marks.push({ type: 'line', role: 'axis', x1: plot.x, x2: plot.x + plot.w, y1: plot.y + plot.h, y2: plot.y + plot.h, stroke: axis })
  if (y.scale.kind === 'band') c.marks.push({ type: 'line', role: 'axis', x1: plot.x, x2: plot.x, y1: plot.y, y2: plot.y + plot.h, stroke: axis })
  // Two value axes: each gets its own axis line, in its series' colour when it has one, so labels tie to their side.
  if (right) {
    c.marks.push({ type: 'line', role: 'axis', x1: plot.x, x2: plot.x, y1: plot.y, y2: plot.y + plot.h, stroke: ink.left ?? axis })
    c.marks.push({ type: 'line', role: 'axis', x1: plot.x + plot.w, x2: plot.x + plot.w, y1: plot.y, y2: plot.y + plot.h, stroke: ink.right ?? axis })
  }

  xTicks.forEach((t, i) => {
    if (i % xl.stride !== 0) return
    const px = x.scale.at(t.key as never)
    const ty = plot.y + plot.h + labelPad + (xl.rotate ? 2 : 0)
    c.marks.push(
      xl.rotate
        ? c.text(px + 3, ty, xl.fitLabel(t.label), { anchor: 'end', baseline: 'hanging', rotate: -45, fill: muted })
        : c.text(px, ty, xl.fitLabel(t.label), { anchor: 'middle', baseline: 'hanging', fill: muted })
    )
  })
  const maxYW = y.scale.kind === 'band' ? yLabelW : Infinity
  const leftInk = right ? ink.left ?? muted : muted
  for (const t of yTicks) {
    const py = y.scale.at(t.key as never)
    c.marks.push(c.text(plot.x - labelPad, py, fit(t.label, maxYW, size, c.env.measure), { anchor: 'end', baseline: 'middle', fill: leftInk }))
  }
  if (right) {
    const rightInk = ink.right ?? muted
    for (const t of right.ticks(plot.h)) c.marks.push(c.text(plot.x + plot.w + labelPad, right.scale.at(t.key as never), t.label, { anchor: 'start', baseline: 'middle', fill: rightInk }))
    if (right.title) c.marks.push(c.text(area.x + area.w - size * 0.6, plot.y + plot.h / 2, right.title, { anchor: 'middle', baseline: 'middle', rotate: 90, fill: rightInk, weight: 500 }))
  }
  if (x.title) c.marks.push(c.text(plot.x + plot.w / 2, area.y + area.h - size, x.title, { anchor: 'middle', baseline: 'hanging', fill: muted, weight: 500 }))
  if (y.title) c.marks.push(c.text(area.x + size * 0.6, plot.y + plot.h / 2, y.title, { anchor: 'middle', baseline: 'middle', rotate: -90, fill: leftInk, weight: 500 }))
  return plot
}

function xLabelLayout(c: ChartCtx, x: Axis, ticks: AxisTick[], plotW: number): { rotate: boolean; stride: number; height: number; fitLabel: (s: string) => string } {
  const size = c.size
  const widths = ticks.map(t => c.measure(t.label))
  const maxW = Math.max(0, ...widths)
  const identity = (s: string): string => s
  if (x.scale.kind !== 'band') return { rotate: false, stride: 1, height: size + 4, fitLabel: identity }
  const step = plotW / Math.max(1, ticks.length)
  if (maxW <= step - 6) return { rotate: false, stride: 1, height: size + 4, fitLabel: identity }
  if (step >= 48) return { rotate: false, stride: 1, height: size + 4, fitLabel: s => fit(s, step - 6, size, c.env.measure) }
  const cap = 96
  const h = Math.min(maxW, cap) * 0.71 + size * 0.6 + 4
  return { rotate: true, stride: Math.max(1, Math.ceil((size * 1.35) / Math.max(1, step))), height: h, fitLabel: s => fit(s, cap, size, c.env.measure) }
}

export interface AxisPair { x: Axis; y: Axis }

const TONE: Record<string, string> = { neutral: 'text-muted', positive: 'positive', negative: 'negative', warning: 'warning', info: 'info' }

/** An annotation's colour: its `tone`, else the accent for what an assistant added (violet means the agent), else muted. */
function annotationColor(c: ChartCtx, a: { tone?: string } & AnnotationExtra): string {
  if (a.tone === undefined && a.by === 'assistant') return c.c('accent')
  return c.c(TONE[a.tone ?? 'neutral'] ?? 'text-muted')
}

/** Reference lines and bands from `spec.annotations`. */
export function drawAnnotations(c: ChartCtx, plot: Rect, x: Axis, y: Axis): void {
  const list = (c.spec.annotations ?? []) as ({ axis: 'x' | 'y'; value: string | number; to?: string | number; label?: string; tone?: string } & AnnotationExtra | PointAnnotation)[]
  const points: [number, PointAnnotation][] = []
  for (const [i, a] of list.entries()) {
    if (!('axis' in a)) {
      if (REGION_BOUNDS.some(k => k in a)) drawRegion(c, plot, x, y, i, a as unknown as RegionAnnotation)
      else points.push([i, a as PointAnnotation])
      continue
    }
    const ax = a.axis === 'x' ? x : y
    const pos = (v: string | number): number | null => axisPos(ax, v)
    const p = pos(a.value)
    const q = a.to !== undefined ? pos(a.to) : null
    if (p === null || (a.to !== undefined && q === null)) {
      c.warn('annotation_out_of_range', `annotations[${i}]`, `Annotation ${i} (${a.axis}=${a.value}) is outside the plotted range and was skipped.`)
      continue
    }
    const color = annotationColor(c, a)
    const horizontal = a.axis === 'y'
    const { label, tip, aria } = annotationText(c, a)
    // One tab stop per annotation: the note's tooltip goes on the label, or on the line or band when there is none.
    const keyed = a.key !== undefined ? { key: a.key } : {}
    const own = { ...(tip ? { tip, aria } : {}), ...keyed }
    const body = label ? keyed : own
    if (q !== null) {
      const lo = Math.min(p, q)
      const hi = Math.max(p, q)
      c.marks.push(horizontal
        ? { type: 'rect', role: 'annotation', x: plot.x, y: lo, w: plot.w, h: hi - lo, fill: color, opacity: 0.12, ...body }
        : { type: 'rect', role: 'annotation', x: lo, y: plot.y, w: hi - lo, h: plot.h, fill: color, opacity: 0.12, ...body })
      if (label) c.marks.push(horizontal
        ? c.text(plot.x + plot.w - 4, lo + 3, label, { role: 'annotation', anchor: 'end', baseline: 'hanging', fill: color, size: c.size - 1, ...own })
        : c.text(lo + 4, plot.y + 3, label, { role: 'annotation', baseline: 'hanging', fill: color, size: c.size - 1, ...own }))
    } else {
      c.marks.push(horizontal
        ? { type: 'line', role: 'annotation', x1: plot.x, x2: plot.x + plot.w, y1: p, y2: p, stroke: color, strokeWidth: 1.5, dash: '5 4', ...body }
        : { type: 'line', role: 'annotation', x1: p, x2: p, y1: plot.y, y2: plot.y + plot.h, stroke: color, strokeWidth: 1.5, dash: '5 4', ...body })
      if (label) c.marks.push(horizontal
        ? c.text(plot.x + 4, p - 4, label, { role: 'annotation', fill: color, size: c.size - 1, ...own })
        : c.text(p + 4, plot.y + 3, label, { role: 'annotation', baseline: 'hanging', fill: color, size: c.size - 1, ...own }))
    }
  }
  for (const [i, a] of points) drawPointAnnotation(c, plot, x, y, i, a)
}

export interface RegionAnnotation extends AnnotationExtra { xFrom?: string | number; xTo?: string | number; yFrom?: string | number; yTo?: string | number; label?: string; tone?: string }

/**
 * A shaded rectangle between two values on each axis. A side left out runs to the plot's edge, so a single corner
 * value draws a quadrant; a side past the plot is cut at its edge. Only numeric and time axes have positions between
 * values: on a category axis the region is skipped, said in a warning. A region wholly outside the plot is skipped too.
 */
function drawRegion(c: ChartCtx, plot: Rect, x: Axis, y: Axis, i: number, a: RegionAnnotation): void {
  const p = `annotations[${i}]`
  if (x.scale.kind === 'band' || y.scale.kind === 'band') {
    c.warn('annotation_out_of_range', p, `Annotation ${i} is a shaded region, which needs numeric or date axes; this chart has a category axis, so it was skipped.`, 'Use a band ({axis, value, to}) on a category axis.')
    return
  }
  const side = (ax: Axis, from: string | number | undefined, to: string | number | undefined, lo: number, hi: number, vertical: boolean): [number, number] | null => {
    const at = (v: string | number | undefined, edge: number): number | null => {
      if (v === undefined) return edge
      const n = ax.scale.kind === 'time' ? toTime(v) : toNumber(v)
      return n === null ? null : Math.max(lo, Math.min(hi, (ax.scale as LinearScale).at(n)))
    }
    // A side left out runs to the edge where its values end: the lowest value is at the bottom of a vertical axis.
    const a0 = at(from, vertical ? hi : lo)
    const a1 = at(to, vertical ? lo : hi)
    if (a0 === null || a1 === null) return null
    return [Math.min(a0, a1), Math.max(a0, a1)]
  }
  const xs = side(x, a.xFrom, a.xTo, plot.x, plot.x + plot.w, false)
  const ys = side(y, a.yFrom, a.yTo, plot.y, plot.y + plot.h, true)
  if (!xs || !ys || xs[1] - xs[0] < 0.5 || ys[1] - ys[0] < 0.5) {
    c.warn('annotation_out_of_range', p, `Annotation ${i} (a shaded region) is outside the plotted range or has a value that is not a number or date, and was skipped.`)
    return
  }
  const color = annotationColor(c, a)
  const { label, tip, aria } = annotationText(c, a)
  const keyed = a.key !== undefined ? { key: a.key } : {}
  const own = { ...(tip ? { tip, aria } : {}), ...keyed }
  c.marks.push({ type: 'rect', role: 'annotation', x: xs[0], y: ys[0], w: xs[1] - xs[0], h: ys[1] - ys[0], fill: color, opacity: 0.12, ...(label ? keyed : own) })
  if (label) {
    const size = c.size - 1
    c.marks.push(c.text(xs[0] + 6, ys[0] + 5, fit(label, Math.max(24, xs[1] - xs[0] - 12), size, c.env.measure), { role: 'annotation', baseline: 'hanging', fill: color, size, ...own }))
  }
}

/** The fields both annotation forms share: a reference key, a longer note, and who added it. */
export interface AnnotationExtra { key?: string; note?: string; by?: 'author' | 'assistant' }

export interface PointAnnotation extends AnnotationExtra { x: string | number; y: string | number; label: string; tone?: string }

/**
 * The label as drawn (with the assistant's mark before it when `by` is `assistant`), and the tooltip and accessible
 * name that carry a `note`, or say who added the mark.
 */
function annotationText(c: ChartCtx, a: { label?: string } & AnnotationExtra): { label: string | undefined; tip?: Tip; aria?: string } {
  const mine = a.by === 'assistant'
  const label = a.label && mine ? `${c.t('assistantMark')} ${a.label}` : a.label
  if (!mine && !a.note) return { label }
  const rows: Tip['rows'] = []
  if (a.note) rows.push({ label: a.note, value: '' })
  if (mine) rows.push({ label: c.t('assistantNote'), value: '' })
  const title = a.label ?? (a.key !== undefined ? a.key : undefined)
  return { label, tip: { ...(title ? { title } : {}), rows }, aria: [a.label, a.note, mine ? c.t('assistantNote') : ''].filter(Boolean).join('. ') }
}

/** Pixel position of a value on an axis (a category, a number or an ISO date), or null when it is not shown. */
export function axisPos(ax: Axis, v: string | number): number | null {
  const s = ax.scale
  if (s.kind === 'band') return s.has(String(v)) ? s.at(String(v)) : null
  const n = s.kind === 'time' ? toTime(v) : toNumber(v)
  if (n === null) return null
  const [d0, d1] = (s as LinearScale).domain
  if (n < Math.min(d0, d1) || n > Math.max(d0, d1)) return null
  return s.at(n)
}

/**
 * A labelled point: a small ring at (x, y), a short leader, and the label at its end. The leader goes up and to
 * the right, and flips left or down when the label would leave the plot, so the text always stays inside it.
 */
function drawPointAnnotation(c: ChartCtx, plot: Rect, x: Axis, y: Axis, i: number, a: PointAnnotation): void {
  const px = axisPos(x, a.x)
  const py = axisPos(y, a.y)
  if (px === null || py === null) {
    c.warn('annotation_out_of_range', `annotations[${i}]`, `Annotation ${i} (x=${a.x}, y=${a.y}) is outside the plotted range and was skipped.`, 'Point annotations take x and y in the units of their axis: a category name, a number or an ISO date.')
    return
  }
  const color = annotationColor(c, a)
  const size = c.size - 1
  const text = annotationText(c, a)
  const own = { ...(text.tip ? { tip: text.tip, aria: text.aria } : {}), ...(a.key !== undefined ? { key: a.key } : {}) }
  const label = fit(text.label!, Math.max(40, plot.w - 16), size, c.env.measure)
  const tw = c.measure(label, size)
  const lead = 16
  const right = px + lead + 4 + tw <= plot.x + plot.w || px - lead - 4 - tw < plot.x
  const up = py - lead - size >= plot.y
  const ex = px + (right ? lead : -lead)
  const ey = py + (up ? -lead : lead)
  const want = ex + (right ? 4 : -4)
  const tx = right ? Math.max(plot.x + 2, Math.min(plot.x + plot.w - 2 - tw, want)) : Math.min(plot.x + plot.w - 2, Math.max(plot.x + 2 + tw, want))
  c.marks.push({ type: 'line', role: 'annotation', x1: px, y1: py, x2: ex, y2: ey, stroke: color, strokeWidth: 1, ...(a.key !== undefined ? { key: a.key } : {}) })
  c.marks.push({ type: 'circle', role: 'annotation', cx: px, cy: py, r: 3.5, fill: c.c('background'), stroke: color, strokeWidth: 1.5, ...(a.key !== undefined ? { key: a.key } : {}) })
  c.marks.push(c.text(tx, ey, label, { role: 'annotation', anchor: right ? 'start' : 'end', baseline: 'middle', fill: color, size, weight: 500, ...own }))
}

/**
 * A time axis whose values are all date-only (UTC midnights) under another render time zone: they are instants at
 * midnight UTC, so they land between the local day ticks. Warn once (`time_zone_dates`) instead of guessing.
 */
export function warnZoneDates(c: ChartCtx, values: number[], path: string): void {
  const tz = c.timeZone
  if (tz === 'UTC' || !values.length || values.some(v => v % DAY !== 0) || values.every(v => zoneOffset(v, tz) === 0)) return
  c.warn('time_zone_dates', path, `Every ${path} value is a date without a time of day, read as midnight UTC; in ${tz} that is not midnight, so the points sit between the day ticks and tooltips show a local time.`, 'Give instants with their offset (2026-03-01T00:00-05:00) or as timestamps, or leave timeZone at UTC for calendar dates.')
}

export interface ValueAxisOptions { title?: string; vertical: boolean; format?: string; grid?: boolean }

/** A linear or time axis with tick labels that never collide. */
export function valueAxis(c: ChartCtx, scale: LinearScale, o: ValueAxisOptions): Axis {
  return {
    scale,
    title: o.title,
    grid: o.grid ?? true,
    ticks(length: number): AxisTick[] {
      let count = Math.max(2, Math.round(length / (o.vertical ? (c.compact ? 34 : 42) : c.compact ? 70 : 88)))
      for (;;) {
        const labels: AxisTick[] = scale.kind === 'time'
          ? timeTickList(scale.domain, count, c.locale, c.timeZone).map(t => ({ key: t.value, label: t.label }))
          : scale.log
            ? (() => {
                // Log ticks span decades: one shared precision does not fit, so each tick uses the value format
                // (compact once the values get large, unless a format was asked for).
                const f = o.format ?? c.spec.format
                const fmt = valueFormatter(!f || f === 'auto' ? (scale.domain[1] >= 10000 ? 'compact' : 'auto') : f, c.locale)
                return scale.ticks(count).map(v => ({ key: v, label: fmt(v) }))
              })()
            : (() => {
              const fmt = tickFormatter(o.format ?? c.spec.format, c.locale, scale.domain, count)
              return scale.ticks(count).map(v => ({ key: v, label: fmt(v) }))
            })()
        if (o.vertical || count <= 2 || labels.length < 2) return labels
        const widest = Math.max(...labels.map(t => c.measure(t.label)))
        const spacing = length / (labels.length - 1)
        if (spacing >= widest + 14) return labels
        count -= 1
      }
    }
  }
}

/** A categorical axis: one label per band. */
export function bandAxis(scale: BandScale, labels: Record<string, string>, title?: string, locale = 'en'): Axis {
  const dates = dateLabels(scale.domain, labels, locale)
  return { scale, title, grid: false, ticks: () => scale.domain.map(k => ({ key: k, label: dates?.[k] ?? labels[k] ?? k })) }
}

const ISO_BUCKET = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):00:00(?:\.000)?Z)?$/

/**
 * Categories that are all ISO dates (what `timeUnit` produces) read like a time axis: "2026, Feb, Mar" for
 * months, "Jan 5" for days, "14:00" for hours. Only when the chart did not label them itself. They stay UTC under a
 * `timeZone` render option: the buckets are UTC (as `timeUnit` makes them in every port), so shifting the label
 * would name the wrong day.
 */
export function dateLabels(keys: readonly string[], labels: Record<string, string>, locale: string): Record<string, string> | null {
  if (!keys.length || keys.some(k => labels[k] !== undefined && labels[k] !== k)) return null
  const ts: number[] = []
  for (const k of keys) {
    const m = ISO_BUCKET.exec(k)
    if (!m) return null
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0)
    if (!Number.isFinite(t)) return null
    ts.push(t)
  }
  const ds = ts.map(t => new Date(t))
  const level = ds.some(d => d.getUTCHours() !== 0) ? 'hour' : ds.every(d => d.getUTCDate() === 1) ? (ds.every(d => d.getUTCMonth() === 0) ? 'year' : 'month') : 'day'
  return Object.fromEntries(keys.map((k, i) => [k, tickLabel(ts[i], level, locale)]))
}
