// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `transform`: a short list of data steps that run before the chart reads its columns, so an agent can send
 * raw rows and say "monthly average per region" in the spec instead of computing it. Steps are plain JSON
 * (no expressions, nothing executable) and run in order. The output of each step is the input of the next.
 *
 *   { "filter":    { "field": "region", "oneOf": ["APAC", "EMEA"] } }
 *   { "filter":    { "field": "date", "range": ["2026-01-01", "2026-07-01"] } }   from inclusive, to exclusive
 *   { "timeUnit":  { "field": "date", "unit": "month", "as": "month" } }
 *   { "aggregate": { "groupBy": ["month", "region"], "fields": { "revenue": "sum" }, "count": "orders" } }
 *   { "sort":      { "field": "revenue", "order": "descending" } }
 *   { "top":       { "n": 10, "by": "revenue" } }
 *   { "bin":       { "field": "price", "maxbins": 10, "as": ["from", "to"] } }        round edges, as the histogram
 *   { "window":    { "op": "sum", "field": "revenue", "as": "running", "groupBy": ["region"], "sortBy": "date" } }
 *   { "fold":      { "fields": ["Q1", "Q2", "Q3"], "as": ["quarter", "revenue"] } }  wide to long
 *
 * There is deliberately no expression step (`calculate`): evaluating text from a spec is an injection risk, and
 * a second language to port to Go and Python bit for bit.
 * A brush selection in the web binding (`onBrush`) has the same shape as a filter, so it can be pasted in.
 */
import type { Issue, Row } from './schema.js'
import { closest, toNumber } from './util/num.js'
import { toTime } from './util/time.js'
import { binIndex, transformBinEdges } from './util/bins.js'
import { LIMITS } from './schema.js'

/** At most this many steps. Ten covers every realistic pipeline (filter, fold, bin, aggregate, window, sort, top). */
export const TRANSFORM_LIMIT = 10
export const TRANSFORM_OPS = ['filter', 'timeUnit', 'aggregate', 'sort', 'top', 'bin', 'window', 'fold'] as const
export const WINDOW_OPS = ['sum', 'mean', 'count', 'rank', 'pctChange', 'lag', 'lead', 'movingMean'] as const
/** `bin` makes at most this many bins; `fold` folds at most this many columns. */
export const BIN_LIMIT = 200
export const FOLD_LIMIT = 50
export const TIME_UNITS = ['year', 'quarter', 'month', 'week', 'day', 'hour'] as const
export const AGGREGATE_OPS = ['sum', 'mean', 'median', 'min', 'max', 'count', 'distinct'] as const
const FILTER_KEYS = ['field', 'equal', 'oneOf', 'range', 'gt', 'gte', 'lt', 'lte', 'valid'] as const
/** One line per step, with an example: the generated reference (docs/SPEC.md) prints these. */
export const TRANSFORM_DOCS: Record<(typeof TRANSFORM_OPS)[number], { desc: string; example: Record<string, unknown> }> = {
  filter: { desc: 'Keep the rows whose `field` passes every test given: equal, oneOf, range [from inclusive, to exclusive], gt, gte, lt, lte (numbers or ISO dates), valid.', example: { filter: { field: 'region', oneOf: ['APAC', 'EMEA'] } } },
  timeUnit: { desc: 'Bucket a date column to the start of its year, quarter, month, week (Monday), day or hour (UTC), as an ISO date in `as` (default: in place).', example: { timeUnit: { field: 'date', unit: 'month', as: 'month' } } },
  aggregate: { desc: 'One row per group (`groupBy`, at most 4 columns) with `fields` reduced by sum, mean, median, min, max, count or distinct, and `count` rows. Only those columns remain.', example: { aggregate: { groupBy: ['month'], fields: { revenue: 'sum' }, count: 'orders' } } },
  sort: { desc: 'Stable sort by `field`: numbers and dates by value, then text, missing last; `order` ascending (default) or descending.', example: { sort: { field: 'revenue', order: 'descending' } } },
  top: { desc: 'The `n` rows (1 to 1000) with the largest `by`.', example: { top: { n: 10, by: 'revenue' } } },
  bin: { desc: 'Round bins of a numeric `field`, as the histogram makes them: adds start and end columns (`as`, default [field_start, field_end]; a non-number gets null). `step` sets the width; otherwise the histogram step for `maxbins` (default 10), made coarser until there are at most `maxbins` bins.', example: { bin: { field: 'price', maxbins: 10, as: ['from', 'to'] } } },
  window: { desc: 'Adds `as`: an op over each `groupBy` group walked in `sortBy` order (`order` asc or desc; no sortBy keeps the data order). sum, mean, count run cumulatively; rank is the standard competition rank of the sort key (1, 2, 2, 4; by `field` without sortBy); pctChange is (v - previous) / |previous|; lag and lead read the previous and next row; movingMean averages the last `frame` rows (default 3). Rows keep their order.', example: { window: { op: 'sum', field: 'revenue', as: 'running', groupBy: ['region'], sortBy: 'date' } } },
  fold: { desc: 'Wide to long: each row becomes one row per column in `fields`, with the column name in `as[0]` and its value in `as[1]` (default key, value); the folded columns are dropped.', example: { fold: { fields: ['Q1', 'Q2', 'Q3'], as: ['quarter', 'revenue'] } } }
}

export const TRANSFORM_KEYS: Record<(typeof TRANSFORM_OPS)[number], readonly string[]> = {
  filter: FILTER_KEYS,
  timeUnit: ['field', 'unit', 'as'],
  aggregate: ['groupBy', 'fields', 'count'],
  sort: ['field', 'order'],
  top: ['n', 'by'],
  bin: ['field', 'as', 'step', 'maxbins'],
  window: ['op', 'field', 'as', 'groupBy', 'sortBy', 'order', 'frame'],
  fold: ['fields', 'as']
}

type Scalar = string | number | boolean | null
export type FilterStep = {
  field: string
  equal?: Scalar
  oneOf?: Scalar[]
  range?: [number | string | null, number | string | null]
  gt?: number | string
  gte?: number | string
  lt?: number | string
  lte?: number | string
  valid?: boolean
}
export type TransformStep =
  | { filter: FilterStep }
  | { timeUnit: { field: string; unit: (typeof TIME_UNITS)[number]; as?: string } }
  | { aggregate: { groupBy?: string[]; fields?: Record<string, (typeof AGGREGATE_OPS)[number]>; count?: string } }
  | { sort: { field: string; order?: 'ascending' | 'descending' } }
  | { top: { n: number; by: string } }
  | { bin: { field: string; as?: [string, string]; step?: number; maxbins?: number } }
  | { window: { op: (typeof WINDOW_OPS)[number]; field: string; as: string; groupBy?: string[]; sortBy?: string; order?: 'asc' | 'desc'; frame?: number } }
  | { fold: { fields: string[]; as?: [string, string] } }

const fmt = (v: unknown): string => {
  const s = JSON.stringify(v) ?? String(v)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

/** A row value or bound as a number: numbers first, then ISO dates (epoch ms). */
export const ordinal = (v: unknown): number | null => toNumber(v) ?? toTime(v)

const isName = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 64
const isMissing = (v: unknown): boolean => v === null || v === undefined || v === ''
const isScalar = (v: unknown): v is Scalar => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
const isBound = (v: unknown): v is number | string => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && ordinal(v) !== null)

/**
 * Check the steps against the columns they will see (each step's output feeds the next) and run them.
 * Returns the transformed rows, or null when a step is invalid (the issues say why).
 */
export function applyTransform(value: unknown, rows: Row[], issues: Issue[], path = 'transform'): Row[] | null {
  const err = (p: string, code: string, message: string, hint?: string): null => {
    issues.push({ severity: 'error', code, path: p, message, ...(hint ? { hint } : {}) })
    return null
  }
  if (!Array.isArray(value)) return err(path, 'bad_type', 'transform must be an array of steps.', 'Example: [{"filter":{"field":"region","oneOf":["APAC"]}}]')
  if (value.length > TRANSFORM_LIMIT) return err(path, 'too_many', `At most ${TRANSFORM_LIMIT} transform steps; got ${value.length}.`)
  let cur = rows
  let columns = columnsOf(rows)
  for (let i = 0; i < value.length; i++) {
    const p = `${path}[${i}]`
    const step = value[i]
    if (!step || typeof step !== 'object' || Array.isArray(step)) return err(p, 'bad_type', `${p} must be an object with one key: ${TRANSFORM_OPS.join(', ')}.`)
    const keys = Object.keys(step)
    if (keys.length !== 1 || !(TRANSFORM_OPS as readonly string[]).includes(keys[0])) {
      const near = keys.length === 1 ? closest(keys[0], TRANSFORM_OPS) : undefined
      return err(p, 'bad_transform', `${p} must have exactly one of ${TRANSFORM_OPS.join(', ')}; got ${keys.length ? keys.join(', ') : 'nothing'}.`, near ? `Did you mean "${near}"?` : undefined)
    }
    const op = keys[0] as (typeof TRANSFORM_OPS)[number]
    const body = (step as Record<string, unknown>)[op]
    const bp = `${p}.${op}`
    if (!body || typeof body !== 'object' || Array.isArray(body)) return err(bp, 'bad_type', `${bp} must be an object.`)
    const b = body as Record<string, unknown>
    for (const k of Object.keys(b)) {
      if (!TRANSFORM_KEYS[op].includes(k)) {
        const near = closest(k, TRANSFORM_KEYS[op])
        return err(`${bp}.${k}`, 'unknown_field', `Unknown ${op} field "${k}".`, near ? `Did you mean "${near}"?` : `Allowed: ${TRANSFORM_KEYS[op].join(', ')}.`)
      }
    }
    const column = (k: string, required = true): string | null | undefined => {
      const v = b[k]
      if (v === undefined) return required ? err(`${bp}.${k}`, 'missing_required', `${bp} needs "${k}" (a column name).`) : undefined
      if (typeof v !== 'string') return err(`${bp}.${k}`, 'bad_type', `${bp}.${k} must be a column name, got ${fmt(v)}.`)
      if (!columns.has(v)) {
        const near = closest(v, [...columns])
        return err(`${bp}.${k}`, 'no_such_column', `Column "${v}" does not exist at this step.`, `${near ? `Did you mean "${near}"? ` : ''}Columns here: ${[...columns].slice(0, 20).join(', ')}.`)
      }
      return v
    }
    switch (op) {
      case 'filter': {
        const field = column('field')
        if (field == null) return null
        const preds = FILTER_KEYS.filter(k => k !== 'field' && b[k] !== undefined)
        if (!preds.length) return err(bp, 'missing_required', `${bp} needs a test: equal, oneOf, range, gt, gte, lt, lte or valid.`)
        if (b.equal !== undefined && !isScalar(b.equal)) return err(`${bp}.equal`, 'bad_type', `${bp}.equal must be a string, number, boolean or null.`)
        if (b.oneOf !== undefined && !(Array.isArray(b.oneOf) && b.oneOf.length <= 1000 && b.oneOf.every(isScalar))) return err(`${bp}.oneOf`, 'bad_type', `${bp}.oneOf must be an array of at most 1000 strings, numbers, booleans or nulls.`)
        if (b.range !== undefined) {
          const r = b.range
          if (!Array.isArray(r) || r.length !== 2 || !r.every(v => v === null || isBound(v))) return err(`${bp}.range`, 'bad_value', `${bp}.range must be [from, to]: numbers, ISO dates or null (open); got ${fmt(r)}.`)
          if (r[0] !== null && r[1] !== null && ordinal(r[0])! > ordinal(r[1])!) return err(`${bp}.range`, 'bad_value', `${bp}.range from must not be after to.`)
        }
        for (const k of ['gt', 'gte', 'lt', 'lte'] as const) if (b[k] !== undefined && !isBound(b[k])) return err(`${bp}.${k}`, 'bad_value', `${bp}.${k} must be a number or an ISO date, got ${fmt(b[k])}.`)
        if (b.valid !== undefined && typeof b.valid !== 'boolean') return err(`${bp}.valid`, 'bad_type', `${bp}.valid must be true or false.`)
        cur = cur.filter(filterRow(b as unknown as FilterStep))
        break
      }
      case 'timeUnit': {
        const field = column('field')
        if (field == null) return null
        if (!(TIME_UNITS as readonly string[]).includes(b.unit as string)) {
          const near = typeof b.unit === 'string' ? closest(b.unit, TIME_UNITS) : undefined
          return err(`${bp}.unit`, 'bad_enum', `${bp}.unit must be one of ${TIME_UNITS.join(', ')}; got ${fmt(b.unit)}.`, near ? `Did you mean "${near}"?` : undefined)
        }
        if (b.as !== undefined && (typeof b.as !== 'string' || !b.as || b.as.length > 64)) return err(`${bp}.as`, 'bad_type', `${bp}.as must be a column name of 1 to 64 characters.`)
        const as = (b.as as string | undefined) ?? field
        const unit = b.unit as (typeof TIME_UNITS)[number]
        let bad = 0
        cur = cur.map(r => {
          const t0 = toTime(r[field])
          const t = t0 !== null && t0 >= MIN_TIME && t0 <= MAX_TIME ? t0 : null
          if (t === null) bad++
          return { ...r, [as]: t === null ? null : bucket(t, unit) }
        })
        if (bad === cur.length && cur.length) return err(`${bp}.field`, 'not_time', `Column "${field}" has no dates (ISO 8601 strings or epoch milliseconds, years 1 to 9999).`)
        if (bad) issues.push({ severity: 'warning', code: 'some_not_time', path: `${bp}.field`, message: `${bad} of ${cur.length} values in "${field}" are not dates (or fall outside years 1 to 9999); they become null.` })
        columns = new Set([...columns, as])
        break
      }
      case 'aggregate': {
        const groupBy = b.groupBy ?? []
        if (!Array.isArray(groupBy) || groupBy.length > 4 || !groupBy.every(g => typeof g === 'string')) return err(`${bp}.groupBy`, 'bad_type', `${bp}.groupBy must be an array of at most 4 column names.`)
        for (const [gi, g] of (groupBy as string[]).entries()) {
          if (!columns.has(g)) {
            const near = closest(g, [...columns])
            return err(`${bp}.groupBy[${gi}]`, 'no_such_column', `Column "${g}" does not exist at this step.`, `${near ? `Did you mean "${near}"? ` : ''}Columns here: ${[...columns].slice(0, 20).join(', ')}.`)
          }
        }
        const fields = b.fields ?? {}
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return err(`${bp}.fields`, 'bad_type', `${bp}.fields must be an object of column to operation, e.g. {"revenue":"sum"}.`)
        for (const [col, o] of Object.entries(fields as Record<string, unknown>)) {
          if (!columns.has(col)) {
            const near = closest(col, [...columns])
            return err(`${bp}.fields.${col}`, 'no_such_column', `Column "${col}" does not exist at this step.`, near ? `Did you mean "${near}"?` : undefined)
          }
          if (!(AGGREGATE_OPS as readonly string[]).includes(o as string)) {
            const near = typeof o === 'string' ? closest(o, AGGREGATE_OPS) : undefined
            return err(`${bp}.fields.${col}`, 'bad_enum', `${bp}.fields.${col} must be one of ${AGGREGATE_OPS.join(', ')}; got ${fmt(o)}.`, near ? `Did you mean "${near}"?` : undefined)
          }
        }
        if (b.count !== undefined && (typeof b.count !== 'string' || !b.count || b.count.length > 64)) return err(`${bp}.count`, 'bad_type', `${bp}.count must be a column name of 1 to 64 characters.`)
        if (!Object.keys(fields).length && b.count === undefined) return err(bp, 'missing_required', `${bp} needs "fields" (e.g. {"revenue":"sum"}) or "count" (a name for the row count).`)
        cur = aggregate(cur, groupBy as string[], fields as Record<string, (typeof AGGREGATE_OPS)[number]>, b.count as string | undefined)
        columns = new Set([...(groupBy as string[]), ...Object.keys(fields), ...(b.count ? [b.count as string] : [])])
        break
      }
      case 'sort': {
        const field = column('field')
        if (field == null) return null
        if (b.order !== undefined && b.order !== 'ascending' && b.order !== 'descending') return err(`${bp}.order`, 'bad_enum', `${bp}.order must be "ascending" or "descending".`)
        cur = sortRows(cur, field, b.order === 'descending')
        break
      }
      case 'top': {
        const by = column('by')
        if (by == null) return null
        if (typeof b.n !== 'number' || !Number.isInteger(b.n) || b.n < 1 || b.n > 1000) return err(`${bp}.n`, 'bad_value', `${bp}.n must be an integer from 1 to 1000, got ${fmt(b.n)}.`)
        cur = sortRows(cur, by, true).slice(0, b.n)
        break
      }
      case 'bin': {
        const field = column('field')
        if (field == null) return null
        const as = b.as === undefined ? [`${field}_start`, `${field}_end`] : b.as
        if (!Array.isArray(as) || as.length !== 2 || !as.every(isName) || as[0] === as[1]) return err(`${bp}.as`, 'bad_type', `${bp}.as must be two different column names of 1 to 64 characters: [start, end].`, 'E.g. ["from", "to"].')
        if (b.maxbins !== undefined && (typeof b.maxbins !== 'number' || !Number.isInteger(b.maxbins) || b.maxbins < 1 || b.maxbins > BIN_LIMIT)) return err(`${bp}.maxbins`, 'bad_value', `${bp}.maxbins must be an integer from 1 to ${BIN_LIMIT}, got ${fmt(b.maxbins)}.`)
        if (b.step !== undefined && (typeof b.step !== 'number' || !Number.isFinite(b.step) || b.step <= 0)) return err(`${bp}.step`, 'bad_value', `${bp}.step must be a positive number (the bin width), got ${fmt(b.step)}.`)
        const nums = cur.map(r => toNumber(r[field]))
        const vals = nums.filter((v): v is number => v !== null)
        const present = cur.filter(r => !isMissing(r[field])).length
        if (!vals.length) return err(`${bp}.field`, 'not_numeric', `Column "${field}" has no numeric values to bin.`, 'Bin a numeric column, or convert the values to numbers first.')
        if (b.step !== undefined) {
          let lo = Infinity, hi = -Infinity
          for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v }
          if ((hi - lo) / (b.step as number) > BIN_LIMIT) return err(`${bp}.step`, 'too_many_bins', `${bp}.step ${b.step} cuts ${fmt(lo)} to ${fmt(hi)} into more than ${BIN_LIMIT} bins.`, 'Use a wider step, or leave it out and set maxbins.')
        }
        if (vals.length < present) issues.push({ severity: 'warning', code: 'some_not_numeric', path: `${bp}.field`, message: `${present - vals.length} of ${present} values in "${field}" are not numeric; their bin is null.` })
        const edges = transformBinEdges(vals, (b.maxbins as number | undefined) ?? 10, b.step as number | undefined)
        const [s0, s1] = as as [string, string]
        cur = cur.map((r, ri) => {
          const v = nums[ri]
          const k = v === null ? -1 : binIndex(v, edges)
          return { ...r, [s0]: k < 0 ? null : edges[k], [s1]: k < 0 ? null : edges[k + 1] }
        })
        columns = new Set([...columns, s0, s1])
        break
      }
      case 'window': {
        if (!(WINDOW_OPS as readonly string[]).includes(b.op as string)) {
          const near = typeof b.op === 'string' ? closest(b.op, WINDOW_OPS) : undefined
          return err(`${bp}.op`, b.op === undefined ? 'missing_required' : 'bad_enum', `${bp}.op must be one of ${WINDOW_OPS.join(', ')}; got ${fmt(b.op)}.`, near ? `Did you mean "${near}"?` : undefined)
        }
        const op = b.op as (typeof WINDOW_OPS)[number]
        const field = column('field')
        if (field == null) return null
        if (b.as === undefined) return err(`${bp}.as`, 'missing_required', `${bp} needs "as" (a name for the new column).`)
        if (!isName(b.as)) return err(`${bp}.as`, 'bad_type', `${bp}.as must be a column name of 1 to 64 characters.`)
        const groupBy = b.groupBy ?? []
        if (!Array.isArray(groupBy) || groupBy.length > 4 || !groupBy.every(g => typeof g === 'string')) return err(`${bp}.groupBy`, 'bad_type', `${bp}.groupBy must be an array of at most 4 column names.`)
        for (const [gi, g] of (groupBy as string[]).entries()) {
          if (!columns.has(g)) {
            const near = closest(g, [...columns])
            return err(`${bp}.groupBy[${gi}]`, 'no_such_column', `Column "${g}" does not exist at this step.`, `${near ? `Did you mean "${near}"? ` : ''}Columns here: ${[...columns].slice(0, 20).join(', ')}.`)
          }
        }
        const sortBy = column('sortBy', false)
        if (sortBy === null) return null
        if (b.order !== undefined && b.order !== 'asc' && b.order !== 'desc') return err(`${bp}.order`, 'bad_enum', `${bp}.order must be "asc" or "desc".`)
        if (b.frame !== undefined) {
          if (typeof b.frame !== 'number' || !Number.isInteger(b.frame) || b.frame < 1 || b.frame > 1000) return err(`${bp}.frame`, 'bad_value', `${bp}.frame must be an integer from 1 to 1000 (rows in the moving window), got ${fmt(b.frame)}.`)
          if (op !== 'movingMean') issues.push({ severity: 'warning', code: 'frame_ignored', path: `${bp}.frame`, message: `${bp}.frame only applies to movingMean; it is ignored for ${op}.` })
        }
        if (b.order !== undefined && sortBy === undefined && op !== 'rank') issues.push({ severity: 'warning', code: 'order_ignored', path: `${bp}.order`, message: `${bp}.order needs sortBy; without it the rows keep their order.` })
        cur = windowRows(cur, { op, field, as: b.as as string, groupBy: groupBy as string[], sortBy: sortBy ?? (op === 'rank' ? field : undefined), desc: b.order === 'desc', frame: (b.frame as number | undefined) ?? 3 })
        columns = new Set([...columns, b.as as string])
        break
      }
      case 'fold': {
        const fields = b.fields
        if (fields === undefined) return err(`${bp}.fields`, 'missing_required', `${bp} needs "fields" (the columns to fold into rows).`)
        if (!Array.isArray(fields) || !fields.length || fields.length > FOLD_LIMIT || !fields.every(f => typeof f === 'string')) return err(`${bp}.fields`, 'bad_type', `${bp}.fields must be an array of 1 to ${FOLD_LIMIT} column names.`)
        for (const [fi, f] of (fields as string[]).entries()) {
          if (!columns.has(f)) {
            const near = closest(f, [...columns])
            return err(`${bp}.fields[${fi}]`, 'no_such_column', `Column "${f}" does not exist at this step.`, `${near ? `Did you mean "${near}"? ` : ''}Columns here: ${[...columns].slice(0, 20).join(', ')}.`)
          }
          if ((fields as string[]).indexOf(f) !== fi) return err(`${bp}.fields[${fi}]`, 'duplicate', `Column "${f}" is listed twice.`)
        }
        const as = b.as === undefined ? ['key', 'value'] : b.as
        if (!Array.isArray(as) || as.length !== 2 || !as.every(isName) || as[0] === as[1]) return err(`${bp}.as`, 'bad_type', `${bp}.as must be two different column names of 1 to 64 characters: [key, value].`, 'E.g. ["quarter", "revenue"].')
        if (cur.length * fields.length > LIMITS.maxRows) return err(bp, 'too_many_rows', `Folding ${fields.length} columns of ${cur.length} rows makes ${cur.length * fields.length} rows; the limit is ${LIMITS.maxRows}.`, 'Filter or aggregate first, or fold fewer columns.')
        const [k, v] = as as [string, string]
        const drop = new Set(fields as string[])
        const out: Row[] = []
        for (const r of cur) {
          const rest: Row = {}
          for (const key of Object.keys(r)) if (!drop.has(key)) rest[key] = r[key]
          for (const f of fields as string[]) out.push({ ...rest, [k]: f, [v]: r[f] === undefined ? null : r[f] })
        }
        cur = out
        columns = new Set([...[...columns].filter(c => !drop.has(c)), k, v])
        break
      }
    }
  }
  return cur
}

export function columnsOf(rows: Row[]): Set<string> {
  const out = new Set<string>()
  for (const r of rows.slice(0, 200)) if (r && typeof r === 'object') for (const k of Object.keys(r)) out.add(k)
  return out
}

/** The predicate for one filter step (every test given must hold). */
export function filterRow(f: FilterStep): (r: Row) => boolean {
  const lo = f.range?.[0] != null ? ordinal(f.range[0]) : null
  const hi = f.range?.[1] != null ? ordinal(f.range[1]) : null
  const bound = (v: unknown): number | null => (v === undefined ? null : ordinal(v))
  const gt = bound(f.gt), gte = bound(f.gte), lt = bound(f.lt), lte = bound(f.lte)
  const one = f.oneOf ? new Set(f.oneOf.map(v => String(v))) : null
  const numeric = f.range !== undefined || gt !== null || gte !== null || lt !== null || lte !== null
  return r => {
    const v = r[f.field]
    const missing = v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))
    if (f.valid !== undefined && f.valid === missing) return false
    if (f.equal !== undefined && String(v) !== String(f.equal)) return false
    if (one && !one.has(String(v))) return false
    if (numeric) {
      const n = ordinal(v)
      if (n === null) return false
      if (lo !== null && n < lo) return false
      if (hi !== null && n >= hi) return false
      if (gt !== null && !(n > gt)) return false
      if (gte !== null && !(n >= gte)) return false
      if (lt !== null && !(n < lt)) return false
      if (lte !== null && !(n <= lte)) return false
    }
    return true
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
/** `timeUnit` buckets times from 0001-01-01 to the end of 9999, so every bucket is a four-digit ISO date `toTime` reads back. */
export const MIN_TIME = -62135596800000
export const MAX_TIME = 253402300799999

/** The start of the bucket holding `t` (UTC, between MIN_TIME and MAX_TIME), as an ISO date (hours: date and time). Weeks start on Monday. */
export function bucket(t: number, unit: (typeof TIME_UNITS)[number]): string {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = (yy: number, mm: number, dd: number): string => {
    // setUTCFullYear, not Date.UTC: Date.UTC reads years 0 to 99 as 1900 to 1999.
    const x = new Date(0)
    x.setUTCFullYear(yy, mm, dd)
    return `${pad(x.getUTCFullYear(), 4)}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`
  }
  switch (unit) {
    case 'year': return `${pad(y, 4)}-01-01`
    case 'quarter': return day(y, m - (m % 3), 1)
    case 'month': return day(y, m, 1)
    case 'week': return day(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    case 'day': return day(y, m, d.getUTCDate())
    case 'hour': return `${day(y, m, d.getUTCDate())}T${pad(d.getUTCHours())}:00:00Z`
  }
}

function aggregate(rows: Row[], groupBy: string[], fields: Record<string, (typeof AGGREGATE_OPS)[number]>, count?: string): Row[] {
  const groups = new Map<string, { first: Row; rows: Row[] }>()
  for (const r of rows) {
    const key = JSON.stringify(groupBy.map(g => (r[g] === undefined ? null : r[g])))
    const g = groups.get(key)
    if (g) g.rows.push(r)
    else groups.set(key, { first: r, rows: [r] })
  }
  const out: Row[] = []
  for (const g of groups.values()) {
    const row: Row = {}
    for (const k of groupBy) row[k] = g.first[k] ?? null
    for (const [col, op] of Object.entries(fields)) row[col] = reduce(g.rows, col, op)
    if (count) row[count] = g.rows.length
    out.push(row)
  }
  return out
}

function reduce(rows: Row[], col: string, op: (typeof AGGREGATE_OPS)[number]): number | null {
  if (op === 'count') return rows.filter(r => r[col] !== null && r[col] !== undefined && r[col] !== '').length
  if (op === 'distinct') return new Set(rows.filter(r => r[col] !== null && r[col] !== undefined && r[col] !== '').map(r => String(r[col]))).size
  const nums: number[] = []
  for (const r of rows) {
    const n = toNumber(r[col])
    if (n !== null) nums.push(n)
  }
  if (!nums.length) return null
  switch (op) {
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'mean': return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
    case 'median': {
      const s = [...nums].sort((a, b) => a - b)
      const mid = s.length >> 1
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
    }
  }
}

/** Stable sort: numbers and dates by value, everything else as text; missing values last. */
function sortRows(rows: Row[], field: string, desc: boolean): Row[] {
  return sortOrder(rows.map(r => r[field]), desc).map(i => rows[i])
}

/** The order (indices) that sorts `values` by the sort step's rule. */
function sortOrder(values: unknown[], desc: boolean): number[] {
  const keyed = values.map((v, i) => ({ i, n: ordinal(v), s: v === null || v === undefined ? null : String(v) }))
  keyed.sort((a, b) => {
    if (a.s === null || b.s === null) return a.s === b.s ? a.i - b.i : a.s === null ? 1 : -1
    let c: number
    if (a.n !== null && b.n !== null) c = a.n - b.n
    else if (a.n !== null) c = -1
    else if (b.n !== null) c = 1
    else c = a.s < b.s ? -1 : a.s > b.s ? 1 : 0
    if (desc) c = -c
    return c || a.i - b.i
  })
  return keyed.map(k => k.i)
}

interface WindowSpec { op: (typeof WINDOW_OPS)[number]; field: string; as: string; groupBy: string[]; sortBy?: string; desc: boolean; frame: number }

/**
 * One window step. Rows are grouped by `groupBy` (groups keep their type, as in aggregate), each group is put in
 * `sortBy` order (the sort step's rule: numbers and dates by value, then text, missing last, ties in data order;
 * no `sortBy` keeps the data order), and the op walks the group in that order:
 *   sum, mean, count   running total, running mean and running count of the values so far (non-numbers are
 *                      skipped; count counts non-missing cells); mean is null until a number is seen
 *   rank               standard competition rank (1, 2, 2, 4) of the sort key, so equal keys share a rank; a row
 *                      with a missing key gets null. Without sortBy the rows are ranked by `field`
 *   pctChange          (v - previous) / |previous| against the previous row; null at the first row, when either
 *                      is not a number, or when the previous value is 0
 *   lag, lead          the field of the previous / next row (null at the ends)
 *   movingMean         mean of the numbers among this row and the `frame - 1` rows before it
 * The rows come out in their input order, with the new column added.
 */
function windowRows(rows: Row[], w: WindowSpec): Row[] {
  const groups = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const key = JSON.stringify(w.groupBy.map(g => (r[g] === undefined ? null : r[g])))
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  })
  const result: unknown[] = new Array(rows.length).fill(null)
  for (const idx of groups.values()) {
    const order = w.sortBy === undefined ? idx : sortOrder(idx.map(i => rows[i][w.sortBy!]), w.desc).map(k => idx[k])
    const nums = order.map(i => toNumber(rows[i][w.field]))
    let total = 0
    let seen = 0
    let present = 0
    order.forEach((ri, k) => {
      const n = nums[k]
      switch (w.op) {
        case 'sum':
          if (n !== null) total += n
          result[ri] = total
          break
        case 'mean':
          if (n !== null) { total += n; seen++ }
          result[ri] = seen ? total / seen : null
          break
        case 'count':
          if (!isMissing(rows[ri][w.field])) present++
          result[ri] = present
          break
        case 'rank': {
          const key = (i: number): unknown => rows[i][w.sortBy!]
          if (key(ri) === null || key(ri) === undefined) { result[ri] = null; break }
          result[ri] = k > 0 && sameKey(key(order[k - 1]), key(ri)) ? result[order[k - 1]] : k + 1
          break
        }
        case 'pctChange': {
          const prev = k > 0 ? nums[k - 1] : null
          result[ri] = n === null || prev === null || prev === 0 ? null : (n - prev) / Math.abs(prev)
          break
        }
        case 'lag':
          result[ri] = k > 0 ? rows[order[k - 1]][w.field] ?? null : null
          break
        case 'lead':
          result[ri] = k < order.length - 1 ? rows[order[k + 1]][w.field] ?? null : null
          break
        case 'movingMean': {
          let s = 0
          let c = 0
          for (let j = Math.max(0, k - w.frame + 1); j <= k; j++) if (nums[j] !== null) { s += nums[j]!; c++ }
          result[ri] = c ? s / c : null
          break
        }
      }
    })
  }
  return rows.map((r, i) => ({ ...r, [w.as]: result[i] }))
}

/** Equal sort keys for rank: the same number or date, or the same text. */
function sameKey(a: unknown, b: unknown): boolean {
  const na = ordinal(a)
  const nb = ordinal(b)
  if (na !== null || nb !== null) return na === nb
  return String(a) === String(b)
}
