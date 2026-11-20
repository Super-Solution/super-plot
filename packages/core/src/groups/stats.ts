// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/charts/stats`.
 * Distributions and comparisons: violin, beeswarm, parallel coordinates, radar, bump and calendar.
 * Register them with `registerCharts(statsCharts)` (from `/base`), or pick single ones.
 */
import { violin } from '../charts/violin.js'
import { beeswarm } from '../charts/beeswarm.js'
import { parallel } from '../charts/parallel.js'
import { radar } from '../charts/radar.js'
import { bump } from '../charts/bump.js'
import { calendar } from '../charts/calendar.js'
import type { ChartDef } from '../registry.js'

export { violin, beeswarm, parallel, radar, bump, calendar }

/** Every chart of this group. */
export const statsCharts: readonly ChartDef[] = [violin, beeswarm, parallel, radar, bump, calendar]
