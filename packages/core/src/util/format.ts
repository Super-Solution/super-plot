// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { currencyDigits } from './currency.js'
import { tickStep } from './num.js'

/**
 * Value format grammar (one string, easy for an agent to write):
 *   [prefix^] auto | compact | integer | percent | percent:N | fixed:N | currency:CODE[:compact][:narrow]  [~suffix]
 * `percent` expects ratios (0.25 shows as 25%); `percent:N` shows exactly N decimals. `currency:CODE:compact` abbreviates
 * large amounts ($1.2B) and `:narrow` uses the narrow symbol ("$", not "US$"). A `~suffix` (1 to 16 characters, no
 * control characters) is printed after every value and tick: `integer~ days` shows 92 days. A `prefix^` (1 to 8
 * characters, no `^` or `~`) is printed before it, after the minus sign: `NT$^integer` shows NT$1,234 and -NT$1,234.
 */
export type ValueFormat = string

export const FORMAT_PATTERN = '^([^~^\\u0000-\\u001f]{1,8}\\^)?(auto|compact|integer|percent(:\\d)?|fixed:\\d{1,2}|currency:[A-Za-z]{3}(:compact)?(:narrow)?)(~[^~\\u0000-\\u001f]{1,16})?$'
const FORMAT_RE = new RegExp(FORMAT_PATTERN)
/** A format split into the text printed before a value, the part that formats the number, and the suffix after it. */
function splitFormat(f: string): [string, string, string] {
  const i = f.indexOf('~')
  const left = i < 0 ? f : f.slice(0, i)
  const j = left.indexOf('^')
  return [j < 0 ? '' : left.slice(0, j), j < 0 ? left : left.slice(j + 1), i < 0 ? '' : f.slice(i + 1)]
}
/** Puts `prefix` before the digits: after a minus sign, so a negative reads -NT$5, not NT$-5. */
function decorate(one: (v: number) => string, prefix: string, suffix: string): (v: number) => string {
  if (!prefix && !suffix) return one
  return v => {
    const s = one(v)
    const neg = s.startsWith('-') || s.startsWith('\u2212')
    return (neg ? s[0] : '') + prefix + (neg ? s.slice(1) : s) + suffix
  }
}
/** `currency:USD:compact:narrow` -> its code and flags. */
function currencyOf(f: string): { code: string; compact: boolean; narrow: boolean } {
  const [code, ...flags] = f.slice(9).split(':')
  return { code: code.toUpperCase(), compact: flags.includes('compact'), narrow: flags.includes('narrow') }
}

export const isValueFormat = (v: unknown): v is ValueFormat => typeof v === 'string' && FORMAT_RE.test(v)

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(opts)
  let f = nfCache.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, opts)
    } catch {
      f = new Intl.NumberFormat('en', opts)
    }
    nfCache.set(key, f)
  }
  return f
}

/** Formatter for a single value (tooltips, labels). Number formats are built once per formatter, not per value. */
export function valueFormatter(format: ValueFormat | undefined, locale: string): (v: number) => string {
  const [prefix, base, suffix] = splitFormat(format ?? 'auto')
  return decorate(baseFormatter(base, locale), prefix, suffix)
}

function baseFormatter(f: string, locale: string): (v: number) => string {
  if (f === 'compact') { const n = nf(locale, { notation: 'compact', maximumFractionDigits: 1 }); return v => n.format(v) }
  if (f === 'integer') { const n = nf(locale, { maximumFractionDigits: 0 }); return v => n.format(v) }
  if (f.startsWith('percent:')) { const d = Number(f.slice(8)); const n = nf(locale, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }); return v => n.format(v) }
  if (f === 'percent') {
    const small = nf(locale, { style: 'percent', maximumFractionDigits: 2 })
    const big = nf(locale, { style: 'percent', maximumFractionDigits: 1 })
    return v => (Math.abs(v) < 0.1 ? small : big).format(v)
  }
  if (f.startsWith('fixed:')) {
    const d = Number(f.slice(6))
    const n = nf(locale, { minimumFractionDigits: d, maximumFractionDigits: d })
    return v => n.format(v)
  }
  if (f.startsWith('currency:')) {
    const { code, compact, narrow } = currencyOf(f)
    const display = narrow ? { currencyDisplay: 'narrowSymbol' as const } : {}
    if (compact) { const n = nf(locale, { style: 'currency', currency: code, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1, ...display }); return v => n.format(v) }
    // The minor units come from our own table, not the runtime's ICU data, so every runtime shows the same digits.
    const big = nf(locale, { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0, ...display })
    const small = nf(locale, { style: 'currency', currency: code, minimumFractionDigits: Math.min(currencyDigits(code), 2), maximumFractionDigits: 2, ...display })
    return v => (Math.abs(v) >= 1000 ? big : small).format(v)
  }
  const whole = nf(locale, { maximumFractionDigits: 0 })
  const tiny = nf(locale, { maximumFractionDigits: 4 })
  const two = nf(locale, { maximumFractionDigits: 2 })
  const one = nf(locale, { maximumFractionDigits: 1 })
  return v => {
    const a = Math.abs(v)
    return (Number.isInteger(v) ? whole : a < 1 ? tiny : a < 100 ? two : one).format(v)
  }
}

/** Formatter for axis ticks: shares one precision across all ticks and goes compact when large. */
export function tickFormatter(format: ValueFormat | undefined, locale: string, domain: [number, number], count: number): (v: number) => string {
  const [prefix, base, suffix] = splitFormat(format ?? 'auto')
  return decorate(baseTickFormatter(base, locale, domain, count), prefix, suffix)
}

function baseTickFormatter(f: string, locale: string, domain: [number, number], count: number): (v: number) => string {
  const step = tickStep(domain[0], domain[1], count)
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const big = Math.max(Math.abs(domain[0]), Math.abs(domain[1]))
  if (f.startsWith('percent:')) { const d = Number(f.slice(8)); return v => nf(locale, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }).format(v) }
  if (f === 'percent') {
    const pd = Math.max(0, dec - 2)
    return v => nf(locale, { style: 'percent', minimumFractionDigits: pd, maximumFractionDigits: pd }).format(v)
  }
  if (f.startsWith('currency:')) {
    const { code, compact: always, narrow } = currencyOf(f)
    const compact = always || big >= 10000
    const display = narrow ? { currencyDisplay: 'narrowSymbol' as const } : {}
    return v => nf(locale, { style: 'currency', currency: code, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : Math.min(dec, 2), minimumFractionDigits: compact ? 0 : Math.min(dec, 2), ...display }).format(v)
  }
  if (f === 'compact' || (f === 'auto' && big >= 10000)) {
    return v => nf(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  }
  if (f === 'integer') return v => nf(locale, { maximumFractionDigits: 0 }).format(v)
  const d = f.startsWith('fixed:') ? Number(f.slice(6)) : dec
  // Year-like integers (2024) read wrong with a thousands separator.
  const yearLike = f === 'auto' && dec === 0 && domain[0] >= 1000 && domain[1] <= 3000
  return v => nf(locale, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: !yearLike }).format(v)
}

export const formatPercent = (ratio: number, locale: string, digits = 1): string =>
  nf(locale, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: digits }).format(ratio)
