// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SuperPlot, type SelectEvent, type TipContent } from '@supersolutions/super-plot-web'
import { chartCatalog, type Issue } from '@supersolutions/super-plot-core'
import { loadCanvasChunk } from './stub2d'

// The canvas renderer is loaded on demand: load it once, so canvas plots below draw at once.
beforeAll(loadCanvasChunk)

const bar = chartCatalog().find(c => c.type === 'bar')!.example
let host: HTMLDivElement
const none = (() => null) as typeof HTMLCanvasElement.prototype.getContext
const recording = (() => {
  const c: Record<string, unknown> = { globalAlpha: 1, isPointInPath: () => false, measureText: (t: string) => ({ width: t.length * 6 }) }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform']) c[k] = () => {}
  return c
}) as unknown as typeof HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = none
  host = document.createElement('div')
  host.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
  document.body.appendChild(host)
})
afterEach(() => { document.body.innerHTML = '' })

const over = (el: Element): void => { el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 })) }
const tip = (): HTMLElement => host.querySelector<HTMLElement>('.sp-tip')!

describe('tooltipFormat', () => {
  it('a string is shown as text: markup in it is never parsed', () => {
    const seen: [TipContent, SelectEvent][] = []
    new SuperPlot(host, bar, {
      width: 600, height: 400,
      tooltipFormat: (t, e) => { seen.push([t, e]); return `<img src=x onerror=alert(1)> ${t.title}\n${(e.datum as { value: number }).value} USD` }
    })
    over(host.querySelector('.sp-data[data-s="Q1"]')!)
    expect(tip().hasAttribute('data-show')).toBe(true)
    expect(tip().querySelector('img')).toBeNull()
    expect(tip().textContent).toBe('<img src=x onerror=alert(1)> APAC\n120 USD')
    expect(tip().hasAttribute('data-custom')).toBe(true)
    expect(seen[0][1]).toMatchObject({ datum: { x: 'APAC', series: 'Q1', value: 120 }, series: 'Q1' })
    expect(seen[0][0].rows[0].value).toBe('120')
  })

  it('a Node is inserted as built; null falls back to the default', () => {
    new SuperPlot(host, bar, {
      width: 600, height: 400,
      tooltipFormat: (t, e) => {
        if (e.series !== 'Q1') return null
        const b = document.createElement('strong')
        b.className = 'mine'
        b.textContent = `Q1 in ${t.title}`
        return b
      }
    })
    over(host.querySelector('.sp-data[data-s="Q1"]')!)
    expect(tip().querySelector('strong.mine')!.textContent).toBe('Q1 in APAC')
    over(host.querySelector('.sp-data[data-s="Q2"]')!)
    expect(tip().querySelector('strong.mine')).toBeNull()
    expect(tip().hasAttribute('data-custom')).toBe(false)
    expect(tip().querySelector('.sp-tr')).not.toBeNull()
  })

  it('applies to keyboard focus tooltips', () => {
    new SuperPlot(host, bar, { width: 600, height: 400, tooltipFormat: t => `focus ${t.title}` })
    host.querySelector('.sp-data[tabindex]')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(tip().textContent).toBe('focus APAC')
  })

  it('a throwing formatter shows the default and warns once', () => {
    const issues: Issue[][] = []
    new SuperPlot(host, bar, { width: 600, height: 400, onIssues: i => issues.push(i), tooltipFormat: () => { throw new Error('boom') } })
    over(host.querySelector('.sp-data[data-s="Q1"]')!)
    over(host.querySelector('.sp-data[data-s="Q2"]')!)
    expect(tip().querySelector('.sp-tr')).not.toBeNull()
    const warned = issues.filter(list => list.some(i => i.code === 'tooltip_format_error'))
    expect(warned).toHaveLength(1)
    expect(warned[0].find(i => i.code === 'tooltip_format_error')!.message).toContain('boom')
  })

  it('works on the canvas renderer, pointer and keyboard', () => {
    HTMLCanvasElement.prototype.getContext = recording
    const p = new SuperPlot(host, bar, { width: 600, height: 400, renderer: 'canvas', tooltipFormat: (t, e) => `${e.series}: ${t.rows[0].value}` })
    expect(p.getRenderer()).toBe('canvas')
    const c = host.querySelector('canvas')!
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(tip().textContent).toBe('Q1: 120')
    c.getBoundingClientRect = host.getBoundingClientRect
    const target = p.getScene()!.marks.find(m => m.type === 'rect' && m.role === 'data' && m.series === 'Q2')!
    if (target.type !== 'rect') throw new Error('expected a bar')
    c.dispatchEvent(new MouseEvent('pointermove', { clientX: target.x + target.w / 2, clientY: target.y + target.h / 2, bubbles: true }))
    expect(tip().textContent).toBe(`Q2: ${target.tip!.rows[0].value}`)
    // The live region keeps the full, plain reading of the data.
    expect(host.querySelector('.sp-cv .sp-live')!.textContent).toContain('120')
  })
})
