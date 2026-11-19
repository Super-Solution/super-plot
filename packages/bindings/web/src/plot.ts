import {
  compilePlot, renderSvg, resolveTheme, estimateWidth, defaultHeight, dataMarkCount, makeView, dragCamera, zoomCamera, clampCamera, plotTable,
  type Camera, type Issue, type Mark, type Measure, type PlotPlugin, type RenderOptions, type Scene, type Tip, type ViewParams
} from '@supersolutions/super-plot-core/base'
import { CanvasLayer, markCenter } from './canvas.js'
import type * as Gl from './gl/index.js'
import { AxisControl, type BrushSelection, type ZoomRange } from './interact.js'
import { ensureStyles } from './styles.js'

export type { AxisPick, AxisRange, BrushSelection, ZoomRange } from './interact.js'

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
}

let uid = 0
// The WebGL layer is a separate chunk, loaded the first time a plot needs it.
let glModule: typeof Gl | null = null
let warnedGl = false
let glLoading: Promise<typeof Gl> | null = null
const loadGl = (): Promise<typeof Gl> => (glLoading ??= import('./gl/index.js').then(m => (glModule = m)))

/** What identifies "the same map" across setSpec: chart type and geography (a name, or inline). */
const mapKeyOf = (spec: unknown): string => {
  const s = spec as { type?: unknown; geo?: unknown } | null
  return `${String(s?.type)}|${typeof s?.geo === 'string' ? s.geo : s?.geo ? 'inline' : ''}`
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
  private pointers = new Map<number, { x: number; y: number }>()
  private drag: { moved: boolean; turn: boolean } | null = null
  private justDragged = false
  private gestureTimer = 0
  private controls: HTMLDivElement | null = null
  private glWaiting = false
  private axis: AxisControl
  private hoverMark: Mark | null = null
  private table: HTMLTableElement | null = null
  private tableOf: unknown = undefined
  /** `appendRows` keeps its own copy of the rows, so the caller's array is never changed. */
  private rows: unknown[] | null = null
  private appendRaf = 0

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
    this.axis = new AxisControl({
      root: this.root,
      scene: () => this.scene,
      redraw: () => this.schedule(false),
      zoomChanged: z => this.options.onZoom?.(z),
      brushChanged: b => this.options.onBrush?.(b),
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
    this.render(true)
  }

  /** Replace the spec. Plays the entrance animation again. */
  setSpec(spec: unknown): void {
    // A different map (type or geography) starts from its own view; new data on the same map keeps the viewer's.
    if (mapKeyOf(spec) !== mapKeyOf(this.spec)) this.cam = null
    // The same with zoom and brush: they stay while the chart shows the same columns.
    if (axisKeyOf(spec) !== axisKeyOf(this.spec)) this.axis.reset()
    this.spec = spec
    this.rows = null
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
    if (this.appendRaf) return
    this.appendRaf = requestAnimationFrame(() => {
      this.appendRaf = 0
      if (!this.disposed) this.render(false)
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
    const theme = resolveTheme(this.options.theme, this.prefersDark())
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

  /** Stop observing, remove the DOM and listeners. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.appendRaf)
    this.axis.dispose()
    this.table?.remove()
    this.table = null
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

  private schedule(animate: boolean): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      if (!this.disposed) this.render(animate)
    })
  }

  private measure: Measure = (text, size, weight = 400) => {
    const doc = this.host.ownerDocument
    const font = resolveTheme(this.options.theme, this.prefersDark()).font
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
    const h = this.host.clientHeight
    this.root.style.height = prev
    return h
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
    const height = o.height ?? (this.autoHeight ? defaultHeight(this.specType(), width) : Math.floor(this.host.clientHeight) || defaultHeight(this.specType(), width))
    if (o.width !== undefined || o.height !== undefined || this.autoHeight) {
      this.root.style.height = `${height}px`
      if (o.width !== undefined) this.root.style.width = `${o.width}px`
    } else this.root.style.height = ''
    const camera = this.cam ?? o.camera
    const view = this.axis.view
    const result = compilePlot(this.spec, { ...o, width, height, hidden: this.hidden, measure: this.measure, prefersDark: this.prefersDark(), ...(camera ? { camera } : {}), ...(view ? { view } : {}) })
    this.glMoved = false
    this.hideTip()
    this.overlay = null
    this.highlighted = null
    this.hoverMark = null
    if (!result.ok) {
      this.layer?.dispose()
      this.layer = null
      this.scene = null
      this.issues = result.issues
      this.root.replaceChildren()
      const err = this.host.ownerDocument.createElement('div')
      err.className = 'sp-error'
      err.setAttribute('role', 'alert')
      err.textContent = result.issues.filter(i => i.severity === 'error').map(i => `${i.path || 'spec'}: ${i.message}${i.hint ? ` ${i.hint}` : ''}`).join('\n')
      this.root.appendChild(err)
      this.root.appendChild(this.tip)
      this.axis.afterRender()
      this.syncTable()
      o.onIssues?.(result.issues)
      return
    }
    this.scene = result.scene
    const changed = JSON.stringify(result.issues) !== JSON.stringify(this.issues)
    this.issues = result.issues
    const theme = resolveTheme(o.theme, this.prefersDark())
    const font = `var(--sp-font, ${theme.font})`
    const marks = dataMarkCount(result.scene)
    // A map keeps its context once it has one (tilting back to flat must not drop and re-create it).
    const autoGl = (o.renderer ?? 'auto') === 'auto' && (marks > (o.webglAbove ?? 20000) || isDeepMap(result.scene) || (!!result.scene.geo && !!this.layer?.hasGl))
    const wantGl = !this.glOff && (o.renderer === 'webgl' || (autoGl && this.hardwareGl()))
    const wantCanvas = o.renderer === 'canvas' || o.renderer === 'webgl' || wantGl || (o.renderer !== 'svg' && marks > (o.canvasAbove ?? 4000))
    this.setupMap(result.scene, theme)
    if (wantCanvas) {
      this.layer ??= CanvasLayer.create(this.host.ownerDocument, {
        tipEnabled: () => this.tipEnabled(),
        showTip: (t, x, y) => this.showTip(t, x, y),
        placeTip: (x, y) => this.placeTip(x, y),
        hideTip: () => this.hideTip(),
        activate: m => this.activateMark(m),
        dragging: () => this.dragging(),
        hovered: m => this.hovered(m)
      })
      if (this.layer) {
        // One context per plot for its lifetime: creating one costs far more than a redraw.
        if (!wantGl) this.layer.setGl(null)
        else if (!this.layer.hasGl) this.layer.setGl(this.makeGl())
        const cs = this.host.ownerDocument.defaultView?.getComputedStyle(this.root)
        this.layer.draw(result.scene, font, name => cs?.getPropertyValue(name))
        // Keep the canvas element in place when it is already there: moving it would drop keyboard focus.
        if (this.layer.el.parentNode !== this.root || this.tip.parentNode !== this.root) this.root.replaceChildren(this.layer.el, this.tip)
        if (this.controls) this.root.appendChild(this.controls)
        this.root.setAttribute('data-renderer', this.layer.renderer)
        this.afterDraw(result.scene, started, changed || enter, { ctx: this.layer.drawingContext() })
        return
      }
    }
    this.layer?.dispose()
    this.layer = null
    this.root.setAttribute('data-renderer', 'svg')
    const svg = renderSvg(result.scene, { interactive: true, idPrefix: this.id, font })
    const tpl = this.host.ownerDocument.createElement('template')
    tpl.innerHTML = svg
    this.root.replaceChildren(tpl.content, this.tip)
    if (this.controls) this.root.appendChild(this.controls)
    if (enter && !this.drag && o.animate !== false) {
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
    if (report) o.onIssues?.(this.issues)
    o.onRender?.({ renderer, ms: performance.now() - started, scene })
  }

  /** The `dataTable` option: rebuilt when the spec changes, not on every resize. */
  private syncTable(): void {
    const want = this.options.dataTable
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
    if (this.table.parentNode !== this.host) this.host.insertBefore(this.table, this.root.nextSibling)
    if (this.tableOf === this.spec) return
    this.tableOf = this.spec
    const t = plotTable(this.spec)
    this.table.replaceChildren()
    if (!t) return
    const cap = doc.createElement('caption')
    cap.textContent = t.total > t.rows.length ? `${t.caption}: first ${t.rows.length} of ${t.total} rows` : t.caption
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
  }

  /** A WebGL layer for this plot, or null (not loaded yet, unavailable, or a software GPU under `auto`). */
  /**
   * `auto` uses WebGL only on a hardware GPU. Until the WebGL chunk is loaded that is unknown: draw without it,
   * load it, and decide again once it is here.
   */
  private hardwareGl(): boolean {
    if (!glModule) {
      this.whenGlLoads(() => !glModule!.probeWebGL(this.host.ownerDocument).software)
      return false
    }
    const probe = glModule.probeWebGL(this.host.ownerDocument)
    return probe.ok && !probe.software
  }

  /** Render again once the WebGL chunk is here (one pending request per plot, however many renders asked). */
  private whenGlLoads(worth: () => boolean): void {
    if (this.glWaiting) return
    this.glWaiting = true
    loadGl().then(() => {
      this.glWaiting = false
      if (!this.disposed && !this.glOff && worth()) this.render(false)
    }, () => {
      this.glWaiting = false
      this.glOff = true
    })
  }

  private makeGl(): Gl.GlView | null {
    const doc = this.host.ownerDocument
    if (!glModule) {
      this.whenGlLoads(() => true)
      return null
    }
    const v = glModule.GlView.create(doc, () => this.onGlLost())
    if (!v) {
      this.glOff = true
      // Asked for explicitly: say once why the plot is on canvas instead.
      if (this.options.renderer === 'webgl' && !warnedGl) {
        warnedGl = true
        console.warn(`Super Plot: WebGL is not available (${glModule.GlView.lastError}); drawing on canvas.`)
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

  private onOver = (e: PointerEvent): void => {
    if (this.layer || this.dragging()) return // the canvas view handles its own pointer events
    const m = this.markOf(e.target)
    const mark = m && this.scene?.marks[m.i]
    this.hovered(mark ?? null)
    if (!m || !mark) return this.clearHighlight()
    if (mark.series !== undefined && mark.role !== 'hit') this.highlight(mark.series)
    else if (mark.role === 'hit') this.showGuide(mark)
    if (mark.tip && this.tipEnabled()) this.showTip(mark.tip, e.clientX, e.clientY)
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
    this.showTip(mark.tip, r.left + r.width / 2, r.top)
    if (mark.series !== undefined) this.highlight(mark.series)
  }

  private onClick = (e: MouseEvent): void => {
    if (this.dragging()) return
    this.activate(this.markOf(e.target))
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') return this.onLeave()
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
    // A hit target (the larger circle round a small dot, a line chart's column) reports what it stands for.
    if ((mark.role === 'data' || mark.role === 'hit') && mark.datum !== undefined) this.options.onSelect?.({ datum: mark.datum, series: mark.series, tip: mark.tip })
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
    const theme = resolveTheme(this.options.theme, this.prefersDark())
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

  private showTip(tip: Tip, x: number, y: number): void {
    const doc = this.host.ownerDocument
    const theme = resolveTheme(this.options.theme, this.prefersDark())
    const t = this.tip
    t.style.background = `var(--sp-surface, ${theme.colors.surface})`
    t.style.color = `var(--sp-text, ${theme.colors.text})`
    t.style.borderColor = `var(--sp-border, ${theme.colors.border})`
    t.style.fontFamily = `var(--sp-font, ${theme.font})`
    t.replaceChildren()
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

  private dragging(): boolean { return this.drag?.moved === true || this.justDragged || this.axis.dragging() }

  /** Zoom buttons, keyboard focus and touch handling for an interactive map; removed for anything else. */
  private setupMap(scene: Scene, theme: ReturnType<typeof resolveTheme>): void {
    const on = !!scene.geo && this.options.interactive !== false
    if (!on) {
      this.controls?.remove()
      this.controls = null
      this.root.removeAttribute('data-map')
      for (const a of ['role', 'aria-roledescription', 'aria-label', 'aria-keyshortcuts']) this.root.removeAttribute(a)
      if (this.root.getAttribute('tabindex') === '0' && this.root.dataset.spMapTab) {
        this.root.removeAttribute('tabindex')
        delete this.root.dataset.spMapTab
      }
      return
    }
    this.root.setAttribute('data-map', '')
    if (!this.root.hasAttribute('tabindex')) {
      this.root.tabIndex = 0
      this.root.dataset.spMapTab = '1'
    }
    this.root.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + - 0')
    this.root.setAttribute('role', 'group')
    this.root.setAttribute('aria-roledescription', 'interactive map')
    this.root.setAttribute('aria-label', `${scene.title}. Drag or use the arrow keys to move, Shift with them to turn and tilt, + and - to zoom, 0 to reset.`)
    if (!this.controls) {
      const doc = this.host.ownerDocument
      const box = doc.createElement('div')
      box.className = 'sp-ctl'
      const add = (label: string, text: string, act: () => void): void => {
        const b = doc.createElement('button')
        b.type = 'button'
        b.textContent = text
        b.setAttribute('aria-label', label)
        b.title = label
        b.addEventListener('click', e => { e.stopPropagation(); act() })
        box.appendChild(b)
      }
      add('Zoom in', '+', () => this.zoomBy(1.5))
      add('Zoom out', '\u2212', () => this.zoomBy(1 / 1.5))
      add('Reset view', '\u27F2', () => this.reset(true))
      this.controls = box
    }
    for (const b of this.controls.querySelectorAll<HTMLButtonElement>('button')) {
      b.style.background = `var(--sp-surface, ${theme.colors.surface})`
      b.style.color = `var(--sp-text, ${theme.colors.text})`
      b.style.borderColor = `var(--sp-border, ${theme.colors.border})`
    }
  }

  /** The view as it is on screen now (it may be ahead of the compiled scene during a gesture). */
  private liveView(): ViewParams | null {
    const geo = this.scene?.geo
    if (!geo) return null
    return this.cam ? makeView({ ...geo.input, camera: this.cam }) : geo.view
  }

  private applyCamera(c: Camera): void {
    this.cam = c
    if (this.layer?.moveCamera(c)) this.glMoved = true
    else this.schedule(false)
  }

  private zoomBy(factor: number): void {
    const v = this.liveView()
    if (!v) return
    this.applyCamera(zoomCamera(v, factor))
    this.gestureSoon()
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

  /** Screen pixels to scene pixels. */
  private sceneScale(): number {
    const w = this.root.getBoundingClientRect().width
    return this.scene && w > 0 ? this.scene.width / w : 1
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.interactiveMap()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as Element | null)?.closest?.('.sp-ctl, .sp-cv-lk, [data-lk]')) return
    // No pointer capture yet: a click that never becomes a drag must still reach the mark under it.
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 1) this.drag = { moved: false, turn: e.shiftKey }
  }

  private onDragMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId)
    if (!prev || !this.drag) return
    const now = { x: e.clientX, y: e.clientY }
    if (this.pointers.size >= 2) {
      // Pinch: the change in distance between the first two fingers.
      const [a, b] = [...this.pointers.entries()]
      const other = a[0] === e.pointerId ? b[1] : a[1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(now.x - other.x, now.y - other.y)
      this.pointers.set(e.pointerId, now)
      if (before > 4 && after > 4) {
        this.drag.moved = true
        const v = this.liveView()
        if (v) this.applyCamera(zoomCamera(v, after / before))
      }
      return
    }
    const k = this.sceneScale()
    const dx = (now.x - prev.x) * k, dy = (now.y - prev.y) * k
    if (!this.drag.moved && Math.hypot(now.x - prev.x, now.y - prev.y) < 3) return
    this.pointers.set(e.pointerId, now)
    if (!this.drag.moved) {
      this.drag.moved = true
      try { this.root.setPointerCapture?.(e.pointerId) } catch { /* not capturable (synthetic event) */ }
      this.root.setAttribute('data-drag', '')
      this.hideTip()
      this.clearHighlight()
    }
    const v = this.liveView()
    if (v) this.applyCamera(dragCamera(v, dx, dy, this.drag.turn || e.shiftKey))
  }

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return
    if (this.pointers.size) return
    const moved = this.drag?.moved
    this.drag = null
    this.root.removeAttribute('data-drag')
    if (moved) {
      // The click that follows a drag must not select what is under the pointer.
      this.justDragged = true
      setTimeout(() => { this.justDragged = false }, 0)
      this.endGesture()
    }
  }

  private onWheel = (e: WheelEvent): void => {
    // Plain scrolling scrolls the page; zoom needs Ctrl/⌘ (a trackpad pinch sends Ctrl too).
    if (!this.interactiveMap() || !(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const v = this.liveView()
    if (!v) return
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0025
    this.applyCamera(zoomCamera(v, Math.exp(-e.deltaY * unit)))
    this.gestureSoon()
  }

  /** Arrow keys pan (Shift: turn and tilt), + and - zoom, 0 resets. True when the key was used. */
  private mapKey(e: KeyboardEvent): boolean {
    if (!this.interactiveMap() || e.altKey || e.ctrlKey || e.metaKey) return false
    const t = e.target as Element | null
    if (t && t !== this.root && t.closest?.('button, input, select, textarea, [data-lk]')) return false
    const v = this.liveView()
    if (!v) return false
    const step = 60
    let c: Camera | null = null
    switch (e.key) {
      case 'ArrowLeft': c = e.shiftKey ? clampCamera({ ...v.camera, bearing: v.camera.bearing - 15 }) : dragCamera(v, step, 0); break
      case 'ArrowRight': c = e.shiftKey ? clampCamera({ ...v.camera, bearing: v.camera.bearing + 15 }) : dragCamera(v, -step, 0); break
      case 'ArrowUp': c = e.shiftKey ? clampCamera({ ...v.camera, pitch: v.camera.pitch + 5 }) : dragCamera(v, 0, step); break
      case 'ArrowDown': c = e.shiftKey ? clampCamera({ ...v.camera, pitch: v.camera.pitch - 5 }) : dragCamera(v, 0, -step); break
      case '+': case '=': c = zoomCamera(v, 1.25); break
      case '-': case '_': c = zoomCamera(v, 1 / 1.25); break
      case '0': e.preventDefault(); this.reset(true); return true
      default: return false
    }
    e.preventDefault()
    // In SVG the redraw replaces the focused region: keep keyboard focus on the map itself.
    const doc = this.host.ownerDocument
    if (doc.activeElement !== this.root && this.root.contains(doc.activeElement)) this.root.focus({ preventScroll: true })
    this.applyCamera(c)
    this.gestureSoon()
    return true
  }

  private onScheme = (): void => {
    if (this.options.theme === 'auto' || this.options.theme === undefined) this.render(false)
  }
}
