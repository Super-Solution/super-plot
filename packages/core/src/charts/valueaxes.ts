// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartCtx } from '../context.js'
import type { FieldDef, ValidateCtx } from '../schema.js'
import type { Mark, Rect } from '../scene.js'
import type { LinearScale } from '../scale.js'
import { linearTicks } from '../util/num.js'
import { contrast, mix } from '../util/color.js'
import { tokenValue } from '../theme.js'
import { valueFormatter } from '../util/format.js'
import { fmtList } from './shared.js'
import { clip } from '../util/text.js'

/**
 * Two value axes (`yRight`) and a broken value axis (`yBreak`). Both were refused in round 5 because they mislead
 * easily; they are built so that the safe use is the default and the risk is always said: a `dual_axis` or
 * `axis_break` info issue, axis labels in their series' colour, "(right axis)" in the legend, a visible cut, real
 * values in tooltips and in the description.
 */

/** The fields of a chart with a second value axis on the right. */
export const dualFields = (what: string): Record<string, FieldDef> => ({
  yRight: { kind: 'columns', role: 'number', desc: `Numeric column(s) drawn ${what} against a second value axis on the right, with its own scale. Two scales on one plot can suggest a relationship (a crossing, a gap, parallel trends) that is only the choice of the two ranges: validation always adds a \`dual_axis\` info issue saying so. Prefer an \`index\` transform step on one axis, or two charts with \`sync\`. Each axis's title and tick labels take its series' colour (when it has one), the legend says "(right axis)", tooltips use \`formatRight\`, and the description says which series is on which axis. With a right axis, zoom and brush act on x only.` },
  yRightLabel: { kind: 'string', max: 80, desc: 'Title of the right value axis (include the unit). Needs `yRight`.' },
  rightDomain: { kind: 'domain', desc: 'Fix the right axis range, e.g. [0, 1]. Needs `yRight`. Without it the right axis is fitted to its series like the left one (on bars it always includes zero, and the two zeros line up).' },
  formatRight: { kind: 'format', desc: 'Value format of the right axis, its tick labels and its series in tooltips (default: `format`). Needs `yRight`.' }
})

/** `yBreak`: cut a span out of the value axis. */
export const breakField = (what: string): FieldDef => ({
  kind: 'domain',
  desc: `Cut the span [from, to] out of the value axis (a broken axis), so ${what} The cut is drawn as a zigzag gap across the axis and the plot, tick labels stay on both sides with the same units per pixel, and tooltips and the description give real values. Validation always adds an \`axis_break\` info issue with the hidden span; a value inside the span is a \`break_hides_values\` warning (drawn at the edge of the cut and marked). Refused on log and stacked axes and with \`yRight\`; zoom and brush on the broken axis are refused.`
})

/** The columns of `yRight`, as a list. */
export const rightCols = (spec: Record<string, any>): string[] => (spec.yRight === undefined ? [] : Array.isArray(spec.yRight) ? spec.yRight : [spec.yRight])

const RIGHT_ONLY = ['yRightLabel', 'rightDomain', 'formatRight', 'rightReverse'] as const

const say = (v: number): string => String(Math.round(v * 1e6) / 1e6)

/**
 * Checks for `yRight`. `left` are the columns on the left axis (y, and a bar chart's `line`); `refused` says why the
 * right axis cannot be drawn on this spec (an error) and `ignored` why it is left out (a warning).
 */
export function dualCheck(spec: Record<string, any>, ctx: ValidateCtx, o: { left: string[]; refused?: string; ignored?: string }): void {
  const right = rightCols(spec)
  if (!right.length) {
    for (const k of RIGHT_ONLY) if (spec[k] !== undefined) ctx.issues.push({ severity: 'warning', code: 'right_axis_unused', path: k, message: `${k} is ignored: there is no right axis without \`yRight\`.`, hint: 'Add yRight with the column(s) for the right axis, or drop this field.' })
    return
  }
  if (o.refused) {
    ctx.issues.push({ severity: 'error', code: 'dual_axis_refused', path: 'yRight', message: `A right axis is refused here: ${o.refused}`, hint: 'Index the series to a common base (an `index` transform step) and use one axis, or draw two charts with `sync`.' })
    return
  }
  if (o.ignored) {
    ctx.issues.push({ severity: 'warning', code: 'dual_axis_ignored', path: 'yRight', message: `yRight is ignored ${o.ignored}`, hint: 'Use vertical bars (or a line chart) for a right axis.' })
    return
  }
  let bad = false
  right.forEach((c, i) => {
    if (o.left.includes(c)) {
      bad = true
      ctx.issues.push({ severity: 'error', code: 'dual_axis_overlap', path: Array.isArray(spec.yRight) ? `yRight[${i}]` : 'yRight', message: `Column "${c}" is on both axes.`, hint: 'Give each column one axis: remove it from y (or line), or from yRight.' })
    }
  })
  if (bad) return
  ctx.issues.push({
    severity: 'info', code: 'dual_axis', path: 'yRight',
    message: `${fmtList(right.map(c => `"${clip(c, 40)}"`))} ${right.length === 1 ? 'is' : 'are'} drawn against a second value axis on the right. Two independent scales on one plot can suggest a relationship (where lines cross, how far apart they are, whether they move together) that is only the choice of the two ranges.`,
    hint: 'To compare growth, index every series to a common base (transform step {"index":{"field":...,"groupBy":[...]}}) and use one axis; to compare levels, draw two charts with `sync`. Keep the right axis only when the two measures are related and the reader needs both on one time line.'
  })
}

/** Values plotted on a broken axis, sorted by where they fall: below the cut, inside it, beyond it. */
export function breakPlan(values: number[], brk: [number, number], bars: boolean): { inside: number[]; beyond: boolean } {
  const [from, to] = brk
  const inside = values.filter(v => v > from && v < to)
  const above = values.some(v => v >= to)
  const below = values.some(v => v <= from)
  // Bars start at zero, outside the cut (validation makes sure): the far side is the one away from zero.
  const beyond = bars ? (from > 0 ? above : below) : above && below
  return { inside, beyond }
}

/**
 * Checks for `yBreak`. `values` are the numbers drawn on the value axis (summed per bar, as the chart draws them).
 * Returns true when the break will be drawn; a break with no value beyond it is removed from the normalised spec
 * (with a `break_outside` warning), so the chart draws it only when it is kept and falls inside the value range.
 */
export function breakCheck(spec: Record<string, any>, ctx: ValidateCtx, o: { values: number[]; bars: boolean; refused?: string }): boolean {
  const b = spec.yBreak as [number | null, number | null] | undefined
  if (b === undefined) return false
  const err = (code: string, message: string, hint: string): false => {
    ctx.issues.push({ severity: 'error', code, path: 'yBreak', message, hint })
    return false
  }
  if (b[0] === null || b[1] === null) return err('bad_value', 'yBreak needs two numbers, [from, to]: the span to cut out of the axis.', 'E.g. [50, 900] to cut out everything between 50 and 900.')
  const brk = b as [number, number]
  if (o.refused) return err('break_refused', `A broken axis is refused here: ${o.refused}`, 'Use facets or (on a line) a log scale to show values of very different size.')
  if (o.bars && brk[0] <= 0 && brk[1] >= 0) return err('break_misleading', `yBreak [${say(brk[0])}, ${say(brk[1])}] cuts out zero, where every bar starts: the bars that do not cross the break would lose their baseline and their lengths would mean nothing.`, 'Move the break to a span that every bar either crosses or stays below (both ends above zero, or both below), or drop it and use facets.')
  const plan = breakPlan(o.values, brk, o.bars)
  if (!plan.beyond) {
    ctx.issues.push({ severity: 'warning', code: 'break_outside', path: 'yBreak', message: `No value lies beyond yBreak [${say(brk[0])}, ${say(brk[1])}]${o.bars ? '' : ' on both sides'}, so there is nothing to bring closer: the break is not drawn.`, hint: 'Set the break between the small and the large values, or drop it.' })
    // The normalised spec says what is drawn, so the charts (and small multiples) only see a break that is.
    delete spec.yBreak
    return false
  }
  if (plan.inside.length) {
    const n = plan.inside.length
    ctx.issues.push({ severity: 'warning', code: 'break_hides_values', path: 'yBreak', message: `${n} ${n === 1 ? 'value lies' : 'values lie'} inside the cut-out span (${plan.inside.slice(0, 5).map(say).join(', ')}${n > 5 ? ', ...' : ''}); ${n === 1 ? 'it is' : 'they are'} drawn at the edge of the break, marked with a dashed outline, and tooltips say so.`, hint: 'A break should remove a span no value falls in. Narrow it so no value lies inside, or drop it.' })
  }
  ctx.issues.push({
    severity: 'info', code: 'axis_break', path: 'yBreak',
    message: `The value axis is cut from ${say(brk[0])} to ${say(brk[1])}: a span of ${say(brk[1] - brk[0])} is not drawn. ${o.bars ? 'Bars that cross the cut are drawn shorter than their value, so large and small bars look closer than they are' : 'Changes across the cut look smaller than they are'}; a zigzag gap marks the cut, and tooltips and the description give the real values.`,
    hint: 'To show values of very different size without hiding part of the scale, use facets, or a log scale on a line chart.'
  })
  return true
}

/** Pixels between the two sides of a broken axis. */
export const BREAK_GAP = 12

/**
 * A linear scale with the span [b0, b1] cut out: both sides share the range minus a `BREAK_GAP` px gap and keep the
 * same pixels per unit. A value inside the span is placed proportionally inside the gap. `minPx`: tick labels on the
 * two sides of the gap that are closer than this are thinned (the outer side keeps its tick).
 */
export function brokenScale(domain: [number, number], brk: [number, number], minPx: number): LinearScale & { breaks: [number, number] } {
  const [b0, b1] = brk
  const lowSpan = (): number => b0 - s.domain[0]
  const span = (): number => lowSpan() + (s.domain[1] - b1)
  const geom = (): { r0: number; dir: number; k: number } => {
    const [r0, r1] = s.range
    const dir = r1 >= r0 ? 1 : -1
    const avail = Math.max(1, Math.abs(r1 - r0) - BREAK_GAP)
    return { r0, dir, k: span() > 0 ? avail / span() : 0 }
  }
  const s: LinearScale & { breaks: [number, number] } = {
    kind: 'linear',
    domain,
    breaks: [b0, b1],
    range: [0, 1],
    bandwidth: 0,
    at(v: number) {
      const { r0, dir, k } = geom()
      if (v <= b0) return r0 + dir * (v - s.domain[0]) * k
      const edge = lowSpan() * k
      if (v >= b1) return r0 + dir * (edge + BREAK_GAP + (v - b1) * k)
      return r0 + dir * (edge + ((v - b0) / (b1 - b0)) * BREAK_GAP)
    },
    invert(px: number) {
      const { r0, dir, k } = geom()
      const d = (px - r0) * dir
      const edge = lowSpan() * k
      if (k === 0) return s.domain[0]
      if (d <= edge) return s.domain[0] + d / k
      if (d >= edge + BREAK_GAP) return b1 + (d - edge - BREAK_GAP) / k
      return b0 + ((d - edge) / BREAK_GAP) * (b1 - b0)
    },
    ticks(count: number) {
      const total = span()
      const nLow = Math.max(2, Math.round((count * lowSpan()) / Math.max(1e-12, total)))
      const nHigh = Math.max(2, Math.round((count * (s.domain[1] - b1)) / Math.max(1e-12, total)))
      const low = linearTicks(s.domain[0], b0, nLow).filter(v => v <= b0)
      const high = linearTicks(b1, s.domain[1], nHigh).filter(v => v >= b1)
      if (Math.abs(s.range[1] - s.range[0]) > 1) {
        // Thin the ticks that sit next to the gap until both sides have room for their labels.
        while (low.length > 1 && high.length && Math.abs(s.at(high[0]) - s.at(low[low.length - 1])) < minPx) low.pop()
        while (high.length > 1 && low.length && Math.abs(s.at(high[0]) - s.at(low[low.length - 1])) < minPx) high.shift()
      }
      return [...low, ...high]
    }
  }
  return s
}

/** The cut on a broken axis: a gap in the surface colour across the plot, edged by two zigzags that cross the axis. */
export function drawBreak(c: ChartCtx, plot: Rect, scale: LinearScale & { breaks?: [number, number] }, vertical: boolean): Mark[] {
  if (!scale.breaks) return []
  const [b0, b1] = scale.breaks
  const p0 = scale.at(b0)
  const p1 = scale.at(b1)
  const amp = 2.5
  const step = 6
  const r = (v: number): number => Math.round(v * 100) / 100
  // Along the axis direction `a` (pixels on the value axis), across from `from` to `to`.
  const zig = (a: number, from: number, to: number): [number, number][] => {
    const pts: [number, number][] = []
    const n = Math.max(2, Math.ceil(Math.abs(to - from) / step))
    for (let i = 0; i <= n; i++) pts.push([from + ((to - from) * i) / n, a + (i % 2 ? amp : -amp)])
    return pts
  }
  const start = (vertical ? plot.x : plot.y + plot.h) + (vertical ? -6 : 6)
  const end = vertical ? plot.x + plot.w : plot.y
  const e0 = zig(p0, start, end)
  const e1 = zig(p1, start, end)
  const xy = ([u, v]: [number, number]): string => (vertical ? `${r(u)} ${r(v)}` : `${r(v)} ${r(u)}`)
  const line = (pts: [number, number][]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${xy(p)}`).join('')
  const gap = `${line(e0)}${[...e1].reverse().map(p => `L${xy(p)}`).join('')}Z`
  const muted = c.c('text-muted')
  return [
    { type: 'path', role: 'annotation', d: gap, fill: c.c('background') },
    { type: 'path', role: 'annotation', d: line(e0), stroke: muted, strokeWidth: 1.25 },
    { type: 'path', role: 'annotation', d: line(e1), stroke: muted, strokeWidth: 1.25 }
  ]
}

/**
 * The colour an axis's title and tick labels take from its one series: the series colour when it reads as text on
 * the background (4.5:1), otherwise that colour mixed towards the text colour until it does.
 */
export function axisInk(c: ChartCtx, key: string, index: number, color: string): string {
  const hex = c.seriesHex(key, index)
  const bg = tokenValue(c.theme, 'background')
  const text = tokenValue(c.theme, 'text')
  if (contrast(hex, bg) >= 4.5) return color
  for (let t = 0.1; t < 1; t += 0.1) {
    const m = mix(hex, text, Math.round(t * 10) / 10)
    if (contrast(m, bg) >= 4.5) return m
  }
  return text
}

/**
 * Line up the zeros of two value domains that both include zero (bars on two axes): the one whose zero sits lower is
 * extended downwards (never cut), so a bar or a line at zero means zero on both sides.
 */
export function alignZero(a: [number, number], b: [number, number]): [[number, number], [number, number]] {
  const frac = (d: [number, number]): number => (d[1] === d[0] ? 0 : -d[0] / (d[1] - d[0]))
  if (!(a[0] <= 0 && a[1] >= 0 && b[0] <= 0 && b[1] >= 0)) return [a, b]
  const t = Math.max(frac(a), frac(b))
  if (!(t < 1)) return [a, b]
  const fix = (d: [number, number]): [number, number] => (frac(d) < t && d[1] > 0 ? [(-t * d[1]) / (1 - t), d[1]] : d)
  return [fix(a), fix(b)]
}

/** Lowest and highest of some numbers, as text in a format (for the description). */
export function rangeText(values: number[], format: string | undefined, locale: string): string {
  if (!values.length) return 'no values'
  const f = valueFormatter(format, locale)
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v }
  return lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`
}

/** The description's sentence on two value axes. */
export function dualNote(spec: Record<string, any>, left: { keys: string[]; values: number[] }, right: { keys: string[]; values: number[] }, locale: string): string {
  const axis = (side: string, label: unknown): string => `the ${side} axis${typeof label === 'string' && label ? ` (${clip(label, 60)})` : ''}`
  return ` Two value axes with independent scales: ${axis('left', spec.yLabel)} shows ${fmtList(left.keys.map(k => clip(k, 40)))} (${rangeText(left.values, spec.format, locale)}); ${axis('right', spec.yRightLabel)} shows ${fmtList(right.keys.map(k => clip(k, 40)))} (${rangeText(right.values, spec.formatRight ?? spec.format, locale)}). Where the lines meet or how steep they look depends on the two chosen ranges, not on the data.`
}

/** The description's sentence on a broken axis. */
export function breakNote(spec: Record<string, any>, values: number[], bars: boolean, locale: string): string {
  const brk = spec.yBreak as [number, number] | undefined
  if (!brk || brk[0] === null || brk[1] === null) return ''
  const f = valueFormatter(spec.format, locale)
  const inside = breakPlan(values, brk, bars).inside.length
  return ` The value axis is broken: the span from ${f(brk[0])} to ${f(brk[1])} is cut out, so ${bars ? 'bars that cross it are drawn shorter than their value' : 'changes across it look smaller than they are'}; the values given here are the real ones.${inside ? ` ${inside} ${inside === 1 ? 'value lies' : 'values lie'} inside the cut and ${inside === 1 ? 'is' : 'are'} drawn at its edge.` : ''}`
}
