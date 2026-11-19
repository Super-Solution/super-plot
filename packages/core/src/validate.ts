import type { Issue, Row, ValidateCtx } from './schema.js'
import { LIMITS, fieldDefault, validateField } from './schema.js'
import { chartTypes, fieldsOf, getChart } from './registry.js'
import { closest } from './util/num.js'
import { applyTransform, columnsOf } from './transform.js'

export interface ValidationResult {
  /** No errors (warnings are allowed). */
  ok: boolean
  issues: Issue[]
  /** The spec with defaults filled in and values normalised; present only when `ok`. */
  spec?: Record<string, any>
}

export class PlotSpecError extends Error {
  readonly issues: Issue[]
  constructor(issues: Issue[]) {
    const errors = issues.filter(i => i.severity === 'error')
    super(errors.map(i => `${i.path || 'spec'}: ${i.message}${i.hint ? ` ${i.hint}` : ''}`).join('\n') || 'Invalid plot spec')
    this.name = 'PlotSpecError'
    this.issues = issues
  }
}

/**
 * Check a spec (an object, or a JSON string) without drawing it. Every problem comes back at once,
 * each with a stable `code`, a `path`, and a `hint` that says how to fix it, so an agent can repair
 * the spec in one round trip.
 */
export function validatePlot(input: unknown): ValidationResult {
  const issues: Issue[] = []
  const fail = (code: string, path: string, message: string, hint?: string): ValidationResult => {
    issues.push({ severity: 'error', code, path, message, ...(hint ? { hint } : {}) })
    return { ok: false, issues }
  }
  let raw = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch (e) {
      return fail('invalid_json', '', `Spec is not valid JSON: ${(e as Error).message}.`)
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('bad_type', '', 'Spec must be an object.')
  const obj = raw as Record<string, unknown>

  const types = chartTypes()
  if (typeof obj.type !== 'string') return fail('missing_required', 'type', 'Missing "type".', `Choose one of: ${types.join(', ')}.`)
  const def = getChart(obj.type)
  if (!def) {
    const near = closest(obj.type, types)
    return fail('unknown_type', 'type', `Unknown chart type "${obj.type}".`, `${near ? `Did you mean "${near}"? ` : ''}Available: ${types.join(', ')}.`)
  }

  const fields = fieldsOf(def)
  const rows = obj.data
  if (!Array.isArray(rows) || rows.length === 0) {
    issues.push({ severity: 'error', code: rows === undefined ? 'missing_required' : 'empty_data', path: 'data', message: rows === undefined ? 'Missing "data".' : 'data must be a non-empty array of row objects.', hint: 'Example: [{"region":"APAC","revenue":120}, ...]' })
  } else if (rows.length > LIMITS.maxRows) {
    issues.push({ severity: 'error', code: 'too_many_rows', path: 'data', message: `data has ${rows.length} rows; the limit is ${LIMITS.maxRows}.`, hint: 'Aggregate or sample before plotting; a chart cannot show that many marks.' })
  } else if (!rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
    issues.push({ severity: 'error', code: 'bad_type', path: 'data', message: 'Every row of data must be an object.' })
  }
  let dataOk = !issues.some(i => i.path === 'data' && i.severity === 'error')
  let data = dataOk ? (rows as Row[]) : []
  // `transform` runs first: column fields refer to its output.
  if (dataOk && obj.transform !== undefined && 'transform' in fields) {
    const out = applyTransform(obj.transform, data, issues)
    if (!out) dataOk = false
    else if (!out.length) {
      issues.push({ severity: 'error', code: 'empty_after_transform', path: 'transform', message: 'The transform left no rows to plot.', hint: 'Loosen the filter, or check its field and values.' })
      dataOk = false
    } else data = out
  }
  const columns = dataOk ? columnsOf(data) : new Set<string>()
  const ctx: ValidateCtx = { issues, columns, rows: dataOk ? data : [] }

  const out: Record<string, unknown> = { type: def.type }
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'type' || key === 'data') continue
    const f = fields[key]
    if (!f) {
      const near = closest(key, Object.keys(fields))
      issues.push({ severity: 'error', code: 'unknown_field', path: key, message: `Unknown field "${key}" for a ${def.type} chart.`, hint: near ? `Did you mean "${near}"?` : `Allowed: ${Object.keys(fields).join(', ')}.` })
      continue
    }
    if ((f.kind === 'column' || f.kind === 'columns' || (f.kind === 'flag' && typeof value === 'string')) && !dataOk) continue
    const v = validateField(key, f, value, ctx)
    if (v !== undefined) out[key] = v
  }
  for (const [key, f] of Object.entries(fields)) {
    if (key in out || key === 'type' || key === 'data') continue
    if (f.required && !(key in obj)) {
      issues.push({ severity: 'error', code: 'missing_required', path: key, message: `Missing required field "${key}": ${f.desc}`, hint: `See the "${def.type}" example: ${JSON.stringify(def.example).slice(0, 220)}…` })
    } else {
      const d = fieldDefault(f)
      if (d !== undefined) out[key] = d
    }
  }
  if (dataOk) out.data = data
  if (!issues.some(i => i.severity === 'error')) def.check?.(out, ctx)

  const ok = !issues.some(i => i.severity === 'error')
  return ok ? { ok, issues, spec: out } : { ok, issues }
}
