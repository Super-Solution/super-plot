import type { AxisInfo, FilterStep, Rect, Scene, SceneAxes } from '@supersolutions/super-plot-core/base'

/** A continuous range on one axis. Time axes report ISO strings, number axes numbers. */
export interface AxisRange {
  /** The data column the axis shows (absent when the axis shows several, e.g. `y: ["a", "b"]`). */
  field?: string
  range: [number, number] | [string, string]
}
/** The categories a brush covers on a category axis. */
export interface AxisPick {
  field?: string
  oneOf: string[]
}
/**
 * What the viewer brushed. `filters` are ready-made transform steps for the axes that name a column, so a
 * linked chart can show the same rows with `transform: sel.filters.map(filter => ({ filter }))`.
 */
export interface BrushSelection {
  x?: AxisRange | AxisPick
  y?: AxisRange | AxisPick
  filters: FilterStep[]
}
/** The visible range of each zoomed axis. */
export interface ZoomRange {
  x?: AxisRange
  y?: AxisRange
}
/** Data units (epoch ms for time) per zoomed axis: what the core takes as `view`. */
export type View = { x?: [number, number]; y?: [number, number] }
/** A brush in data units, so it survives a resize or a redraw. */
type Brush = { x?: [number, number] | string[]; y?: [number, number] | string[] }

// ---- pure helpers (tested directly) -------------------------------------------------------------

const lo = (r: [number, number]): number => Math.min(r[0], r[1])
const hi = (r: [number, number]): number => Math.max(r[0], r[1])

/** Data value to the axis's linear space: log10 on a log axis, the value itself otherwise. */
const fwd = (a: AxisInfo, v: number): number => (a.scale === 'log' ? Math.log10(v) : v)
/** Back from the axis's linear space to data units. */
const back = (a: AxisInfo, t: number): number => (a.scale === 'log' ? 10 ** t : t)

/** Pixel to data value on a continuous axis (log axes invert in log space). */
export function invert(a: AxisInfo, px: number): number {
  const [d0, d1] = (a.domain as [number, number]).map(v => fwd(a, v))
  const [r0, r1] = a.range
  return back(a, r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * (d1 - d0))
}

/** Data value to pixel; for a category axis, the middle of its band. */
export function pixelOf(a: AxisInfo, v: number | string): number {
  const [r0, r1] = a.range
  if (a.kind === 'band') {
    const cats = a.domain as string[]
    const i = cats.indexOf(String(v))
    const step = (r1 - r0) / Math.max(1, cats.length)
    return r0 + step * (Math.max(0, i) + 0.5)
  }
  const [d0, d1] = (a.domain as [number, number]).map(x => fwd(a, x))
  return d1 === d0 ? r0 : r0 + ((fwd(a, Number(v)) - d0) / (d1 - d0)) * (r1 - r0)
}

/** The categories whose band the span between two pixels touches. */
export function bandsBetween(a: AxisInfo, p0: number, p1: number): string[] {
  const a0 = Math.min(p0, p1), a1 = Math.max(p0, p1)
  const cats = a.domain as string[]
  const step = Math.abs(a.range[1] - a.range[0]) / Math.max(1, cats.length)
  return cats.filter(c => {
    const p = pixelOf(a, c)
    return p + step / 2 > a0 && p - step / 2 < a1
  })
}

/**
 * Zoom a domain by `factor` (> 1 is closer) around data value `at`. Pass the axis to zoom a log axis in log
 * space (the domain stays positive and the point under the pointer stays put).
 */
export function zoomDomain(d: [number, number], at: number, factor: number, a?: AxisInfo): [number, number] {
  if (a?.scale !== 'log') return [at - (at - d[0]) / factor, at + (d[1] - at) / factor]
  const l = Math.log10(at)
  return [10 ** (l - (l - Math.log10(d[0])) / factor), 10 ** (l + (Math.log10(d[1]) - l) / factor)]
}

/** Shift a domain so that what was under the pointer follows a drag of `dpx` pixels (in log space on a log axis). */
export function panDomain(a: AxisInfo, d: [number, number], dpx: number): [number, number] {
  const [r0, r1] = a.range
  if (r1 === r0) return d
  const [t0, t1] = d.map(v => fwd(a, v))
  const shift = (dpx * (t1 - t0)) / (r1 - r0)
  return [back(a, t0 - shift), back(a, t1 - shift)]
}

/**
 * Two fingers: the domain a pinch shows. The data value under the fingers' starting midpoint (`from`, in
 * pixels, on axis `a` as it was when the pinch began, domain `d`) moves to their current midpoint (`to`) and
 * the span shrinks by `factor` (> 1 is closer), so spreading the fingers zooms and moving them together pans.
 * Works in log space on a log axis.
 */
export function pinchDomain(a: AxisInfo, d: [number, number], from: number, to: number, factor: number): [number, number] {
  const [r0, r1] = a.range
  if (r1 === r0 || !(factor > 0)) return d
  const [t0, t1] = d.map(v => fwd(a, v))
  const anchor = t0 + ((from - r0) / (r1 - r0)) * (t1 - t0)
  const span = (t1 - t0) / factor
  const n0 = anchor - ((to - r0) / (r1 - r0)) * span
  return [back(a, n0), back(a, n0 + span)]
}

/** How much of the axis a domain spans, in the axis's linear space (log10 units on a log axis). */
const span = (a: AxisInfo | undefined, d: [number, number]): number => (a?.scale === 'log' ? Math.log10(d[1]) - Math.log10(d[0]) : d[1] - d[0])

const out = (a: AxisInfo, v: number): number | string => (a.kind === 'time' ? new Date(v).toISOString() : v)

/** A data range or category list on one axis, as reported to the host. */
function report(a: AxisInfo, v: [number, number] | string[]): AxisRange | AxisPick {
  const f = a.field !== undefined ? { field: a.field } : {}
  if (a.kind === 'band') return { ...f, oneOf: [...(v as string[])] }
  const r = v as [number, number]
  return { ...f, range: [out(a, lo(r)), out(a, hi(r))] as [number, number] | [string, string] }
}

/** The selection for a brush. */
export function selectionOf(axes: SceneAxes, b: Brush): BrushSelection {
  const sel: BrushSelection = { filters: [] }
  for (const k of ['x', 'y'] as const) {
    const v = b[k]
    if (!v) continue
    const r = report(axes[k], v)
    sel[k] = r
    if (r.field === undefined) continue
    sel.filters.push('oneOf' in r ? { field: r.field, oneOf: r.oneOf } : { field: r.field, range: r.range })
  }
  return sel
}

/** A brush from a rectangle of pixels (clamped to the plot). Null when it covers nothing. */
export function brushFromPixels(axes: SceneAxes, mode: 'x' | 'xy', x0: number, x1: number, y0: number, y1: number): Brush | null {
  const b: Brush = {}
  const axis = (a: AxisInfo, p0: number, p1: number): [number, number] | string[] | null => {
    if (a.kind === 'band') {
      const c = bandsBetween(a, p0, p1)
      return c.length ? c : null
    }
    const v0 = invert(a, p0), v1 = invert(a, p1)
    return [Math.min(v0, v1), Math.max(v0, v1)]
  }
  const x = axis(axes.x, x0, x1)
  if (!x) return null
  b.x = x
  if (mode === 'xy') {
    const y = axis(axes.y, y0, y1)
    if (!y) return null
    b.y = y
  }
  return b
}

/** Where a brush sits on screen now (scene pixels), or null if the axes no longer show it. */
export function brushRect(axes: SceneAxes, b: Brush): Rect | null {
  const p = axes.plot
  const span = (a: AxisInfo, v: [number, number] | string[] | undefined, full: [number, number]): [number, number] | null => {
    if (!v) return full
    if (a.kind === 'band') {
      const cats = a.domain as string[]
      const idx = (v as string[]).map(c => cats.indexOf(c)).filter(i => i >= 0)
      if (!idx.length) return null
      const step = (a.range[1] - a.range[0]) / Math.max(1, cats.length)
      const s0 = a.range[0] + step * Math.min(...idx), s1 = a.range[0] + step * (Math.max(...idx) + 1)
      return [Math.min(s0, s1), Math.max(s0, s1)]
    }
    if (Array.isArray(v) && typeof v[0] === 'string') return null
    const r = v as [number, number]
    const a0 = pixelOf(a, r[0]), a1 = pixelOf(a, r[1])
    return [Math.min(a0, a1), Math.max(a0, a1)]
  }
  const sx = span(axes.x, b.x, [p.x, p.x + p.w])
  const sy = span(axes.y, b.y, [p.y, p.y + p.h])
  if (!sx || !sy) return null
  const x0 = Math.max(p.x, sx[0]), x1 = Math.min(p.x + p.w, sx[1])
  const y0 = Math.max(p.y, sy[0]), y1 = Math.min(p.y + p.h, sy[1])
  if (x1 <= x0 || y1 <= y0) return { x: Math.min(Math.max(sx[0], p.x), p.x + p.w), y: y0, w: 0, h: Math.max(0, y1 - y0) }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** `[a, b]` of numbers or ISO date strings to numbers (null when unreadable). */
export function readRange(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null
  const n = v.map(x => (typeof x === 'number' ? x : typeof x === 'string' ? Date.parse(x) : NaN))
  return n.every(Number.isFinite) && n[0] !== n[1] ? [Math.min(n[0], n[1]), Math.max(n[0], n[1])] : null
}

// ---- the controller ------------------------------------------------------------------------------

/** What the axis controls need from the plot that owns them. */
export interface AxisOwner {
  readonly root: HTMLDivElement
  scene(): Scene | null
  /** Draw again with this view (null: the spec's own ranges). Coalesced to one frame. */
  redraw(): void
  zoomChanged(z: ZoomRange | null): void
  brushChanged(sel: BrushSelection | null): void
  /** The viewer changed the view (zoom, pan, reset), as it happens; not called for `setZoom` from code. */
  viewChanged?(): void
  /** Centre of the mark the keyboard is on (or that `target` is), in scene pixels. */
  focusPoint(target?: EventTarget | null): { x: number; y: number } | null
  hideTip(): void
}

/**
 * Zoom, pan and brush on a cartesian chart, from `scene.axes`. Ctrl/⌘-wheel or a pinch zooms around the
 * pointer, a drag brushes (or pans when only zoom is on; Shift-drag pans when both are), a double-click resets
 * the zoom, a click or Escape clears the brush. From the keyboard: + and - zoom, 0 resets, Shift+arrows pan,
 * [ and ] set the brush's start and end at the focused mark.
 */
export class AxisControl {
  view: View | null = null
  /** The full ranges (no zoom), to know when zooming out has reached them. */
  private home: View | null = null
  private brush: Brush | null = null
  private anchor: { a?: { x: number; y: number }; b?: { x: number; y: number } } = {}
  private overlay: HTMLDivElement
  private pointers = new Map<number, { x: number; y: number }>()
  private drag: { mode: 'brush' | 'pan'; x: number; y: number; moved: boolean; view: View; axes: SceneAxes } | null = null
  private pinch: { dist: number; view: View; at: { x: number; y: number }; axes: SceneAxes } | null = null
  private justDragged = false
  private zoomTimer = 0
  /** `viewX` changed the view and has not reported it yet. */
  private viewPending = false
  private live = false

  constructor(private owner: AxisOwner) {
    const root = owner.root
    this.overlay = root.ownerDocument.createElement('div')
    this.overlay.className = 'sp-brush'
    this.overlay.setAttribute('aria-hidden', 'true')
    root.addEventListener('pointerdown', this.onDown)
    root.addEventListener('pointermove', this.onMove)
    root.addEventListener('pointerup', this.onUp)
    root.addEventListener('pointercancel', this.onUp)
    root.addEventListener('wheel', this.onWheel, { passive: false })
    root.addEventListener('dblclick', this.onDbl)
    root.addEventListener('keydown', this.onKey)
    root.addEventListener('click', this.onClick, true)
  }

  dispose(): void {
    const root = this.owner.root
    clearTimeout(this.zoomTimer)
    root.removeEventListener('pointerdown', this.onDown)
    root.removeEventListener('pointermove', this.onMove)
    root.removeEventListener('pointerup', this.onUp)
    root.removeEventListener('pointercancel', this.onUp)
    root.removeEventListener('wheel', this.onWheel)
    root.removeEventListener('dblclick', this.onDbl)
    root.removeEventListener('keydown', this.onKey)
    root.removeEventListener('click', this.onClick, true)
    this.overlay.remove()
  }

  /** A drag is under way (or just ended): the click that follows must not select a mark. */
  dragging(): boolean { return this.drag?.moved === true || this.justDragged }

  private axes(): SceneAxes | null {
    const s = this.owner.scene()
    const a = s?.axes
    return a && !s!.panels && !s!.geo && (a.zoom || a.brush) ? a : null
  }

  /** Forget the viewer's zoom and brush (a different chart). */
  reset(): void {
    this.view = null
    this.home = null
    this.brush = null
    this.anchor = {}
  }

  /** After every render: remember the full ranges, set up focus and gestures, put the brush back. */
  afterRender(): void {
    const root = this.owner.root
    const a = this.axes()
    this.live = !!a
    if (!a) {
      this.overlay.remove()
      root.removeAttribute('data-axes')
      if (root.dataset.spAxisTab) {
        root.removeAttribute('tabindex')
        root.removeAttribute('aria-keyshortcuts')
        delete root.dataset.spAxisTab
      }
      return
    }
    if (!this.view) {
      this.home = {}
      if (a.x.kind !== 'band') this.home.x = [...a.x.domain] as [number, number]
      if (a.y.kind !== 'band') this.home.y = [...a.y.domain] as [number, number]
    }
    root.setAttribute('data-axes', a.zoom === 'xy' || a.brush === 'xy' ? 'xy' : 'x')
    if (!root.hasAttribute('tabindex')) {
      root.tabIndex = 0
      root.dataset.spAxisTab = '1'
    }
    if (root.dataset.spAxisTab) {
      const keys = [...(a.zoom ? ['+', '-', '0', 'Shift+ArrowLeft', 'Shift+ArrowRight'] : []), ...(a.brush ? ['[', ']', 'Escape'] : [])]
      root.setAttribute('aria-keyshortcuts', keys.join(' '))
    }
    this.place()
  }

  private place(rect?: Rect | null): void {
    const a = this.axes()
    const s = this.owner.scene()
    const r = rect !== undefined ? rect : a && this.brush ? brushRect(a, this.brush) : null
    if (!r || !s || !a?.brush) {
      this.overlay.remove()
      return
    }
    const st = this.overlay.style
    st.left = `${(r.x / s.width) * 100}%`
    st.top = `${(r.y / s.height) * 100}%`
    st.width = `${(r.w / s.width) * 100}%`
    st.height = `${(r.h / s.height) * 100}%`
    if (this.overlay.parentNode !== this.owner.root) this.owner.root.appendChild(this.overlay)
  }

  getZoom(): ZoomRange | null {
    const a = this.owner.scene()?.axes
    if (!this.view || !a) return null
    const z: ZoomRange = {}
    if (this.view.x) z.x = report(a.x, this.view.x) as AxisRange
    if (this.view.y) z.y = report(a.y, this.view.y) as AxisRange
    return z
  }

  setZoom(z: { x?: unknown; y?: unknown } | null, notify = false): void {
    const x = z ? readRange(z.x) : null, y = z ? readRange(z.y) : null
    this.view = x || y ? { ...(x ? { x } : {}), ...(y ? { y } : {}) } : null
    this.owner.redraw()
    if (notify) this.zoomSoon(0)
  }

  getBrush(): BrushSelection | null {
    const a = this.owner.scene()?.axes
    return a && this.brush ? selectionOf(a, this.brush) : null
  }

  /** Set the brush from data values: `{ x: [from, to] }` (numbers or ISO dates) or `{ x: ["A", "B"] }` on categories. */
  setBrush(b: { x?: unknown; y?: unknown } | null, notify = false): void {
    if (!b) this.brush = null
    else {
      const one = (v: unknown): [number, number] | string[] | undefined => {
        if (Array.isArray(v) && v.length && v.every(x => typeof x === 'string') && !readRange(v)) return v as string[]
        return readRange(v) ?? undefined
      }
      const nb: Brush = {}
      const x = one(b.x), y = one(b.y)
      if (x) nb.x = x
      if (y) nb.y = y
      this.brush = nb.x || nb.y ? nb : null
    }
    this.anchor = {}
    this.place()
    if (notify) this.owner.brushChanged(this.getBrush())
  }

  private toScene(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const s = this.owner.scene()
    const r = this.owner.root.getBoundingClientRect()
    if (!s || !r.width || !r.height) return null
    return { x: ((e.clientX - r.left) * s.width) / r.width, y: ((e.clientY - r.top) * s.height) / r.height }
  }

  private inPlot(p: { x: number; y: number }, a: SceneAxes): boolean {
    const q = a.plot
    return p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h
  }

  /** The current ranges of the zoomable axes. */
  private current(a: SceneAxes): View {
    const v: View = {}
    if (a.zoom && a.x.kind !== 'band') v.x = [...(this.view?.x ?? (a.x.domain as [number, number]))] as [number, number]
    if (a.zoom === 'xy' && a.y.kind !== 'band') v.y = [...(this.view?.y ?? (a.y.domain as [number, number]))] as [number, number]
    return v
  }

  /** Zoom by `factor` around a scene point; zooming out past the full range resets. */
  private zoomAt(a: SceneAxes, p: { x: number; y: number }, factor: number, base = this.current(a), axes = a): void {
    const v: View = {}
    if (base.x) v.x = zoomDomain(base.x, invert(axes.x, p.x), factor, axes.x)
    if (base.y) v.y = zoomDomain(base.y, invert(axes.y, p.y), factor, axes.y)
    this.setView(v)
  }

  private setView(v: View): void {
    const h = this.home
    const a = this.owner.scene()?.axes
    const wide = (d: [number, number] | undefined, full: [number, number] | undefined, ax: AxisInfo | undefined): boolean => !!d && !!full && full[1] > full[0] && span(ax, d) >= span(ax, full) * 0.999
    const tiny = (d: [number, number] | undefined, full: [number, number] | undefined, ax: AxisInfo | undefined): boolean => !!d && !!full && full[1] > full[0] && span(ax, d) < span(ax, full) * 1e-6
    if (tiny(v.x, h?.x, a?.x) || tiny(v.y, h?.y, a?.y)) return
    if (wide(v.x, h?.x, a?.x) && (!v.y || wide(v.y, h?.y, a?.y))) this.view = null
    else this.view = v
    this.owner.redraw()
    this.owner.viewChanged?.()
  }

  /** Back to the full range, as the viewer asked (a reset button): fires `zoomChanged`. */
  resetByViewer(): void {
    if (!this.view) return
    this.view = null
    this.owner.redraw()
    this.owner.viewChanged?.()
    this.zoomSoon(0)
  }

  /**
   * The viewer set the x range from outside the plot (the navigator), keeping any y zoom: shared with a sync
   * group like a pan, and reported through `zoomChanged` after `ms` (0: now; false: not yet, a drag goes on).
   */
  viewX(x: [number, number] | null, notify: number | false): void {
    const y = this.view?.y
    const before = JSON.stringify(this.view)
    if (!x && !y) {
      if (this.view) {
        this.view = null
        this.owner.redraw()
        this.owner.viewChanged?.()
      }
    } else this.setView({ ...(x ? { x: [...x] as [number, number] } : {}), ...(y ? { y } : {}) })
    // Report a change once, when the gesture ends (a key press that hit the end of the range reports nothing).
    if (JSON.stringify(this.view) !== before) this.viewPending = true
    if (notify !== false && this.viewPending) {
      this.viewPending = false
      this.zoomSoon(notify)
    }
  }

  /** Set only the x range (data units), keeping any y zoom: what a synchronised plot receives. Does not notify. */
  setXView(x: [number, number] | null): void {
    const y = this.view?.y
    const next = x || y ? { ...(x ? { x: [...x] as [number, number] } : {}), ...(y ? { y } : {}) } : null
    if (JSON.stringify(next) === JSON.stringify(this.view)) return
    this.view = next
    this.owner.redraw()
  }

  private zoomSoon(ms = 250): void {
    clearTimeout(this.zoomTimer)
    this.zoomTimer = window.setTimeout(() => this.owner.zoomChanged(this.getZoom()), ms)
  }

  private onDown = (e: PointerEvent): void => {
    const a = this.axes()
    if (!a || (e.pointerType === 'mouse' && e.button !== 0)) return
    if ((e.target as Element | null)?.closest?.('.sp-ctl, .sp-bar, .sp-cv-lk, [data-lk], .sp-table')) return
    const p = this.toScene(e)
    if (!p) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 2 && a.zoom) {
      const [u, w] = [...this.pointers.values()]
      const mid = this.toScene({ clientX: (u.x + w.x) / 2, clientY: (u.y + w.y) / 2 })
      this.drag = null
      this.overlay.remove()
      if (mid) this.pinch = { dist: Math.hypot(u.x - w.x, u.y - w.y), view: this.current(a), at: mid, axes: a }
      this.owner.hideTip()
      return
    }
    if (this.pointers.size !== 1 || !this.inPlot(p, a)) return
    const mode = a.brush && !(a.zoom && e.shiftKey) ? 'brush' : a.zoom ? 'pan' : null
    if (mode) this.drag = { mode, ...p, moved: false, view: this.current(a), axes: a }
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const a = this.axes()
    if (!a) return
    if (this.pinch && this.pointers.size >= 2) {
      const [u, w] = [...this.pointers.values()]
      const d = Math.hypot(u.x - w.x, u.y - w.y)
      const mid = this.toScene({ clientX: (u.x + w.x) / 2, clientY: (u.y + w.y) / 2 })
      const g = this.pinch
      if (g.dist > 4 && d > 4 && mid) {
        // Against the axes as they were when the pinch began, so the point under the fingers does not drift.
        const v: View = {}
        if (g.view.x) v.x = pinchDomain(g.axes.x, g.view.x, g.at.x, mid.x, d / g.dist)
        if (g.view.y) v.y = pinchDomain(g.axes.y, g.view.y, g.at.y, mid.y, d / g.dist)
        this.setView(v)
      }
      return
    }
    const g = this.drag
    const p = this.toScene(e)
    if (!g || !p) return
    if (!g.moved) {
      if (Math.hypot(p.x - g.x, p.y - g.y) < 3) return
      g.moved = true
      try { this.owner.root.setPointerCapture?.(e.pointerId) } catch { /* synthetic event */ }
      this.owner.root.setAttribute(g.mode === 'brush' ? 'data-brushing' : 'data-panning', '')
      this.owner.hideTip()
    }
    const q = g.axes.plot
    if (g.mode === 'brush') {
      const cx = (v: number): number => Math.min(q.x + q.w, Math.max(q.x, v))
      const cy = (v: number): number => Math.min(q.y + q.h, Math.max(q.y, v))
      const xy = a.brush === 'xy'
      const x0 = cx(Math.min(g.x, p.x)), x1 = cx(Math.max(g.x, p.x))
      const y0 = xy ? cy(Math.min(g.y, p.y)) : q.y, y1 = xy ? cy(Math.max(g.y, p.y)) : q.y + q.h
      this.place({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      return
    }
    const v: View = {}
    if (g.view.x) v.x = panDomain(g.axes.x, g.view.x, p.x - g.x)
    if (g.view.y) v.y = panDomain(g.axes.y, g.view.y, p.y - g.y)
    this.setView(v)
  }

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return
    if (this.pinch) {
      if (this.pointers.size < 2) {
        this.pinch = null
        this.justDragged = true
        setTimeout(() => { this.justDragged = false }, 0)
        this.zoomSoon(0)
      }
      return
    }
    const g = this.drag
    this.drag = null
    this.owner.root.removeAttribute('data-brushing')
    this.owner.root.removeAttribute('data-panning')
    if (!g?.moved) return
    this.justDragged = true
    setTimeout(() => { this.justDragged = false }, 0)
    if (g.mode === 'pan') return this.zoomSoon(0)
    const p = this.toScene(e) ?? g
    const q = g.axes.plot
    const xy = g.axes.brush === 'xy'
    const b = brushFromPixels(g.axes, xy ? 'xy' : 'x', g.x, p.x, xy ? g.y : q.y, xy ? p.y : q.y + q.h)
    this.brush = b
    this.anchor = {}
    this.place()
    this.owner.brushChanged(this.getBrush())
  }

  /** A click that was not a drag clears the brush (it still selects the mark under it). */
  private onClick = (e: MouseEvent): void => {
    if (!this.live || this.dragging() || !this.brush) return
    if ((e.target as Element | null)?.closest?.('.sp-ctl, .sp-bar, .sp-cv-lk, [data-lk], .sp-table')) return
    this.setBrush(null, true)
  }

  private onWheel = (e: WheelEvent): void => {
    const a = this.axes()
    // Plain scrolling scrolls the page; zoom needs Ctrl/⌘ (a trackpad pinch sends Ctrl too).
    if (!a?.zoom || !(e.ctrlKey || e.metaKey)) return
    const p = this.toScene(e)
    if (!p || !this.inPlot(p, a)) return
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0025
    this.zoomAt(a, p, Math.exp(-e.deltaY * unit))
    this.zoomSoon()
  }

  private onDbl = (e: MouseEvent): void => {
    const a = this.axes()
    const p = this.toScene(e)
    if (!a?.zoom || !this.view || !p || !this.inPlot(p, a)) return
    this.resetByViewer()
  }

  private onKey = (e: KeyboardEvent): void => {
    const a = this.axes()
    if (!a || e.altKey || e.ctrlKey || e.metaKey) return
    const t = e.target as Element | null
    if (t?.closest?.('button, input, select, textarea, [data-lk], .sp-cv-lk')) return
    const q = a.plot
    const centre = this.owner.focusPoint(e.target) ?? { x: q.x + q.w / 2, y: q.y + q.h / 2 }
    if (a.zoom) {
      switch (e.key) {
        case '+': case '=': e.preventDefault(); this.zoomAt(a, centre, 1.25); return this.zoomSoon()
        case '-': case '_': e.preventDefault(); this.zoomAt(a, centre, 1 / 1.25); return this.zoomSoon()
        case '0': if (!this.view) return; e.preventDefault(); return this.resetByViewer()
      }
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || (a.zoom === 'xy' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')))) {
        e.preventDefault()
        const v = this.current(a)
        const step = e.key === 'ArrowLeft' ? q.w / 10 : e.key === 'ArrowRight' ? -q.w / 10 : 0
        const vstep = e.key === 'ArrowUp' ? q.h / 10 : e.key === 'ArrowDown' ? -q.h / 10 : 0
        const nv: View = {}
        if (v.x) nv.x = step ? panDomain(a.x, v.x, step) : v.x
        if (v.y) nv.y = vstep ? panDomain(a.y, v.y, vstep) : v.y
        this.setView(nv)
        return this.zoomSoon()
      }
    }
    if (!a.brush) return
    if (e.key === 'Escape' && this.brush) return this.setBrush(null, true)
    if (e.key !== '[' && e.key !== ']') return
    const f = this.owner.focusPoint(e.target)
    if (!f) return
    e.preventDefault()
    this.anchor[e.key === '[' ? 'a' : 'b'] = f
    const { a: s, b: en } = this.anchor
    if (!s || !en) return
    const xy = a.brush === 'xy'
    // A single mark (start = end) still selects it: widen a zero-width range by a pixel each side.
    const w = (u: number, v: number): [number, number] => (Math.abs(u - v) < 1 ? [Math.min(u, v) - 1, Math.max(u, v) + 1] : [u, v])
    const [x0, x1] = w(s.x, en.x), [y0, y1] = xy ? w(s.y, en.y) : [q.y, q.y + q.h]
    const b = brushFromPixels(a, xy ? 'xy' : 'x', x0, x1, y0, y1)
    this.brush = b
    this.place()
    this.owner.brushChanged(this.getBrush())
  }
}
