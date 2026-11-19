// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import {
  compilePlot, renderSvg, resolveTheme, estimateWidth, defaultHeight, dataMarkCount, clampCamera, plotTable, plotCsv, svgKey, cssVar,
  resolveStrings, fillString, type UiStringKey, type UiStrings,
  type AxisInfo, type Camera, type Issue, type Mark, type Measure, type PlotPlugin, type RenderOptions, type Scene, type Theme, type Tip
} from '@supersolutions/super-plot-core/base'
import { CanvasLayer, markCenter, nearestMark } from './canvas.js'
import { NAV_HEIGHT, navigable } from './navigable.js'
import type * as Gl from './gl/index.js'
import type * as MapCtl from './map-control.js'
import type * as Nav from './navigator.js'
import type * as Tools from './toolbar.js'
import { AxisControl, type BrushSelection, type ZoomRange } from './interact.js'
import { audioContextOf, idleController, playNotes, sonifyNotes, type SonifyController, type SonifyOptions } from './sound.js'
import { ensureStyles } from './styles.js'
import { groupOf, joinGroup, leaveGroup, syncConf, syncTarget, xValueOf, type SyncConf, type SyncOptions, type SyncValue } from './sync.js'

export type { AxisPick, AxisRange, BrushSelection, ZoomRange } from './interact.js'
export type { SyncOptions } from './sync.js'
export type { Note, SonifyController, SonifyOptions, SonifyPlan } from './sound.js'

/** What a tooltip shows: a title and label/value rows (the mark's `tip`). */
export type TipContent = Tip

/** Toolbar buttons, in the order given. */
export type ToolbarItem = 'png' | 'svg' | 'csv' | 'table' | 'reset' | 'sound'
const TOOLBAR_ITEMS: readonly ToolbarItem[] = ['png', 'svg', 'csv', 'table', 'reset', 'sound']
/** What `toolbar: true` shows ('reset' only on a chart that can zoom). */
const TOOLBAR_DEFAULT: readonly ToolbarItem[] = ['png', 'svg', 'csv', 'table', 'reset']

/** A download name from a chart title: no path or control characters, at most 80 characters, `chart` when empty. */
export function fileNameOf(title: unknown, ext: string): string {
  const base = typeof title === 'string'
    ? title.normalize('NFKC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 80).replace(/^[.-]+|[.-]+$/g, '')
    : ''
  return `${base || 'chart'}.${ext}`
}

export interface SelectEvent {
  /** What the mark carries: the category, series and value (or the bin, slice, cell). */
  datum: unknown
  series?: string
  tip?: Tip
}

/** What a plugin's `afterDraw` gets: the scene and the surface it was drawn on. */
export interface DrawTarget {
  scene: Scene
  renderer: 'svg' | 'canvas' | 'webgl'
  /** The chart's `<svg>` (SVG renderer). */
  svg?: SVGSVGElement
  /** The topmost 2D context, scaled to scene pixels (canvas and WebGL renderers). */
  ctx?: CanvasRenderingContext2D
}

/** After every draw: what drew it and how long compile plus draw took. */
export interface RenderEvent {
  renderer: 'svg' | 'canvas' | 'webgl'
  ms: number
  scene: Scene
}

export interface SuperPlotOptions extends Omit<RenderOptions, 'hidden' | 'measure' | 'view' | 'plugins'> {
  /** Play the entrance animation (skipped under `prefers-reduced-motion`). Default true. */
  animate?: boolean
  /** Show the hover tooltip unless the spec says `tooltip: false`. Default true. */
  tooltip?: boolean
  /** A mark was clicked or activated with Enter/Space. */
  onSelect?: (e: SelectEvent) => void
  /** Validation or layout issues for the current spec (also called with `[]` once it is clean). */
  onIssues?: (issues: Issue[]) => void
  /** The viewer toggled a series in the legend. */
  onHiddenChange?: (hidden: string[]) => void
  /** Series keys to start hidden. */
  hidden?: string[]
  /**
   * `svg` keeps every mark a DOM element (best for accessibility and styling), `canvas` draws pixels (fast for
   * tens of thousands of marks), `webgl` draws dots and maps on the GPU (falls back to canvas when the browser
   * cannot). `auto` (default) uses canvas above `canvasAbove` data marks, and WebGL on a hardware GPU above
   * `webglAbove` data marks or for a 3D map (globe, tilt, columns, arcs, raised regions).
   */
  renderer?: 'auto' | 'svg' | 'canvas' | 'webgl'
  /** Data mark count above which `auto` switches to canvas. Default 4000. */
  canvasAbove?: number
  /** Data mark count above which `auto` switches to WebGL (hardware GPUs only). Default 20000. */
  webglAbove?: number
  /** Maps: let the viewer drag (pan, or turn the globe), Shift-drag (tilt and rotate), Ctrl/⌘-scroll or pinch (zoom) and use the keyboard. Default true. */
  interactive?: boolean
  /** Maps: the viewer moved the camera (once per gesture, when it ends). */
  onCameraChange?: (camera: Camera) => void
  /** The pointer or keyboard moved onto a mark with data (null: off it). */
  onHover?: (e: SelectEvent | null) => void
  /** The chart was drawn (first draw, resize, new data, theme). */
  onRender?: (e: RenderEvent) => void
  /** The viewer zoomed or panned (`zoom` in the spec), once per gesture; null when back to the full range. */
  onZoom?: (zoom: ZoomRange | null) => void
  /** The viewer brushed a range (`brush` in the spec); null when cleared. `sel.filters` drop into another chart's `transform`. */
  onBrush?: (sel: BrushSelection | null) => void
  /** Extensions: `afterCompile` can change the scene, `afterDraw` can draw on what was drawn. A throwing plugin becomes a warning. */
  plugins?: readonly PlotPlugin<DrawTarget>[]
  /**
   * A `<table>` of the data the chart shows (after `transform`, up to 1,000 rows), next to the chart: `true` for
   * screen readers only, `'visible'` for everyone. Default false.
   */
  dataTable?: boolean | 'visible'
  /**
   * Link plots that share a key (a page-level group): hovering an x value shows the guide and tooltip at the
   * nearest x in the others, zooming x zooms theirs, and with `brush: true` brushing mirrors the x range. A
   * string is the key with hover and zoom on and brush off. Plots whose x axis is of another kind are skipped.
   */
  sync?: string | SyncOptions
  /**
   * Replace the tooltip's content: a string is shown as text (never parsed as HTML), a Node is inserted as is
   * (you built it, you own what is in it), null or undefined keeps the default. Used for pointer and keyboard
   * tooltips, on SVG and canvas. A function that throws falls back to the default (and reports a warning once).
   */
  tooltipFormat?: (tip: TipContent, e: SelectEvent) => string | Node | null | undefined
  /**
   * A row of buttons in the chart's top right corner, shown on hover, keyboard focus and touch screens, never
   * printed: `true` for PNG, SVG, CSV, the data table and (on a chart with `zoom`) reset; or a list to choose
   * and order them, `'sound'` included. Default false.
   */
  toolbar?: boolean | readonly ToolbarItem[]
  /**
   * An overview strip under the chart (a range slider) for a chart with `zoom` on a continuous x (line, area,
   * scatter): the whole x range drawn small, with a window over what is on screen. Drag the window to pan, its
   * edges to zoom, or use the arrow keys on them (they are sliders). It drives the same zoom as the wheel and
   * `setZoom`, so `onZoom` and sync groups follow it. Default false.
   */
  navigator?: boolean
  /**
   * Drill-down on treemap and sunburst: clicking (or Enter on) a group shows only that group, the breadcrumb
   * at the top goes back up, and Escape goes up one level. The spec you passed is not changed (this plot keeps
   * its own `focus` until the next `setSpec`). Default: on when the spec has more than one level (a sunburst
   * `path` of two or more columns, a treemap with `group`).
   */
  drill?: boolean
  /** The viewer drilled down or up (`drill`): the `focus` path now shown ([] for the whole tree). */
  onDrill?: (path: string[]) => void
  /**
   * After `appendRows`, say in a polite live region how many points arrived and the latest one ("3 new points;
   * latest 14:05, Revenue 1.2k"), at most once every 5 seconds. Default (undefined): only while keyboard focus
   * is in the chart or the `dataTable` option is on; true: always; false: never.
   */
  announce?: boolean
  /**
   * When the page is printed, draw a chart in a built-in dark theme (`dark`, `accessible-dark`, or `auto` on a
   * dark screen) in its light counterpart, so dark backgrounds do not waste ink. Default true.
   */
  printLight?: boolean
}

const NAV_REFUSED: Issue = { severity: 'warning', code: 'navigator_unsupported', path: '', message: 'The navigator needs `zoom` on a line, area or scatter chart with a numeric or time x axis and no facets; it was left out.', hint: 'Add zoom: "x" to the spec, or drop the navigator option.' }

/** Pause between two live-data announcements, in ms. */
const ANNOUNCE_EVERY = 5000
/** The light theme printed instead of a built-in dark one. */
const PRINT_LIGHT: Record<string, string> = { dark: 'light', 'accessible-dark': 'accessible' }
/** Coarse pointers (touch, pen): a tap this close to a mark (scene px) picks it, so targets are 24 px or more. */
const TOUCH_SLOP = 12

let uid = 0

/** Code a page only pays for when a plot uses it: its own chunk, fetched the first time a plot needs it. */
interface Chunk<T> {
  /** The module, once loaded. */
  readonly mod: T | null
  load(): Promise<T>
}
function chunk<T>(fetch: () => Promise<T>): Chunk<T> {
  let mod: T | null = null
  let loading: Promise<T> | null = null
  return {
    get mod() { return mod },
    // A failed fetch (a network error) is tried again the next time a plot asks.
    load: () => (loading ??= fetch().then(m => (mod = m), e => { loading = null; throw e }))
  }
}
const glChunk = chunk<typeof Gl>(() => import('./gl/index.js'))
const navChunk = chunk<typeof Nav>(() => import('./navigator.js'))
const toolChunk = chunk<typeof Tools>(() => import('./toolbar.js'))
const mapChunk = chunk<typeof MapCtl>(() => import('./map-control.js'))
let warnedGl = false

/** What identifies "the same map" across setSpec: chart type and geography (a name, or inline). */
const mapKeyOf = (spec: unknown): string => {
  const s = spec as { type?: unknown; geo?: unknown } | null
  return `${String(s?.type)}|${typeof s?.geo === 'string' ? s.geo : s?.geo ? 'inline' : ''}`
}

/** What identifies "the same hierarchy" for drill-down: a new one drops the viewer's focus. */
const drillKeyOf = (spec: unknown): string => {
  const s = spec as Record<string, unknown> | null
  return JSON.stringify([s?.type, s?.path, s?.group, s?.label, s?.focus])
}

/** An x value of a row as the axis kind reads it (epoch ms on a time axis), or null. */
function axisValue(kind: AxisInfo['kind'], v: unknown): number | string | null {
  if (v === null || v === undefined || v === '') return null
  if (kind === 'band') return String(v)
  const n = typeof v === 'number' ? v : kind === 'time' ? (v instanceof Date ? v.getTime() : Date.parse(String(v))) : Number(v)
  return Number.isFinite(n) ? n : null
}

/** What identifies "the same chart" for zoom and brush: type and the columns on the axes. */
const axisKeyOf = (spec: unknown): string => {
  const s = spec as Record<string, unknown> | null
  return JSON.stringify([s?.type, s?.x, s?.y, s?.facet, s?.orientation])
}

/** A map the GPU draws better than SVG: anything with depth. */
const isDeepMap = (s: Scene): boolean => {
  const g = s.geo
  return !!g && (g.view.kind === 'globe' || g.view.camera.pitch > 0 || g.columns.length > 0 || g.arcs.length > 0 || g.regions.some(r => r.height > 0))
}

/**
 * Mounts a plot into an element. It owns one `<div>` inside the host, resizes with it, shows a
 * tooltip, highlights on hover, toggles series from the legend and cleans up in `dispose()`.
 * Create it in the browser (constructors touch the DOM); for the server use `renderToSvg`.
 */
export class SuperPlot {
  private root: HTMLDivElement
  private tip: HTMLDivElement
  private ro: ResizeObserver | null = null
  private mq: MediaQueryList | null = null
  private scene: Scene | null = null
  private issues: Issue[] = []
  private hidden: Set<string>
  private raf = 0
  private enterTimer = 0
  private autoHeight = false
  private disposed = false
  private id = `sp${++uid}`
  private measureCache = new Map<string, number>()
  private canvas: CanvasRenderingContext2D | null = null
  private canvasTried = false
  private overlay: SVGGElement | null = null
  private highlighted: string | null = null
  private spec: unknown
  private layer: CanvasLayer | null = null
  /** WebGL failed or the context was lost: stay on canvas for this plot. */
  private glOff = false
  /** The viewer's camera, once they moved it (or `setCamera`). */
  private cam: Camera | null = null
  /** The camera moved on the GPU since the last compile. */
  private glMoved = false
  private gestureTimer = 0
  /** Drag, pinch, keys and zoom buttons on an interactive map (its own chunk, loaded with the first map). */
  private map: MapCtl.MapControl | null = null
  private glWaiting = false
  private axis: AxisControl
  private hoverMark: Mark | null = null
  private table: HTMLTableElement | null = null
  private tableOf: unknown = undefined
  /** The `strings` and `locale` the table was built with. */
  private tableEnv = ''
  /** `strings` resolved over the English defaults, for the object it came from. */
  private ui: { from: unknown; strings: UiStrings } | null = null
  /** `appendRows` keeps its own copy of the rows, so the caller's array is never changed. */
  private rows: unknown[] | null = null
  private appendRaf = 0
  private sync: SyncConf | null = null
  private bar: Tools.Toolbar | null = null
  /** The toolbar's table button: null follows `dataTable`, true shows the table, false hides it from sight. */
  private tableShown: boolean | null = null
  /** Announcements (sonify) on the SVG renderer, created on first use; the canvas view has its own. */
  private live: HTMLDivElement | null = null
  private sound: SonifyController | null = null
  private warned = new Set<string>()
  /** Server-rendered SVG found in the host, adopted by the first render if it matches. */
  private ssr: Element | null = null
  /** This plot adopted server markup: it measures text the way the server did, so later draws line up with it. */
  private hydrated = false
  /** The `navigator` option's overview strip, and the full-range scene it draws (recompiled when the data or size change). */
  private nav: Nav.Navigator | null = null
  /** The strip's element: the navigator's, or an empty one of the same height while its code loads (no layout shift). */
  private navEl: HTMLDivElement | null = null
  private navFull: { key: string; scene: Scene } | null = null
  /** The chart could not have a navigator (no zoom, categories on x, ...): draw without it until the spec changes. */
  private navRefused = false
  /** Bumped by every new spec or appended rows: part of the full-range scene's cache key. */
  private dataVersion = 0
  /** Drill-down: the viewer's focus path over the spec's own (null: the spec's). */
  private focusPath: string[] | null = null
  /** Live data: rows appended since the last announcement, the newest of them, and when we last spoke. */
  private news = 0
  private newest: unknown = undefined
  private lastSaid = -Infinity
  private sayTimer = 0
  /** The page is being printed (between `beforeprint` and `afterprint`). */
  private printing = false
  /** The last pointer pressed was a finger or a pen: taps pick the nearest mark within a few pixels. */
  private coarse = false
  /** Chunks this plot is loading, and what runs when each is here (what `ready()` waits for). */
  private loading = new Set<Chunk<unknown>>()
  private pending = new Set<Promise<void>>()

  constructor(readonly host: HTMLElement, spec: unknown, private options: SuperPlotOptions = {}) {
    const doc = host.ownerDocument
    ensureStyles(doc)
    this.spec = spec
    this.hidden = new Set(options.hidden ?? [])
    this.root = doc.createElement('div')
    this.root.className = 'sp-root'
    this.tip = doc.createElement('div')
    this.tip.className = 'sp-tip'
    this.tip.setAttribute('role', 'tooltip')
    // Server markup from `renderToSvg(spec, { hydrate: true })`, taken out until the first render decides.
    const ssr = [...host.children].find(c => c.localName === 'svg' && c.hasAttribute('data-sp-key'))
    if (ssr) {
      this.ssr = ssr
      ssr.remove()
    }
    this.host.appendChild(this.root)
    this.root.addEventListener('pointerover', this.onOver)
    this.root.addEventListener('pointermove', this.onMove)
    this.root.addEventListener('pointerleave', this.onLeave)
    this.root.addEventListener('focusin', this.onFocus)
    this.root.addEventListener('focusout', this.onLeave)
    this.root.addEventListener('click', this.onClick)
    this.root.addEventListener('keydown', this.onKey)
    this.root.addEventListener('pointerdown', this.onDown)
    this.root.addEventListener('pointermove', this.onDragMove)
    this.root.addEventListener('pointerup', this.onUp)
    this.root.addEventListener('pointercancel', this.onUp)
    this.root.addEventListener('wheel', this.onWheel, { passive: false })
    this.root.addEventListener('pointerdown', this.onPointerKind, true)
    doc.defaultView?.addEventListener('beforeprint', this.onBeforePrint)
    doc.defaultView?.addEventListener('afterprint', this.onAfterPrint)
    this.axis = new AxisControl({
      root: this.root,
      scene: () => this.scene,
      redraw: () => this.schedule(false),
      zoomChanged: z => this.options.onZoom?.(z),
      brushChanged: b => {
        this.options.onBrush?.(b)
        this.shareBrush(b)
      },
      viewChanged: () => this.shareZoom(),
      focusPoint: t => this.focusPoint(t),
      hideTip: () => this.hideTip()
    })
    if (typeof ResizeObserver !== 'undefined' && options.width === undefined) {
      this.ro = new ResizeObserver(() => this.schedule(false))
      this.ro.observe(host)
    }
    if (options.theme === 'auto' || options.theme === undefined) {
      this.mq = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null
      this.mq?.addEventListener?.('change', this.onScheme)
    }
    this.joinSync()
    this.render(true)
  }

  /** Replace the spec. Plays the entrance animation again. */
  setSpec(spec: unknown): void {
    // A different map (type or geography) starts from its own view; new data on the same map keeps the viewer's.
    if (mapKeyOf(spec) !== mapKeyOf(this.spec)) this.cam = null
    // The same with zoom and brush: they stay while the chart shows the same columns.
    if (axisKeyOf(spec) !== axisKeyOf(this.spec)) this.axis.reset()
    // The viewer's drill-down stays while the hierarchy (and the spec's own focus) is the same.
    if (drillKeyOf(spec) !== drillKeyOf(this.spec)) this.focusPath = null
    this.spec = spec
    this.rows = null
    this.navRefused = false
    this.dataVersion++
    this.render(true)
  }

  /**
   * Add rows to the end of the data (a live feed). With `max`, the oldest rows are dropped past that many.
   * Several calls in one frame draw once; zoom, brush and hidden series stay. The spec you passed is not changed.
   */
  appendRows(rows: readonly unknown[], options: { max?: number } = {}): void {
    const spec = this.spec as Record<string, unknown> | null
    if (!spec || typeof spec !== 'object' || !rows.length) return
    if (!this.rows) this.rows = Array.isArray(spec.data) ? [...spec.data] : []
    for (const r of rows) this.rows.push(r)
    const max = options.max
    if (max !== undefined && max >= 0 && this.rows.length > max) this.rows.splice(0, this.rows.length - max)
    this.spec = { ...spec, data: this.rows }
    this.dataVersion++
    this.news += rows.length
    this.newest = rows[rows.length - 1]
    if (this.appendRaf) return
    this.appendRaf = requestAnimationFrame(() => {
      this.appendRaf = 0
      if (this.disposed) return
      this.render(false)
      this.sayNews()
    })
  }

  /** Zoomed axes, or null at the full range. Time axes as ISO strings. */
  getZoom(): ZoomRange | null { return this.axis.getZoom() }
  /** Show these ranges (`{ x: [from, to] }`, numbers or ISO dates; null for the full range). Does not fire `onZoom`. */
  setZoom(zoom: { x?: unknown; y?: unknown } | null): void { this.axis.setZoom(zoom) }
  resetZoom(): void { this.axis.setZoom(null) }
  /** The brushed selection, or null. */
  getBrush(): BrushSelection | null { return this.axis.getBrush() }
  /** Brush from code: `{ x: [from, to] }` or `{ x: ["A", "B"] }` on categories; null clears. Does not fire `onBrush`. */
  setBrush(brush: { x?: unknown; y?: unknown } | null): void { this.axis.setBrush(brush) }

  /** Change render options (theme, locale, size, ...). */
  setOptions(patch: Partial<SuperPlotOptions>): void {
    const prevCamera = this.options.camera
    this.options = { ...this.options, ...patch }
    if (patch.hidden) this.hidden = new Set(patch.hidden)
    // Only a camera that really changed resets the viewer's (an inline object re-sent by a framework does not).
    if (patch.camera && JSON.stringify(patch.camera) !== JSON.stringify(prevCamera)) this.cam = null
    if ('sync' in patch) this.joinSync()
    if ('dataTable' in patch) this.tableShown = null
    if ('navigator' in patch) this.navRefused = false
    this.render(false)
  }

  getScene(): Scene | null {
    this.syncCamera()
    return this.scene
  }
  /** What is drawing the chart right now. */
  getRenderer(): 'svg' | 'canvas' | 'webgl' { return this.layer ? this.layer.renderer : 'svg' }

  /** Maps: the camera on screen, or null when the chart is not a map. */
  getCamera(): Camera | null { return this.cam ?? this.scene?.geo?.view.camera ?? null }

  /** Maps: move the camera (merged into the current one). Does not fire `onCameraChange` (that is for the viewer). */
  setCamera(camera: Partial<Camera>): void {
    const now = this.getCamera()
    if (!now) return
    this.applyCamera(clampCamera({ ...now, ...camera }))
    this.endGesture(false)
  }

  /** Maps: back to the spec's camera (or the fitted view). Does not fire `onCameraChange`. */
  resetCamera(): void {
    this.reset(false)
  }

  private reset(notify: boolean): void {
    clearTimeout(this.gestureTimer)
    this.gestureTimer = 0
    this.cam = null
    this.render(false)
    const c = this.getCamera()
    if (notify && c) this.options.onCameraChange?.(c)
  }
  getIssues(): Issue[] { return this.issues }
  getHidden(): string[] { return [...this.hidden] }

  /** Standalone SVG of what is on screen: colours resolved, no scripts, no hover hooks. */
  toSvg(): string {
    this.syncCamera()
    if (!this.scene) throw new Error('Nothing to export: the spec is invalid.')
    const theme = this.themeNow()
    return renderSvg(this.scene, { resolveVars: true, font: theme.font })
  }

  /** PNG of what is on screen. `scale` is the pixel ratio (default: the display's). */
  async toPng(scale = this.host.ownerDocument.defaultView?.devicePixelRatio ?? 2): Promise<Blob> {
    this.syncCamera()
    const scene = this.scene
    if (!scene) throw new Error('Nothing to export: the spec is invalid.')
    if (this.layer) return this.layer.toBlob(scale)
    const doc = this.host.ownerDocument
    const url = URL.createObjectURL(new Blob([this.toSvg()], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const img = new Image()
      img.decoding = 'sync'
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('Could not rasterise the SVG.'))
        img.src = url
      })
      const cv = doc.createElement('canvas')
      cv.width = Math.round(scene.width * scale)
      cv.height = Math.round(scene.height * scale)
      const ctx = cv.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, scene.width, scene.height)
      return await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('PNG export failed.'))), 'image/png'))
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  /** CSV of the data the chart shows (after `transform`, every row): see `plotCsv` in core. */
  toCsv(): string {
    const csv = plotCsv(this.spec)
    if (csv === null) throw new Error('Nothing to export: the spec is invalid.')
    return csv
  }

  /**
   * Play the first visible series as sound (Web Audio): one short note per value in x order, higher values
   * higher. Start and end are announced to screen readers. A second call stops the first one and starts again;
   * `dispose()` stops it. Without Web Audio (or with nothing to play) it returns a controller that did nothing
   * and reports a warning through `onIssues`.
   */
  sonify(options: SonifyOptions = {}): SonifyController {
    this.sound?.stop()
    this.syncCamera()
    const scene = this.scene
    const Ctor = audioContextOf(this.host.ownerDocument.defaultView)
    if (!Ctor) {
      this.warn('sonify_unavailable', 'This browser has no Web Audio (AudioContext), so sonify() played nothing.')
      return idleController()
    }
    const plan = scene ? sonifyNotes(scene, options) : null
    if (!scene || !plan || !plan.notes.length) {
      this.warn('sonify_empty', 'sonify() found no values to play.', scene ? undefined : 'Fix the spec first.')
      return idleController()
    }
    const what = `${scene.title}${plan.series ? `, ${plan.series}` : ''}`
    let ctl: SonifyController
    try {
      ctl = playNotes(Ctor, plan, options.volume ?? 0.25, finished => {
        if (this.sound === ctl) this.sound = null
        this.syncBar()
        if (!this.disposed) this.announce(finished ? this.t('soundFinished', { title: scene.title }) : this.t('soundStopped'))
      })
    } catch (e) {
      this.warn('sonify_unavailable', `Web Audio failed to start: ${e instanceof Error ? e.message : String(e)}.`)
      return idleController()
    }
    this.sound = ctl
    const n = plan.notes.length
    this.announce(this.t(n > 1 ? 'soundPlaying' : 'soundPlayingOne', { what, n }))
    this.syncBar()
    return ctl
  }

  /**
   * Settles once the code this plot loads on demand for what it shows now (the navigator strip, the toolbar,
   * the map controls, the WebGL layer) is loaded and drawn. Everything else is drawn by the constructor, `setSpec` and
   * `setOptions` before they return. Never rejects: a part that failed to load is reported through `onIssues`
   * (`load_failed`), and WebGL falls back to canvas.
   */
  async ready(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending])
  }

  /** Keep `p` (a load and what runs after it) for `ready()`. */
  private track(p: Promise<void>): void {
    const q = p.catch(() => {}).finally(() => this.pending.delete(q))
    this.pending.add(q)
  }

  /** Load a chunk this plot needs (one request per plot at a time), then run `then` unless the plot was disposed. */
  private need<T>(c: Chunk<T>, what: string, then: (m: T) => void): void {
    if (this.loading.has(c)) return
    this.loading.add(c)
    this.track(c.load().then(m => {
      this.loading.delete(c)
      if (!this.disposed) then(m)
    }, e => {
      this.loading.delete(c)
      if (!this.disposed) this.warn('load_failed', `The ${what} could not be loaded: ${e instanceof Error ? e.message : String(e)}.`, 'It is code split from the main bundle: check that its chunk file is served next to it.')
    }))
  }

  /** Say something to screen readers: through the canvas view's live region, or this plot's own. */
  /**
   * The binding's own text from the `strings` option (the same keys as core's, English by default), placeholders
   * filled. Bad overrides are already reported by the compile; here they just fall back to English.
   */
  private t(key: UiStringKey, vars?: Record<string, string | number>): string {
    const from = this.options.strings
    let ui = this.ui
    if (!ui || ui.from !== from) ui = this.ui = { from, strings: resolveStrings(from, []) }
    return fillString(ui.strings[key], vars)
  }

  private announce(text: string): void {
    if (this.layer) return this.layer.announce(text)
    if (!this.live) {
      this.live = this.host.ownerDocument.createElement('div')
      this.live.className = 'sp-live'
      this.live.setAttribute('aria-live', 'polite')
      this.root.appendChild(this.live)
    }
    this.live.textContent = text
  }

  /** Report a warning through `onIssues`, once per code for this plot. */
  private warn(code: string, message: string, hint?: string): void {
    if (this.warned.has(code)) return
    this.warned.add(code)
    this.issues = [...this.issues, { severity: 'warning', code, path: '', message, ...(hint ? { hint } : {}) }]
    this.options.onIssues?.(this.issues)
  }

  /** Stop observing, remove the DOM and listeners. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.sound?.stop()
    this.sound = null
    this.leaveSync()
    this.disposed = true
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.appendRaf)
    this.axis.dispose()
    this.table?.remove()
    this.table = null
    this.nav?.dispose()
    this.nav = null
    this.navEl?.remove()
    this.navEl = null
    clearTimeout(this.sayTimer)
    this.root.removeEventListener('pointerdown', this.onPointerKind, true)
    this.host.ownerDocument.defaultView?.removeEventListener('beforeprint', this.onBeforePrint)
    this.host.ownerDocument.defaultView?.removeEventListener('afterprint', this.onAfterPrint)
    clearTimeout(this.enterTimer)
    clearTimeout(this.gestureTimer)
    this.ro?.disconnect()
    this.mq?.removeEventListener?.('change', this.onScheme)
    this.layer?.dispose()
    this.layer = null
    this.root.remove()
  }

  // ---- rendering ---------------------------------------------------------------------------

  private prefersDark(): boolean { return this.mq?.matches ?? false }

  /** The theme option to draw with: the spec's, or its light counterpart while printing (`printLight`). */
  private themeOpt(): SuperPlotOptions['theme'] {
    const t = this.options.theme
    if (!this.printing || this.options.printLight === false) return t
    if (t === undefined || t === 'auto') return this.prefersDark() ? 'light' : t
    return typeof t === 'string' && PRINT_LIGHT[t] ? PRINT_LIGHT[t] : t
  }

  private themeNow(): Theme { return resolveTheme(this.themeOpt(), this.prefersDark()) }

  private onBeforePrint = (): void => {
    const before = this.themeNow()
    this.printing = true
    if (this.themeNow() !== before) this.render(false)
    else this.printing = false
  }

  private onAfterPrint = (): void => {
    if (!this.printing) return
    this.printing = false
    if (!this.disposed) this.render(false)
  }

  private schedule(animate: boolean): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (!this.disposed) this.render(animate)
    })
  }

  private measure: Measure = (text, size, weight = 400) => {
    const doc = this.host.ownerDocument
    const font = this.themeNow().font
    const key = `${weight}|${size}|${text}`
    const hit = this.measureCache.get(key)
    if (hit !== undefined) return hit
    if (this.canvas === null && !this.canvasTried) {
      this.canvasTried = true
      try {
        this.canvas = doc.createElement('canvas').getContext('2d')
      } catch {
        this.canvas = null
      }
    }
    let w: number
    if (this.canvas && typeof this.canvas.measureText === 'function') {
      this.canvas.font = `${weight} ${size}px ${font}`
      w = this.canvas.measureText(text).width
      if (!Number.isFinite(w) || w === 0) w = estimateWidth(text, size, weight)
    } else w = estimateWidth(text, size, weight)
    if (this.measureCache.size > 5000) this.measureCache.clear()
    this.measureCache.set(key, w)
    return w
  }

  /** The host's own height: what it would be if our root had none. */
  private hostHeight(): number {
    const prev = this.root.style.height
    this.root.style.height = '0px'
    // The navigator and a visible data table sit in the host too: they are not a height the host has of its own.
    const others = ([this.navEl, this.table] as (HTMLElement | null | undefined)[]).filter((e): e is HTMLElement => !!e && e.parentNode === this.host)
    const shown = others.map(e => e.style.display)
    for (const e of others) e.style.display = 'none'
    const h = this.host.clientHeight
    others.forEach((e, i) => { e.style.display = shown[i] })
    this.root.style.height = prev
    return h
  }

  /** The `navigator` option asks for a strip, and this spec has not been found unable to have one. */
  private navWanted(): boolean {
    const s = this.spec as Record<string, unknown> | null
    return this.options.navigator === true && !this.navRefused && !!s && typeof s === 'object' && !s.facet
  }

  /** The spec to compile: the caller's, with the viewer's drill-down focus when there is one. */
  private specNow(): unknown {
    const s = this.spec
    return this.focusPath && s && typeof s === 'object' ? { ...(s as Record<string, unknown>), focus: this.focusPath } : s
  }

  private render(enter: boolean): void {
    if (this.disposed) return
    const started = performance.now()
    const o = this.options
    const hostW = Math.floor(this.host.getBoundingClientRect().width || this.host.clientWidth)
    const width = o.width ?? (hostW > 0 ? hostW : 640)
    // Decide again on every render whether the host has a height of its own (it may have been detached,
    // hidden or unstyled when the plot was created). Without one, the plot picks a height from the width.
    if (o.height === undefined) this.autoHeight = this.hostHeight() === 0
    let height = o.height ?? (this.autoHeight ? defaultHeight(this.specType(), width) : Math.floor(this.host.clientHeight) || defaultHeight(this.specType(), width))
    // The navigator takes its strip from a fixed height; with an automatic height it adds it below the chart.
    const navH = this.navWanted() ? NAV_HEIGHT : 0
    if (navH && (o.height !== undefined || !this.autoHeight)) height = Math.max(100, height - navH)
    if (o.width !== undefined || o.height !== undefined || this.autoHeight || navH) {
      this.root.style.height = `${height}px`
      if (o.width !== undefined) this.root.style.width = `${o.width}px`
    } else this.root.style.height = ''
    const camera = this.cam ?? o.camera
    const view = this.axis.view
    // Hydrating (or hydrated): measure text with the estimator the server used, or the markup cannot match.
    const measure = this.ssr || this.hydrated ? estimateWidth : this.measure
    const result = compilePlot(this.specNow(), { ...o, theme: this.themeOpt(), width, height, hidden: this.hidden, measure, prefersDark: this.prefersDark(), ...(camera ? { camera } : {}), ...(view ? { view } : {}) })
    if (navH && result.ok && !navigable(result.scene)) {
      // Asked for, but this chart cannot have one: draw again at the full height, and say why on every draw.
      this.navRefused = true
      return this.render(enter)
    }
    if (result.ok && this.options.navigator === true && (this.navRefused || (this.spec as { facet?: unknown } | null)?.facet)) result.issues.push(NAV_REFUSED)
    this.glMoved = false
    this.hideTip()
    this.overlay = null
    this.highlighted = null
    this.hoverMark = null
    if (!result.ok) {
      this.ssr = null
      this.layer?.dispose()
      this.layer = null
      this.scene = null
      this.issues = result.issues
      if (this.map) {
        this.map.controls?.remove()
        this.map.controls = null
      }
      this.setupToolbar(null, null)
      const err = this.host.ownerDocument.createElement('div')
      err.className = 'sp-error'
      err.setAttribute('role', 'alert')
      err.textContent = result.issues.filter(i => i.severity === 'error').map(i => `${i.path || 'spec'}: ${i.message}${i.hint ? ` ${i.hint}` : ''}`).join('\n')
      this.mount(err)
      this.axis.afterRender()
      this.syncNav(null)
      this.syncTable()
      o.onIssues?.(result.issues)
      return
    }
    this.scene = result.scene
    const changed = JSON.stringify(result.issues) !== JSON.stringify(this.issues)
    this.issues = result.issues
    const theme = this.themeNow()
    const font = `var(--sp-font, ${theme.font})`
    const marks = dataMarkCount(result.scene)
    // A map keeps its context once it has one (tilting back to flat must not drop and re-create it).
    const autoGl = (o.renderer ?? 'auto') === 'auto' && (marks > (o.webglAbove ?? 20000) || isDeepMap(result.scene) || (!!result.scene.geo && !!this.layer?.hasGl))
    const wantGl = !this.glOff && (o.renderer === 'webgl' || (autoGl && this.hardwareGl()))
    const wantCanvas = o.renderer === 'canvas' || o.renderer === 'webgl' || wantGl || (o.renderer !== 'svg' && marks > (o.canvasAbove ?? 4000))
    if (this.ssr && wantCanvas) {
      // Server markup is SVG; this plot draws on canvas, with the real text measure.
      this.ssr = null
      return this.render(enter)
    }
    this.setupMap(result.scene, theme)
    this.setupToolbar(result.scene, theme)
    if (wantCanvas) {
      this.layer ??= CanvasLayer.create(this.host.ownerDocument, {
        tipEnabled: () => this.tipEnabled(),
        showTip: (t, x, y, m) => this.showTip(t, x, y, m),
        placeTip: (x, y) => this.placeTip(x, y),
        hideTip: () => this.hideTip(),
        activate: m => this.activateMark(m),
        dragging: () => this.dragging(),
        hovered: m => this.hovered(m),
        drillable: () => this.drillOn(),
        coarse: () => this.coarse,
        keysHint: () => this.t('canvasKeys')
      })
      if (this.layer) {
        // One context per plot for its lifetime: creating one costs far more than a redraw.
        if (!wantGl) this.layer.setGl(null)
        else if (!this.layer.hasGl) this.layer.setGl(this.makeGl())
        const cs = this.host.ownerDocument.defaultView?.getComputedStyle(this.root)
        this.layer.draw(result.scene, font, name => cs?.getPropertyValue(name))
        // Keep the canvas element in place when it is already there: moving it would drop keyboard focus.
        this.mount(this.layer.el)
        this.root.setAttribute('data-renderer', this.layer.renderer)
        this.afterDraw(result.scene, started, changed || enter, { ctx: this.layer.drawingContext() })
        return
      }
    }
    this.layer?.dispose()
    this.layer = null
    this.root.setAttribute('data-renderer', 'svg')
    if (this.ssr) {
      const el = this.ssr
      this.ssr = null
      const id = el.getAttribute('data-sp-id') ?? ''
      // The same bytes this plot would draw (same spec, size, theme, locale, plugins): keep the server's nodes.
      if (id && svgKey(renderSvg(result.scene, { interactive: true, idPrefix: id, font })) === el.getAttribute('data-sp-key')) {
        this.hydrated = true
        this.mount(el)
        this.afterDraw(result.scene, started, true, { svg: el as SVGSVGElement })
        return
      }
      return this.render(enter)
    }
    const svg = renderSvg(result.scene, { interactive: true, idPrefix: this.id, font })
    const tpl = this.host.ownerDocument.createElement('template')
    tpl.innerHTML = svg
    this.mount(tpl.content)
    if (enter && !this.map?.pressed() && o.animate !== false) {
      this.root.classList.add('sp-enter')
      clearTimeout(this.enterTimer)
      this.enterTimer = window.setTimeout(() => this.root.classList.remove('sp-enter'), 1000)
    }
    this.afterDraw(result.scene, started, changed || enter, { svg: this.root.querySelector('svg') ?? undefined })
  }

  /** Zoom and brush, plugins, the data table, then tell the host. */
  private afterDraw(scene: Scene, started: number, report: boolean, target: { svg?: SVGSVGElement; ctx?: CanvasRenderingContext2D }): void {
    const o = this.options
    this.axis.afterRender()
    this.syncNav(scene)
    if (target.svg) this.syncCrumbs(target.svg, scene)
    const renderer = this.getRenderer()
    for (const p of o.plugins ?? []) {
      if (!p.afterDraw) continue
      try {
        p.afterDraw({ scene, renderer, ...target })
      } catch (e) {
        this.issues = [...this.issues, { severity: 'warning', code: 'plugin_error', path: '', message: `Plugin "${p.name}" failed in afterDraw: ${e instanceof Error ? e.message : String(e)}.` }]
        report = true
      }
    }
    this.syncTable()
    this.syncBar()
    if (report) o.onIssues?.(this.issues)
    o.onRender?.({ renderer, ms: performance.now() - started, scene })
  }

  /**
   * Put the drawing first and keep the tooltip, live region, map controls and toolbar where they are: moving
   * a focused button out and back in would drop keyboard focus.
   */
  private mount(drawing: Node): void {
    const keep: Node[] = [this.tip]
    // One live region per chart: the canvas view brings its own.
    if (this.live && !this.layer) keep.push(this.live)
    if (this.map?.controls) keep.push(this.map.controls)
    if (this.bar) keep.push(this.bar.el)
    for (const c of [...this.root.childNodes]) if (c !== drawing && !keep.includes(c)) c.remove()
    if (drawing.parentNode !== this.root) this.root.prepend(drawing)
    for (const k of keep) if (k.parentNode !== this.root) this.root.appendChild(k)
  }

  // ---- navigator ---------------------------------------------------------------------------

  /** The overview strip: created, updated or removed after every draw. */
  private syncNav(scene: Scene | null): void {
    if (!scene || !this.navWanted() || !navigable(scene)) {
      this.nav?.dispose()
      this.navEl?.remove()
      this.nav = null
      this.navEl = null
      this.navFull = null
      return
    }
    const doc = this.host.ownerDocument
    const mod = navChunk.mod
    if (mod && !this.nav) {
      this.nav = new mod.Navigator(doc, {
        view: () => this.axis.view?.x ?? null,
        setX: (x, notify) => this.axis.viewX(x, notify),
        locale: () => this.options.locale,
        timeZone: () => this.options.timeZone,
        text: (key, vars) => this.t(key, vars),
        color: token => cssVar(this.themeNow(), token)
      })
      if (this.navEl?.parentNode) this.navEl.replaceWith(this.nav.el)
      this.navEl = this.nav.el
    }
    if (!this.navEl) {
      // Its code is on the way: keep the strip's room now, so nothing moves when it is drawn.
      this.navEl = doc.createElement('div')
      this.navEl.className = 'sp-nav'
    }
    if (!mod) this.need(navChunk, 'navigator', () => {
      this.syncNav(this.scene)
      this.syncTable()
    })
    const el = this.navEl
    if (el.parentNode !== this.host || el.previousSibling !== this.root) this.host.insertBefore(el, this.root.nextSibling)
    el.style.width = this.options.width !== undefined ? `${this.options.width}px` : ''
    const full = this.nav ? this.fullScene(scene) : null
    if (full) this.nav!.update(full.scene, full.key)
  }

  /**
   * The chart at its full x range, for the overview: the scene on screen when it is not zoomed, else compiled
   * once without the view (and without plugins) and kept until the data, size, theme or hidden series change.
   */
  private fullScene(scene: Scene): { key: string; scene: Scene } | null {
    const key = JSON.stringify([this.dataVersion, scene.width, scene.height, [...this.hidden].sort(), this.themeNow().name, this.prefersDark(), this.options.locale ?? '', this.options.timeZone ?? '', this.options.strings ?? null])
    if (!this.axis.view) return (this.navFull = { key, scene })
    if (this.navFull?.key === key) return this.navFull
    const o = this.options
    const r = compilePlot(this.specNow(), { theme: this.themeOpt(), locale: o.locale, timeZone: o.timeZone, strings: o.strings, width: scene.width, height: scene.height, hidden: this.hidden, measure: this.ssr || this.hydrated ? estimateWidth : this.measure, prefersDark: this.prefersDark() })
    return r.ok && navigable(r.scene) ? (this.navFull = { key, scene: r.scene }) : null
  }

  // ---- drill-down --------------------------------------------------------------------------

  /** Clicking a group drills into it: the `drill` option, else on when the spec has more than one level. */
  private drillOn(): boolean {
    const s = this.spec as Record<string, unknown> | null
    if (!s || typeof s !== 'object' || (s.type !== 'treemap' && s.type !== 'sunburst')) return false
    if (this.options.drill !== undefined) return this.options.drill
    return s.type === 'sunburst' ? Array.isArray(s.path) && s.path.length > 1 : typeof s.group === 'string' && s.group !== ''
  }

  /** The focus path the scene shows (from its breadcrumb; [] for the whole tree). */
  private shownFocus(): string[] {
    const m = this.scene?.marks.find(k => k.type === 'text' && k.drill !== undefined)
    return m?.drill ? [...m.drill] : []
  }

  /** Show `path` (the viewer drilled), report it, and keep keyboard focus in the chart. `from` is where we came from. */
  private drillTo(path: string[], from?: string[]): void {
    const doc = this.host.ownerDocument
    const had = this.root.contains(doc.activeElement)
    this.focusPath = [...path]
    this.hideTip()
    this.render(true)
    this.options.onDrill?.([...path])
    if (this.disposed) return
    this.announce(path.length ? this.t('drillShowing', { path: path.join(' > ') }) : this.t('drillShowingAll'))
    if (!had) return
    if (this.layer) {
      this.layer.el.querySelector<HTMLElement>('canvas[tabindex="0"]')?.focus({ preventScroll: true })
      return
    }
    const marks = this.scene?.marks ?? []
    const same = (d: string[] | undefined): boolean => !!d && !!from && d.length === from.length && d.every((v, i) => v === from[i])
    const i = marks.findIndex(m => m.role === 'data' && same(m.drill))
    const el = (i >= 0 ? this.root.querySelector<HTMLElement>(`[data-i="${i}"]`) : null) ?? this.root.querySelector<HTMLElement>('.sp-data[tabindex]')
    el?.focus({ preventScroll: true })
  }

  /** Breadcrumb items are buttons only while drilling is on. */
  private syncCrumbs(svg: SVGSVGElement, scene: Scene): void {
    if (this.drillOn()) return
    scene.marks.forEach((m, i) => {
      if (m.drill === undefined || m.role !== 'label' || m.type !== 'rect') return
      const el = svg.querySelector(`[data-i="${i}"]`)
      el?.removeAttribute('tabindex')
      el?.removeAttribute('role')
      el?.setAttribute('aria-hidden', 'true')
    })
  }

  // ---- live-data announcements ---------------------------------------------------------------

  /** `announce`: true always, false never, unset while keyboard focus is in the chart or the data table is on. */
  private announceWanted(): boolean {
    const a = this.options.announce
    if (a !== undefined) return a
    return !!this.options.dataTable || this.host.contains(this.host.ownerDocument.activeElement)
  }

  /** After appended rows are drawn: say how many and the latest one, at most once per {@link ANNOUNCE_EVERY} ms. */
  private sayNews(): void {
    if (!this.news || this.disposed) return
    if (!this.announceWanted()) {
      this.news = 0
      return
    }
    const wait = this.lastSaid + ANNOUNCE_EVERY - Date.now()
    if (wait > 0) {
      if (!this.sayTimer) this.sayTimer = window.setTimeout(() => { this.sayTimer = 0; this.sayNews() }, wait)
      return
    }
    const text = this.newsText(this.news, this.newest)
    this.news = 0
    this.lastSaid = Date.now()
    this.announce(text)
  }

  /** "3 new points; latest 14:05: Revenue 1.2k, Cost 800": the count and the mark at the newest row's x. */
  private newsText(n: number, row: unknown): string {
    const scene = this.scene
    const spec = this.spec as { x?: unknown } | null
    const cartesian = !!scene?.axes && !scene.panels
    const head = this.t(cartesian ? (n === 1 ? 'newPoint' : 'newPoints') : (n === 1 ? 'newRow' : 'newRows'), { n })
    const a = scene?.axes
    if (!a || !cartesian || typeof spec?.x !== 'string' || !row || typeof row !== 'object') return this.t('newsCount', { count: head })
    const v = axisValue(a.x.kind, (row as Record<string, unknown>)[spec.x])
    const i = v === null ? -1 : syncTarget(scene, { kind: a.x.kind, v })
    const tip = i >= 0 ? scene!.marks[i].tip : undefined
    if (!tip) return this.t('newsCount', { count: head })
    const rows = tip.rows.slice(0, 2).map(r => `${r.label} ${r.value}`).join(', ')
    return this.t('newsLatest', { count: head, mark: [tip.title, rows].filter(Boolean).join(': ') })
  }

  // ---- toolbar -----------------------------------------------------------------------------

  private toolbarItems(scene: Scene | null): ToolbarItem[] {
    const t = this.options.toolbar
    if (!scene || !t) return []
    const list = t === true ? TOOLBAR_DEFAULT : Array.isArray(t) ? t : []
    const out: ToolbarItem[] = []
    for (const k of list) if (TOOLBAR_ITEMS.includes(k) && !out.includes(k) && (k !== 'reset' || scene.axes?.zoom)) out.push(k)
    return out
  }

  /** The `toolbar` option: the buttons this chart gets, drawn once the toolbar's code is here. */
  private setupToolbar(scene: Scene | null, theme: Theme | null): void {
    const items = this.toolbarItems(scene)
    if (!items.length) {
      this.bar?.el.remove()
      this.bar = null
      this.root.removeAttribute('data-toolbar')
      return
    }
    // Set before the buttons arrive: the map buttons make room for them now rather than move later.
    this.root.setAttribute('data-toolbar', '')
    const mod = toolChunk.mod
    if (!mod) return this.need(toolChunk, 'toolbar', () => {
      this.setupToolbar(this.scene, this.scene ? this.themeNow() : null)
      if (this.bar && this.bar.el.parentNode !== this.root) this.root.appendChild(this.bar.el)
      this.syncBar()
    })
    this.bar ??= new mod.Toolbar(this.host.ownerDocument, k => this.runTool(k))
    this.bar.update(items, k => this.t(k), theme)
  }

  /** Button states: pressed table and sound, reset only active while zoomed. */
  private syncBar(): void {
    this.bar?.state(this.tableWant() === 'visible', !!this.sound?.playing, !!this.axis.view)
  }

  private runTool(k: ToolbarItem): void {
    if (this.disposed || !this.scene) return
    const spec = this.spec as { title?: unknown } | null
    const title = typeof spec?.title === 'string' && spec.title ? spec.title : this.scene.title
    const fail = (e: unknown): void => this.warn('export_failed', `The ${k.toUpperCase()} export failed: ${e instanceof Error ? e.message : String(e)}.`)
    try {
      switch (k) {
        case 'svg': return this.download(fileNameOf(title, 'svg'), new Blob([this.toSvg()], { type: 'image/svg+xml;charset=utf-8' }))
        case 'csv': return this.download(fileNameOf(title, 'csv'), new Blob([this.toCsv()], { type: 'text/csv;charset=utf-8' }))
        case 'png': { this.toPng().then(b => this.download(fileNameOf(title, 'png'), b), fail); return }
        case 'table': {
          this.tableShown = this.tableWant() !== 'visible'
          this.syncTable()
          return this.syncBar()
        }
        case 'reset': return this.axis.resetByViewer()
        case 'sound': {
          if (this.sound?.playing) this.sound.stop()
          else this.sonify()
          return this.syncBar()
        }
      }
    } catch (e) {
      fail(e)
    }
  }

  private download(name: string, blob: Blob): void {
    toolChunk.mod?.download(this.host.ownerDocument, name, blob)
  }

  // ---- sync --------------------------------------------------------------------------------

  private joinSync(): void {
    const next = syncConf(this.options.sync)
    if (this.sync && this.sync.key !== next?.key) leaveGroup(this.sync.key, this)
    this.sync = next
    if (next) joinGroup(next.key, this)
  }

  private leaveSync(): void {
    if (this.sync) leaveGroup(this.sync.key, this)
    this.sync = null
  }

  /** The other plots in this plot's group that take part in `kind`. */
  private peers(kind: 'hover' | 'zoom' | 'brush'): SuperPlot[] {
    const s = this.sync
    if (!s || !s[kind]) return []
    return groupOf<SuperPlot>(s.key).filter(p => p !== this && !p.disposed && p.sync?.[kind] === true)
  }

  /** Another plot in the group hovered `v` (null: nothing). Shown here without reporting it, so nothing echoes back. */
  private followHover(v: SyncValue | null): void {
    const scene = this.scene
    const i = v && scene ? syncTarget(scene, v) : -1
    if (this.layer) return this.layer.showMark(i)
    this.clearGuide()
    this.clearHighlight()
    const m = i >= 0 ? scene!.marks[i] : null
    if (!m) return this.hideTip()
    if (m.guide) this.showGuide(m)
    else if (m.series !== undefined) this.highlight(m.series)
    if (!m.tip || !this.tipEnabled()) return this.hideTip()
    const c = m.guide ? { x: m.guide.x1, y: m.focus?.[0]?.y ?? (m.guide.y1 + m.guide.y2) / 2 } : markCenter(m)
    const r = this.root.getBoundingClientRect()
    const k = r.width > 0 ? r.width / scene!.width : 1
    if (c) this.showTip(m.tip, r.left + c.x * k, r.top + c.y * k, m)
  }

  private shareZoom(): void {
    const peers = this.peers('zoom')
    const a = this.scene?.axes
    if (!peers.length || !a || a.x.kind === 'band' || this.scene!.panels) return
    const x = this.axis.view?.x ?? null
    for (const p of peers) p.followZoom(a.x.kind, x)
  }

  private followZoom(kind: AxisInfo['kind'], x: [number, number] | null): void {
    const a = this.scene?.axes
    if (!a?.zoom || a.x.kind !== kind || this.scene!.panels) return
    this.axis.setXView(x)
  }

  private shareBrush(sel: BrushSelection | null): void {
    const peers = this.peers('brush')
    const a = this.scene?.axes
    if (!peers.length || !a) return
    const x = sel?.x ? ('oneOf' in sel.x ? sel.x.oneOf : sel.x.range) : null
    for (const p of peers) p.followBrush(a.x.kind, x)
  }

  private followBrush(kind: AxisInfo['kind'], x: unknown[] | null): void {
    const a = this.scene?.axes
    if (!a?.brush || a.x.kind !== kind || this.scene!.panels) return
    this.axis.setBrush(x ? { x } : null)
  }

  /** The `dataTable` option: rebuilt when the spec changes, not on every resize. */
  /** What the table shows: the toolbar's choice, else the `dataTable` option. */
  private tableWant(): boolean | 'visible' {
    const o = this.options.dataTable ?? false
    if (this.tableShown === null) return o
    return this.tableShown ? 'visible' : o === 'visible' ? true : o
  }

  private syncTable(): void {
    const want = this.tableWant()
    if (!want) {
      this.table?.remove()
      this.table = null
      this.tableOf = undefined
      return
    }
    const doc = this.host.ownerDocument
    if (!this.table) {
      this.table = doc.createElement('table')
      this.table.className = 'sp-table'
    }
    if (want === 'visible') this.table.setAttribute('data-visible', '')
    else this.table.removeAttribute('data-visible')
    const after = this.navEl?.parentNode === this.host ? this.navEl : this.root
    if (this.table.parentNode !== this.host || this.table.previousSibling !== after) this.host.insertBefore(this.table, after.nextSibling)
    const env = JSON.stringify([this.options.strings ?? null, this.options.locale ?? ''])
    if (this.tableOf === this.spec && this.tableEnv === env) return
    this.tableOf = this.spec
    this.tableEnv = env
    const t = plotTable(this.spec)
    this.table.replaceChildren()
    if (!t) return
    const cap = doc.createElement('caption')
    cap.textContent = t.total > t.rows.length ? this.t('tableFirstRows', { caption: t.caption, n: t.rows.length, total: t.total }) : t.caption
    const head = doc.createElement('thead')
    const hr = doc.createElement('tr')
    for (const c of t.columns) {
      const th = doc.createElement('th')
      th.scope = 'col'
      th.textContent = c.key
      hr.appendChild(th)
    }
    head.appendChild(hr)
    const body = doc.createElement('tbody')
    const nf = new Intl.NumberFormat(this.options.locale, { maximumFractionDigits: 6 })
    for (const row of t.rows) {
      const tr = doc.createElement('tr')
      row.forEach((v, i) => {
        const td = doc.createElement('td')
        if (t.columns[i].numeric) td.setAttribute('data-n', '')
        td.textContent = v === null ? '' : typeof v === 'number' ? nf.format(v) : String(v)
        tr.appendChild(td)
      })
      body.appendChild(tr)
    }
    this.table.append(cap, head, body)
  }

  /** The keyboard's mark, in scene pixels: the canvas view's, or the focused SVG mark. */
  private focusPoint(target?: EventTarget | null): { x: number; y: number } | null {
    const m = this.layer?.focusedMark() ?? (() => {
      const el = target ?? this.host.ownerDocument.activeElement
      const hit = el ? this.markOf(el) : null
      return hit ? this.scene?.marks[hit.i] ?? null : null
    })()
    return m ? markCenter(m) : null
  }

  /** Tell the host what is under the pointer (or keyboard), once per change. */
  private hovered(mark: Mark | null): void {
    const m = mark && (mark.role === 'data' || mark.role === 'hit') && (mark.datum !== undefined || mark.tip) ? mark : null
    if (m === this.hoverMark) return
    this.hoverMark = m
    this.options.onHover?.(m ? { datum: m.datum, series: m.series, tip: m.tip } : null)
    const peers = this.peers('hover')
    if (!peers.length) return
    const v = m ? xValueOf(this.scene, m) : null
    for (const p of peers) p.followHover(v)
  }

  /** A WebGL layer for this plot, or null (not loaded yet, unavailable, or a software GPU under `auto`). */
  /**
   * `auto` uses WebGL only on a hardware GPU. Until the WebGL chunk is loaded that is unknown: draw without it,
   * load it, and decide again once it is here.
   */
  private hardwareGl(): boolean {
    const gl = glChunk.mod
    if (!gl) {
      this.whenGlLoads(() => !glChunk.mod!.probeWebGL(this.host.ownerDocument).software)
      return false
    }
    const probe = gl.probeWebGL(this.host.ownerDocument)
    return probe.ok && !probe.software
  }

  /** Render again once the WebGL chunk is here (one pending request per plot, however many renders asked). */
  private whenGlLoads(worth: () => boolean): void {
    if (this.glWaiting) return
    this.glWaiting = true
    this.track(glChunk.load().then(() => {
      this.glWaiting = false
      if (!this.disposed && !this.glOff && worth()) this.render(false)
    }, () => {
      this.glWaiting = false
      this.glOff = true
    }))
  }

  private makeGl(): Gl.GlView | null {
    const doc = this.host.ownerDocument
    const gl = glChunk.mod
    if (!gl) {
      this.whenGlLoads(() => true)
      return null
    }
    const v = gl.GlView.create(doc, () => this.onGlLost())
    if (!v) {
      this.glOff = true
      // Asked for explicitly: say once why the plot is on canvas instead.
      if (this.options.renderer === 'webgl' && !warnedGl) {
        warnedGl = true
        console.warn(`Super Plot: WebGL is not available (${gl.GlView.lastError}); drawing on canvas.`)
      }
    }
    return v
  }

  private onGlLost(): void {
    this.glOff = true
    this.layer?.setGl(null)
    this.schedule(false)
  }

  private specType(): string {
    const t = (this.spec as { type?: unknown } | null)?.type
    return typeof t === 'string' ? t : 'bar'
  }

  // ---- interaction -------------------------------------------------------------------------

  private markOf(target: EventTarget | null): { el: Element; i: number } | null {
    const el = (target as Element | null)?.closest?.('[data-i]')
    if (!el || !this.root.contains(el)) return null
    return { el, i: Number(el.getAttribute('data-i')) }
  }

  private tipEnabled(): boolean {
    const spec = this.spec as { tooltip?: unknown } | null
    return this.options.tooltip !== false && spec?.tooltip !== false
  }

  /** Remember whether the pointer is a finger or pen (before anything else sees the press). */
  private onPointerKind = (e: PointerEvent): void => {
    this.coarse = e.pointerType === 'touch' || e.pointerType === 'pen'
  }

  /** A finger or pen that lands next to a small mark (not on one): the mark within {@link TOUCH_SLOP} scene px. */
  private nearTouch(e: MouseEvent): Mark | null {
    const pt = (e as PointerEvent).pointerType
    if (!(pt === 'touch' || pt === 'pen' || (pt === undefined && this.coarse)) || !this.scene) return null
    const r = this.root.getBoundingClientRect()
    if (!r.width || !r.height) return null
    const k = this.scene.width / r.width
    const i = nearestMark(this.scene, (e.clientX - r.left) * k, (e.clientY - r.top) * k, TOUCH_SLOP)
    return i >= 0 ? this.scene.marks[i] : null
  }

  private onOver = (e: PointerEvent): void => {
    if (this.layer || this.dragging()) return // the canvas view handles its own pointer events
    const m = this.markOf(e.target)
    const mark = (m && this.scene?.marks[m.i]) || this.nearTouch(e)
    this.hovered(mark ?? null)
    if (!mark) return this.clearHighlight()
    if (mark.series !== undefined && mark.role !== 'hit') this.highlight(mark.series)
    else if (mark.role === 'hit') this.showGuide(mark)
    if (mark.tip && this.tipEnabled()) this.showTip(mark.tip, e.clientX, e.clientY, mark)
  }

  private onMove = (e: PointerEvent): void => {
    if (this.layer || this.dragging()) return
    const m = this.markOf(e.target)
    const mark = m && this.scene?.marks[m.i]
    if (mark?.tip && this.tipEnabled()) this.placeTip(e.clientX, e.clientY)
    else if (!mark?.tip) this.hideTip()
    if (m && mark && mark.role === 'hit') this.showGuide(mark)
  }

  private onLeave = (): void => {
    this.hideTip()
    this.clearHighlight()
    this.clearGuide()
    if (!this.layer) this.hovered(null)
  }

  private onFocus = (e: FocusEvent): void => {
    const m = this.markOf(e.target)
    const mark = m && this.scene?.marks[m.i]
    if (mark) this.hovered(mark)
    if (!m || !mark?.tip || !this.tipEnabled()) return
    const r = m.el.getBoundingClientRect()
    this.showTip(mark.tip, r.left + r.width / 2, r.top, mark)
    if (mark.series !== undefined) this.highlight(mark.series)
  }

  private onClick = (e: MouseEvent): void => {
    if (this.dragging()) return
    const m = this.markOf(e.target)
    if (m) return this.activate(m)
    const near = this.layer ? null : this.nearTouch(e)
    if (near) this.activateMark(near)
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Drilled down: Escape goes up one level (and the tooltip goes away with the redraw).
      const shown = this.drillOn() ? this.shownFocus() : []
      if (shown.length) {
        e.preventDefault()
        return this.drillTo(shown.slice(0, -1), shown)
      }
      return this.onLeave()
    }
    if (this.mapKey(e)) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    const m = this.markOf(e.target)
    if (m) {
      e.preventDefault()
      this.activate(m)
    }
  }

  private activate(m: { el: Element; i: number } | null): void {
    const mark = m && this.scene?.marks[m.i]
    if (mark) this.activateMark(mark)
  }

  /** A mark was clicked or chosen from the keyboard: toggle a legend series, or report the data. Also used by the canvas view. */
  activateMark(mark: Mark): void {
    if (mark.legendKey !== undefined) {
      const key = mark.legendKey
      if (this.hidden.has(key)) this.hidden.delete(key)
      else if (this.scene!.series.filter(s => !s.hidden).length > 1) this.hidden.add(key)
      this.options.onHiddenChange?.([...this.hidden])
      this.render(false)
      return
    }
    // A breadcrumb item: back up to that level.
    if (mark.drill !== undefined && mark.role === 'label') {
      if (this.drillOn()) this.drillTo(mark.drill, this.shownFocus())
      return
    }
    // A hit target (the larger circle round a small dot, a line chart's column) reports what it stands for.
    if ((mark.role === 'data' || mark.role === 'hit') && mark.datum !== undefined) this.options.onSelect?.({ datum: mark.datum, series: mark.series, tip: mark.tip })
    // A group of a treemap or sunburst: show only it.
    if (mark.drill !== undefined && mark.role === 'data' && this.drillOn() && !this.disposed) this.drillTo(mark.drill)
  }

  private highlight(series: string): void {
    if (this.highlighted === series) return
    this.highlighted = series
    const els = this.root.querySelectorAll<SVGElement>('.sp-data')
    if (els.length > 3000) return
    els.forEach(el => el.classList.toggle('sp-dimmed', el.getAttribute('data-s') !== series))
  }

  private clearHighlight(): void {
    if (this.highlighted === null) return
    this.highlighted = null
    this.root.querySelectorAll('.sp-dimmed').forEach(el => el.classList.remove('sp-dimmed'))
  }

  private showGuide(mark: Scene['marks'][number]): void {
    const svg = this.root.querySelector('svg')
    if (!svg || !mark.guide) return
    if (!this.overlay) {
      this.overlay = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g')
      this.overlay.setAttribute('pointer-events', 'none')
      svg.appendChild(this.overlay)
    }
    const theme = this.themeNow()
    const ns = 'http://www.w3.org/2000/svg'
    const g = mark.guide
    const line = svg.ownerDocument.createElementNS(ns, 'line')
    for (const [k, v] of Object.entries({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 })) line.setAttribute(k, String(v))
    line.setAttribute('stroke', `var(--sp-axis, ${theme.colors.axis})`)
    line.setAttribute('stroke-width', '1')
    this.overlay.replaceChildren(line)
    for (const f of mark.focus ?? []) {
      const c = svg.ownerDocument.createElementNS(ns, 'circle')
      c.setAttribute('cx', String(f.x))
      c.setAttribute('cy', String(f.y))
      c.setAttribute('r', '5')
      c.setAttribute('fill', f.color)
      c.setAttribute('stroke', `var(--sp-background, ${theme.colors.background})`)
      c.setAttribute('stroke-width', '2')
      this.overlay.appendChild(c)
    }
  }

  private clearGuide(): void {
    this.overlay?.replaceChildren()
  }

  /** `tooltipFormat`'s content for a tip, or null for the default. */
  private customTip(tip: Tip, mark?: Mark | null): string | Node | null {
    const f = this.options.tooltipFormat
    if (!f) return null
    try {
      const r = f(tip, { datum: mark?.datum, series: mark?.series, tip })
      if (typeof r === 'string') return r
      return r && typeof (r as Node).nodeType === 'number' ? r : null
    } catch (e) {
      this.warn('tooltip_format_error', `tooltipFormat threw: ${e instanceof Error ? e.message : String(e)}. The default tooltip was shown.`)
      return null
    }
  }

  private showTip(tip: Tip, x: number, y: number, mark?: Mark | null): void {
    const doc = this.host.ownerDocument
    const theme = this.themeNow()
    const t = this.tip
    t.style.background = `var(--sp-surface, ${theme.colors.surface})`
    t.style.color = `var(--sp-text, ${theme.colors.text})`
    t.style.borderColor = `var(--sp-border, ${theme.colors.border})`
    t.style.fontFamily = `var(--sp-font, ${theme.font})`
    t.replaceChildren()
    const custom = this.customTip(tip, mark)
    if (custom !== null) {
      t.setAttribute('data-custom', '')
      // A string is text, never markup: it cannot inject anything.
      if (typeof custom === 'string') t.textContent = custom
      else t.appendChild(custom)
      t.setAttribute('data-show', '')
      return this.placeTip(x, y)
    }
    t.removeAttribute('data-custom')
    if (tip.title) {
      const b = doc.createElement('b')
      b.textContent = tip.title
      t.appendChild(b)
    }
    for (const r of tip.rows) {
      const row = doc.createElement('div')
      row.className = 'sp-tr'
      const l = doc.createElement('span')
      l.className = 'sp-tl'
      if (r.color) {
        const sw = doc.createElement('i')
        sw.style.background = r.color
        l.appendChild(sw)
      }
      l.appendChild(doc.createTextNode(r.label))
      const v = doc.createElement('span')
      v.className = 'sp-tv'
      v.textContent = r.value
      row.append(l, v)
      t.appendChild(row)
    }
    t.setAttribute('data-show', '')
    this.placeTip(x, y)
  }

  private placeTip(clientX: number, clientY: number): void {
    const box = this.root.getBoundingClientRect()
    const tw = this.tip.offsetWidth
    const th = this.tip.offsetHeight
    let x = clientX - box.left + 14
    let y = clientY - box.top + 14
    if (x + tw > box.width - 4) x = clientX - box.left - tw - 14
    if (y + th > box.height - 4) y = clientY - box.top - th - 14
    this.tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`
  }

  private hideTip(): void {
    this.tip.removeAttribute('data-show')
  }

  // ---- map camera --------------------------------------------------------------------------

  private interactiveMap(): boolean {
    return !!this.scene?.geo && this.options.interactive !== false
  }

  private dragging(): boolean { return this.map?.dragging() === true || this.axis.dragging() }

  /** Zoom buttons, keyboard focus and touch handling for an interactive map; removed for anything else. */
  private setupMap(scene: Scene, theme: Theme): void {
    const on = !!scene.geo && this.options.interactive !== false
    const mod = mapChunk.mod
    if (!mod) {
      // Nothing to take down: no map was drawn without this code.
      if (on) this.need(mapChunk, 'map controls', () => {
        if (!this.scene) return
        this.setupMap(this.scene, this.themeNow())
        const c = this.map?.controls
        // Before the toolbar, as the first draw would have put them.
        if (c && c.parentNode !== this.root) this.root.insertBefore(c, this.bar?.el.parentNode === this.root ? this.bar.el : null)
      })
      return
    }
    this.map ??= new mod.MapControl({
      root: this.root,
      scene: () => this.scene,
      camera: () => this.cam,
      apply: c => this.applyCamera(c),
      gestureSoon: () => this.gestureSoon(),
      endGesture: () => this.endGesture(),
      reset: () => this.reset(true),
      text: (key, vars) => this.t(key, vars),
      hideTip: () => this.hideTip(),
      clearHighlight: () => this.clearHighlight()
    })
    this.map.setup(scene, theme, on)
  }

  private applyCamera(c: Camera): void {
    this.cam = c
    if (this.layer?.moveCamera(c)) this.glMoved = true
    else this.schedule(false)
  }

  /** A gesture ended: bring the compiled scene (tooltips, outlines, exports) up to date and tell the host. */
  private endGesture(notify = true): void {
    clearTimeout(this.gestureTimer)
    this.gestureTimer = 0
    if (this.disposed) return
    if (this.glMoved) this.render(false)
    if (notify && this.cam) this.options.onCameraChange?.(this.cam)
  }

  private gestureSoon(): void {
    clearTimeout(this.gestureTimer)
    this.gestureTimer = window.setTimeout(() => this.endGesture(), 250)
  }

  private syncCamera(): void {
    // An export or a scene read mid-gesture: catch the scene up, but the gesture (and its event) goes on.
    if (this.glMoved) this.render(false)
  }

  private onDown = (e: PointerEvent): void => {
    if (this.interactiveMap()) this.map?.down(e)
  }

  private onDragMove = (e: PointerEvent): void => {
    this.map?.move(e)
  }

  private onUp = (e: PointerEvent): void => {
    this.map?.up(e)
  }

  private onWheel = (e: WheelEvent): void => {
    if (this.interactiveMap()) this.map?.wheel(e)
  }

  /** Arrow keys pan (Shift: turn and tilt), + and - zoom, 0 resets. True when the key was used. */
  private mapKey(e: KeyboardEvent): boolean {
    return this.interactiveMap() && this.map?.key(e) === true
  }

  private onScheme = (): void => {
    if (this.options.theme === 'auto' || this.options.theme === undefined) this.render(false)
  }
}
