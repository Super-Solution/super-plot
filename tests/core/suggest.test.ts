import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../packages/core/src/index'
import { SUGGEST_RULES, SUGGEST_VERSION, profileColumns, suggestPlots } from '../../packages/core/src/suggest'
import { validatePlot } from '../../packages/core/src/validate'
import { getPlotTool } from '../../packages/core/src/tools'

const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
const sales = months.map((month, i) => ({ month, sales: 100 + i * 7, cost: 60 + i * 3 }))
const regions = ['APAC', 'EMEA', 'AMER', 'LATAM'].flatMap(region => ['Q1', 'Q2', 'Q3'].map((q, i) => ({ region, quarter: q, revenue: 50 + i * 10 + region.length })))
const people = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, height: 150 + (i * 7) % 40, weight: 50 + (i * 11) % 45, group: i % 3 ? 'a' : 'b' }))
const codes = (r: ReturnType<typeof suggestPlots>): string[] => r.suggestions.map(s => s.code)

describe('profileColumns', () => {
  it('tells numbers, times, categories, booleans and empty columns apart', () => {
    const p = profileColumns([{ d: '2026-01-02', n: 3, c: 'x', b: true, e: null }, { d: '2026-01-03', n: '4.5', c: 'y', b: false, e: '' }])
    expect(p.map(c => [c.name, c.kind])).toEqual([['d', 'time'], ['n', 'number'], ['c', 'category'], ['b', 'boolean'], ['e', 'empty']])
    expect(p[0].granularity).toBe('day')
    expect(p[1]).toMatchObject({ min: 3, max: 4.5, integer: false })
  })
  it('reads only the first rows', () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ v: i }))
    expect(profileColumns(rows)[0].rows).toBe(1000)
  })
})

describe('suggestPlots', () => {
  it('suggests a line for a time and a number, first, with the reason naming the columns', () => {
    const r = suggestPlots({ rows: sales })
    expect(r.ok).toBe(true)
    expect(r.version).toBe(SUGGEST_VERSION)
    expect(r.suggestions[0]).toMatchObject({ code: 'trend_line', type: 'line', spec: { type: 'line', x: 'month', y: ['sales', 'cost'] } })
    expect(r.suggestions[0].why).toContain('"month"')
    expect(r.suggestions[0].spec).not.toHaveProperty('data')
  })
  it('puts the charts that answer the intent first', () => {
    expect(codes(suggestPlots({ rows: regions, intent: 'compare' }))[0]).toBe('compare_bar')
    expect(codes(suggestPlots({ rows: regions, intent: 'composition' }))[0]).toBe('composition_stacked_bar')
    expect(codes(suggestPlots({ rows: people.map(({ height }) => ({ height })), intent: 'distribution' }))[0]).toBe('distribution_histogram')
    expect(codes(suggestPlots({ rows: people, intent: 'distribution' }))[0]).toBe('distribution_box')
    expect(codes(suggestPlots({ rows: people, intent: 'relationship' }))[0]).toBe('relationship_scatter')
    expect(codes(suggestPlots({ rows: [{ a: 'x', v: 3 }, { a: 'y', v: 5 }, { a: 'z', v: 1 }], intent: 'ranking' }))[0]).toBe('compare_bar')
  })
  it('does not use an identifier column as a measure and says so', () => {
    const r = suggestPlots({ rows: people })
    expect(r.issues.find(i => i.code === 'id_column_skipped')?.path).toBe('columns.id')
    for (const s of r.suggestions) expect(JSON.stringify(s.spec)).not.toContain('"id"')
  })
  it('a pie needs few, distinct parts that are not negative', () => {
    const parts = [{ k: 'a', v: 5 }, { k: 'b', v: 3 }, { k: 'c', v: 2 }]
    expect(codes(suggestPlots({ rows: parts }))).toContain('composition_pie')
    expect(codes(suggestPlots({ rows: [{ k: 'a', v: 5 }, { k: 'b', v: -3 }, { k: 'c', v: 2 }] }))).not.toContain('composition_pie')
    expect(codes(suggestPlots({ rows: Array.from({ length: 9 }, (_, i) => ({ k: `k${i}`, v: i + 1 })) }))).not.toContain('composition_pie')
  })
  it('keeps many categories readable: horizontal and the largest twelve', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ item: `Item ${i}`, n: i + 1 }))
    const bar = suggestPlots({ rows }).suggestions.find(s => s.code === 'compare_bar')!
    expect(bar.spec).toMatchObject({ orientation: 'horizontal', transform: [{ top: { n: 12, by: 'n' } }] })
    expect(bar.notes.join(' ')).toContain('12 largest')
  })
  it('splits a line by a category when rows share a time', () => {
    const rows = months.flatMap(month => ['a', 'b'].map((g, i) => ({ month, g, v: i + 1 })))
    const r = suggestPlots({ rows })
    expect(codes(r)[0]).toBe('trend_line_series')
    expect(r.suggestions[0].spec).toMatchObject({ x: 'month', y: 'v', series: 'g' })
  })
  it('offers a calendar only for a long run of days', () => {
    const days = Array.from({ length: 90 }, (_, i) => ({ day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), n: i % 7 }))
    expect(codes(suggestPlots({ rows: days, max: 8 }))).toContain('calendar_daily')
    expect(codes(suggestPlots({ rows: days.slice(0, 20), max: 8 }))).not.toContain('calendar_daily')
  })
  it('every suggestion validates once the rows are its data', () => {
    for (const rows of [sales, regions, people, [{ a: 'x', v: 3 }, { a: 'y', v: 5 }]]) {
      const r = suggestPlots({ rows, max: 8, includeData: true })
      expect(r.suggestions.length).toBeGreaterThan(0)
      for (const s of r.suggestions) {
        const v = validatePlot(s.spec)
        expect(v.ok, `${s.code}: ${JSON.stringify(v.issues)}`).toBe(true)
      }
    }
  })
  it('is deterministic: the same table gives the same bytes', () => {
    const a = JSON.stringify(suggestPlots({ rows: regions, max: 8 }))
    expect(JSON.stringify(suggestPlots({ rows: regions.map(r => ({ ...r })), max: 8 }))).toBe(a)
  })
  it('works from a profile and says it did not check the rows', () => {
    const r = suggestPlots({ columns: [{ name: 'when', kind: 'time', distinct: 24 }, { name: 'users', kind: 'number', min: 0 }], intent: 'trend' })
    expect(r.suggestions[0]).toMatchObject({ code: 'trend_line', spec: { x: 'when', y: 'users' } })
    expect(r.issues.map(i => i.code)).toContain('unvalidated')
  })
  it('answers bad input with a code, a path and a hint, never a throw', () => {
    for (const [input, code, path] of [
      [{}, 'missing_required', 'rows'],
      [{ rows: [] }, 'empty_data', 'rows'],
      [{ rows: [1] }, 'bad_type', 'rows'],
      [{ rows: sales, max: 0 }, 'bad_value', 'max'],
      [{ rows: sales, intent: 'pretty' }, 'bad_enum', 'intent'],
      [{ columns: [{ name: 'x', kind: 'weird' }] }, 'bad_type', 'columns[0]'],
      [null, 'bad_type', '']
    ] as const) {
      const r = suggestPlots(input as never)
      expect(r.ok).toBe(false)
      expect(r.issues[0]).toMatchObject({ severity: 'error', code, path })
      expect(r.issues[0].hint).toBeTruthy()
    }
  })
  it('says when nothing fits and when more were left out', () => {
    expect(suggestPlots({ rows: [{ note: 'hello' }] }).issues.map(i => i.code)).toContain('no_chart')
    expect(suggestPlots({ rows: regions, max: 1 }).issues.map(i => i.code)).toContain('more_available')
  })
  it('notes that rows are summed when a category repeats', () => {
    const bar = suggestPlots({ rows: regions }).suggestions.find(s => s.code === 'compare_bar')!
    expect(bar.notes.join(' ')).toContain('sum')
  })
})

describe('the rules are public', () => {
  it('each rule has a unique code, and every code is in INTEGRATION.md', () => {
    const doc = readFileSync('docs/INTEGRATION.md', 'utf8')
    expect(new Set(SUGGEST_RULES.map(r => r.code)).size).toBe(SUGGEST_RULES.length)
    for (const r of SUGGEST_RULES) expect(doc, r.code).toContain(`\`${r.code}\``)
  })
  it('is a read-only tool that returns the same as the function', () => {
    const t = getPlotTool('plot_suggest')!
    expect(t.authority).toBe('read')
    expect(t.run({ rows: sales, max: 2 })).toEqual(suggestPlots({ rows: sales, max: 2 }))
  })
})
