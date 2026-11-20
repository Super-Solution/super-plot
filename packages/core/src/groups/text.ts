// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * `@supersolutions/super-plot-core/charts/text`: the word cloud.
 * Register them with `registerCharts(textCharts)` (from `/base`), or pick single ones.
 */
import { wordcloud } from '../charts/wordcloud.js'
import type { ChartDef } from '../registry.js'

export { wordcloud }

/** Every chart of this group. */
export const textCharts: readonly ChartDef[] = [wordcloud]
