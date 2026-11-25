import { describe, expect, it } from 'vitest'
import { compilePlot, defaultHeight, renderToSvg, type Mark, type Scene } from '../../packages/core/src'
import { estimateWidth, wrap } from '../../packages/core/src/util/text'

const scene = (spec: unknown, width: number, height?: number): Scene => {
  const r = compilePlot(spec, { width, height })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const texts = (s: Scene, role?: string): string[] => s.marks.filter((m): m is Extract<Mark, { type: 'text' }> => m.type === 'text' && (role === undefined || m.role === role)).map(m => m.text)
const days = (from: number, n: number): { d: string; v: number }[] => Array.from({ length: n }, (_, i) => ({ d: new Date(from + i * 864e5).toISOString().slice(0, 10), v: (i * 7) % 11 }))

describe('wrap', () => {
  const m = estimateWidth
  it('keeps text that fits on one line, breaks words over lines, and shortens only what is left', () => {
    expect(wrap('Short', 200, 12, m)).toEqual(['Short'])
    expect(wrap('Cost of sales', 60, 12, m)).toEqual(['Cost of', 'sales'])
    const three = wrap('one two three four five six seven eight nine ten', 70, 12, m, 400, 2)
    expect(three).toHaveLength(2)
    expect(three[1].endsWith('…')).toBe(true)
    expect(wrap('Nonprofitorganisationsandcharities', 60, 12, m, 400, 2)[0].endsWith('…')).toBe(true)
  })
  it('breaks Chinese text between characters, with no spaces to use', () => {
    const lines = wrap('各縣市二〇二六年第三季營收與年增率比較', 150, 14, m, 400, 2)
    expect(lines).toHaveLength(2)
    expect(lines.join('').replace('…', '').length).toBeGreaterThan(8)
  })
  it('one line allowed: the old ellipsis', () => {
    expect(wrap('A long long long title', 50, 12, m, 400, 1)[0].endsWith('…')).toBe(true)
  })
})

describe('narrow charts', () => {
  const title = '各縣市二〇二六年第三季營收（新台幣百萬元）與年增率比較'
  it('a title that does not fit takes a second line, then the plot starts lower; one that fits is unchanged', () => {
    const data = [{ k: 'a', v: 1 }]
    const s = scene({ type: 'bar', title, x: 'k', y: 'v', data }, 360)
    expect(texts(s, 'title').length).toBe(2)
    expect(s.title).toBe(title)
    const short = scene({ type: 'bar', title: 'Revenue', x: 'k', y: 'v', data }, 360)
    expect(texts(short, 'title')).toEqual(['Revenue'])
    expect(s.axes!.plot.y).toBeGreaterThan(short.axes!.plot.y)
  })
  it('category labels wrap before they are shortened', () => {
    const spec = { type: 'bar', x: 'k', y: 'v', data: ['Cost of sales', 'Gross profit', 'Sales and marketing', 'Net income'].map((k, i) => ({ k, v: i + 1 })) }
    const labels = texts(scene(spec, 390), 'axis-label').filter(t => /^[A-Za-z]/.test(t))
    expect(labels).toContain('Sales and')
    expect(labels).toContain('marketing')
    expect(labels).toContain('Cost of sales')
    expect(labels.every(t => !t.endsWith('…'))).toBe(true)
  })
  const annotated = { type: 'line', x: 'k', y: 'v', annotations: [{ axis: 'y', value: 4, label: 'Target' }, { axis: 'x', value: 'Q2', label: 'Launch' }], data: [{ k: 'Q1', v: 5 }, { k: 'Q2', v: 3 }, { k: 'Q3', v: 4 }] }
  it('annotations become numbers under 420 px, with a key under the plot', () => {
    const s = scene(annotated, 390, 300)
    const ann = texts(s, 'annotation')
    expect(ann).toEqual(['1', '2'])
    expect(texts(s, 'label')).toEqual(['1  Target', '2  Launch'])
    const keyY = s.marks.find(m => m.type === 'text' && m.text === '1  Target')!
    expect((keyY as { y: number }).y).toBeGreaterThan(s.axes!.plot.y + s.axes!.plot.h)
  })
  it('keeps the labels beside the lines at 420 px and wider, on a short chart, and past four annotations', () => {
    expect(texts(scene(annotated, 640), 'annotation')).toEqual(['Target', 'Launch'])
    expect(texts(scene(annotated, 390, 190), 'annotation')).toEqual(['Target', 'Launch'])
    const five = { ...annotated, annotations: [1, 2, 3, 4, 5].map(i => ({ axis: 'y', value: 3 + i / 4, label: `L${i}` })) }
    expect(texts(scene(five, 390, 300), 'annotation')).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
  })
})

describe('calendar on a narrow chart', () => {
  const year = { type: 'calendar', x: 'd', value: 'v', data: days(Date.UTC(2026, 0, 1), 365) }
  const cells = (s: Scene): Extract<Mark, { type: 'rect' }>[] => s.marks.filter((m): m is Extract<Mark, { type: 'rect' }> => m.type === 'rect' && m.role === 'data')
  it('is cut into two rows of weeks so the cells stay readable, in a taller box', () => {
    const h = defaultHeight('calendar', 390, year)
    expect(h).toBeGreaterThan(defaultHeight('calendar', 390))
    const s = scene(year, 390, h)
    expect(cells(s)[0].w).toBeGreaterThanOrEqual(8)
    expect(texts(s, 'title')).toEqual(['2026'])
    expect(s.marks.filter(m => m.type === 'text' && m.role === 'legend').length).toBeGreaterThan(2)
    expect(s.height).toBe(h)
  })
  it('keeps the one-row layout, the legend beside it and the old default height where the cells fit', () => {
    expect(defaultHeight('calendar', 1000, year)).toBe(defaultHeight('calendar', 1000))
    const s = scene(year, 1000)
    expect(texts(s, 'title')).toEqual(['2026'])
    expect(new Set(cells(s).map(c => c.y)).size).toBe(7)
  })
  it('a few months stay in one row on a phone', () => {
    const few = { type: 'calendar', x: 'd', value: 'v', data: days(Date.UTC(2026, 2, 1), 60) }
    expect(defaultHeight('calendar', 390, few)).toBe(defaultHeight('calendar', 390))
    expect(new Set(cells(scene(few, 390)).map(c => c.y)).size).toBe(7)
  })
  it('every day is still a cell with its own rows reference', () => {
    const s = scene(year, 390, defaultHeight('calendar', 390, year))
    expect(cells(s)).toHaveLength(365)
  })
})

describe('the placeholder and the svg stay well formed on a narrow chart', () => {
  it('renders', () => {
    expect(renderToSvg({ type: 'calendar', x: 'd', value: 'v', data: days(Date.UTC(2026, 0, 1), 365) }, { width: 320 })).toMatch(/^<svg /)
  })
})
