// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot } from '@supersolutions/super-plot-web'
import { chartCatalog, type Camera } from '@supersolutions/super-plot-core'

const ex = (t: string): Record<string, unknown> => structuredClone(chartCatalog().find(c => c.type === t)!.example) as Record<string, unknown>
const stub = (): CanvasRenderingContext2D => {
  const ctx: Record<string, unknown> = { globalAlpha: 1 }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform', 'clip', 'rect']) ctx[k] = () => {}
  ctx.measureText = (t: string) => ({ width: t.length * 6 })
  ctx.isPointInPath = () => false
  return ctx as unknown as CanvasRenderingContext2D
}
let host: HTMLDivElement
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => stub()) as unknown as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 640, height: 420, top: 0, left: 0, right: 640, bottom: 420, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})
const key = (el: Element, k: string, shift = false): void => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true })) }

describe('maps in the browser binding', () => {
  it('a flat choropleth stays SVG; the root is focusable and has zoom buttons', () => {
    const p = new SuperPlot(host, ex('choropleth'), { width: 640, height: 420 })
    expect(p.getRenderer()).toBe('svg')
    const root = host.querySelector<HTMLElement>('.sp-root')!
    expect(root.hasAttribute('data-map')).toBe(true)
    expect(root.tabIndex).toBe(0)
    expect([...host.querySelectorAll('.sp-ctl button')].map(b => b.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'Reset view'])
    p.dispose()
  })

  it('interactive: false removes the controls; a non-map chart never has them', () => {
    const p = new SuperPlot(host, ex('choropleth'), { width: 640, height: 420, interactive: false })
    expect(host.querySelector('.sp-ctl')).toBeNull()
    p.setSpec(ex('bar'))
    expect(host.querySelector('.sp-ctl')).toBeNull()
    expect(p.getCamera()).toBeNull()
    p.dispose()
  })

  it('keyboard and buttons move the camera; one camera event per gesture; reset goes back', () => {
    vi.useFakeTimers()
    const seen: Camera[] = []
    const p = new SuperPlot(host, ex('choropleth'), { width: 640, height: 420, onCameraChange: c => seen.push(c) })
    const start = p.getCamera()!
    const root = host.querySelector<HTMLElement>('.sp-root')!
    key(root, 'ArrowLeft')
    key(root, 'ArrowLeft')
    key(root, '+')
    vi.advanceTimersByTime(300)
    expect(seen).toHaveLength(1)
    expect(seen[0].lng).toBeLessThan(start.lng)
    expect(seen[0].zoom).toBeCloseTo(1.25, 6)
    key(root, 'ArrowUp', true)
    vi.advanceTimersByTime(300)
    expect(p.getCamera()!.pitch).toBe(5)
    host.querySelector<HTMLButtonElement>('.sp-ctl [aria-label="Zoom in"]')!.click()
    vi.advanceTimersByTime(300)
    expect(p.getCamera()!.zoom).toBeCloseTo(1.875, 6)
    // The scene follows the camera (exports draw what is on screen).
    expect(p.getScene()!.geo!.view.camera.zoom).toBeCloseTo(1.875, 6)
    p.resetCamera()
    expect(p.getCamera()).toEqual(start)
    p.dispose()
  })

  it('setCamera and resetCamera do not fire onCameraChange (only the viewer does); the reset button does', () => {
    const seen: Camera[] = []
    const p = new SuperPlot(host, ex('choropleth'), { width: 640, height: 420, onCameraChange: c => seen.push(c) })
    p.setCamera({ zoom: 2 })
    p.resetCamera()
    expect(seen).toHaveLength(0)
    host.querySelector<HTMLButtonElement>('.sp-ctl [aria-label="Reset view"]')!.click()
    expect(seen).toHaveLength(1)
    p.dispose()
  })

  it('new data on the same map keeps the view; a different map starts fresh; a re-sent equal camera option keeps it too', () => {
    const p = new SuperPlot(host, ex('choropleth'), { width: 640, height: 420, camera: { pitch: 20 } })
    p.setCamera({ zoom: 3 })
    p.setSpec({ ...ex('choropleth'), title: 'Other data' })
    expect(p.getCamera()!.zoom).toBe(3)
    p.setOptions({ camera: { pitch: 20 } })
    expect(p.getCamera()!.zoom).toBe(3)
    p.setSpec(ex('column-map'))
    expect(p.getCamera()!.zoom).toBe(1)
    p.dispose()
  })

  it('the map root is a labelled group; methods after dispose do nothing', () => {
    const p = new SuperPlot(host, ex('choropleth'), { width: 640, height: 420 })
    const root = host.querySelector<HTMLElement>('.sp-root')!
    expect(root.getAttribute('role')).toBe('group')
    expect(root.getAttribute('aria-label')).toMatch(/arrow keys/)
    p.dispose()
    p.setSpec(ex('column-map'))
    p.setOptions({ renderer: 'canvas' })
    expect(host.querySelector('.sp-root')).toBeNull()
  })

  it('setCamera merges and clamps; the camera option sets the start', () => {
    const p = new SuperPlot(host, ex('column-map'), { width: 640, height: 420, camera: { lng: 100, lat: 10 } })
    expect(p.getCamera()).toMatchObject({ lng: 100, lat: 10 })
    p.setCamera({ zoom: 999 })
    expect(p.getCamera()).toMatchObject({ lng: 100, lat: 10, zoom: 40 })
    p.dispose()
  })

  it('renderer webgl without WebGL falls back to canvas, not SVG', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = new SuperPlot(host, ex('column-map'), { width: 640, height: 420, renderer: 'webgl' })
    expect(p.getRenderer()).toBe('canvas')
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(p.getRenderer()).toBe('canvas')
    expect(String(warn.mock.calls[0][0])).toMatch(/WebGL is not available/)
    warn.mockRestore()
    p.dispose()
  })

  it('arrow keys on a non-map chart do nothing special', () => {
    const p = new SuperPlot(host, ex('bar'), { width: 640, height: 420 })
    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    host.querySelector('.sp-root')!.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    p.dispose()
  })
})
