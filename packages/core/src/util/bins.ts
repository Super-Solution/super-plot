// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { clamp, extent, quantile, tickStep } from './num.js'

/** Histogram binning, shared by the histogram chart and the `bin` transform step. Pure, no DOM. */

/** Bin edges that cover [min, max] with round numbers. Exported for the conformance data. */
export function binEdges(values: number[], bins: number | 'auto', binWidth?: number): number[] {
  const e = extent(values)
  if (!e) return [0, 1]
  const [min, max] = e
  if (min === max) return [min - 0.5, max + 0.5]
  let step: number
  if (binWidth && binWidth > 0) step = binWidth
  else {
    let n: number
    if (bins === 'auto') {
      const sorted = [...values].sort((a, b) => a - b)
      const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25)
      const fd = iqr > 0 ? (2 * iqr) / Math.cbrt(sorted.length) : 0
      n = fd > 0 ? Math.ceil((max - min) / fd) : Math.ceil(Math.log2(sorted.length)) + 1
      n = clamp(n, 5, 40)
    } else n = bins
    step = tickStep(min, max, n)
  }
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) + 1
  const lo = Math.floor(min / step + 1e-9) * step
  const out: number[] = []
  for (let i = 0; lo + i * step < max + step * 1e-9 && out.length < 400; i++) out.push(Number((lo + i * step).toFixed(dec)))
  if (out[out.length - 1] <= max) out.push(Number((out[out.length - 1] + step).toFixed(dec)))
  return out
}

/** Count values into [edge_i, edge_i+1); the last bin also includes its upper edge. */
export function binCounts(values: number[], edges: number[]): number[] {
  const counts = new Array(edges.length - 1).fill(0)
  for (const v of values) {
    if (v < edges[0] || v > edges[edges.length - 1]) continue
    let lo = 0
    let hi = edges.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (v >= edges[mid]) lo = mid
      else hi = mid
    }
    counts[Math.min(lo, counts.length - 1)]++
  }
  return counts
}


/** Index of the bin holding `v` ([edge_i, edge_i+1), the last bin closed), or -1 outside the edges. */
export function binIndex(v: number, edges: number[]): number {
  if (!(v >= edges[0]) || !(v <= edges[edges.length - 1])) return -1
  let lo = 0
  let hi = edges.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (v >= edges[mid]) lo = mid
    else hi = mid
  }
  return Math.min(lo, edges.length - 2)
}

/** The next round step after `step`: 1, 2, 5, 10, 20, 50, ... times a power of ten. */
export function nextNiceStep(step: number): number {
  const p = Number(`1e${Math.floor(Math.log10(step) + 1e-9)}`)
  const m = step / p
  return (m < 1.5 ? 2 : m < 3.5 ? 5 : 10) * p
}

/**
 * Edges for the `bin` transform step: `step` when given, otherwise the histogram's round step for `maxbins`
 * (default 10), made coarser (1, 2, 5 times a power of ten) until there are at most `maxbins` bins.
 */
export function transformBinEdges(values: number[], maxbins = 10, step?: number): number[] {
  if (step !== undefined) return binEdges(values, maxbins, step)
  let edges = binEdges(values, maxbins)
  for (let guard = 0; edges.length - 1 > maxbins && guard < 60; guard++) edges = binEdges(values, maxbins, nextNiceStep(edges[1] - edges[0]))
  return edges
}
