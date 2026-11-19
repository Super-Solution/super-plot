import type { Row } from './schema.js'
import { toNumber } from './util/num.js'
import { toTime } from './util/time.js'

export type XKind = 'category' | 'linear' | 'time'

/** One observation in long form. `y` is `null` where the value is missing. */
export interface Obs {
  /** Raw x value from the row. */
  x: unknown
  y: number | null
  /** Series key. */
  s: string
  row: Row
}

/** Normalise `y` (one column, many columns, or a series column) into long-form observations. */
export function observations(rows: Row[], x: string | undefined, y: string | string[], series?: string): Obs[] {
  const ys = Array.isArray(y) ? y : [y]
  const out: Obs[] = []
  for (const row of rows) {
    for (const col of ys) {
      const s = ys.length > 1 || !series ? col : String(row[series] ?? '')
      out.push({ x: x === undefined ? out.length : row[x], y: toNumber(row[col]), s, row })
    }
  }
  return out
}

export function detectXKind(requested: string | undefined, values: unknown[]): XKind {
  if (requested === 'category' || requested === 'linear' || requested === 'time') return requested
  let allNum = true
  let allTime = true
  let n = 0
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue
    n++
    if (typeof v !== 'number' || !Number.isFinite(v)) allNum = false
    if (typeof v === 'number' || toTime(v) === null) allTime = false
    if (!allNum && !allTime) break
  }
  if (n === 0) return 'category'
  if (allNum) return 'linear'
  if (allTime) return 'time'
  return 'category'
}

/** Distinct values in order of first appearance. */
export function distinct<T>(values: Iterable<T>): T[] {
  return [...new Set(values)]
}

export const xKey = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
