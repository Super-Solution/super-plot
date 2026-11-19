// @vitest-environment jsdom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot } from '@supersolutions/super-plot-web'
import { chartCatalog, DEFAULT_CAMERA3D, type Camera, type Camera3d } from '@supersolutions/super-plot-core'

const ex = (t: string): Record<string, unknown> => structuredClone(chartCatalog().find(c => c.type === t)!.example) as Record<string, unknown>
const small = { type: 'scatter3d', x: 'x', y: 'y', z: 'z', series: 'g', data: [{ x: 3, y: 1, z: 2, g: 'a' }, { x: 1, y: 5, z: 4, g: 'b' }, { x: 2, y: 2, z: 9, g: 'a' }, { x: 1, y: 2, z: 1, g: 'b' }] }
const stub = (): CanvasRenderingContext2D => {
  const ctx: Record<string, unknown> = { globalAlpha: 1 }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform', 'clip', 'rect', 'strokeRect']) ctx[k] = () => {}
  ctx.measureText = (t: string) => ({ width: t.length * 6 })
  ctx.isPointInPath = () => false
  return ctx as unknown as CanvasRenderingContext2D
}
let host: HTMLDivElement
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => stub()) as unknown as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})
// The controls are a chunk loaded on first use: load it once for the tests below.
beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = (() => stub()) as unknown as typeof HTMLCanvasElement.prototype.getContext
  const p = new SuperPlot(document.createElement('div'), ex('scatter3d'), { width: 640, height: 480 })
  await p.ready()
  p.dispose()
})
const key = (el: Element, k: string, shift = false): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })
  el.dispatchEvent(e)
  return e
}
const ptr = (el: Element, type: string, x: number, y: number): void => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })) }

describe('3D charts in the browser binding', () => {
  it('the root is a labelled, focusable group with the camera buttons', () => {
    const p = new SuperPlot(host, ex('scatter3d'), { width: 640, height: 480 })
    const root = host.querySelector<HTMLElement>('.sp-root')!
    expect(p.getRenderer()).toBe('svg')
    expect(root.hasAttribute('data-map')).toBe(true)
    expect(root.tabIndex).toBe(0)
    expect(root.getAttribute('role')).toBe('group')
    expect(root.getAttribute('aria-roledescription')).toBe('interactive 3D chart')
    expect(root.getAttribute('aria-label')).toMatch(/Tab to step/)
    expect(root.getAttribute('aria-keyshortcuts')).toContain('Tab')
    expect(host.querySelectorAll('.sp-ctl button')).toHaveLength(3)
    p.dispose()
  })

  it('arrow keys turn and tilt, + zooms, one camera event per gesture, 0 resets', () => {
    vi.useFakeTimers()
    const seen: (Camera | Camera3d)[] = []
    const p = new SuperPlot(host, ex('surface'), { width: 640, height: 480, onCameraChange: c => seen.push(c) })
    const root = host.querySelector<HTMLElement>('.sp-root')!
    expect(p.getCamera<Camera3d>()).toEqual(DEFAULT_CAMERA3D)
    key(root, 'ArrowRight')
    key(root, 'ArrowUp')
    key(root, '+')
    vi.advanceTimersByTime(300)
    expect(seen).toEqual([{ zoom: 1.25, pitch: DEFAULT_CAMERA3D.pitch + 10, bearing: DEFAULT_CAMERA3D.bearing + 15 }])
    // The scene follows (tooltips, exports and the description match the view).
    expect(p.getScene()!.view3d!.view.camera).toEqual(seen[0])
    key(root, '0')
    expect(p.getCamera()).toEqual(DEFAULT_CAMERA3D)
    expect(seen).toHaveLength(2)
    p.dispose()
  })

  it('a drag turns the box; setCamera merges and clamps without an event', () => {
    vi.useFakeTimers()
    const seen: unknown[] = []
    const p = new SuperPlot(host, small, { width: 640, height: 480, onCameraChange: c => seen.push(c) })
    const root = host.querySelector<HTMLElement>('.sp-root')!
    ptr(root, 'pointerdown', 300, 200)
    ptr(root, 'pointermove', 320, 200)
    ptr(root, 'pointermove', 350, 190)
    ptr(root, 'pointerup', 350, 190)
    const c = p.getCamera<Camera3d>()!
    expect(c.bearing).toBeGreaterThan(DEFAULT_CAMERA3D.bearing)
    expect(c.pitch).toBeGreaterThan(DEFAULT_CAMERA3D.pitch)
    expect(seen).toHaveLength(1)
    p.setCamera({ pitch: 200, zoom: 2 })
    expect(p.getCamera()).toEqual({ zoom: 2, pitch: 90, bearing: c.bearing })
    expect(seen).toHaveLength(1)
    p.resetCamera()
    expect(p.getCamera()).toEqual(DEFAULT_CAMERA3D)
    p.dispose()
  })

  it('SVG: Tab steps through the points in x order with their tooltip, Shift+Tab back, then the legend', () => {
    const p = new SuperPlot(host, small, { width: 640, height: 480 })
    const root = host.querySelector<HTMLElement>('.sp-root')!
    const order = p.getScene()!.view3d!.order
    const at = (): unknown => p.getScene()!.marks[Number(document.activeElement?.getAttribute('data-i'))]?.datum
    root.focus()
    expect(key(root, 'Tab').defaultPrevented).toBe(true)
    expect(at()).toEqual({ x: 1, y: 2, z: 1, series: 'b' })
    expect(host.querySelector('.sp-tip')!.hasAttribute('data-show')).toBe(true)
    key(document.activeElement!, 'Tab')
    expect(at()).toEqual({ x: 1, y: 5, z: 4, series: 'b' })
    key(document.activeElement!, 'Tab', true)
    expect(at()).toEqual({ x: 1, y: 2, z: 1, series: 'b' })
    key(document.activeElement!, 'Tab', true)
    expect(document.activeElement).toBe(root)
    // Arrows turn the box from a focused point too, and Tab goes on from where it was.
    key(root, 'Tab'); key(document.activeElement!, 'Tab')
    key(document.activeElement!, 'ArrowLeft')
    expect(document.activeElement).toBe(root)
    key(root, 'Tab')
    expect(at()).toEqual({ x: 2, y: 2, z: 9, series: 'a' })
    key(document.activeElement!, 'Tab')
    expect(at()).toEqual({ x: 3, y: 1, z: 2, series: 'a' })
    expect(order).toHaveLength(4)
    // Past the last point: the legend (drawn before the data in SVG), not the next point in drawing order.
    expect(key(document.activeElement!, 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement!.getAttribute('data-lk')).toBe('a')
    p.dispose()
  })

  it('canvas: Tab outlines the point, shows its tooltip and reads it out; focus stays on the chart', () => {
    const hovered: unknown[] = []
    const p = new SuperPlot(host, small, { width: 640, height: 480, renderer: 'canvas', onHover: e => hovered.push(e?.datum ?? null) })
    expect(p.getRenderer()).toBe('canvas')
    const root = host.querySelector<HTMLElement>('.sp-root')!
    const base = host.querySelector<HTMLCanvasElement>('canvas')!
    // The camera keyboard lives on the root; the canvas is not a second tab stop.
    expect(base.tabIndex).toBe(-1)
    root.focus()
    key(root, 'Tab')
    expect(document.activeElement).toBe(root)
    expect(hovered.at(-1)).toEqual({ x: 1, y: 2, z: 1, series: 'b' })
    expect(host.querySelector('.sp-tip')!.hasAttribute('data-show')).toBe(true)
    expect(host.querySelector('.sp-live')!.textContent).toMatch(/^x 1, y 2, z 1/)
    key(root, 'Tab'); key(root, 'Tab'); key(root, 'Tab')
    expect(hovered.at(-1)).toEqual({ x: 3, y: 1, z: 2, series: 'a' })
    // Past the end the browser moves focus on (to the legend buttons, then out).
    expect(key(root, 'Tab').defaultPrevented).toBe(false)
    expect(hovered.at(-1)).toBeNull()
    p.dispose()
  })

  it('a map camera option does not leak into a 3D chart; a different chart type starts from its own view', () => {
    const p = new SuperPlot(host, ex('scatter3d'), { width: 640, height: 480, camera: { lng: 10, lat: 5, pitch: 20 } as Partial<Camera> })
    expect(p.getCamera()).toEqual({ ...DEFAULT_CAMERA3D, pitch: 20 })
    p.setCamera({ zoom: 3 })
    p.setSpec({ ...ex('scatter3d'), title: 'New data' })
    expect(p.getCamera<Camera3d>()!.zoom).toBe(3)
    p.setSpec(ex('surface'))
    expect(p.getCamera<Camera3d>()!.zoom).toBe(1)
    p.setSpec(ex('bar'))
    expect(p.getCamera()).toBeNull()
    expect(host.querySelector('.sp-ctl')).toBeNull()
    p.dispose()
  })

  it('interactive: false leaves the box still, and Tab still steps through the data', async () => {
    const p = new SuperPlot(host, small, { width: 640, height: 480, interactive: false })
    await p.ready()
    const root = host.querySelector<HTMLElement>('.sp-root')!
    expect(root.hasAttribute('data-map')).toBe(false)
    expect(host.querySelector('.sp-ctl')).toBeNull()
    expect(root.tabIndex).toBe(0)
    expect(root.getAttribute('aria-label')).toMatch(/Tab to step/)
    expect(key(root, 'ArrowLeft').defaultPrevented).toBe(false)
    expect(p.getCamera()).toEqual(DEFAULT_CAMERA3D)
    root.focus()
    key(root, 'Tab')
    expect(p.getScene()!.marks[Number(document.activeElement?.getAttribute('data-i'))].datum).toEqual({ x: 1, y: 2, z: 1, series: 'b' })
    p.setSpec(ex('bar'))
    expect(root.hasAttribute('tabindex')).toBe(false)
    expect(root.hasAttribute('aria-label')).toBe(false)
    p.dispose()
  })
})
