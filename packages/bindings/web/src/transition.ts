// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Animated transitions between two data states (the `transition` option, off by default). Marks of the old and
 * the new scene are matched by a key (series and datum identity, see {@link markKeys}); matched marks move,
 * new ones grow from the baseline or fade in, gone ones fade out. Only data marks move: axes, labels, legend and
 * hit targets are drawn in their final state at once, and the scene the plot keeps (tooltips, aria, keyboard,
 * data table, exports) is always the final one. The maths here is pure; {@link SvgFrames} and
 * {@link Player} are the DOM side.
 */
import { renderSvg, roundedRectPath, PATTERN_OPACITY, type AxisInfo, type Mark, type Scene } from '@supersolutions/super-plot-core/base'

/** The `transition` option as an object. */
export interface TransitionOptions {
  /** Milliseconds, clamped to 0..1,000 (0 turns it off). Default 300. */
  duration?: number
  /** `cubic` (default) eases in and out; `linear` moves at a constant speed. */
  easing?: 'linear' | 'cubic'
}

export interface TransitionConf { duration: number; easing: 'linear' | 'cubic' }

/** Default and longest duration, in ms. */
export const TRANSITION_DEFAULT_MS = 300
export const TRANSITION_MAX_MS = 1000
/** Above this many data marks (before or after) the chart snaps to the new state: a frame would cost too much. */
export const TRANSITION_MAX_MARKS = 5000

/** The option resolved: null when off (false, undefined, a duration of 0 or less, anything else). */
export function transitionConf(o: unknown): TransitionConf | null {
  if (o === true) return { duration: TRANSITION_DEFAULT_MS, easing: 'cubic' }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const { duration, easing } = o as TransitionOptions
  const d = typeof duration === 'number' && !Number.isNaN(duration) ? Math.min(TRANSITION_MAX_MS, duration) : TRANSITION_DEFAULT_MS
  return d > 0 ? { duration: d, easing: easing === 'linear' ? 'linear' : 'cubic' } : null
}

/** Progress `t` (clamped to 0..1) through the easing curve. */
export function ease(kind: TransitionConf['easing'], t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  if (kind === 'linear') return x
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Motion is allowed now: the page is visible and the viewer has not asked for reduced motion. Read live. */
export function motionAllowed(win: (Window & typeof globalThis) | null | undefined): boolean {
  if (!win || typeof requestAnimationFrame !== 'function') return false
  const doc = win.document
  if (doc && (doc.visibilityState === 'hidden' || doc.hidden === true)) return false
  try {
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false
  } catch {
    return false
  }
  return true
}

// ---- matching ------------------------------------------------------------------------------

/** Datum fields that are numbers but name the mark rather than measure it (a numeric x category, a row index). */
const ID_NUMBERS = new Set(['x', 'row'])
/** String fields that are values, not names (a timeline bar's ends). */
const NOT_ID = new Set(['start', 'end'])

/**
 * What names a datum: its text and flag fields (category, series, group, label, ISO date, a path of names), and
 * `x` or `row` when they are numbers (`x` only when there is no numeric `y`: a scatter point's x is a value).
 * Other numbers are measures. '' when nothing names it.
 */
export function datumIdentity(d: unknown): string {
  if (typeof d === 'string') return d
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ''
  const o = d as Record<string, unknown>
  const out: string[] = []
  for (const k of Object.keys(o).sort()) {
    if (NOT_ID.has(k)) continue
    const v = o[k]
    if (typeof v === 'string' || typeof v === 'boolean') out.push(`${k}=${String(v)}`)
    else if (typeof v === 'number' && ID_NUMBERS.has(k) && !(k === 'x' && typeof o.y === 'number')) out.push(`${k}=${v}`)
    else if (Array.isArray(v) && v.length > 0 && v.every(s => typeof s === 'string')) out.push(`${k}=${v.join('\u001f')}`)
  }
  return out.join('\u001e')
}

/** A data mark's key, and whether only its position in the scene names it. */
export interface MarkKey { key: string; byOrder: boolean }

/**
 * Keys for the data marks of a list (null for the rest): role, type, series and {@link datumIdentity}, then a
 * count so the n-th mark with the same name matches the n-th (dots of one series, a line's path). Deterministic.
 */
export function markKeys(marks: readonly Mark[]): (MarkKey | null)[] {
  const seen = new Map<string, number>()
  return marks.map(m => {
    if (m.role !== 'data') return null
    const id = datumIdentity(m.datum)
    const base = `${m.type}|${m.series ?? ''}|${id}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { key: `${base}#${n}`, byOrder: id === '' }
  })
}

/** A data mark as it is on screen: its geometry, its key, and how far it has faded in (1: fully). */
export interface Shown {
  mark: Mark
  key: string
  byOrder: boolean
  alpha: number
  /** The clip path it is drawn in, resolved (it may come from an older scene). */
  clipD?: string
}

/** The data marks of a scene, as shown when nothing moves. */
export function shownOf(scene: Scene): Shown[] {
  const keys = markKeys(scene.marks)
  const out: Shown[] = []
  scene.marks.forEach((m, i) => {
    const k = keys[i]
    if (!k) return
    const clipD = m.clip !== undefined ? scene.clips?.[m.clip] : undefined
    out.push({ mark: m, key: k.key, byOrder: k.byOrder, alpha: 1, ...(clipD !== undefined ? { clipD } : {}) })
  })
  return out
}

// ---- paths ---------------------------------------------------------------------------------

/** A path's commands and the numbers after each. */
export interface ParsedPath { cmds: string[]; nums: number[][] }

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** Parse path data, or null when it has anything this does not read (then the path cross-fades). */
export function parsePath(d: string): ParsedPath | null {
  const re = /([MLHVCSQTAZ])|([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)|([\s,]+)|(.)/gi
  const cmds: string[] = []
  const nums: number[][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    if (m[4] !== undefined) return null
    if (m[1] !== undefined) {
      cmds.push(m[1])
      nums.push([])
    } else if (m[2] !== undefined) {
      if (!cmds.length) return null
      nums[nums.length - 1].push(Number(m[2]))
    }
  }
  for (let i = 0; i < cmds.length; i++) {
    const k = ARGS[cmds[i].toUpperCase()]
    if (k === 0 ? nums[i].length !== 0 : nums[i].length === 0 || nums[i].length % k !== 0) return null
  }
  return cmds.length ? { cmds, nums } : null
}

/** Same commands with the same number of arguments, and the same arc flags: the numbers can be interpolated. */
export function samePathShape(a: ParsedPath, b: ParsedPath): boolean {
  if (a.cmds.length !== b.cmds.length) return false
  for (let i = 0; i < a.cmds.length; i++) {
    if (a.cmds[i] !== b.cmds[i] || a.nums[i].length !== b.nums[i].length) return false
    if (a.cmds[i] === 'A' || a.cmds[i] === 'a') {
      for (let j = 0; j < a.nums[i].length; j += 7) if (a.nums[i][j + 3] !== b.nums[i][j + 3] || a.nums[i][j + 4] !== b.nums[i][j + 4]) return false
    }
  }
  return true
}

const r2 = (v: number): number => Math.round(v * 100) / 100

/** The path `e` of the way from `a` to `b` (same shape), as path data. */
export function lerpPath(a: ParsedPath, b: ParsedPath, e: number): string {
  let out = ''
  for (let i = 0; i < b.cmds.length; i++) {
    const x = a.nums[i], y = b.nums[i]
    out += b.cmds[i] + y.map((v, j) => String(r2(x[j] + (v - x[j]) * e))).join(' ')
  }
  return out
}

// ---- plans and frames ----------------------------------------------------------------------

interface Item {
  /** Index of the mark in the new scene. */
  i: number
  key: string
  byOrder: boolean
  from: Mark
  to: Mark
  /** Faded in this much at the start (0: entering, 1: already on screen). */
  a0: number
  /** Nothing to animate: same geometry, fully shown. */
  still: boolean
  pa?: ParsedPath
  pb?: ParsedPath
}

/** From what is on screen to a new scene. */
export interface Plan {
  scene: Scene
  items: Item[]
  /** Marks that are gone (or replaced by an incompatible shape), fading out from where they are. */
  leaving: Shown[]
  /** Where gone marks are drawn: under the first data mark of the new scene. */
  under: number
  /** Something changes on screen. */
  moving: boolean
}

export interface PlanOptions {
  /**
   * Marks matched only by their position (no identity in their datum) cross-fade instead of moving. For
   * `appendRows`: after rows are added or dropped at one end, the n-th point is another row.
   */
  orderFade?: boolean
}

const geomKeys: Record<Mark['type'], readonly string[]> = {
  rect: ['x', 'y', 'w', 'h'],
  circle: ['cx', 'cy', 'r'],
  line: ['x1', 'y1', 'x2', 'y2'],
  text: ['x', 'y'],
  path: []
}

function sameGeometry(a: Mark, b: Mark): boolean {
  if (a.type !== b.type || (a.opacity ?? 1) !== (b.opacity ?? 1)) return false
  if (a.type === 'path') return a.d === (b as typeof a).d
  if (a.type === 'rect' && JSON.stringify(a.r) !== JSON.stringify((b as typeof a).r)) return false
  const x = a as unknown as Record<string, number>, y = b as unknown as Record<string, number>
  return geomKeys[a.type].every(k => x[k] === y[k])
}

/** The pixel where value 0 sits on a linear axis (clamped into the axis), or null. */
function zeroOf(a: AxisInfo | undefined): number | null {
  if (!a || a.kind !== 'linear' || a.scale === 'log' || typeof a.domain[0] !== 'number') return null
  const [d0, d1] = a.domain as [number, number]
  if (d0 === d1 || !Number.isFinite(d0) || !Number.isFinite(d1)) return null
  const p = a.range[0] + ((0 - d0) / (d1 - d0)) * (a.range[1] - a.range[0])
  return Math.min(Math.max(p, Math.min(a.range[0], a.range[1])), Math.max(a.range[0], a.range[1]))
}

/** Where a new bar starts: flat on the edge nearest the zero line (the bottom or left edge without axes). */
function grownFrom(m: Mark, zx: number | null, zy: number | null): Mark | null {
  if (m.type !== 'rect') return null
  if (m.anim === 'y') {
    const base = zy ?? m.y + m.h
    const edge = Math.abs(m.y - base) < Math.abs(m.y + m.h - base) ? m.y : m.y + m.h
    return { ...m, y: edge, h: 0 }
  }
  if (m.anim === 'x') {
    const base = zx ?? m.x
    const edge = Math.abs(m.x - base) <= Math.abs(m.x + m.w - base) ? m.x : m.x + m.w
    return { ...m, x: edge, w: 0 }
  }
  return null
}

/**
 * Match what is on screen (`from`, see {@link shownOf} and {@link Player.shown}) against the new scene's data
 * marks by key. Matched marks of the same type move (paths only when their commands match); the rest of the
 * new marks enter (bars grow from the baseline, everything else fades in), and the rest of `from` leaves.
 */
export function planTransition(from: readonly Shown[], to: Scene, o: PlanOptions = {}): Plan {
  const pool = new Map<string, Shown>()
  // Later entries win: what is fully on screen over a fading copy with the same key.
  for (const s of from) pool.set(s.key, s)
  const used = new Set<Shown>()
  const keys = markKeys(to.marks)
  const flat = !to.panels
  const zx = flat ? zeroOf(to.axes?.x) : null
  const zy = flat ? zeroOf(to.axes?.y) : null
  const items: Item[] = []
  let under = -1
  let moving = false
  to.marks.forEach((m, i) => {
    const k = keys[i]
    if (!k) return
    if (under < 0) under = i
    const s = pool.get(k.key)
    if (s && !used.has(s) && s.mark.type === m.type) {
      const still = s.alpha >= 1 && sameGeometry(s.mark, m)
      let pa: ParsedPath | null | undefined, pb: ParsedPath | null | undefined
      if (!still && m.type === 'path') {
        pa = parsePath((s.mark as typeof m).d)
        pb = parsePath(m.d)
      }
      const fits = still || m.type !== 'path' || (!!pa && !!pb && samePathShape(pa, pb))
      if (fits && (still || !(o.orderFade && k.byOrder && s.byOrder))) {
        used.add(s)
        items.push({ i, key: k.key, byOrder: k.byOrder, from: s.mark, to: m, a0: s.alpha, still, ...(pa && pb ? { pa, pb } : {}) })
        if (!still) moving = true
        return
      }
    }
    // New (or replaced by another shape, which then fades out below): grow from the baseline, else fade in.
    const grow = s ? null : grownFrom(m, zx, zy)
    items.push({ i, key: k.key, byOrder: k.byOrder, from: grow ?? m, to: m, a0: grow ? 1 : 0, still: false })
    moving = true
  })
  const leaving = from.filter(s => !used.has(s) && s.alpha > 0.001)
  if (leaving.length) moving = true
  return { scene: to, items, leaving, under: under < 0 ? to.marks.length : under, moving }
}

const lerp = (a: number, b: number, e: number): number => a + (b - a) * e

/** Item `it` at eased progress `e`: geometry and base opacity between its two states. */
function markAt(it: Item, e: number): Mark {
  const a = it.from, b = it.to
  if (e >= 1) return b
  const opacity = lerp(a.opacity ?? 1, b.opacity ?? 1, e)
  switch (b.type) {
    case 'rect': {
      const p = a as typeof b
      const r = typeof p.r === 'number' && typeof b.r === 'number' ? lerp(p.r, b.r, e) : b.r
      return { ...b, x: lerp(p.x, b.x, e), y: lerp(p.y, b.y, e), w: lerp(p.w, b.w, e), h: lerp(p.h, b.h, e), ...(r !== undefined ? { r } : {}), opacity }
    }
    case 'circle': {
      const p = a as typeof b
      return { ...b, cx: lerp(p.cx, b.cx, e), cy: lerp(p.cy, b.cy, e), r: lerp(p.r, b.r, e), opacity }
    }
    case 'line': {
      const p = a as typeof b
      return { ...b, x1: lerp(p.x1, b.x1, e), y1: lerp(p.y1, b.y1, e), x2: lerp(p.x2, b.x2, e), y2: lerp(p.y2, b.y2, e), opacity }
    }
    case 'text': {
      const p = a as typeof b
      return { ...b, x: lerp(p.x, b.x, e), y: lerp(p.y, b.y, e), opacity }
    }
    case 'path':
      return { ...b, d: it.pa && it.pb ? lerpPath(it.pa, it.pb, e) : b.d, opacity }
  }
}

/** What changes in a frame: the moving marks of the new scene (by index) and the fade of the gone ones. */
export interface Frame {
  marks: { i: number; mark: Mark; alpha: number }[]
  /** Multiplies the opacity of every leaving mark (1 at the start, 0 at the end). */
  leaving: number
}

/** The frame at eased progress `e` (1: the new scene exactly). */
export function frameAt(plan: Plan, e: number): Frame {
  const marks: Frame['marks'] = []
  for (const it of plan.items) if (!it.still) marks.push({ i: it.i, mark: markAt(it, e), alpha: e >= 1 ? 1 : lerp(it.a0, 1, e) })
  return { marks, leaving: e >= 1 ? 0 : 1 - e }
}

const withAlpha = (m: Mark, alpha: number): Mark => (alpha >= 1 ? m : { ...m, opacity: (m.opacity ?? 1) * alpha })

/** The whole scene at progress `e`, for a renderer that redraws everything (canvas). `e >= 1` is the new scene itself. */
export function frameScene(plan: Plan, e: number): Scene {
  if (e >= 1) return plan.scene
  const f = frameAt(plan, e)
  const marks = plan.scene.marks.slice()
  for (const { i, mark, alpha } of f.marks) marks[i] = withAlpha(mark, alpha)
  const clips: Record<string, string> = { ...plan.scene.clips }
  const gone: Mark[] = []
  for (const s of plan.leaving) {
    let m = withAlpha(s.mark, s.alpha * f.leaving)
    if (m.clip !== undefined) {
      if (s.clipD === undefined) m = { ...m, clip: undefined }
      else if (clips[m.clip] !== s.clipD) {
        // Another scene's clip under the same name: keep it apart.
        const name = `~${m.clip}`
        clips[name] = s.clipD
        m = { ...m, clip: name }
      }
    }
    gone.push(m)
  }
  marks.splice(plan.under, 0, ...gone)
  return { ...plan.scene, marks, clips }
}

/** What is on screen at progress `e`, keyed: where the next transition starts when this one is cut short. */
export function shownAt(plan: Plan, e: number): Shown[] {
  const clips = plan.scene.clips
  const out: Shown[] = []
  if (e < 1) for (const s of plan.leaving) if (s.alpha * (1 - e) > 0.001) out.push({ ...s, alpha: s.alpha * (1 - e) })
  for (const it of plan.items) {
    const mark = it.still ? it.to : markAt(it, e)
    const clipD = mark.clip !== undefined ? clips?.[mark.clip] : undefined
    out.push({ mark, key: it.key, byOrder: it.byOrder, alpha: it.still || e >= 1 ? 1 : lerp(it.a0, 1, e), ...(clipD !== undefined ? { clipD } : {}) })
  }
  return out
}

// ---- SVG -----------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg'
const n = (v: number): string => (Number.isFinite(v) ? String(r2(v)) : '0')

/** Write a mark's geometry and opacity onto its element the way `renderSvg` writes them. */
function writeMark(el: Element, m: Mark, alpha: number, pattern: boolean): void {
  switch (m.type) {
    case 'rect':
      if (Array.isArray(m.r)) el.setAttribute('d', roundedRectPath(m.x, m.y, m.w, m.h, m.r))
      else {
        el.setAttribute('x', n(m.x))
        el.setAttribute('y', n(m.y))
        el.setAttribute('width', n(Math.max(0, m.w)))
        el.setAttribute('height', n(Math.max(0, m.h)))
        if (m.r) el.setAttribute('rx', n(m.r))
        else el.removeAttribute('rx')
      }
      break
    case 'circle':
      el.setAttribute('cx', n(m.cx))
      el.setAttribute('cy', n(m.cy))
      el.setAttribute('r', n(m.r))
      break
    case 'line':
      el.setAttribute('x1', n(m.x1))
      el.setAttribute('y1', n(m.y1))
      el.setAttribute('x2', n(m.x2))
      el.setAttribute('y2', n(m.y2))
      break
    case 'path':
      el.setAttribute('d', m.d)
      break
    case 'text':
      el.setAttribute('x', n(m.x))
      el.setAttribute('y', n(m.y))
      if (m.rotate) el.setAttribute('transform', `rotate(${n(m.rotate)} ${n(m.x)} ${n(m.y)})`)
      break
  }
  const op = (m.opacity ?? 1) * (pattern ? PATTERN_OPACITY : 1) * alpha
  if (op !== 1) el.setAttribute('opacity', n(op))
  else el.removeAttribute('opacity')
}

/**
 * Plays a plan on an SVG drawn by `renderSvg(plan.scene, { interactive: true })`: moves the data elements
 * (and their texture overlays) frame by frame, and fades copies of the gone marks, which are `aria-hidden` and
 * take no pointer events. Every other attribute (aria, tabindex, data hooks) is already the final one.
 */
export class SvgFrames {
  private els: { el: Element; pat: Element | null }[] = []
  private ghost: SVGGElement | null = null

  constructor(private svg: SVGSVGElement, private plan: Plan, idPrefix: string, font: string) {
    const byIndex = new Map<number, Element>()
    for (const el of svg.querySelectorAll('[data-i]')) byIndex.set(Number(el.getAttribute('data-i')), el)
    for (const it of plan.items) {
      if (it.still) continue
      const el = byIndex.get(it.i)
      const next = el?.nextElementSibling
      this.els[it.i] = { el: el!, pat: next && next.classList.contains('sp-pat') ? next : null }
    }
    if (plan.leaving.length) this.ghost = this.makeGhost(idPrefix, font)
  }

  /** Copies of the gone marks under the new data marks, in a group whose opacity fades them all. */
  private makeGhost(idPrefix: string, font: string): SVGGElement | null {
    const doc = this.svg.ownerDocument
    const clips: Record<string, string> = {}
    const marks = this.plan.leaving.map(s => {
      let m: Mark = { ...s.mark, opacity: (s.mark.opacity ?? 1) * s.alpha, pattern: undefined }
      if (m.clip !== undefined && s.clipD !== undefined) clips[m.clip] ??= s.clipD
      else if (m.clip !== undefined) m = { ...m, clip: undefined }
      return m
    })
    const src = renderSvg({ ...this.plan.scene, title: '', description: '', marks, clips, series: [] }, { idPrefix: `${idPrefix}-g`, font })
    const tpl = doc.createElement('template')
    tpl.innerHTML = src
    const parsed = tpl.content.firstElementChild
    if (!parsed) return null
    const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement
    g.setAttribute('class', 'sp-ghost')
    g.setAttribute('aria-hidden', 'true')
    g.setAttribute('pointer-events', 'none')
    // Skip the title, the description and the background.
    for (const c of [...parsed.children].slice(3)) g.appendChild(c)
    const first = this.svg.querySelector('.sp-data')
    if (first?.parentNode) first.parentNode.insertBefore(g, first)
    else this.svg.appendChild(g)
    return g
  }

  /** Draw progress `e` (1: the final attributes, ghosts removed). */
  apply(e: number): void {
    const f = frameAt(this.plan, e)
    for (const { i, mark, alpha } of f.marks) {
      const t = this.els[i]
      if (!t?.el) continue
      writeMark(t.el, mark, alpha, false)
      if (t.pat) writeMark(t.pat, mark, alpha, true)
    }
    if (e >= 1) this.dispose()
    else this.ghost?.setAttribute('opacity', n(f.leaving))
  }

  /** Remove the ghosts (the moved elements are left as they are). */
  dispose(): void {
    this.ghost?.remove()
    this.ghost = null
  }
}

// ---- clock ---------------------------------------------------------------------------------

interface Job {
  plan: Plan
  conf: TransitionConf
  draw: (e: number) => void
  /** `done`: it ran to the end (the final state is drawn); false: cut short (the next draw replaces it). */
  end: (done: boolean) => void
}

/**
 * Runs one transition at a time on `requestAnimationFrame`. Frame 0 is drawn by `start` itself, so the old state
 * is on screen before the browser paints the new one. Each frame checks again that motion is allowed (reduced
 * motion turned on, the page hidden) and jumps to the end if not.
 */
export class Player {
  private job: Job | null = null
  private raf = 0
  private t0 = 0
  private e = 0

  /** `win` is read for reduced motion and page visibility; frames come from the global `requestAnimationFrame`. */
  constructor(private win: (Window & typeof globalThis) | null) {}

  get running(): boolean { return this.job !== null }

  start(plan: Plan, conf: TransitionConf, draw: (e: number) => void, end: (done: boolean) => void): void {
    this.stop()
    this.job = { plan, conf, draw, end }
    this.t0 = performance.now()
    this.e = 0
    draw(0)
    this.raf = requestAnimationFrame(this.tick)
  }

  /** What is on screen now, or null when nothing is running. */
  shown(): Shown[] | null {
    return this.job ? shownAt(this.job.plan, this.e) : null
  }

  /** Cut the running transition short without drawing (the caller draws the next state). */
  stop(): void {
    const job = this.job
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.job = null
    job?.end(false)
  }

  /** Jump to the end state now. */
  finish(): void {
    const job = this.job
    if (!job) return
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.job = null
    this.e = 1
    job.draw(1)
    job.end(true)
  }

  private tick = (): void => {
    this.raf = 0
    const job = this.job
    if (!job) return
    const now = performance.now()
    const t = motionAllowed(this.win) ? (now - this.t0) / job.conf.duration : 1
    if (t >= 1) return this.finish()
    this.e = ease(job.conf.easing, t)
    job.draw(this.e)
    this.raf = requestAnimationFrame(this.tick)
  }
}
