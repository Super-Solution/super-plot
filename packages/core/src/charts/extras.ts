import type { ValidateCtx } from '../schema.js'
import type { FieldDef } from '../schema.js'
import { toNumber } from '../util/num.js'

/**
 * Checks shared by the charts that take log scales and intervals (`yScale`, `xScale`, `yLower`/`yUpper`,
 * `xLower`/`xUpper`). Each pushes issues with a stable code and path; none changes the spec.
 */

export const scaleField = (axis: 'x' | 'y', what: string): FieldDef => ({
  kind: 'enum', values: ['linear', 'log'],
  desc: `Default linear. \`log\` draws the ${axis === 'y' ? 'vertical' : 'horizontal'} axis in powers of ten (${what}); values at or below zero cannot be placed and are left out with a \`log_nonpositive\` warning.`
})

/** `yScale` on a chart whose marks start at zero: the field exists so the refusal can say why. */
export const zeroBaselineScale = (what: string): FieldDef => ({
  kind: 'enum', values: ['linear', 'log'],
  desc: `Only \`linear\`. ${what} starts at zero, which a log axis cannot show, so \`log\` is refused (\`log_scale_refused\`). Use a line or a scatter for values spanning several orders of magnitude.`
})

export const intervalFields = (axis: 'x' | 'y', where: string): Record<string, FieldDef> => ({
  [`${axis}Lower`]: { kind: 'column', role: 'number', desc: `Numeric column with the lower end of an interval on ${axis} (a confidence or min-max range), drawn as ${where}. Needs \`${axis}Upper\` too; the tooltip shows the interval and the axis includes it.` },
  [`${axis}Upper`]: { kind: 'column', role: 'number', desc: `Numeric column with the upper end of the interval on ${axis}; see \`${axis}Lower\`.` }
})

export function refuseLog(spec: Record<string, unknown>, ctx: ValidateCtx, field: 'xScale' | 'yScale', why: string, hint: string): void {
  if (spec[field] === 'log') ctx.issues.push({ severity: 'error', code: 'log_scale_refused', path: field, message: `${field} "log" is refused: ${why}`, hint })
}

/** Values at or below zero in the columns behind a log axis: one warning with the count. */
export function logNonPositive(rows: Record<string, unknown>[], cols: string[], path: string, ctx: ValidateCtx): void {
  let bad = 0
  let seen = 0
  for (const r of rows) for (const c of cols) {
    const n = toNumber(r[c])
    if (n === null) continue
    seen++
    if (n <= 0) bad++
  }
  if (!bad) return
  if (bad === seen) ctx.issues.push({ severity: 'error', code: 'log_nonpositive', path, message: `Every value in ${cols.map(c => `"${c}"`).join(', ')} is zero or negative; a log axis cannot show any of them.`, hint: 'Use the linear scale, or plot a positive quantity.' })
  else ctx.issues.push({ severity: 'warning', code: 'log_nonpositive', path, message: `${bad} of ${seen} values in ${cols.map(c => `"${c}"`).join(', ')} are zero or negative; a log axis cannot place them, so they are left out.`, hint: 'Filter them with `transform` to say so in the spec, or use the linear scale.' })
}

/** A domain on a log axis must be positive. */
export function logDomain(spec: Record<string, unknown>, ctx: ValidateCtx, scaleField: 'xScale' | 'yScale', domainField: 'xDomain' | 'yDomain'): void {
  const d = spec[domainField] as [number | null, number | null] | undefined
  if (spec[scaleField] !== 'log' || !d) return
  if ((d[0] !== null && d[0] <= 0) || (d[1] !== null && d[1] <= 0)) ctx.issues.push({ severity: 'error', code: 'log_bad_domain', path: domainField, message: `${domainField} must be above zero on a log axis, got [${d[0]}, ${d[1]}].`, hint: 'Use a positive lower bound such as 1 or 0.1, or null for automatic.' })
}

/** `xLower` without `xUpper` (or the other way round), and intervals whose ends are swapped. */
export function intervalCheck(spec: Record<string, unknown>, ctx: ValidateCtx, axis: 'x' | 'y'): boolean {
  const lo = spec[`${axis}Lower`] as string | undefined
  const hi = spec[`${axis}Upper`] as string | undefined
  if (lo === undefined && hi === undefined) return false
  if (lo === undefined || hi === undefined) {
    const missing = lo === undefined ? `${axis}Lower` : `${axis}Upper`
    ctx.issues.push({ severity: 'error', code: 'interval_incomplete', path: missing, message: `An interval needs both ${axis}Lower and ${axis}Upper; ${missing} is missing.`, hint: `Give ${missing} too (for a symmetric error, two columns value - e and value + e).` })
    return false
  }
  let swapped = 0
  for (const r of ctx.rows) {
    const a = toNumber(r[lo])
    const b = toNumber(r[hi])
    if (a !== null && b !== null && a > b) swapped++
  }
  if (swapped) ctx.issues.push({ severity: 'warning', code: 'interval_reversed', path: `${axis}Lower`, message: `In ${swapped} ${swapped === 1 ? 'row' : 'rows'} ${axis}Lower is above ${axis}Upper; the interval is drawn between the two anyway.` })
  return true
}

/** Format an interval for a tooltip or a spoken label. */
export const intervalText = (fmt: (v: number) => string, lo: number, hi: number): string => `${fmt(Math.min(lo, hi))} – ${fmt(Math.max(lo, hi))}`
