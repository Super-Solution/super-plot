// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot } from '@supersolutions/super-plot-web'
import { chartCatalog } from '@supersolutions/super-plot-core'

// A recording 2D context: jsdom has none. Real pixels are checked in the browser suite (tests/e2e).
const calls: string[] = []
const stub = (): CanvasRenderingContext2D => {
  const ctx: Record<string, unknown> = { globalAlpha: 1 }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform', 'measureText']) {
    ctx[k] = k === 'measureText' ? (t: string) => ({ width: t.length * 6 }) : () => calls.push(k)
  }
  ctx.isPointInPath = () => false
  return ctx as unknown as CanvasRenderingContext2D
}
let host: HTMLDivElement
const dots = (n: number): unknown => ({ type: 'scatter', x: 'x', y: 'y', data: Array.from({ length: n }, (_, i) => ({ x: (i * 37) % 997, y: (i * 91) % 883 })) })
const bar = chartCatalog().find(c => c.type === 'bar')!.example

beforeEach(() => {
  calls.length = 0
  HTMLCanvasElement.prototype.getContext = (() => stub()) as unknown as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('canvas renderer', () => {
  it('auto: a small chart stays SVG, a big one switches to canvas', () => {
    const small = new SuperPlot(host, bar, { width: 600, height: 400 })
    expect(small.getRenderer()).toBe('svg')
    expect(host.querySelector('svg')).not.toBeNull()
    small.dispose()
    const big = new SuperPlot(host, dots(6000), { width: 600, height: 400 })
    expect(big.getRenderer()).toBe('canvas')
    expect(host.querySelector('svg')).toBeNull()
    expect(host.querySelectorAll('canvas')).toHaveLength(2)
    expect(calls).toContain('fillRect')
    big.dispose()
  })
  it('can be forced either way, and the threshold is an option', () => {
    expect(new SuperPlot(host, bar, { width: 600, height: 400, renderer: 'canvas' }).getRenderer()).toBe('canvas')
    host.replaceChildren()
    expect(new SuperPlot(host, dots(6000), { width: 600, height: 400, renderer: 'svg' }).getRenderer()).toBe('svg')
    host.replaceChildren()
    expect(new SuperPlot(host, dots(300), { width: 600, height: 400, canvasAbove: 100 }).getRenderer()).toBe('canvas')
  })
  it('falls back to SVG when the browser gives no 2D context', () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
    const p = new SuperPlot(host, bar, { width: 600, height: 400, renderer: 'canvas' })
    expect(p.getRenderer()).toBe('svg')
    expect(host.querySelector('svg')).not.toBeNull()
  })
  it('keeps the chart readable to assistive tech: label, and real buttons for the legend', () => {
    new SuperPlot(host, bar, { width: 600, height: 400, renderer: 'canvas' })
    const c = host.querySelector('canvas')!
    expect(c.getAttribute('role')).toBe('img')
    expect(c.getAttribute('aria-label')).toMatch(/Revenue by region\. Bar chart/)
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.sp-cv-lk')]
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Q1: toggle series', 'Q2: toggle series', 'Q3: toggle series'])
    expect(buttons.every(b => b.getAttribute('aria-pressed') === 'true')).toBe(true)
  })
  it('toggles a series from a legend button and redraws', () => {
    const onHiddenChange = vi.fn()
    const p = new SuperPlot(host, bar, { width: 600, height: 400, renderer: 'canvas', onHiddenChange })
    host.querySelector<HTMLButtonElement>('.sp-cv-lk')!.click()
    expect(onHiddenChange).toHaveBeenCalledWith(['Q1'])
    expect(p.getHidden()).toEqual(['Q1'])
    expect(host.querySelector('.sp-cv-lk')!.getAttribute('aria-pressed')).toBe('false')
  })
  it('hover shows the tooltip of the mark under the pointer, click reports its data', () => {
    const onSelect = vi.fn()
    const p = new SuperPlot(host, bar, { width: 600, height: 400, renderer: 'canvas', onSelect })
    const scene = p.getScene()!
    const target = scene.marks.find(m => m.type === 'rect' && m.role === 'data' && m.tip)!
    if (target.type !== 'rect') throw new Error('expected a bar')
    const canvas = host.querySelector('canvas')!
    canvas.getBoundingClientRect = host.getBoundingClientRect
    const at = { clientX: target.x + target.w / 2, clientY: target.y + target.h / 2, bubbles: true }
    canvas.dispatchEvent(new MouseEvent('pointermove', at))
    expect(host.querySelector('.sp-tip')!.hasAttribute('data-show')).toBe(true)
    expect(host.querySelector('.sp-tip')!.textContent).toContain(target.tip!.rows[0].value)
    canvas.dispatchEvent(new MouseEvent('click', at))
    expect(onSelect).toHaveBeenCalledOnce()
    canvas.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }))
    expect(host.querySelector('.sp-tip')!.hasAttribute('data-show')).toBe(false)
  })
  it('hits an unfilled path along its stroke, not inside its outline (parallel coordinates)', () => {
    const win = window as unknown as { Path2D?: unknown }
    const had = win.Path2D
    win.Path2D = class { constructor(readonly d?: string) {} }
    let want = ''
    let strokeTests = 0
    // Every fill test says "inside"; only the wanted line's stroke is under the pointer.
    HTMLCanvasElement.prototype.getContext = (() => {
      const ctx = stub() as unknown as Record<string, unknown>
      ctx.isPointInPath = () => true
      ctx.isPointInStroke = (path: { d?: string }) => { strokeTests++; return path.d === want }
      return ctx
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const spec = chartCatalog().find(c => c.type === 'parallel')!.example
    const p = new SuperPlot(host, spec, { width: 600, height: 400, renderer: 'canvas' })
    const target = p.getScene()!.marks.filter(m => m.type === 'path' && m.role === 'data')[3]
    if (target.type !== 'path') throw new Error('expected a line')
    want = target.d
    const canvas = host.querySelector('canvas')!
    canvas.getBoundingClientRect = host.getBoundingClientRect
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, clientY: 200, bubbles: true }))
    expect(strokeTests).toBeGreaterThan(0)
    expect(host.querySelector('.sp-tip')!.textContent).toContain(target.tip!.title)
    expect(host.querySelector('.sp-tip')!.textContent).toContain(target.tip!.rows[0].value)
    p.dispose()
    win.Path2D = had
  })
  it('switching back to SVG removes the canvases; dispose cleans up', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 400, renderer: 'canvas' })
    p.setOptions({ renderer: 'svg' })
    expect(host.querySelector('canvas')).toBeNull()
    expect(p.getRenderer()).toBe('svg')
    p.setOptions({ renderer: 'canvas' })
    p.dispose()
    expect(host.querySelector('canvas')).toBeNull()
  })
  it('the keyboard steps through marks: arrows, Home/End, Enter, read out loud', () => {
    const hovers: unknown[] = []
    const selected: unknown[] = []
    const p = new SuperPlot(host, { type: 'scatter', x: 'x', y: 'y', data: [{ x: 3, y: 1 }, { x: 1, y: 5 }, { x: 2, y: 9 }] }, { width: 600, height: 400, renderer: 'canvas', onHover: e => hovers.push(e?.datum ?? null), onSelect: e => selected.push(e.datum) })
    const c = host.querySelector('canvas')!
    expect(c.tabIndex).toBe(0)
    expect(c.getAttribute('aria-label')).toMatch(/arrow keys/)
    const key = (k: string): void => { c.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) }
    key('ArrowRight')
    expect(hovers.at(-1)).toMatchObject({ x: 1, y: 5 })
    expect(host.querySelector('.sp-live')!.textContent).toMatch(/5/)
    key('ArrowRight')
    expect(hovers.at(-1)).toMatchObject({ x: 2 })
    key('End')
    expect(hovers.at(-1)).toMatchObject({ x: 3 })
    key('ArrowUp')
    expect(hovers.at(-1)).toMatchObject({ x: 2, y: 9 })
    key('Home')
    key('Enter')
    expect(selected).toEqual([expect.objectContaining({ x: 1 })])
    c.dispatchEvent(new FocusEvent('blur'))
    expect(hovers.at(-1)).toBeNull()
    p.dispose()
  })
})
