// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot } from '@supersolutions/super-plot-web'
import { chartCatalog } from '@supersolutions/super-plot-core'

// jsdom has no canvas; the binding falls back to its text estimator.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const ex = (t: string): Record<string, unknown> => structuredClone(chartCatalog().find(c => c.type === t)!.example) as Record<string, unknown>
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 600, height: 0, top: 0, left: 0, right: 600, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  document.body.innerHTML = ''
})
const fire = (el: Element, type: string): void => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }))
}

describe('waterfall, funnel, bullet and bump in the browser binding', () => {
  it('waterfall: tooltip with the running total, legend toggles a kind, click selects the step', () => {
    const onSelect = vi.fn()
    const p = new SuperPlot(host, ex('waterfall'), { width: 600, height: 360, onSelect })
    const dec = host.querySelector('.sp-data[data-s="decrease"]')!
    expect(dec.getAttribute('tabindex')).toBe('0')
    expect(dec.getAttribute('aria-label')).toBe('Cost of sales: decrease of 168, running total 252')
    fire(dec, 'pointerover')
    expect(host.querySelector('.sp-tip')!.textContent).toContain('Running total')
    fire(dec, 'click')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ datum: { x: 'Cost of sales', kind: 'decrease', change: -168, total: 252 } }))
    fire(host.querySelector('[data-lk="decrease"]')!, 'click')
    expect(host.querySelectorAll('.sp-data[data-s="decrease"]').length).toBe(0)
    expect(host.querySelectorAll('.sp-data[data-s="total"]').length).toBe(2)
    p.dispose()
  })

  it('funnel: one series, no legend, and a tooltip with both shares', () => {
    const p = new SuperPlot(host, ex('funnel'), { width: 600, height: 360 })
    expect(host.querySelectorAll('[data-lk]').length).toBe(0)
    const bars = host.querySelectorAll('.sp-data[data-s="sessions"]')
    expect(bars.length).toBe(5)
    fire(bars[1], 'pointerover')
    const tip = host.querySelector('.sp-tip')!.textContent!
    expect(tip).toContain('Of the first stage')
    expect(tip).toContain('Of the stage before')
    p.dispose()
  })

  it('bullet: hovering anywhere on a row shows value, target and ranges', () => {
    const p = new SuperPlot(host, ex('bullet'), { width: 600, height: 360 })
    const hit = host.querySelector('.sp-hit')!
    fire(hit, 'pointerover')
    const tip = host.querySelector('.sp-tip')!.textContent!
    for (const word of ['actual', 'target', 'poor', 'In range']) expect(tip).toContain(word)
    p.dispose()
  })

  it('bump: dots are focusable, end labels dim with their series on hover', () => {
    const p = new SuperPlot(host, ex('bump'), { width: 600, height: 360 })
    const dot = host.querySelector('circle.sp-data[data-s="Rust"]')!
    expect(dot.getAttribute('aria-label')).toMatch(/^Rust, 2022: rank 6/)
    expect(host.querySelector('text.sp-label[data-s="Rust"]')!.textContent).toBe('Rust')
    fire(dot, 'pointerover')
    expect(host.querySelector('.sp-data[data-s="Go"]')!.classList.contains('sp-dimmed')).toBe(true)
    p.dispose()
  })
})
