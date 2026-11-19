import { buildHitIndex, drawHover, drawScene, resolveColor, type Camera, type Canvas2D, type HitIndex, type Mark, type Path2DCtor, type Scene, type Tip, type ViewParams } from '@supersolutions/super-plot-core'
import type { GlView } from './gl/index.js'

/** What the canvas view needs from the plot that owns it. */
export interface CanvasOwner {
  tipEnabled(): boolean
  showTip(tip: Tip, x: number, y: number): void
  placeTip(x: number, y: number): void
  hideTip(): void
  activate(mark: Mark): void
  /** The viewer is dragging the map: no hover until they let go. */
  dragging(): boolean
}

const MAX_PIXELS = 24_000_000

/**
 * Draws a scene on stacked canvases: the chart (redrawn when the scene changes) and a light overlay for the
 * hovered mark, so moving the mouse over 50,000 dots never redraws them. With a WebGL layer, the marks it
 * takes (dense dots, a map's geography) are drawn by the GPU between a 2D canvas below (background, grid,
 * axes) and one above (labels, legend, title). Legend items are real buttons on top, so keyboard and screen
 * reader users can still toggle series.
 */
export class CanvasLayer {
  readonly el: HTMLDivElement
  private base: HTMLCanvasElement
  private top: HTMLCanvasElement
  private over: HTMLCanvasElement
  private legend: HTMLDivElement
  private ctx: CanvasRenderingContext2D
  private tctx: CanvasRenderingContext2D
  private octx: CanvasRenderingContext2D
  private scene: Scene | null = null
  private index: HitIndex | null = null
  private paths = new Map<number, unknown>()
  private hovered = -1
  private dpr = 1
  private resolve: (v: string) => string = v => resolveColor(v)
  private font = ''
  private gl: GlView | null = null
  /** The map camera moved on the GPU since the scene was compiled: 2D outlines no longer line up. */
  private stale = false

  /** Returns null when the browser gives no 2D context (the caller falls back to SVG). */
  static create(doc: Document, owner: CanvasOwner): CanvasLayer | null {
    const ctxs: [HTMLCanvasElement, CanvasRenderingContext2D][] = []
    for (let i = 0; i < 3; i++) {
      const c = doc.createElement('canvas')
      const x = c.getContext('2d')
      if (!x) return null
      ctxs.push([c, x])
    }
    return new CanvasLayer(doc, owner, ctxs)
  }

  private constructor(doc: Document, private owner: CanvasOwner, c: [HTMLCanvasElement, CanvasRenderingContext2D][]) {
    ;[[this.base, this.ctx], [this.top, this.tctx], [this.over, this.octx]] = c
    this.el = doc.createElement('div')
    this.el.className = 'sp-cv'
    this.top.style.pointerEvents = 'none'
    this.over.style.pointerEvents = 'none'
    this.top.setAttribute('aria-hidden', 'true')
    this.over.setAttribute('aria-hidden', 'true')
    this.legend = doc.createElement('div')
    this.legend.className = 'sp-cv-legend'
    // The canvas above the GPU layer joins only with it: without WebGL the view is the base and the overlay.
    this.el.append(this.base, this.over, this.legend)
    this.base.addEventListener('pointermove', this.onMove)
    this.base.addEventListener('pointerleave', this.onLeave)
    this.base.addEventListener('click', this.onClick)
  }

  /** Attach (or detach, with null) the WebGL layer. The caller redraws afterwards. */
  setGl(gl: GlView | null): void {
    if (this.gl === gl) return
    this.gl?.dispose()
    this.gl = gl
    if (gl) this.el.insertBefore(this.top, this.over)
    else this.top.remove()
    if (gl) this.el.insertBefore(gl.canvas, this.top)
  }

  get hasGl(): boolean { return !!this.gl && !this.gl.isLost }

  /** What draws the data right now. */
  get renderer(): 'canvas' | 'webgl' { return this.gl && !this.gl.isLost ? 'webgl' : 'canvas' }

  /** Draw (or redraw) a scene. `lookup` reads CSS custom properties so host overrides apply. */
  draw(scene: Scene, font: string, lookup: (name: string) => string | undefined): void {
    const active = this.base.ownerDocument.activeElement as HTMLElement | null
    const focusKey = active && this.legend.contains(active) ? active.dataset.key : undefined
    this.scene = scene
    this.stale = false
    this.paths = new Map()
    this.hovered = -1
    this.resolve = v => resolveColor(v, lookup)
    this.font = font
    const win = this.base.ownerDocument.defaultView
    let dpr = Math.max(1, win?.devicePixelRatio ?? 1)
    while (scene.width * dpr * scene.height * dpr > MAX_PIXELS && dpr > 1) dpr = Math.max(1, dpr - 0.5)
    this.dpr = dpr
    for (const c of [this.base, this.top, this.over]) {
      c.width = Math.round(scene.width * dpr)
      c.height = Math.round(scene.height * dpr)
    }
    this.base.setAttribute('role', 'img')
    this.base.setAttribute('aria-label', `${scene.title}. ${scene.description}`)
    for (const x of [this.ctx, this.tctx, this.octx]) {
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.clearRect(0, 0, this.base.width, this.base.height)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const P = win?.Path2D as unknown as Path2DCtor | undefined
    const gl = this.gl && !this.gl.isLost ? this.gl : null
    if (gl) {
      const takes = gl.takes(scene)
      const first = scene.marks.findIndex(takes)
      // Marks before the first GPU mark go below it, the rest above: background and axes under the dots,
      // text and legend over them.
      drawScene(this.ctx as unknown as Canvas2D, scene, { font, resolve: this.resolve, Path2D: P, paths: this.paths, filter: (m, i) => !takes(m) && (first < 0 || i < first) })
      if (first >= 0) drawScene(this.tctx as unknown as Canvas2D, scene, { font, resolve: this.resolve, Path2D: P, paths: this.paths, transparent: true, filter: (m, i) => !takes(m) && i > first })
      gl.set(scene, dpr, this.resolve)
      // Geography is picked on the GPU; the 2D index keeps the rest (legend, labels with tips).
      this.index = buildHitIndex(scene.geo ? { ...scene, marks: scene.marks.map(m => (m.layer === 'geo' ? { ...m, tip: undefined, legendKey: undefined } : m)) } : scene)
    } else {
      drawScene(this.ctx as unknown as Canvas2D, scene, { font, resolve: this.resolve, Path2D: P, paths: this.paths })
      this.index = buildHitIndex(scene)
    }
    this.buildLegend(scene)
    // Toggling a series redraws everything; keep keyboard focus on the same legend item.
    if (focusKey !== undefined) this.legend.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus()
  }

  /**
   * Move a map's camera on the GPU without recompiling. Returns false when there is no WebGL map (the caller
   * recompiles instead).
   */
  moveCamera(camera: Partial<Camera>): boolean {
    if (!this.gl || this.gl.isLost || !this.scene?.geo) return false
    if (!this.gl.setCamera(camera)) return false
    this.stale = true
    this.clearHover()
    return true
  }

  /** The view on screen (after `moveCamera`), or null. */
  view(): ViewParams | null { return this.gl && !this.gl.isLost ? this.gl.getView() : null }

  /** PNG at `scale` (default: the screen's pixel ratio), drawn fresh so it does not depend on the screen canvas. */
  toBlob(scale: number): Promise<Blob> {
    const scene = this.scene
    if (!scene) return Promise.reject(new Error('Nothing to export: the spec is invalid.'))
    const doc = this.base.ownerDocument
    const c = doc.createElement('canvas')
    c.width = Math.round(scene.width * scale)
    c.height = Math.round(scene.height * scale)
    const ctx = c.getContext('2d')!
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    drawScene(ctx as unknown as Canvas2D, scene, { font: this.font, resolve: this.resolve, Path2D: doc.defaultView?.Path2D as unknown as Path2DCtor | undefined })
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode the PNG.'))), 'image/png'))
  }

  dispose(): void {
    this.base.removeEventListener('pointermove', this.onMove)
    this.base.removeEventListener('pointerleave', this.onLeave)
    this.base.removeEventListener('click', this.onClick)
    this.gl?.dispose()
    this.gl = null
    this.el.remove()
    this.scene = null
    this.index = null
    this.paths.clear()
  }

  private point(e: MouseEvent): { x: number; y: number } | null {
    const s = this.scene
    if (!s) return null
    const r = this.base.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: ((e.clientX - r.left) * s.width) / r.width, y: ((e.clientY - r.top) * s.height) / r.height }
  }

  private find(x: number, y: number): number {
    const paths = this.paths
    const hit = this.index?.at(x, y, (i, px, py) => {
      const m = this.scene!.marks[i]
      if (m.type !== 'path' || !(m.tip || m.legendKey !== undefined || m.role === 'hit')) return false
      if (this.gl && m.layer === 'geo') return false
      let p = paths.get(i)
      if (!p) {
        const P = this.base.ownerDocument.defaultView?.Path2D
        if (!P) return false
        p = new P(m.d)
        paths.set(i, p)
      }
      return this.ctx.isPointInPath(p as Path2D, px * this.dpr, py * this.dpr, m.rule === 'evenodd' ? 'evenodd' : 'nonzero')
    }) ?? -1
    if (hit >= 0 || !this.gl || this.gl.isLost || !this.scene?.geo) return hit
    return this.gl.pick(x, y)
  }

  private clearHover(): void {
    this.hovered = -1
    this.octx.clearRect(0, 0, this.over.width / this.dpr, this.over.height / this.dpr)
  }

  private onMove = (e: PointerEvent): void => {
    if (this.owner.dragging()) return
    const p = this.point(e)
    if (!p || !this.scene) return
    const i = this.find(p.x, p.y)
    const mark = i >= 0 ? this.scene.marks[i] : undefined
    if (i !== this.hovered) {
      this.clearHover()
      this.hovered = i
      // After a GPU camera move, a 2D outline would sit where the region used to be: show the tooltip only.
      if (mark && !(this.stale && mark.layer === 'geo')) drawHover(this.octx as unknown as Canvas2D, this.scene, i, { resolve: this.resolve, Path2D: this.base.ownerDocument.defaultView?.Path2D as unknown as Path2DCtor | undefined, paths: this.paths })
      this.base.style.cursor = mark && (mark.legendKey !== undefined || (mark.role === 'data' && mark.datum !== undefined)) ? 'pointer' : ''
    }
    if (mark?.tip && this.owner.tipEnabled()) {
      if (this.hovered === i) this.owner.showTip(mark.tip, e.clientX, e.clientY)
      this.owner.placeTip(e.clientX, e.clientY)
    } else this.owner.hideTip()
  }

  private onLeave = (): void => {
    this.clearHover()
    this.owner.hideTip()
  }

  private onClick = (e: MouseEvent): void => {
    if (this.owner.dragging()) return
    const p = this.point(e)
    if (!p || !this.scene) return
    const i = this.find(p.x, p.y)
    if (i >= 0) this.owner.activate(this.scene.marks[i])
  }

  private buildLegend(scene: Scene): void {
    const doc = this.base.ownerDocument
    const items: HTMLElement[] = []
    for (const m of scene.marks) {
      if (m.legendKey === undefined || m.type !== 'rect') continue
      const b = doc.createElement('button')
      b.type = 'button'
      b.className = 'sp-cv-lk'
      b.dataset.key = m.legendKey
      b.setAttribute('aria-label', m.aria ?? m.legendKey)
      const hidden = scene.series.find(s => s.key === m.legendKey)?.hidden === true
      b.setAttribute('aria-pressed', String(!hidden))
      b.style.cssText = `left:${(m.x / scene.width) * 100}%;top:${(m.y / scene.height) * 100}%;width:${(m.w / scene.width) * 100}%;height:${(m.h / scene.height) * 100}%`
      b.addEventListener('click', () => this.owner.activate(m))
      items.push(b)
    }
    this.legend.replaceChildren(...items)
  }
}
