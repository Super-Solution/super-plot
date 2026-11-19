// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Canvas output for a scene. It takes any object shaped like a 2D context (a browser canvas, node-canvas,
 * skia-canvas) and does not touch the DOM itself, so it lives next to the SVG renderer. A scene with
 * tens of thousands of marks is drawn here in a few milliseconds; the same scene also feeds `renderSvg`.
 */
import type { Mark, Scene } from './scene.js'
import { PATTERN_OPACITY, patternAt } from './patterns.js'

/** The slice of CanvasRenderingContext2D that Super Plot uses. */
export interface Canvas2D {
  save(): void
  restore(): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(path?: unknown, rule?: string): void
  clip(path?: unknown, rule?: string): void
  stroke(path?: unknown): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  translate(x: number, y: number): void
  rotate(a: number): void
  setLineDash(d: number[]): void
  globalAlpha: number
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  lineJoin: string
  lineCap: string
  font: string
  textAlign: string
  textBaseline: string
}

export type Path2DCtor = new (d?: string) => unknown

export interface DrawOptions {
  /** Font stack; `var()` is resolved with `resolve`. */
  font?: string
  /** Turns `var(--sp-x, #fff)` into a plain colour (default: the fallback). */
  resolve?: (paint: string) => string
  /** Needed to draw `path` marks (pies, lines, areas, sankey bands). */
  Path2D?: Path2DCtor
  /** Reuse parsed paths between draws (the web binding keeps one per scene). */
  paths?: Map<number, unknown>
  /** Draw only the marks this accepts (a 3D renderer takes the rest). */
  filter?: (mark: Mark, index: number) => boolean
  /** Skip the background fill (a layer drawn over another). */
  transparent?: boolean
  /** A fill style for texture `i` (`patterns: true`); the web binding builds one from {@link drawPatternTile}. */
  pattern?: (index: number) => unknown
  /**
   * Draw a run of same-style dots without paths, e.g. by stamping pixels. Return false to let the default path
   * drawing run. The web binding uses this for dense scatter plots, where it is many times faster.
   */
  dots?: (run: { cx: Float64Array; cy: Float64Array; r: Float64Array; fill: string; opacity: number; clip?: string }) => boolean
}

/** Draw texture `index` onto an 8 x 8 tile (scale the context first for a sharper tile) in `ink`. */
export function drawPatternTile(ctx: Canvas2D, index: number, ink: string, Path2D?: Path2DCtor): void {
  const t = patternAt(index)
  ctx.save()
  if (t.lines && Path2D) {
    ctx.strokeStyle = ink
    ctx.lineWidth = t.width ?? 1
    ctx.stroke(new Path2D(t.lines))
  }
  for (const [x, y] of t.dots ?? []) {
    ctx.beginPath()
    ctx.arc(x, y, t.r ?? 1, 0, Math.PI * 2)
    ctx.fillStyle = ink
    ctx.fill()
  }
  ctx.restore()
}

/** Plain colour from `var(--a, var(--b, #fff))`: the first variable `lookup` knows, else the innermost fallback. */
export function resolveColor(value: string, lookup?: (name: string) => string | undefined): string {
  if (!value.startsWith('var(')) return value
  let depth = 0
  let end = -1
  for (let i = 3; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) { end = i; break }
  }
  if (end < 0) return ''
  const inner = value.slice(4, end)
  let comma = -1
  depth = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) { comma = i; break }
  }
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
  const got = lookup?.(name)?.trim()
  if (got) return resolveColor(got, lookup)
  return comma < 0 ? '' : resolveColor(inner.slice(comma + 1).trim(), lookup)
}

const paintOf = (v: string | undefined, rv: (s: string) => string): string | null => (v === undefined || v === 'none' ? null : rv(v))

function roundedRect(ctx: Canvas2D, x: number, y: number, w: number, h: number, r: number | [number, number, number, number] | undefined): void {
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r ?? 0, r ?? 0, r ?? 0, r ?? 0]).map(v => Math.max(0, Math.min(v, w / 2, h / 2))) as [number, number, number, number]
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr)
  ctx.lineTo(x + w, y + h - br)
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br)
  ctx.lineTo(x + bl, y + h)
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl)
  ctx.lineTo(x, y + tl)
  if (tl) ctx.arcTo(x, y, x + tl, y, tl)
  ctx.closePath()
}

const sameStyle = (a: Extract<Mark, { type: 'circle' }>, b: Extract<Mark, { type: 'circle' }>): boolean =>
  a.fill === b.fill && a.stroke === b.stroke && a.strokeWidth === b.strokeWidth && (a.opacity ?? 1) === (b.opacity ?? 1) && b.role === 'data' && a.role === 'data'

/** Draw every mark of a scene (in order) onto a context whose origin is the scene's top left corner. */
export function drawScene(ctx: Canvas2D, scene: Scene, o: DrawOptions = {}): void {
  const rv = o.resolve ?? ((s: string): string => resolveColor(s))
  const font = rv(o.font ?? 'system-ui, sans-serif')
  ctx.save()
  ctx.globalAlpha = 1
  if (!o.transparent) {
    ctx.fillStyle = rv(scene.background)
    ctx.fillRect(0, 0, scene.width, scene.height)
  }
  const marks = scene.marks
  const filter = o.filter
  let clipped: string | undefined
  const clipCache = new Map<string, unknown>()
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    if (m.role === 'hit' || (filter && !filter(m, i))) continue
    const want = m.clip !== undefined && scene.clips?.[m.clip] !== undefined && o.Path2D ? m.clip : undefined
    if (want !== clipped) {
      if (clipped !== undefined) ctx.restore()
      clipped = want
      if (want !== undefined) {
        ctx.save()
        let cp = clipCache.get(want)
        if (!cp) { cp = new o.Path2D!(scene.clips![want]); clipCache.set(want, cp) }
        ctx.clip(cp)
      }
    }
    ctx.globalAlpha = m.opacity ?? 1
    switch (m.type) {
      case 'rect': {
        const fill = paintOf(m.fill, rv)
        const stroke = paintOf(m.stroke, rv)
        if (!fill && !stroke) break
        roundedRect(ctx, m.x, m.y, Math.max(0, m.w), Math.max(0, m.h), m.r)
        if (fill && fill !== 'transparent') {
          ctx.fillStyle = fill
          ctx.fill()
          const pat = m.pattern !== undefined ? o.pattern?.(m.pattern) : undefined
          if (pat) { ctx.globalAlpha = (m.opacity ?? 1) * PATTERN_OPACITY; ctx.fillStyle = pat; ctx.fill(); ctx.globalAlpha = m.opacity ?? 1 }
        }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = m.strokeWidth ?? 1; ctx.stroke() }
        break
      }
      case 'circle': {
        // Runs of identically styled dots (a scatter plot) become one path: tens of thousands of dots stay fast.
        let j = i
        while (j + 1 < marks.length && marks[j + 1].type === 'circle' && sameStyle(m, marks[j + 1] as typeof m) && marks[j + 1].clip === m.clip && (!filter || filter(marks[j + 1], j + 1))) j++
        const fill = paintOf(m.fill, rv)
        const stroke = paintOf(m.stroke, rv)
        if (o.dots && fill && !stroke && j - i >= 500) {
          const len = j - i + 1
          const cx = new Float64Array(len), cy = new Float64Array(len), r = new Float64Array(len)
          for (let k = 0; k < len; k++) {
            const c = marks[i + k] as typeof m
            cx[k] = c.cx
            cy[k] = c.cy
            r[k] = c.r
          }
          if (o.dots({ cx, cy, r, fill, opacity: m.opacity ?? 1, ...(m.clip !== undefined ? { clip: m.clip } : {}) })) {
            i = j
            break
          }
        }
        ctx.beginPath()
        for (let k = i; k <= j; k++) {
          const c = marks[k] as typeof m
          ctx.moveTo(c.cx + c.r, c.cy)
          ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2)
        }
        if (fill) { ctx.fillStyle = fill; ctx.fill() }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = m.strokeWidth ?? 1; ctx.stroke() }
        i = j
        break
      }
      case 'line': {
        ctx.beginPath()
        ctx.moveTo(m.x1, m.y1)
        ctx.lineTo(m.x2, m.y2)
        ctx.strokeStyle = rv(m.stroke)
        ctx.lineWidth = m.strokeWidth ?? 1
        ctx.setLineDash(m.dash ? m.dash.split(/[ ,]+/).map(Number).filter(Number.isFinite) : [])
        ctx.stroke()
        ctx.setLineDash([])
        break
      }
      case 'path': {
        if (!o.Path2D) break
        let p = o.paths?.get(i)
        if (!p) { p = new o.Path2D(m.d); o.paths?.set(i, p) }
        const fill = paintOf(m.fill, rv)
        const stroke = paintOf(m.stroke, rv)
        if (fill) {
          ctx.fillStyle = fill
          if (m.rule) ctx.fill(p, m.rule)
          else ctx.fill(p)
          const pat = m.pattern !== undefined ? o.pattern?.(m.pattern) : undefined
          if (pat) {
            ctx.globalAlpha = (m.opacity ?? 1) * PATTERN_OPACITY
            ctx.fillStyle = pat
            if (m.rule) ctx.fill(p, m.rule)
            else ctx.fill(p)
            ctx.globalAlpha = m.opacity ?? 1
          }
        }
        if (stroke) {
          ctx.strokeStyle = stroke
          ctx.lineWidth = m.strokeWidth ?? 1
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.setLineDash(m.dash ? m.dash.split(/[ ,]+/).map(Number).filter(Number.isFinite) : [])
          ctx.stroke(p)
          ctx.setLineDash([])
        }
        break
      }
      case 'text': {
        ctx.font = `${m.weight ?? 400} ${m.size}px ${font}`
        ctx.fillStyle = rv(m.fill)
        ctx.textAlign = m.anchor === 'middle' ? 'center' : m.anchor === 'end' ? 'right' : 'left'
        ctx.textBaseline = m.baseline === 'middle' ? 'middle' : m.baseline === 'hanging' ? 'hanging' : 'alphabetic'
        if (m.rotate) {
          ctx.save()
          ctx.translate(m.x, m.y)
          ctx.rotate((m.rotate * Math.PI) / 180)
          ctx.fillText(m.text, 0, 0)
          ctx.restore()
        } else ctx.fillText(m.text, m.x, m.y)
        break
      }
    }
  }
  if (clipped !== undefined) ctx.restore()
  ctx.restore()
}

// ---- hit testing ----------------------------------------------------------------------------

export interface HitIndex {
  /** Index of the mark under the point (topmost wins), or -1. `inPath` decides path marks. */
  at(x: number, y: number, inPath?: (markIndex: number, x: number, y: number) => boolean): number
}

const CELL = 32
const cellKey = (cx: number, cy: number): number => cx * 100003 + cy

/** Index the interactive marks of a scene (tooltips, legend items, hover strips) on a coarse grid. */
export function buildHitIndex(scene: Scene): HitIndex {
  const cells = new Map<number, number[]>()
  const paths: number[] = []
  const add = (i: number, x0: number, y0: number, x1: number, y1: number): void => {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = cellKey(cx, cy)
        const list = cells.get(k)
        if (list) list.push(i)
        else cells.set(k, [i])
      }
    }
  }
  scene.marks.forEach((m, i) => {
    if (!(m.tip || m.legendKey !== undefined || m.role === 'hit' || m.drill !== undefined)) return
    if (m.type === 'rect') add(i, m.x, m.y, m.x + m.w, m.y + m.h)
    else if (m.type === 'circle') add(i, m.cx - m.r - 3, m.cy - m.r - 3, m.cx + m.r + 3, m.cy + m.r + 3)
    else if (m.type === 'path') paths.push(i)
  })
  const inside = (m: Mark, x: number, y: number): boolean => {
    if (m.type === 'rect') return x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h
    if (m.type === 'circle') return Math.hypot(x - m.cx, y - m.cy) <= m.r + 3
    return false
  }
  return {
    at(x, y, inPath) {
      let best = -1
      for (const i of cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) if (i > best && inside(scene.marks[i], x, y)) best = i
      if (inPath) for (const i of paths) if (i > best && inPath(i, x, y)) best = i
      return best
    }
  }
}

/** Draw the hover state of one mark onto an overlay context: an outline, or a guide line with focus dots. */
export function drawHover(ctx: Canvas2D, scene: Scene, index: number, o: DrawOptions & { Path2D?: Path2DCtor } = {}): void {
  const m = scene.marks[index]
  if (!m) return
  const rv = o.resolve ?? ((s: string): string => resolveColor(s))
  const ink = rv('var(--sp-text, #131722)')
  ctx.save()
  ctx.globalAlpha = 1
  if (m.role === 'hit' && m.guide) {
    ctx.beginPath()
    ctx.moveTo(m.guide.x1, m.guide.y1)
    ctx.lineTo(m.guide.x2, m.guide.y2)
    ctx.strokeStyle = rv('var(--sp-axis, #D1D4DC)')
    ctx.lineWidth = 1
    ctx.stroke()
    for (const f of m.focus ?? []) {
      ctx.beginPath()
      ctx.arc(f.x, f.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = rv(f.color)
      ctx.fill()
      ctx.strokeStyle = rv(scene.background)
      ctx.lineWidth = 2
      ctx.stroke()
    }
  } else if (m.type === 'circle') {
    ctx.beginPath()
    ctx.arc(m.cx, m.cy, m.r + 2, 0, Math.PI * 2)
    ctx.strokeStyle = ink
    ctx.lineWidth = 2
    ctx.stroke()
  } else if (m.type === 'rect') {
    roundedRect(ctx, m.x, m.y, m.w, m.h, m.r)
    ctx.strokeStyle = ink
    ctx.lineWidth = 2
    ctx.stroke()
  } else if (m.type === 'path' && o.Path2D) {
    const p = o.paths?.get(index) ?? new o.Path2D(m.d)
    ctx.strokeStyle = ink
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke(p)
  }
  ctx.restore()
}

/** How many marks the viewer can hover or select: what decides between SVG and canvas. */
export const dataMarkCount = (scene: Scene): number => {
  let n = 0
  for (const m of scene.marks) if (m.role === 'data') n++
  return n
}
