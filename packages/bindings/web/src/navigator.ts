import type { AxisInfo, Scene, UiStringKey } from '@supersolutions/super-plot-core/base'
import { invert, pixelOf } from './interact.js'
import { NAV_HEIGHT } from './navigable.js'

// Loaded on demand (its own chunk) by a plot with the `navigator` option; `navigable.ts` holds what is needed first.
export { NAV_HEIGHT, NAV_TYPES, navigable } from './navigable.js'

/** The strip's top and height inside the navigator. */
const STRIP_Y = 6
const STRIP_H = 32
const SVG_NS = 'http://www.w3.org/2000/svg'
/** Points kept per subpath of an overview line: about two per pixel column (first, lowest, highest, last). */
const MAX_LINE_POINTS = 4000

/** Data value to the axis's linear space (log10 on a log axis). */
const fwd = (a: AxisInfo, v: number): number => (a.scale === 'log' ? Math.log10(v) : v)
const back = (a: AxisInfo, t: number): number => (a.scale === 'log' ? 10 ** t : t)

/**
 * Thin a path of straight segments (`M x y L x y ...`) to at most about `max` points per subpath, keeping in
 * each pixel column the first, lowest, highest and last point, so peaks survive. Paths with curves or arcs
 * (and short ones) come back unchanged.
 */
export function thinPath(d: string, max = MAX_LINE_POINTS): string {
  if (d.length < max * 8 || /[^MLml0-9.eE\s,+-]/.test(d)) return d
  const out: string[] = []
  for (const sub of d.split(/(?=[Mm])/)) {
    const nums = sub.slice(1).split(/[\sLl,]+/).filter(Boolean).map(Number)
    if (nums.length < 4 || sub[0] === 'm' || /l/.test(sub)) return d
    const n = nums.length >> 1
    if (n <= max) {
      out.push(sub)
      continue
    }
    const x0 = nums[0], x1 = nums[(n - 1) * 2]
    const cols = Math.max(1, Math.floor(max / 4))
    const step = (x1 - x0) / cols || 1
    let col = NaN
    let first = -1, lo = -1, hi = -1, last = -1
    const keep: number[] = []
    const flush = (): void => {
      if (first < 0) return
      for (const i of [...new Set([first, lo, hi, last])].sort((a, b) => a - b)) keep.push(i)
    }
    for (let i = 0; i < n; i++) {
      const c = Math.floor((nums[i * 2] - x0) / step)
      if (c !== col) {
        flush()
        col = c
        first = lo = hi = last = i
        continue
      }
      const y = nums[i * 2 + 1]
      if (y < nums[lo * 2 + 1]) lo = i
      if (y > nums[hi * 2 + 1]) hi = i
      last = i
    }
    flush()
    out.push(keep.map((i, k) => `${k ? 'L' : 'M'}${nums[i * 2]} ${nums[i * 2 + 1]}`).join(''))
  }
  return out.join('')
}

/**
 * What the overview strip draws, from the full-range scene: the first visible series' line (and its area
 * fill) for line and area charts, or a density strip (dots per column) for a scatter. Coordinates stay in the
 * scene's pixels; the strip scales the plot's height into its own.
 */
export function overviewOf(scene: Scene): { lines: { d: string; color: string; fill: boolean }[]; density: number[] | null } {
  const a = scene.axes!
  const first = scene.series.find(s => !s.hidden)?.key
  if (scene.type === 'scatter') {
    const cols = Math.max(1, Math.round(a.plot.w / 3))
    const counts = new Array<number>(cols).fill(0)
    for (const m of scene.marks) {
      if (m.role !== 'data' || m.type !== 'circle') continue
      const f = (m.cx - a.plot.x) / a.plot.w
      if (f >= 0 && f <= 1) counts[Math.min(cols - 1, Math.floor(f * cols))]++
    }
    return { lines: [], density: counts }
  }
  const lines: { d: string; color: string; fill: boolean }[] = []
  for (const m of scene.marks) {
    if (m.role !== 'data' || m.type !== 'path' || (first !== undefined && m.series !== first)) continue
    const filled = !!m.fill && m.fill !== 'none' && m.fill !== 'transparent'
    // An interval band has a fill too, but no stroke and a low opacity; an area keeps its fill as the strip's.
    if (filled && scene.type !== 'area') continue
    lines.push({ d: thinPath(m.d), color: (filled ? m.fill : m.stroke) ?? 'currentColor', fill: filled })
  }
  return { lines, density: null }
}

/** What the navigator needs from the plot that owns it. */
export interface NavOwner {
  /** The x range shown now, in data units (null: the full range). */
  view(): [number, number] | null
  /** The viewer moved the window: set the x range (null: full) and report it now, after `ms`, or not yet (false). */
  setX(x: [number, number] | null, notify: number | false): void
  locale(): string | undefined
  /** The `timeZone` option, for dates in `aria-valuetext` (UTC when unset or unknown). */
  timeZone(): string | undefined
  /** A UI string from the `strings` option, placeholders filled. */
  text(key: UiStringKey, vars?: Record<string, string | number>): string
  /** Theme colours as `var(--sp-*, fallback)` strings. */
  color(token: string): string
}

type Mode = 'pan' | 'start' | 'end'

/**
 * The overview strip under a zoomable chart (a range slider): the whole x range drawn small, a window over
 * the part on screen and a handle at each end. Dragging the window pans, dragging a handle zooms, clicking
 * the strip moves the window there; from the keyboard the window and both handles are sliders (arrow keys,
 * Page Up/Down, Home/End). Everything goes through the owner's zoom state, so `onZoom`, sync groups and
 * `setZoom` stay in step with it.
 */
export class Navigator {
  readonly el: HTMLDivElement
  private svg: SVGSVGElement
  private shadeL: HTMLDivElement
  private shadeR: HTMLDivElement
  private win: HTMLDivElement
  private hs: HTMLDivElement
  private he: HTMLDivElement
  private full: Scene | null = null
  private key = ''
  private drag: { mode: Mode; id: number; x: number; t: [number, number]; moved: boolean } | null = null

  constructor(doc: Document, private owner: NavOwner) {
    const div = (cls: string): HTMLDivElement => {
      const d = doc.createElement('div')
      d.className = cls
      return d
    }
    this.el = div('sp-nav')
    this.el.setAttribute('role', 'group')
    this.svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement
    this.svg.setAttribute('aria-hidden', 'true')
    this.svg.setAttribute('preserveAspectRatio', 'none')
    this.shadeL = div('sp-nav-shade')
    this.shadeR = div('sp-nav-shade')
    this.win = div('sp-nav-win')
    this.hs = div('sp-nav-h')
    this.he = div('sp-nav-h')
    this.hs.dataset.edge = 'start'
    this.he.dataset.edge = 'end'
    for (const [s, label] of [[this.win, 'navWindow'], [this.hs, 'navStart'], [this.he, 'navEnd']] as const) {
      s.setAttribute('role', 'slider')
      s.setAttribute('aria-orientation', 'horizontal')
      s.tabIndex = 0
      s.dataset.label = label
      s.addEventListener('keydown', this.onKey)
    }
    this.shadeL.setAttribute('aria-hidden', 'true')
    this.shadeR.setAttribute('aria-hidden', 'true')
    this.el.append(this.svg, this.shadeL, this.shadeR, this.win, this.hs, this.he)
    this.el.addEventListener('pointerdown', this.onDown)
    this.el.addEventListener('pointermove', this.onMove)
    this.el.addEventListener('pointerup', this.onUp)
    this.el.addEventListener('pointercancel', this.onUp)
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('pointercancel', this.onUp)
    this.el.remove()
  }

  /**
   * Draw for a full-range scene (redrawn only when `key`, what the data and size are, changes) and put the
   * window where the current view is.
   */
  update(full: Scene, key: string): void {
    const a = full.axes!
    if (key !== this.key || !this.full) {
      this.key = key
      this.draw(full)
    }
    this.full = full
    // Theme colours for the window and handles (the handles' face is a pseudo-element, so through properties).
    this.el.style.setProperty('--sp-nav-ink', this.owner.color('info'))
    this.el.style.setProperty('--sp-nav-face', this.owner.color('background'))
    const field = a.x.field || 'x'
    this.el.setAttribute('aria-label', this.owner.text('navOverview', { field }))
    for (const s of [this.win, this.hs, this.he]) s.setAttribute('aria-label', this.owner.text(s.dataset.label as UiStringKey, { field }))
    this.place()
  }

  private draw(full: Scene): void {
    const a = full.axes!
    const doc = this.el.ownerDocument
    const p = a.plot
    this.svg.setAttribute('viewBox', `0 0 ${full.width} ${NAV_HEIGHT}`)
    const kids: Element[] = []
    const el = (tag: string, attrs: Record<string, string | number>): SVGElement => {
      const e = doc.createElementNS(SVG_NS, tag) as SVGElement
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
      return e
    }
    kids.push(el('rect', { x: p.x, y: STRIP_Y, width: p.w, height: STRIP_H, fill: this.owner.color('grid'), opacity: 0.5, rx: 3 }))
    const o = overviewOf(full)
    if (o.density) {
      const max = Math.max(1, ...o.density)
      const w = p.w / o.density.length
      o.density.forEach((n, i) => {
        if (!n) return
        const h = Math.max(1, Math.sqrt(n / max) * (STRIP_H - 2))
        kids.push(el('rect', { x: p.x + i * w, y: STRIP_Y + STRIP_H - h, width: Math.max(0.5, w - 0.5), height: h, fill: this.owner.color('text-muted'), opacity: 0.55 }))
      })
    } else {
      // The plot's height scaled into the strip; x stays (both scenes have the same width).
      const k = STRIP_H / Math.max(1, p.h)
      const g = el('g', { transform: `translate(0 ${STRIP_Y - p.y * k}) scale(1 ${k})` })
      for (const l of o.lines) {
        g.appendChild(el('path', l.fill
          ? { d: l.d, fill: l.color, opacity: 0.25, stroke: 'none' }
          : { d: l.d, fill: 'none', stroke: l.color, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }))
      }
      kids.push(g)
    }
    this.svg.replaceChildren(...kids)
  }

  /** The full range in the axis's linear space (log10 on a log axis). */
  private fullT(): [number, number] | null {
    const a = this.full?.axes?.x
    if (!a) return null
    const d = a.domain as [number, number]
    return [fwd(a, d[0]), fwd(a, d[1])]
  }

  /** The window in linear space, clamped to the full range. */
  private windowT(): [number, number] | null {
    const f = this.fullT()
    const a = this.full?.axes?.x
    if (!f || !a) return null
    const v = this.owner.view()
    if (!v) return f
    const t0 = Math.max(f[0], Math.min(f[1], fwd(a, Math.min(v[0], v[1])))), t1 = Math.max(f[0], Math.min(f[1], fwd(a, Math.max(v[0], v[1]))))
    return t1 > t0 ? [t0, t1] : f
  }

  /** Narrowest window: a five-hundredth of the full range. */
  private minW(f: [number, number]): number { return (f[1] - f[0]) / 500 }

  private place(): void {
    const s = this.full
    const a = s?.axes
    const w = this.windowT()
    const f = this.fullT()
    if (!s || !a || !w || !f) return
    const px = (t: number): number => pixelOf(a.x, back(a.x, t))
    const pct = (v: number): string => `${(v / s.width) * 100}%`
    const x0 = px(w[0]), x1 = px(w[1])
    const lo = a.plot.x, hi = a.plot.x + a.plot.w
    Object.assign(this.shadeL.style, { left: pct(lo), width: pct(Math.max(0, x0 - lo)) })
    Object.assign(this.shadeR.style, { left: pct(x1), width: pct(Math.max(0, hi - x1)) })
    Object.assign(this.win.style, { left: pct(x0), width: pct(Math.max(0, x1 - x0)) })
    this.hs.style.left = pct(x0)
    this.he.style.left = pct(x1)
    const v0 = back(a.x, w[0]), v1 = back(a.x, w[1])
    const fmin = back(a.x, f[0]), fmax = back(a.x, f[1])
    const m = this.minW(f)
    const text = (v: number): string => this.text(a.x, v, f)
    this.aria(this.win, fmin, fmax, v0, this.owner.text('navRange', { from: text(v0), to: text(v1) }))
    this.aria(this.hs, fmin, back(a.x, w[1] - m), v0, text(v0))
    this.aria(this.he, back(a.x, w[0] + m), fmax, v1, text(v1))
    this.el.toggleAttribute('data-zoomed', !!this.owner.view())
  }

  private aria(el: HTMLElement, min: number, max: number, now: number, text: string): void {
    el.setAttribute('aria-valuemin', String(round(min)))
    el.setAttribute('aria-valuemax', String(round(max)))
    el.setAttribute('aria-valuenow', String(round(now)))
    el.setAttribute('aria-valuetext', text)
  }

  /** A value in axis units, for `aria-valuetext`: a date in the `timeZone` option (and time on short ranges) or a number. */
  private text(a: AxisInfo, v: number, f: [number, number]): string {
    const locale = this.owner.locale()
    if (a.kind === 'time') {
      const short = f[1] - f[0] < 3 * 86_400_000
      const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', ...(short ? { hour: '2-digit', minute: '2-digit' } : {}) }
      for (const timeZone of [this.owner.timeZone() || 'UTC', 'UTC']) {
        try {
          return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(v)
        } catch { /* unknown zone or locale: try UTC, then ISO */ }
      }
      return new Date(v).toISOString()
    }
    try {
      return new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(v)
    } catch {
      return String(round(v))
    }
  }

  /** Scene pixels per client pixel (the navigator is as wide as the chart). */
  private scale(): number {
    const r = this.el.getBoundingClientRect()
    return this.full && r.width > 0 ? this.full.width / r.width : 1
  }

  /** Set the window to `[t0, t1]` in linear space (kept inside the full range); a full window is no zoom. */
  private set(t: [number, number], mode: Mode, notify: number | false): void {
    const f = this.fullT()
    const a = this.full?.axes?.x
    if (!f || !a) return
    const m = this.minW(f)
    let [t0, t1] = t
    if (mode === 'pan') {
      const w = Math.min(t1 - t0, f[1] - f[0])
      t0 = Math.max(f[0], Math.min(f[1] - w, t0))
      t1 = t0 + w
    } else if (mode === 'start') t0 = Math.max(f[0], Math.min(t1 - m, t0))
    else t1 = Math.min(f[1], Math.max(t0 + m, t1))
    const full = t0 <= f[0] + m / 100 && t1 >= f[1] - m / 100
    this.owner.setX(full ? null : [back(a, t0), back(a, t1)], notify)
    this.place()
  }

  private onDown = (e: PointerEvent): void => {
    const a = this.full?.axes
    const w = this.windowT()
    if (!a || !w || (e.pointerType === 'mouse' && e.button !== 0)) return
    const t = e.target as HTMLElement
    const mode: Mode = t === this.hs ? 'start' : t === this.he ? 'end' : 'pan'
    const jump = mode === 'pan' && t !== this.win
    if (jump) {
      // A press on the strip outside the window moves the window there (centred), then drags it.
      const r = this.el.getBoundingClientRect()
      const at = fwd(a.x, invert(a.x, (e.clientX - r.left) * this.scale()))
      const half = (w[1] - w[0]) / 2
      this.set([at - half, at + half], 'pan', false)
    }
    e.preventDefault()
    ;(t.closest?.('[role="slider"]') as HTMLElement | null ?? this.win).focus?.({ preventScroll: true })
    this.drag = { mode, id: e.pointerId, x: e.clientX, t: this.windowT() ?? w, moved: jump }
    try { this.el.setPointerCapture?.(e.pointerId) } catch { /* synthetic event */ }
    this.el.setAttribute('data-drag', mode)
  }

  private onMove = (e: PointerEvent): void => {
    const g = this.drag
    const a = this.full?.axes
    if (!g || g.id !== e.pointerId || !a) return
    const f = this.fullT()!
    if (!g.moved && Math.abs(e.clientX - g.x) < 1) return
    g.moved = true
    const dt = ((e.clientX - g.x) * this.scale() * (f[1] - f[0])) / Math.max(1, a.plot.w)
    const [t0, t1] = g.t
    this.set(g.mode === 'pan' ? [t0 + dt, t1 + dt] : g.mode === 'start' ? [t0 + dt, t1] : [t0, t1 + dt], g.mode, false)
  }

  private onUp = (e: PointerEvent): void => {
    const g = this.drag
    if (!g || g.id !== e.pointerId) return
    this.drag = null
    this.el.removeAttribute('data-drag')
    const w = this.windowT()
    // Once per gesture, when it ends (a press that did not move reports nothing).
    if (w && g.moved) this.set(w, g.mode, 0)
  }

  /** Arrow keys move by a fiftieth of the full range (the window: a tenth of its width), Page Up/Down ten times that, Home/End to the ends. */
  private onKey = (e: KeyboardEvent): void => {
    const f = this.fullT()
    const w = this.windowT()
    if (!f || !w || e.altKey || e.ctrlKey || e.metaKey) return
    const t = e.currentTarget as HTMLElement
    const mode: Mode = t === this.hs ? 'start' : t === this.he ? 'end' : 'pan'
    const unit = mode === 'pan' ? (w[1] - w[0]) / 10 : (f[1] - f[0]) / 50
    let d = 0
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': d = unit; break
      case 'ArrowLeft': case 'ArrowDown': d = -unit; break
      case 'PageUp': d = unit * 10; break
      case 'PageDown': d = -unit * 10; break
      case 'Home': d = -Infinity; break
      case 'End': d = Infinity; break
      default: return
    }
    e.preventDefault()
    e.stopPropagation()
    const span = f[1] - f[0]
    const clampD = (v: number): number => (Number.isFinite(v) ? v : v > 0 ? span * 2 : -span * 2)
    const dd = clampD(d)
    const next: [number, number] = mode === 'pan' ? [w[0] + dd, w[1] + dd] : mode === 'start' ? [w[0] + dd, w[1]] : [w[0], w[1] + dd]
    this.set(next, mode, 250)
  }
}

const round = (v: number): number => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0)

