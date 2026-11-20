// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/charts/hierarchy`: parts of a whole and flows: treemap, sunburst and sankey.
 * Register them with `registerCharts(hierarchyCharts)` (from `/base`), or pick single ones.
 */
import { treemap } from '../charts/treemap.js'
import { sunburst } from '../charts/sunburst.js'
import { sankey } from '../charts/sankey.js'
import type { ChartDef } from '../registry.js'

export { treemap, sunburst, sankey }

/** Every chart of this group. */
export const hierarchyCharts: readonly ChartDef[] = [treemap, sunburst, sankey]
