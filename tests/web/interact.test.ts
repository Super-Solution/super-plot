// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot, type BrushSelection, type ZoomRange } from '@supersolutions/super-plot-web'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { plotTable, type AxisInfo } from '@supersolutions/super-plot-core'
import { bandsBetween, brushFromPixels, invert, panDomain, pixelOf, readRange, zoomDomain } from '../../packages/bindings/web/src/interact'
import { parseRgb, rasterDots } from '../../packages/bindings/web/src/stamp'

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => { document.body.innerHTML = '' })

const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: i * 2 }))
const days = Array.from({ length: 30 }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), v: i }))
/** The root, given a layout: 600 x 400 at the page origin (jsdom has none). */
const rootOf = (): HTMLElement => {
  const r = host.querySelector<HTMLElement>('.sp-root')!
  r.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
  return r
}
const ptr = (el: Element, type: string, x: number, y: number, extra: MouseEventInit = {}): void => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...extra }))
}
const raf = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()))

describe('axis helpers', () => {
  const lin: AxisInfo = { kind: 'linear', domain: [0, 100], range: [50, 550], field: 'x' }
  const band: AxisInfo = { kind: 'band', domain: ['A', 'B', 'C', 'D'], range: [0, 400], field: 'k' }
  it('maps pixels to data and back', () => {
    expect(invert(lin, 300)).toBe(50)
    expect(pixelOf(lin, 25)).toBe(175)
    expect(pixelOf(band, 'B')).toBe(150)
    expect(bandsBetween(band, 120, 260)).toEqual(['B', 'C'])
    expect(bandsBetween(band, 210, 220)).toEqual(['C'])
    expect(bandsBetween(band, 99, 101)).toEqual(['A', 'B'])
  })
  it('zooms around a point and pans by pixels', () => {
    expect(zoomDomain([0, 100], 50, 2)).toEqual([25, 75])
    expect(panDomain(lin, [0, 100], 50)).toEqual([-10, 90])
  })
  it('reads ISO dates and refuses empty ranges', () => {
    expect(readRange(['2026-01-01', '2026-01-02'])).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)])
    expect(readRange([3, 3])).toBeNull()
    expect(readRange(['x', 1])).toBeNull()
  })
  it('a brush on categories picks whole bands', () => {
    const axes = { plot: { x: 0, y: 0, w: 400, h: 300 }, x: band, y: { kind: 'linear' as const, domain: [0, 10] as [number, number], range: [300, 0] as [number, number] } }
    expect(brushFromPixels(axes, 'x', 10, 20, 0, 300)).toEqual({ x: ['A'] })
    expect(brushFromPixels(axes, 'x', 40, 160, 0, 300)).toEqual({ x: ['A', 'B'] })
    expect(brushFromPixels(axes, 'x', 500, 600, 0, 300)).toBeNull()
  })
})

describe('fast dots', () => {
  it('stamps covered pixels with an anti-aliased edge, overlaps keep the larger coverage', () => {
    const img = rasterDots({ cx: Float64Array.of(10, 11), cy: Float64Array.of(10, 10), r: Float64Array.of(3, 3) }, 1, [255, 0, 0], 100, 100)!
    expect(img.w).toBeGreaterThan(6)
    const at = (x: number, y: number): number => img.data[((y - img.y) * img.w + (x - img.x)) * 4 + 3]
    expect(at(10, 10)).toBe(255)
    expect(at(8, 12)).toBeGreaterThan(0)
    expect(at(8, 12)).toBeLessThan(255)
    expect(at(img.x, img.y)).toBe(0)
    expect(img.data[((10 - img.y) * img.w + (10 - img.x)) * 4]).toBe(255)
  })
  it('gives up on huge areas and reads canvas colour strings', () => {
    expect(rasterDots({ cx: Float64Array.of(0, 5000), cy: Float64Array.of(0, 5000), r: Float64Array.of(1, 1) }, 1, [0, 0, 0], 6000, 6000)).toBeNull()
    expect(rasterDots({ cx: Float64Array.of(-50), cy: Float64Array.of(-50), r: Float64Array.of(2) }, 1, [0, 0, 0], 10, 10)!.w).toBe(0)
    expect(parseRgb('#2962ff')).toEqual({ rgb: [41, 98, 255], alpha: 1 })
    expect(parseRgb('rgba(1, 2, 3, 0.5)')).toEqual({ rgb: [1, 2, 3], alpha: 0.5 })
    expect(parseRgb('salmon')).toBeNull()
  })
})

describe('zoom', () => {
  it('setZoom narrows the axis; getZoom reports it; reset goes back', async () => {
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false })
    p.setZoom({ x: [20, 40] })
    await raf()
    expect(p.getScene()!.axes!.x.domain).toEqual([20, 40])
    expect(p.getZoom()).toEqual({ x: { field: 'x', range: [20, 40] } })
    p.resetZoom()
    await raf()
    expect(p.getZoom()).toBeNull()
    expect((p.getScene()!.axes!.x.domain as number[])[1]).toBeGreaterThanOrEqual(100)
  })
  it('Ctrl-wheel zooms around the pointer and reports once; zooming out fully resets', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const zooms: (ZoomRange | null)[] = []
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false, onZoom: z => zooms.push(z) })
    const root = rootOf()
    const a = p.getScene()!.axes!
    const cx = a.plot.x + a.plot.w / 2, cy = a.plot.y + a.plot.h / 2
    for (let i = 0; i < 3; i++) root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: cx, clientY: cy }))
    vi.advanceTimersByTime(300)
    expect(zooms).toHaveLength(1)
    const r = zooms[0]!.x!.range as [number, number]
    expect(r[1] - r[0]).toBeLessThan(60)
    root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 2000, clientX: cx, clientY: cy }))
    vi.advanceTimersByTime(300)
    expect(zooms[1]).toBeNull()
    // Plain wheel scrolls the page.
    const plain = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: cx, clientY: cy })
    root.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
    vi.useRealTimers()
  })
  it('keyboard: + zooms, Shift+Arrow pans, 0 resets; time axes report ISO dates', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const zooms: (ZoomRange | null)[] = []
    const p = new SuperPlot(host, { type: 'line', x: 'd', y: 'v', data: days, zoom: 'x' }, { width: 600, height: 400, animate: false, onZoom: z => zooms.push(z) })
    const root = rootOf()
    expect(root.tabIndex).toBe(0)
    expect(root.getAttribute('aria-keyshortcuts')).toContain('Shift+ArrowLeft')
    const key = (k: string, shiftKey = false): void => { root.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })) }
    key('+')
    vi.advanceTimersByTime(300)
    const z = zooms.at(-1)!.x!
    expect(typeof z.range[0]).toBe('string')
    expect(z.range[0]).toMatch(/^2026-01/)
    key('ArrowRight', true)
    vi.advanceTimersByTime(300)
    expect(Date.parse(zooms.at(-1)!.x!.range[0] as string)).toBeGreaterThan(Date.parse(z.range[0] as string))
    key('0')
    vi.advanceTimersByTime(300)
    expect(zooms.at(-1)).toBeNull()
    expect(p.getZoom()).toBeNull()
    vi.useRealTimers()
  })
  it('drag pans when only zoom is on', async () => {
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false })
    p.setZoom({ x: [20, 40] })
    await raf()
    const root = rootOf()
    const a = p.getScene()!.axes!
    const y = a.plot.y + 20
    ptr(root, 'pointerdown', a.plot.x + 100, y)
    ptr(root, 'pointermove', a.plot.x + 200, y)
    ptr(root, 'pointerup', a.plot.x + 200, y)
    await raf()
    const r = p.getZoom()!.x!.range as [number, number]
    expect(r[0]).toBeLessThan(20)
    expect(r[1] - r[0]).toBeCloseTo(20, 5)
  })
  it('keeps the zoom when only the data changes, drops it for another chart', async () => {
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts, zoom: 'x' }, { width: 600, height: 400, animate: false })
    p.setZoom({ x: [20, 40] })
    p.setSpec({ type: 'line', x: 'x', y: 'y', data: pts.slice(0, 80), zoom: 'x' })
    expect(p.getZoom()).not.toBeNull()
    p.setSpec({ type: 'scatter', x: 'x', y: 'y', data: pts, zoom: 'x' })
    expect(p.getZoom()).toBeNull()
  })
})

describe('brush', () => {
  it('drag selects a range; the event carries filters for a linked chart; a click clears it', async () => {
    const got: (BrushSelection | null)[] = []
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data: pts, brush: 'x' }, { width: 600, height: 400, animate: false, onBrush: b => got.push(b) })
    const root = rootOf()
    const a = p.getScene()!.axes!
    const at = (v: number): number => a.plot.x + ((v - (a.x.domain[0] as number)) / ((a.x.domain[1] as number) - (a.x.domain[0] as number))) * a.plot.w
    ptr(root, 'pointerdown', at(10), a.plot.y + 10)
    ptr(root, 'pointermove', at(30), a.plot.y + 40)
    ptr(root, 'pointerup', at(30), a.plot.y + 40)
    expect(got).toHaveLength(1)
    const r = (got[0]!.x as { range: [number, number] }).range
    expect(r[0]).toBeCloseTo(10, 5)
    expect(r[1]).toBeCloseTo(30, 5)
    expect(got[0]!.filters).toEqual([{ field: 'x', range: r }])
    const overlay = host.querySelector<HTMLElement>('.sp-brush')!
    expect(overlay).not.toBeNull()
    expect(parseFloat(overlay.style.top)).toBeCloseTo((a.plot.y / 400) * 100, 3)
    // The filters drop straight into another chart.
    const linked = new SuperPlot(document.body.appendChild(document.createElement('div')), { type: 'bar', x: 'x', y: 'y', data: pts, transform: got[0]!.filters.map(filter => ({ filter })) }, { width: 400, height: 300 })
    expect(linked.getScene()!.marks.filter(m => m.role === 'data').length).toBe(20)
    // The brush survives a redraw, then a plain click clears it.
    p.setOptions({ width: 500 })
    expect(host.querySelector('.sp-brush')).not.toBeNull()
    await new Promise(r => setTimeout(r, 0))
    ptr(root, 'click', at(50), a.plot.y + 10)
    expect(got.at(-1)).toBeNull()
    expect(host.querySelector('.sp-brush')).toBeNull()
  })
  it('bars brush whole categories; the keyboard brushes with [ and ] from the focused mark', () => {
    const got: (BrushSelection | null)[] = []
    const data = ['A', 'B', 'C', 'D'].map((k, i) => ({ k, v: i + 1 }))
    const p = new SuperPlot(host, { type: 'bar', x: 'k', y: 'v', data, brush: 'x' }, { width: 600, height: 400, animate: false, onBrush: b => got.push(b) })
    rootOf()
    const bars = [...host.querySelectorAll<SVGElement>('.sp-data[tabindex]')]
    expect(bars).toHaveLength(4)
    bars[1].focus()
    bars[1].dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
    bars[2].focus()
    bars[2].dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))
    expect(got.at(-1)).toEqual({ x: { field: 'k', oneOf: ['B', 'C'] }, filters: [{ field: 'k', oneOf: ['B', 'C'] }] })
    expect(p.getBrush()).toEqual(got.at(-1))
    bars[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(got.at(-1)).toBeNull()
    p.setBrush({ x: ['D'] })
    expect(p.getBrush()!.filters).toEqual([{ field: 'k', oneOf: ['D'] }])
  })
})

describe('events, live data, plugins, data table', () => {
  it('onHover follows the pointer once per mark; onRender reports each draw', () => {
    const hovers: unknown[] = []
    const renders: string[] = []
    new SuperPlot(host, { type: 'bar', x: 'k', y: 'v', data: [{ k: 'A', v: 1 }, { k: 'B', v: 2 }] }, { width: 600, height: 400, onHover: e => hovers.push(e?.datum ?? null), onRender: e => renders.push(e.renderer) })
    const bar = host.querySelector('.sp-data[data-i]')!
    ptr(bar, 'pointerover', 1, 1)
    ptr(bar, 'pointerover', 2, 2)
    host.querySelector('.sp-root')!.dispatchEvent(new MouseEvent('pointerleave'))
    expect(hovers).toHaveLength(2)
    expect(hovers[0]).toMatchObject({ x: 'A', value: 1 })
    expect(hovers[1]).toBeNull()
    expect(renders).toEqual(['svg'])
  })
  it('appendRows adds rows in one frame, drops the oldest past max, never touches the caller data', async () => {
    const data = [{ x: 0, y: 0 }]
    const renders: number[] = []
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data }, { width: 600, height: 400, onRender: e => renders.push(e.scene.marks.filter(m => m.role === 'data').length) })
    p.appendRows([{ x: 1, y: 1 }, { x: 2, y: 2 }])
    p.appendRows([{ x: 3, y: 3 }], { max: 3 })
    await raf()
    expect(renders).toEqual([1, 3])
    expect(data).toHaveLength(1)
  })
  it('afterDraw gets the drawn svg; a throwing plugin is a warning', () => {
    let seen: SVGSVGElement | undefined
    const issues: string[] = []
    new SuperPlot(host, { type: 'bar', x: 'k', y: 'v', data: [{ k: 'A', v: 1 }] }, {
      width: 600, height: 400,
      plugins: [{ name: 'see', afterDraw: t => { seen = t.svg } }, { name: 'bad', afterDraw: () => { throw new Error('x') } }],
      onIssues: i => issues.push(...i.map(x => x.code))
    })
    expect(seen?.tagName).toBe('svg')
    expect(issues).toContain('plugin_error')
  })
  it('dataTable lists the columns the chart reads, hidden or visible', () => {
    const spec = { type: 'bar', x: 'k', y: 'v', title: 'T', data: [{ k: 'A', v: 1234.5, extra: 1 }, { k: 'B', v: 2, extra: 2 }] }
    const p = new SuperPlot(host, spec, { width: 600, height: 400, dataTable: true })
    const t = host.querySelector('table.sp-table')!
    expect(t.hasAttribute('data-visible')).toBe(false)
    expect([...t.querySelectorAll('th')].map(th => th.textContent)).toEqual(['k', 'v'])
    expect(t.querySelector('td[data-n]')!.textContent).toBe('1,234.5')
    p.setOptions({ dataTable: 'visible' })
    expect(host.querySelector('table')!.hasAttribute('data-visible')).toBe(true)
    p.setOptions({ dataTable: false })
    expect(host.querySelector('table')).toBeNull()
    expect(plotTable({ ...spec, data: Array.from({ length: 1500 }, (_, i) => ({ k: `k${i}`, v: i })) })).toMatchObject({ total: 1500 })
  })
  it('the element re-dispatches the new events', () => {
    defineSuperPlot('sp-ev')
    const el = document.createElement('sp-ev') as HTMLElement & { spec: unknown; appendRows(r: unknown[]): void; getZoom(): unknown }
    const seen: string[] = []
    for (const t of ['plot-render', 'plot-hover']) el.addEventListener(t, () => seen.push(t))
    el.spec = { type: 'bar', x: 'k', y: 'v', data: [{ k: 'A', v: 1 }] }
    document.body.appendChild(el)
    ptr(el.querySelector('.sp-data[data-i]')!, 'pointerover', 1, 1)
    expect(seen).toEqual(['plot-render', 'plot-hover'])
    expect(el.getZoom()).toBeNull()
  })
})
