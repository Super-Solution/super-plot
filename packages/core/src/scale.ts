// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { linearTicks, niceDomain, pow10 } from './util/num.js'
import { timeTicks } from './util/time.js'

export interface Tick { value: number; label: string }

/** Maps a data value to a pixel position. `range` is set after layout, once the plot area is known. */
export interface Scale {
  kind: 'linear' | 'time' | 'band'
  range: [number, number]
  /** Position for a numeric value (linear/time) or the *centre* of a category (band). */
  at(v: number | string): number
  /** Width of one band; 0 for continuous scales. */
  bandwidth: number
}

export interface LinearScale extends Scale {
  kind: 'linear' | 'time'
  domain: [number, number]
  /** Logarithmic (base 10): positions are linear in log10 of the value; the domain must be positive. */
  log?: boolean
  at(v: number): number
  ticks(count: number): number[]
  invert(px: number): number
}

export function linearScale(domain: [number, number], kind: 'linear' | 'time' = 'linear'): LinearScale {
  const s: LinearScale = {
    kind,
    domain,
    range: [0, 1],
    bandwidth: 0,
    at(v: number) {
      const [d0, d1] = s.domain
      const t = d1 === d0 ? 0.5 : (v - d0) / (d1 - d0)
      return s.range[0] + t * (s.range[1] - s.range[0])
    },
    invert(px: number) {
      const [r0, r1] = s.range
      const t = r1 === r0 ? 0 : (px - r0) / (r1 - r0)
      return s.domain[0] + t * (s.domain[1] - s.domain[0])
    },
    ticks(count: number) {
      return linearTicks(s.domain[0], s.domain[1], count)
    }
  }
  return s
}

/** A linear scale whose domain is widened to round numbers, optionally anchored at zero. */
export function niceLinear(lo: number, hi: number, opts: { zero?: boolean; count?: number } = {}): LinearScale {
  let a = lo
  let b = hi
  if (opts.zero) {
    a = Math.min(a, 0)
    b = Math.max(b, 0)
  }
  const [n0, n1] = niceDomain(a, b, opts.count ?? 5)
  return linearScale([n0, n1])
}

/**
 * A base-10 log scale on a positive domain. `at` of a value at or below zero is not defined; charts drop such
 * values first (with a `log_nonpositive` warning).
 */
export function logScale(domain: [number, number]): LinearScale {
  const s: LinearScale = {
    kind: 'linear',
    log: true,
    domain,
    range: [0, 1],
    bandwidth: 0,
    at(v: number) {
      const l0 = Math.log10(s.domain[0])
      const l1 = Math.log10(s.domain[1])
      const t = l1 === l0 ? 0.5 : (Math.log10(v) - l0) / (l1 - l0)
      return s.range[0] + t * (s.range[1] - s.range[0])
    },
    invert(px: number) {
      const [r0, r1] = s.range
      const t = r1 === r0 ? 0 : (px - r0) / (r1 - r0)
      const l0 = Math.log10(s.domain[0])
      return 10 ** (l0 + t * (Math.log10(s.domain[1]) - l0))
    },
    ticks(count: number) {
      return logTicks(s.domain[0], s.domain[1], count)
    }
  }
  return s
}

/** A log scale widened to whole powers of ten ([3, 800] becomes [1, 1000]). */
export function niceLog(lo: number, hi: number): LinearScale {
  return logScale(niceLogDomain(lo, hi))
}

/** [lo, hi] (both > 0) widened to powers of ten; a single value gets one decade each side. */
export function niceLogDomain(lo: number, hi: number): [number, number] {
  if (!(lo > 0) || !(hi > 0)) return [1, 10]
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  let k0 = Math.floor(Math.log10(a) + 1e-12)
  let k1 = Math.ceil(Math.log10(b) - 1e-12)
  if (k0 === k1) {
    k0 -= 1
    k1 += 1
  }
  return [pow10(k0), pow10(k1)]
}

/**
 * Ticks for a log axis on [a, b] (both > 0): the powers of ten inside it, every second, third... decade when
 * there are more than `count`; with 2 and 5 times each power added when the range spans few decades (at most
 * `count / 3`). Falls back to round linear ticks when fewer than two would show. Exported for the conformance data.
 */
export function logTicks(a: number, b: number, count: number): number[] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (!(lo > 0) || !Number.isFinite(hi)) return []
  const k0 = Math.ceil(Math.log10(lo) - 1e-9)
  const k1 = Math.floor(Math.log10(hi) + 1e-9)
  const decades = Math.log10(hi / lo)
  const inside = (v: number): boolean => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)
  let out: number[] = []
  if (decades <= Math.max(1, count / 3)) {
    for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
      for (const m of [1, 2, 5]) {
        const v = Number(`${m}e${k}`)
        if (inside(v)) out.push(v)
      }
    }
  } else {
    const stride = Math.max(1, Math.ceil((k1 - k0 + 1) / Math.max(1, count)))
    for (let k = k0; k <= k1; k++) if ((k - k0) % stride === 0) out.push(pow10(k))
  }
  if (out.length < 2) out = linearTicks(lo, hi, Math.max(2, count)).filter(v => v > 0)
  return out
}

export function timeScale(domain: [number, number]): LinearScale {
  return linearScale(domain, 'time')
}

export const timeTickList = (domain: [number, number], count: number, locale: string, timeZone = 'UTC'): Tick[] => timeTicks(domain[0], domain[1], count, locale, timeZone)

export interface BandScale extends Scale {
  kind: 'band'
  domain: string[]
  /** Left/top edge of a band. */
  start(key: string): number
  at(v: string): number
  has(key: string): boolean
}

export function bandScale(domain: string[], padding = 0.2): BandScale {
  const index = new Map(domain.map((k, i) => [k, i]))
  const s: BandScale = {
    kind: 'band',
    domain,
    range: [0, 1],
    bandwidth: 0,
    has: k => index.has(k),
    start(key) {
      const i = index.get(key) ?? 0
      return s.range[0] + i * step() + outer()
    },
    at(key) {
      return s.start(key) + s.bandwidth / 2
    }
  }
  const n = (): number => Math.max(1, domain.length)
  const total = (): number => s.range[1] - s.range[0]
  // Every band gets an equal slot; `padding` is the share of the slot left empty, split on both sides.
  const step = (): number => total() / n()
  const outer = (): number => (step() * padding) / 2
  Object.defineProperty(s, 'bandwidth', { get: () => step() * (1 - padding) })
  return s
}

/** Sub-band layout inside one band (grouped bars). */
export function subBands(count: number, bandwidth: number, gap: number): { width: number; offset: (i: number) => number } {
  const width = Math.max(1, (bandwidth - gap * (count - 1)) / count)
  return { width, offset: i => i * (width + gap) }
}
