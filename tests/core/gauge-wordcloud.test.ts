// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, validatePlot, renderToSvg, chartCatalog, drawScene, buildHitIndex, plotTable, cloudLayout, cloudWords, cloudFontSize, estimateWidth, gaugeItems, gaugeScale, CLOUD_LIMITS, CLOUD_COS, MAX_GAUGES, type Canvas2D, type Scene, type Mark } from '../../packages/core/src'

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const issues = (spec: unknown, o = {}) => compilePlot(spec, { width: 640, height: 420, ...o }).issues
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => i.code)
type M<T extends Mark['type']> = Extract<Mark, { type: T }>
const of = <T extends Mark['type']>(s: Scene, type: T, role = 'data'): M<T>[] => s.marks.filter((m): m is M<T> => m.type === type && m.role === role)
const ex = (type: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === type)!.example)

// ---- gauge -------------------------------------------------------------------------------------------

/** Points of an `arc()` ring sector path: outer start, outer end, inner end (after L), inner start (before Z). */
function ring(d: string): { sweep: number } {
  const nums = (s: string): number[] => s.trim().split(/[\s,]+/).map(Number)
  const m = /^M([^A]+)A([^L]+)L([^A]+)A([^Z]+)Z$/.exec(d)!
  const p0 = nums(m[1])
  const p1 = nums(m[2]).slice(-2)
  const q1 = nums(m[3])
  const q0 = nums(m[4]).slice(-2)
  // Outer and inner points of each end lie on one ray from the centre.
  const a0 = Math.atan2(p0[1] - q0[1], p0[0] - q0[0])
  const a1 = Math.atan2(p1[1] - q1[1], p1[0] - q1[0])
  return { sweep: (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) }
}

describe('gauge', () => {
  const one = (extra: Record<string, unknown> = {}, row: Record<string, unknown> = {}) => ({ type: 'gauge', value: 'v', min: 0, max: 200, data: [{ v: 50, ...row }], ...extra })
  const overlay = (s: Scene): M<'path'>[] => of(s, 'path').filter(p => p.fill === 'transparent')
  const filled = (s: Scene): M<'path'>[] => of(s, 'path').filter(p => p.fill !== 'transparent')

  it('fills an arc whose length is the value\'s share of the range, starting at min', () => {
    const s = compile(one())
    const track = ring(overlay(s)[0].d).sweep
    expect(track).toBeCloseTo((240 * Math.PI) / 180, 3)
    expect(ring(filled(s)[0].d).sweep / track).toBeCloseTo(0.25, 3)
    // Starting at a negative min, the arc still starts at min: 0 on -100..100 is half the arc.
    const neg = compile({ type: 'gauge', value: 'v', min: -100, max: 100, data: [{ v: 0 }] })
    expect(ring(filled(neg)[0].d).sweep / ring(overlay(neg)[0].d).sweep).toBeCloseTo(0.5, 3)
    // A half circle.
    const half = compile(one({ arc: 180 }))
    expect(ring(overlay(half)[0].d).sweep).toBeCloseTo(Math.PI, 3)
  })

  it('clamps a value outside the range on the arc but prints it truthfully, with a warning', () => {
    const spec = one({}, { v: 260 })
    expect(codes(spec)).toContain('value_outside_range')
    const s = compile(spec)
    expect(ring(filled(s)[0].d).sweep).toBeCloseTo(ring(overlay(s)[0].d).sweep, 3)
    expect(of(s, 'text', 'label').map(t => t.text)).toContain('260')
    expect(overlay(s)[0].aria).toMatch(/above the maximum \(200\)/)
    expect(describePlot(spec)).toMatchObject({ ok: true, text: expect.stringMatching(/260, above the maximum of 200 \(the arc is full\)/) })
    const below = compile(one({}, { v: -5 }))
    expect(filled(below)).toHaveLength(0)
    expect(overlay(below)[0].tip!.rows.map(r => r.value)).toContain('below the minimum (0)')
  })

  it('derives a round max from the data when none is given, and says so', () => {
    const spec = { type: 'gauge', value: 'v', target: 't', data: [{ v: 72, t: 75 }] }
    const v = validatePlot(spec)
    expect(v.issues.find(i => i.code === 'max_derived')).toMatchObject({ severity: 'warning', path: 'max' })
    expect(gaugeScale(v.spec!, gaugeItems(v.spec!).items)).toMatchObject({ min: 0, max: 80, derived: true, largest: 75 })
    expect(describePlot(spec)).toMatchObject({ text: expect.stringMatching(/from 0 to 80 \(the maximum was rounded up from the data, not given\)/) })
    expect(codes({ type: 'gauge', value: 'v', data: [{ v: -3 }] })).toContain('max_required')
    expect(codes(one({ max: 0 }))).toContain('bad_range')
    expect(codes(one({ min: 10, max: 10 }))).toContain('bad_range')
  })

  it('needs a label column for several rows, draws at most six, and refuses facet', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ k: `G${i}`, v: i * 10 }))
    expect(validatePlot({ type: 'gauge', value: 'v', max: 100, data: rows }).issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'missing_required', path: 'label' }))
    const spec = { type: 'gauge', label: 'k', value: 'v', max: 100, data: rows }
    expect(codes(spec)).toContain('too_many_gauges')
    const s = compile(spec)
    expect(overlay(s)).toHaveLength(MAX_GAUGES)
    expect(overlay(s).map(m => (m.datum as { label: string }).label)).toEqual(['G0', 'G1', 'G2', 'G3', 'G4', 'G5'])
    expect(describePlot(spec)).toMatchObject({ text: expect.stringMatching(/2 more rows are not drawn\.$/) })
    expect(codes({ ...spec, facet: 'k' })).toContain('unknown_field')
    expect(codes({ ...spec, data: [...rows, rows[0]] })).toContain('duplicate_measures')
  })

  it('names every band in text and colours it with a status tone, in either order', () => {
    const spec = one({ bands: ['bad', 'ok', 'good'] }, { bad: 50, ok: 120, good: 200, v: 130 })
    const s = compile(spec)
    const bands = of(s, 'path', 'annotation')
    expect(bands.map(b => b.fill)).toEqual(['var(--sp-negative, #C2362B)', 'var(--sp-warning, #9A6400)', 'var(--sp-positive, #12805C)'])
    expect(bands.map(b => b.aria)).toEqual(['bad: 0 to 50', 'ok: 50 to 120', 'good: 120 to 200'])
    const labels = of(s, 'text', 'label').map(t => t.text)
    for (const n of ['bad', 'ok', 'good']) expect(labels).toContain(n)
    expect(overlay(s)[0].aria).toMatch(/in band good/)
    expect((overlay(s)[0].datum as { band: string }).band).toBe('good')
    const best = compile({ ...spec, bandOrder: 'best-first' })
    expect(of(best, 'path', 'annotation').map(b => b.fill)).toEqual(['var(--sp-positive, #12805C)', 'var(--sp-warning, #9A6400)', 'var(--sp-negative, #C2362B)'])
    expect(describePlot(spec)).toMatchObject({ text: expect.stringMatching(/130, 65% of the range, in band "good" \(120 to 200\)/) })
    expect(codes(one({ bands: ['bad'] }, { bad: 1 }))).toContain('too_few_columns')
    expect(codes(one({ bands: ['a', 'b'] }, { a: 9, b: 3 }))).toContain('bands_not_increasing')
  })

  it('gives every gauge a tooltip, a spoken name and a datum, also at the minimum and with the value hidden', () => {
    const s = compile(ex('gauge'))
    for (const m of overlay(s)) {
      expect(m.tip!.rows.length).toBeGreaterThan(3)
      expect(m.aria).toMatch(/of 0% to 100%/)
      expect(m.datum).toMatchObject({ min: 0, max: 1 })
    }
    const zero = compile(one({}, { v: 0 }))
    expect(filled(zero)).toHaveLength(0)
    expect(overlay(zero)[0].aria).toBe('v: 0, 0% of 0 to 200')
    const hidden = compile(ex('gauge'), { hidden: ['used'] })
    expect(filled(hidden).filter(p => p.series === 'used')).toHaveLength(0)
    expect(overlay(hidden)).toHaveLength(3)
    // Target ticks: one per gauge, in the legend.
    expect(of(s, 'line')).toHaveLength(3)
    expect(s.series.map(x => x.key)).toEqual(['used', 'plan'])
  })
})

// ---- word cloud --------------------------------------------------------------------------------------

describe('cloudLayout', () => {
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'].map((text, i) => ({ text, size: 40 - i * 3, rotate: i % 4 === 3 }))
  const measure = (t: string, s: number): number => estimateWidth(t, s, 500)

  it('places whole-pixel boxes inside the area without overlap, the first at the centre', () => {
    const boxes = cloudLayout(words, 400.7, 240.2, measure)
    expect(boxes.every(Boolean)).toBe(true)
    const placed = boxes.filter(b => b !== null)
    for (const b of placed) {
      for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isInteger(v)).toBe(true)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(400)
      expect(b.y + b.h).toBeLessThanOrEqual(240)
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j]
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
    }
    const first = placed[0]
    expect(first.x + Math.floor(first.w / 2)).toBe(200)
    expect(first.y + Math.floor(first.h / 2)).toBe(120)
    // Box size: measured width + 2 by size + floor((size + 4) / 5) + 2; rotated words swap them.
    expect(first.w).toBe(Math.ceil(measure('alpha', 40)) + 2)
    expect(first.h).toBe(40 + 8 + 2)
    expect(placed[3].rotate).toBe(true)
    expect(placed[3].w).toBe(31 + 7 + 2)
    expect(cloudLayout(words, 400, 240, measure)).toEqual(boxes)
  })

  it('leaves out a word that cannot fit and goes on with the next', () => {
    const boxes = cloudLayout([{ text: 'x'.repeat(40), size: 30 }, { text: 'ok', size: 12 }], 200, 100, measure)
    expect(boxes[0]).toBeNull()
    expect(boxes[1]).not.toBeNull()
    expect(cloudLayout([{ text: 'a', size: 10 }], 0, 0, measure)).toEqual([null])
  })

  it('uses only the integer cosine table', () => {
    expect(CLOUD_COS).toHaveLength(19)
    CLOUD_COS.forEach((c, k) => expect(c).toBe(Math.round(Math.cos((k * 5 * Math.PI) / 180) * 10000)))
  })

  it('sizes fonts by the square root of the value, with a floor', () => {
    expect(cloudFontSize(100, 100, 64)).toBe(64)
    expect(cloudFontSize(25, 100, 64)).toBe(32)
    expect(cloudFontSize(1, 100, 64)).toBe(CLOUD_LIMITS.minFont)
  })
})

describe('wordcloud', () => {
  const texts = (s: Scene): M<'text'>[] => of(s, 'text')

  it('draws one text mark per word in value order, each with tip, aria and datum, and a hover box', () => {
    const s = compile(ex('wordcloud'))
    const t = texts(s)
    expect(t).toHaveLength(24)
    const values = t.map(m => (m.datum as { value: number }).value)
    expect(values).toEqual([...values].sort((a, b) => b - a))
    for (let i = 1; i < t.length; i++) expect(t[i].size).toBeLessThanOrEqual(t[i - 1].size)
    expect(t[0]).toMatchObject({ text: 'delivery', aria: 'delivery: 214, rank 1 of 24', datum: { text: 'delivery', value: 214, rank: 1 } })
    expect(t[0].tip!.rows.map(r => r.label)).toEqual(['mentions', 'Rank'])
    expect(of(s, 'rect', 'hit')).toHaveLength(24)
    expect(t.some(m => m.rotate)).toBe(false)
    const turned = texts(compile({ ...ex('wordcloud'), rotate: 'some' }))
    expect(turned.filter(m => m.rotate === -90).map(m => (m.datum as { rank: number }).rank)).toEqual([4, 8, 12, 16, 20, 24])
  })

  it('lists the top words with their values in the description, and every word in the data table', () => {
    const d = describePlot(ex('wordcloud'))
    expect(d.ok && d.text).toMatch(/Top 10, largest first: delivery 214, price 188, quality 161, support 132, battery 118, screen 97, size 84, setup 71, refund 63, app 58\./)
    expect(d.ok && d.text).toMatch(/a long word looks bigger/)
    const table = plotTable(ex('wordcloud'))!
    expect(table.columns.map(c => c.key)).toEqual(['term', 'mentions'])
    expect(table.rows).toHaveLength(24)
  })

  it('sums repeated words, skips values at or below zero, keeps the 150 largest', () => {
    const rows = [{ w: 'a', n: 2 }, { w: 'b', n: 3 }, { w: 'a', n: 4 }, { w: 'c', n: 0 }, { w: 'd', n: -1 }, { w: '', n: 9 }]
    const spec = { type: 'wordcloud', text: 'w', value: 'n', data: rows }
    expect(cloudWords(spec).words.map(w => [w.text, w.value])).toEqual([['a', 6], ['b', 3]])
    expect(codes(spec)).toContain('nonpositive_values')
    expect(codes({ ...spec, data: [{ w: 'a', n: 0 }] })).toContain('no_positive_values')
    expect(codes({ ...spec, patterns: true })).toContain('patterns_unsupported')
    const many = { type: 'wordcloud', text: 'w', value: 'n', data: Array.from({ length: 200 }, (_, i) => ({ w: `w${i}`, n: 200 - i })) }
    expect(codes(many)).toContain('too_many_words')
    expect(cloudWords(many).words).toHaveLength(150)
    const s = compile(many, { width: 1200, height: 800 })
    expect(texts(s).length).toBeLessThanOrEqual(150)
    expect(s.description).toMatch(/200 words .* Only the 150 largest are drawn\./)
  })

  it('leaves out words that do not fit, with a warning naming them', () => {
    const r = issues(ex('wordcloud'), { width: 200, height: 140 })
    const w = r.find(i => i.code === 'words_dropped')
    expect(w).toBeDefined()
    expect(w!.message).toMatch(/^\d+ of 24 words did not fit/)
    expect(compile(ex('wordcloud'), { width: 200, height: 140 }).description).toMatch(/delivery 214/)
  })

  it('colours by group with a legend; hiding a group keeps the other words in place', () => {
    const spec = { ...ex('wordcloud'), series: 'kind', data: ex('wordcloud').data.map((r: Record<string, unknown>, i: number) => ({ ...r, kind: i % 3 ? 'product' : 'service' })) }
    const s = compile(spec)
    expect(s.series.map(x => x.key)).toEqual(['service', 'product'])
    expect(of(s, 'rect', 'legend').length).toBeGreaterThan(0)
    const colours = new Set(texts(s).map(m => m.fill))
    expect(colours.size).toBe(2)
    expect(texts(s)[0].tip!.rows.map(r => r.label)).toEqual(['mentions', 'Rank', 'kind'])
    const hidden = compile(spec, { hidden: ['service'] })
    const pos = (sc: Scene) => new Map(texts(sc).map(m => [m.text, [m.x, m.y]]))
    const all = pos(s)
    for (const [k, p] of pos(hidden)) expect(all.get(k)).toEqual(p)
    expect(texts(hidden).length).toBeLessThan(texts(s).length)
    expect(codes({ ...spec, facet: 'kind' })).toContain('unknown_field')
  })

  it('is deterministic and renders well-formed SVG with rotated words', () => {
    const spec = { ...ex('wordcloud'), rotate: 'some' }
    const a = renderToSvg(spec)
    expect(renderToSvg(spec)).toBe(a)
    expect(a).toMatch(/transform="rotate\(-90 /)
  })
})

describe('gauge and word cloud on canvas', () => {
  it('draw on a 2D context and hit-test their marks', () => {
    for (const t of ['gauge', 'wordcloud']) {
      const s = compile(ex(t))
      const calls: string[] = []
      const ctx: Record<string, unknown> = { globalAlpha: 1 }
      for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fill', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash']) ctx[k] = () => calls.push(k)
      class P { constructor(readonly d?: string) {} }
      drawScene(ctx as unknown as Canvas2D, s, { Path2D: P })
      expect(calls.filter(c => c === 'fill' || c === 'stroke' || c === 'fillText').length).toBeGreaterThan(10)
      for (const m of s.marks) if ((m.role === 'data' || m.role === 'hit') && m.tip) {
        expect(m.aria, t).toBeTruthy()
        expect(m.datum, t).toBeDefined()
      }
      const idx = buildHitIndex(s)
      const hit = s.marks.findIndex(m => m.role === 'hit' && m.type === 'rect')
      if (hit >= 0) {
        const m = s.marks[hit] as M<'rect'>
        expect(idx.at(m.x + m.w / 2, m.y + m.h / 2)).toBe(hit)
      } else {
        // Gauges are paths: the index hands them to the path test.
        const target = s.marks.findIndex(m => m.type === 'path' && m.tip && m.role === 'data')
        expect(idx.at(0, 0, i => i === target)).toBe(target)
      }
    }
  })
})
