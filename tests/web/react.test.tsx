// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { StrictMode, createRef, act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { SuperPlot } from '@supersolutions/super-plot-react'
import { SuperPlot as Plot } from '@supersolutions/super-plot-web'
import { chartCatalog } from '@supersolutions/super-plot-core'

// jsdom has no canvas; the binding falls back to its text estimator.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const bar = chartCatalog().find(c => c.type === 'bar')!.example
const pie = chartCatalog().find(c => c.type === 'pie')!.example

async function mount(node: React.ReactNode): Promise<{ el: HTMLElement; unmount: () => Promise<void>; rerender: (n: React.ReactNode) => Promise<void> }> {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(node))
  return { el, unmount: () => act(async () => root.unmount()), rerender: n => act(async () => root.render(n)) }
}

describe('<SuperPlot> (react)', () => {
  it('renders the chart, exposes the instance by ref, and disposes on unmount', async () => {
    const ref = createRef<Plot | null>()
    const m = await mount(<SuperPlot ref={ref} spec={bar} width={600} height={360} />)
    expect(m.el.querySelector('svg')).not.toBeNull()
    expect(ref.current).toBeInstanceOf(Plot)
    expect(ref.current!.toSvg()).toContain('<svg')
    await m.unmount()
    expect(document.querySelectorAll('.sp-root').length).toBe(0)
  })

  it('is safe under Strict Mode: one chart, not two', async () => {
    const m = await mount(<StrictMode><SuperPlot spec={bar} width={600} height={360} /></StrictMode>)
    expect(m.el.querySelectorAll('svg').length).toBe(1)
    await m.unmount()
  })

  it('follows the spec and theme props', async () => {
    const m = await mount(<SuperPlot spec={bar} width={600} height={360} theme="light" />)
    const t1 = m.el.querySelector('svg title')!.textContent
    await m.rerender(<SuperPlot spec={pie} width={600} height={360} theme="dark" />)
    expect(m.el.querySelector('svg title')!.textContent).not.toBe(t1)
    expect(m.el.querySelector('svg')!.innerHTML).toContain('#131722')
    await m.unmount()
  })

  it('calls the latest onSelect without remounting', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const m = await mount(<SuperPlot spec={bar} width={600} height={360} onSelect={a} />)
    const before = m.el.querySelector('svg')
    await m.rerender(<SuperPlot spec={bar} width={600} height={360} onSelect={b} />)
    expect(m.el.querySelector('svg')).toBe(before)
    m.el.querySelector('.sp-data[data-s="Q1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    await m.unmount()
  })

  it('renders an empty container on the server (the DOM work is in an effect)', () => {
    const html = renderToString(<SuperPlot spec={bar} className="c" />)
    expect(html).toBe('<div class="c"></div>')
  })
})
