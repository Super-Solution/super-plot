// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Mark geometry the SVG path needs as well as the canvas view (keyboard order, tooltips, touch slop, sync,
// sound). Kept apart from `canvas.ts` so that the canvas renderer can be a chunk loaded on demand.
import type { Mark, Scene } from '@supersolutions/super-plot-core/base'

/** Where a mark sits, for keyboard order and for placing its tooltip. */
export function markCenter(m: Mark): { x: number; y: number } | null {
  switch (m.type) {
    case 'circle': return { x: m.cx, y: m.cy }
    case 'rect': return { x: m.x + m.w / 2, y: m.y + m.h / 2 }
    case 'text': return { x: m.x, y: m.y }
    case 'line': return { x: (m.x1 + m.x2) / 2, y: (m.y1 + m.y2) / 2 }
    case 'path': return m.focus?.[0] ? { x: m.focus[0].x, y: m.focus[0].y } : pathCenter(m.d)
    default: return null
  }
}

/**
 * The middle of the box around a path's points (segment ends and arc ends; control points left out), or null.
 * Enough to order shapes such as sunburst arcs for the keyboard and to put their tooltip near them.
 */
export function pathCenter(d: string): { x: number; y: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  let cx = 0, cy = 0
  const add = (x: number, y: number): void => {
    cx = x
    cy = y
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const re = /([MLHVACQSTZmlhvacqstz])([^MLHVACQSTZmlhvacqstz]*)/g
  const per: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, A: 7, C: 6, S: 4, Q: 4, Z: 0 }
  let match: RegExpExecArray | null
  let n = 0
  while ((match = re.exec(d)) && n++ < 20000) {
    const cmd = match[1]
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    const nums = (match[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    const k = per[up]
    if (!k) continue
    for (let i = 0; i + k <= nums.length; i += k) {
      if (up === 'H') add(rel ? cx + nums[i] : nums[i], cy)
      else if (up === 'V') add(cx, rel ? cy + nums[i] : nums[i])
      else {
        const x = nums[i + k - 2], y = nums[i + k - 1]
        add(rel ? cx + x : x, rel ? cy + y : y)
      }
    }
  }
  return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null
}

/**
 * The mark with a tooltip (or a drill-down target) nearest to a point, within `radius` scene pixels of its
 * edge, or -1. What a finger that just misses a small dot or a thin bar picks: hit targets of at least
 * 2 x `radius` px for coarse pointers. Legend items, text and paths are left to the exact hit test.
 */
export function nearestMark(scene: Scene, x: number, y: number, radius: number): number {
  let best = -1, bestD = radius
  scene.marks.forEach((m, i) => {
    if (m.legendKey !== undefined || !(m.tip || m.drill !== undefined) || (m.role !== 'data' && m.role !== 'hit')) return
    let d: number
    switch (m.type) {
      case 'rect': d = Math.hypot(Math.max(m.x - x, 0, x - (m.x + m.w)), Math.max(m.y - y, 0, y - (m.y + m.h))); break
      case 'circle': d = Math.max(0, Math.hypot(x - m.cx, y - m.cy) - m.r); break
      case 'line': {
        const dx = m.x2 - m.x1, dy = m.y2 - m.y1
        const t = dx || dy ? Math.max(0, Math.min(1, ((x - m.x1) * dx + (y - m.y1) * dy) / (dx * dx + dy * dy))) : 0
        d = Math.hypot(x - (m.x1 + t * dx), y - (m.y1 + t * dy))
        break
      }
      default: return
    }
    // Later marks are drawn on top: on a tie they win, as in the exact hit test.
    if (d <= bestD) { bestD = d; best = i }
  })
  return best
}
