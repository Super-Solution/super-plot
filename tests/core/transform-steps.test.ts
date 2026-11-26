import { describe, expect, it } from 'vitest'
import { validatePlot, applyTransform, type Issue } from '../../packages/core/src'

type R = Record<string, unknown>
const run = (steps: unknown[], rows: R[]): { rows: R[] | null; issues: Issue[] } => {
  const issues: Issue[] = []
  return { rows: applyTransform(steps, rows, issues), issues }
}
const first = (steps: unknown[], rows: R[]): Pick<Issue, 'code' | 'path' | 'severity'> => {
  const { issues } = run(steps, rows)
  return { code: issues[0].code, path: issues[0].path, severity: issues[0].severity }
}

const sales: R[] = [
  { d: '2026-01-03', r: 'APAC', v: 10 }, { d: '2026-01-01', r: 'EMEA', v: 4 }, { d: '2026-01-02', r: 'APAC', v: 'n/a' },
  { d: '2026-01-01', r: 'APAC', v: 6 }, { d: '2026-01-02', r: 'EMEA', v: 8 }, { d: '2026-01-04', r: 'APAC', v: 12 }
]

describe('bin', () => {
  it('adds start and end columns with round edges; maxbins is a real maximum', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ v: i }))
    const out = run([{ bin: { field: 'v', maxbins: 10 } }], rows).rows!
    expect(out[0]).toEqual({ v: 0, v_start: 0, v_end: 2 })
    expect(out[13]).toEqual({ v: 13, v_start: 12, v_end: 14 })
    expect(new Set(out.map(r => r.v_start)).size).toBeLessThanOrEqual(10)
    const custom = run([{ bin: { field: 'v', step: 5, as: ['lo', 'hi'] } }], rows).rows!
    expect(custom.map(r => r.lo)).toEqual([0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 10, 10, 10, 10])
    expect(custom[13].hi).toBe(15)
  })
  it('a value that is not a number gets null bins, with a warning; checks its fields', () => {
    const r = run([{ bin: { field: 'v' } }], sales)
    expect(r.rows![2]).toMatchObject({ v_start: null, v_end: null })
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'some_not_numeric', path: 'transform[0].bin.field', severity: 'warning' }))
    expect(first([{ bin: { field: 'r' } }], sales)).toEqual({ code: 'not_numeric', path: 'transform[0].bin.field', severity: 'error' })
    expect(first([{ bin: { field: 'v', maxbins: 0 } }], sales)).toEqual({ code: 'bad_value', path: 'transform[0].bin.maxbins', severity: 'error' })
    expect(first([{ bin: { field: 'v', step: -1 } }], sales)).toEqual({ code: 'bad_value', path: 'transform[0].bin.step', severity: 'error' })
    expect(first([{ bin: { field: 'v', step: 0.001 } }], sales)).toEqual({ code: 'too_many_bins', path: 'transform[0].bin.step', severity: 'error' })
    expect(first([{ bin: { field: 'v', as: ['a', 'a'] } }], sales)).toEqual({ code: 'bad_type', path: 'transform[0].bin.as', severity: 'error' })
    expect(first([{ bin: { field: 'v', bins: 3 } }], sales)).toMatchObject({ code: 'unknown_field', path: 'transform[0].bin.bins' })
  })
})

describe('window', () => {
  const op = (o: R): unknown[] => run([{ window: { field: 'v', as: 'w', groupBy: ['r'], sortBy: 'd', ...o } }], sales).rows!.map(r => r.w)
  it('runs cumulative ops in sort order within each group; rows keep their order', () => {
    // APAC by date: 6 (01), n/a (02), 10 (03), 12 (04); EMEA: 4 (01), 8 (02).
    expect(op({ op: 'sum' })).toEqual([16, 4, 6, 6, 12, 28])
    expect(op({ op: 'mean' })).toEqual([8, 4, 6, 6, 6, 28 / 3])
    expect(op({ op: 'count' })).toEqual([3, 1, 2, 1, 2, 4])
    expect(op({ op: 'lag' })).toEqual(['n/a', null, 6, null, 4, 10])
    expect(op({ op: 'lead' })).toEqual([12, 8, 10, 'n/a', null, null])
    expect(op({ op: 'pctChange' })).toEqual([null, null, null, null, 1, 0.2])
    expect(op({ op: 'movingMean', frame: 2 })).toEqual([10, 4, 6, 6, 6, 11])
    expect(op({ op: 'sum', order: 'desc' })).toEqual([22, 12, 22, 28, 8, 12])
  })
  it('ema smooths with alpha = 2 / (frame + 1), skips a gap without resetting, and starts from the first number', () => {
    const e = (rows: R[], o: R = {}): unknown[] => run([{ window: { op: 'ema', field: 'v', as: 'e', ...o } }], rows).rows!.map(r => r.e)
    // frame 3 -> alpha 0.5: 10, then 0.5 * 20 + 0.5 * 10 = 15, then 0.5 * 30 + 0.5 * 15 = 22.5.
    expect(e([{ v: 10 }, { v: 20 }, { v: 30 }])).toEqual([10, 15, 22.5])
    // frame 1 -> alpha 1: the series itself. frame 9 -> alpha 0.2.
    expect(e([{ v: 4 }, { v: 8 }], { frame: 1 })).toEqual([4, 8])
    expect(e([{ v: 100 }, { v: 0 }], { frame: 9 })).toEqual([100, 80])
    // Before the first number and at a gap: null, and the average carries on unchanged.
    expect(e([{ v: null }, { v: 10 }, { v: 'n/a' }, { v: 20 }])).toEqual([null, 10, null, 15])
    // Per group, in sort order, rows keep their order.
    expect(op({ op: 'ema', frame: 3 })).toEqual([8, 4, null, 6, 6, 10])
  })
  it('rank is the standard competition rank of the sort key; without sortBy it ranks the field', () => {
    const rows = [{ k: 'a', s: 3 }, { k: 'b', s: 1 }, { k: 'c', s: 3 }, { k: 'd', s: 2 }, { k: 'e', s: null }]
    expect(run([{ window: { op: 'rank', field: 's', as: 'rk' } }], rows).rows!.map(r => r.rk)).toEqual([3, 1, 3, 2, null])
    expect(run([{ window: { op: 'rank', field: 's', as: 'rk', order: 'desc' } }], rows).rows!.map(r => r.rk)).toEqual([1, 4, 1, 3, null])
  })
  it('pctChange is against the previous value, divided by its size; null after 0', () => {
    const rows = [{ t: 1, v: -10 }, { t: 2, v: -5 }, { t: 3, v: 0 }, { t: 4, v: 3 }]
    expect(run([{ window: { op: 'pctChange', field: 'v', as: 'p', sortBy: 't' } }], rows).rows!.map(r => r.p)).toEqual([null, 0.5, 1, null])
  })
  it('checks its fields with codes and paths', () => {
    const w = (o: R): ReturnType<typeof first> => first([{ window: { op: 'sum', field: 'v', as: 'w', ...o } }], sales)
    expect(w({ op: 'cumsum' })).toEqual({ code: 'bad_enum', path: 'transform[0].window.op', severity: 'error' })
    expect(first([{ window: { field: 'v', as: 'w' } }], sales)).toEqual({ code: 'missing_required', path: 'transform[0].window.op', severity: 'error' })
    expect(first([{ window: { op: 'sum', field: 'v' } }], sales)).toEqual({ code: 'missing_required', path: 'transform[0].window.as', severity: 'error' })
    expect(w({ field: 'vv' })).toEqual({ code: 'no_such_column', path: 'transform[0].window.field', severity: 'error' })
    expect(w({ sortBy: 'date' })).toEqual({ code: 'no_such_column', path: 'transform[0].window.sortBy', severity: 'error' })
    expect(w({ groupBy: ['r', 'x'] })).toEqual({ code: 'no_such_column', path: 'transform[0].window.groupBy[1]', severity: 'error' })
    expect(w({ order: 'descending' })).toEqual({ code: 'bad_enum', path: 'transform[0].window.order', severity: 'error' })
    expect(w({ frame: 0 })).toEqual({ code: 'bad_value', path: 'transform[0].window.frame', severity: 'error' })
    expect(w({ frame: 3 })).toEqual({ code: 'frame_ignored', path: 'transform[0].window.frame', severity: 'warning' })
    expect(w({ order: 'asc' })).toEqual({ code: 'order_ignored', path: 'transform[0].window.order', severity: 'warning' })
    expect(w({ as: '' })).toEqual({ code: 'bad_type', path: 'transform[0].window.as', severity: 'error' })
    expect(w({ cumulative: true })).toMatchObject({ code: 'unknown_field', path: 'transform[0].window.cumulative' })
  })
})

describe('fold', () => {
  const wide: R[] = [{ region: 'APAC', Q1: 1, Q2: 2 }, { region: 'EMEA', Q1: 3 }]
  it('turns columns into key/value rows and drops the folded columns', () => {
    expect(run([{ fold: { fields: ['Q1', 'Q2'] } }], wide).rows).toEqual([
      { region: 'APAC', key: 'Q1', value: 1 }, { region: 'APAC', key: 'Q2', value: 2 },
      { region: 'EMEA', key: 'Q1', value: 3 }, { region: 'EMEA', key: 'Q2', value: null }
    ])
    const r = validatePlot({ type: 'bar', x: 'region', y: 'revenue', series: 'quarter', data: wide, transform: [{ fold: { fields: ['Q1', 'Q2'], as: ['quarter', 'revenue'] } }] })
    expect(r.ok).toBe(true)
    // A later step and the chart see the new columns, not the folded ones.
    expect(first([{ fold: { fields: ['Q1', 'Q2'] } }, { sort: { field: 'Q1' } }], wide)).toEqual({ code: 'no_such_column', path: 'transform[1].sort.field', severity: 'error' })
  })
  it('checks its fields with codes and paths', () => {
    expect(first([{ fold: {} }], wide)).toEqual({ code: 'missing_required', path: 'transform[0].fold.fields', severity: 'error' })
    expect(first([{ fold: { fields: [] } }], wide)).toEqual({ code: 'bad_type', path: 'transform[0].fold.fields', severity: 'error' })
    expect(first([{ fold: { fields: ['Q1', 'Q3'] } }], wide)).toEqual({ code: 'no_such_column', path: 'transform[0].fold.fields[1]', severity: 'error' })
    expect(first([{ fold: { fields: ['Q1', 'Q1'] } }], wide)).toEqual({ code: 'duplicate', path: 'transform[0].fold.fields[1]', severity: 'error' })
    expect(first([{ fold: { fields: ['Q1'], as: ['k'] } }], wide)).toEqual({ code: 'bad_type', path: 'transform[0].fold.as', severity: 'error' })
    const many = Array.from({ length: 30_000 }, (_, i) => ({ a: i, b: i }))
    expect(first([{ fold: { fields: ['a', 'b'] } }], many)).toEqual({ code: 'too_many_rows', path: 'transform[0].fold', severity: 'error' })
  })
})

describe('pipelines', () => {
  it('fold, bin, aggregate and window chain; the result is deterministic', () => {
    const steps = [
      { fold: { fields: ['a', 'b'], as: ['k', 'v'] } },
      { bin: { field: 'v', maxbins: 4, as: ['from', 'to'] } },
      { aggregate: { groupBy: ['k', 'from'], count: 'n' } },
      { window: { op: 'sum', field: 'n', as: 'cum', groupBy: ['k'], sortBy: 'from' } }
    ]
    const rows = Array.from({ length: 40 }, (_, i) => ({ a: (i * 37) % 23, b: (i * 11) % 17 }))
    const a = run(steps, rows)
    expect(a.issues).toEqual([])
    expect(run(steps, rows).rows).toEqual(a.rows)
    const last = (k: string): unknown => Math.max(...a.rows!.filter(r => r.k === k).map(r => r.cum as number))
    expect(last('a')).toBe(40)
    expect(last('b')).toBe(40)
  })
  it('the step names are suggested when misspelt, and there is no expression step', () => {
    expect(validatePlot({ type: 'bar', x: 'r', y: 'v', data: sales, transform: [{ windo: {} }] }).issues[0]).toMatchObject({ code: 'bad_transform', hint: 'Did you mean "window"?' })
    expect(validatePlot({ type: 'bar', x: 'r', y: 'v', data: sales, transform: [{ calculate: 'datum.v * 2', as: 'w' }] }).issues[0]).toMatchObject({ code: 'bad_transform', path: 'transform[0]' })
  })
})
