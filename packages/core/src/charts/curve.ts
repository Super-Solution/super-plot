// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { r2 } from '../util/num.js'

export type Curve = 'linear' | 'smooth' | 'step'
export type Pt = [number, number]

const f = (v: number): string => String(r2(v))

/** Path through points (continuous run, no gaps), starting with M. */
export function curvePath(pts: Pt[], curve: Curve, move = true): string {
  if (pts.length === 0) return ''
  const start = move ? `M${f(pts[0][0])} ${f(pts[0][1])}` : `L${f(pts[0][0])} ${f(pts[0][1])}`
  if (pts.length === 1) return start + `h0`
  if (curve === 'step') {
    let d = start
    for (let i = 1; i < pts.length; i++) d += `H${f(pts[i][0])}V${f(pts[i][1])}`
    return d
  }
  if (curve === 'smooth' && pts.length > 2) return start + monotone(pts)
  let d = start
  for (let i = 1; i < pts.length; i++) d += `L${f(pts[i][0])} ${f(pts[i][1])}`
  return d
}

/** Monotone cubic interpolation (Fritsch-Carlson): smooth, never overshoots the data. */
function monotone(p: Pt[]): string {
  const n = p.length
  const dx: number[] = []
  const sl: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1][0] - p[i][0])
    sl.push(dx[i] === 0 ? 0 : (p[i + 1][1] - p[i][1]) / dx[i])
  }
  const m: number[] = [sl[0]]
  for (let i = 1; i < n - 1; i++) m.push(sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2)
  m.push(sl[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / sl[i]
      const b = m[i + 1] / sl[i]
      const h = Math.hypot(a, b)
      if (h > 3) {
        const t = 3 / h
        m[i] = t * a * sl[i]
        m[i + 1] = t * b * sl[i]
      }
    }
  }
  let d = ''
  for (let i = 0; i < n - 1; i++) {
    const w = dx[i] / 3
    d += `C${f(p[i][0] + w)} ${f(p[i][1] + m[i] * w)} ${f(p[i + 1][0] - w)} ${f(p[i + 1][1] - m[i + 1] * w)} ${f(p[i + 1][0])} ${f(p[i + 1][1])}`
  }
  return d
}

/** Closed area between a top run and a bottom run (both left to right). */
export function areaPath(top: Pt[], bottom: Pt[], curve: Curve): string {
  if (top.length === 0) return ''
  const rev = [...bottom].reverse()
  return curvePath(top, curve) + curvePath(rev, curve, false) + 'Z'
}

/** Split points into runs wherever y is missing. */
export function runs<T extends { y: number | null }>(pts: T[]): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  for (const p of pts) {
    if (p.y === null) {
      if (cur.length) out.push(cur)
      cur = []
    } else cur.push(p)
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * Thin a dense run for drawing: when there are many more points than pixel columns, keep the
 * first, minimum, maximum and last point of each column. The drawn shape is the same; the path
 * (and the SVG) stays small. Tooltips still read the full data.
 */
export function decimate(pts: Pt[], width: number): Pt[] {
  if (pts.length <= Math.max(200, width * 3)) return pts
  const out: Pt[] = []
  let col = Math.floor(pts[0][0])
  let first = 0
  let min = 0
  let max = 0
  const flush = (last: number): void => {
    const idx = [...new Set([first, min, max, last])].sort((a, b) => a - b)
    for (const i of idx) out.push(pts[i])
  }
  for (let i = 1; i < pts.length; i++) {
    const c = Math.floor(pts[i][0])
    if (c !== col) {
      flush(i - 1)
      col = c
      first = min = max = i
    } else {
      if (pts[i][1] < pts[min][1]) min = i
      if (pts[i][1] > pts[max][1]) max = i
    }
  }
  flush(pts.length - 1)
  return out
}
