import { describe, expect, it } from 'vitest'
import { compilePlot, chartCatalog, createTheme, PALETTE } from '../../packages/core/src'
import { parseColor, cvdDistance, cvdDistances, indistinctPairs, simulate, oklab, CVD_MIN_DISTANCE } from '../../packages/core/src/util/cvd'

const rgb = (c: string) => parseColor(c)!

describe('cvd maths', () => {
  it('parses hex, rgb(), hsl() and a few names; refuses variables', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0 })
    expect(parseColor('rgb(0, 128, 255)')).toEqual({ r: 0, g: 128, b: 255 })
    expect(parseColor('rgba(100% 0% 0% / 0.5)')).toEqual({ r: 255, g: 0, b: 0 })
    const h = parseColor('hsl(120, 100%, 25%)')!
    expect([h.r, h.g, h.b].map(Math.round)).toEqual([0, 128, 0])
    expect(parseColor('green')).toEqual({ r: 0, g: 128, b: 0 })
    expect(parseColor('var(--brand)')).toBeNull()
    expect(parseColor('var(--brand, #f00)')).toBeNull()
    expect(parseColor('rebeccapurple')).toBeNull()
  })

  it('matches OKLab reference values', () => {
    // Ottosson's published values: white L=1, a=b=0; sRGB red ~ (0.628, 0.225, 0.126).
    const w = oklab(simulate(rgb('#ffffff'), 'normal'))
    expect(w[0]).toBeCloseTo(1, 3)
    expect(Math.abs(w[1]) + Math.abs(w[2])).toBeLessThan(1e-3)
    const r = oklab(simulate(rgb('#ff0000'), 'normal'))
    expect(r[0]).toBeCloseTo(0.628, 2)
    expect(r[1]).toBeCloseTo(0.2249, 2)
    expect(r[2]).toBeCloseTo(0.1258, 2)
  })

  it('simulates Machado 2009 deuteranopia: red becomes a dark olive, blue stays blue', () => {
    const red = simulate(rgb('#ff0000'), 'deuteranopia')
    expect(red[0]).toBeCloseTo(0.367, 3)
    expect(red[1]).toBeCloseTo(0.280, 3)
    expect(red[2]).toBe(0) // clamped
    const blue = simulate(rgb('#0000ff'), 'tritanopia')
    expect(blue[2]).toBeCloseTo(0.3039, 3)
  })

  it('red vs green collapses under deuteranopia; blue vs orange stays far apart', () => {
    // d3's category10 red and green: clearly different with normal vision, nearly one colour for deutans.
    const rg = cvdDistances(rgb('#d62728'), rgb('#2ca02c'))
    expect(rg.normal).toBeGreaterThan(30)
    expect(rg.deuteranopia).toBeLessThan(5)
    expect(rg.protanopia).toBeLessThan(25)
    // Pure red and pure green differ in lightness, which survives the simulation.
    expect(cvdDistance(rgb('#ff0000'), rgb('#00ff00'), 'deuteranopia')).toBeGreaterThan(CVD_MIN_DISTANCE)
    const bo = cvdDistances(rgb('#1f77b4'), rgb('#ff7f0e'))
    for (const v of Object.values(bo)) expect(v).toBeGreaterThan(20)
  })

  it('lists adjacent pairs under the threshold and skips colours it cannot read', () => {
    const p = indistinctPairs(['#1f77b4', '#d62728', '#2ca02c', 'var(--x)', '#d62728'])
    expect(p.map(x => x.index)).toEqual([1])
    expect(p[0].worst).toBe('deuteranopia')
    expect(indistinctPairs(['#2962FF', '#2962FF'])[0]).toMatchObject({ worst: 'normal', min: 0 })
  })

  it('passes the default, accessible and shadcn palettes in order (measured minimum 14.0 and 9.6)', () => {
    expect(indistinctPairs(PALETTE)).toEqual([])
    expect(indistinctPairs([...PALETTE, PALETTE[0]])).toEqual([])
    expect(indistinctPairs(['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#7B6BC6', '#A0522D'])).toEqual([])
  })
})

describe('colors_indistinct warning', () => {
  const rows = [{ k: 'a', A: 1, B: 2, C: 3 }, { k: 'b', A: 2, B: 1, C: 2 }]
  const spec = { type: 'bar', x: 'k', y: ['A', 'B', 'C'], data: rows }
  const warn = (s: unknown, o = {}) => {
    const r = compilePlot(s, o)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return r.issues.filter(i => i.code === 'colors_indistinct')
  }

  it('fires for user colours that collapse under a simulation, naming the pair', () => {
    const w = warn({ ...spec, colors: { A: '#d62728', B: '#2ca02c' } })
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ severity: 'warning', path: 'colors' })
    expect(w[0].message).toMatch(/"A" and "B" \(3\.9 under deuteranopia, 33\.8 with normal vision\)/)
    expect(w[0].hint).toMatch(/patterns: true/)
    expect(w[0].hint).toMatch(/accessible/)
  })

  it('does not fire with patterns, for far-apart colours, for variables, or for one series', () => {
    expect(warn({ ...spec, colors: { A: '#d62728', B: '#2ca02c' }, patterns: true })).toEqual([])
    expect(warn({ ...spec, colors: { A: '#1f77b4', B: '#ff7f0e' } })).toEqual([])
    expect(warn({ ...spec, colors: { A: 'var(--a)', B: 'var(--b)' } })).toEqual([])
    expect(warn({ type: 'bar', x: 'k', y: 'A', colors: { A: '#d62728' }, data: rows })).toEqual([])
  })

  it('checks only neighbours in series order', () => {
    // A and C collapse but are not adjacent: B (near black) sits between them.
    expect(warn({ ...spec, colors: { A: '#d62728', B: '#131722', C: '#2ca02c' } })).toEqual([])
  })

  it('compares a user colour with the theme colour next to it', () => {
    // B keeps palette colour 2 (#FF9800); a near-identical orange for A collides with it.
    expect(warn({ ...spec, colors: { A: '#FF9900' } })).toHaveLength(1)
  })

  it('leaves theme-only pairs alone: the theme is the host\'s choice', () => {
    const theme = createTheme('light', { name: 'rg', palette: ['#d62728', '#2ca02c', '#1f77b4'] })
    expect(warn(spec, { theme })).toEqual([])
    // ...but a spec colour is compared with the theme colour beside it.
    expect(warn({ ...spec, colors: { C: '#131722' } }, { theme })).toEqual([]) // A-B collide, but neither is the spec's
    expect(warn({ ...spec, colors: { A: '#d62728' } }, { theme })).toHaveLength(1)
  })

  it('never fires on the gallery examples with the built-in themes', () => {
    for (const info of chartCatalog()) for (const theme of ['light', 'dark', 'accessible', 'accessible-dark', 'shadcn']) {
      expect(warn(info.example, { theme }), `${info.type} ${theme}`).toEqual([])
    }
  })
})
