import { describe, expect, it } from 'vitest'
import { chartCatalog, compilePlot, renderToSvg, type Scene } from '../../packages/core/src'

const ok = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, o)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  for (const m of r.scene.marks) for (const v of Object.values(m)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  return r.scene
}

describe('edge cases never produce NaN or throw', () => {
  const one = [{ k: 'a', v: 5 }]
  it('a single row', () => {
    for (const type of ['bar', 'line', 'area']) ok({ type, x: 'k', y: 'v', data: one })
    ok({ type: 'pie', label: 'k', value: 'v', data: one })
    ok({ type: 'histogram', value: 'v', data: one })
    ok({ type: 'box', y: 'v', data: one })
    ok({ type: 'heatmap', x: 'k', y: 'k', value: 'v', data: one })
    ok({ type: 'scatter', x: 'v', y: 'v', data: one })
  })
  it('all values equal, all zero, all negative', () => {
    const same = Array.from({ length: 10 }, (_, i) => ({ k: `c${i}`, v: 7 }))
    const zero = same.map(r => ({ ...r, v: 0 }))
    const neg = same.map(r => ({ ...r, v: -7 }))
    for (const data of [same, zero, neg]) {
      for (const type of ['bar', 'line', 'area']) ok({ type, x: 'k', y: 'v', data })
      ok({ type: 'histogram', value: 'v', data })
      ok({ type: 'box', y: 'v', data })
      ok({ type: 'heatmap', x: 'k', y: 'v', value: 'v', data })
    }
    ok({ type: 'pie', label: 'k', value: 'v', data: zero })
  })
  it('very large and very small numbers', () => {
    ok({ type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1e15 }, { k: 'b', v: 3e14 }] })
    ok({ type: 'line', x: 'k', y: 'v', data: [{ k: 1, v: 1e-9 }, { k: 2, v: 3e-9 }] })
  })
  it('missing values in every column', () => {
    ok({ type: 'line', x: 'k', y: 'v', data: [{ k: 1, v: null }, { k: 2, v: 4 }, { k: 3 }, { k: 4, v: 2 }] })
    ok({ type: 'bar', x: 'k', y: ['a', 'b'], data: [{ k: 'x', a: 1 }, { k: 'y', b: 2 }] })
  })
  it('tiny and huge canvases', () => {
    for (const info of chartCatalog()) {
      ok(info.example, { width: 120, height: 100 })
      ok(info.example, { width: 4000, height: 3000 })
    }
  })
  it('CJK labels and a locale', () => {
    const s = ok({ type: 'bar', title: '各區營收', x: 'k', y: 'v', format: 'currency:TWD', data: [{ k: '北區', v: 1200000 }, { k: '南區', v: 900000 }] }, { locale: 'zh-TW' })
    expect(s.description).toMatch(/北區/)
  })
  it('many categories stay legible: labels rotate or thin out instead of overlapping', () => {
    const data = Array.from({ length: 80 }, (_, i) => ({ k: `Category ${i}`, v: i }))
    const s = ok({ type: 'bar', x: 'k', y: 'v', data }, { width: 700 })
    const labels = s.marks.filter(m => m.type === 'text' && m.role === 'axis-label' && (m as { rotate?: number }).rotate)
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.length).toBeLessThan(80)
  })
})

describe('performance', () => {
  const time = (f: () => void): number => {
    const t = performance.now()
    f()
    return performance.now() - t
  }
  it('lays out 20k line points and 3k scatter points within a generous budget', () => {
    const line = Array.from({ length: 20000 }, (_, i) => ({ x: i, y: Math.sin(i / 300) * 100 }))
    const dots = Array.from({ length: 3000 }, (_, i) => ({ x: i % 97, y: (i * 31) % 211 }))
    expect(time(() => renderToSvg({ type: 'line', x: 'x', y: 'y', data: line }))).toBeLessThan(1500)
    expect(time(() => renderToSvg({ type: 'scatter', x: 'x', y: 'y', data: dots }))).toBeLessThan(1500)
  })
})
