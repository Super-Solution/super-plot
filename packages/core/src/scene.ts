/**
 * The scene is the contract between a chart and a renderer: a flat, ordered, serialisable list of
 * marks in pixel space. SVG string, DOM mount, canvas and tests all consume the same thing.
 */

export type Role = 'background' | 'grid' | 'axis' | 'axis-label' | 'title' | 'legend' | 'data' | 'label' | 'annotation' | 'hit'

export interface Tip {
  title?: string
  rows: { label: string; value: string; color?: string }[]
}

export interface MarkBase {
  role: Role
  /** Series key this mark belongs to (drives highlight and legend toggling). */
  series?: string
  /** Hover content; the renderer decides how to show it. */
  tip?: Tip
  /** Accessible name for focusable data marks. */
  aria?: string
  /** Entry animation: grow along an axis, fade, or draw a line. */
  anim?: 'y' | 'x' | 'fade' | 'draw'
  /** Legend entry this mark toggles when clicked. */
  legendKey?: string
  /** Guide line shown while a `hit` mark is hovered. */
  guide?: { x1: number; y1: number; x2: number; y2: number }
  /** Points to highlight while a `hit` mark is hovered (one per series at the hovered x). */
  focus?: { x: number; y: number; color: string }[]
  /** Free-form payload handed to `onSelect`: the source row(s) of this mark. */
  datum?: unknown
  /** Texture drawn over the fill (`patterns: true`): index into the pattern set, one per series. */
  pattern?: number
  opacity?: number
  /** Clip to `scene.clips[clip]` (maps: the world outline and the plot area). */
  clip?: string
  /**
   * `geo`: part of a map's geography, also present in `scene.geo`. A 3D renderer draws `scene.geo` itself
   * and skips these; the SVG and canvas renderers draw them like any mark.
   */
  layer?: 'geo'
}

export interface RectMark extends MarkBase { type: 'rect'; x: number; y: number; w: number; h: number; r?: number | [number, number, number, number]; fill?: string; stroke?: string; strokeWidth?: number }
export interface PathMark extends MarkBase { type: 'path'; d: string; fill?: string; stroke?: string; strokeWidth?: number; dash?: string; /** Fill rule; `evenodd` cuts holes from region outlines. */ rule?: 'evenodd' }
export interface CircleMark extends MarkBase { type: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; strokeWidth?: number }
export interface LineMark extends MarkBase { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth?: number; dash?: string }
export interface TextMark extends MarkBase {
  type: 'text'
  x: number
  y: number
  text: string
  size: number
  fill: string
  weight?: number
  anchor?: 'start' | 'middle' | 'end'
  baseline?: 'alphabetic' | 'middle' | 'hanging'
  rotate?: number
}

export type Mark = RectMark | PathMark | CircleMark | LineMark | TextMark

export interface SeriesInfo { key: string; label: string; color: string; hidden: boolean }

export interface Scene {
  width: number
  height: number
  /** Resolved CSS colour of the surface behind the chart. */
  background: string
  /** Accessible title and long description (also what an agent reads). */
  title: string
  description: string
  marks: Mark[]
  series: SeriesInfo[]
  type: string
  /** Clip paths referenced by marks' `clip`. */
  clips?: Record<string, string>
  /** Maps only: the geography and data in longitude/latitude, for renderers that project it themselves (WebGL). */
  geo?: SceneGeo
  /** Charts on two axes: the plot rectangle and both scales, so a binding can map pixels back to data (zoom, brush). */
  axes?: SceneAxes
  /** Small multiples (`facet`): one entry per panel. */
  panels?: { key: string; plot: Rect }[]
}

export interface AxisInfo {
  kind: 'linear' | 'time' | 'band'
  /** Numbers for linear and time (epoch ms); the categories, in order, for band. */
  domain: [number, number] | string[]
  /** Pixel range: [left, right] or [bottom, top]. For band, [first band start, last band end]. */
  range: [number, number]
  /** The data column this axis shows, when there is one. */
  field?: string
  /**
   * `log`: a base-10 log axis (kind `linear`, positive domain in data units). Pixels are linear in log10 of the
   * value, so pixel-to-data maps and zoom must work in log space.
   */
  scale?: 'log'
}

export interface SceneAxes {
  plot: Rect
  x: AxisInfo
  y: AxisInfo
  /** What the spec allows the viewer to do (only where the axes support it). */
  zoom?: 'x' | 'xy'
  brush?: 'x' | 'xy'
}

export interface GeoRegionItem {
  /** Polygons of [outer, ...holes]; each ring is interleaved [lng, lat, ...], longitudes unwrapped. */
  polygons: Float64Array[][]
  fill: string
  stroke: string
  strokeWidth: number
  dashed?: boolean
  /** 0..1 of the view's height unit; 0 lies flat. */
  height: number
  /** Index of the scene mark that carries this item's tooltip and datum, or -1 (basemap). */
  mark: number
}
export interface GeoPointItem { lng: number; lat: number; r: number; fill: string; stroke: string; opacity: number; mark: number }
export interface GeoColumnItem { lng: number; lat: number; height: number; width: number; fill: string; mark: number }
export interface GeoArcItem { from: [number, number]; to: [number, number]; height: number; width: number; stroke: string; opacity: number; mark: number }

export interface SceneGeo {
  /** The resolved view (plain numbers: see `makeView`). */
  view: import('./geo/view.js').ViewParams
  /** The view's inputs: give them a new camera with `makeView` to move without recompiling. */
  input: import('./geo/view.js').ViewInput
  /** Globe only: the sea behind the regions. */
  sphere: { fill: string; stroke: string } | null
  /** Graticule stroke colour, or null. */
  graticule: string | null
  regions: GeoRegionItem[]
  points: GeoPointItem[]
  columns: GeoColumnItem[]
  arcs: GeoArcItem[]
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Rounded rectangle with independent corner radii as a path (SVG `rx` cannot do per-corner). */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: [number, number, number, number]): string {
  const [tl, tr, br, bl] = r.map(v => Math.max(0, Math.min(v, w / 2, h / 2))) as [number, number, number, number]
  const f = (v: number): string => String(Math.round(v * 100) / 100)
  return (
    `M${f(x + tl)} ${f(y)}H${f(x + w - tr)}` +
    (tr ? `A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}` : '') +
    `V${f(y + h - br)}` +
    (br ? `A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}` : '') +
    `H${f(x + bl)}` +
    (bl ? `A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}` : '') +
    `V${f(y + tl)}` +
    (tl ? `A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}` : '') +
    'Z'
  )
}
