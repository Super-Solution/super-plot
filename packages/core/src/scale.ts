import { linearTicks, niceDomain } from './util/num.js'
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

export function timeScale(domain: [number, number]): LinearScale {
  return linearScale(domain, 'time')
}

export const timeTickList = (domain: [number, number], count: number, locale: string): Tick[] => timeTicks(domain[0], domain[1], count, locale)

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
