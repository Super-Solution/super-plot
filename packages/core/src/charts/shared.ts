import type { Row } from '../schema.js'
import { toNumber } from '../util/num.js'
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
