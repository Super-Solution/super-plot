// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { ChartCtx } from './context.js'
import { fieldsOf, getChart, type ChartDef } from './registry.js'
import type { AxisInfo, Mark, Rect, Scene, SceneAxes, SeriesInfo } from './scene.js'
import { escapeXml, renderSvg, svgKey, type SvgOptions } from './svg.js'
import { PlotSpecError, validatePlot } from './validate.js'
import type { Issue, Row } from './schema.js'
import { cssVar, resolveTheme, resolveVars, type RenderEnv, type Theme, type ThemeOption } from './theme.js'
import { estimateWidth, fit, type Measure } from './util/text.js'
import { clamp } from './util/num.js'
import { distinct, xKey } from './data.js'
import { fmtList, pointNotes } from './charts/shared.js'
import type { Camera } from './geo/camera.js'
import { CVD_MIN_DISTANCE, indistinctPairs, type Vision } from './util/cvd.js'
import { resolveStrings, type UiStringKey } from './strings.js'
import { renderTimeZone } from './util/time.js'

/**
 * A plugin sees every compiled scene before it is drawn and may return a changed one (add a mark, move a
 * label, drop the grid). Plugins run in order, in every renderer and on the server (`renderToSvg`). The web
 * binding also calls `afterDraw` with what it drew on (an SVG element or a 2D canvas context).
 */
export interface PlotPlugin<DrawTarget = unknown> {
  name: string
  afterCompile?(scene: Scene, info: { spec: Record<string, any> }): Scene | void
  afterDraw?(target: DrawTarget): void
}

export interface RenderOptions {
  /** Pixel width. Default 640. */
  width?: number
  /** Pixel height. Default: derived from the width and the chart type. */
  height?: number
  /** `'light'`, `'dark'`, `'auto'`, a registered theme name, or a Theme. */
  theme?: ThemeOption
  /** What `'auto'` resolves to; the web binding passes the OS preference. */
  prefersDark?: boolean
  /** BCP 47 locale for numbers and dates (month and weekday names come from `Intl`). Default `en`. */
  locale?: string
  /**
   * IANA time zone (`"Europe/London"`) in which time axes place their ticks (local midnights, months) and dates are
   * shown, in ticks, tooltips, `aria` text and the description. Default `UTC`. An unknown name is a `bad_time_zone`
   * warning and UTC is used. Data are instants either way: an ISO string without an offset is read as UTC.
   */
  timeZone?: string
  /** Overrides for the English UI strings core writes into the scene; keys and defaults in `DEFAULT_STRINGS`. */
  strings?: Partial<Record<UiStringKey, string>>
  /** Series keys to leave out (legend toggles). */
  hidden?: Iterable<string>
  /** Text measurer; the web binding passes a canvas-backed one. */
  measure?: Measure
  /**
   * Maps and 3D charts: overrides the spec's camera (the web binding passes the viewer's drag and zoom). A 3D
   * chart reads only `zoom`, `pitch` and `bearing`.
   */
  camera?: Partial<Camera>
  /** Zoom: axis ranges that override `xDomain` / `yDomain` (numbers; epoch ms on a time axis). */
  view?: { x?: [number, number]; y?: [number, number] }
  /** Called with each compiled scene; see {@link PlotPlugin}. */
  plugins?: readonly PlotPlugin<any>[]
}

export type CompileResult =
  | { ok: true; scene: Scene; issues: Issue[]; spec: Record<string, any> }
  | { ok: false; issues: Issue[] }

export const MAX_FACETS = 12

export function defaultHeight(type: string, width: number): number {
  const ratio = type === 'pie' || type === 'donut' ? 0.62 : type === 'radar' ? 0.85 : type === 'sunburst' || type === 'column-map' || type === 'flow-map' || type === 'scatter3d' || type === 'surface' ? 0.75 : type === 'calendar' ? 0.34 : 0.6
  return Math.round(clamp(width * ratio, 220, 520))
}

/** Validate and lay out a spec as a scene: the renderer-neutral list of marks. */
export function compilePlot(input: unknown, options: RenderOptions = {}): CompileResult {
  const v = validatePlot(input)
  if (!v.ok || !v.spec) return { ok: false, issues: v.issues }
  let spec = v.spec
  const def = getChart(spec.type)!
  const fields = fieldsOf(def)
  const theme = resolveTheme(options.theme, options.prefersDark)
  const locale = options.locale ?? 'en'
  const width = Math.round(clamp(options.width ?? 640, 120, 4000))
  const height = Math.round(clamp(options.height ?? defaultHeight(spec.type, width), 100, 4000))
  const issues = [...v.issues]
  const timeZone = renderTimeZone(options.timeZone, issues)
  const strings = resolveStrings(options.strings, issues)
  const env: RenderEnv = { theme, locale, timeZone, strings, measure: options.measure ?? estimateWidth, ...(options.camera ? { camera: options.camera } : {}) }
  const hidden = [...(options.hidden ?? [])]
  // The viewer's zoom replaces the fixed ranges (only on charts that have them).
  if (options.view && !spec.facet) {
    spec = { ...spec }
    if (options.view.x && 'xDomain' in fields) spec.xDomain = options.view.x
    if (options.view.y && 'yDomain' in fields) spec.yDomain = options.view.y
  }

  let marks: Mark[]
  let series: SeriesInfo[]
  let clips: Record<string, string> = {}
  let geo: Scene['geo']
  let view3d: Scene['view3d']
  let axes: SceneAxes | undefined
  let panels: Scene['panels']
  if (spec.facet) {
    const f = facet(def, spec, env, width, height, hidden, issues)
    ;({ marks, series, panels } = f)
  } else {
    const ctx = new ChartCtx(spec, env, width, height, hidden, issues)
    ;({ series } = def.compile(ctx))
    marks = ctx.marks
    clips = ctx.clips
    geo = ctx.geo
    view3d = ctx.view3d
    if (ctx.axes) axes = { ...ctx.axes, ...interaction(spec, def, ctx.axes, issues) }
  }
  if (spec.patterns === true) applyPatterns(marks, series)
  else checkColorVision(spec, series, marks, issues)

  const title = typeof spec.title === 'string' && spec.title ? spec.title : def.name
  let description = typeof spec.description === 'string' && spec.description ? spec.description : def.describe(spec, { locale, timeZone }) + pointNotes(spec)
  if (spec.facet && !(typeof spec.description === 'string' && spec.description) && panels) description += ` Split into ${panels.length} panels by ${spec.facet}: ${fmtList(panels.map(p => p.key))}.`
  let scene: Scene = {
    width,
    height,
    background: cssVar(theme, 'background'),
    title,
    description,
    marks,
    series,
    type: spec.type,
    ...(Object.keys(clips).length ? { clips } : {}),
    ...(geo ? { geo } : {}),
    ...(view3d ? { view3d } : {}),
    ...(axes ? { axes } : {}),
    ...(panels ? { panels } : {})
  }
  for (const p of options.plugins ?? []) {
    if (!p.afterCompile) continue
    try {
      scene = p.afterCompile(scene, { spec }) ?? scene
    } catch (e) {
      issues.push({ severity: 'warning', code: 'plugin_error', path: '', message: `Plugin "${p.name}" failed in afterCompile: ${e instanceof Error ? e.message : String(e)}. Its change was skipped.` })
    }
  }
  return { ok: true, scene, issues, spec }
}

/**
 * What the spec asks for and the axes can do: zoom needs continuous ranges the chart accepts, brush any axis. A
 * second value axis or a broken axis cannot be zoomed or brushed (a pixel would mean two values, or none): that part
 * of the request is refused with a `zoom_refused` / `brush_refused` warning and the rest is kept.
 */
function interaction(spec: Record<string, any>, def: ChartDef, axes: { x: AxisInfo; y: AxisInfo; y2?: AxisInfo }, issues: Issue[]): Pick<SceneAxes, 'zoom' | 'brush'> {
  const out: Pick<SceneAxes, 'zoom' | 'brush'> = {}
  const fields = fieldsOf(def)
  const why = (a: AxisInfo, side: 'x' | 'y'): string | null => a.breaks ? `the ${side} axis is broken (yBreak)` : side === 'y' && axes.y2 ? 'there is a second value axis on the right (yRight), and a vertical range would mean different values on each side' : null
  const refuse = (k: 'zoom' | 'brush', reason: string, kept: boolean): void => {
    issues.push({ severity: 'warning', code: `${k}_refused`, path: k, message: `${k === 'zoom' ? 'Zoom' : 'Brush'} ${kept ? 'along y is' : 'is'} refused: ${reason}.${kept ? ` ${k === 'zoom' ? 'Zoom' : 'Brush'} works along x only.` : ''}`, hint: 'Drop the break or the right axis to zoom and brush every axis, or keep this one to x.' })
  }
  const zoom = spec.zoom as string | undefined
  if (zoom === 'x' || zoom === 'xy') {
    const xOk = axes.x.kind !== 'band' && 'xDomain' in fields
    const yOk = axes.y.kind !== 'band' && 'yDomain' in fields
    const xNo = why(axes.x, 'x')
    const yNo = zoom === 'xy' && yOk ? why(axes.y, 'y') : null
    if (!xOk) issues.push({ severity: 'warning', code: 'zoom_unsupported', path: 'zoom', message: `A ${def.type} chart${axes.x.kind === 'band' ? ' with categories on x' : ''} cannot zoom; zoom was ignored.`, hint: 'Zoom works on scatter, line and area charts with a numeric or time x axis.' })
    else if (xNo) refuse('zoom', xNo, false)
    else {
      if (yNo) refuse('zoom', yNo, true)
      out.zoom = zoom === 'xy' && yOk && !yNo ? 'xy' : 'x'
    }
  }
  const brush = spec.brush as string | undefined
  if (brush === 'x' || brush === 'xy') {
    const xNo = why(axes.x, 'x')
    const yNo = brush === 'xy' && axes.y.kind !== 'band' && axes.x.kind !== 'band' ? why(axes.y, 'y') : null
    if (xNo) refuse('brush', xNo, false)
    else {
      if (yNo) refuse('brush', yNo, true)
      out.brush = brush === 'xy' && axes.y.kind !== 'band' && axes.x.kind !== 'band' && !yNo ? 'xy' : 'x'
    }
  }
  return out
}

// ---- colour vision ---------------------------------------------------------------------------

const VISION_NAME: Record<Vision, string> = { normal: 'normal vision', protanopia: 'protanopia', deuteranopia: 'deuteranopia', tritanopia: 'tritanopia' }

/**
 * Warn (`colors_indistinct`) when two neighbouring series, in legend order, are closer than
 * `CVD_MIN_DISTANCE` in OKLab x 100 under normal vision or simulated protanopia, deuteranopia or tritanopia
 * (see `util/cvd.ts`). Only pairs with at least one colour from the spec's `colors` are checked: the theme is
 * the host's choice, made once, and its `other` grey does sit close to some palette hues (see the notes), so
 * checking theme-only pairs would warn on charts nobody coloured. Only series that draw a data mark or a
 * legend entry count. Spec colours are read as written and skipped when they are `var(--x)` or a name the
 * check cannot resolve; a theme colour next to one is read through its fallback (`var(--sp-series-2,
 * #FF9800)` as #FF9800), so a host's CSS overrides are not seen. Not run with `patterns: true`: the textures
 * then carry identity.
 */
function checkColorVision(spec: Record<string, any>, series: SeriesInfo[], marks: Mark[], issues: Issue[]): void {
  if (series.length < 2) return
  const drawn = new Set<string>()
  for (const m of marks) if (m.series !== undefined && (m.role === 'data' || m.role === 'legend')) drawn.add(m.series)
  const used = series.filter(s => drawn.has(s.key))
  if (used.length < 2) return
  const own = spec.colors as Record<string, string> | undefined
  if (!own) return
  const mine = new Set<number>()
  const colors = used.map((s, i) => {
    if (!(Object.hasOwn(own, s.key) && own[s.key] === s.color)) return resolveVars(s.color)
    mine.add(i)
    return /^var\(/i.test(s.color.trim()) ? null : s.color
  })
  if (!mine.size) return
  const pairs = indistinctPairs(colors, CVD_MIN_DISTANCE, mine)
  if (!pairs.length) return
  const say = pairs.slice(0, 3).map(p => `"${used[p.index].label}" and "${used[p.index + 1].label}" (${p.min} under ${VISION_NAME[p.worst]}${p.worst === 'normal' ? '' : `, ${p.distances.normal} with normal vision`})`)
  issues.push({
    severity: 'warning', code: 'colors_indistinct', path: 'colors',
    message: `Neighbouring series look alike: ${say.join('; ')}${pairs.length > 3 ? `; and ${pairs.length - 3} more pairs` : ''}. Distances are OKLab x 100; under ${CVD_MIN_DISTANCE} is hard to tell apart.`,
    hint: 'Set `patterns: true`, render with the `accessible` theme, or pick colours that differ more in lightness.'
  })
}

// ---- patterns ----------------------------------------------------------------------------------

/** One texture per series, on filled data marks and their legend swatches. */
function applyPatterns(marks: Mark[], series: SeriesInfo[]): void {
  const index = new Map(series.map((s, i) => [s.key, i]))
  for (const m of marks) {
    if (m.series === undefined || (m.type !== 'rect' && m.type !== 'path')) continue
    if (!m.fill || m.fill === 'none' || m.fill === 'transparent') continue
    if (m.role !== 'data' && !(m.role === 'legend' && m.type === 'rect' && m.w <= 12)) continue
    const i = index.get(m.series)
    if (i !== undefined) m.pattern = i
  }
}

// ---- small multiples ---------------------------------------------------------------------------

function facet(def: ChartDef, spec: Record<string, any>, env: RenderEnv, width: number, height: number, hidden: string[], issues: Issue[]): { marks: Mark[]; series: SeriesInfo[]; panels: { key: string; plot: Rect }[] } {
  const col = spec.facet as string
  const rows = spec.data as Row[]
  const all = distinct(rows.map(r => xKey(r[col])))
  const keys = all.slice(0, MAX_FACETS)
  if (all.length > MAX_FACETS) issues.push({ severity: 'warning', code: 'too_many_facets', path: 'facet', message: `"${col}" has ${all.length} values; only the first ${MAX_FACETS} get a panel.`, hint: 'Filter with `transform` first, or facet by a coarser column.' })
  for (const k of ['zoom', 'brush'] as const) if (spec[k] && spec[k] !== 'none') issues.push({ severity: 'warning', code: `${k}_unsupported`, path: k, message: `${k} is not available on small multiples; it was ignored.` })
  const fields = fieldsOf(def)
  const theme: Theme = env.theme
  // The whole data set decides the series and their colours, so a series looks the same in every panel.
  const whole = new ChartCtx({ ...spec, facet: undefined }, env, width, height, hidden, [])
  const { series } = def.compile(whole)
  const colors: Record<string, string> = { ...Object.fromEntries(series.map(s => [s.key, s.color])), ...(spec.colors ?? {}) }

  const top = new ChartCtx(spec, env, width, height, hidden, issues)
  const area = top.frame({ series })
  const size = top.size
  const xTitle = spec.xLabel ?? (def.type === 'scatter' ? spec.x : def.type === 'histogram' ? spec.value : undefined)
  const yTitle = spec.yLabel ?? (def.type === 'scatter' || def.type === 'box' || def.type === 'violin' ? spec.y : undefined)
  // The right axis's title, in its series' colour as the whole chart draws it.
  const y2Title = whole.axes?.y2 && typeof spec.yRightLabel === 'string' && spec.yRightLabel ? spec.yRightLabel : undefined
  const inner: Rect = { x: area.x + (yTitle ? size + 8 : 0), y: area.y, w: area.w - (yTitle ? size + 8 : 0) - (y2Title ? size + 8 : 0), h: area.h - (xTitle ? size + 8 : 0) }
  const n = keys.length
  const cols = clamp(Math.round(Math.sqrt((n * inner.w) / Math.max(1, inner.h) / 1.4)), 1, n)
  const nrows = Math.ceil(n / cols)
  const gapX = 8
  const gapY = 6
  const cw = (inner.w - gapX * (cols - 1)) / cols
  const ch = (inner.h - gapY * (nrows - 1)) / nrows
  const head = size + 6
  // A panel's own frame adds its padding on each side (12 px when it is narrow, as any chart under 420 px).
  const P = cw + 24 < 420 ? 12 : 16
  if (cw < 120 || ch - head < 90) issues.push({ severity: 'warning', code: 'facet_cramped', path: 'facet', message: `${n} panels in ${Math.round(width)}x${Math.round(height)} px leaves each about ${Math.round(cw)}x${Math.round(ch)} px.`, hint: 'Make the chart larger, or facet by a column with fewer values.' })

  const sub = (key: string, extra: Record<string, unknown>): Record<string, any> => ({
    ...spec,
    data: rows.filter(r => xKey(r[col]) === key),
    facet: undefined, title: undefined, subtitle: undefined, source: undefined, description: undefined,
    legend: 'none', xLabel: '', yLabel: '', yRightLabel: '', colors,
    ...extra
  })
  const place = (i: number): { x: number; y: number } => ({ x: inner.x + (i % cols) * (cw + gapX) - P, y: inner.y + Math.floor(i / cols) * (ch + gapY) + head - P })
  const run = (extra: Record<string, unknown>): { ctxs: ChartCtx[]; local: Issue[] } => {
    const local: Issue[] = []
    const ctxs = keys.map((k, i) => {
      // The panel's own frame adds `pad` on each side; the origin takes it back so panels fill their cells.
      const ctx = new ChartCtx(sub(k, extra), env, cw + P * 2, ch - head + P * 2, hidden, local, place(i))
      def.compile(ctx)
      return ctx
    })
    return { ctxs, local }
  }
  // Pass 1 finds each panel's ranges; pass 2 draws every panel with their union, so the panels compare.
  let { ctxs, local } = run({})
  const shared: Record<string, unknown> = {}
  const union = (pick: (c: ChartCtx) => AxisInfo | undefined): [number, number] | null => {
    let lo = Infinity
    let hi = -Infinity
    for (const c of ctxs) {
      const a = pick(c)
      if (!a || a.kind === 'band') return null
      const [d0, d1] = a.domain as [number, number]
      lo = Math.min(lo, d0, d1)
      hi = Math.max(hi, d0, d1)
    }
    return Number.isFinite(lo) && hi > lo ? [lo, hi] : null
  }
  if ('xDomain' in fields && !spec.xDomain) {
    const u = union(c => c.axes?.x)
    if (u) shared.xDomain = u
  }
  if ('yDomain' in fields && !spec.yDomain) {
    // `yDomain` is the value axis, which a horizontal chart draws along x.
    const u = union(c => (spec.orientation === 'horizontal' ? c.axes?.x : c.axes?.y))
    if (u) shared.yDomain = u
  }
  // A second value axis (`yRight`) is shared across panels too, so each side compares between panels.
  if ('rightDomain' in fields && spec.yRight !== undefined && !spec.rightDomain && ctxs.some(c => c.axes?.y2)) {
    const u = union(c => c.axes?.y2)
    if (u) shared.rightDomain = u
  }
  if (Object.keys(shared).length) ({ ctxs, local } = run(shared))
  const seen = new Set(issues.map(i => `${i.code}|${i.path}`))
  for (const i of local) {
    const k = `${i.code}|${i.path}`
    if (!seen.has(k)) {
      seen.add(k)
      issues.push(i)
    }
  }

  const marks: Mark[] = [...top.marks]
  const panels: { key: string; plot: Rect }[] = []
  ctxs.forEach((c, i) => {
    const o = place(i)
    const x = o.x + P
    const y = o.y + P - head
    marks.push(top.text(x, y, fit(`${keys[i]}`, cw, size, env.measure, 600), { role: 'title', baseline: 'hanging', weight: 600, fill: top.c('text') }))
    marks.push(...c.marks)
    panels.push({ key: keys[i], plot: c.axes?.plot ?? { x, y: y + head, w: cw, h: ch - head } })
  })
  const muted = cssVar(theme, 'text-muted')
  if (xTitle) marks.push(top.text(inner.x + inner.w / 2, area.y + area.h - size, String(xTitle), { anchor: 'middle', baseline: 'hanging', fill: muted, weight: 500 }))
  if (yTitle) marks.push(top.text(area.x + size * 0.6, inner.y + inner.h / 2, String(yTitle), { anchor: 'middle', baseline: 'middle', rotate: -90, fill: whole.axes?.y2 ? whole.axes.y.ink ?? muted : muted, weight: 500 }))
  if (y2Title) marks.push(top.text(area.x + area.w - size * 0.6, inner.y + inner.h / 2, y2Title, { anchor: 'middle', baseline: 'middle', rotate: 90, fill: whole.axes?.y2?.ink ?? muted, weight: 500 }))
  return { marks, series, panels }
}

/** Throwing variant of {@link compilePlot}. */
export function compileOrThrow(input: unknown, options?: RenderOptions): Scene {
  const r = compilePlot(input, options)
  if (!r.ok) throw new PlotSpecError(r.issues)
  return r.scene
}

export interface HydrateOptions {
  /**
   * Write the markup the web binding draws itself (hover hooks, CSS variables, `var(--sp-font)`), stamped with
   * `data-sp-key` (a hash of that markup) and `data-sp-id` (its id prefix). A `SuperPlot` mounted on a host
   * whose first child is this `<svg>` keeps it instead of drawing again when its own markup for the same spec,
   * size, theme and locale hashes the same; otherwise it redraws. Ids default to a prefix derived from the
   * content, so different charts on one page do not share ids.
   */
  hydrate?: boolean
}

/**
 * Spec to standalone SVG string: no DOM, runs in Node, a worker or an agent tool.
 * Colours are resolved to plain values unless `resolveVars: false` (or `hydrate: true`).
 */
export function renderToSvg(input: unknown, options: RenderOptions & SvgOptions & HydrateOptions = {}): string {
  const scene = compileOrThrow(input, options)
  const theme: Theme = resolveTheme(options.theme, options.prefersDark)
  if (options.hydrate) {
    const font = options.font ?? `var(--sp-font, ${theme.font})`
    const draw = (idPrefix: string): string => renderSvg(scene, { interactive: true, idPrefix, font })
    const id = options.idPrefix ?? `sp${svgKey(draw('sp'))}`
    const svg = draw(id)
    // `display:block` (outside the hashed markup) so the page has no inline gap below the chart before the binding loads.
    return svg.replace('<svg ', `<svg data-sp-key="${svgKey(svg)}" data-sp-id="${escapeXml(id)}" `).replace(' style="font-family:', ' style="display:block;font-family:')
  }
  const font = options.font ?? (options.resolveVars === false ? `var(--sp-font, ${theme.font})` : theme.font)
  return renderSvg(scene, { resolveVars: true, ...options, font })
}
