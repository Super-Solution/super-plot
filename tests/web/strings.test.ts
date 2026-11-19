// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, createRef, act } from 'react'
import { createRoot } from 'react-dom/client'
import { SuperPlot, type RenderEvent } from '@supersolutions/super-plot-web'
import { defineSuperPlot } from '@supersolutions/super-plot-web/element'
import { SuperPlot as ReactPlot } from '@supersolutions/super-plot-react'
import { chartCatalog, DEFAULT_STRINGS, renderToSvg, type Scene } from '@supersolutions/super-plot-core'
import { stub2d } from './stub2d'

const realGetContext = HTMLCanvasElement.prototype.getContext
const rect = { width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} } as DOMRect
let host: HTMLDivElement
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  host = document.createElement('div')
  document.body.appendChild(host)
  host.getBoundingClientRect = () => rect
})
afterEach(() => {
  document.body.innerHTML = ''
  HTMLCanvasElement.prototype.getContext = realGetContext
  vi.useRealTimers()
})

const ex = (type: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === type)!.example)
const raf = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()))
const said = (): string => host.querySelector('.sp-live')?.textContent ?? ''
const pts = Array.from({ length: 21 }, (_, i) => ({ x: i, y: i * 2 }))
const de = {
  toolbar: 'Diagrammwerkzeuge', toolCsv: 'Tabelle (CSV)', toolCsvName: 'CSV herunterladen', toolTable: 'Tabelle', toolTableName: 'Datentabelle',
  canvasKeys: 'Mit den Pfeiltasten von Marke zu Marke.', tableFirstRows: '{caption}: die ersten {n} von {total} Zeilen',
  newPoint: '{n} neuer Punkt', newPoints: '{n} neue Punkte', newsLatest: '{count}; zuletzt {mark}.',
  drillShowing: 'Zeige {path}.', drillShowingAll: 'Zeige alles.', breadcrumbRoot: 'Alle', breadcrumbUp: 'Zurück zu {name}',
  navOverview: 'Übersicht über {field}', navWindow: 'Sichtbarer Bereich von {field}', navStart: 'Anfang ({field})', navEnd: 'Ende ({field})', navRange: '{from} bis {to}'
}

describe('the web binding\'s own text comes from the strings option', () => {
  it('toolbar names and the table caption; a change reaches the same buttons', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ x: i, y: i }))
    const p = new SuperPlot(host, { type: 'scatter', title: 'Punkte', x: 'x', y: 'y', data: rows }, { width: 600, height: 400, animate: false, toolbar: ['csv', 'table'], dataTable: true, strings: de })
    await p.ready()
    const bar = host.querySelector<HTMLElement>('.sp-bar')!
    expect(bar.getAttribute('aria-label')).toBe('Diagrammwerkzeuge')
    const csv = bar.querySelector<HTMLButtonElement>('[data-tool="csv"]')!
    expect([csv.textContent, csv.getAttribute('aria-label'), csv.title]).toEqual(['Tabelle (CSV)', 'CSV herunterladen', 'CSV herunterladen'])
    expect(host.querySelector('caption')!.textContent).toBe('Punkte: die ersten 1000 von 1001 Zeilen')
    csv.focus()
    p.setOptions({ strings: { toolCsvName: 'Télécharger le CSV', tableFirstRows: '{caption} : {n} lignes sur {total}' } })
    expect(host.querySelector('[data-tool="csv"]')).toBe(csv)
    expect(document.activeElement).toBe(csv)
    expect(csv.getAttribute('aria-label')).toBe('Télécharger le CSV')
    // Keys left out are English again.
    expect(csv.textContent).toBe('CSV')
    expect(host.querySelector('.sp-bar')!.getAttribute('aria-label')).toBe(DEFAULT_STRINGS.toolbar)
    expect(host.querySelector('caption')!.textContent).toBe('Punkte : 1000 lignes sur 1001')
  })

  it('a bad override warns once (from the compile) and the binding keeps English for it', async () => {
    const issues: string[] = []
    await new SuperPlot(host, ex('line'), { width: 600, height: 400, animate: false, toolbar: ['png'], strings: { toolPngName: 5, toolPgn: 'x' } as never, onIssues: i => issues.push(...i.map(x => x.code)) }).ready()
    expect(issues).toEqual(['bad_string', 'unknown_string'])
    expect(host.querySelector('[data-tool="png"]')!.getAttribute('aria-label')).toBe('Download PNG')
  })

  it('the canvas keyboard hint', () => {
    HTMLCanvasElement.prototype.getContext = (() => stub2d()) as unknown as typeof HTMLCanvasElement.prototype.getContext
    const p = new SuperPlot(host, ex('bar'), { width: 600, height: 400, animate: false, renderer: 'canvas', strings: de })
    const cv = host.querySelector('canvas[tabindex="0"]')!
    expect(cv.getAttribute('aria-label')).toMatch(/ Mit den Pfeiltasten von Marke zu Marke\.$/)
    p.setOptions({ strings: {} })
    expect(cv.getAttribute('aria-label')).toMatch(/ Use the arrow keys to move between marks\.$/)
  })

  it('live-data and drill-down sentences, and the breadcrumb', async () => {
    const p = new SuperPlot(host, { type: 'line', x: 'x', y: 'y', data: pts.slice(0, 5) }, { width: 600, height: 400, animate: false, announce: true, strings: de })
    p.appendRows([{ x: 5, y: 10 }])
    await raf()
    expect(said()).toMatch(/^1 neuer Punkt; zuletzt 5: y 10\.$/)
    p.dispose()
    const q = new SuperPlot(host, ex('sunburst'), { width: 640, height: 420, animate: false, strings: de })
    const i = q.getScene()!.marks.findIndex(m => m.role === 'data' && (m.datum as { path: string[] }).path.join('/') === 'Asia')
    host.querySelector(`[data-i="${i}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(said()).toBe('Zeige Asia.')
    const crumb = host.querySelector<HTMLElement>('.sp-label[role="button"]')!
    expect(crumb.getAttribute('aria-label')).toBe('Zurück zu Alle')
    expect(host.querySelector('svg')!.innerHTML).toContain('>Alle</text>')
    crumb.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(said()).toBe('Zeige alles.')
    // Static SVG from core uses the same keys.
    expect(renderToSvg({ ...ex('sunburst'), focus: ['Asia'] }, { width: 640, height: 420, strings: { breadcrumbRoot: 'Tout' } })).toContain('>Tout</text>')
  })

  it('navigator labels, and its dates in the timeZone option', async () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), v: i }))
    const p = new SuperPlot(host, { type: 'line', x: 'd', y: 'v', data: days, zoom: 'x' }, { width: 600, height: 400, animate: false, navigator: true, locale: 'en-US', strings: de })
    await p.ready()
    const nav = host.querySelector<HTMLElement>('.sp-nav')!
    const [win, start, end] = [...nav.querySelectorAll<HTMLElement>('[role="slider"]')]
    expect(nav.getAttribute('aria-label')).toBe('Übersicht über d')
    expect([win, start, end].map(s => s.getAttribute('aria-label'))).toEqual(['Sichtbarer Bereich von d', 'Anfang (d)', 'Ende (d)'])
    expect(win.getAttribute('aria-valuetext')).toBe('Jan 1, 2026 bis Jan 30, 2026')
    p.setOptions({ timeZone: 'America/Los_Angeles' })
    expect(start.getAttribute('aria-valuetext')).toBe('Dec 31, 2025')
    p.setOptions({ timeZone: 'Not/AZone' })
    expect(start.getAttribute('aria-valuetext')).toBe('Jan 1, 2026')
  })
})

const ticks = (s: Scene | null): string => (s?.marks ?? []).filter(m => m.type === 'text' && m.role === 'axis-label').map(m => (m as { text: string }).text).join('|')

describe('React re-renders when timeZone, strings or locale change', () => {
  it('each one alone redraws the chart', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const div = document.createElement('div')
    document.body.appendChild(div)
    const root = createRoot(div)
    const ref = createRef<SuperPlot | null>()
    const renders: RenderEvent[] = []
    const hours = Array.from({ length: 6 }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 5, i * 4)).toISOString(), v: 1000 + i * 1500 }))
    const pie = { type: 'pie', label: 'k', value: 'v', maxSlices: 2, data: [{ k: 'a', v: 5 }, { k: 'b', v: 3 }, { k: 'c', v: 1 }, { k: 'd', v: 1 }] }
    const money = { type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1234.5 }], format: 'fixed:1' }
    const draw = (props: Record<string, unknown>, spec: unknown = { type: 'line', x: 't', y: 'v', data: hours }): Promise<void> =>
      act(async () => { root.render(createElement(ReactPlot, { ref, spec, width: 600, height: 400, animate: false, onRender: (e: RenderEvent) => renders.push(e), ...props })) })
    await draw({})
    const utc = ticks(ref.current!.getScene())
    await draw({ timeZone: 'Asia/Tokyo' })
    expect(ticks(ref.current!.getScene())).not.toBe(utc)
    // An inline strings object with the same content does not redraw; new content does.
    await draw({}, pie)
    await draw({ strings: { other: 'Andere' } }, pie)
    const n = renders.length
    expect(div.querySelector('svg')!.innerHTML).toContain('Andere')
    await draw({ strings: { other: 'Andere' } }, pie)
    expect(renders).toHaveLength(n)
    await draw({ strings: { other: 'Autres' } }, pie)
    expect(div.querySelector('svg')!.innerHTML).toContain('Autres')
    await draw({ locale: 'en-US' }, money)
    const en = div.querySelector('svg')!.innerHTML
    expect(ticks(ref.current!.getScene())).toContain('1,000.0')
    await draw({ locale: 'de-DE' }, money)
    expect(ticks(ref.current!.getScene())).toContain('1.000,0')
    expect(div.querySelector('svg')!.innerHTML).not.toBe(en)
    await act(async () => { root.unmount() })
  })
})

describe('<super-plot>: locale, time-zone and strings', () => {
  it('attributes and properties, attributes winning; removing one falls back', () => {
    defineSuperPlot()
    const el = document.createElement('super-plot') as HTMLElement & { spec: unknown; locale?: string; timeZone?: string; strings?: Record<string, string>; instance: SuperPlot | null }
    el.getBoundingClientRect = () => rect
    el.setAttribute('time-zone', 'Asia/Tokyo')
    el.setAttribute('strings', '{"other":"Andere"}')
    document.body.appendChild(el)
    const days = Array.from({ length: 6 }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 5, i * 4)).toISOString(), v: i }))
    el.spec = { type: 'line', x: 't', y: 'v', data: days }
    const tokyo = ticks(el.instance!.getScene())
    expect(el.timeZone).toBe('Asia/Tokyo')
    el.removeAttribute('time-zone')
    const utc = ticks(el.instance!.getScene())
    expect(utc).not.toBe(tokyo)
    el.timeZone = 'Asia/Tokyo'
    expect(ticks(el.instance!.getScene())).toBe(tokyo)
    el.timeZone = undefined
    expect(ticks(el.instance!.getScene())).toBe(utc)

    el.spec = { type: 'pie', label: 'k', value: 'v', maxSlices: 2, data: [{ k: 'a', v: 5 }, { k: 'b', v: 3 }, { k: 'c', v: 1 }, { k: 'd', v: 1 }] }
    expect(el.querySelector('svg')!.innerHTML).toContain('Andere')
    // The property is under the attribute until the attribute goes.
    el.strings = { other: 'Autres' }
    expect(el.querySelector('svg')!.innerHTML).toContain('Andere')
    el.removeAttribute('strings')
    expect(el.querySelector('svg')!.innerHTML).toContain('Autres')
    el.strings = undefined
    expect(el.querySelector('svg')!.innerHTML).toContain('>Other<')

    el.spec = { type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1234.5 }], format: 'fixed:1' }
    expect(ticks(el.instance!.getScene())).toContain('1,000.0')
    el.locale = 'de-DE'
    expect(ticks(el.instance!.getScene())).toContain('1.000,0')
    el.setAttribute('locale', 'en-US')
    expect(el.locale).toBe('en-US')
    expect(ticks(el.instance!.getScene())).toContain('1,000.0')
  })
})
