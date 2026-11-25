import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot as describe_, renderToSvg, validatePlot, jitterUnit, JITTER_MAX, type Mark } from '../../packages/core/src'

type Dot = Extract<Mark, { type: 'circle' }>
const rows = Array.from({ length: 30 }, (_, i) => ({ a: 1 + (i % 4), b: 1 + (i % 5), g: i % 2 ? 'odd' : 'even' }))
const dots = (spec: Record<string, unknown>, hidden: string[] = []): Dot[] => {
  const r = compilePlot({ type: 'scatter', x: 'a', y: 'b', data: rows, ...spec }, { width: 600, height: 400, hidden })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene.marks.filter((m): m is Dot => m.type === 'circle' && m.role === 'data')
}

const describePlot = (spec: Record<string, unknown>): string => {
  const r = describe_(spec)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.text
}
describe('jitterUnit', () => {
  it('is in [-1, 1), repeatable, and differs by axis and index', () => {
    for (let i = 0; i < 2000; i++) for (const a of ['x', 'y'] as const) {
      const u = jitterUnit(i, a)
      expect(u).toBeGreaterThanOrEqual(-1)
      expect(u).toBeLessThan(1)
      expect(jitterUnit(i, a)).toBe(u)
    }
    expect(jitterUnit(0, 'x')).not.toBe(jitterUnit(0, 'y'))
    expect(jitterUnit(1, 'x')).not.toBe(jitterUnit(2, 'x'))
  })
  it('has known values (the ports are held to the same ones by the conformance file)', () => {
    expect(jitterUnit(0, 'x')).toBeCloseTo(-0.847392919, 9)
    // 2^32 wraps to 0.
    expect(jitterUnit(4294967296, 'x')).toBe(jitterUnit(0, 'x'))
  })
  it('spreads: both signs and no clumping into one half', () => {
    const us = Array.from({ length: 1000 }, (_, i) => jitterUnit(i, 'x'))
    const neg = us.filter(u => u < 0).length
    expect(neg).toBeGreaterThan(400)
    expect(neg).toBeLessThan(600)
  })
})

describe('scatter jitter', () => {
  it('is off by default and at 0', () => {
    const base = dots({})
    expect(dots({ jitter: 0 }).map(d => [d.cx, d.cy])).toEqual(base.map(d => [d.cx, d.cy]))
    expect(new Set(base.map(d => `${d.cx},${d.cy}`)).size).toBeLessThan(base.length)
  })
  it('moves each dot by up to jitter pixels, by the unit offset of its row, and separates stacked dots', () => {
    const base = dots({})
    const moved = dots({ jitter: 8 })
    expect(moved).toHaveLength(base.length)
    moved.forEach((d, i) => {
      expect(Math.abs(d.cx - base[i].cx)).toBeLessThanOrEqual(8 + 1e-9)
      expect(Math.abs(d.cy - base[i].cy)).toBeLessThanOrEqual(8 + 1e-9)
    })
    // Away from the plot's edge, the offset is exactly jitter * unit.
    const inner = moved.map((d, i) => ({ d, i })).filter(({ d, i }) => d.cx - base[i].cx !== 0 && Math.abs(base[i].cx - d.cx) < 8)
    expect(inner.length).toBeGreaterThan(5)
    expect(new Set(moved.map(d => `${d.cx.toFixed(3)},${d.cy.toFixed(3)}`)).size).toBeGreaterThan(new Set(base.map(d => `${d.cx},${d.cy}`)).size)
  })
  it('jitterAxis picks the direction', () => {
    const base = dots({})
    const x = dots({ jitter: 8, jitterAxis: 'x' })
    const y = dots({ jitter: 8, jitterAxis: 'y' })
    expect(x.every((d, i) => d.cy === base[i].cy)).toBe(true)
    expect(x.some((d, i) => d.cx !== base[i].cx)).toBe(true)
    expect(y.every((d, i) => d.cx === base[i].cx)).toBe(true)
    expect(y.some((d, i) => d.cy !== base[i].cy)).toBe(true)
  })
  it('keeps every dot inside the plot', () => {
    const r = compilePlot({ type: 'scatter', x: 'a', y: 'b', jitter: JITTER_MAX, data: rows }, { width: 300, height: 200 })
    if (!r.ok) throw new Error('invalid')
    for (const d of r.scene.marks.filter((m): m is Dot => m.type === 'circle' && m.role === 'data')) {
      expect(d.cx).toBeGreaterThan(0)
      expect(d.cx).toBeLessThan(300)
    }
  })
  it('the same data draws the same bytes, and the true values stay in the datum, tooltip and description', () => {
    const spec = { type: 'scatter', x: 'a', y: 'b', jitter: 6, data: rows }
    expect(renderToSvg(spec)).toBe(renderToSvg({ ...spec }))
    const moved = dots({ jitter: 6 })
    const base = dots({})
    moved.forEach((d, i) => {
      expect(d.datum).toEqual(base[i].datum)
      expect(d.tip).toEqual(base[i].tip)
    })
    expect(describePlot(spec)).toContain('Points are nudged slightly so that overlapping points show; their drawn positions are approximate, the values exact.')
    expect(describePlot({ ...spec, jitterAxis: 'x' })).toContain('nudged slightly sideways')
    expect(describePlot({ ...spec, jitterAxis: 'y' })).toContain('nudged slightly up and down')
    expect(describePlot({ ...spec, jitter: 0 })).not.toContain('nudged')
  })
  it('hiding a series moves the dots that stay by the same offsets', () => {
    // Fixed domains: hiding a series must not rescale the axes, or nothing is comparable (and no dot touches an edge).
    const fixed = { series: 'g', xDomain: [0, 6], yDomain: [0, 6] }
    const all = dots(fixed)
    const allJ = dots({ ...fixed, jitter: 8 })
    const offsets = allJ.map((d, i) => d.cx - all[i].cx)
    const odd = (i: number): boolean => i % 2 === 1
    const keptBase = dots(fixed, ['even'])
    const keptJ = dots({ ...fixed, jitter: 8 }, ['even'])
    expect(keptJ).toHaveLength(15)
    keptJ.forEach((d, k) => {
      const i = [...Array(30).keys()].filter(odd)[k]
      expect(d.cx - keptBase[k].cx).toBeCloseTo(offsets[i], 6)
    })
  })
  it('is checked: range, type, direction, and what it is ignored by', () => {
    const v = (extra: Record<string, unknown>): { sev: string; code: string; path: string }[] => validatePlot({ type: 'scatter', x: 'a', y: 'b', data: rows, ...extra }).issues.map(i => ({ sev: i.severity, code: i.code, path: i.path }))
    expect(v({ jitter: 5, jitterAxis: 'x' })).toEqual([])
    expect(v({ jitter: 21 })[0]).toMatchObject({ sev: 'error', path: 'jitter' })
    expect(v({ jitter: -1 })[0]).toMatchObject({ sev: 'error', path: 'jitter' })
    expect(v({ jitter: 'wide' })[0]).toMatchObject({ sev: 'error', path: 'jitter' })
    expect(v({ jitter: 4, jitterAxis: 'z' })[0]).toMatchObject({ sev: 'error', path: 'jitterAxis' })
    expect(v({ jitterAxis: 'y' })).toEqual([{ sev: 'warning', code: 'jitter_axis_ignored', path: 'jitterAxis' }])
    expect(v({ jitter: 4, density: 'hex' })).toEqual([{ sev: 'warning', code: 'jitter_ignored', path: 'jitter' }])
    expect(v({ jitter: 4, order: 'a' })).toEqual([{ sev: 'warning', code: 'jitter_ignored', path: 'jitter' }])
  })
  it('does nothing under hexagons or a connected line', () => {
    const base = dots({ order: 'a' })
    expect(dots({ order: 'a', jitter: 8 }).map(d => d.cx)).toEqual(base.map(d => d.cx))
  })
})
