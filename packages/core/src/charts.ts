// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/** Every built-in chart type as a plain object. Import the ones you need and pass them to `registerChart`. */
import { bar } from './charts/bar.js'
import { areaChart, line } from './charts/series.js'
import { scatter } from './charts/scatter.js'
import { donut, pie } from './charts/pie.js'
import { histogram } from './charts/histogram.js'
import { box } from './charts/box.js'
import { violin } from './charts/violin.js'
import { calendar } from './charts/calendar.js'
import { sunburst } from './charts/sunburst.js'
import { parallel } from './charts/parallel.js'
import { heatmap } from './charts/heatmap.js'
import { radar } from './charts/radar.js'
import { treemap } from './charts/treemap.js'
import { sankey } from './charts/sankey.js'
import { waterfall } from './charts/waterfall.js'
import { funnel } from './charts/funnel.js'
import { bullet } from './charts/bullet.js'
import { bump } from './charts/bump.js'
import { waffle } from './charts/waffle.js'
import { beeswarm } from './charts/beeswarm.js'
import { timeline } from './charts/timeline.js'
import { gauge } from './charts/gauge.js'
import { wordcloud } from './charts/wordcloud.js'
import { bubbleMap, choropleth, columnMap, flowMap } from './charts/maps.js'
import { scatter3d, surface } from './charts/plot3d.js'
import type { ChartDef } from './registry.js'

export { bar, line, areaChart as area, scatter, pie, donut, histogram, box, violin, heatmap, calendar, waterfall, bullet, bump, timeline, radar, treemap, sunburst, sankey, parallel, funnel, waffle, beeswarm, gauge, wordcloud, scatter3d, surface, choropleth, bubbleMap, columnMap, flowMap }

/** All of them, in catalogue order. */
export const allCharts: readonly ChartDef[] = [bar, line, areaChart, scatter, pie, donut, histogram, box, violin, heatmap, calendar, waterfall, bullet, bump, timeline, radar, treemap, sunburst, sankey, parallel, funnel, waffle, beeswarm, gauge, wordcloud, scatter3d, surface, choropleth, bubbleMap, columnMap, flowMap]
