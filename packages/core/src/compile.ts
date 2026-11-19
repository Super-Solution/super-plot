import { ChartCtx } from './context.js'
import { getChart } from './registry.js'
import type { Scene } from './scene.js'
import { renderSvg, type SvgOptions } from './svg.js'
import { PlotSpecError, validatePlot } from './validate.js'
import type { Issue } from './schema.js'
import { cssVar, resolveTheme, type Theme, type ThemeOption } from './theme.js'
import { estimateWidth, type Measure } from './util/text.js'
import { clamp } from './util/num.js'

export interface RenderOptions {
  /** Pixel width. Default 640. */
  width?: number
  /** Pixel height. Default: derived from the width and the chart type. */
  height?: number
  /** `'light'`, `'dark'`, `'auto'`, a registered theme name, or a Theme. */
  theme?: ThemeOption
  /** What `'auto'` resolves to; the web binding passes the OS preference. */
  prefersDark?: boolean
  /** BCP 47 locale for numbers and dates. Default `en`. */
  locale?: string
  /** Series keys to leave out (legend toggles). */
  hidden?: Iterable<string>
  /** Text measurer; the web binding passes a canvas-backed one. */
  measure?: Measure
}

export type CompileResult =
  | { ok: true; scene: Scene; issues: Issue[]; spec: Record<string, any> }
  | { ok: false; issues: Issue[] }

export function defaultHeight(type: string, width: number): number {
  const ratio = type === 'pie' || type === 'donut' ? 0.62 : type === 'radar' ? 0.85 : 0.6
  return Math.round(clamp(width * ratio, 220, 520))
}

/** Validate and lay out a spec as a scene: the renderer-neutral list of marks. */
export function compilePlot(input: unknown, options: RenderOptions = {}): CompileResult {
  const v = validatePlot(input)
  if (!v.ok || !v.spec) return { ok: false, issues: v.issues }
  const spec = v.spec
  const def = getChart(spec.type)!
  const theme = resolveTheme(options.theme, options.prefersDark)
  const locale = options.locale ?? 'en'
  const width = Math.round(clamp(options.width ?? 640, 120, 4000))
  const height = Math.round(clamp(options.height ?? defaultHeight(spec.type, width), 100, 4000))
  const issues = [...v.issues]
  const ctx = new ChartCtx(spec, { theme, locale, measure: options.measure ?? estimateWidth }, width, height, options.hidden ?? [], issues)
  const { series } = def.compile(ctx)
  const title = typeof spec.title === 'string' && spec.title ? spec.title : def.name
  const description = typeof spec.description === 'string' && spec.description ? spec.description : def.describe(spec, { locale })
  const scene: Scene = {
    width,
    height,
    background: cssVar(theme, 'background'),
    title,
    description,
    marks: ctx.marks,
    series,
    type: spec.type
  }
  return { ok: true, scene, issues, spec }
}

/** Throwing variant of {@link compilePlot}. */
export function compileOrThrow(input: unknown, options?: RenderOptions): Scene {
  const r = compilePlot(input, options)
  if (!r.ok) throw new PlotSpecError(r.issues)
  return r.scene
}

/**
 * Spec to standalone SVG string: no DOM, runs in Node, a worker or an agent tool.
 * Colours are resolved to plain values unless `resolveVars: false`.
 */
export function renderToSvg(input: unknown, options: RenderOptions & SvgOptions = {}): string {
  const scene = compileOrThrow(input, options)
  const theme: Theme = resolveTheme(options.theme, options.prefersDark)
  const font = options.font ?? (options.resolveVars === false ? `var(--sp-font, ${theme.font})` : theme.font)
  return renderSvg(scene, { resolveVars: true, ...options, font })
}
