// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { currencyDigits } from './currency.js'
import { tickStep } from './num.js'

/**
 * Value format grammar (one string, easy for an agent to write):
 *   auto | compact | integer | percent | fixed:N | currency:CODE
 * `percent` expects ratios (0.25 shows as 25%).
 */
export type ValueFormat = string

const FORMAT_RE = /^(auto|compact|integer|percent|fixed:\d{1,2}|currency:[A-Za-z]{3})$/

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
  const f = format ?? 'auto'
  if (f === 'compact') { const n = nf(locale, { notation: 'compact', maximumFractionDigits: 1 }); return v => n.format(v) }
  if (f === 'integer') { const n = nf(locale, { maximumFractionDigits: 0 }); return v => n.format(v) }
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
    const code = f.slice(9).toUpperCase()
    // The minor units come from our own table, not the runtime's ICU data, so every runtime shows the same digits.
    const big = nf(locale, { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0 })
    const small = nf(locale, { style: 'currency', currency: code, minimumFractionDigits: Math.min(currencyDigits(code), 2), maximumFractionDigits: 2 })
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
  const f = format ?? 'auto'
  const step = tickStep(domain[0], domain[1], count)
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const big = Math.max(Math.abs(domain[0]), Math.abs(domain[1]))
  if (f === 'percent') {
    const pd = Math.max(0, dec - 2)
    return v => nf(locale, { style: 'percent', minimumFractionDigits: pd, maximumFractionDigits: pd }).format(v)
  }
  if (f.startsWith('currency:')) {
    const code = f.slice(9).toUpperCase()
    const compact = big >= 10000
    return v => nf(locale, { style: 'currency', currency: code, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : Math.min(dec, 2), minimumFractionDigits: compact ? 0 : Math.min(dec, 2) }).format(v)
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
