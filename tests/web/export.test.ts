// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuperPlot, fileNameOf, type ZoomRange } from '@supersolutions/super-plot-web'
import { CSS } from '../../packages/bindings/web/src/styles'
import { csvCell, plotCsv, plotTable, chartCatalog, type Issue } from '@supersolutions/super-plot-core'

HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

const bar = chartCatalog().find(c => c.type === 'bar')!.example
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  host.getBoundingClientRect = () => ({ width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect
  document.body.appendChild(host)
})
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('plotCsv', () => {
  it('quotes per RFC 4180 and ends lines with CRLF', () => {
    const csv = plotCsv({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a,b', v: 1 }, { k: 'say "hi"', v: 2.5 }, { k: 'two\nlines', v: 3 }] })!
    expect(csv).toBe('k,v\r\n"a,b",1\r\n"say ""hi""",2.5\r\n"two\nlines",3\r\n')
  })

  it('defuses formulas but keeps negative numbers numeric', () => {
    const csv = plotCsv({ type: 'bar', x: 'k', y: 'v', data: [{ k: '=HYPERLINK("http://x")', v: -12.5 }, { k: '+1', v: -3 }, { k: '@SUM(A1)', v: 0 }, { k: '-cmd', v: 1 }, { k: '\tTab', v: 2 }, { k: '-42', v: 3 }] })!
    const lines = csv.trim().split('\r\n')
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"")",-12.5`)
    expect(lines[2]).toBe("'+1,-3")
    expect(lines[3]).toBe("'@SUM(A1),0")
    expect(lines[4]).toBe("'-cmd,1")
    expect(lines[5]).toBe("'\tTab,2")
    expect(lines[6]).toBe('-42,3')
    expect(csvCell('\rx')).toBe(`"'\rx"`)
    expect(csvCell(null)).toBe('')
    expect(csvCell(true)).toBe('true')
    expect(csvCell(Number.NaN)).toBe('')
  })

  it('header cells are defused too', () => {
    expect(plotCsv({ type: 'bar', x: '=evil', y: 'v', data: [{ '=evil': 'a', v: 1 }] })!.split('\r\n')[0]).toBe("'=evil,v")
  })

  it('has the same rows as plotTable, after transform, without the table cap; maxRows and separator are options', () => {
    const data = Array.from({ length: 1500 }, (_, i) => ({ k: `k${i}`, v: i, extra: 'not shown' }))
    const spec = { type: 'bar', x: 'k', y: 'v', data, transform: [{ filter: { field: 'v', range: [100, 1299] } }] }
    const csv = plotCsv(spec)!
    const lines = csv.trim().split('\r\n')
    const t = plotTable(spec)!
    expect(t.total).toBeGreaterThan(1100)
    expect(lines).toHaveLength(t.total + 1)
    expect(lines[0]).toBe('k,v')
    expect(lines[1]).toBe('k100,100')
    expect(t.rows).toHaveLength(1000)
    expect(lines.slice(1, 1001)).toEqual(t.rows.map(r => r.join(',')))
    expect(plotCsv(spec, { maxRows: 2 })!.trim().split('\r\n')).toHaveLength(3)
    expect(plotCsv({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a;b', v: 1.5 }] }, { separator: ';' })).toBe('k;v\r\n"a;b";1.5\r\n')
  })

  it('is null for an invalid spec', () => {
    expect(plotCsv({ type: 'bar', x: 'nope', y: 'v', data: [{ v: 1 }] })).toBeNull()
  })

  it('toCsv on the plot follows appended rows and throws on an invalid spec', async () => {
    const p = new SuperPlot(host, { type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }] }, { width: 600, height: 400 })
    p.appendRows([{ k: 'b', v: 2 }])
    expect(p.toCsv()).toBe('k,v\r\na,1\r\nb,2\r\n')
    p.setSpec({ type: 'bar', x: 'nope', y: 'v', data: [{ v: 1 }] })
    expect(() => p.toCsv()).toThrow(/invalid/)
  })
})

describe('toolbar', () => {
  const tools = (): string[] => [...host.querySelectorAll<HTMLButtonElement>('.sp-bar button')].map(b => b.dataset.tool!)

  it('is off by default: no change for existing users', () => {
    new SuperPlot(host, bar, { width: 600, height: 400 })
    expect(host.querySelector('.sp-bar')).toBeNull()
  })

  it('true shows real, named buttons; reset only when the chart can zoom', async () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 400, toolbar: true })
    // The toolbar's code is its own chunk: the buttons are there once it is loaded.
    expect(host.querySelector('.sp-root')!.hasAttribute('data-toolbar')).toBe(true)
    await p.ready()
    const barEl = host.querySelector('.sp-bar')!
    expect(barEl.getAttribute('role')).toBe('toolbar')
    expect(barEl.getAttribute('aria-label')).toBe('Chart tools')
    expect(tools()).toEqual(['png', 'svg', 'csv', 'table'])
    const buttons = [...barEl.querySelectorAll('button')]
    expect(buttons.every(b => b.type === 'button')).toBe(true)
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Download PNG', 'Download SVG', 'Download CSV', 'Data table'])
    // The visible text is part of the accessible name (WCAG 2.5.3).
    expect(buttons.every(b => b.getAttribute('aria-label')!.toLowerCase().includes(b.textContent!.toLowerCase()))).toBe(true)
    p.setSpec({ type: 'line', x: 'x', y: 'y', zoom: 'x', data: [{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 2 }] })
    expect(tools()).toEqual(['png', 'svg', 'csv', 'table', 'reset'])
    p.setOptions({ toolbar: ['csv', 'sound', 'csv', 'bogus' as never] })
    expect(tools()).toEqual(['csv', 'sound'])
    p.setOptions({ toolbar: false })
    expect(host.querySelector('.sp-bar')).toBeNull()
  })

  it('downloads use the title as a safe file name', async () => {
    const saved: { name: string; type: string }[] = []
    const create = vi.fn((b: Blob) => { saved.push({ name: '', type: b.type }); return 'blob:x' })
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved[saved.length - 1].name = this.download })
    await new SuperPlot(host, { ...bar, title: 'Q1/Q2: revenue <by> region?' }, { width: 600, height: 400, toolbar: true }).ready()
    host.querySelector<HTMLButtonElement>('[data-tool="csv"]')!.click()
    host.querySelector<HTMLButtonElement>('[data-tool="svg"]')!.click()
    expect(saved).toEqual([{ name: 'Q1-Q2-revenue-by-region.csv', type: 'text/csv;charset=utf-8' }, { name: 'Q1-Q2-revenue-by-region.svg', type: 'image/svg+xml;charset=utf-8' }])
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('file names: no path or control characters, bounded, never empty', () => {
    expect(fileNameOf('../../etc/passwd', 'csv')).toBe('etc-passwd.csv')
    expect(fileNameOf('  ', 'png')).toBe('chart.png')
    expect(fileNameOf(undefined, 'svg')).toBe('chart.svg')
    expect(fileNameOf('營收 2026', 'csv')).toBe('營收-2026.csv')
    expect(fileNameOf('x'.repeat(300), 'csv')).toHaveLength(84)
    expect(fileNameOf('a\u0000b\u001fc', 'csv')).toBe('a-b-c.csv')
  })

  it('table toggles the visible data table', async () => {
    const p = new SuperPlot(host, bar, { width: 600, height: 400, toolbar: true })
    await p.ready()
    const btn = host.querySelector<HTMLButtonElement>('[data-tool="table"]')!
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    btn.click()
    expect(host.querySelector('table.sp-table')!.hasAttribute('data-visible')).toBe(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    btn.click()
    expect(host.querySelector('table.sp-table')).toBeNull()
    // With dataTable: true (screen readers), hiding it keeps it for them.
    p.setOptions({ dataTable: true })
    btn.click()
    expect(host.querySelector('table.sp-table')!.hasAttribute('data-visible')).toBe(true)
    btn.click()
    expect(host.querySelector('table.sp-table')!.hasAttribute('data-visible')).toBe(false)
  })

  it('reset zooms out like a double-click (fires onZoom) and keeps keyboard focus on the button', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const zooms: (ZoomRange | null)[] = []
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', zoom: 'x', data: Array.from({ length: 20 }, (_, i) => ({ x: i, y: i })) }, { width: 600, height: 400, animate: false, toolbar: ['reset'], onZoom: z => zooms.push(z) })
    await p.ready()
    const btn = host.querySelector<HTMLButtonElement>('[data-tool="reset"]')!
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    p.setZoom({ x: [2, 8] })
    vi.useRealTimers()
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(btn.getAttribute('aria-disabled')).toBe('false')
    btn.focus()
    btn.click()
    await new Promise(r => requestAnimationFrame(() => r(null)))
    await new Promise(r => setTimeout(r, 5))
    expect(p.getZoom()).toBeNull()
    expect(zooms).toEqual([null])
    expect(document.activeElement).toBe(btn)
    expect(host.querySelector('[data-tool="reset"]')).toBe(btn)
  })

  it('a click on the toolbar does not start a brush or select a mark', async () => {
    const onSelect = vi.fn()
    const p = new SuperPlot(host, { type: 'bar', x: 'k', y: 'v', brush: 'x', data: [{ k: 'A', v: 1 }, { k: 'B', v: 2 }] }, { width: 600, height: 400, toolbar: ['table'], onSelect })
    await p.ready()
    p.setBrush({ x: ['A'] })
    host.querySelector<HTMLButtonElement>('[data-tool="table"]')!.click()
    expect(p.getBrush()).not.toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('is not shown for an invalid spec; export failures are warnings', async () => {
    const issues: Issue[][] = []
    Object.assign(URL, { createObjectURL: () => { throw new Error('no blobs here') }, revokeObjectURL: vi.fn() })
    const p = new SuperPlot(host, bar, { width: 600, height: 400, toolbar: true, onIssues: i => issues.push(i) })
    await p.ready()
    host.querySelector<HTMLButtonElement>('[data-tool="csv"]')!.click()
    expect(issues.at(-1)!.some(i => i.code === 'export_failed' && i.message.includes('no blobs here'))).toBe(true)
    p.setSpec({ type: 'bar', x: 'nope', y: 'v', data: [{ v: 1 }] })
    expect(host.querySelector('.sp-bar')).toBeNull()
    expect(host.querySelector('.sp-root')!.hasAttribute('data-toolbar')).toBe(false)
  })

  it('a toolbar chunk that cannot be loaded is a warning; the chart stays and the next draw tries again', async () => {
    vi.resetModules()
    let fail = true
    vi.doMock('../../packages/bindings/web/src/toolbar.ts', async importOriginal => {
      if (fail) throw new Error('offline')
      return importOriginal()
    })
    try {
      const { SuperPlot: Fresh } = await import('@supersolutions/super-plot-web')
      const issues: Issue[][] = []
      const p = new Fresh(host, bar, { width: 600, height: 400, toolbar: true, onIssues: i => issues.push(i) })
      await p.ready()
      const failed = issues.at(-1)!.find(i => i.code === 'load_failed')!
      expect(failed.severity).toBe('warning')
      expect(failed.message).toMatch(/^The toolbar could not be loaded: /)
      expect(host.querySelector('svg .sp-data')).not.toBeNull()
      expect(host.querySelector('.sp-bar')).toBeNull()
      fail = false
      p.setOptions({ toolbar: ['csv'] })
      await p.ready()
      expect([...host.querySelectorAll<HTMLButtonElement>('.sp-bar button')].map(b => b.dataset.tool)).toEqual(['csv'])
      p.dispose()
    } finally {
      vi.doUnmock('../../packages/bindings/web/src/toolbar.ts')
      vi.resetModules()
    }
  })

  it('styles: hidden when printing, visible on hover, focus and touch screens, system colours in forced-colors mode', () => {
    expect(CSS).toMatch(/@media print\{\.sp-bar/)
    expect(CSS).toContain('.sp-bar:focus-within{opacity:1}')
    expect(CSS).toContain('@media (hover:none){.sp-bar{opacity:1}}')
    const forced = CSS.slice(CSS.indexOf('@media (forced-colors:active)'))
    expect(forced).toContain('outline:2px solid Highlight')
    expect(forced).toContain('.sp-brush{background:transparent;border:2px solid Highlight}')
    expect(forced).toContain('ButtonText')
    expect(forced).toContain('CanvasText')
    expect(CSS).toContain('@media (prefers-contrast:more)')
  })
})
