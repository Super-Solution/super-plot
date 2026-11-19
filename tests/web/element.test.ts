// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { chartCatalog } from '@supersolutions/super-plot-core'
import type { SuperPlot, SuperPlotOptions } from '@supersolutions/super-plot-web'

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const bar = chartCatalog().find(c => c.type === 'bar')!.example
type El = HTMLElement & {
  spec: unknown
  options: Partial<SuperPlotOptions>
  instance: SuperPlot | null
  toCsv(): string
  sonify(): { playing: boolean; stop(): void }
}
const isDark = (el: HTMLElement): boolean => !el.querySelector('svg')!.innerHTML.includes('--sp-background, #FFFFFF')
const make = (name: string): El => {
  const el = document.createElement(name) as El
  el.getBoundingClientRect = () => ({ width: 600, height: 0 }) as DOMRect
  return el
}
afterEach(() => { document.body.innerHTML = '' })

describe('<super-plot> as Vue, Svelte and Angular use it', () => {
  it('takes spec and options as properties (objects, not JSON) and fires its events', () => {
    defineSuperPlot('sp-props')
    const el = make('sp-props')
    const fromOptions = vi.fn()
    const seen: string[] = []
    for (const t of ['plot-select', 'plot-hover', 'plot-render']) el.addEventListener(t, e => seen.push(`${t}:${(e as CustomEvent).detail?.series ?? ''}`))
    // What a framework's property binding does: plain assignments, in any order, before or after insertion.
    el.options = { theme: 'dark', toolbar: ['csv'], onSelect: fromOptions }
    el.spec = bar
    document.body.appendChild(el)
    expect(isDark(el)).toBe(true)
    expect([...el.querySelectorAll<HTMLButtonElement>('.sp-bar button')].map(b => b.dataset.tool)).toEqual(['csv'])
    const q1 = el.querySelector('.sp-data[data-s="Q1"]')!
    q1.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    q1.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(seen).toEqual(['plot-render:', 'plot-hover:Q1', 'plot-select:Q1'])
    // A callback in options is called as well as the event.
    expect(fromOptions).toHaveBeenCalledWith(expect.objectContaining({ series: 'Q1' }))
    // Changing options later updates the chart.
    el.options = { theme: 'light', toolbar: false }
    expect(el.querySelector('.sp-bar')).toBeNull()
    expect(isDark(el)).toBe(false)
    expect(el.toCsv().split('\r\n')[0]).toBe('region,Q1,Q2,Q3')
  })

  it('properties set before the element is defined are taken over on upgrade', () => {
    const el = make('sp-late')
    el.spec = bar
    el.options = { theme: 'dark' }
    document.body.appendChild(el)
    expect(el.querySelector('svg')).toBeNull()
    defineSuperPlot('sp-late')
    expect(isDark(el)).toBe(true)
    expect(el.instance).not.toBeNull()
  })

  it('toolbar and sync attributes', () => {
    defineSuperPlot('sp-attrs')
    const a = make('sp-attrs'), b = make('sp-attrs')
    a.setAttribute('toolbar', '')
    a.setAttribute('sync', 'page')
    b.setAttribute('toolbar', 'png, sound')
    b.setAttribute('sync', 'page')
    a.spec = bar
    b.spec = bar
    document.body.append(a, b)
    expect([...a.querySelectorAll<HTMLButtonElement>('.sp-bar button')].map(x => x.dataset.tool)).toEqual(['png', 'svg', 'csv', 'table'])
    expect([...b.querySelectorAll<HTMLButtonElement>('.sp-bar button')].map(x => x.dataset.tool)).toEqual(['png', 'sound'])
    a.querySelectorAll('.sp-data[data-i]')[4].dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(b.querySelector('.sp-tip')!.hasAttribute('data-show')).toBe(true)
    a.setAttribute('toolbar', 'false')
    expect(a.querySelector('.sp-bar')).toBeNull()
    b.removeAttribute('toolbar')
    expect(b.querySelector('.sp-bar')).toBeNull()
    // sonify() without Web Audio is a quiet no-op, mounted or not.
    expect(a.sonify().playing).toBe(false)
    expect(make('sp-attrs').sonify().playing).toBe(false)
  })

  it('a removed attribute falls back to the options property', () => {
    defineSuperPlot('sp-fallback')
    const el = make('sp-fallback')
    el.options = { theme: 'dark' }
    el.setAttribute('theme', 'light')
    el.spec = bar
    document.body.appendChild(el)
    expect(isDark(el)).toBe(false)
    el.removeAttribute('theme')
    expect(isDark(el)).toBe(true)
  })
})
