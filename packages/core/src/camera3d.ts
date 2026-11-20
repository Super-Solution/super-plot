// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * The 3D charts' camera and its limits: what every bundle needs to validate a `camera` and keep a viewer's in
 * range. The projection that uses it is in `view3d.ts` (loaded with the 3D charts and the web binding's 3D code).
 */
/** Where the 3D camera looks from: the same names and meanings as the map camera's. */
export interface Camera3d {
  /** 1 fits the box; 2 is twice as close. */
  zoom: number
  /** Tilt in degrees: 0 looks straight down on the floor, 90 looks at the box from the side. */
  pitch: number
  /** Turn in degrees, clockwise. */
  bearing: number
}

export const CAMERA3D_LIMITS = { zoom: [0.5, 8] as const, pitch: [0, 90] as const, bearing: [-360, 360] as const }

/** The default view: from 30 degrees above the floor, turned a little so no two box edges overlap. */
export const DEFAULT_CAMERA3D: Readonly<Camera3d> = Object.freeze({ zoom: 1, pitch: 60, bearing: 35 })

const finite = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Keep a camera within {@link CAMERA3D_LIMITS}; the bearing is turned into [0, 360). Missing fields take the default. */
export function clampCamera3d(c: Partial<Camera3d>): Camera3d {
  const b = finite(c.bearing, DEFAULT_CAMERA3D.bearing)
  return {
    zoom: Math.max(CAMERA3D_LIMITS.zoom[0], Math.min(CAMERA3D_LIMITS.zoom[1], finite(c.zoom, DEFAULT_CAMERA3D.zoom))),
    pitch: Math.max(CAMERA3D_LIMITS.pitch[0], Math.min(CAMERA3D_LIMITS.pitch[1], finite(c.pitch, DEFAULT_CAMERA3D.pitch))),
    bearing: ((b % 360) + 360) % 360
  }
}

/** Only the 3D camera's own fields, from any camera-shaped object (a map camera's `lng`/`lat` are dropped). */
export function camera3dOf(c: unknown): Partial<Camera3d> {
  const out: Partial<Camera3d> = {}
  if (!c || typeof c !== 'object') return out
  const o = c as Record<string, unknown>
  for (const k of ['zoom', 'pitch', 'bearing'] as const) if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = o[k] as number
  return out
}
