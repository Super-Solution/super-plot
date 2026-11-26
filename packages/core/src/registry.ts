// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { Issue, FieldMap, ValidateCtx } from './schema.js'
import { CARTESIAN_FIELDS, COMMON_FIELDS } from './schema.js'
import type { ChartCtx } from './context.js'
import type { SeriesInfo } from './scene.js'
import type { RenderEnv } from './theme.js'

/**
 * A chart type is one object. New types plug in with `registerChart` and never touch the layout,
 * theme, SVG or binding code. The same definition feeds validation, JSON Schema, the reference
 * docs, the agent catalog and the gallery.
 */
export interface ChartDef {
  type: string
  /** Display name. */
  name: string
  /** One sentence: what this chart shows. */
  summary: string
  /** When to choose it (and when not to); written for an agent picking a chart. */
  useWhen: string
  /** Gets `xLabel`, `yLabel` and `annotations`. */
  cartesian: boolean
  /** Fields specific to this chart. */
  fields: FieldMap
  /** A complete, valid spec. Also used as test fixture and in the gallery. */
  example: Record<string, unknown>
  /** Cross-field checks after per-field validation. */
  check?(spec: Record<string, unknown>, ctx: ValidateCtx): void
  /**
   * What a reference (`resolveRef`) can name in this chart: which spec fields hold the columns `x` and `y` read,
   * and which one holds the series. Leave it out and only `key` works. See {@link RefShape}.
   */
  ref?: RefShape
  /**
   * A height (px) better than the width-based default (`defaultHeight`) for this spec at this width, or `undefined`
   * to keep the default. For a chart that needs more room when it is narrow (a calendar cut into rows). It must not
   * throw on a spec that has not been validated: the web binding asks before validation.
   */
  height?(spec: Record<string, any>, width: number): number | undefined
  /** Lay out and draw. Push marks onto `ctx.marks`; return the series for the legend. */
  compile(ctx: ChartCtx): { series: SeriesInfo[] }
  /**
   * Plain-language summary of what the data shows (alt text, agent-readable). Always English; dates are formatted
   * in `env.timeZone` (default UTC) so the text matches the drawing.
   */
  describe(spec: Record<string, any>, env: Pick<RenderEnv, 'locale' | 'timeZone'>): string
}

/**
 * The columns a reference reads, named by the spec fields that hold them (data, so the ports read it from
 * `fields.v1.json`). Every rule is in `resolveRef`'s doc comment.
 */
export interface RefShape {
  /** Fields whose columns `x` matches (a row matches when any of them does), e.g. `["x"]`, `["label"]`, `["from", "to"]`. */
  x?: readonly string[]
  /**
   * Fields `y` reads, the first one the spec sets: the value column(s) of each point. A list of several columns is
   * one series per column (wide form). With `yRow`, `y` matches the row on those columns instead (a heatmap's rows).
   */
  y?: readonly string[]
  yRow?: boolean
  /** More value fields, each column its own series (a bar chart's `line` and `yRight`). */
  extra?: readonly string[]
  /** The field naming the series column: `series` matches it. */
  series?: string
  /** The field whose column names the legend entry when there is no series field (a pie's slices). */
  legend?: string
  /** `x` matches a row whose `[start, end]` overlaps it (a timeline's bars). */
  span?: readonly [string, string]
}

const defs = new Map<string, ChartDef>()

export function registerChart(def: ChartDef): void {
  defs.set(def.type, def)
}

/** Register several chart types at once, e.g. a group: `registerCharts(basicCharts)` (`@supersolutions/super-plot-core/charts/basic`). */
export function registerCharts(list: readonly ChartDef[]): void {
  for (const d of list) registerChart(d)
}

export const getChart = (type: string): ChartDef | undefined => defs.get(type)
export const chartTypes = (): string[] => [...defs.keys()]

export function fieldsOf(def: ChartDef): FieldMap {
  return { type: { kind: 'string', required: true, desc: `Chart type: ${def.type}.` }, ...COMMON_FIELDS, ...(def.cartesian ? CARTESIAN_FIELDS : {}), ...def.fields }
}

export type { Issue }
