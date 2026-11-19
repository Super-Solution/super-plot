/** Every built-in chart type as a plain object. Import the ones you need and pass them to `registerChart`. */
import { bar } from './charts/bar.js'
import { areaChart, line } from './charts/series.js'
import { scatter } from './charts/scatter.js'
import { donut, pie } from './charts/pie.js'
import { histogram } from './charts/histogram.js'
import { box } from './charts/box.js'
import { heatmap } from './charts/heatmap.js'
import { radar } from './charts/radar.js'
import { treemap } from './charts/treemap.js'
import { sankey } from './charts/sankey.js'
import { waffle } from './charts/waffle.js'
import { beeswarm } from './charts/beeswarm.js'
import { bubbleMap, choropleth, columnMap, flowMap } from './charts/maps.js'
import type { ChartDef } from './registry.js'

export { bar, line, areaChart as area, scatter, pie, donut, histogram, box, heatmap, radar, treemap, sankey, waffle, beeswarm, choropleth, bubbleMap, columnMap, flowMap }

/** All of them, in catalogue order. */
export const allCharts: readonly ChartDef[] = [bar, line, areaChart, scatter, pie, donut, histogram, box, heatmap, radar, treemap, sankey, waffle, beeswarm, choropleth, bubbleMap, columnMap, flowMap]
