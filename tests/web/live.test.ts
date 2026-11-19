// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot, type RenderEvent } from '@supersolutions/super-plot-web'
import { CSS } from '../../packages/bindings/web/src/styles'
import { stub2d } from './stub2d'

const realGetContext = HTMLCanvasElement.prototype.getContext
let host: HTMLDivElement
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  document.body.innerHTML = ''
  HTMLCanvasElement.prototype.getContext = realGetContext
  vi.useRealTimers()
})

const raf = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()))
const at = (h: number, m: number): string => new Date(Date.UTC(2026, 0, 5, h, m)).toISOString()
const start = Array.from({ length: 5 }, (_, i) => ({ t: at(14, i), revenue: 1000 + i * 10 }))
const spec = { type: 'line', x: 't', y: 'revenue', data: start, format: 'compact' }
const said = (): string => host.querySelector('.sp-live')?.textContent ?? ''

describe('live-data announcements', () => {
  it('say how many points arrived and the latest one, at most once every 5 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(Date.UTC(2026, 0, 5, 15))
    const p = new SuperPlot(host, spec, { width: 600, height: 400, animate: false, announce: true })
    p.appendRows([{ t: at(14, 5), revenue: 1100 }, { t: at(14, 6), revenue: 1150 }, { t: at(14, 7), revenue: 1200 }])
    await raf()
    const tip = p.getScene()!.marks.filter(m => m.role === 'hit').at(-1)!.tip!
    expect(said()).toBe(`3 new points; latest ${tip.title}: revenue 1.2K.`)
    // Within 5 s: held back, then the total since the last one, with the newest point.
    p.appendRows([{ t: at(14, 8), revenue: 1300 }])
    await raf()
    p.appendRows([{ t: at(14, 9), revenue: 1400 }])
    await raf()
    expect(said()).toContain('3 new points')
    vi.advanceTimersByTime(5000)
    const last = p.getScene()!.marks.filter(m => m.role === 'hit').at(-1)!.tip!
    expect(said()).toBe(`2 new points; latest ${last.title}: revenue 1.4K.`)
  })

  it('by default only while the chart has keyboard focus or shows a data table; false never', async () => {
    // A zoomable chart: its root takes keyboard focus.
    const p = new SuperPlot(host, { ...spec, zoom: 'x' }, { width: 600, height: 400, animate: false })
    p.appendRows([{ t: at(14, 5), revenue: 1100 }])
    await raf()
    expect(said()).toBe('')
    host.querySelector<HTMLElement>('.sp-root')!.focus()
    p.appendRows([{ t: at(14, 6), revenue: 1150 }])
    await raf()
    expect(said()).toMatch(/^1 new point; latest /)
    p.dispose()
    const q = new SuperPlot(host, spec, { width: 600, height: 400, animate: false, dataTable: true })
    q.appendRows([{ t: at(14, 5), revenue: 1100 }])
    await raf()
    expect(said()).toMatch(/^1 new point/)
    q.dispose()
    const r = new SuperPlot(host, spec, { width: 600, height: 400, animate: false, dataTable: true, announce: false })
    r.appendRows([{ t: at(14, 5), revenue: 1100 }])
    await raf()
    expect(said()).toBe('')
  })

  it('a chart without axes counts rows; canvas speaks through its own live region', async () => {
    const pie = { type: 'pie', label: 'k', value: 'v', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }] }
    const p = new SuperPlot(host, pie, { width: 600, height: 400, animate: false, announce: true })
    p.appendRows([{ k: 'c', v: 3 }, { k: 'd', v: 1 }])
    await raf()
    expect(said()).toBe('2 new rows.')
    p.dispose()
    HTMLCanvasElement.prototype.getContext = (() => stub2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const c = new SuperPlot(host, spec, { width: 600, height: 400, animate: false, announce: true, renderer: 'canvas' })
    c.appendRows([{ t: at(14, 5), revenue: 1100 }])
    await raf()
    expect(host.querySelectorAll('.sp-live')).toHaveLength(1)
    expect(said()).toMatch(/^1 new point; latest .*revenue 1\.1K\.$/)
  })
})

describe('print', () => {
  const bar = { type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }] }
  it('a dark chart prints in the light theme and comes back afterwards', () => {
    const renders: RenderEvent[] = []
    new SuperPlot(host, bar, { width: 600, height: 400, animate: false, theme: 'dark', onRender: e => renders.push(e) })
    const bg = (): string => renders.at(-1)!.scene.background
    expect(bg()).toContain('#131722')
    window.dispatchEvent(new Event('beforeprint'))
    expect(bg()).toContain('#FFFFFF')
    expect(host.querySelector('svg')!.innerHTML).not.toContain('#131722')
    window.dispatchEvent(new Event('afterprint'))
    expect(bg()).toContain('#131722')
  })

  it('accessible-dark prints as accessible; light and printLight: false stay as they are', () => {
    const renders: RenderEvent[] = []
    const p = new SuperPlot(host, bar, { width: 600, height: 400, animate: false, theme: 'accessible-dark', onRender: e => renders.push(e) })
    window.dispatchEvent(new Event('beforeprint'))
    expect(renders.at(-1)!.scene.marks.find(m => m.role === 'data')!.type).toBe('rect')
    expect(renders.at(-1)!.scene.background).toContain('#FFFFFF')
    window.dispatchEvent(new Event('afterprint'))
    p.setOptions({ theme: 'light' })
    const n = renders.length
    window.dispatchEvent(new Event('beforeprint'))
    window.dispatchEvent(new Event('afterprint'))
    expect(renders).toHaveLength(n)
    p.setOptions({ theme: 'dark', printLight: false })
    window.dispatchEvent(new Event('beforeprint'))
    expect(renders.at(-1)!.scene.background).toContain('#131722')
    window.dispatchEvent(new Event('afterprint'))
    p.dispose()
    // Disposed: the print listeners are gone.
    const m = renders.length
    window.dispatchEvent(new Event('beforeprint'))
    expect(renders).toHaveLength(m)
  })

  it('print rules hide the toolbar, tooltip, map buttons and navigator handles, and keep the chart whole', () => {
    const print = CSS.slice(CSS.indexOf('@media print'))
    expect(print).toMatch(/^@media print\{\.sp-bar,\.sp-ctl,\.sp-tip,\.sp-nav-h\{display:none!important\}/)
    expect(print).toContain('break-inside:avoid')
  })
})
