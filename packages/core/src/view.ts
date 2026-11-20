// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/view`: the map projections and the 3D charts' view (where a longitude and
 * latitude, or a point in the 3D box, lands on screen), for code that draws or moves a map or a 3D chart itself.
 * The map and 3D charts import it; `/base` keeps only the cameras and their limits (`clampCamera`,
 * `clampCamera3d`), so an SVG chart does not carry the projection maths. The package root re-exports it all.
 */
export { makeView, project, projectFlat, unprojectFlat, dragCamera, zoomCamera, defaultCamera, slerp, angularDistance, worldOutline, OBLIQUE } from './geo/view.js'
export type { ViewParams, ViewInput, Projection, GeoViewKind, Projected } from './geo/view.js'
export { arcPoints } from './geo/draw.js'
export { makeView3d, project3d, dragCamera3d, zoomCamera3d, EYE_DISTANCE } from './view3d.js'
export type { View3d, View3dInput, Projection3d, Projected3d } from './view3d.js'
