// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { AxisInfo, Mark, Scene } from '@supersolutions/super-plot-core/base'
import { markCenter } from './marks.js'
import { invert, pixelOf } from './interact.js'

/** The `sync` option in object form. */
export interface SyncOptions {
  /** Plots with the same key form a group. */
  key: string
  /** Hovering (or keyboard-focusing) an x value shows the guide and tooltip at the nearest x in the others. Default true. */
  hover?: boolean
  /** Zooming or panning x zooms the others' x axis (those whose spec has `zoom`). Default true. */
  zoom?: boolean
  /** Brushing mirrors the brush's x range on the others (those whose spec has `brush`). Default false. */
  brush?: boolean
}

export interface SyncConf { key: string; hover: boolean; zoom: boolean; brush: boolean }

/** `'key'` means hover and zoom on, brush off; an object sets each. Null for no sync (or an empty key). */
export function syncConf(v: unknown): SyncConf | null {
  if (typeof v === 'string') return v ? { key: v, hover: true, zoom: true, brush: false } : null
  const o = v as Partial<SyncOptions> | null
  if (!o || typeof o !== 'object' || typeof o.key !== 'string' || !o.key) return null
  return { key: o.key, hover: o.hover !== false, zoom: o.zoom !== false, brush: o.brush === true }
}

/** A value on a shared x axis: numbers on linear and time (epoch ms) axes, a category on a band axis. */
export interface SyncValue { kind: AxisInfo['kind']; v: number | string }

/** The x axis a plot can share: cartesian, one panel, and x is the category or continuous axis (not horizontal bars). */
function sharedX(scene: Scene | null): AxisInfo | null {
  const a = scene?.axes
  if (!a || scene!.panels || scene!.geo) return null
  if (a.y.kind === 'band' && a.x.kind !== 'band') return null
  return a.x
}

/** The x value a hovered mark stands for: its datum's `x` when that is exact, else its position. */
export function xValueOf(scene: Scene | null, mark: Mark): SyncValue | null {
  const a = sharedX(scene)
  if (!a) return null
  const d = (mark.datum ?? null) as { x?: unknown } | null
  if (a.kind === 'band') {
    const cats = a.domain as string[]
    if (d && typeof d.x === 'string' && cats.includes(d.x)) return { kind: 'band', v: d.x }
  } else if (d && typeof d.x === 'number' && Number.isFinite(d.x)) return { kind: a.kind, v: d.x }
  const px = mark.guide ? mark.guide.x1 : markCenter(mark)?.x
  if (px === undefined) return null
  if (a.kind !== 'band') return { kind: a.kind, v: invert(a, px) }
  let best: string | null = null, bestD = Infinity
  for (const c of a.domain as string[]) {
    const dist = Math.abs(pixelOf(a, c) - px)
    if (dist < bestD) { bestD = dist; best = c }
  }
  return best === null ? null : { kind: 'band', v: best }
}

/**
 * The mark to show for a value hovered in another plot: a line chart's column (one per x) when it has them,
 * else the nearest data mark with a tooltip. -1 when the axes do not match or the value is not on screen.
 */
export function syncTarget(scene: Scene | null, value: SyncValue): number {
  const a = sharedX(scene)
  if (!a || a.kind !== value.kind) return -1
  const plot = scene!.axes!.plot
  let px: number
  let tolerance = Infinity
  if (a.kind === 'band') {
    const cats = a.domain as string[]
    if (!cats.includes(String(value.v))) return -1
    px = pixelOf(a, String(value.v))
    tolerance = Math.abs(a.range[1] - a.range[0]) / Math.max(1, cats.length) / 2
  } else {
    if (typeof value.v !== 'number') return -1
    px = pixelOf(a, value.v)
    if (px < plot.x - 1 || px > plot.x + plot.w + 1) return -1
  }
  const marks = scene!.marks
  const columns = marks.some(m => m.role === 'hit' && m.guide)
  let best = -1, bestD = Infinity
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    if (!m.tip || m.legendKey !== undefined) continue
    if (columns ? !(m.role === 'hit' && m.guide) : m.role !== 'data') continue
    const x = m.guide ? m.guide.x1 : markCenter(m)?.x
    if (x === undefined) continue
    const dist = Math.abs(x - px)
    if (dist < bestD) { bestD = dist; best = i }
  }
  return bestD <= tolerance ? best : -1
}

/** Plots per sync key, for this page (module state; nothing on `window`). A plot leaves its group on dispose. */
const groups = new Map<string, Set<object>>()

export function joinGroup(key: string, member: object): void {
  let g = groups.get(key)
  if (!g) groups.set(key, (g = new Set()))
  g.add(member)
}

export function leaveGroup(key: string, member: object): void {
  const g = groups.get(key)
  if (!g) return
  g.delete(member)
  if (!g.size) groups.delete(key)
}

/** Everyone in a group (the caller filters itself out). */
export function groupOf<T extends object>(key: string): T[] {
  return [...(groups.get(key) ?? [])] as T[]
}
