import { describe, expect, it } from 'vitest'
import { compilePlot, validatePlot, renderToSvg, type Scene } from '../../packages/core/src'

type R = Record<string, unknown>
const rows: R[] = [{ d: '2026-01-01', a: 3, b: 2 }, { d: '2026-02-01', a: 5, b: 3 }, { d: '2026-03-01', a: 4, b: 6 }, { d: '2026-04-01', a: 7, b: 5 }]
const spec = (extra: R = {}): R => ({ type: 'line', x: 'd', y: ['a', 'b'], title: 'Equity', subtitle: 'last 4 months', source: 'FirstFa', xLabel: 'Date', yLabel: 'USD', data: rows, ...extra })
const scene = (s: unknown, width = 120, height = 36): Scene => {
  const r = compilePlot(s, { width, height })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const roles = (s: Scene): Set<string> => new Set(s.marks.map(m => (m as { role?: string }).role ?? 'none'))

describe('bare: only the marks', () => {
  it('drops axes, grid, labels, title, legend and source', () => {
    const full = roles(scene(spec(), 640, 400))
    expect(['axis', 'grid', 'axis-label', 'title', 'legend'].every(r => full.has(r))).toBe(true)
    const bare = roles(scene(spec({ bare: true })))
    for (const r of ['axis', 'grid', 'axis-label', 'title', 'legend']) expect(bare.has(r), r).toBe(false)
    expect(bare.has('data')).toBe(true)
  })
  it('keeps the title as the chart name for screen readers, and draws inside the box', () => {
    const s = scene(spec({ bare: true }))
    expect(s.title).toBe('Equity')
    expect(s.axes!.plot).toMatchObject({ x: 4, y: 4, w: 112, h: 28 })
    const svg = renderToSvg(spec({ bare: true }), { width: 120, height: 36 })
    expect(svg).toContain('Equity')
    expect(svg).not.toContain('last 4 months')
  })
  it('fills a box smaller than the ordinary minimum', () => {
    const s = scene(spec({ bare: true }), 60, 20)
    expect(s.axes!.plot.h).toBe(12)
    const ys = s.marks.flatMap(m => (m.type === 'path' && m.role === 'data' ? [...m.d.matchAll(/[ML]\s*[\d.]+[ ,]([\d.]+)/g)].map(x => +x[1]) : []))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4 - 0.01)
    expect(Math.max(...ys)).toBeLessThanOrEqual(16 + 0.01)
  })
  it('works for other cartesian charts and is off by default', () => {
    const bar = scene({ type: 'bar', x: 'd', y: 'a', data: rows, bare: true })
    expect(roles(bar).has('axis-label')).toBe(false)
    expect(roles(scene(spec())).has('axis-label')).toBe(true)
  })
  it('validates as a boolean', () => {
    expect(validatePlot(spec({ bare: true })).ok).toBe(true)
    expect(validatePlot(spec({ bare: 'yes' })).issues[0]).toMatchObject({ code: 'bad_type', path: 'bare' })
  })
})
