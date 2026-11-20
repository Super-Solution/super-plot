// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/charts/business`.
 * Reporting charts: waterfall, bullet, funnel, waffle, timeline and gauge.
 * Register them with `registerCharts(businessCharts)` (from `/base`), or pick single ones.
 */
import { waterfall } from '../charts/waterfall.js'
import { bullet } from '../charts/bullet.js'
import { funnel } from '../charts/funnel.js'
import { waffle } from '../charts/waffle.js'
import { timeline } from '../charts/timeline.js'
import { gauge } from '../charts/gauge.js'
import type { ChartDef } from '../registry.js'

export { waterfall, bullet, funnel, waffle, timeline, gauge }

/** Every chart of this group. */
export const businessCharts: readonly ChartDef[] = [waterfall, bullet, funnel, waffle, timeline, gauge]
