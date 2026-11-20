import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  compilePlot, describePlot, validatePlot, renderToSvg, chartCatalog, parseCardRef, formatCardRef, resolveRef, matchMarks, markRef, datePeriod,
  CARD_REF_LIMITS, type Scene, type CardRef, type RefMatch
} from '../../packages/core/src'

const cases = JSON.parse(readFileSync(new URL('../../conformance/card-ref.v1.json', import.meta.url), 'utf8')) as {
  card_ref_parse: { value: unknown; expect: unknown }[]
  card_ref_format: { value: unknown; expect: unknown }[]
}
const undef = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) && (v as { undefined?: boolean }).undefined === true && Object.keys(v).length === 1 ? undefined : v)

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const ok = (m: RefMatch): Extract<RefMatch, { ok: true }> => {
  if (!m.ok) throw new Error(`${m.code}: ${m.reason}`)
  return m
}
const ex = (type: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === type)!.example)

const sales = {
  type: 'bar', x: 'month', y: 'sales', series: 'region', key: 'id',
  data: [
    { id: 'a', month: 'Jan', region: 'EU', sales: 10 },
    { id: 'b', month: 'Feb', region: 'EU', sales: 30 },
    { id: 'c', month: 'Mar', region: 'EU', sales: 25 },
    { id: 'd', month: 'Jan', region: 'US', sales: 12 },
    { id: 'e', month: 'Feb', region: 'US', sales: 18 },
    { id: 'f', month: 'Mar', region: 'US', sales: 40 }
  ],
  annotations: [{ axis: 'y', value: 35, label: 'Target', key: 'target' }]
}
const daily = {
  type: 'line', x: 'date', y: 'visits',
  data: [
    { date: '2026-02-27', visits: 5 }, { date: '2026-03-01', visits: 8 }, { date: '2026-03-15', visits: 9 },
    { date: '2026-03-31T23:59:00Z', visits: 4 }, { date: '2026-04-01', visits: 7 }
  ]
}

describe('card reference shell (copy of the protocol)', () => {
  it('passes every card_ref_parse case', () => {
    for (const c of cases.card_ref_parse) expect(parseCardRef(undef(c.value)), JSON.stringify(c.value)).toEqual(c.expect)
  })
  it('passes every card_ref_format case', () => {
    for (const c of cases.card_ref_format) expect(formatCardRef(undef(c.value) as CardRef), JSON.stringify(c.value)).toEqual(c.expect)
  })
  it('round-trips a formatted reference', () => {
    const ref = { target: 'sales', params: { x: ['2026-03', 'a b'], series: ['EU'] } }
    const text = formatCardRef(ref)!
    expect(text).toBe('ref:sales?series=EU&x=2026-03&x=a%20b')
    expect(parseCardRef(text)).toEqual({ ok: true, ref })
    expect(text.length).toBeLessThanOrEqual(CARD_REF_LIMITS.length)
  })
})

describe('datePeriod', () => {
  it('reads an ISO prefix as the whole period it names', () => {
    expect(datePeriod('2026')).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1) - 1])
    expect(datePeriod('2024-02')).toEqual([Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 1) - 1])
    expect(datePeriod('2026-03-15')).toEqual([Date.UTC(2026, 2, 15), Date.UTC(2026, 2, 16) - 1])
    expect(datePeriod('2026-03-15T10:30')).toEqual([Date.UTC(2026, 2, 15, 10, 30), Date.UTC(2026, 2, 15, 10, 31) - 1])
    expect(datePeriod('2026-03-15T10:30:05Z')).toEqual([Date.UTC(2026, 2, 15, 10, 30, 5), Date.UTC(2026, 2, 15, 10, 30, 6) - 1])
    expect(datePeriod('nope')).toBeNull()
    expect(datePeriod('2026-13')).toBeNull()
  })
})

describe('resolveRef', () => {
  it('matches categories, ranges in data order, series and the whole plot', () => {
    expect(ok(resolveRef(sales, 'ref:s?x=Mar')).rows).toEqual([2, 5])
    expect(ok(resolveRef(sales, 'ref:s?x=Feb..Mar&series=US')).rows).toEqual([4, 5])
    expect(ok(resolveRef(sales, 'ref:s?x=Jan&x=Mar&series=EU')).rows).toEqual([0, 2])
    const all = ok(resolveRef(sales, 'ref:s'))
    expect(all.rows).toEqual([0, 1, 2, 3, 4, 5])
    expect(all.series).toEqual(['EU', 'US'])
    expect(all.label).toBe('6 points in 2 series')
  })
  it('reads y as a value range, and one number as that value', () => {
    expect(ok(resolveRef(sales, 'ref:s?y=20..30')).rows).toEqual([1, 2])
    expect(ok(resolveRef(sales, 'ref:s?y=40')).rows).toEqual([5])
    expect(ok(resolveRef(sales, 'ref:s?y=..12')).rows).toEqual([0, 3])
  })
  it('matches row ids and annotation keys with key', () => {
    const m = ok(resolveRef(sales, 'ref:s?key=b&key=target'))
    expect(m.rows).toEqual([1])
    expect(m.keys).toEqual(['target'])
    expect(m.label).toBe('month Feb, region EU, sales 30; annotation "Target"')
    expect(ok(resolveRef(sales, 'ref:s?key=target')).rows).toEqual([])
    // With another param, annotations do not count.
    expect(resolveRef(sales, 'ref:s?key=target&x=Jan')).toMatchObject({ ok: false, code: 'ref_no_match' })
  })
  it('takes a CardRef object as well as its text', () => {
    expect(ok(resolveRef(sales, { target: 's', params: { x: ['Jan'] } })).rows).toEqual([0, 3])
  })
  it('reads date prefixes and ranges as whole periods', () => {
    expect(ok(resolveRef(daily, 'ref:d?x=2026-03')).rows).toEqual([1, 2, 3])
    expect(ok(resolveRef(daily, 'ref:d?x=2026-02..2026-03')).rows).toEqual([0, 1, 2, 3])
    expect(ok(resolveRef(daily, 'ref:d?x=2026-03-15')).label).toBe('date 2026-03-15, visits 9')
    expect(ok(resolveRef(daily, 'ref:d?x=2026-04..')).rows).toEqual([4])
  })
  it('reads numbers on a numeric x', () => {
    const spec = { type: 'scatter', x: 'w', y: 'h', data: [{ w: 1, h: 2 }, { w: 5, h: 3 }, { w: 9, h: 1 }] }
    expect(ok(resolveRef(spec, 'ref:p?x=2..9')).rows).toEqual([1, 2])
    expect(resolveRef(spec, 'ref:p?x=big')).toMatchObject({ ok: false, code: 'ref_bad_value' })
    expect(resolveRef(spec, 'ref:p?x=9..2')).toMatchObject({ ok: false, code: 'ref_bad_value' })
  })
  it('names each column of a wide y as its own series', () => {
    const wide = { type: 'bar', x: 'q', y: ['north', 'south'], data: [{ q: 'Q1', north: 3, south: 9 }, { q: 'Q2', north: 7, south: 2 }] }
    const m = ok(resolveRef(wide, 'ref:w?series=south&y=5..'))
    expect(m.points).toEqual([{ row: 0, series: 'south' }])
    expect(ok(resolveRef(wide, 'ref:w?x=Q2')).points).toEqual([{ row: 1, series: 'north' }, { row: 1, series: 'south' }])
  })
  it('matches a timeline span by overlap and lanes by y', () => {
    const t = ex('timeline')
    const m = ok(resolveRef(t, `ref:t?x=${encodeURIComponent(String(t.data[0][t.start]).slice(0, 7))}`))
    expect(m.rows).toContain(0)
    const lane = String(t.data[0][t.y])
    expect(ok(resolveRef(t, formatCardRef({ target: 't', params: { y: [lane] } })!)).rows.every(i => String(t.data[i][t.y]) === lane)).toBe(true)
  })
  it('reports coded failures', () => {
    expect(resolveRef(sales, 'nope')).toMatchObject({ ok: false, code: 'ref_invalid' })
    expect(resolveRef(sales, { target: '', params: {} })).toMatchObject({ ok: false, code: 'ref_invalid' })
    expect(resolveRef({ type: 'bar' }, 'ref:s')).toMatchObject({ ok: false, code: 'ref_spec_invalid' })
    expect(resolveRef(sales, 'ref:s?colour=red')).toMatchObject({ ok: false, code: 'ref_param_unknown' })
    expect(resolveRef(ex('sankey'), 'ref:s?series=x')).toMatchObject({ ok: false, code: 'ref_param_unsupported' })
    expect(resolveRef(sales, 'ref:s?x=Dec')).toMatchObject({ ok: false, code: 'ref_no_match' })
    const hidden = resolveRef(sales, 'ref:s?x=Jan&series=US', { hidden: ['US'] })
    expect(hidden).toMatchObject({ ok: false, code: 'ref_hidden_series', series: ['US'] })
    // Hidden points are left out of a match that has others.
    expect(ok(resolveRef(sales, 'ref:s?x=Jan', { hidden: ['US'] })).rows).toEqual([0])
  })
  it('works on the data after transform', () => {
    const spec = { ...sales, transform: [{ filter: { field: 'region', oneOf: ['US'] } }] }
    const v = validatePlot(spec)
    expect(v.ok).toBe(true)
    const m = ok(resolveRef(spec, 'ref:s?x=Mar'))
    expect(m.rows.map(i => v.spec!.data[i].id)).toEqual(['f'])
  })
  it('answers for every example in the catalog', () => {
    for (const c of chartCatalog()) {
      const r = resolveRef(c.example, 'ref:any')
      expect(r.ok, c.type).toBe(true)
    }
  })
})

describe('Mark.rows and matchMarks', () => {
  it('lists the rows every data mark draws, for every chart type', () => {
    for (const c of chartCatalog()) {
      const scene = compile(c.example)
      const data = scene.marks.filter(m => (m.role === 'data' || m.role === 'hit') && (m.tip || m.aria))
      expect(data.some(m => m.rows && m.rows.length > 0), c.type).toBe(true)
    }
  })
  it('outlines the bars of a match and shows one tooltip', () => {
    const scene = compile(sales)
    const m = matchMarks(scene, ok(resolveRef(sales, 'ref:s?x=Mar&series=US')))
    expect(m.marks).toHaveLength(1)
    const bar = scene.marks[m.marks[0]]
    expect(bar.rows).toEqual([5])
    expect(m.tip).toBe(m.marks[0])
    expect(m.focus).toBe(m.marks[0])
  })
  it('outlines annotations by key', () => {
    const scene = compile(sales)
    const m = matchMarks(scene, ok(resolveRef(sales, 'ref:s?key=target')))
    expect(m.marks.length).toBeGreaterThan(0)
    expect(m.marks.every(i => scene.marks[i].role === 'annotation' && scene.marks[i].key === 'target')).toBe(true)
  })
  it('rings matched points on a line instead of outlining the whole line', () => {
    const scene = compile(daily)
    const m = matchMarks(scene, ok(resolveRef(daily, 'ref:d?x=2026-03-15')))
    expect(m.rings).toHaveLength(1)
    expect(m.marks.every(i => scene.marks[i].type !== 'path')).toBe(true)
    const whole = matchMarks(scene, ok(resolveRef(daily, 'ref:d')))
    expect(whole.marks.some(i => scene.marks[i].type === 'path')).toBe(true)
  })
  it('puts merged pie slices on the Other slice', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ k: `s${i}`, v: 100 - i }))
    const spec = { type: 'pie', label: 'k', value: 'v', data }
    const scene = compile(spec)
    const m = matchMarks(scene, ok(resolveRef(spec, 'ref:p?x=s9')))
    expect(m.marks).toHaveLength(1)
    expect((scene.marks[m.marks[0]].datum as { label: string }).label).toBe('Other')
  })
  it('keeps rows through facets', () => {
    const { series: _s, ...rest } = sales
    const spec = { ...rest, facet: 'region' }
    const scene = compile(spec)
    const m = matchMarks(scene, ok(resolveRef(spec, 'ref:s?key=f')))
    expect(m.marks).toHaveLength(1)
  })
})

describe('markRef', () => {
  it('names a mark by row ids, by x and series, or by annotation key', () => {
    const scene = compile(sales)
    const v = validatePlot(sales).spec!
    const bar = scene.marks.find(m => m.role === 'data' && m.rows?.length === 1 && m.rows[0] === 5)!
    expect(markRef(v, bar, 'sales')).toEqual({ target: 'sales', params: { key: ['f'] } })
    const { key: _k, ...noKey } = sales
    const v2 = validatePlot(noKey).spec!
    expect(markRef(v2, bar, 'sales')).toEqual({ target: 'sales', params: { x: ['Mar'], series: ['US'] } })
    const note = scene.marks.find(m => m.role === 'annotation' && m.key === 'target')!
    expect(markRef(v, note, 'sales')).toEqual({ target: 'sales', params: { key: ['target'] } })
    // And back again: the reference matches the mark.
    const back = matchMarks(scene, ok(resolveRef(sales, formatCardRef(markRef(v2, bar, 'sales')!)!)))
    expect(back.marks.map(i => scene.marks[i])).toContain(bar)
  })
})

describe('row ids and agent annotations in the spec', () => {
  it('warns about missing and repeated row ids', () => {
    const spec = { type: 'bar', x: 'm', y: 'v', key: 'id', data: [{ id: 'a', m: 'x', v: 1 }, { id: 'a', m: 'y', v: 2 }, { m: 'z', v: 3 }] }
    const codes = validatePlot(spec).issues.map(i => i.code)
    expect(codes).toContain('key_duplicate')
    expect(codes).toContain('key_missing')
  })
  it('checks annotation key, note and by', () => {
    const base = { type: 'line', x: 'x', y: 'y', data: [{ x: 1, y: 1 }, { x: 2, y: 3 }] }
    const issues = (annotations: unknown[]) => validatePlot({ ...base, annotations }).issues.map(i => `${i.code}@${i.path}`)
    expect(issues([{ axis: 'y', value: 2, key: 'a' }, { axis: 'y', value: 1, key: 'a' }])).toContain('duplicate@annotations[1].key')
    expect(issues([{ axis: 'y', value: 2, by: 'robot' }])).toContain('bad_enum@annotations[0].by')
    expect(issues([{ axis: 'y', value: 2, note: 4 }])).toContain('bad_type@annotations[0].note')
    expect(issues([{ axis: 'y', value: 2, key: ' ' }])).toContain('bad_type@annotations[0].key')
    const long = validatePlot({ ...base, annotations: [{ axis: 'y', value: 2, note: 'n'.repeat(3000) }] })
    expect(long.issues.map(i => i.code)).toContain('string_truncated')
    expect(long.spec!.annotations[0].note).toHaveLength(2048)
  })
  it('marks assistant annotations with a glyph, a tooltip note and the description', () => {
    const spec = {
      type: 'line', x: 'x', y: 'y', data: [{ x: 1, y: 1 }, { x: 2, y: 3 }],
      annotations: [{ axis: 'y', value: 2, label: 'Mean', key: 'mean', by: 'assistant', note: 'The average of both points.' }]
    }
    const scene = compile(spec)
    const label = scene.marks.find(m => m.type === 'text' && m.role === 'annotation' && m.key === 'mean')!
    expect(label.type === 'text' && label.text.startsWith('✦ ')).toBe(true)
    expect(label.tip?.rows.map(r => r.label)).toEqual(['The average of both points.', 'Added by the assistant'])
    // One keyboard stop per annotation: only the label carries the tooltip.
    expect(scene.marks.filter(m => m.role === 'annotation' && m.tip).length).toBe(1)
    expect((describePlot(spec) as { text: string }).text).toContain('The assistant marked "Mean" at y 2')
    expect(renderToSvg(spec)).toContain('✦ Mean')
  })
})
