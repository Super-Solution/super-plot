// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef, act } from 'react'
import { createRoot } from 'react-dom/client'
import { SuperPlot, type SuperPlotOptions } from '@supersolutions/super-plot-web'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { SuperPlot as ReactPlot } from '@supersolutions/super-plot-react'
import { chartCatalog, type CardRef } from '@supersolutions/super-plot-core'
import { stub2d, loadCanvasChunk } from './stub2d'

beforeAll(loadCanvasChunk)

const realGetContext = HTMLCanvasElement.prototype.getContext
let host: HTMLDivElement
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 600, height: 360, top: 0, left: 0, right: 600, bottom: 360, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  document.body.innerHTML = ''
  HTMLCanvasElement.prototype.getContext = realGetContext
})

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const sales = (): Record<string, any> => ({
  type: 'bar',
  x: 'month',
  y: 'sales',
  annotations: [{ axis: 'y', value: 50, label: 'Goal', key: 'goal' }],
  data: MONTHS.map((month, i) => ({ month, sales: [40, 55, 90, 60, 45, 70][i] }))
})
const twoLines = (): Record<string, any> => ({
  type: 'line',
  x: 'day',
  y: 'v',
  series: 'team',
  points: true,
  zoom: 'x',
  data: ['A', 'B'].flatMap(team => Array.from({ length: 10 }, (_, d) => ({ day: d + 1, v: d * (team === 'A' ? 2 : 3), team })))
})
const opts: SuperPlotOptions = { width: 600, height: 360, animate: false }
const overlay = (): SVGSVGElement | null => host.querySelector('svg.sp-ref')
const outlined = (): number => overlay()?.querySelectorAll('.sp-ref-o > *').length ?? 0
const live = (): string => [...host.querySelectorAll('.sp-live')].map(e => e.textContent).join('|')

describe('highlight(ref)', () => {
  it('outlines the matched bar over a halo, dims the plot area, shows its tooltip and is idempotent', () => {
    const p = new SuperPlot(host, sales(), opts)
    expect(overlay()).toBeNull()
    const r = p.highlight('ref:sales?x=2026-03')
    expect(r).toEqual({ ok: true, label: expect.stringContaining('2026-03') })
    const svg = overlay()!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('viewBox')).toBe('0 0 600 360')
    expect(outlined()).toBe(1)
    expect(svg.querySelectorAll('.sp-ref-h > *')).toHaveLength(1)
    // The veil covers the plot area, with a hole (mask) where the bar is.
    const veil = svg.querySelector('.sp-ref-veil')!
    expect(veil.getAttribute('mask')).toMatch(/^url\(#sp\d+-ref\)$/)
    expect(svg.querySelectorAll('mask > *')).toHaveLength(2)
    const plot = p.getScene()!.axes!.plot
    expect(veil.querySelector('rect')!.getAttribute('width')).toBe(String(plot.w))
    // Exactly one point: its tooltip.
    const tip = host.querySelector('.sp-tip')!
    expect(tip.hasAttribute('data-show')).toBe(true)
    expect(tip.textContent).toContain('2026-03')
    // The same reference again: nothing redrawn.
    expect(p.highlight({ target: 'sales', params: { x: ['2026-03'] } })).toEqual(r)
    expect(overlay()).toBe(svg)
    // Several points: outlined, no tooltip.
    tip.removeAttribute('data-show')
    expect(p.highlight('ref:sales?x=2026-01..2026-03').ok).toBe(true)
    expect(outlined()).toBe(3)
    expect(tip.hasAttribute('data-show')).toBe(false)
    // An annotation by key.
    expect(p.highlight('ref:sales?key=goal')).toEqual({ ok: true, label: expect.stringContaining('Goal') })
    expect(outlined()).toBeGreaterThanOrEqual(1)
    expect(p.highlight(null)).toEqual({ ok: true })
    expect(overlay()).toBeNull()
    expect(p.highlight(null)).toEqual({ ok: true })
  })

  it('fails with the resolver codes and clears what was shown', () => {
    const p = new SuperPlot(host, sales(), opts)
    p.highlight('ref:sales?x=2026-02')
    expect(overlay()).not.toBeNull()
    expect(p.highlight('ref:sales?x=2027-01')).toEqual({ ok: false, code: 'ref_no_match', reason: expect.any(String) })
    expect(overlay()).toBeNull()
    expect(p.highlight('not a ref')).toMatchObject({ ok: false, code: 'ref_invalid' })
    expect(p.highlight('ref:sales?colour=red')).toMatchObject({ ok: false, code: 'ref_param_unknown' })
    expect(p.highlight('ref:sales?series=A')).toMatchObject({ ok: false, code: 'ref_param_unsupported' })
    expect(p.highlight('ref:sales?y=lots')).toMatchObject({ ok: false, code: 'ref_bad_value' })
    p.setSpec({ type: 'bar', x: 'nope' })
    expect(p.highlight('ref:sales')).toMatchObject({ ok: false, code: 'ref_spec_invalid' })
  })

  it('stays through redraws and legend toggles, leaving out hidden series', () => {
    const p = new SuperPlot(host, twoLines(), opts)
    expect(p.highlight('ref:t?x=3..4').ok).toBe(true)
    const both = outlined()
    expect(both).toBe(4)
    p.setOptions({ width: 500 })
    expect(overlay()!.getAttribute('viewBox')).toBe('0 0 500 360')
    expect(outlined()).toBe(4)
    p.setOptions({ hidden: ['B'] })
    expect(outlined()).toBe(2)
    expect(p.highlight('ref:t?series=B')).toMatchObject({ ok: false, code: 'ref_hidden_series' })
    p.setOptions({ hidden: [] })
    expect(p.highlight('ref:t?series=B&x=1').ok).toBe(true)
    expect(outlined()).toBe(1)
    // The line itself is not outlined (it draws more than matched), its points are.
    expect(overlay()!.querySelectorAll('.sp-ref-o > path')).toHaveLength(0)
  })

  it('rings matched points on a line without dots', () => {
    const spec = { ...twoLines(), points: false }
    const p = new SuperPlot(host, spec, opts)
    expect(p.highlight('ref:t?x=5&series=A').ok).toBe(true)
    expect(overlay()!.querySelectorAll('.sp-ref-o > circle')).toHaveLength(1)
    // A whole series: the line is outlined, drawn again above its outline.
    expect(p.highlight('ref:t?series=A').ok).toBe(true)
    expect(overlay()!.querySelectorAll('.sp-ref-o > path')).toHaveLength(1)
    expect(overlay()!.querySelector('svg > g:last-child > path')!.getAttribute('stroke')).toBeTruthy()
  })

  it('Escape in the chart clears the reference before anything else', () => {
    const p = new SuperPlot(host, sales(), opts)
    p.highlight('ref:sales?x=2026-04')
    const bar = host.querySelector<SVGElement>('.sp-data[tabindex]')!
    bar.focus()
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    bar.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(overlay()).toBeNull()
    // Calls after it start over.
    expect(p.highlight('ref:sales?x=2026-04').ok).toBe(true)
    expect(overlay()).not.toBeNull()
  })

  it('draws over the canvas renderer too', () => {
    HTMLCanvasElement.prototype.getContext = (() => stub2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const p = new SuperPlot(host, sales(), { ...opts, renderer: 'canvas' })
    expect(p.getRenderer()).toBe('canvas')
    expect(p.highlight('ref:sales?x=2026-05').ok).toBe(true)
    expect(outlined()).toBe(1)
    expect(overlay()!.parentElement).toBe(host.querySelector('.sp-root'))
    // A redraw on canvas keeps it.
    p.setOptions({ width: 480 })
    expect(outlined()).toBe(1)
  })
})

describe('reveal(ref)', () => {
  it('focuses the first matched mark, scrolls into view and says what it shows', () => {
    const scroll = vi.fn()
    host.scrollIntoView = scroll
    const p = new SuperPlot(host, sales(), opts)
    const r = p.reveal('ref:sales?x=2026-03')
    expect(r.ok).toBe(true)
    const i = p.getScene()!.marks.findIndex(m => m.role === 'data' && (m.datum as { x?: unknown })?.x === '2026-03')
    expect(document.activeElement).toBe(host.querySelector(`[data-i="${i}"]`))
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }))
    expect(live()).toContain(`Showing ${(r as { label: string }).label}.`)
    expect(outlined()).toBe(1)
    // Idempotent: the same again changes nothing.
    expect(p.reveal('ref:sales?x=2026-03')).toEqual(r)
    expect(document.activeElement).toBe(host.querySelector(`[data-i="${i}"]`))
    expect(outlined()).toBe(1)
  })

  it('unhides the series, zooms out and reports both as the viewer would', async () => {
    const hidden: string[][] = []
    const zooms: unknown[] = []
    const p = new SuperPlot(host, twoLines(), { ...opts, hidden: ['B'], onHiddenChange: h => hidden.push(h), onZoom: z => zooms.push(z) })
    p.setZoom({ x: [1, 3] })
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(p.getZoom()).not.toBeNull()
    const r = p.reveal('ref:t?series=B&x=9')
    expect(r.ok).toBe(true)
    expect(hidden).toEqual([[]])
    expect(p.getHidden()).toEqual([])
    expect(p.getZoom()).toBeNull()
    await new Promise(res => setTimeout(res, 50))
    expect(zooms.at(-1)).toBeNull()
    expect(outlined()).toBe(1)
    expect(host.contains(document.activeElement)).toBe(true)
  })

  it('goes back up a drill-down that hides the match', () => {
    const drills: string[][] = []
    const spec = structuredClone(chartCatalog().find(c => c.type === 'sunburst')!.example)
    const p = new SuperPlot(host, spec, { ...opts, onDrill: d => drills.push(d) })
    const asia = p.getScene()!.marks.findIndex(m => m.role === 'data' && (m.datum as { path?: string[] })?.path?.join('/') === 'Asia')
    host.querySelector<HTMLElement>(`[data-i="${asia}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills).toEqual([['Asia']])
    expect(p.reveal('ref:s?x=Paris').ok).toBe(true)
    expect(drills.at(-1)).toEqual([])
    expect(outlined()).toBeGreaterThan(0)
  })

  it('takes keyboard focus on the canvas view', () => {
    HTMLCanvasElement.prototype.getContext = (() => stub2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const p = new SuperPlot(host, sales(), { ...opts, renderer: 'canvas' })
    expect(p.reveal('ref:sales?x=2026-02').ok).toBe(true)
    expect(document.activeElement?.localName).toBe('canvas')
    expect(live()).toContain('Showing')
  })

  it('returns the resolver failure and changes nothing', () => {
    const hidden = vi.fn()
    const p = new SuperPlot(host, twoLines(), { ...opts, hidden: ['B'], onHiddenChange: hidden })
    expect(p.reveal('ref:t?series=C')).toMatchObject({ ok: false, code: 'ref_no_match' })
    expect(hidden).not.toHaveBeenCalled()
    expect(overlay()).toBeNull()
  })
})

describe('onRefChange', () => {
  it('reports the reference of the mark under the pointer, once per change, and null off it', () => {
    const seen: (CardRef | null)[] = []
    const p = new SuperPlot(host, sales(), { ...opts, refTarget: 'sales', onRefChange: r => seen.push(r) })
    const i = p.getScene()!.marks.findIndex(m => m.role === 'data' && (m.datum as { x?: unknown })?.x === '2026-02')
    const el = host.querySelector(`[data-i="${i}"]`)!
    el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 5, clientY: 5 }))
    el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 6, clientY: 5 }))
    expect(seen).toEqual([{ target: 'sales', params: { x: ['2026-02'] } }])
    host.querySelector('.sp-root')!.dispatchEvent(new MouseEvent('pointerleave'))
    expect(seen.at(-1)).toBeNull()
    // reveal's own focus move is not the viewer's.
    p.reveal('ref:sales?x=2026-05')
    expect(seen).toHaveLength(2)
  })

  it('is passed through by the element (plot-ref event, highlight, reveal) and React', async () => {
    defineSuperPlot('sp-refs')
    const el = document.createElement('sp-refs') as HTMLElement & { spec: unknown; options: SuperPlotOptions; highlight(r: string | null): { ok: boolean }; reveal(r: string): { ok: boolean } }
    el.getBoundingClientRect = () => ({ width: 600, height: 0 }) as DOMRect
    expect(el.highlight('ref:x')).toMatchObject({ ok: false, code: 'not_mounted' })
    const refs: unknown[] = []
    el.addEventListener('plot-ref', e => refs.push((e as CustomEvent).detail))
    el.options = { width: 600, height: 360, animate: false }
    el.spec = sales()
    document.body.appendChild(el)
    expect(el.highlight('ref:sales?x=2026-01').ok).toBe(true)
    expect(el.querySelector('svg.sp-ref')).not.toBeNull()
    const bar = el.querySelector('.sp-data[tabindex]')!
    bar.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(refs).toHaveLength(1)
    expect(el.reveal('ref:sales?x=2026-06').ok).toBe(true)

    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const box = document.createElement('div')
    document.body.appendChild(box)
    const root = createRoot(box)
    const ref = createRef<SuperPlot | null>()
    const got: unknown[] = []
    await act(async () => root.render(<ReactPlot ref={ref} spec={sales()} width={600} height={360} animate={false} refTarget="s" onRefChange={r => got.push(r)} />))
    expect(ref.current!.highlight('ref:s?x=2026-02').ok).toBe(true)
    box.querySelector('.sp-data[tabindex]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(got).toEqual([{ target: 's', params: { x: [expect.any(String)] } }])
    await act(async () => root.unmount())
  })
})
