import * as core from '@supersolutions/super-plot-core'
import { SuperPlot } from './plot.js'
import { defineSuperPlot } from './element.js'

/**
 * Bundle for pages without a bundler: `<script src="super-plot.global.js">` sets `window.SuperPlot`
 * (core included) and registers `<super-plot>`.
 */
const api = { ...core, SuperPlot, defineSuperPlot }
;(globalThis as Record<string, unknown>).SuperPlot = api
if (typeof customElements !== 'undefined') defineSuperPlot()
export default api
