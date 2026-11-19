import { fieldsOf, getChart } from './registry.js'
import { validatePlot } from './validate.js'

export interface PlotTable {
  /** The chart title, or its type. */
  caption: string
  /** The columns the chart reads, in the order its fields list them. */
  columns: { key: string; numeric: boolean }[]
  rows: (string | number | boolean | null)[][]
  /** Rows the chart has (after `transform`); `rows` holds at most `maxRows` of them. */
  total: number
}

/**
 * The data a chart shows, as a table: the columns its fields name, over the rows after `transform`. For a
 * screen reader, a "show the data" toggle or an export. Null when the spec is invalid.
 */
export function plotTable(spec: unknown, options: { maxRows?: number } = {}): PlotTable | null {
  const r = validatePlot(spec)
  if (!r.ok || !r.spec) return null
  const s = r.spec as Record<string, any>
  const def = getChart(String(s.type))
  const data = (Array.isArray(s.data) ? s.data : []) as Record<string, unknown>[]
  const keys: string[] = []
  const add = (k: unknown): void => { if (typeof k === 'string' && k && !keys.includes(k)) keys.push(k) }
  if (def) for (const [name, f] of Object.entries(fieldsOf(def))) {
    if (f.kind !== 'column' && f.kind !== 'columns') continue
    const v = s[name]
    if (Array.isArray(v)) v.forEach(add)
    else add(v)
  }
  if (!keys.length) for (const row of data.slice(0, 50)) Object.keys(row).forEach(add)
  const max = Math.max(0, options.maxRows ?? 1000)
  const cell = (v: unknown): string | number | boolean | null => (v === undefined || v === null ? null : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : String(v))
  const rows = data.slice(0, max).map(row => keys.map(k => cell(row[k])))
  const columns = keys.map((key, i) => ({ key, numeric: rows.length > 0 && rows.every(x => x[i] === null || typeof x[i] === 'number') && rows.some(x => typeof x[i] === 'number') }))
  return { caption: typeof s.title === 'string' && s.title ? s.title : `${s.type} chart`, columns, rows, total: data.length }
}
