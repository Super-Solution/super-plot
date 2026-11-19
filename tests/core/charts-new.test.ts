import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, validatePlot, renderToSvg, type Scene, type Mark } from '../../packages/core/src'
import { squarify } from '../../packages/core/src/charts/treemap'

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => i.code)
type RectM = Extract<Mark, { type: 'rect' }>
const rects = (s: Scene): RectM[] => s.marks.filter((m): m is RectM => m.type === 'rect' && m.role === 'data')

describe('radar', () => {
  const data = ['a', 'b', 'c', 'd', 'e'].map((m, i) => ({ m, A: i + 1, B: 5 - i }))
  const spec = { type: 'radar', x: 'm', y: ['A', 'B'], data, max: 5 }
  it('draws one dot per spoke and series, and one outline per series', () => {
    const s = compile(spec)
    expect(s.marks.filter(m => m.type === 'circle' && m.role === 'data')).toHaveLength(10)
    expect(s.marks.filter(m => m.type === 'path' && m.role === 'data' && (m as { fill?: string }).fill === 'none')).toHaveLength(2)
  })
  it('puts each value at a distance from the centre proportional to it', () => {
    const s = compile({ ...spec, y: 'A', legend: 'none' })
    const spoke = s.marks.find((m): m is Extract<Mark, { type: 'line' }> => m.type === 'line' && m.role === 'grid')!
    const [cx, cy] = [spoke.x1, spoke.y1]
    const R = Math.hypot(spoke.x2 - cx, spoke.y2 - cy) // outer ring = max (5)
    const dots = s.marks.filter((m): m is Extract<Mark, { type: 'circle' }> => m.type === 'circle')
    dots.forEach((d, i) => expect(Math.hypot(d.cx - cx, d.cy - cy)).toBeCloseTo((R * (i + 1)) / 5, 0))
  })
  it('refuses too few or too many spokes with a code', () => {
    expect(codes({ type: 'radar', x: 'm', y: 'A', data: data.slice(0, 2) })).toContain('too_few_axes')
    const many = Array.from({ length: 20 }, (_, i) => ({ m: `s${i}`, A: i }))
    expect(codes({ type: 'radar', x: 'm', y: 'A', data: many })).toContain('too_many_axes')
  })
  it('hides a series with the legend toggle and keeps colours', () => {
    const all = compile(spec)
    const hid = compile(spec, { hidden: ['A'] })
    expect(hid.marks.filter(m => m.type === 'circle')).toHaveLength(5)
    expect(all.series.find(x => x.key === 'B')!.color).toBe(hid.series.find(x => x.key === 'B')!.color)
  })
  it('describes the highest and lowest spoke', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toMatch(/highest e \(5\), lowest a \(1\)/)
  })
})

describe('treemap', () => {
  it('squarify fills the box exactly with areas proportional to value and no overlap', () => {
    const items = [50, 30, 10, 6, 4].map((value, i) => ({ value, i }))
    const box = { x: 10, y: 20, w: 300, h: 200 }
    const out = squarify(items, box)
    expect(out).toHaveLength(5)
    const area = (b: { w: number; h: number }): number => b.w * b.h
    expect(out.reduce((q, o) => q + area(o.box), 0)).toBeCloseTo(300 * 200, 3)
    for (const o of out) expect(area(o.box) / (300 * 200)).toBeCloseTo(o.item.value / 100, 3)
    for (const a of out) for (const b of out) {
      if (a === b) continue
      const ox = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x)
      const oy = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y)
      expect(ox > 1e-6 && oy > 1e-6).toBe(false)
    }
    for (const o of out) {
      expect(o.box.x).toBeGreaterThanOrEqual(10 - 1e-6)
      expect(o.box.x + o.box.w).toBeLessThanOrEqual(310 + 1e-6)
      expect(o.box.y + o.box.h).toBeLessThanOrEqual(220 + 1e-6)
    }
  })
  it('skips zero and negative values and says so', () => {
    const spec = { type: 'treemap', label: 'k', value: 'v', data: [{ k: 'a', v: 5 }, { k: 'b', v: 0 }, { k: 'c', v: -2 }, { k: 'd', v: 3 }] }
    expect(codes(spec)).toContain('negative_slices')
    expect(rects(compile(spec))).toHaveLength(2)
  })
  it('colours by group, and a hidden group frees its space', () => {
    const spec = { type: 'treemap', label: 'k', value: 'v', group: 'g', data: [{ k: 'a', g: 'X', v: 5 }, { k: 'b', g: 'X', v: 3 }, { k: 'c', g: 'Y', v: 4 }] }
    expect(compile(spec).series.map(s => s.key)).toEqual(['X', 'Y'])
    const hid = compile(spec, { hidden: ['X'] })
    expect(rects(hid)).toHaveLength(1)
    expect(rects(hid)[0].w).toBeGreaterThan(500)
  })
  it('merges the long tail into Other past 150 tiles', () => {
    const data = Array.from({ length: 200 }, (_, i) => ({ k: `t${i}`, v: 200 - i }))
    const r = compilePlot({ type: 'treemap', label: 'k', value: 'v', data }, { width: 900, height: 600 })
    expect(r.ok && r.issues.map(i => i.code)).toContain('many_tiles')
  })
})

describe('sankey', () => {
  const flows = [{ from: 'A', to: 'C', v: 6 }, { from: 'B', to: 'C', v: 4 }, { from: 'C', to: 'D', v: 7 }, { from: 'C', to: 'E', v: 3 }]
  const spec = { type: 'sankey', from: 'from', to: 'to', value: 'v', data: flows }
  it('sizes every node by its throughput, on one scale', () => {
    const s = compile(spec)
    const nodes = rects(s)
    expect(nodes).toHaveLength(5)
    const h = (name: string): number => nodes.find(n => (n.datum as { node: string }).node === name)!.h
    expect(h('C') / h('D')).toBeCloseTo(10 / 7, 1)
    expect(h('A') / h('B')).toBeCloseTo(6 / 4, 1)
    expect(h('C')).toBeCloseTo(h('A') + h('B'), 0)
  })
  it('draws one band per flow with a tooltip naming both ends', () => {
    const s = compile(spec)
    const bands = s.marks.filter(m => m.type === 'path' && m.role === 'data')
    expect(bands).toHaveLength(4)
    expect(bands[0].tip!.title).toBe('A → C')
  })
  it('refuses loops, naming the cycle', () => {
    const v = validatePlot({ ...spec, data: [...flows, { from: 'D', to: 'A', v: 1 }] })
    expect(v.ok).toBe(false)
    const i = v.issues.find(x => x.code === 'cyclic_flow')!
    expect(i.message).toMatch(/A → C → D → A/)
    expect(i.hint).toBeTruthy()
  })
  it('ignores self flows and non-positive flows, with a warning', () => {
    const v = validatePlot({ ...spec, data: [...flows, { from: 'A', to: 'A', v: 2 }, { from: 'B', to: 'D', v: 0 }] })
    expect(v.ok).toBe(true)
    expect(v.issues.map(i => i.code)).toContain('flows_skipped')
  })
  it('does not collide with the common `source` line field', () => {
    const s = compile({ ...spec, source: 'Source: demo' })
    expect(s.marks.some(m => m.type === 'text' && m.text === 'Source: demo')).toBe(true)
  })
  it('renders safely with hostile names', () => {
    const svg = renderToSvg({ ...spec, data: [{ from: '<script>x</script>', to: 'B"&', v: 1 }] })
    expect(svg).not.toContain('<script>')
  })
  it('describes the main flow', () => {
    const d = describePlot(spec)
    expect(d.ok && d.text).toMatch(/Largest flow: C to D \(7\)/)
  })
})

describe('accessible theme', () => {
  it('is registered, light and dark, with eight distinct colours and blue/vermillion up/down', async () => {
    const { resolveTheme, listThemes } = await import('../../packages/core/src')
    expect(listThemes()).toEqual(expect.arrayContaining(['accessible', 'accessible-dark']))
    const t = resolveTheme('accessible')
    expect(new Set(t.palette).size).toBe(8)
    expect(t.colors.positive).not.toBe(t.colors.negative)
    expect(resolveTheme('accessible-dark').mode).toBe('dark')
    const svg = renderToSvg({ type: 'bar', x: 'a', y: 'b', data: [{ a: 'x', b: 1 }] }, { theme: 'accessible' })
    expect(svg).toContain('#0072B2')
  })
})
