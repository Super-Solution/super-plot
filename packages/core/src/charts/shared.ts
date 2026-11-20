// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { Row } from '../schema.js'
import { r2, toNumber } from '../util/num.js'
import type { ChartCtx } from '../context.js'
import { mix } from '../util/color.js'
import { tokenValue } from '../theme.js'
import { clip } from '../util/text.js'
import { xKey } from '../data.js'
import type { ValueFormat } from '../util/format.js'
import { valueFormatter } from '../util/format.js'

export const title = (spec: Record<string, any>, fallback: string): string => (spec.title ? clip(spec.title, 120) : fallback)

/** "Bar chart "Revenue by region"." style lead for descriptions. */
export const lead = (spec: Record<string, any>, kind: string): string => (spec.title ? `${kind} "${clip(spec.title, 120)}".` : `${kind}.`)

export const fmtList = (items: string[], max = 5): string => (items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`)

export function formatter(spec: Record<string, any>, locale: string): (v: number) => string {
  return valueFormatter(spec.format as ValueFormat | undefined, locale)
}

/** Sum duplicates: category x series -> value. Missing stays absent. */
export function matrix(obs: { x: unknown; y: number | null; s: string }[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>()
  for (const o of obs) {
    if (o.y === null) continue
    const k = xKey(o.x)
    let row = m.get(k)
    if (!row) m.set(k, (row = new Map()))
    row.set(o.s, (row.get(o.s) ?? 0) + o.y)
  }
  return m
}

export const numCol = (rows: Row[], col: string): number[] => {
  const out: number[] = []
  for (const r of rows) {
    const n = toNumber(r[col])
    if (n !== null) out.push(n)
  }
  return out
}

/** SVG path of a ring sector (a pie slice when `r0` is 0), angles in radians clockwise from the x axis. */
export const arc = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string => {
  const pt = (r: number, a: number): string => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const m = a0 + Math.PI
    const outer = `M${pt(r1, a0)}A${r1} ${r1} 0 1 1 ${pt(r1, m)}A${r1} ${r1} 0 1 1 ${pt(r1, a0)}`
    return r0 > 0 ? `${outer}M${pt(r0, a0)}A${r0} ${r0} 0 1 0 ${pt(r0, m)}A${r0} ${r0} 0 1 0 ${pt(r0, a0)}Z` : outer + 'Z'
  }
  if (r0 <= 0) return `M${cx} ${cy}L${pt(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)}Z`
  return `M${pt(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)}Z`
}

/**
 * The single-hue sequential colour scale of heatmaps and calendars: `seq-low` at `lo` to `seq-high` at `hi`,
 * clamped. Plain hex, so labels can pick a contrasting ink.
 */
export function seqScale(c: ChartCtx, lo: number, hi: number): (v: number) => string {
  const low = tokenValue(c.theme, 'seq-low')
  const high = tokenValue(c.theme, 'seq-high')
  return v => mix(low, high, hi === lo ? 1 : Math.max(0, Math.min(1, (v - lo) / (hi - lo))))
}

/** Vertical colour ramp legend for {@link seqScale}: high at the top, the two ends labelled. */
export function seqLegend(c: ChartCtx, x: number, y0: number, h: number, lo: number, hi: number): void {
  const low = tokenValue(c.theme, 'seq-low')
  const high = tokenValue(c.theme, 'seq-high')
  const n = 24
  for (let i = 0; i < n; i++) {
    c.marks.push({ type: 'rect', role: 'legend', x, y: y0 + (h / n) * i, w: 12, h: h / n + 0.5, fill: mix(high, low, i / (n - 1)) })
  }
  c.marks.push(c.text(x + 18, y0 + 4, c.format(hi), { role: 'legend', baseline: 'middle', size: c.size - 1 }))
  c.marks.push(c.text(x + 18, y0 + h - 4, c.format(lo), { role: 'legend', baseline: 'middle', size: c.size - 1 }))
}

const BY_ASSISTANT = ' (added by the assistant)'

/**
 * The annotations, for the description ("" when there is nothing to say): one sentence for the labelled points
 * ("Marked: ..."), each one an assistant added (`by: "assistant"`) said so; and one for the reference lines and
 * bands an assistant added ("The assistant marked ..."), since a reader must know which marks are not the author's.
 * At most five of each are named.
 */
export function pointNotes(spec: Record<string, any>): string {
  const all = (spec.annotations ?? []) as Record<string, unknown>[]
  const pts = all.filter(a => !('axis' in a) && typeof a.label === 'string')
  const more = (n: number): string => (n > 5 ? ` and ${n - 5} more` : '')
  let out = ''
  if (pts.length) {
    const list = pts.slice(0, 5).map(a => `"${clip(String(a.label), 40)}" at ${clip(String(a.x), 30)}, ${clip(String(a.y), 30)}${a.by === 'assistant' ? BY_ASSISTANT : ''}`)
    out += ` Marked: ${list.join('; ')}${more(pts.length)}.`
  }
  const lines = all.filter(a => 'axis' in a && a.by === 'assistant')
  if (lines.length) {
    const list = lines.slice(0, 5).map(a => `${typeof a.label === 'string' && a.label ? `"${clip(a.label, 40)}" at ` : ''}${String(a.axis)} ${clip(String(a.value), 30)}${a.to !== undefined ? ` to ${clip(String(a.to), 30)}` : ''}`)
    out += ` The assistant marked ${list.join('; ')}${more(lines.length)}.`
  }
  return out
}
