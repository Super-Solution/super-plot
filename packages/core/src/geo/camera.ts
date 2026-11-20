// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * The map camera and its limits: what every bundle needs to validate a spec's `camera` and keep a viewer's
 * camera in range. The projection maths that uses it is in `view.ts` (loaded with the map charts and the
 * web binding's map code, not with every chart).
 */
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

export const round6 = (v: number): number => Math.round(v * 1e6) / 1e6
export const wrap = (lng: number): number => ((((lng + 180) % 360) + 360) % 360) - 180

export function clampCamera(c: Camera): Camera {
  return {
    lng: wrap(Number.isFinite(c.lng) ? c.lng : 0),
    lat: Math.max(-89.9, Math.min(89.9, Number.isFinite(c.lat) ? c.lat : 0)),
    zoom: Math.max(CAMERA_LIMITS.zoom[0], Math.min(CAMERA_LIMITS.zoom[1], Number.isFinite(c.zoom) ? c.zoom : 1)),
    pitch: Math.max(CAMERA_LIMITS.pitch[0], Math.min(CAMERA_LIMITS.pitch[1], Number.isFinite(c.pitch) ? c.pitch : 0)),
    bearing: Number.isFinite(c.bearing) ? ((c.bearing % 360) + 360) % 360 : 0
  }
}
