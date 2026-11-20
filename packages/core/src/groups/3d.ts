// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/charts/3d`: the 3D charts: scatter3d and surface (with the 3D view maths).
 * Register them with `registerCharts(charts3d)` (from `/base`), or pick single ones.
 */
import { scatter3d, surface } from '../charts/plot3d.js'
import type { ChartDef } from '../registry.js'

export { scatter3d, surface }

/** Every chart of this group. */
export const charts3d: readonly ChartDef[] = [scatter3d, surface]
