// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Static drawing of a map: turns `SceneGeo` (longitude/latitude items) into ordinary scene marks for the
 * SVG and canvas renderers. The WebGL renderer draws `scene.geo` directly and skips these marks.
 */
import type { ChartCtx } from '../context.js'
import type { GeoArcItem, GeoColumnItem, GeoPointItem, GeoRegionItem, Mark, PathMark, Rect, SceneGeo, Tip } from '../scene.js'
import { project, projectFlat, slerp, angularDistance, worldOutline, flatToScreen, type ViewParams } from './view.js'
import { mix, parseHex } from '../util/color.js'

const RAD = Math.PI / 180
const f = (v: number): string => String(Math.round(v * 10) / 10)

/** Points between `a` and `b` so no step is longer than `step` degrees. */
function densify(r: ArrayLike<number>, step: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < r.length; i += 2) {
    const x = r[i], y = r[i + 1]
    if (i + 3 < r.length) {
      const nx = r[i + 2], ny = r[i + 3]
      const n = Math.ceil(Math.max(Math.abs(nx - x), Math.abs(ny - y)) / step)
      for (let k = 0; k < n; k++) out.push(x + ((nx - x) * k) / n, y + ((ny - y) * k) / n)
    } else out.push(x, y)
  }
  return out
}

// ---- globe clipping ------------------------------------------------------------------------

interface V3 { x: number; y: number; z: number; limb?: 'exit' | 'entry' }

/** Unit vector of a point as the globe camera sees it (before bearing), z towards the viewer. */
function globeVec(v: ViewParams, lng: number, lat: number): V3 {
  const l = (lng - v.camera.lng) * RAD
  const p = lat * RAD
  const p0 = v.camera.lat * RAD
  const cp = Math.cos(p)
  return { x: cp * Math.sin(l), y: Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cp * Math.cos(l), z: Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cp * Math.cos(l) }
}

function globeScreen(v: ViewParams, p: V3, k = 1): [number, number] {
  const b = v.camera.bearing * RAD
  const cb = Math.cos(b), sb = Math.sin(b)
  return [v.rect.x + v.rect.w / 2 + (p.x * cb - p.y * sb) * k * v.radius, v.rect.y + v.rect.h / 2 - (p.x * sb + p.y * cb) * k * v.radius]
}

/** Clip a ring to the visible hemisphere; the cut edge follows the globe's outline. */
function clipHemisphere(pts: V3[]): V3[] {
  const out: V3[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if (a.z >= 0) out.push(a)
    if ((a.z >= 0) !== (b.z >= 0)) {
      const t = a.z / (a.z - b.z)
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      const len = Math.hypot(x, y) || 1
      out.push({ x: x / len, y: y / len, z: 0, limb: a.z >= 0 ? 'exit' : 'entry' })
    }
  }
  if (out.length < 3) return []
  // Replace each straight exit->entry chord by an arc along the limb (the shorter way round).
  const res: V3[] = []
  for (let i = 0; i < out.length; i++) {
    const p = out[i]
    res.push(p)
    const q = out[(i + 1) % out.length]
    if (p.limb === 'exit' && q.limb === 'entry') {
      const a0 = Math.atan2(p.y, p.x)
      let d = Math.atan2(q.y, q.x) - a0
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      const steps = Math.ceil(Math.abs(d) / (4 * RAD))
      for (let k = 1; k < steps; k++) {
        const a = a0 + (d * k) / steps
        res.push({ x: Math.cos(a), y: Math.sin(a), z: 0 })
      }
    }
  }
  return res
}

// ---- paths ---------------------------------------------------------------------------------

/** SVG path for a region's polygons in this view (rings closed; holes need `evenodd`). */
export function regionPath(v: ViewParams, polygons: Float64Array[][], alt = 0, bbox?: [number, number, number, number]): string {
  let d = ''
  if (v.kind === 'globe') {
    const k = 1 + alt
    for (const poly of polygons) {
      for (const ring of poly) {
        const pts = densify(ring, 2)
        const vs: V3[] = []
        for (let i = 0; i < pts.length; i += 2) vs.push(globeVec(v, pts[i], pts[i + 1]))
        const clipped = clipHemisphere(vs)
        if (!clipped.length) continue
        clipped.forEach((p, i) => {
          const [x, y] = globeScreen(v, p, k)
          d += `${i ? 'L' : 'M'}${f(x)} ${f(y)}`
        })
        d += 'Z'
      }
    }
    return d
  }
  const step = v.projection === 'equirectangular' && !v.distance && !v.camera.bearing ? 360 : 3
  const shifts = [0]
  if (bbox && bbox[2] > 180) shifts.push(-360)
  if (bbox && bbox[0] < -180) shifts.push(360)
  for (const sh of shifts) {
    for (const poly of polygons) {
      for (const ring of poly) {
        const pts = densify(ring, step)
        for (let i = 0; i < pts.length; i += 2) {
          const p = project(v, pts[i] + sh, pts[i + 1], alt)
          d += `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`
        }
        d += 'Z'
      }
    }
  }
  return d
}

/** The visible map area as one convex path: the world's outline (or the globe's disc) cut to the plot rectangle. */
export function mapClip(v: ViewParams): string {
  const r = v.rect
  let poly: [number, number][]
  if (v.kind === 'globe') {
    poly = rectPoly(r)
  } else {
    poly = worldOutline(v.projection).map(([x, y]) => {
      const p = flatToScreen(v, (x - v.centerX) * v.scale, (y - v.centerY) * v.scale, 0)
      return [p.x, p.y] as [number, number]
    })
    if (polygonArea(poly) < 0) poly.reverse()
    poly = clipConvex(poly, rectPoly(r))
  }
  return poly.length ? poly.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z' : ''
}

const rectPoly = (r: Rect): [number, number][] => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]

function polygonArea(p: [number, number][]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % p.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Sutherland-Hodgman: subject clipped by a convex polygon (both in the same winding). */
function clipConvex(subject: [number, number][], clip: [number, number][]): [number, number][] {
  let out = subject
  const sign = polygonArea(clip) >= 0 ? 1 : -1
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i]
    const [bx, by] = clip[(i + 1) % clip.length]
    const inside = (p: [number, number]): boolean => sign * ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)) >= 0
    const input = out
    out = []
    for (let k = 0; k < input.length; k++) {
      const p = input[k]
      const q = input[(k + 1) % input.length]
      const pin = inside(p), qin = inside(q)
      if (pin) out.push(p)
      if (pin !== qin) {
        const dx = q[0] - p[0], dy = q[1] - p[1]
        const den = (bx - ax) * dy - (by - ay) * dx
        const t = den === 0 ? 0 : ((bx - ax) * (ay - p[1]) - (by - ay) * (ax - p[0])) / den
        out.push([p[0] + dx * t, p[1] + dy * t])
      }
    }
  }
  return out
}

/** Meridians and parallels every 30 degrees, as one path. */
export function graticulePath(v: ViewParams): string {
  let d = ''
  const line = (pts: [number, number][]): void => {
    let pen = false
    for (const [lng, lat] of pts) {
      const p = project(v, lng, lat)
      if (!p.visible || (v.kind === 'globe' && p.z < 0)) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`
      pen = true
    }
  }
  for (let lng = -180; lng < 180; lng += 30) line(Array.from({ length: 61 }, (_, i) => [lng, -90 + i * 3] as [number, number]))
  for (let lat = -60; lat <= 60; lat += 30) line(Array.from({ length: 121 }, (_, i) => [-180 + i * 3, lat] as [number, number]))
  return d
}

// ---- items ---------------------------------------------------------------------------------

export interface RegionDraw extends Omit<GeoRegionItem, 'mark'> { tip?: Tip; aria?: string; datum?: unknown; rows?: number[]; series?: string; bbox: [number, number, number, number]; center: [number, number] }
export interface PointDraw extends Omit<GeoPointItem, 'mark'> { tip?: Tip; aria?: string; datum?: unknown; rows?: number[]; series?: string }
export interface ColumnDraw extends Omit<GeoColumnItem, 'mark'> { tip?: Tip; aria?: string; datum?: unknown; rows?: number[]; series?: string }
export interface ArcDraw extends Omit<GeoArcItem, 'mark'> { tip?: Tip; aria?: string; datum?: unknown; rows?: number[]; series?: string }

export interface GeoDraw {
  view: ViewParams
  input: SceneGeo['input']
  sphere: SceneGeo['sphere']
  graticule: string | null
  regions: RegionDraw[]
  points: PointDraw[]
  columns: ColumnDraw[]
  arcs: ArcDraw[]
}

const shade = (fill: string, t: number): string => (parseHex(fill) ? mix(fill, '#000000', t) : fill)

/** Push the static marks for a map onto the chart and return the `scene.geo` payload. */
export function drawGeo(c: ChartCtx, g: GeoDraw): SceneGeo {
  const v = g.view
  const clipD = mapClip(v)
  const clipId = `map${Object.keys(c.clips).length}`
  c.clips[clipId] = clipD
  const push = (m: Mark): number => {
    c.marks.push({ ...m, layer: 'geo', clip: clipId })
    return c.marks.length - 1
  }
  if (g.sphere && v.kind === 'globe') {
    const cx = v.rect.x + v.rect.w / 2, cy = v.rect.y + v.rect.h / 2, r = v.radius
    push({ type: 'path', role: 'background', d: `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`, fill: g.sphere.fill, stroke: g.sphere.stroke, strokeWidth: 1 })
  }
  if (g.graticule) push({ type: 'path', role: 'grid', d: graticulePath(v), stroke: g.graticule, strokeWidth: 0.6 })

  // Regions: flat ones first in data order; raised ones back to front.
  const geo: SceneGeo = { view: v, input: g.input, sphere: g.sphere, graticule: g.graticule, regions: [], points: [], columns: [], arcs: [] }
  const flat = g.regions.filter(r => !(r.height > 0))
  const raised = g.regions.filter(r => r.height > 0)
  for (const r of flat) {
    const d = regionPath(v, r.polygons, 0, r.bbox)
    const mark = d ? push(regionMark(r, d)) : -1
    geo.regions.push(item(r, mark))
  }
  const depth = (lng: number, lat: number): number => project(v, lng, lat).z
  raised.sort((a, b) => depth(a.center[0], a.center[1]) - depth(b.center[0], b.center[1]))
  for (const r of raised) {
    const walls = wallsPath(v, r.polygons, r.height)
    if (walls) push({ type: 'path', role: 'data', d: walls, fill: shade(r.fill, 0.28), stroke: shade(r.fill, 0.4), strokeWidth: 0.5, rows: r.rows, series: r.series })
    const d = regionPath(v, r.polygons, r.height, r.bbox)
    const mark = d ? push(regionMark(r, d)) : -1
    geo.regions.push(item(r, mark))
  }

  // Columns, back to front.
  const cols = g.columns.map(col => ({ col, base: project(v, col.lng, col.lat, 0) })).filter(x => x.base.visible && !(v.kind === 'globe' && x.base.z < 0))
  cols.sort((a, b) => a.base.z - b.base.z)
  const colMarks = new Map<ColumnDraw, number>()
  for (const { col, base } of cols) {
    const top = project(v, col.lng, col.lat, col.height)
    const dx = top.x - base.x, dy = top.y - base.y
    const len = Math.hypot(dx, dy)
    const hw = col.width / 2
    let mark: number
    if (len < 1) {
      mark = push({ type: 'circle', role: 'data', cx: base.x, cy: base.y, r: hw, fill: col.fill, tip: col.tip, aria: col.aria, datum: col.datum, rows: col.rows, series: col.series })
    } else {
      const nx = (-dy / len) * hw, ny = (dx / len) * hw
      const d = `M${f(base.x + nx)} ${f(base.y + ny)}L${f(top.x + nx)} ${f(top.y + ny)}L${f(top.x - nx)} ${f(top.y - ny)}L${f(base.x - nx)} ${f(base.y - ny)}Z`
      mark = push({ type: 'path', role: 'data', d, fill: col.fill, stroke: shade(col.fill, 0.25), strokeWidth: 0.5, tip: col.tip, aria: col.aria, datum: col.datum, rows: col.rows, series: col.series, anim: 'fade' })
    }
    colMarks.set(col, mark)
  }
  for (const col of g.columns) geo.columns.push({ lng: col.lng, lat: col.lat, height: col.height, width: col.width, fill: col.fill, mark: colMarks.get(col) ?? -1 })

  // Arcs.
  for (const a of g.arcs) {
    const d = arcPath(v, a.from, a.to, a.height)
    let mark = -1
    if (d.d) {
      push({ type: 'path', role: 'data', d: d.d, stroke: a.stroke, strokeWidth: a.width, opacity: a.opacity, rows: a.rows, series: a.series, anim: 'draw' })
      // The tooltip lives on a hit target at the top of the arc: an open stroke has no inside to hover.
      if (d.apex) mark = push({ type: 'circle', role: 'data', cx: d.apex[0], cy: d.apex[1], r: Math.max(5, a.width + 3), fill: a.stroke, opacity: 0.001, tip: a.tip, aria: a.aria, datum: a.datum, rows: a.rows, series: a.series })
    }
    geo.arcs.push({ from: a.from, to: a.to, height: a.height, width: a.width, stroke: a.stroke, opacity: a.opacity, mark })
  }

  // Points last, so they sit on top.
  for (const p of g.points) {
    const q = project(v, p.lng, p.lat)
    let mark = -1
    if (q.visible && !(v.kind === 'globe' && q.z < 0)) mark = push({ type: 'circle', role: 'data', cx: q.x, cy: q.y, r: p.r, fill: p.fill, stroke: p.stroke, strokeWidth: p.stroke ? 1 : undefined, opacity: p.opacity, tip: p.tip, aria: p.aria, datum: p.datum, rows: p.rows, series: p.series, anim: 'fade' })
    geo.points.push({ lng: p.lng, lat: p.lat, r: p.r, fill: p.fill, stroke: p.stroke, opacity: p.opacity, mark })
  }
  return geo
}

function regionMark(r: RegionDraw, d: string): PathMark {
  return { type: 'path', role: r.tip ? 'data' : 'background', d, fill: r.fill, stroke: r.stroke, strokeWidth: r.strokeWidth, rule: 'evenodd', ...(r.dashed ? { dash: '3 2' } : {}), ...(r.tip ? { tip: r.tip, aria: r.aria, datum: r.datum, rows: r.rows, anim: 'fade' as const } : {}), ...(r.series !== undefined ? { series: r.series } : {}) }
}

function item(r: RegionDraw, mark: number): GeoRegionItem {
  return { polygons: r.polygons, fill: r.fill, stroke: r.stroke, strokeWidth: r.strokeWidth, ...(r.dashed ? { dashed: true } : {}), height: r.height, mark }
}

/** Side walls of a raised region: one quad per outer-ring edge that faces the viewer (back walls are hidden). */
function wallsPath(v: ViewParams, polygons: Float64Array[][], h: number): string {
  let d = ''
  for (const poly of polygons) {
    const ring = poly[0]
    // Ring orientation decides which side of an edge is outside; rings are not normalised on import.
    let area = 0
    for (let i = 0; i + 3 < ring.length; i += 2) area += ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1]
    const outward = area >= 0 ? 1 : -1
    const pts = densify(ring, v.kind === 'globe' ? 2 : 3)
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const a0 = project(v, pts[i], pts[i + 1], 0), b0 = project(v, pts[i + 2], pts[i + 3], 0)
      if (v.kind === 'globe' && (a0.z < 0 || b0.z < 0)) continue
      const a1 = project(v, pts[i], pts[i + 1], h), b1 = project(v, pts[i + 2], pts[i + 3], h)
      // Screen-space winding of the quad: a wall seen from behind winds the other way.
      const s = (b0.x - a0.x) * (a1.y - a0.y) - (b0.y - a0.y) * (a1.x - a0.x)
      if (s * outward > 0) continue
      d += `M${f(a0.x)} ${f(a0.y)}L${f(b0.x)} ${f(b0.y)}L${f(b1.x)} ${f(b1.y)}L${f(a1.x)} ${f(a1.y)}Z`
    }
  }
  return d
}

/** An arc lifted off the surface (great circle on the globe, straight on a flat map), split where it is hidden. */
export function arcPoints(v: ViewParams, a: [number, number], b: [number, number], h: number, steps = 48): { lng: number; lat: number; alt: number }[] {
  const out: { lng: number; lat: number; alt: number }[] = []
  let bl = b[0]
  while (bl - a[0] > 180) bl -= 360
  while (bl - a[0] < -180) bl += 360
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const [lng, lat] = v.kind === 'globe' ? slerp(a, b, t) : [a[0] + (bl - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    out.push({ lng, lat, alt: h * Math.sin(Math.PI * t) })
  }
  return out
}

/** Arc height from the distance it spans (0..1 of the height unit). */
export const arcHeight = (a: [number, number], b: [number, number], scale = 1): number => scale * (0.04 + 0.32 * (angularDistance(a, b) / Math.PI))

function arcPath(v: ViewParams, a: [number, number], b: [number, number], h: number): { d: string; apex: [number, number] | null } {
  const pts = arcPoints(v, a, b, h)
  let d = ''
  let pen = false
  let apex: [number, number] | null = null
  pts.forEach((p, i) => {
    const q = project(v, p.lng, p.lat, p.alt)
    if (!q.visible) { pen = false; return }
    d += `${pen ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`
    pen = true
    if (i === pts.length >> 1) apex = [q.x, q.y]
  })
  return { d, apex }
}

/** Projected centre for a lng/lat in flat projected units, exposed for tests. */
export const flatXY = projectFlat
