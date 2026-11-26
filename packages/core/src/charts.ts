// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Every built-in chart type as a plain object. Import the ones you need and pass them to `registerChart`, or
 * register a whole group from `/charts/basic`, `/charts/business`, `/charts/stats`, `/charts/maps`,
 * `/charts/hierarchy`, `/charts/3d` or `/charts/text` with `registerCharts`.
 */
import { bar, line, area, scatter, pie, donut, histogram, box, heatmap, basicCharts } from './groups/basic.js'
import { waterfall, bullet, funnel, waffle, timeline, gauge, businessCharts } from './groups/business.js'
import { violin, beeswarm, parallel, radar, bump, calendar, statsCharts } from './groups/stats.js'
import { choropleth, bubbleMap, columnMap, flowMap, mapCharts } from './groups/maps.js'
import { treemap, sunburst, sankey, chord, hierarchyCharts } from './groups/hierarchy.js'
import { scatter3d, surface, charts3d } from './groups/3d.js'
import { wordcloud, textCharts } from './groups/text.js'
import type { ChartDef } from './registry.js'

export { bar, line, area, scatter, pie, donut, histogram, box, violin, heatmap, calendar, waterfall, bullet, bump, timeline, radar, treemap, sunburst, sankey, chord, parallel, funnel, waffle, beeswarm, gauge, wordcloud, scatter3d, surface, choropleth, bubbleMap, columnMap, flowMap }
export { basicCharts, businessCharts, statsCharts, mapCharts, hierarchyCharts, charts3d, textCharts }

/** All of them, in catalogue order. */
export const allCharts: readonly ChartDef[] = [bar, line, area, scatter, pie, donut, histogram, box, violin, heatmap, calendar, waterfall, bullet, bump, timeline, radar, treemap, sunburst, sankey, chord, parallel, funnel, waffle, beeswarm, gauge, wordcloud, scatter3d, surface, choropleth, bubbleMap, columnMap, flowMap]

/** The groups by subpath name (`/charts/<name>`): each chart is in exactly one. */
export const chartGroups: Readonly<Record<'basic' | 'business' | 'stats' | 'maps' | 'hierarchy' | '3d' | 'text', readonly ChartDef[]>> = {
  basic: basicCharts, business: businessCharts, stats: statsCharts, maps: mapCharts, hierarchy: hierarchyCharts, '3d': charts3d, text: textCharts
}
