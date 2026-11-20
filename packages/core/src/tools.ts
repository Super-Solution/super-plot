// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// The tools describe every chart type, so they register them all.
import './index.js'
import { chartCatalog, plotJsonSchema } from './catalog.js'
import { describePlot } from './describe.js'
import { compilePlot } from './compile.js'
import { renderSvg } from './svg.js'
import { validatePlot } from './validate.js'
import { resolveTheme } from './theme.js'
import { listGeographies } from './geo/geography.js'

/**
 * Framework-neutral tool descriptors an agent runtime can register as-is (MCP, super-chat's tool
 * registry, function calling). All are read-only: they compute, they never touch the host.
 */
export interface PlotTool {
  name: string
  description: string
  /** Matches super-chat's capability presets: `read` tools are offered to every preset. */
  authority: 'read'
  inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): unknown
}

const spec = { type: 'object', description: 'A Super Plot spec: {type, data, ...encodings}. Send raw rows and let `transform` filter, bucket by time and aggregate them (no need to pre-compute). `facet` splits one chart into small multiples. See plot_catalog.' }

export const plotTools: PlotTool[] = [
  {
    name: 'plot_catalog',
    description: 'List the chart types with when to use each, every field they accept, and a complete example spec. Call this first when unsure which chart or fields to use.',
    authority: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => chartCatalog()
  },
  {
    name: 'plot_schema',
    description: 'The JSON Schema for a plot spec.',
    authority: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => plotJsonSchema()
  },
  {
    name: 'plot_validate',
    description: 'Check a plot spec without drawing it. Returns every problem at once with a stable code, a path and a hint for the fix. Warnings do not block rendering.',
    authority: 'read',
    inputSchema: { type: 'object', properties: { spec }, required: ['spec'], additionalProperties: false },
    run: a => {
      const r = validatePlot(a.spec)
      return { ok: r.ok, issues: r.issues }
    }
  },
  {
    name: 'plot_describe',
    description: 'Describe what a chart shows in words (headline numbers, extremes, shares). Use it to read a chart you built, or as alt text.',
    authority: 'read',
    inputSchema: { type: 'object', properties: { spec, locale: { type: 'string' } }, required: ['spec'], additionalProperties: false },
    run: a => describePlot(a.spec, { locale: typeof a.locale === 'string' ? a.locale : undefined })
  },
  {
    name: 'plot_geographies',
    description: 'List the map boundaries the host registered (Super Plot ships none): each name with its region count and sample region keys and names. Use a name as `geo` in a map spec and region keys or names in the region column.',
    authority: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => listGeographies()
  },
  {
    name: 'plot_render_svg',
    description: 'Render a plot spec to a standalone SVG string (colours resolved, no scripts). Returns the SVG plus the text description and any warnings.',
    authority: 'read',
    inputSchema: {
      type: 'object',
      properties: { spec, width: { type: 'integer', minimum: 120, maximum: 4000 }, height: { type: 'integer', minimum: 100, maximum: 4000 }, theme: { enum: ['light', 'dark'] } },
      required: ['spec'], additionalProperties: false
    },
    run: a => {
      const theme = a.theme === 'dark' ? 'dark' : 'light'
      const r = compilePlot(a.spec, { width: typeof a.width === 'number' ? a.width : undefined, height: typeof a.height === 'number' ? a.height : undefined, theme })
      if (!r.ok) return { ok: false, issues: r.issues }
      return { ok: true, svg: renderSvg(r.scene, { resolveVars: true, font: resolveTheme(theme).font }), description: r.scene.description, issues: r.issues }
    }
  }
]

export const getPlotTool = (name: string): PlotTool | undefined => plotTools.find(t => t.name === name)
