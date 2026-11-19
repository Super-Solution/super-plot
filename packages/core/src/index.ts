// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/** The whole of core with every built-in chart type registered. For a smaller bundle import `./base` and `./charts`. */
import { registerChart } from './registry.js'
import { allCharts } from './charts.js'

for (const def of allCharts) registerChart(def)

export * from './base.js'
export * from './charts.js'
