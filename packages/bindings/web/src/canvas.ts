import { buildHitIndex, drawHover, drawScene, resolveColor, type Canvas2D, type HitIndex, type Mark, type Path2DCtor, type Scene, type Tip } from '@supersolutions/super-plot-core'

/** What the canvas view needs from the plot that owns it. */
export interface CanvasOwner {
  tipEnabled(): boolean
  showTip(tip: Tip, x: number, y: number): void
  placeTip(x: number, y: number): void
  hideTip(): void
  activate(mark: Mark): void
}

const MAX_PIXELS = 24_000_000

/**
 * Draws a scene on two stacked canvases: the chart (redrawn when the scene changes) and a light overlay for
 * the hovered mark, so moving the mouse over 50,000 dots never redraws them. Legend items are real buttons
 * on top, so keyboard and screen reader users can still toggle series.
 */
export class CanvasLayer {
  readonly el: HTMLDivElement
  private base: HTMLCanvasElement
  private over: HTMLCanvasElement
  private legend: HTMLDivElement
  private ctx: CanvasRenderingContext2D
  private octx: CanvasRenderingContext2D
  private scene: Scene | null = null
  private index: HitIndex | null = null
  private paths = new Map<number, unknown>()
  private hovered = -1
  private dpr = 1
  private resolve: (v: string) => string = v => resolveColor(v)
  private font = ''

  /** Returns null when the browser gives no 2D context (the caller falls back to SVG). */
  static create(doc: Document, owner: CanvasOwner): CanvasLayer | null {
    const base = doc.createElement('canvas')
    const ctx = base.getContext('2d')
    if (!ctx) return null
    const over = doc.createElement('canvas')
    const octx = over.getContext('2d')
    if (!octx) return null
    return new CanvasLayer(doc, owner, base, over, ctx, octx)
  }

  private constructor(doc: Document, private owner: CanvasOwner, base: HTMLCanvasElement, over: HTMLCanvasElement, ctx: CanvasRenderingContext2D, octx: CanvasRenderingContext2D) {
    this.base = base
    this.over = over
    this.ctx = ctx
    this.octx = octx
    this.el = doc.createElement('div')
    this.el.className = 'sp-cv'
    over.style.pointerEvents = 'none'
    this.legend = doc.createElement('div')
    this.legend.className = 'sp-cv-legend'
    this.el.append(base, over, this.legend)
    base.addEventListener('pointermove', this.onMove)
    base.addEventListener('pointerleave', this.onLeave)
    base.addEventListener('click', this.onClick)
  }

  /** Draw (or redraw) a scene. `lookup` reads CSS custom properties so host overrides apply. */
  draw(scene: Scene, font: string, lookup: (name: string) => string | undefined): void {
    const active = this.base.ownerDocument.activeElement as HTMLElement | null
    const focusKey = active && this.legend.contains(active) ? active.dataset.key : undefined
    this.scene = scene
    this.index = buildHitIndex(scene)
    this.paths = new Map()
    this.hovered = -1
    this.resolve = v => resolveColor(v, lookup)
    this.font = font
    const win = this.base.ownerDocument.defaultView
    let dpr = Math.max(1, win?.devicePixelRatio ?? 1)
    while (scene.width * dpr * scene.height * dpr > MAX_PIXELS && dpr > 1) dpr = Math.max(1, dpr - 0.5)
    this.dpr = dpr
    for (const c of [this.base, this.over]) {
      c.width = Math.round(scene.width * dpr)
      c.height = Math.round(scene.height * dpr)
    }
    this.base.setAttribute('role', 'img')
    this.base.setAttribute('aria-label', `${scene.title}. ${scene.description}`)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawScene(this.ctx as unknown as Canvas2D, scene, { font, resolve: this.resolve, Path2D: win?.Path2D as unknown as Path2DCtor | undefined, paths: this.paths })
    this.buildLegend(scene)
    // Toggling a series redraws everything; keep keyboard focus on the same legend item.
    if (focusKey !== undefined) this.legend.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus()
  }

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
    return this.index?.at(x, y, (i, px, py) => {
      const m = this.scene!.marks[i]
      if (m.type !== 'path') return false
      let p = paths.get(i)
      if (!p) {
        const P = this.base.ownerDocument.defaultView?.Path2D
        if (!P) return false
        p = new P(m.d)
        paths.set(i, p)
      }
      return this.ctx.isPointInPath(p as Path2D, px * this.dpr, py * this.dpr)
    }) ?? -1
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.point(e)
    if (!p || !this.scene) return
    const i = this.find(p.x, p.y)
    const mark = i >= 0 ? this.scene.marks[i] : undefined
    if (i !== this.hovered) {
      this.hovered = i
      this.octx.clearRect(0, 0, this.over.width / this.dpr, this.over.height / this.dpr)
      if (mark) drawHover(this.octx as unknown as Canvas2D, this.scene, i, { resolve: this.resolve, Path2D: this.base.ownerDocument.defaultView?.Path2D as unknown as Path2DCtor | undefined, paths: this.paths })
      this.base.style.cursor = mark && (mark.legendKey !== undefined || (mark.role === 'data' && mark.datum !== undefined)) ? 'pointer' : ''
    }
    if (mark?.tip && this.owner.tipEnabled()) {
      if (this.hovered === i) this.owner.showTip(mark.tip, e.clientX, e.clientY)
      this.owner.placeTip(e.clientX, e.clientY)
    } else this.owner.hideTip()
  }

  private onLeave = (): void => {
    this.hovered = -1
    this.octx.clearRect(0, 0, this.over.width / this.dpr, this.over.height / this.dpr)
    this.owner.hideTip()
  }

  private onClick = (e: MouseEvent): void => {
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
