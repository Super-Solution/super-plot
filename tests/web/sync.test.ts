// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SuperPlot, type BrushSelection, type ZoomRange } from '@supersolutions/super-plot-web'
import { groupOf, syncConf, syncTarget, xValueOf } from '../../packages/bindings/web/src/sync'
import { loadCanvasChunk } from './stub2d'

// The canvas renderer is loaded on demand: load it once, so canvas plots below draw at once.
beforeAll(loadCanvasChunk)

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const box = (w = 600, h = 400): DOMRect => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect
const mountHost = (): HTMLDivElement => {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => box()
  document.body.appendChild(el)
  return el
}
const layout = (host: HTMLElement): HTMLElement => {
  const r = host.querySelector<HTMLElement>('.sp-root')!
  r.getBoundingClientRect = () => box()
  return r
}
const raf = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()))
const over = (el: Element): void => { el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 5, clientY: 5 })) }
const tipOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.sp-tip')!

const days = (n: number, f: (i: number) => number): { d: string; v: number }[] => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), v: f(i) }))
const daily = { type: 'line', title: 'Daily', x: 'd', y: 'v', data: days(30, i => i) }
const other = { type: 'area', title: 'Other', x: 'd', y: 'v', data: days(30, i => 30 - i) }
const bars = { type: 'bar', x: 'k', y: 'v', data: [{ k: 'A', v: 1 }, { k: 'B', v: 2 }, { k: 'C', v: 3 }] }

afterEach(() => { document.body.innerHTML = '' })

describe('sync option', () => {
  it('a string is the key with hover and zoom on, brush off; an object sets each', () => {
    expect(syncConf('g')).toEqual({ key: 'g', hover: true, zoom: true, brush: false })
    expect(syncConf({ key: 'g', brush: true, zoom: false })).toEqual({ key: 'g', hover: true, zoom: false, brush: true })
    expect(syncConf('')).toBeNull()
    expect(syncConf({ hover: true })).toBeNull()
    expect(syncConf(undefined)).toBeNull()
  })

  it('maps a mark to its x value and back to the nearest mark of another scene', () => {
    const a = new SuperPlot(mountHost(), daily, { width: 600, height: 400 })
    const b = new SuperPlot(mountHost(), { ...daily, data: days(10, i => i * 3) }, { width: 600, height: 400 })
    const sa = a.getScene()!, sb = b.getScene()!
    const col = sa.marks.find(m => m.role === 'hit' && m.guide && (m.datum as { x: number }).x === Date.UTC(2026, 0, 5))!
    const v = xValueOf(sa, col)!
    expect(v).toEqual({ kind: 'time', v: Date.UTC(2026, 0, 5) })
    const i = syncTarget(sb, v)
    expect((sb.marks[i].datum as { x: number }).x).toBe(Date.UTC(2026, 0, 5))
    // Past the end of the other chart's range: nothing to show.
    expect(syncTarget(sb, { kind: 'time', v: Date.UTC(2026, 1, 20) })).toBe(-1)
    // Another kind of axis: skipped.
    expect(syncTarget(sb, { kind: 'band', v: 'A' })).toBe(-1)
    a.dispose(); b.dispose()
  })
})

describe('synchronised hover', () => {
  it('hovering one chart shows the guide and tooltip at the same x in the other, without echoing events', () => {
    const hoversA: unknown[] = [], hoversB: unknown[] = []
    const ha = mountHost(), hb = mountHost()
    const a = new SuperPlot(ha, daily, { width: 600, height: 400, sync: 'g', onHover: e => hoversA.push(e) })
    const b = new SuperPlot(hb, other, { width: 600, height: 400, sync: 'g', onHover: e => hoversB.push(e) })
    const cols = [...ha.querySelectorAll('.sp-hit[data-i]')]
    over(cols[4])
    expect(hoversA).toHaveLength(1)
    expect(hoversB).toHaveLength(0)
    const tip = tipOf(hb)
    expect(tip.hasAttribute('data-show')).toBe(true)
    expect(tip.textContent).toContain('Jan 5')
    // The crosshair and a focus dot are drawn in the other chart.
    expect(hb.querySelector('svg > g line')).not.toBeNull()
    expect(hb.querySelectorAll('svg > g circle').length).toBe(1)
    layout(ha).dispatchEvent(new MouseEvent('pointerleave'))
    expect(tip.hasAttribute('data-show')).toBe(false)
    expect(hb.querySelector('svg > g line')).toBeNull()
    a.dispose(); b.dispose()
  })

  it('quietly skips a chart whose x axis is of another kind, and charts in another group', () => {
    const ha = mountHost(), hb = mountHost(), hc = mountHost()
    const a = new SuperPlot(ha, daily, { width: 600, height: 400, sync: 'g' })
    const b = new SuperPlot(hb, bars, { width: 600, height: 400, sync: 'g' })
    const c = new SuperPlot(hc, other, { width: 600, height: 400, sync: 'h' })
    expect(() => over(ha.querySelectorAll('.sp-hit[data-i]')[3])).not.toThrow()
    expect(tipOf(hb).hasAttribute('data-show')).toBe(false)
    expect(tipOf(hc).hasAttribute('data-show')).toBe(false)
    a.dispose(); b.dispose(); c.dispose()
  })

  it('category charts follow the same category; hover: false opts out', () => {
    const ha = mountHost(), hb = mountHost(), hc = mountHost()
    const a = new SuperPlot(ha, bars, { width: 600, height: 400, sync: 'cats' })
    const b = new SuperPlot(hb, { ...bars, data: [{ k: 'C', v: 9 }, { k: 'B', v: 8 }] }, { width: 600, height: 400, sync: 'cats' })
    const c = new SuperPlot(hc, bars, { width: 600, height: 400, sync: { key: 'cats', hover: false } })
    over(ha.querySelectorAll('.sp-data[data-i]')[1]) // B
    expect(tipOf(hb).textContent).toContain('B')
    expect(tipOf(hb).textContent).toContain('8')
    expect(tipOf(hc).hasAttribute('data-show')).toBe(false)
    over(ha.querySelectorAll('.sp-data[data-i]')[0]) // A: not in the second chart
    expect(tipOf(hb).hasAttribute('data-show')).toBe(false)
    a.dispose(); b.dispose(); c.dispose()
  })

  it('keyboard focus syncs too, and a canvas chart follows', () => {
    const ha = mountHost(), hb = mountHost()
    const a = new SuperPlot(ha, bars, { width: 600, height: 400, sync: 'k' })
    const b = new SuperPlot(hb, bars, { width: 600, height: 400, sync: 'k', renderer: 'canvas' })
    expect(b.getRenderer()).toBe('svg') // jsdom has no 2D context: it stays SVG; the canvas path is checked below
    const third = ha.querySelectorAll<SVGElement>('.sp-data[tabindex]')[2]
    third.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(tipOf(hb).textContent).toContain('C')
    a.dispose(); b.dispose()
  })

  it('a canvas chart in the group shows the synced mark and a canvas source broadcasts its keyboard steps', () => {
    const ctx = (): CanvasRenderingContext2D => {
      const c: Record<string, unknown> = { globalAlpha: 1, isPointInPath: () => false, measureText: (t: string) => ({ width: t.length * 6 }) }
      for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform', 'strokeRect', 'rect', 'clip', 'scale']) c[k] = () => {}
      return c as unknown as CanvasRenderingContext2D
    }
    const prev = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = (() => ctx()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    try {
      const ha = mountHost(), hb = mountHost()
      const a = new SuperPlot(ha, bars, { width: 600, height: 400, sync: 'cv', renderer: 'canvas' })
      const b = new SuperPlot(hb, bars, { width: 600, height: 400, sync: 'cv', renderer: 'canvas' })
      expect(a.getRenderer()).toBe('canvas')
      const ca = ha.querySelector('canvas')!
      ca.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      expect(tipOf(hb).hasAttribute('data-show')).toBe(true)
      expect(tipOf(hb).textContent).toContain('A')
      ca.dispatchEvent(new FocusEvent('blur'))
      expect(tipOf(hb).hasAttribute('data-show')).toBe(false)
      a.dispose(); b.dispose()
    } finally {
      HTMLCanvasElement.prototype.getContext = prev
    }
  })
})

describe('synchronised zoom and brush', () => {
  it('zooming x zooms the others (with zoom on) as it happens; code-driven setZoom does not propagate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const zoomsB: (ZoomRange | null)[] = []
    const ha = mountHost(), hb = mountHost(), hc = mountHost()
    const a = new SuperPlot(ha, { ...daily, zoom: 'x' }, { width: 600, height: 400, animate: false, sync: 'z' })
    const b = new SuperPlot(hb, { ...other, zoom: 'x' }, { width: 600, height: 400, animate: false, sync: 'z', onZoom: z => zoomsB.push(z) })
    const c = new SuperPlot(hc, other, { width: 600, height: 400, animate: false, sync: 'z' })
    const root = layout(ha)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }))
    expect(b.getZoom()!.x!.range).toEqual(a.getZoom()!.x!.range)
    // A chart whose spec does not allow zoom is left alone.
    expect(c.getZoom()).toBeNull()
    vi.advanceTimersByTime(300)
    expect(zoomsB).toHaveLength(0)
    // From code: only that chart.
    b.setZoom({ x: ['2026-01-10', '2026-01-12'] })
    expect(a.getZoom()!.x!.range).not.toEqual(b.getZoom()!.x!.range)
    // Resetting from the keyboard resets the others too.
    root.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true }))
    expect(a.getZoom()).toBeNull()
    expect(b.getZoom()).toBeNull()
    vi.useRealTimers()
    await raf()
    expect(b.getScene()!.axes!.x.domain[0]).toBe(Date.UTC(2026, 0, 1))
    a.dispose(); b.dispose(); c.dispose()
  })

  it('zoom: false keeps a chart out of zoom sync but in hover sync', () => {
    const ha = mountHost(), hb = mountHost()
    const a = new SuperPlot(ha, { ...daily, zoom: 'x' }, { width: 600, height: 400, sync: 'z2' })
    const b = new SuperPlot(hb, { ...other, zoom: 'x' }, { width: 600, height: 400, sync: { key: 'z2', zoom: false } })
    layout(ha).dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }))
    expect(a.getZoom()).not.toBeNull()
    expect(b.getZoom()).toBeNull()
    over(ha.querySelectorAll('.sp-hit[data-i]')[2])
    expect(tipOf(hb).hasAttribute('data-show')).toBe(true)
    a.dispose(); b.dispose()
  })

  it('brush sync mirrors the x range when both opt in; the other chart does not fire onBrush', () => {
    const brushesB: (BrushSelection | null)[] = []
    const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: i * 2 }))
    const ha = mountHost(), hb = mountHost()
    const a = new SuperPlot(ha, { type: 'scatter', x: 'x', y: 'y', data: pts, brush: 'x' }, { width: 600, height: 400, animate: false, sync: { key: 'b', brush: true } })
    const b = new SuperPlot(hb, { type: 'line', x: 'x', y: 'y', data: pts, brush: 'x' }, { width: 600, height: 400, animate: false, sync: { key: 'b', brush: true }, onBrush: s => brushesB.push(s) })
    const root = layout(ha)
    const ax = a.getScene()!.axes!
    const at = (v: number): number => ax.plot.x + ((v - (ax.x.domain[0] as number)) / ((ax.x.domain[1] as number) - (ax.x.domain[0] as number))) * ax.plot.w
    const ptr = (type: string, x: number): void => { root.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: ax.plot.y + 20, button: 0 })) }
    ptr('pointerdown', at(10)); ptr('pointermove', at(30)); ptr('pointerup', at(30))
    const r = (b.getBrush()!.x as { range: [number, number] }).range
    expect(r[0]).toBeCloseTo(10, 5)
    expect(r[1]).toBeCloseTo(30, 5)
    expect(hb.querySelector('.sp-brush')).not.toBeNull()
    expect(brushesB).toHaveLength(0)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(b.getBrush()).toBeNull()
    a.dispose(); b.dispose()
  })

  it('brush is off for a string key', () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: i, y: i }))
    const ha = mountHost(), hb = mountHost()
    const a = new SuperPlot(ha, { type: 'scatter', x: 'x', y: 'y', data: pts, brush: 'x' }, { width: 600, height: 400, sync: 'nb' })
    const b = new SuperPlot(hb, { type: 'scatter', x: 'x', y: 'y', data: pts, brush: 'x' }, { width: 600, height: 400, sync: 'nb' })
    const bars = [...ha.querySelectorAll<SVGElement>('.sp-data[tabindex]')]
    bars[2].dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
    bars[5].dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }))
    expect(a.getBrush()).not.toBeNull()
    expect(b.getBrush()).toBeNull()
    a.dispose(); b.dispose()
  })
})

describe('sync group lifetime', () => {
  it('plots join on create, move with setOptions and leave on dispose; nothing is put on window', () => {
    const a = new SuperPlot(mountHost(), daily, { width: 600, height: 400, sync: 'life' })
    const b = new SuperPlot(mountHost(), daily, { width: 600, height: 400, sync: { key: 'life' } })
    expect(groupOf('life')).toHaveLength(2)
    b.setOptions({ sync: 'elsewhere' })
    expect(groupOf('life')).toHaveLength(1)
    expect(groupOf('elsewhere')).toHaveLength(1)
    b.setOptions({ sync: undefined })
    expect(groupOf('elsewhere')).toHaveLength(0)
    a.dispose()
    a.dispose()
    expect(groupOf('life')).toHaveLength(0)
    expect(Object.keys(window).filter(k => /sync|superplot/i.test(k))).toEqual([])
    b.dispose()
  })
})
