import { buildHitIndex, drawHover, drawPatternTile, drawScene, resolveColor, type Camera, type Canvas2D, type HitIndex, type Mark, type Path2DCtor, type Scene, type Tip, type ViewParams } from '@supersolutions/super-plot-core/base'
import type { GlView } from './gl/index.js'
import { parseRgb, rasterDots, type DotRun } from './stamp.js'

/** What the canvas view needs from the plot that owns it. */
export interface CanvasOwner {
  tipEnabled(): boolean
  /** Show `tip` at client coordinates; `mark` is what it belongs to (for `tooltipFormat`). */
  showTip(tip: Tip, x: number, y: number, mark?: Mark): void
  placeTip(x: number, y: number): void
  hideTip(): void
  activate(mark: Mark): void
  /** The viewer is dragging the map: no hover until they let go. */
  dragging(): boolean
  /** The hovered (or keyboard-focused) mark changed. */
  hovered(mark: Mark | null): void
}

/** Where a mark sits, for keyboard order and for placing its tooltip. */
export function markCenter(m: Mark): { x: number; y: number } | null {
  switch (m.type) {
    case 'circle': return { x: m.cx, y: m.cy }
    case 'rect': return { x: m.x + m.w / 2, y: m.y + m.h / 2 }
    case 'text': return { x: m.x, y: m.y }
    case 'line': return { x: (m.x1 + m.x2) / 2, y: (m.y1 + m.y2) / 2 }
    case 'path': return m.focus?.[0] ? { x: m.focus[0].x, y: m.focus[0].y } : null
    default: return null
  }
}

/** Plain text of a tooltip, for a screen reader. */
export const tipText = (t: Tip): string => [t.title, ...t.rows.map(r => `${r.label} ${r.value}`)].filter(Boolean).join(', ')

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
  private live: HTMLDivElement
  /** Marks the keyboard steps through (those with a tooltip), in reading order; built on first use. */
  private order: number[] | null = null
  private cursor = -1
  private scratch: HTMLCanvasElement | null = null
  private tiles = new Map<number, unknown>()
  private rgbCache = new Map<string, { rgb: [number, number, number]; alpha: number } | null>()

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
    this.live = doc.createElement('div')
    this.live.className = 'sp-live'
    this.live.setAttribute('aria-live', 'polite')
    // The canvas above the GPU layer joins only with it: without WebGL the view is the base and the overlay.
    this.el.append(this.base, this.over, this.legend, this.live)
    this.base.tabIndex = 0
    this.base.addEventListener('pointermove', this.onMove)
    this.base.addEventListener('pointerleave', this.onLeave)
    this.base.addEventListener('click', this.onClick)
    this.base.addEventListener('keydown', this.onKey)
    this.base.addEventListener('blur', this.onBlur)
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

  /** The topmost 2D context, in scene pixels: where a plugin draws over the chart. */
  drawingContext(): CanvasRenderingContext2D { return this.gl && !this.gl.isLost ? this.tctx : this.ctx }

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
    this.order = null
    this.cursor = -1
    this.tiles.clear()
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
    // A map has its own keyboard on the plot root; other charts step through their marks from here.
    this.base.tabIndex = scene.geo ? -1 : 0
    this.base.setAttribute('aria-label', `${scene.title}. ${scene.description}${scene.geo ? '' : ' Use the arrow keys to move between marks.'}`)
    for (const x of [this.ctx, this.tctx, this.octx]) {
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.clearRect(0, 0, this.base.width, this.base.height)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const P = win?.Path2D as unknown as Path2DCtor | undefined
    const fast = { dots: (run: DotRun & { fill: string; opacity: number }) => this.stamp(this.ctx, run), pattern: (i: number) => this.patternFor(i, scene) }
    const gl = this.gl && !this.gl.isLost ? this.gl : null
    if (gl) {
      const takes = gl.takes(scene)
      const first = scene.marks.findIndex(takes)
      // Marks before the first GPU mark go below it, the rest above: background and axes under the dots,
      // text and legend over them.
      drawScene(this.ctx as unknown as Canvas2D, scene, { font, resolve: this.resolve, Path2D: P, paths: this.paths, pattern: fast.pattern, filter: (m, i) => !takes(m) && (first < 0 || i < first) })
      if (first >= 0) drawScene(this.tctx as unknown as Canvas2D, scene, { font, resolve: this.resolve, Path2D: P, paths: this.paths, pattern: fast.pattern, transparent: true, filter: (m, i) => !takes(m) && i > first })
      gl.set(scene, dpr, this.resolve)
      // Geography is picked on the GPU; the 2D index keeps the rest (legend, labels with tips).
      this.index = buildHitIndex(scene.geo ? { ...scene, marks: scene.marks.map(m => (m.layer === 'geo' ? { ...m, tip: undefined, legendKey: undefined } : m)) } : scene)
    } else {
      drawScene(this.ctx as unknown as Canvas2D, scene, { font, resolve: this.resolve, Path2D: P, paths: this.paths, ...fast })
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
    drawScene(ctx as unknown as Canvas2D, scene, { font: this.font, resolve: this.resolve, Path2D: doc.defaultView?.Path2D as unknown as Path2DCtor | undefined, pattern: i => this.patternFor(i, scene, ctx, scale), dots: run => this.stamp(ctx, run, scale, c) })
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode the PNG.'))), 'image/png'))
  }

  dispose(): void {
    this.base.removeEventListener('pointermove', this.onMove)
    this.base.removeEventListener('pointerleave', this.onLeave)
    this.base.removeEventListener('click', this.onClick)
    this.base.removeEventListener('keydown', this.onKey)
    this.base.removeEventListener('blur', this.onBlur)
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
      this.owner.hovered(mark && mark.legendKey === undefined ? mark : null)
    }
    if (mark?.tip && this.owner.tipEnabled()) {
      if (this.hovered === i) this.owner.showTip(mark.tip, e.clientX, e.clientY, mark)
      this.owner.placeTip(e.clientX, e.clientY)
    } else this.owner.hideTip()
  }

  private onLeave = (): void => {
    if (this.hovered >= 0) this.owner.hovered(null)
    this.clearHover()
    this.owner.hideTip()
  }

  /** Read `text` out through this view's live region. */
  announce(text: string): void { this.live.textContent = text }

  /** The mark the keyboard is on, if any. */
  focusedMark(): Mark | null {
    const o = this.order
    return o && this.cursor >= 0 && this.scene ? this.scene.marks[o[this.cursor]] ?? null : null
  }

  private onBlur = (): void => {
    this.cursor = -1
    this.onLeave()
  }

  /** Marks with a tooltip, left to right then top to bottom (legend items have their own buttons). */
  private keyOrder(): number[] {
    if (this.order) return this.order
    const s = this.scene!
    const items: { i: number; x: number; y: number }[] = []
    // A line chart's columns (one stop per x, with the crosshair) when it has them, else the data marks.
    const columns = s.marks.some(m => m.role === 'hit' && m.guide)
    s.marks.forEach((m, i) => {
      if (!m.tip || m.legendKey !== undefined || (columns ? !(m.role === 'hit' && m.guide) : m.role !== 'data')) return
      const c = markCenter(m)
      if (c) items.push({ i, ...c })
    })
    items.sort((a, b) => a.x - b.x || a.y - b.y)
    this.order = items.map(t => t.i)
    return this.order
  }

  /**
   * Arrow keys move between marks (Left/Right in x order, Up/Down to the nearest mark above or below), Home and
   * End jump to the ends, Enter or Space selects. Each step shows the hover outline and tooltip and is read out.
   */
  private onKey = (e: KeyboardEvent): void => {
    const s = this.scene
    if (!s || s.geo || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const order = this.keyOrder()
    if (!order.length) return
    let next = this.cursor
    const cur = this.cursor >= 0 ? markCenter(s.marks[order[this.cursor]]) : null
    switch (e.key) {
      case 'ArrowRight': next = Math.min(order.length - 1, this.cursor + 1); break
      case 'ArrowLeft': next = this.cursor < 0 ? 0 : Math.max(0, this.cursor - 1); break
      case 'Home': next = 0; break
      case 'End': next = order.length - 1; break
      case 'ArrowUp': case 'ArrowDown': {
        if (!cur) { next = 0; break }
        const up = e.key === 'ArrowUp'
        let best = -1, bestD = Infinity
        for (let k = 0; k < order.length; k++) {
          const c = markCenter(s.marks[order[k]])
          if (!c || (up ? c.y >= cur.y - 0.5 : c.y <= cur.y + 0.5)) continue
          const d = Math.abs(c.x - cur.x) * 3 + Math.abs(c.y - cur.y)
          if (d < bestD) { bestD = d; best = k }
        }
        if (best >= 0) next = best
        break
      }
      case 'Enter': case ' ':
        if (this.cursor >= 0) { e.preventDefault(); this.owner.activate(s.marks[order[this.cursor]]) }
        return
      default: return
    }
    e.preventDefault()
    e.stopPropagation()
    if (next < 0) return
    this.cursor = next
    this.focusMark(order[next])
  }

  private focusMark(i: number): void {
    const m = this.scene!.marks[i]
    this.paintMark(i, () => {
      this.owner.hovered(m)
      if (m.tip) this.live.textContent = tipText(m.tip)
    })
  }

  /**
   * Show mark `i` as hovered (outline, guide, tooltip) without telling the owner: what a synchronised plot
   * shows for a value hovered in another one. -1 clears it.
   */
  showMark(i: number): void {
    if (!this.scene || i < 0 || i >= this.scene.marks.length) {
      this.clearHover()
      this.owner.hideTip()
      return
    }
    this.paintMark(i)
  }

  private paintMark(i: number, before?: () => void): void {
    const s = this.scene!
    const m = s.marks[i]
    this.clearHover()
    this.hovered = i
    drawHover(this.octx as unknown as Canvas2D, s, i, { resolve: this.resolve, Path2D: this.base.ownerDocument.defaultView?.Path2D as unknown as Path2DCtor | undefined, paths: this.paths })
    before?.()
    const c = m.guide ? { x: m.guide.x1, y: m.focus?.[0]?.y ?? (m.guide.y1 + m.guide.y2) / 2 } : markCenter(m)
    if (!m.tip || !c || !this.owner.tipEnabled()) return this.owner.hideTip()
    const r = this.base.getBoundingClientRect()
    const x = r.left + (c.x * r.width) / s.width, y = r.top + (c.y * r.height) / s.height
    this.owner.showTip(m.tip, x, y, m)
  }

  /** Stamp a run of dots as pixels (see `rasterDots`); false hands it back to path drawing. */
  private stamp(ctx: CanvasRenderingContext2D, run: DotRun & { fill: string; opacity: number }, scale = this.dpr, canvas: HTMLCanvasElement = this.base): boolean {
    if (typeof ctx.drawImage !== 'function' || typeof ImageData === 'undefined') return false
    let col = this.rgbCache.get(run.fill)
    if (col === undefined) {
      const probe = this.octx
      probe.save()
      probe.fillStyle = '#000000'
      probe.fillStyle = run.fill
      col = parseRgb(String(probe.fillStyle))
      probe.restore()
      this.rgbCache.set(run.fill, col)
    }
    if (!col) return false
    const img = rasterDots(run, scale, col.rgb, canvas.width, canvas.height)
    if (!img) return false
    if (!img.w) return true
    const doc = this.base.ownerDocument
    const sc = (this.scratch ??= doc.createElement('canvas'))
    if (sc.width < img.w || sc.height < img.h) {
      sc.width = Math.max(sc.width, img.w)
      sc.height = Math.max(sc.height, img.h)
    }
    const sx = sc.getContext('2d')
    if (!sx || typeof sx.putImageData !== 'function') return false
    sx.clearRect(0, 0, img.w, img.h)
    sx.putImageData(new ImageData(img.data, img.w, img.h), 0, 0)
    ctx.save()
    // The clip set for this run stays in force: it lives in device space.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = run.opacity * col.alpha
    ctx.drawImage(sc, 0, 0, img.w, img.h, img.x, img.y, img.w, img.h)
    ctx.restore()
    return true
  }

  /** A repeating fill for texture `i`, drawn at device resolution in the background ink. */
  private patternFor(i: number, scene: Scene, ctx: CanvasRenderingContext2D = this.ctx, scale = this.dpr): unknown {
    const key = i + scale * 1000
    if (this.tiles.has(key)) return this.tiles.get(key)
    const doc = this.base.ownerDocument
    const t = doc.createElement('canvas')
    const px = Math.max(1, Math.round(8 * scale))
    t.width = t.height = px
    const tx = t.getContext('2d')
    let pat: CanvasPattern | null = null
    if (tx) {
      tx.scale(px / 8, px / 8)
      drawPatternTile(tx as unknown as Canvas2D, i, this.resolve(scene.background), doc.defaultView?.Path2D as unknown as Path2DCtor | undefined)
      pat = ctx.createPattern(t, 'repeat')
      const M = doc.defaultView?.DOMMatrix
      if (pat && M) pat.setTransform(new M().scale(8 / px))
    }
    this.tiles.set(key, pat)
    return pat
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
