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
  /** Lay out and draw. Push marks onto `ctx.marks`; return the series for the legend. */
  compile(ctx: ChartCtx): { series: SeriesInfo[] }
  /**
   * Plain-language summary of what the data shows (alt text, agent-readable). Always English; dates are formatted
   * in `env.timeZone` (default UTC) so the text matches the drawing.
   */
  describe(spec: Record<string, any>, env: Pick<RenderEnv, 'locale' | 'timeZone'>): string
}

const defs = new Map<string, ChartDef>()

export function registerChart(def: ChartDef): void {
  defs.set(def.type, def)
}

export const getChart = (type: string): ChartDef | undefined => defs.get(type)
export const chartTypes = (): string[] => [...defs.keys()]

export function fieldsOf(def: ChartDef): FieldMap {
  return { type: { kind: 'string', required: true, desc: `Chart type: ${def.type}.` }, ...COMMON_FIELDS, ...(def.cartesian ? CARTESIAN_FIELDS : {}), ...def.fields }
}

export type { Issue }
