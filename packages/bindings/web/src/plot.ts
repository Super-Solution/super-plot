import {
  compilePlot, renderSvg, resolveTheme, estimateWidth, defaultHeight, dataMarkCount,
  type Issue, type Mark, type Measure, type RenderOptions, type Scene, type Tip
} from '@supersolutions/super-plot-core'
import { CanvasLayer } from './canvas.js'
import { ensureStyles } from './styles.js'

export interface SelectEvent {
  /** What the mark carries: the category, series and value (or the bin, slice, cell). */
  datum: unknown
  series?: string
  tip?: Tip
}

export interface SuperPlotOptions extends Omit<RenderOptions, 'hidden' | 'measure'> {
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
   * tens of thousands of marks). `auto` (default) uses canvas above `canvasAbove` data marks.
   */
  renderer?: 'auto' | 'svg' | 'canvas'
  /** Data mark count above which `auto` switches to canvas. Default 4000. */
  canvasAbove?: number
}

let uid = 0

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
    this.spec = spec
    this.render(true)
  }

  /** Change render options (theme, locale, size, ...). */
  setOptions(patch: Partial<SuperPlotOptions>): void {
    this.options = { ...this.options, ...patch }
    if (patch.hidden) this.hidden = new Set(patch.hidden)
    this.render(false)
  }

  getScene(): Scene | null { return this.scene }
  /** What is drawing the chart right now. */
  getRenderer(): 'svg' | 'canvas' { return this.layer ? 'canvas' : 'svg' }
  getIssues(): Issue[] { return this.issues }
  getHidden(): string[] { return [...this.hidden] }

  /** Standalone SVG of what is on screen: colours resolved, no scripts, no hover hooks. */
  toSvg(): string {
    if (!this.scene) throw new Error('Nothing to export: the spec is invalid.')
    const theme = resolveTheme(this.options.theme, this.prefersDark())
    return renderSvg(this.scene, { resolveVars: true, font: theme.font })
  }

  /** PNG of what is on screen. `scale` is the pixel ratio (default: the display's). */
  async toPng(scale = this.host.ownerDocument.defaultView?.devicePixelRatio ?? 2): Promise<Blob> {
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
    clearTimeout(this.enterTimer)
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
    const result = compilePlot(this.spec, { ...o, width, height, hidden: this.hidden, measure: this.measure, prefersDark: this.prefersDark() })
    this.hideTip()
    this.overlay = null
    this.highlighted = null
    if (!result.ok) {
      this.scene = null
      this.issues = result.issues
      this.root.replaceChildren()
      const err = this.host.ownerDocument.createElement('div')
      err.className = 'sp-error'
      err.setAttribute('role', 'alert')
      err.textContent = result.issues.filter(i => i.severity === 'error').map(i => `${i.path || 'spec'}: ${i.message}${i.hint ? ` ${i.hint}` : ''}`).join('\n')
      this.root.appendChild(err)
      this.root.appendChild(this.tip)
      o.onIssues?.(result.issues)
      return
    }
    this.scene = result.scene
    const changed = JSON.stringify(result.issues) !== JSON.stringify(this.issues)
    this.issues = result.issues
    const theme = resolveTheme(o.theme, this.prefersDark())
    const font = `var(--sp-font, ${theme.font})`
    const wantCanvas = o.renderer === 'canvas' || (o.renderer !== 'svg' && dataMarkCount(result.scene) > (o.canvasAbove ?? 4000))
    if (wantCanvas) {
      this.layer ??= CanvasLayer.create(this.host.ownerDocument, {
        tipEnabled: () => this.tipEnabled(),
        showTip: (t, x, y) => this.showTip(t, x, y),
        placeTip: (x, y) => this.placeTip(x, y),
        hideTip: () => this.hideTip(),
        activate: m => this.activateMark(m)
      })
      if (this.layer) {
        const cs = this.host.ownerDocument.defaultView?.getComputedStyle(this.root)
        this.layer.draw(result.scene, font, name => cs?.getPropertyValue(name))
        // Keep the canvas element in place when it is already there: moving it would drop keyboard focus.
        if (this.layer.el.parentNode !== this.root || this.tip.parentNode !== this.root) this.root.replaceChildren(this.layer.el, this.tip)
        this.root.setAttribute('data-renderer', 'canvas')
        if (changed || enter) o.onIssues?.(result.issues)
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
    if (enter && o.animate !== false) {
      this.root.classList.add('sp-enter')
      clearTimeout(this.enterTimer)
      this.enterTimer = window.setTimeout(() => this.root.classList.remove('sp-enter'), 1000)
    }
    if (changed || enter) o.onIssues?.(result.issues)
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
    if (this.layer) return // the canvas view handles its own pointer events
    const m = this.markOf(e.target)
    const mark = m && this.scene?.marks[m.i]
    if (!m || !mark) return this.clearHighlight()
    if (mark.series !== undefined && mark.role !== 'hit') this.highlight(mark.series)
    else if (mark.role === 'hit') this.showGuide(mark)
    if (mark.tip && this.tipEnabled()) this.showTip(mark.tip, e.clientX, e.clientY)
  }

  private onMove = (e: PointerEvent): void => {
    if (this.layer) return
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
  }

  private onFocus = (e: FocusEvent): void => {
    const m = this.markOf(e.target)
    const mark = m && this.scene?.marks[m.i]
    if (!m || !mark?.tip || !this.tipEnabled()) return
    const r = m.el.getBoundingClientRect()
    this.showTip(mark.tip, r.left + r.width / 2, r.top)
    if (mark.series !== undefined) this.highlight(mark.series)
  }

  private onClick = (e: MouseEvent): void => {
    this.activate(this.markOf(e.target))
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') return this.onLeave()
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
    if (mark.role === 'data' && mark.datum !== undefined) this.options.onSelect?.({ datum: mark.datum, series: mark.series, tip: mark.tip })
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

  private onScheme = (): void => {
    if (this.options.theme === 'auto' || this.options.theme === undefined) this.render(false)
  }
}
