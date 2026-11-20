// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot, type ZoomRange } from '@supersolutions/super-plot-web'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { compilePlot, type Issue } from '@supersolutions/super-plot-core'
import { NAV_HEIGHT, overviewOf, thinPath } from '../../packages/bindings/web/src/navigator'
import { CSS } from '../../packages/bindings/web/src/styles'
import { stub2d, loadCanvasChunk } from './stub2d'

// The canvas renderer is loaded on demand: load it once, so canvas plots below draw at once.
beforeAll(loadCanvasChunk)

const realGetContext = HTMLCanvasElement.prototype.getContext
let host: HTMLDivElement
const box = (w: number, h: number): DOMRect => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => box(600, 400)
})
afterEach(() => {
  document.body.innerHTML = ''
  HTMLCanvasElement.prototype.getContext = realGetContext
  vi.useRealTimers()
})

const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: Math.sin(i / 8) * 10 + 20 }))
const days = Array.from({ length: 60 }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), v: i % 7 }))
const raf = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()))
const navOf = (): HTMLElement => host.querySelector<HTMLElement>('.sp-nav')!
const sliders = (): HTMLElement[] => [...navOf().querySelectorAll<HTMLElement>('[role="slider"]')]
const key = (el: Element, k: string): void => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) }
const ptr = (el: Element, type: string, x: number, id = 1): void => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20, button: 0 })
  Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: 'mouse' } })
  el.dispatchEvent(e)
}
const num = (el: Element, a: string): number => Number(el.getAttribute(a))

// Tests below use the navigator with its code loaded.
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  const p = new SuperPlot(document.createElement('div'), { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, navigator: true })
  await p.ready()
  p.dispose()
})

describe('navigator', () => {
  it('keeps the strip\'s room at once and draws it when its code is here (no layout shift)', async () => {
    // A fresh module registry: the navigator's chunk is not loaded yet.
    vi.resetModules()
    const { SuperPlot: Fresh } = await import('@supersolutions/super-plot-web')
    const auto = document.createElement('div')
    host.appendChild(auto)
    const p = new Fresh(auto, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, animate: false, navigator: true })
    const nav = auto.querySelector<HTMLElement>('.sp-nav')!
    expect(nav.previousElementSibling).toBe(auto.querySelector('.sp-root'))
    expect(nav.childElementCount).toBe(0)
    // The strip's height comes from the stylesheet's .sp-nav rule, the placeholder's class too.
    expect(CSS).toContain(`.sp-nav{position:relative;display:block;width:100%;height:${NAV_HEIGHT}px`)
    const height = p.getScene()!.height
    await p.ready()
    const drawn = auto.querySelector<HTMLElement>('.sp-nav')!
    expect(drawn.querySelectorAll('[role="slider"]')).toHaveLength(3)
    expect(auto.querySelectorAll('.sp-nav')).toHaveLength(1)
    expect(drawn.previousElementSibling).toBe(auto.querySelector('.sp-root'))
    expect(p.getScene()!.height).toBe(height)
    p.dispose()
    expect(auto.querySelector('.sp-nav')).toBeNull()
  })

  it('adds an overview strip under a zoomable line chart, inside the given height', () => {
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true })
    const nav = navOf()
    expect(nav).not.toBeNull()
    expect(nav.previousElementSibling).toBe(host.querySelector('.sp-root'))
    expect(p.getScene()!.height).toBe(400 - NAV_HEIGHT)
    expect(nav.getAttribute('role')).toBe('group')
    expect(nav.getAttribute('aria-label')).toContain('Overview of x')
    // The first series drawn small: its line, scaled into the strip.
    const path = nav.querySelector('svg g path')!
    expect(path.getAttribute('d')).toBe((p.getScene()!.marks.find(m => m.type === 'path' && m.role === 'data') as { d: string }).d)
    expect(path.getAttribute('vector-effect')).toBe('non-scaling-stroke')
    const [win, start, end] = sliders()
    expect(win.getAttribute('aria-valuetext')).toBe('0 to 100')
    expect([num(start, 'aria-valuemin'), num(start, 'aria-valuenow'), num(end, 'aria-valuenow'), num(end, 'aria-valuemax')]).toEqual([0, 0, 100, 100])
    expect(start.tabIndex).toBe(0)
    expect(start.getAttribute('aria-label')).toBe('Start of the visible range of x')
    p.dispose()
    expect(host.querySelector('.sp-nav')).toBeNull()
  })

  it('follows setZoom, and its keyboard zooms and pans through the same zoom (onZoom once, after the keys)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const zooms: (ZoomRange | null)[] = []
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true, onZoom: z => zooms.push(z) })
    p.setZoom({ x: [20, 40] })
    await raf()
    const [win, start, end] = sliders()
    expect(win.getAttribute('aria-valuetext')).toBe('20 to 40')
    expect(num(start, 'aria-valuemax')).toBeCloseTo(39.8, 6)
    expect(zooms).toEqual([])
    // The window: a tenth of its width per arrow.
    key(win, 'ArrowRight')
    key(win, 'ArrowRight')
    await raf()
    expect(p.getZoom()!.x!.range).toEqual([24, 44])
    vi.advanceTimersByTime(300)
    expect(zooms).toEqual([{ x: { field: 'x', range: [24, 44] } }])
    // A handle: a fiftieth of the full range; End goes as far as it can.
    key(start, 'ArrowLeft')
    await raf()
    expect(p.getZoom()!.x!.range).toEqual([22, 44])
    key(end, 'End')
    await raf()
    expect(p.getZoom()!.x!.range).toEqual([22, 100])
    key(start, 'Home')
    await raf()
    expect(p.getZoom()).toBeNull()
    vi.advanceTimersByTime(300)
    expect(zooms.at(-1)).toBeNull()
    expect(sliders()[0].getAttribute('aria-valuetext')).toBe('0 to 100')
    // At the end already: nothing changes, nothing is reported.
    const n = zooms.length
    key(sliders()[1], 'Home')
    vi.advanceTimersByTime(300)
    expect(zooms).toHaveLength(n)
  })

  it('dragging the window pans, dragging a handle zooms; reported once when the drag ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const zooms: (ZoomRange | null)[] = []
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true, onZoom: z => zooms.push(z) })
    p.setZoom({ x: [20, 40] })
    await raf()
    const nav = navOf()
    nav.getBoundingClientRect = () => box(600, NAV_HEIGHT)
    // The strip lines up with the full-range chart's plot.
    const full = compilePlot({ type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400 - NAV_HEIGHT })
    const a = full.ok ? full.scene.axes! : (null as never)
    const perUnit = a.plot.w / 100
    const [win, , end] = sliders()
    ptr(win, 'pointerdown', 300)
    ptr(win, 'pointermove', 300 + 10 * perUnit)
    ptr(win, 'pointermove', 300 + 30 * perUnit)
    await raf()
    const r = p.getZoom()!.x!.range as [number, number]
    expect(r[0]).toBeCloseTo(50, 6)
    expect(r[1]).toBeCloseTo(70, 6)
    expect(zooms).toEqual([])
    ptr(win, 'pointerup', 300 + 30 * perUnit)
    vi.advanceTimersByTime(10)
    expect(zooms).toHaveLength(1)
    // Past the end, the window stops at the full range.
    ptr(win, 'pointerdown', 300)
    ptr(win, 'pointermove', 300 + 200 * perUnit)
    ptr(win, 'pointerup', 300 + 200 * perUnit)
    await raf()
    const r2 = p.getZoom()!.x!.range as [number, number]
    expect(r2[1]).toBeCloseTo(100, 6)
    expect(r2[1] - r2[0]).toBeCloseTo(20, 6)
    // The end handle, dragged left: a narrower window (zoom in).
    ptr(end, 'pointerdown', 300)
    ptr(end, 'pointermove', 300 - 10 * perUnit)
    ptr(end, 'pointerup', 300 - 10 * perUnit)
    await raf()
    const r3 = p.getZoom()!.x!.range as [number, number]
    expect(r3[0]).toBeCloseTo(80, 6)
    expect(r3[1]).toBeCloseTo(90, 6)
    // A press that does not move reports nothing.
    vi.advanceTimersByTime(10)
    const n = zooms.length
    ptr(win, 'pointerdown', 300)
    ptr(win, 'pointerup', 300)
    vi.advanceTimersByTime(10)
    expect(zooms).toHaveLength(n)
  })

  it('a press on the strip outside the window moves the window there', async () => {
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true })
    p.setZoom({ x: [0, 10] })
    await raf()
    const nav = navOf()
    nav.getBoundingClientRect = () => box(600, NAV_HEIGHT)
    const full = compilePlot({ type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400 - NAV_HEIGHT })
    const a = full.ok ? full.scene.axes! : (null as never)
    const at = (v: number): number => a.plot.x + (v / 100) * a.plot.w
    ptr(nav.querySelector('svg')!, 'pointerdown', at(60))
    ptr(nav, 'pointerup', at(60))
    await raf()
    const r = p.getZoom()!.x!.range as [number, number]
    expect(r[0]).toBeCloseTo(55, 6)
    expect(r[1]).toBeCloseTo(65, 6)
  })

  it('keeps sync groups in step: the navigator zooms the others', async () => {
    const a = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true, sync: 'nav' })
    const other = document.createElement('div')
    document.body.appendChild(other)
    const b = new SuperPlot(other, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, sync: 'nav' })
    a.setZoom({ x: [10, 30] })
    await raf()
    key(sliders()[0], 'PageUp')
    await raf()
    expect(a.getZoom()!.x!.range).toEqual([30, 50])
    expect(b.getZoom()!.x!.range).toEqual([30, 50])
    // And a zoom that came from the other plot moves this navigator's window.
    b.setZoom(null)
    a.setZoom({ x: [5, 15] })
    await raf()
    expect(sliders()[0].getAttribute('aria-valuetext')).toBe('5 to 15')
  })

  it('time axes: values in epoch ms, read as dates; the full range comes from the unzoomed chart', async () => {
    const p = new SuperPlot(host, { type: 'area', x: 'd', y: 'v', data: days, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true })
    p.setZoom({ x: ['2026-01-10', '2026-01-20'] })
    await raf()
    const [win, start, end] = sliders()
    expect(num(start, 'aria-valuenow')).toBe(Date.UTC(2026, 0, 10))
    expect(num(start, 'aria-valuemin')).toBe(Date.UTC(2026, 0, 1))
    expect(num(end, 'aria-valuemax')).toBe(Date.UTC(2026, 2, 1))
    expect(win.getAttribute('aria-valuetext')).toBe('Jan 10, 2026 to Jan 20, 2026')
    // An area: the fill and the line of the first series.
    expect(navOf().querySelectorAll('svg g path')).toHaveLength(2)
  })

  it('a scatter gets a density strip; canvas charts get the same strip', () => {
    HTMLCanvasElement.prototype.getContext = (() => stub2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const r = compilePlot({ type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 360 })
    const o = overviewOf(r.ok ? r.scene : (null as never))
    expect(o.lines).toEqual([])
    expect(o.density!.reduce((q, n) => q + n, 0)).toBe(101)
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true, renderer: 'canvas' })
    expect(p.getRenderer()).toBe('canvas')
    expect(navOf().querySelectorAll('svg rect').length).toBeGreaterThan(10)
  })

  it('a chart that cannot zoom keeps its height and says why', () => {
    const issues: Issue[][] = []
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts }, { width: 600, height: 400, animate: false, navigator: true, onIssues: i => issues.push(i) })
    expect(host.querySelector('.sp-nav')).toBeNull()
    expect(p.getScene()!.height).toBe(400)
    expect(issues.at(-1)!.map(i => i.code)).toContain('navigator_unsupported')
    p.setSpec({ type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' })
    expect(host.querySelector('.sp-nav')).not.toBeNull()
    p.setOptions({ navigator: false })
    expect(host.querySelector('.sp-nav')).toBeNull()
    expect(p.getScene()!.height).toBe(400)
  })

  it('thins long straight paths and leaves curves alone', () => {
    const long = Array.from({ length: 20000 }, (_, i) => `${i ? 'L' : 'M'}${(i / 40).toFixed(3)} ${i === 777 ? 0 : 50 + (i % 3)}`).join('')
    const thin = thinPath(long, 400)
    const n = thin.split(/[ML]/).filter(Boolean).length
    expect(n).toBeLessThanOrEqual(420)
    expect(thin).toContain(' 0L') // the spike survives
    expect(thinPath('M0 0C1 1 2 2 3 3')).toBe('M0 0C1 1 2 2 3 3')
  })

  it('the element and its attribute; print hides the handles', () => {
    defineSuperPlot()
    const el = document.createElement('super-plot') as HTMLElement & { spec: unknown }
    el.setAttribute('navigator', '')
    document.body.appendChild(el)
    el.getBoundingClientRect = () => box(600, 400)
    el.spec = { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }
    expect(el.querySelector('.sp-nav')).not.toBeNull()
    el.setAttribute('navigator', 'false')
    expect(el.querySelector('.sp-nav')).toBeNull()
    expect(CSS).toMatch(/@media print\{[^}]*\.sp-nav-h\{display:none!important\}|@media print\{\.sp-bar,\.sp-ctl,\.sp-tip,\.sp-nav-h\{display:none!important\}/)
    expect(CSS).toContain('.sp-nav-win:focus-visible')
  })
})
