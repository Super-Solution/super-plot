// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * What `/base` says about the map and 3D chart types without loading them: their names and limits. The chart
 * code (and the projection maths it pulls in) stays in `charts/maps.ts` and `charts/plot3d.ts`.
 */

/** True for the map chart types. */
export const isMapType = (type: string): boolean => type === 'choropleth' || type === 'bubble-map' || type === 'column-map' || type === 'flow-map'

/** True for the non-map 3D chart types. */
export const is3dType = (type: string): boolean => type === 'scatter3d' || type === 'surface'

/** A surface takes at most this many distinct x (and y) values: 200 x 200 = 40,000 cells. */
export const MAX_SURFACE_SIDE = 200
/** Above this many visible points, drop lines are left out unless the spec asks for them. */
export const DROP_LINES_AUTO = 2000
