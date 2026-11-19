import type { ChartCtx } from './context.js'
import type { Rect } from './scene.js'
import type { BandScale, LinearScale } from './scale.js'
import { fit } from './util/text.js'
import { toTime } from './util/time.js'
import { toNumber } from './util/num.js'
import { timeTickList } from './scale.js'
import { tickFormatter } from './util/format.js'

export interface AxisTick { key: number | string; label: string }

export interface Axis {
  scale: LinearScale | BandScale
  title?: string
  /** Draw gridlines across the plot for this axis. */
  grid: boolean
  /** Ticks for an axis `length` px long. */
  ticks(length: number): AxisTick[]
}

/**
 * Lay out two axes inside `area`, draw gridlines, axes and labels, set the scale ranges, and
 * return the plot rectangle. `x` is the bottom axis, `y` the left axis; either may be a band
 * (categories) or continuous.
 */
export function layoutCartesian(c: ChartCtx, area: Rect, x: Axis, y: Axis): Rect {
  const size = c.size
  const labelPad = 8
  const titleH = (a: Axis): number => (a.title ? size + 8 : 0)

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
  const rightPad = Math.max(10, Math.ceil(lastHalf) + 2)
  const plotW = Math.max(40, area.x + area.w - left - rightPad)
  const xTicks = x.ticks(plotW)
  const xl = xLabelLayout(c, x, xTicks, plotW)
  const bottomH = xl.height + labelPad + titleH(x)
  const plot: Rect = { x: left, y: area.y + xTop, w: plotW, h: Math.max(40, area.h - xTop - bottomH) }

  x.scale.range = [plot.x, plot.x + plot.w]
  y.scale.range = y.scale.kind === 'band' ? [plot.y, plot.y + plot.h] : [plot.y + plot.h, plot.y]
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
  for (const t of yTicks) {
    const py = y.scale.at(t.key as never)
    c.marks.push(c.text(plot.x - labelPad, py, fit(t.label, maxYW, size, c.env.measure), { anchor: 'end', baseline: 'middle', fill: muted }))
  }
  if (x.title) c.marks.push(c.text(plot.x + plot.w / 2, area.y + area.h - size, x.title, { anchor: 'middle', baseline: 'hanging', fill: muted, weight: 500 }))
  if (y.title) c.marks.push(c.text(area.x + size * 0.6, plot.y + plot.h / 2, y.title, { anchor: 'middle', baseline: 'middle', rotate: -90, fill: muted, weight: 500 }))
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

/** Reference lines and bands from `spec.annotations`. */
export function drawAnnotations(c: ChartCtx, plot: Rect, x: Axis, y: Axis): void {
  const list = (c.spec.annotations ?? []) as { axis: 'x' | 'y'; value: string | number; to?: string | number; label?: string; tone?: string }[]
  for (const [i, a] of list.entries()) {
    const ax = a.axis === 'x' ? x : y
    const pos = (v: string | number): number | null => {
      const s = ax.scale
      if (s.kind === 'band') return s.has(String(v)) ? s.at(String(v)) : null
      const n = s.kind === 'time' ? toTime(v) : toNumber(v)
      if (n === null) return null
      const [d0, d1] = (s as LinearScale).domain
      if (n < Math.min(d0, d1) || n > Math.max(d0, d1)) return null
      return s.at(n)
    }
    const p = pos(a.value)
    const q = a.to !== undefined ? pos(a.to) : null
    if (p === null || (a.to !== undefined && q === null)) {
      c.warn('annotation_out_of_range', `annotations[${i}]`, `Annotation ${i} (${a.axis}=${a.value}) is outside the plotted range and was skipped.`)
      continue
    }
    const color = c.c(TONE[a.tone ?? 'neutral'] ?? 'text-muted')
    const horizontal = a.axis === 'y'
    if (q !== null) {
      const lo = Math.min(p, q)
      const hi = Math.max(p, q)
      c.marks.push(horizontal
        ? { type: 'rect', role: 'annotation', x: plot.x, y: lo, w: plot.w, h: hi - lo, fill: color, opacity: 0.12 }
        : { type: 'rect', role: 'annotation', x: lo, y: plot.y, w: hi - lo, h: plot.h, fill: color, opacity: 0.12 })
      if (a.label) c.marks.push(horizontal
        ? c.text(plot.x + plot.w - 4, lo + 3, a.label, { role: 'annotation', anchor: 'end', baseline: 'hanging', fill: color, size: c.size - 1 })
        : c.text(lo + 4, plot.y + 3, a.label, { role: 'annotation', baseline: 'hanging', fill: color, size: c.size - 1 }))
    } else {
      c.marks.push(horizontal
        ? { type: 'line', role: 'annotation', x1: plot.x, x2: plot.x + plot.w, y1: p, y2: p, stroke: color, strokeWidth: 1.5, dash: '5 4' }
        : { type: 'line', role: 'annotation', x1: p, x2: p, y1: plot.y, y2: plot.y + plot.h, stroke: color, strokeWidth: 1.5, dash: '5 4' })
      if (a.label) c.marks.push(horizontal
        ? c.text(plot.x + 4, p - 4, a.label, { role: 'annotation', fill: color, size: c.size - 1 })
        : c.text(p + 4, plot.y + 3, a.label, { role: 'annotation', baseline: 'hanging', fill: color, size: c.size - 1 }))
    }
  }
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
          ? timeTickList(scale.domain, count, c.locale).map(t => ({ key: t.value, label: t.label }))
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
export function bandAxis(scale: BandScale, labels: Record<string, string>, title?: string): Axis {
  return { scale, title, grid: false, ticks: () => scale.domain.map(k => ({ key: k, label: labels[k] ?? k })) }
}
