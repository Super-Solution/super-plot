/**
 * Map projections and the camera. One description of "where is this longitude/latitude/altitude on screen"
 * serves the static renderers (SVG, canvas: through `project`) and the WebGL renderer (through the same
 * numbers in `ViewParams`, evaluated in a shader), so both draw the same picture.
 *
 * Views:
 *   flat  - a world projection (equal-earth, mercator, equirectangular) fitted to the data, optionally tilted
 *           (`pitch`) and turned (`bearing`) with a perspective camera, so heights read as 3D.
 *   globe - an orthographic sphere centred on the camera's longitude/latitude.
 */
import type { Rect } from '../scene.js'

export type Projection = 'equal-earth' | 'mercator' | 'equirectangular'
export type GeoViewKind = 'flat' | 'globe'

export interface Camera {
  /** Centre longitude, degrees. */
  lng: number
  /** Centre latitude, degrees. */
  lat: number
  /** 1 fits the data; 2 is twice as close. */
  zoom: number
  /** Tilt in degrees: 0 looks straight down (flat view only). */
  pitch: number
  /** Rotation in degrees, clockwise. */
  bearing: number
}

export const CAMERA_LIMITS = { zoom: [0.5, 40] as const, pitch: [0, 70] as const, bearing: [-360, 360] as const }

/** Everything needed to reproduce a view: plain numbers, safe to send to a worker or a shader. */
export interface ViewParams {
  kind: GeoViewKind
  projection: Projection
  camera: Camera
  /** The plot area in scene pixels. */
  rect: Rect
  /** flat: projected centre and pixels per projected unit. */
  centerX: number
  centerY: number
  scale: number
  /** globe: radius in pixels. */
  radius: number
  /** Perspective distance in pixels (flat with pitch); 0 means orthographic. */
  distance: number
  /** Pixels per unit of altitude: flat views lift by `alt * heightPx`; the globe by `alt * radius`. */
  heightPx: number
}

export interface Projected {
  x: number
  y: number
  /** Towards the viewer: larger is nearer (for depth sorting). */
  z: number
  visible: boolean
}

const RAD = Math.PI / 180
/** How far up the screen a height goes on an untilted flat map (share of the height). */
export const OBLIQUE = 0.5
const MERC_LAT = 85.0511287798
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796
const M = Math.sqrt(3) / 2

/** Longitude/latitude (degrees) to projected units for a flat projection. Longitudes outside ±180 keep going. */
export function projectFlat(projection: Projection, lng: number, lat: number): [number, number] {
  const l = lng * RAD
  if (projection === 'mercator') {
    const p = Math.max(-MERC_LAT, Math.min(MERC_LAT, lat)) * RAD
    return [l, Math.log(Math.tan(Math.PI / 4 + p / 2))]
  }
  if (projection === 'equirectangular') return [l, lat * RAD]
  const t = Math.asin(M * Math.sin(lat * RAD))
  const t2 = t * t
  const t6 = t2 * t2 * t2
  return [(l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))), t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))]
}

/** The world's outline in projected units, for clipping a flat map (one closed ring). */
export function worldOutline(projection: Projection): [number, number][] {
  const out: [number, number][] = []
  const lat0 = projection === 'mercator' ? MERC_LAT : 90
  for (let lat = -lat0; lat <= lat0 + 1e-9; lat += lat0 / 30) out.push(projectFlat(projection, 180, lat))
  for (let lat = lat0; lat >= -lat0 - 1e-9; lat -= lat0 / 30) out.push(projectFlat(projection, -180, lat))
  return out
}

export interface ViewInput {
  kind: GeoViewKind
  projection: Projection
  rect: Rect
  /** What to fit when the camera does not say otherwise: [west, south, east, north]. */
  focus: [number, number, number, number]
  camera?: Partial<Camera>
  /** Leave room for columns and arcs that rise above the surface (0..1 of the radius on a globe). */
  lift?: number
}

/** The default camera for some data: centred on it, straight down. */
export function defaultCamera(input: Pick<ViewInput, 'kind' | 'focus'>): Camera {
  const [w, s, e, n] = input.focus
  const lng = wrap((w + e) / 2)
  const lat = Math.max(-80, Math.min(80, (s + n) / 2))
  return { lng: round6(lng), lat: round6(input.kind === 'globe' ? Math.max(-60, Math.min(60, lat)) : lat), zoom: 1, pitch: 0, bearing: 0 }
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6
const wrap = (lng: number): number => ((((lng + 180) % 360) + 360) % 360) - 180

export function clampCamera(c: Camera): Camera {
  return {
    lng: wrap(Number.isFinite(c.lng) ? c.lng : 0),
    lat: Math.max(-89.9, Math.min(89.9, Number.isFinite(c.lat) ? c.lat : 0)),
    zoom: Math.max(CAMERA_LIMITS.zoom[0], Math.min(CAMERA_LIMITS.zoom[1], Number.isFinite(c.zoom) ? c.zoom : 1)),
    pitch: Math.max(CAMERA_LIMITS.pitch[0], Math.min(CAMERA_LIMITS.pitch[1], Number.isFinite(c.pitch) ? c.pitch : 0)),
    bearing: Number.isFinite(c.bearing) ? ((c.bearing % 360) + 360) % 360 : 0
  }
}

/** Resolve a view: fit the focus area into the rectangle, apply the camera. */
export function makeView(input: ViewInput): ViewParams {
  const base = defaultCamera(input)
  const camera = clampCamera({ ...base, ...stripUndefined(input.camera ?? {}) })
  const { rect } = input
  const lift = input.lift ?? 0
  if (input.kind === 'globe') {
    // Zoom 1 shows the data: the whole sphere for wide data, closer in for a small area.
    const [w, s, e, n] = input.focus
    const span = Math.max((e - w) * Math.cos(((s + n) / 2) * RAD), n - s) * RAD
    const fitZoom = Math.max(1, Math.min(12, 0.9 / Math.max(Math.sin(Math.min(Math.PI / 2, span / 2)), 1e-3)))
    const radius = (Math.min(rect.w, rect.h) / 2) * 0.94 / (1 + lift * 0.9) * camera.zoom * fitZoom
    return { kind: 'globe', projection: input.projection, camera, rect, centerX: 0, centerY: 0, scale: 1, radius, distance: 0, heightPx: radius }
  }
  // Fit the focus box (sampled along its edges: projections curve) in projected units.
  const [w, s, e, n] = input.focus
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let i = 0; i <= 16; i++) {
    for (const [lng, lat] of [[w + ((e - w) * i) / 16, s], [w + ((e - w) * i) / 16, n], [w, s + ((n - s) * i) / 16], [e, s + ((n - s) * i) / 16]]) {
      const [x, y] = projectFlat(input.projection, lng, lat)
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
  }
  const bw = Math.max(x1 - x0, 1e-6)
  const bh = Math.max(y1 - y0, 1e-6)
  const fit = Math.min(rect.w / bw, rect.h / bh) * 0.96
  const scale = fit * camera.zoom
  // The camera centre: the focus centre unless the camera names one (centre longitude in the focus's turn).
  const explicit = input.camera && (input.camera.lng !== undefined || input.camera.lat !== undefined)
  let cx = (x0 + x1) / 2
  let cy = (y0 + y1) / 2
  if (explicit) {
    const mid = (w + e) / 2
    let lng = camera.lng
    while (lng - mid > 180) lng -= 360
    while (lng - mid < -180) lng += 360
    ;[cx, cy] = projectFlat(input.projection, lng, camera.lat)
  }
  // Report the centre actually on screen, so a camera read back and passed in again shows the same view.
  const shown = explicit ? camera : clampCamera({ ...camera, ...(([lng, lat]) => ({ lng: round6(lng), lat: round6(lat) }))(unprojectFlat(input.projection, cx, cy)) })
  const distance = camera.pitch > 0 ? Math.max(rect.w, rect.h) * 1.6 : 0
  return { kind: 'flat', projection: input.projection, camera: shown, rect, centerX: cx, centerY: cy, scale, radius: 0, distance, heightPx: Math.min(rect.w, rect.h) * 0.45 }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

/** Screen position of a longitude/latitude/altitude (altitude 0..1 of the view's height unit). */
export function project(v: ViewParams, lng: number, lat: number, alt = 0): Projected {
  const cxs = v.rect.x + v.rect.w / 2
  const cys = v.rect.y + v.rect.h / 2
  const b = v.camera.bearing * RAD
  const cb = Math.cos(b), sb = Math.sin(b)
  if (v.kind === 'globe') {
    const l = (lng - v.camera.lng) * RAD
    const p = lat * RAD
    const p0 = v.camera.lat * RAD
    const cp = Math.cos(p)
    const x = cp * Math.sin(l)
    const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cp * Math.cos(l)
    const z = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cp * Math.cos(l)
    const k = 1 + alt
    const xr = (x * cb - y * sb) * k
    const yr = (x * sb + y * cb) * k
    const zr = z * k
    // A point in front of the sphere, or one high enough to show past its edge, is visible.
    const visible = zr >= 0 || xr * xr + yr * yr > 1
    return { x: cxs + xr * v.radius, y: cys - yr * v.radius, z: zr, visible }
  }
  const [px, py] = projectFlat(v.projection, lng, lat)
  return flatToScreen(v, (px - v.centerX) * v.scale, (py - v.centerY) * v.scale, alt * v.heightPx, cxs, cys, cb, sb)
}

/** Projected (already scaled, centred) plane coordinates plus a height in pixels to the screen. */
export function flatToScreen(v: ViewParams, x: number, y: number, h: number, cxs = v.rect.x + v.rect.w / 2, cys = v.rect.y + v.rect.h / 2, cb = Math.cos(v.camera.bearing * RAD), sb = Math.sin(v.camera.bearing * RAD)): Projected {
  const x1 = x * cb - y * sb
  const y1 = x * sb + y * cb
  // Straight down: heights show as an oblique lift up the screen, nearer is further down.
  if (!v.distance) return { x: cxs + x1, y: cys - y1 - h * OBLIQUE, z: h - y1, visible: true }
  const p = v.camera.pitch * RAD
  const Y = y1 * Math.cos(p) + h * Math.sin(p)
  const Z = -y1 * Math.sin(p) + h * Math.cos(p)
  const f = v.distance / Math.max(1, v.distance - Z)
  return { x: cxs + x1 * f, y: cys - Y * f, z: Z, visible: v.distance - Z > 1 }
}

/** Great-circle interpolation between two points (degrees), `t` in [0, 1]. */
export function slerp(a: [number, number], b: [number, number], t: number): [number, number] {
  const [l1, p1] = [a[0] * RAD, a[1] * RAD]
  const [l2, p2] = [b[0] * RAD, b[1] * RAD]
  const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)]
  const v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)]
  const dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]))
  const om = Math.acos(dot)
  if (om < 1e-9) return [a[0], a[1]]
  const s = Math.sin(om)
  const k1 = Math.sin((1 - t) * om) / s
  const k2 = Math.sin(t * om) / s
  const x = k1 * v1[0] + k2 * v2[0]
  const y = k1 * v1[1] + k2 * v2[1]
  const z = k1 * v1[2] + k2 * v2[2]
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]
}

/** Angle between two points on the sphere, radians. */
export function angularDistance(a: [number, number], b: [number, number]): number {
  const p1 = a[1] * RAD, p2 = b[1] * RAD
  const dl = (b[0] - a[0]) * RAD
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Projected units back to longitude/latitude (degrees) for a flat projection. */
export function unprojectFlat(projection: Projection, x: number, y: number): [number, number] {
  if (projection === 'mercator') return [x / RAD, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD]
  if (projection === 'equirectangular') return [x / RAD, Math.max(-90, Math.min(90, y / RAD))]
  // Equal Earth: Newton's method on the latitude polynomial.
  let t = y
  for (let i = 0; i < 12; i++) {
    const t2 = t * t, t6 = t2 * t2 * t2
    const fy = t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y
    const fpy = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)
    const d = fy / fpy
    t -= d
    if (Math.abs(d) < 1e-12) break
  }
  const t2 = t * t, t6 = t2 * t2 * t2
  const lng = (M * x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / Math.cos(t)
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(t) / M)))
  return [lng / RAD, lat / RAD]
}

/**
 * The camera after the viewer drags by (dx, dy) screen pixels: the globe turns under the pointer, a flat map
 * pans. With `turn`, the drag tilts (vertical) and rotates (horizontal) instead.
 */
export function dragCamera(v: ViewParams, dx: number, dy: number, turn = false): Camera {
  const c = v.camera
  if (turn) return clampCamera({ ...c, bearing: c.bearing + dx * 0.4, pitch: v.kind === 'flat' ? c.pitch - dy * 0.3 : c.pitch })
  const b = c.bearing * RAD
  // Undo the bearing so a drag moves the map the way the pointer moves.
  const ux = dx * Math.cos(b) - dy * Math.sin(b)
  const uy = dx * Math.sin(b) + dy * Math.cos(b)
  if (v.kind === 'globe') {
    const k = 1 / RAD / Math.max(1, v.radius)
    return clampCamera({ ...c, lng: c.lng - ux * k / Math.max(0.2, Math.cos(c.lat * RAD)), lat: c.lat + uy * k })
  }
  const tilt = v.distance ? 1 / Math.max(0.3, Math.cos(c.pitch * RAD)) : 1
  const [lng, lat] = unprojectFlat(v.projection, v.centerX - ux / v.scale, v.centerY + (uy * tilt) / v.scale)
  return clampCamera({ ...c, lng, lat })
}

/** The camera after zooming by `factor` (2 = twice as close). */
export function zoomCamera(v: ViewParams, factor: number): Camera {
  const c = v.camera
  const [lng, lat] = v.kind === 'flat' ? unprojectFlat(v.projection, v.centerX, v.centerY) : [c.lng, c.lat]
  return clampCamera({ ...c, lng, lat, zoom: c.zoom * factor })
}
