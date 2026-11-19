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
    if (f.kind !== 'column' && f.kind !== 'columns' && f.kind !== 'flag') continue
    const v = s[name]
    if (f.kind === 'flag' && typeof v !== 'string') continue
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

export interface CsvOptions {
  /** Rows to write at most. Default: all of them (validation already caps `data` at 50,000 rows). */
  maxRows?: number
  /** Field separator. Default `,`; `;` for spreadsheets set to a decimal comma, a tab for TSV. */
  separator?: ',' | ';' | '\t'
}

const PLAIN_NUMBER = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/
// A spreadsheet runs a cell that starts with one of these as a formula (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/

/** One CSV field: formula-looking text is defused with a leading apostrophe, then quoted per RFC 4180 when needed. */
export function csvCell(v: string | number | boolean | null, separator: string = ','): string {
  if (v === null) return ''
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v)
  if (typeof v === 'string' && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`
  if (s.includes('"') || s.includes(separator) || s.includes('\n') || s.includes('\r')) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * The data a chart shows as CSV: the same columns and rows as {@link plotTable} (after `transform`), with a
 * header row, CRLF line ends and RFC 4180 quoting. Text that a spreadsheet would run as a formula (starting
 * with `=`, `+`, `-`, `@`, a tab or a carriage return) gets a leading apostrophe; numbers, negative ones
 * included, stay numbers. Null when the spec is invalid.
 */
export function plotCsv(spec: unknown, options: CsvOptions = {}): string | null {
  const t = plotTable(spec, { maxRows: options.maxRows ?? Infinity })
  if (!t) return null
  const sep = options.separator ?? ','
  const line = (cells: (string | number | boolean | null)[]): string => cells.map(c => csvCell(c, sep)).join(sep) + '\r\n'
  return line(t.columns.map(c => c.key)) + t.rows.map(line).join('')
}
