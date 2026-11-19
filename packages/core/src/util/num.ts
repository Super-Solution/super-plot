// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/** Numeric helpers. Pure, no DOM. */

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Number from a number or a plain numeric string; `null` for anything else (including empty). */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const E10 = Math.sqrt(50)
const E5 = Math.sqrt(10)
const E2 = Math.sqrt(2)

/** 10 to an integer power, correctly rounded. `10 ** -4` is not: V8 returns 0.00009999999999999999. */
export const pow10 = (k: number): number => Number(`1e${k}`)

/** A "nice" step (1, 2 or 5 times a power of ten) giving about `count` intervals. */
export function tickStep(start: number, stop: number, count: number): number {
  const step0 = Math.abs(stop - start) / Math.max(1, count)
  if (!(step0 > 0) || !Number.isFinite(step0)) return 1
  let step1 = pow10(Math.floor(Math.log10(step0)))
  const err = step0 / step1
  if (err >= E10) step1 *= 10
  else if (err >= E5) step1 *= 5
  else if (err >= E2) step1 *= 2
  return step1
}

const decimalsOf = (step: number): number => Math.max(0, -Math.floor(Math.log10(step) + 1e-9))

/** Round-number tick values inside [a, b]. */
export function linearTicks(a: number, b: number, count: number): number[] {
  if (a === b) return [a]
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const step = tickStep(lo, hi, count)
  const dec = decimalsOf(step)
  const out: number[] = []
  const first = Math.ceil(lo / step - 1e-9)
  const last = Math.floor(hi / step + 1e-9)
  for (let i = first; i <= last; i++) out.push(Number((i * step).toFixed(dec)))
  return out
}

/** Expand [a, b] outwards to tick boundaries. */
export function niceDomain(a: number, b: number, count: number): [number, number] {
  if (a === b) {
    if (a === 0) return [0, 1]
    const pad = Math.abs(a) * 0.1
    return [a - pad, b + pad]
  }
  let lo = Math.min(a, b)
  let hi = Math.max(a, b)
  for (let i = 0; i < 2; i++) {
    const step = tickStep(lo, hi, count)
    const nlo = Math.floor(lo / step + 1e-9) * step
    const nhi = Math.ceil(hi / step - 1e-9) * step
    if (nlo === lo && nhi === hi) break
    lo = nlo
    hi = nhi
  }
  const dec = decimalsOf(tickStep(lo, hi, count)) + 1
  return [Number(lo.toFixed(dec)), Number(hi.toFixed(dec))]
}

export function extent(values: Iterable<number>): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return lo <= hi ? [lo, hi] : null
}

export const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0)
export const mean = (values: number[]): number => (values.length ? sum(values) / values.length : NaN)

/** Quantile of an ascending-sorted array, linear interpolation (type 7: the R / NumPy default). */
export function quantile(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(n - 1, lo + 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

/** Round for output, so tiny float noise never reaches a scene or an SVG. */
export const r2 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0)
export const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/** Pearson correlation; `null` when undefined (fewer than 2 points or zero variance). */
export function correlation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/** Ordinary least squares y = a + b x. */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx }
}

/** Closest candidate by edit distance, for "did you mean". */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestD = Infinity
  const w = word.toLowerCase()
  for (const c of candidates) {
    const d = levenshtein(w, c.toLowerCase())
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  const limit = Math.max(2, Math.floor(word.length / 3))
  return best !== undefined && bestD <= limit ? best : undefined
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}
