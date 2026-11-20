// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/charts/maps`.
 * Maps: choropleth, bubble map, column map and flow map (with the projection maths). Geographies are
 * registered separately (`registerGeography`).
 * Register them with `registerCharts(mapCharts)` (from `/base`), or pick single ones.
 */
import { bubbleMap, choropleth, columnMap, flowMap } from '../charts/maps.js'
import type { ChartDef } from '../registry.js'

export { choropleth, bubbleMap, columnMap, flowMap }

/** Every chart of this group. */
export const mapCharts: readonly ChartDef[] = [choropleth, bubbleMap, columnMap, flowMap]
