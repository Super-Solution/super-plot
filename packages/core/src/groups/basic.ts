// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/charts/basic`.
 * The everyday charts: bar, line, area, scatter, pie, donut, histogram, box and heatmap.
 * Register them with `registerCharts(basicCharts)` (from `/base`), or pick single ones.
 */
import { bar } from '../charts/bar.js'
import { areaChart, line } from '../charts/series.js'
import { scatter } from '../charts/scatter.js'
import { donut, pie } from '../charts/pie.js'
import { histogram } from '../charts/histogram.js'
import { box } from '../charts/box.js'
import { heatmap } from '../charts/heatmap.js'
import type { ChartDef } from '../registry.js'

export { bar, line, areaChart as area, scatter, pie, donut, histogram, box, heatmap }

/** Every chart of this group. */
export const basicCharts: readonly ChartDef[] = [bar, line, areaChart, scatter, pie, donut, histogram, box, heatmap]
