// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot } from '@supersolutions/super-plot-web'
import { chartCatalog, renderToSvg, svgKey } from '@supersolutions/super-plot-core'
import { loadCanvasChunk } from './stub2d'

// The canvas renderer is loaded on demand: load it once, so canvas plots below draw at once.
beforeAll(loadCanvasChunk)

const bar = chartCatalog().find(c => c.type === 'bar')!.example
const line = chartCatalog().find(c => c.type === 'line')!.example

// A canvas text measurer that disagrees with the server's estimator: hydration must not depend on it.
const measuring = (() => ({ measureText: (t: string) => ({ width: t.length * 9 }), font: '' })) as unknown as typeof HTMLCanvasElement.prototype.getContext
let host: HTMLDivElement

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = measuring
  host = document.createElement('div')
  host.getBoundingClientRect = () => ({ width: 600, height: 0, top: 0, left: 0, right: 600, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect
  document.body.appendChild(host)
})
afterEach(() => { document.body.innerHTML = '' })

/** What a server writes into the page: the markup inside the host. */
const serve = (spec: unknown, options: Parameters<typeof renderToSvg>[1] = {}): SVGSVGElement => {
  host.innerHTML = renderToSvg(spec, { width: 600, hydrate: true, ...options })
  return host.querySelector('svg')!
}

describe('renderToSvg({ hydrate: true })', () => {
  it('writes the markup the binding draws, with a key and an id prefix', () => {
    const s = renderToSvg(bar, { width: 600, hydrate: true })
    expect(s).toMatch(/^<svg data-sp-key="[0-9a-z]+" data-sp-id="sp[0-9a-z]+" /)
    expect(s).toContain('data-i=')
    expect(s).toContain('var(--sp-')
    expect(renderToSvg(bar, { width: 600, hydrate: true })).toBe(s)
    // The key is the hash of the markup without the two stamps.
    const key = s.match(/data-sp-key="([^"]+)"/)![1]
    expect(svgKey(s.replace(/ data-sp-key="[^"]+" data-sp-id="[^"]+"/, '').replace('display:block;', ''))).toBe(key)
    expect(s).toContain('style="display:block;font-family:')
    // Different charts get different ids.
    expect(renderToSvg(line, { width: 600, hydrate: true }).match(/data-sp-id="([^"]+)"/)![1]).not.toBe(s.match(/data-sp-id="([^"]+)"/)![1])
    expect(renderToSvg(bar, { width: 600, hydrate: true, idPrefix: 'rev' })).toContain('data-sp-id="rev"')
  })
})

describe('hydration', () => {
  it('adopts matching server markup: the same nodes stay, no entrance animation, interactions attach', () => {
    const server = serve(bar)
    const first = server.querySelector('.sp-data[data-s="Q1"]')!
    const onSelect = vi.fn()
    const p = new SuperPlot(host, bar, { onSelect })
    expect(host.querySelector('svg')).toBe(server)
    expect(server.parentElement!.className).toBe('sp-root')
    expect(host.querySelectorAll('svg')).toHaveLength(1)
    expect(host.querySelector('.sp-root')!.classList.contains('sp-enter')).toBe(false)
    first.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, clientX: 5, clientY: 5 }))
    expect(host.querySelector('.sp-tip')!.textContent).toContain('APAC')
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ series: 'Q1' }))
    // Later draws (a new theme) replace it as usual, still measuring text like the server so labels do not jump.
    p.setOptions({ theme: 'dark' })
    expect(host.querySelector('svg')).not.toBe(server)
    expect(host.querySelector('svg')!.innerHTML).toContain('#131722')
    p.dispose()
  })

  it('line charts hydrate with their crosshair working', () => {
    const server = serve(line, { height: 300 })
    new SuperPlot(host, line, { height: 300 })
    expect(host.querySelector('svg')).toBe(server)
    host.querySelector('.sp-hit[data-i]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(server.querySelector(':scope > g line')).not.toBeNull()
  })

  it('redraws when the server drew something else: another size, theme, spec or locale', () => {
    for (const [spec, server, client] of [
      [bar, { width: 500 }, {}],
      [bar, { theme: 'dark' }, { theme: 'light' }],
      [bar, {}, { locale: 'de' }],
      [line, {}, {}]
    ] as const) {
      const svg = serve(spec, server)
      const p = new SuperPlot(host, spec === line ? bar : spec, client)
      expect(host.querySelector('svg')).not.toBe(svg)
      expect(host.querySelectorAll('svg')).toHaveLength(1)
      expect(host.querySelector('svg')!.hasAttribute('data-sp-key')).toBe(false)
      p.dispose()
      host.replaceChildren()
    }
  })

  it('plain renderToSvg output (no hydrate) is not adopted: it is the page content, left as it was', () => {
    host.innerHTML = renderToSvg(bar, { width: 600 })
    const svg = host.querySelector('svg')!
    new SuperPlot(host, bar)
    expect(svg.parentElement).toBe(host)
    expect(host.querySelector('.sp-root svg')).not.toBe(svg)
  })

  it('a plot that ends up on canvas drops the server markup', () => {
    const recording = (() => {
      const c: Record<string, unknown> = { globalAlpha: 1, isPointInPath: () => false, measureText: (t: string) => ({ width: t.length * 6 }) }
      for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform']) c[k] = () => {}
      return c
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = recording
    serve(bar)
    const p = new SuperPlot(host, bar, { renderer: 'canvas' })
    expect(p.getRenderer()).toBe('canvas')
    expect(host.querySelector('svg')).toBeNull()
  })
})
