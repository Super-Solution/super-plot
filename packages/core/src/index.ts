// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * The whole of core: every built-in chart type and transform step registered, and every entry point re-exported.
 * For a smaller bundle import `./base` and register what you use (`./charts/basic` and the other groups,
 * `./transforms`).
 */
import { registerCharts } from './registry.js'
import { registerTransforms } from './transform.js'
import { allCharts } from './charts.js'
import { allTransforms } from './transforms.js'

registerCharts(allCharts)
registerTransforms(allTransforms)

export * from './base.js'
export * from './charts.js'
export * from './transforms.js'
export * from './canvas.js'
export * from './view.js'
