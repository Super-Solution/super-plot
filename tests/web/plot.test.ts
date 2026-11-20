// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot } from '@supersolutions/super-plot-web'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { chartCatalog } from '@supersolutions/super-plot-core'

// jsdom has no canvas; the binding falls back to its text estimator.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const bar = chartCatalog().find(c => c.type === 'bar')!.example
const line = chartCatalog().find(c => c.type === 'line')!.example
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  host.style.width = '600px'
  document.body.appendChild(host)
  // jsdom has no layout: give the host a width.
  host.getBoundingClientRect = () => ({ width: 600, height: 0, top: 0, left: 0, right: 600, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect
})
afterEach(() => {
  document.body.innerHTML = ''
})

const fire = (el: Element, type: string, init: PointerEventInit = {}): void => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10, ...init }))
}

describe('SuperPlot (web)', () => {
  it('mounts an accessible svg with interactive hooks and no inline script', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    const svg = host.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.querySelector('title')!.textContent).toBe('Revenue by region')
    expect(svg.querySelector('desc')!.textContent).toMatch(/Bar chart/)
    expect(host.querySelectorAll('[data-i]').length).toBeGreaterThan(10)
    expect(host.querySelector('script')).toBeNull()
    expect(document.head.querySelectorAll('style[data-super-plot]').length).toBe(1)
    new SuperPlot(document.createElement('div'), bar, { width: 300, height: 200 }).dispose()
    expect(document.head.querySelectorAll('style[data-super-plot]').length).toBe(1)
    p.dispose()
  })

  it('shows a tooltip with the series values on hover, and hides it on leave', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    const first = host.querySelector('.sp-data[data-i]')!
    fire(first, 'pointerover')
    const tip = host.querySelector('.sp-tip')!
    expect(tip.hasAttribute('data-show')).toBe(true)
    expect(tip.textContent).toContain('APAC')
    expect(tip.textContent).toContain('120')
    fire(host.querySelector('.sp-root')!, 'pointerleave')
    expect(tip.hasAttribute('data-show')).toBe(false)
    p.dispose()
  })

  it('tooltip text is inserted as text, never as markup', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const p = new SuperPlot(host, { type: 'bar', x: 'k', y: 'v', data: [{ k: evil, v: 1 }, { k: 'b', v: 2 }] }, { width: 600, height: 360 })
    fire(host.querySelector('.sp-data[data-i]')!, 'pointerover')
    expect(host.querySelector('.sp-tip img')).toBeNull()
    expect(host.querySelector('.sp-tip')!.textContent).toContain(evil)
    p.dispose()
  })

  it('dims other series while one is hovered', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    const q1 = host.querySelector('.sp-data[data-s="Q1"]')!
    fire(q1, 'pointerover')
    expect(host.querySelectorAll('.sp-dimmed').length).toBeGreaterThan(0)
    expect(q1.classList.contains('sp-dimmed')).toBe(false)
    expect(host.querySelector('.sp-data[data-s="Q2"]')!.classList.contains('sp-dimmed')).toBe(true)
    fire(host.querySelector('.sp-root')!, 'pointerleave')
    expect(host.querySelectorAll('.sp-dimmed').length).toBe(0)
    p.dispose()
  })

  it('toggles a series from the legend, and refuses to hide the last one', () => {
    const onHiddenChange = vi.fn()
    const p = new SuperPlot(host, bar, { width: 600, height: 360, onHiddenChange })
    const before = host.querySelectorAll('.sp-data[data-s="Q1"]').length
    expect(before).toBeGreaterThan(0)
    fire(host.querySelector('[data-lk="Q1"]')!, 'click')
    expect(onHiddenChange).toHaveBeenLastCalledWith(['Q1'])
    expect(host.querySelectorAll('.sp-data[data-s="Q1"]').length).toBe(0)
    expect(host.querySelector('[data-lk="Q1"]')).not.toBeNull()
    fire(host.querySelector('[data-lk="Q2"]')!, 'click')
    fire(host.querySelector('[data-lk="Q3"]')!, 'click')
    expect(p.getHidden().sort()).toEqual(['Q1', 'Q2'])
    fire(host.querySelector('[data-lk="Q1"]')!, 'click')
    expect(host.querySelectorAll('.sp-data[data-s="Q1"]').length).toBeGreaterThan(0)
    p.dispose()
  })

  it('the whole legend row is the hit target, label and swatch included', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    const marks = [...host.querySelectorAll('.sp-legend')]
    const keyed = marks.findIndex(el => el.getAttribute('data-lk') === 'Q1')
    const sameRow = marks.filter(el => el.getAttribute('data-s') === 'Q1')
    // The clickable rect is the last mark of its row, so it paints above the swatch and the text.
    expect(marks.indexOf(sameRow[sameRow.length - 1])).toBe(keyed)
    p.dispose()
  })

  it('follows a host height that appears after creation, and falls back to the width when it has none', () => {
    let h = 0
    Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => h })
    const p = new SuperPlot(host, bar, { width: undefined })
    const root = host.querySelector('.sp-root') as HTMLElement
    expect(root.style.height).not.toBe('') // no height of its own: picked from the width
    h = 300 // the host got a CSS height later (attached, unhidden)
    p.setOptions({})
    expect(root.style.height).toBe('')
    expect(host.querySelector('svg')!.getAttribute('viewBox')!.endsWith(' 300')).toBe(true)
    p.dispose()
  })

  it('legend works from the keyboard', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    const item = host.querySelector('[data-lk="Q2"]')!
    expect(item.getAttribute('role')).toBe('button')
    expect(item.getAttribute('tabindex')).toBe('0')
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(p.getHidden()).toEqual(['Q2'])
    p.dispose()
  })

  it('emits onSelect with the mark datum when a bar is clicked', () => {
    const onSelect = vi.fn()
    const p = new SuperPlot(host, bar, { width: 600, height: 360, onSelect })
    fire(host.querySelector('.sp-data[data-s="Q1"]')!, 'click')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ datum: { x: 'APAC', series: 'Q1', value: 120 }, series: 'Q1' }))
    p.dispose()
  })

  it('line charts show a crosshair and one focus dot per series on hover', () => {
    const p = new SuperPlot(host, line, { width: 600, height: 360 })
    const hit = host.querySelector('.sp-hit[data-i]')!
    fire(hit, 'pointerover')
    const g = host.querySelector('svg > g')!
    expect(g.querySelectorAll('line').length).toBe(1)
    expect(g.querySelectorAll('circle').length).toBe(2)
    expect(host.querySelector('.sp-tip')!.textContent).toMatch(/Web/)
    p.dispose()
  })

  it('setSpec and setOptions re-render; theme changes colours', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360, theme: 'light' })
    const light = host.querySelector('svg')!.innerHTML
    p.setOptions({ theme: 'dark' })
    expect(host.querySelector('svg')!.innerHTML).not.toBe(light)
    expect(host.querySelector('svg')!.innerHTML).toContain('#17171A')
    p.setSpec(line)
    expect(host.querySelector('svg title')!.textContent).toBe('Weekly active users')
    p.dispose()
  })

  it('shows a readable error instead of a blank chart for a bad spec, and recovers', () => {
    const onIssues = vi.fn()
    const p = new SuperPlot(host, { type: 'bar', x: 'nope', y: 'v', data: [{ a: 1, v: 1 }] }, { width: 600, height: 360, onIssues })
    const err = host.querySelector('[role="alert"]')!
    expect(err.textContent).toContain('Column "nope" does not exist')
    expect(onIssues).toHaveBeenCalled()
    expect(() => p.toSvg()).toThrow()
    p.setSpec({ type: 'bar', x: 'a', y: 'v', data: [{ a: 'x', v: 1 }] })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.querySelector('svg')).not.toBeNull()
    p.dispose()
  })

  it('exports standalone svg without hooks or variables', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    const svg = p.toSvg()
    expect(svg).not.toContain('data-i=')
    expect(svg).not.toContain('var(')
    p.dispose()
  })

  it('animates on mount and removes the class afterwards; animate:false skips it', () => {
    vi.useFakeTimers()
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    expect(host.querySelector('.sp-root')!.classList.contains('sp-enter')).toBe(true)
    vi.advanceTimersByTime(1100)
    expect(host.querySelector('.sp-root')!.classList.contains('sp-enter')).toBe(false)
    p.dispose()
    const q = new SuperPlot(host, bar, { width: 600, height: 360, animate: false })
    expect(host.querySelector('.sp-root')!.classList.contains('sp-enter')).toBe(false)
    q.dispose()
    vi.useRealTimers()
  })

  it('dispose removes everything and is idempotent', () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 360 })
    p.dispose()
    p.dispose()
    expect(host.children.length).toBe(0)
  })

  it('respects tooltip:false in the spec', () => {
    const p = new SuperPlot(host, { ...bar, tooltip: false }, { width: 600, height: 360 })
    fire(host.querySelector('.sp-data[data-i]')!, 'pointerover')
    expect(host.querySelector('.sp-tip')!.hasAttribute('data-show')).toBe(false)
    p.dispose()
  })
})

describe('<super-plot>', () => {
  it('renders from a JSON attribute and a property, and emits events', () => {
    defineSuperPlot()
    const el = document.createElement('super-plot') as HTMLElement & { spec: unknown; instance: SuperPlot | null }
    el.setAttribute('theme', 'dark')
    el.setAttribute('spec', JSON.stringify(bar))
    el.getBoundingClientRect = () => ({ width: 500, height: 0 }) as DOMRect
    const select = vi.fn()
    el.addEventListener('plot-select', select)
    document.body.appendChild(el)
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelector('svg')!.innerHTML).toContain('#17171A')
    fire(el.querySelector('.sp-data[data-s="Q1"]')!, 'click')
    expect(select).toHaveBeenCalledTimes(1)
    el.spec = line
    expect(el.querySelector('svg title')!.textContent).toBe('Weekly active users')
    el.remove()
    expect(el.instance).toBeNull()
  })
})
