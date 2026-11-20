// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot, type SelectEvent, type ZoomRange } from '@supersolutions/super-plot-web'
import { compilePlot, type AxisInfo } from '@supersolutions/super-plot-core'
import { pinchDomain } from '../../packages/bindings/web/src/interact'
import { nearestMark, pathCenter } from '../../packages/bindings/web/src/canvas'
import { CSS } from '../../packages/bindings/web/src/styles'
import { stub2d, loadCanvasChunk } from './stub2d'

// The canvas renderer is loaded on demand: load it once, so canvas plots below draw at once.
beforeAll(loadCanvasChunk)

const realGetContext = HTMLCanvasElement.prototype.getContext
let host: HTMLDivElement
const box = { width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} } as DOMRect
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => box
})
afterEach(() => {
  document.body.innerHTML = ''
  HTMLCanvasElement.prototype.getContext = realGetContext
  vi.useRealTimers()
})

const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: i * 2 }))
const raf = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()))
const rootOf = (): HTMLElement => {
  const r = host.querySelector<HTMLElement>('.sp-root')!
  r.getBoundingClientRect = () => box
  return r
}
/** A pointer event as a touch screen sends it (jsdom has no PointerEvent: a MouseEvent with the pointer fields). */
const touch = (el: Element, type: string, id: number, x: number, y: number, pointerType = 'touch'): MouseEvent => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: pointerType }, isPrimary: { value: id === 1 } })
  el.dispatchEvent(e)
  return e
}
const domain = (p: SuperPlot): [number, number] => p.getScene()!.axes!.x.domain as [number, number]

describe('touch: pinch and two-finger pan', () => {
  it('spreading two fingers zooms around them; the point under them does not drift; reported once when they lift', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const zooms: (ZoomRange | null)[] = []
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, onZoom: z => zooms.push(z) })
    const root = rootOf()
    const a = p.getScene()!.axes!
    const mid = a.plot.x + a.plot.w / 2, cy = a.plot.y + a.plot.h / 2
    touch(root, 'pointerdown', 1, mid - 50, cy)
    touch(root, 'pointerdown', 2, mid + 50, cy)
    // Both fingers move apart symmetrically: twice, then three times the distance, around x = 50.
    touch(root, 'pointermove', 2, mid + 100, cy)
    touch(root, 'pointermove', 1, mid - 100, cy)
    await raf()
    expect(domain(p)[0]).toBeCloseTo(25, 9)
    expect(domain(p)[1]).toBeCloseTo(75, 9)
    touch(root, 'pointermove', 2, mid + 150, cy)
    touch(root, 'pointermove', 1, mid - 150, cy)
    await raf()
    expect(domain(p)[0]).toBeCloseTo(100 / 3, 9)
    expect(domain(p)[1]).toBeCloseTo(200 / 3, 9)
    expect(zooms).toEqual([])
    touch(root, 'pointerup', 1, mid - 150, cy)
    touch(root, 'pointerup', 2, mid + 150, cy)
    vi.advanceTimersByTime(10)
    expect(zooms).toHaveLength(1)
    expect(zooms[0]!.x!.range[0]).toBeCloseTo(100 / 3, 9)
  })

  it('moving two fingers together pans; the span stays', async () => {
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false })
    p.setZoom({ x: [20, 60] })
    await raf()
    const root = rootOf()
    const a = p.getScene()!.axes!
    const perUnit = a.plot.w / 40
    const cx = a.plot.x + a.plot.w / 2, cy = a.plot.y + a.plot.h / 2
    touch(root, 'pointerdown', 1, cx - 40, cy)
    touch(root, 'pointerdown', 2, cx + 40, cy)
    touch(root, 'pointermove', 1, cx - 40 + 10 * perUnit, cy)
    touch(root, 'pointermove', 2, cx + 40 + 10 * perUnit, cy)
    await raf()
    expect(domain(p)[0]).toBeCloseTo(10, 9)
    expect(domain(p)[1]).toBeCloseTo(50, 9)
    touch(root, 'pointerup', 1, 0, 0)
    touch(root, 'pointerup', 2, 0, 0)
    // A pinch is not a brush or a click: nothing is selected afterwards.
    expect(p.getBrush()).toBeNull()
  })

  it('pinchDomain: anchor to midpoint, linear and log', () => {
    const lin: AxisInfo = { kind: 'linear', domain: [0, 100], range: [0, 100] }
    expect(pinchDomain(lin, [0, 100], 50, 50, 2)).toEqual([25, 75])
    expect(pinchDomain(lin, [0, 100], 50, 60, 1)).toEqual([-10, 90])
    const log: AxisInfo = { kind: 'linear', scale: 'log', domain: [1, 10000], range: [0, 400] }
    const [l0, l1] = pinchDomain(log, [1, 10000], 200, 200, 2)
    expect(l0).toBeCloseTo(10, 9)
    expect(l1).toBeCloseTo(1000, 9)
  })
})

describe('touch: targets of at least 24 px', () => {
  const near = { type: 'scatter', x: 'x', y: 'y', data: [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 9 }] }
  it('a tap that just misses a dot picks it; a mouse click there does not', () => {
    const picked: SelectEvent[] = []
    const p = new SuperPlot(host, near, { width: 600, height: 400, animate: false, onSelect: e => picked.push(e) })
    rootOf()
    const dot = p.getScene()!.marks.find(m => m.type === 'circle' && m.role === 'data' && (m.datum as { x: number }).x === 5) as { cx: number; cy: number; r: number }
    // 14 px right of the centre: outside the 10 px hit circle, inside 12 px of the dot's edge.
    const svg = host.querySelector('svg')!
    touch(svg, 'pointerdown', 1, dot.cx + 14, dot.cy, 'mouse')
    touch(svg, 'click', 1, dot.cx + 14, dot.cy, 'mouse')
    expect(picked).toHaveLength(0)
    touch(svg, 'pointerdown', 2, dot.cx + 14, dot.cy)
    touch(svg, 'pointerover', 2, dot.cx + 14, dot.cy)
    expect(host.querySelector('.sp-tip')!.hasAttribute('data-show')).toBe(true)
    touch(svg, 'click', 2, dot.cx + 14, dot.cy)
    expect((picked[0]?.datum as { x: number }).x).toBe(5)
    // Too far is still a miss.
    touch(svg, 'click', 3, dot.cx + 40, dot.cy + 40)
    expect(picked).toHaveLength(1)
  })

  it('the same on canvas, after a touch press', () => {
    HTMLCanvasElement.prototype.getContext = (() => stub2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const picked: SelectEvent[] = []
    const p = new SuperPlot(host, near, { width: 600, height: 400, animate: false, renderer: 'canvas', onSelect: e => picked.push(e) })
    const cv = host.querySelector('canvas')!
    cv.getBoundingClientRect = () => box
    const dot = p.getScene()!.marks.find(m => m.type === 'circle' && m.role === 'data' && (m.datum as { x: number }).x === 9) as { cx: number; cy: number }
    touch(cv, 'pointerdown', 1, dot.cx + 14, dot.cy, 'mouse')
    cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: dot.cx + 14, clientY: dot.cy }))
    expect(picked).toHaveLength(0)
    touch(cv, 'pointerdown', 2, dot.cx + 14, dot.cy)
    cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: dot.cx + 14, clientY: dot.cy }))
    expect((picked[0]?.datum as { x: number }).x).toBe(9)
  })

  it('nearestMark measures to the edge; coarse pointers get larger hit circles and buttons', () => {
    const r = compilePlot(near, { width: 600, height: 400 })
    const s = r.ok ? r.scene : (null as never)
    const i = s.marks.findIndex(m => m.type === 'circle' && m.role === 'data')
    const c = s.marks[i] as { cx: number; cy: number; r: number }
    expect(nearestMark(s, c.cx + c.r + 11, c.cy, 12)).toBeGreaterThanOrEqual(0)
    expect(nearestMark(s, c.cx + c.r + 30, c.cy, 12)).toBe(-1)
    expect(pathCenter('M0 0L10 0L10 20Z')).toEqual({ x: 5, y: 10 })
    expect(pathCenter('M10 10A5 5 0 0 1 20 10l0 10')).toEqual({ x: 15, y: 15 })
    const coarse = CSS.slice(CSS.indexOf('@media (pointer:coarse)'))
    expect(coarse).toContain('.sp-root svg circle.sp-hit{r:12px}')
    expect(coarse).toContain('.sp-nav-h{width:24px')
    expect(CSS).toContain('.sp-root[data-axes]{touch-action:pan-y')
  })
})
