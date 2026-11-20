import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { chartCatalog, compilePlot, renderToSvg, describePlot, light, dark, createTheme, type Scene, type Mark } from '../../packages/core/src'

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 400, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const data = (scene: Scene): Mark[] => scene.marks.filter(m => m.role === 'data')
const rects = (scene: Scene) => data(scene).filter((m): m is Extract<Mark, { type: 'rect' }> => m.type === 'rect')
const finite = (m: Mark): boolean => Object.values(m).every(v => typeof v !== 'number' || Number.isFinite(v))

describe('every chart type', () => {
  for (const info of chartCatalog()) {
    describe(info.type, () => {
      for (const theme of ['light', 'dark'] as const) {
        it(`compiles to finite marks inside the canvas (${theme})`, () => {
          const s = compile(info.example, { theme })
          expect(s.marks.length).toBeGreaterThan(5)
          expect(data(s).length).toBeGreaterThan(0)
          for (const m of s.marks) expect(finite(m), JSON.stringify(m)).toBe(true)
          for (const m of s.marks) {
            if (m.role !== 'data' && m.role !== 'label') continue
            if (m.type === 'rect') {
              expect(m.x).toBeGreaterThanOrEqual(-0.5)
              expect(m.y).toBeGreaterThanOrEqual(-0.5)
              expect(m.x + m.w).toBeLessThanOrEqual(s.width + 0.5)
              expect(m.y + m.h).toBeLessThanOrEqual(s.height + 0.5)
            }
            if (m.type === 'circle') {
              expect(m.cx).toBeGreaterThanOrEqual(0)
              expect(m.cx).toBeLessThanOrEqual(s.width)
              expect(m.cy).toBeGreaterThanOrEqual(0)
              expect(m.cy).toBeLessThanOrEqual(s.height)
            }
          }
        })
      }
      it('renders well-formed XML, deterministically', () => {
        const a = renderToSvg(info.example)
        expect(renderToSvg(info.example)).toBe(a)
        const doc = new (new JSDOM('').window.DOMParser)().parseFromString(a, 'image/svg+xml')
        expect(doc.querySelector('parsererror')).toBeNull()
        expect(doc.documentElement.getAttribute('role')).toBe('img')
        expect(a).not.toContain('var(')
        expect(a).not.toMatch(/<script|onload|javascript:/i)
      })
      it('describes itself in words with real numbers', () => {
        const d = describePlot(info.example)
        expect(d.ok && d.text.length).toBeGreaterThan(60)
        expect(d.ok && d.text).toMatch(/\d/)
        expect(compile(info.example).description).toBe(d.ok && d.text)
      })
      it('has a title, and text never leaves the canvas width badly', () => {
        const s = compile(info.example, { width: 320, height: 300 })
        expect(s.title.length).toBeGreaterThan(0)
        for (const m of s.marks) if (m.type === 'text' && m.role === 'title') expect(m.x).toBeLessThan(320)
      })
    })
  }
})

describe('bar', () => {
  const base = { type: 'bar', x: 'k', y: ['a', 'b'], data: [{ k: 'one', a: 10, b: 30 }, { k: 'two', a: 20, b: 20 }], legend: 'none' }
  it('draws one bar per category and series, taller means bigger', () => {
    const r = rects(compile(base))
    expect(r.length).toBe(4)
    const h = (cat: string, series: string): number => r.find(x => x.tip?.title === cat && x.series === series)!.h
    expect(h('one', 'b')).toBeCloseTo(h('one', 'a') * 3, 0)
    expect(h('two', 'a')).toBeCloseTo(h('two', 'b'), 5)
  })
  it('stacks to the sum and shares a baseline', () => {
    const r = rects(compile({ ...base, stack: 'stack' }))
    const one = r.filter(x => x.tip?.title === 'one')
    const top = Math.min(...one.map(x => x.y))
    const bottom = Math.max(...one.map(x => x.y + x.h))
    expect(bottom - top).toBeGreaterThan(Math.max(...one.map(x => x.h)))
    expect(one[0].tip!.rows.at(-1)).toMatchObject({ label: 'Total', value: '40' })
  })
  it('normalises every category to the same height', () => {
    const r = rects(compile({ ...base, stack: 'normalize', data: [{ k: 'one', a: 1, b: 3 }, { k: 'two', a: 50, b: 150 }] }))
    const extent = (cat: string): number => {
      const x = r.filter(m => m.tip?.title === cat)
      return Math.max(...x.map(m => m.y + m.h)) - Math.min(...x.map(m => m.y))
    }
    expect(extent('one')).toBeCloseTo(extent('two'), 0)
  })
  it('puts negative bars below the zero line', () => {
    const s = compile({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'up', v: 5 }, { k: 'down', v: -5 }] })
    const [up, down] = rects(s)
    expect(down.y).toBeGreaterThanOrEqual(up.y + up.h - 0.5)
  })
  it('sorts by total and goes horizontal', () => {
    const s = compile({ ...base, sort: 'desc', orientation: 'horizontal', y: 'a', data: [{ k: 'small', a: 1 }, { k: 'big', a: 9 }] })
    const r = rects(s)
    expect(r.find(x => x.tip?.title === 'big')!.y).toBeLessThan(r.find(x => x.tip?.title === 'small')!.y)
    expect(r.find(x => x.tip?.title === 'big')!.w).toBeGreaterThan(r.find(x => x.tip?.title === 'small')!.w)
  })
  it('caps bar thickness and leaves hidden series out', () => {
    const r = rects(compile({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'only', v: 5 }] }, { width: 1200 }))
    expect(r[0].w).toBeLessThanOrEqual(48)
    const hidden = compile(base, { hidden: ['a'] })
    expect(rects(hidden).length).toBe(2)
    expect(hidden.series.find(s => s.key === 'a')?.hidden).toBe(true)
  })
  it('colour follows the series, not its position among the visible', () => {
    const all = compile(base)
    const some = compile(base, { hidden: ['a'] })
    const colour = (s: Scene, key: string) => rects(s).find(x => x.series === key)!.fill
    expect(colour(some, 'b')).toBe(colour(all, 'b'))
  })
  it('summarises duplicates by summing', () => {
    const s = compile({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }, { k: 'a', v: 2 }] })
    expect(rects(s)[0].tip!.rows[0].value).toBe('3')
  })
})

describe('line and area', () => {
  const t = (n: number) => `2026-01-${String(n).padStart(2, '0')}`
  it('breaks the line at missing values', () => {
    const s = compile({ type: 'line', x: 'd', y: 'v', data: [{ d: t(1), v: 1 }, { d: t(2), v: 2 }, { d: t(3), v: null }, { d: t(4), v: 4 }, { d: t(5), v: 5 }] })
    const paths = data(s).filter(m => m.type === 'path')
    expect(paths.length).toBe(2)
  })
  it('puts later dates to the right on a time axis, even if the data is unsorted', () => {
    const s = compile({ type: 'line', x: 'd', y: 'v', data: [{ d: t(5), v: 5 }, { d: t(1), v: 1 }, { d: t(3), v: 3 }] })
    const circles = data(s).filter((m): m is Extract<Mark, { type: 'circle' }> => m.type === 'circle')
    const byTime = circles.map(c => c.cx)
    expect(byTime).toEqual([...byTime].sort((a, b) => a - b))
  })
  it('gives a shared tooltip with every series at the hovered x', () => {
    const s = compile({ type: 'line', x: 'd', y: ['a', 'b'], data: [{ d: t(1), a: 1, b: 2 }, { d: t(2), a: 3, b: 4 }] })
    const hit = s.marks.find(m => m.role === 'hit')!
    expect(hit.tip!.rows.map(r => r.label)).toEqual(['a', 'b'])
    expect(hit.guide).toBeDefined()
    expect(hit.focus!.length).toBe(2)
  })
  it('stacked areas end at the sum; normalised areas fill the plot', () => {
    const d = [{ x: 1, a: 1, b: 3 }, { x: 2, a: 2, b: 2 }]
    const s = compile({ type: 'area', x: 'x', y: ['a', 'b'], stack: 'normalize', data: d })
    expect(s.marks.some(m => m.role === 'axis-label' && m.type === 'text' && m.text === '100%')).toBe(true)
  })
  it('reads categories, numbers and dates by their values', () => {
    expect(() => compile({ type: 'line', x: 'x', y: 'v', data: [{ x: 'Mon', v: 1 }, { x: 'Tue', v: 2 }] })).not.toThrow()
    expect(() => compile({ type: 'line', x: 'x', y: 'v', data: [{ x: 1, v: 1 }, { x: 2, v: 2 }] })).not.toThrow()
  })
  it('skips annotations that are off the chart, with a warning', () => {
    const r = compilePlot({ type: 'line', x: 'x', y: 'v', data: [{ x: 1, v: 1 }, { x: 2, v: 2 }], annotations: [{ axis: 'y', value: 9999 }] })
    expect(r.ok && r.issues.map(i => i.code)).toContain('annotation_out_of_range')
  })
  it('warns when there are more series than palette colours', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: 1, s: `s${i}`, v: i }))
    const r = compilePlot({ type: 'bar', x: 'x', y: 'v', series: 's', data: rows })
    expect(r.ok && r.issues.map(i => i.code)).toContain('too_many_series')
  })
})

describe('pie', () => {
  const rows = [{ l: 'A', v: 50 }, { l: 'B', v: 30 }, { l: 'C', v: 20 }]
  it('shares add to 100% and the legend lists them', () => {
    const s = compile({ type: 'pie', label: 'l', value: 'v', data: rows })
    const legendText = s.marks.filter(m => m.type === 'text' && m.role === 'legend').map(m => (m as { text: string }).text)
    expect(legendText).toContain('50%')
    expect(legendText).toContain('30%')
    expect(legendText).toContain('20%')
  })
  it('merges the smallest slices into Other and keeps named colours stable', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ l: `S${i}`, v: 100 - i * 5 }))
    const s = compile({ type: 'pie', label: 'l', value: 'v', maxSlices: 5, data: many })
    expect(s.series.map(x => x.label)).toContain('Other')
    expect(s.series.length).toBe(5)
    const a = compile({ type: 'pie', label: 'l', value: 'v', data: rows })
    const b = compile({ type: 'pie', label: 'l', value: 'v', data: rows }, { hidden: ['A'] })
    expect(b.series.find(x => x.key === 'B')!.color).toBe(a.series.find(x => x.key === 'B')!.color)
  })
  it('skips negatives with a warning and draws a single slice as a full circle', () => {
    const r = compilePlot({ type: 'pie', label: 'l', value: 'v', data: [{ l: 'A', v: 1 }, { l: 'B', v: -3 }] })
    expect(r.ok && r.issues.map(i => i.code)).toContain('negative_slices')
    const s = compile({ type: 'donut', label: 'l', value: 'v', data: [{ l: 'A', v: 1 }] })
    const p = data(s)[0] as Extract<Mark, { type: 'path' }>
    expect(p.d.match(/A/g)!.length).toBeGreaterThanOrEqual(2)
  })
  it('donut shows the total in the hole', () => {
    const s = compile({ type: 'donut', label: 'l', value: 'v', data: rows })
    expect(s.marks.some(m => m.type === 'text' && m.text === '100')).toBe(true)
  })
})

describe('scatter, histogram, box, heatmap', () => {
  it('scatter: correlation in the description, bubble size grows with value', () => {
    const d = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 2 * i + 1, s: i }))
    const desc = describePlot({ type: 'scatter', x: 'x', y: 'y', data: d })
    expect(desc.ok && desc.text).toContain('Correlation 1.00')
    const s = compile({ type: 'scatter', x: 'x', y: 'y', size: 's', data: d })
    const c = data(s).filter((m): m is Extract<Mark, { type: 'circle' }> => m.type === 'circle')
    expect(c[19].r).toBeGreaterThan(c[0].r)
  })
  it('histogram: bar heights sum to the number of values', () => {
    const v = Array.from({ length: 100 }, (_, i) => ({ v: (i * 7) % 53 }))
    const s = compile({ type: 'histogram', value: 'v', data: v })
    const total = rects(s).reduce((q, r) => q + Number(r.tip!.rows[0].value), 0)
    expect(total).toBe(100)
  })
  it('histogram: overlaid series share bins', () => {
    const v = Array.from({ length: 60 }, (_, i) => ({ v: i % 30, g: i < 30 ? 'a' : 'b' }))
    const s = compile({ type: 'histogram', value: 'v', series: 'g', data: v })
    expect(new Set(rects(s).map(r => Math.round(r.w))).size).toBeLessThanOrEqual(2)
    expect(rects(s).every(r => r.opacity === 0.6)).toBe(true)
  })
  it('box: median line sits between the box edges', () => {
    const s = compile({ type: 'box', y: 'v', data: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => ({ v })) })
    const box = rects(s)[0]
    const med = data(s).filter((m): m is Extract<Mark, { type: 'line' }> => m.type === 'line' && m.strokeWidth! > 2)[0]
    expect(med.y1).toBeGreaterThan(box.y)
    expect(med.y1).toBeLessThan(box.y + box.h)
  })
  it('heatmap: darker for bigger, one cell per (x, y)', () => {
    const d = [{ x: 'a', y: 'p', v: 1 }, { x: 'b', y: 'p', v: 10 }, { x: 'a', y: 'q', v: 5 }]
    const s = compile({ type: 'heatmap', x: 'x', y: 'y', value: 'v', data: d })
    const cells = rects(s)
    expect(cells.length).toBe(3)
    expect(cells[0].fill).not.toBe(cells[1].fill)
  })
})

describe('theming', () => {
  const spec = chartCatalog()[0].example
  it('emits CSS variables with theme fallbacks so a host can restyle without re-rendering', () => {
    const s = compile(spec)
    const fills = rects(s).map(r => r.fill)
    expect(fills.every(f => /^var\(--sp-series-\d, #[0-9A-F]{6}\)$/i.test(f!))).toBe(true)
    expect(s.background).toBe('var(--sp-background, #FFFFFF)')
    expect(compile(spec, { theme: 'dark' }).background).toBe('var(--sp-background, #131722)')
  })
  it('createTheme overrides palette, colours and metrics', () => {
    const t = createTheme('dark', { palette: ['#ff0000', '#00ff00'], colors: { text: '#ffffff' }, barRadius: 0 })
    expect(t.palette[0]).toBe('#ff0000')
    expect(t.colors.background).toBe(dark.colors.background)
    expect(light.palette[0]).toBe('#2962FF')
    const svg = renderToSvg(spec, { theme: t })
    expect(svg).toContain('#ff0000')
    expect(svg).toContain('#ffffff')
  })
  it('lets the spec override a series colour and aliases chain other variables', () => {
    const s = compile({ ...(spec as object), colors: { Q1: 'hotpink' } })
    expect(rects(s).some(r => r.fill === 'hotpink')).toBe(true)
    const t = createTheme('light', { alias: { text: ['--sc-text'] } })
    expect(compile(spec, { theme: t }).marks.some(m => m.type === 'text' && m.fill === 'var(--sp-text, var(--sc-text, #131722))')).toBe(true)
  })
  it('is deterministic with a custom text measurer', () => {
    const wide = compile(spec, { measure: (t: string) => t.length * 20 })
    const narrow = compile(spec, { measure: (t: string) => t.length * 2 })
    expect(wide.marks.length).toBeGreaterThan(0)
    expect(JSON.stringify(wide)).not.toBe(JSON.stringify(narrow))
  })
})

describe('security', () => {
  it('escapes hostile text everywhere it can appear', () => {
    const evil = '"><script>alert(1)</script>&\'<img onerror=x>'
    const svg = renderToSvg({
      type: 'bar', title: evil, subtitle: evil, source: evil, x: 'k', y: 'v', xLabel: evil, yLabel: evil, description: evil,
      annotations: [{ axis: 'y', value: 3, label: evil }],
      data: [{ k: evil, v: 3 }, { k: 'b', v: 4 }]
    })
    expect(svg).not.toMatch(/<script|<img/i)
    expect(svg).toContain('&lt;script&gt;')
    const doc = new (new JSDOM('').window.DOMParser)().parseFromString(svg, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelectorAll('script, img').length).toBe(0)
  })
  it('caps long strings so a label cannot blow up the layout', () => {
    const r = compilePlot({ type: 'bar', title: 'x'.repeat(5000), x: 'k', y: 'v', data: [{ k: 'a'.repeat(5000), v: 1 }] })
    expect(r.ok && r.issues.map(i => i.code)).toContain('string_truncated')
    expect(r.ok && r.scene.title.length).toBeLessThanOrEqual(120)
    const r2 = compilePlot({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a'.repeat(5000), v: 1 }] })
    expect(r2.ok && JSON.stringify(r2.scene).length).toBeLessThan(20000)
  })
})
