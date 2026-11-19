// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { SuperPlot, type SelectEvent } from '@supersolutions/super-plot-web'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { SuperPlot as ReactPlot } from '@supersolutions/super-plot-react'
import { chartCatalog } from '@supersolutions/super-plot-core'
import { stub2d } from './stub2d'

const realGetContext = HTMLCanvasElement.prototype.getContext
let host: HTMLDivElement
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => ({ width: 640, height: 420, top: 0, left: 0, right: 640, bottom: 420, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  document.body.innerHTML = ''
  HTMLCanvasElement.prototype.getContext = realGetContext
})

const ex = (type: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === type)!.example)
const arcOf = (p: SuperPlot, path: string): Element => {
  const i = p.getScene()!.marks.findIndex(m => m.role === 'data' && (m.datum as { path?: string[] })?.path?.join('/') === path)
  return host.querySelector(`[data-i="${i}"]`)!
}
const crumbs = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.sp-label[role="button"]')]
const key = (el: Element, k: string): void => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) }
const leaves = (p: SuperPlot): string[] => p.getScene()!.marks.filter(m => m.role === 'data').map(m => (m.datum as { path: string[] }).path.join('/'))

describe('drill-down', () => {
  it('a click on a sunburst group shows only it; the breadcrumb and Escape go back up; the spec is not changed', () => {
    const spec = ex('sunburst')
    const before = JSON.stringify(spec)
    const drills: string[][] = []
    const selects: SelectEvent[] = []
    const p = new SuperPlot(host, spec, { width: 640, height: 420, animate: false, onDrill: d => drills.push(d), onSelect: e => selects.push(e) })
    expect(crumbs()).toHaveLength(0)
    ;(arcOf(p, 'Asia') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills).toEqual([['Asia']])
    expect(selects.map(e => (e.datum as { path: string[] }).path)).toEqual([['Asia']])
    expect(leaves(p).every(l => l.startsWith('Asia/'))).toBe(true)
    expect(p.getScene()!.description).toContain('Showing only Asia')
    expect(JSON.stringify(spec)).toBe(before)
    // Deeper, from the keyboard.
    const japan = arcOf(p, 'Asia/Japan') as HTMLElement
    japan.focus()
    key(japan, 'Enter')
    expect(drills.at(-1)).toEqual(['Asia', 'Japan'])
    expect(leaves(p)).toEqual(['Asia/Japan/Tokyo', 'Asia/Japan/Osaka'])
    // Keyboard focus stays in the chart, on the first group, and the change is announced.
    expect(host.contains(document.activeElement)).toBe(true)
    expect(host.querySelector('.sp-live')!.textContent).toBe('Showing Asia > Japan.')
    // Breadcrumb: All and Asia are buttons; Japan is where we are.
    expect(crumbs().map(c => c.getAttribute('aria-label'))).toEqual(['Go up to All', 'Go up to Asia'])
    // Escape: up one level, focus back on the group we came from.
    key(document.activeElement!, 'Escape')
    expect(drills.at(-1)).toEqual(['Asia'])
    expect(document.activeElement).toBe(arcOf(p, 'Asia/Japan'))
    crumbs()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills.at(-1)).toEqual([])
    expect(leaves(p)).toContain('Europe')
    // A leaf only selects.
    const n = drills.length
    arcOf(p, 'Europe/Germany/Berlin').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills).toHaveLength(n)
  })

  it('keeps the focus for new data, drops it for another hierarchy; the spec\'s own focus is the start', () => {
    const spec = ex('sunburst')
    const p = new SuperPlot(host, { ...spec, focus: ['Europe'] }, { width: 640, height: 420, animate: false })
    expect(leaves(p).every(l => l.startsWith('Europe/'))).toBe(true)
    arcOf(p, 'Europe/Germany').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    p.setSpec({ ...spec, focus: ['Europe'], data: [...spec.data] })
    expect(leaves(p)[0]).toBe('Europe/Germany/Berlin')
    p.setSpec({ ...spec, focus: ['Asia'] })
    expect(leaves(p).every(l => l.startsWith('Asia/'))).toBe(true)
  })

  it('treemap: a tile drills into its group; drill: false turns it off and the breadcrumb is plain text', () => {
    const spec = ex('treemap')
    const drills: string[][] = []
    const p = new SuperPlot(host, spec, { width: 640, height: 420, animate: false, onDrill: d => drills.push(d) })
    const i = p.getScene()!.marks.findIndex(m => m.role === 'data' && (m.datum as { label: string }).label === 'Docs')
    host.querySelector(`[data-i="${i}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills).toEqual([['Apps']])
    expect(p.getScene()!.marks.filter(m => m.role === 'data').map(m => (m.datum as { label: string }).label)).toEqual(['Mail', 'Docs', 'Chat'])
    p.dispose()
    const q = new SuperPlot(host, { ...spec, focus: ['Apps'] }, { width: 640, height: 420, animate: false, drill: false, onDrill: d => drills.push(d) })
    expect(crumbs()).toHaveLength(0)
    const crumb = q.getScene()!.marks.findIndex(m => m.role === 'label' && m.type === 'rect' && m.drill)
    expect(host.querySelector(`[data-i="${crumb}"]`)!.getAttribute('aria-hidden')).toBe('true')
    host.querySelector(`[data-i="${crumb}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills).toHaveLength(1)
  })

  it('default: on only with more than one level', () => {
    const one = { type: 'sunburst', path: ['k'], value: 'v', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }] }
    const drills: string[][] = []
    const p = new SuperPlot(host, one, { width: 640, height: 420, animate: false, onDrill: d => drills.push(d) })
    host.querySelector('.sp-data')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills).toEqual([])
    const { group: _g, ...flat } = ex('treemap')
    p.setSpec(flat)
    host.querySelector('.sp-data')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drills).toEqual([])
  })

  it('canvas: groups drill on Enter, the breadcrumb items are real buttons', () => {
    HTMLCanvasElement.prototype.getContext = (() => stub2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const drills: string[][] = []
    let on: string[] = []
    const p = new SuperPlot(host, ex('sunburst'), { width: 640, height: 420, animate: false, renderer: 'canvas', onDrill: d => drills.push(d), onHover: e => { on = (e?.datum as { path: string[] } | undefined)?.path ?? [] } })
    expect(p.getRenderer()).toBe('canvas')
    const cv = host.querySelector<HTMLCanvasElement>('canvas')!
    cv.focus()
    key(cv, 'Home')
    // Step to a first-level group (the arrow keys go through the arcs in reading order).
    for (let i = 0; i < 40 && on.length !== 1; i++) key(cv, 'ArrowRight')
    expect(on).toHaveLength(1)
    key(cv, 'Enter')
    expect(drills).toEqual([on])
    expect(document.activeElement).toBe(cv)
    const b = host.querySelector<HTMLButtonElement>('.sp-cv-lk[aria-label="Go up to All"]')!
    expect(b).not.toBeNull()
    b.click()
    expect(drills.at(-1)).toEqual([])
    expect(host.querySelector('.sp-cv-lk[aria-label="Go up to All"]')).toBeNull()
  })

  it('the element dispatches plot-drill; React passes onDrill and drill through', async () => {
    defineSuperPlot()
    const el = document.createElement('super-plot') as HTMLElement & { spec: unknown }
    document.body.appendChild(el)
    el.getBoundingClientRect = () => ({ width: 640, height: 420, top: 0, left: 0, right: 640, bottom: 420, x: 0, y: 0, toJSON() {} }) as DOMRect
    const got: unknown[] = []
    el.addEventListener('plot-drill', e => got.push((e as CustomEvent).detail))
    el.spec = ex('treemap')
    el.querySelector('.sp-data')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(got).toHaveLength(1)
    el.setAttribute('drill', 'false')
    el.querySelector('.sp-label[role="button"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(el.querySelector('.sp-label[role="button"]')).toBeNull()

    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const div = document.createElement('div')
    document.body.appendChild(div)
    const root = createRoot(div)
    const seen: string[][] = []
    await act(async () => { root.render(createElement(ReactPlot, { spec: ex('treemap'), width: 640, height: 420, animate: false, onDrill: (d: string[]) => seen.push(d) })) })
    div.querySelector('.sp-data')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(seen).toHaveLength(1)
    await act(async () => { root.render(createElement(ReactPlot, { spec: ex('treemap'), width: 640, height: 420, animate: false, drill: false, onDrill: (d: string[]) => seen.push(d) })) })
    expect(div.querySelector('.sp-label[role="button"]')).toBeNull()
    await act(async () => { root.unmount() })
  })
})
