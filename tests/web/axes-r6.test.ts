// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SuperPlot } from '@supersolutions/super-plot-web'
import type { Issue } from '@supersolutions/super-plot-core'

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 600, height: 0, top: 0, left: 0, right: 600, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  document.body.innerHTML = ''
})

const data = [{ w: '2026-09-07', orders: 1180, conv: 0.031 }, { w: '2026-09-14', orders: 1240, conv: 0.032 }, { w: '2026-09-21', orders: 1225, conv: 0.029 }]

describe('two value axes and broken axes in the web binding', () => {
  it('reports the dual_axis note and offers zoom and brush on x only', () => {
    const issues: Issue[] = []
    const p = new SuperPlot(host, { type: 'line', x: 'w', y: 'orders', yRight: 'conv', formatRight: 'percent', zoom: 'xy', brush: 'xy', data }, { width: 600, height: 360, onIssues: i => issues.push(...i) })
    expect(issues.map(i => [i.severity, i.code])).toEqual(expect.arrayContaining([['info', 'dual_axis'], ['warning', 'zoom_refused'], ['warning', 'brush_refused']]))
    expect(host.querySelector('.sp-root, [data-axes]')!.getAttribute('data-axes')).toBe('x')
    // The legend names the right-axis series as such, so identity is not colour alone.
    expect([...host.querySelectorAll('[data-lk]')].map(e => e.getAttribute('aria-label'))).toContain('conv (right axis): toggle series')
    p.dispose()
  })
  it('draws the cut of a broken axis as annotation marks the pointer passes through', () => {
    const p = new SuperPlot(host, { type: 'bar', x: 'k', y: 'v', yBreak: [40, 900], data: [{ k: 'a', v: 960 }, { k: 'b', v: 12 }] }, { width: 600, height: 360 })
    expect(host.querySelectorAll('path.sp-annotation').length).toBe(3)
    expect(document.head.querySelector('style[data-super-plot]')!.textContent).toContain('.sp-m.sp-annotation{pointer-events:none}')
    p.dispose()
  })
})
