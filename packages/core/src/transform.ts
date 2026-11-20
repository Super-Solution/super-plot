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
 *   { "index":     { "field": "revenue", "groupBy": ["region"], "sortBy": "date" } }   first value of each group = 100
 *
 * There is deliberately no expression step (`calculate`): evaluating text from a spec is an injection risk, and
 * a second language to port to Go and Python bit for bit.
 * A brush selection in the web binding (`onBrush`) has the same shape as a filter, so it can be pasted in.
 *
 * This file is the part every bundle carries: the step names and keys (the JSON Schema lists every step), the
 * registry and the loop that checks the generic shape of each step. What each step does is in `transforms.ts`
 * (`@supersolutions/super-plot-core/transforms`), registered like chart types; the package root registers them all.
 */
import type { Issue, Row } from './schema.js'
import { closest } from './util/num.js'

/** At most this many steps. Ten covers every realistic pipeline (filter, fold, bin, aggregate, window, sort, top). */
export const TRANSFORM_LIMIT = 10
export const TRANSFORM_OPS = ['filter', 'timeUnit', 'aggregate', 'sort', 'top', 'bin', 'window', 'fold', 'index'] as const
export type TransformOp = (typeof TRANSFORM_OPS)[number]
export const WINDOW_OPS = ['sum', 'mean', 'count', 'rank', 'pctChange', 'lag', 'lead', 'movingMean'] as const
/** `bin` makes at most this many bins; `fold` folds at most this many columns. */
export const BIN_LIMIT = 200
export const FOLD_LIMIT = 50
export const TIME_UNITS = ['year', 'quarter', 'month', 'week', 'day', 'hour'] as const
export const AGGREGATE_OPS = ['sum', 'mean', 'median', 'min', 'max', 'count', 'distinct'] as const
/** `timeUnit` buckets times from 0001-01-01 to the end of 9999, so every bucket is a four-digit ISO date `toTime` reads back. */
export const MIN_TIME = -62135596800000
export const MAX_TIME = 253402300799999

export const TRANSFORM_KEYS: Record<TransformOp, readonly string[]> = {
  filter: ['field', 'equal', 'oneOf', 'range', 'gt', 'gte', 'lt', 'lte', 'valid'],
  timeUnit: ['field', 'unit', 'as'],
  aggregate: ['groupBy', 'fields', 'count'],
  sort: ['field', 'order'],
  top: ['n', 'by'],
  bin: ['field', 'as', 'step', 'maxbins'],
  window: ['op', 'field', 'as', 'groupBy', 'sortBy', 'order', 'frame'],
  fold: ['fields', 'as'],
  index: ['field', 'as', 'groupBy', 'sortBy', 'base', 'at']
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
  | { index: { field: string; as?: string; groupBy?: string[]; sortBy?: string; base?: number; at?: 'first' | string | number } }

/** What a step's `run` gets: the rows and columns so far (it replaces them with its output) and issue helpers. */
export interface TransformCtx {
  rows: Row[]
  /** The columns the next step sees. */
  columns: Set<string>
  readonly issues: Issue[]
  /** The step body's path, e.g. `transform[2].bin`. */
  readonly path: string
  /** Report an error (the transform stops after this step) and return null. */
  err(path: string, code: string, message: string, hint?: string): null
  /** The body's key `k` as a column that exists at this step; null after reporting an error, undefined when absent and optional. */
  column(k: string, required?: boolean): string | null | undefined
}

/**
 * One transform step, registered with `registerTransforms`. Its keys were already checked against
 * `TRANSFORM_KEYS[op]`; `run` checks the values, reports problems through `ctx` and sets `ctx.rows` and
 * `ctx.columns`. A step that reported an error stops the transform.
 */
export interface TransformDef {
  op: TransformOp
  run(body: Record<string, unknown>, ctx: TransformCtx): void
}

const steps = new Map<string, TransformDef>()

/** Make transform steps available to every spec (`allTransforms` from `/transforms`, or only the ones you use). */
export function registerTransforms(defs: readonly TransformDef[]): void {
  for (const d of defs) registerTransform(d)
}
export function registerTransform(def: TransformDef): void {
  if (!(TRANSFORM_OPS as readonly string[]).includes(def.op)) throw new Error(`Unknown transform step "${def.op}": the steps are ${TRANSFORM_OPS.join(', ')}.`)
  steps.set(def.op, def)
}
/** The registered steps, in `TRANSFORM_OPS` order. */
export const transformTypes = (): TransformOp[] => TRANSFORM_OPS.filter(op => steps.has(op))

const fmt = (v: unknown): string => {
  const s = JSON.stringify(v) ?? String(v)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

/**
 * Check the steps against the columns they will see (each step's output feeds the next) and run them.
 * Returns the transformed rows, or null when a step is invalid (the issues say why). A step whose code is not
 * registered in this bundle is an error (`transform_not_registered`), never skipped.
 */
export function applyTransform(value: unknown, rows: Row[], issues: Issue[], path = 'transform'): Row[] | null {
  const err = (p: string, code: string, message: string, hint?: string): null => {
    issues.push({ severity: 'error', code, path: p, message, ...(hint ? { hint } : {}) })
    return null
  }
  if (!Array.isArray(value)) return err(path, 'bad_type', 'transform must be an array of steps.', 'Example: [{"filter":{"field":"region","oneOf":["APAC"]}}]')
  if (value.length > TRANSFORM_LIMIT) return err(path, 'too_many', `At most ${TRANSFORM_LIMIT} transform steps; got ${value.length}.`)
  const ctx = { rows, columns: columnsOf(rows), issues, path, err } as { -readonly [K in keyof TransformCtx]: TransformCtx[K] }
  for (let i = 0; i < value.length; i++) {
    const p = `${path}[${i}]`
    const step = value[i]
    if (!step || typeof step !== 'object' || Array.isArray(step)) return err(p, 'bad_type', `${p} must be an object with one key: ${TRANSFORM_OPS.join(', ')}.`)
    const keys = Object.keys(step)
    if (keys.length !== 1 || !(TRANSFORM_OPS as readonly string[]).includes(keys[0])) {
      const near = keys.length === 1 ? closest(keys[0], TRANSFORM_OPS) : undefined
      return err(p, 'bad_transform', `${p} must have exactly one of ${TRANSFORM_OPS.join(', ')}; got ${keys.length ? keys.join(', ') : 'nothing'}.`, near ? `Did you mean "${near}"?` : undefined)
    }
    const op = keys[0] as TransformOp
    const bp = `${p}.${op}`
    const def = steps.get(op)
    if (!def) {
      return err(bp, 'transform_not_registered', `The "${op}" transform step is not registered in this bundle (core was imported from \`/base\` without it).`,
        `Call registerTransforms([${op}Step]) once, with registerTransforms from @supersolutions/super-plot-core/base and ${op}Step (or allTransforms, every step) from @supersolutions/super-plot-core/transforms. The package root registers them all.`)
    }
    const body = (step as Record<string, unknown>)[op]
    if (!body || typeof body !== 'object' || Array.isArray(body)) return err(bp, 'bad_type', `${bp} must be an object.`)
    const b = body as Record<string, unknown>
    for (const k of Object.keys(b)) {
      if (!TRANSFORM_KEYS[op].includes(k)) {
        const near = closest(k, TRANSFORM_KEYS[op])
        return err(`${bp}.${k}`, 'unknown_field', `Unknown ${op} field "${k}".`, near ? `Did you mean "${near}"?` : `Allowed: ${TRANSFORM_KEYS[op].join(', ')}.`)
      }
    }
    ctx.path = bp
    ctx.column = (k: string, required = true): string | null | undefined => {
      const v = b[k]
      if (v === undefined) return required ? err(`${bp}.${k}`, 'missing_required', `${bp} needs "${k}" (a column name).`) : undefined
      if (typeof v !== 'string') return err(`${bp}.${k}`, 'bad_type', `${bp}.${k} must be a column name, got ${fmt(v)}.`)
      if (!ctx.columns.has(v)) {
        const near = closest(v, [...ctx.columns])
        return err(`${bp}.${k}`, 'no_such_column', `Column "${v}" does not exist at this step.`, `${near ? `Did you mean "${near}"? ` : ''}Columns here: ${[...ctx.columns].slice(0, 20).join(', ')}.`)
      }
      return v
    }
    const before = issues.length
    def.run(b, ctx)
    for (let k = before; k < issues.length; k++) if (issues[k].severity === 'error') return null
  }
  return ctx.rows
}

export function columnsOf(rows: Row[]): Set<string> {
  const out = new Set<string>()
  for (const r of rows.slice(0, 200)) if (r && typeof r === 'object') for (const k of Object.keys(r)) out.add(k)
  return out
}
