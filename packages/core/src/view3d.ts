// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * The camera of the 3D charts (`scatter3d`, `surface`). The data sit in a unit box, each axis scaled to
 * [-1, 1] (x to the right, y away from the viewer, z up), and the camera turns round the box's centre.
 *
 * The conventions are the map camera's (`geo/view.ts`), so one set of gestures, events and words serves both:
 * `pitch` is the tilt away from looking straight down (0 from above, 90 from the side), `bearing` turns the
 * box clockwise, `zoom` magnifies the picture. The rotation is the same as `flatToScreen` with the data's y
 * as north and z as height.
 *
 * Orthographic is the default: a point's size on screen does not change with depth. `perspective` puts the eye
 * {@link EYE_DISTANCE} box radii from the centre, so nearer things are drawn larger.
 */
import type { Rect } from './scene.js'
import { CAMERA3D_LIMITS, DEFAULT_CAMERA3D, camera3dOf, clampCamera3d, type Camera3d } from './camera3d.js'

export { CAMERA3D_LIMITS, DEFAULT_CAMERA3D, camera3dOf, clampCamera3d, type Camera3d }

export type Projection3d = 'orthographic' | 'perspective'

/** Perspective: the eye is this many box radii (half the box diagonal) from the centre. */
export const EYE_DISTANCE = 3

/** Half the diagonal of the unit box [-1, 1]^3: everything drawn fits in a sphere this big. */
const BOX_RADIUS = Math.sqrt(3)
const RAD = Math.PI / 180

export interface View3dInput {
  projection: Projection3d
  /** The area the box is fitted into, in scene pixels. */
  rect: Rect
  camera?: Partial<Camera3d>
}

/** A resolved view: plain numbers, safe to send to a worker or a shader. */
export interface View3d {
  projection: Projection3d
  camera: Camera3d
  rect: Rect
  /** Screen centre of the box. */
  cx: number
  cy: number
  /** Pixels per box unit at zoom 1 (and at the centre's depth in perspective). */
  scale: number
  /** Eye distance in box units; 0 is orthographic. */
  distance: number
}

export interface Projected3d {
  x: number
  y: number
  /** Towards the viewer, in box units: larger is nearer (for painter's order). */
  z: number
  /** How much perspective magnifies this point (1 in orthographic): multiply sizes by it. */
  k: number
}

/**
 * Resolve a view: the box's bounding sphere fits the rectangle at zoom 1 whatever the camera, so turning the box
 * never changes its size on screen.
 */
export function makeView3d(input: View3dInput): View3d {
  const camera = clampCamera3d({ ...DEFAULT_CAMERA3D, ...camera3dOf(input.camera) })
  const { rect } = input
  const distance = input.projection === 'perspective' ? EYE_DISTANCE * BOX_RADIUS : 0
  // In perspective the nearest point of the sphere is magnified most; fit that.
  const near = distance ? distance / (distance - BOX_RADIUS) : 1
  const scale = Math.max(1, Math.min(rect.w, rect.h) / 2) / (BOX_RADIUS * near)
  return { projection: input.projection, camera, rect, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, scale, distance }
}

/**
 * Screen position of a point of the box (each coordinate in [-1, 1]). The algorithm, for ports:
 *   b = bearing, p = pitch (radians)
 *   x1 = x cos b - y sin b;  y1 = x sin b + y cos b
 *   Y = y1 cos p + z sin p;  Z = -y1 sin p + z cos p      (Z: towards the viewer)
 *   k = distance ? distance / (distance - Z) : 1
 *   screen x = cx + x1 * scale * k * zoom;  screen y = cy - Y * scale * k * zoom
 */
export function project3d(v: View3d, x: number, y: number, z: number): Projected3d {
  const b = v.camera.bearing * RAD
  const p = v.camera.pitch * RAD
  const cb = Math.cos(b), sb = Math.sin(b)
  const x1 = x * cb - y * sb
  const y1 = x * sb + y * cb
  const Y = y1 * Math.cos(p) + z * Math.sin(p)
  const Z = -y1 * Math.sin(p) + z * Math.cos(p)
  const k = v.distance ? v.distance / (v.distance - Z) : 1
  const s = v.scale * k * v.camera.zoom
  return { x: v.cx + x1 * s, y: v.cy - Y * s, z: Z, k }
}

/** The camera after the viewer drags by (dx, dy) screen pixels: horizontal turns the box, vertical tilts it. */
export function dragCamera3d(v: View3d, dx: number, dy: number): Camera3d {
  const c = v.camera
  return clampCamera3d({ ...c, bearing: c.bearing + dx * 0.4, pitch: c.pitch - dy * 0.3 })
}

/** The camera after zooming by `factor` (2 = twice as close). */
export function zoomCamera3d(v: View3d, factor: number): Camera3d {
  return clampCamera3d({ ...v.camera, zoom: v.camera.zoom * factor })
}
