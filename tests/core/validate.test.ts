import { describe, expect, it } from 'vitest'
import { validatePlot, chartCatalog, plotJsonSchema, PlotSpecError, compileOrThrow } from '../../packages/core/src'
import Ajv from 'ajv/dist/2020'

const data = [{ region: 'APAC', revenue: 120, q: 'Q1' }, { region: 'EMEA', revenue: 98, q: 'Q1' }]
const codes = (s: unknown): string[] => validatePlot(s).issues.map(i => i.code)

describe('validation', () => {
  it('accepts a minimal spec and fills defaults', () => {
    const r = validatePlot({ type: 'bar', data, x: 'region', y: 'revenue' })
    expect(r.ok).toBe(true)
    expect(r.spec).toMatchObject({ stack: 'none', orientation: 'vertical', legend: 'auto', tooltip: true })
  })
  it('accepts a JSON string and reports bad JSON', () => {
    expect(validatePlot(JSON.stringify({ type: 'bar', data, x: 'region', y: 'revenue' })).ok).toBe(true)
    expect(codes('{nope')).toEqual(['invalid_json'])
  })
  it('suggests the chart type', () => {
    const r = validatePlot({ type: 'barr', data })
    expect(r.issues[0]).toMatchObject({ code: 'unknown_type', hint: expect.stringContaining('"bar"') })
  })
  it('reports every problem at once, with paths and hints', () => {
    const r = validatePlot({ type: 'bar', data, x: 'regoin', y: 'revenu', stak: 'stack', legend: 'rigth' })
    expect(r.ok).toBe(false)
    const by = Object.fromEntries(r.issues.map(i => [i.path, i]))
    expect(by.x).toMatchObject({ code: 'no_such_column' })
    expect(by.x.hint).toContain('Did you mean "region"')
    expect(by.y.hint).toContain('Did you mean "revenue"')
    expect(by.stak).toMatchObject({ code: 'unknown_field', hint: 'Did you mean "stack"?' })
    expect(by.legend.code).toBe('bad_enum')
    expect(by.legend.hint).toBe('Did you mean "right"?')
  })
  it('lists available columns when a column is missing', () => {
    expect(validatePlot({ type: 'bar', data, x: 'nope', y: 'revenue' }).issues[0].hint).toContain('Available columns: region, revenue, q')
  })
  it('requires required fields and points at an example', () => {
    const r = validatePlot({ type: 'bar', data })
    expect(r.issues.filter(i => i.code === 'missing_required').map(i => i.path).sort()).toEqual(['x', 'y'])
  })
  it('rejects non-numeric columns and warns on partial ones', () => {
    expect(codes({ type: 'bar', data, x: 'region', y: 'region' })).toContain('not_numeric')
    const r = validatePlot({ type: 'bar', data: [{ a: 'x', v: 1 }, { a: 'y', v: 'oops' }], x: 'a', y: 'v' })
    expect(r.ok).toBe(true)
    expect(r.issues[0]).toMatchObject({ severity: 'warning', code: 'some_not_numeric' })
  })
  it('accepts numeric strings', () => {
    expect(validatePlot({ type: 'bar', data: [{ a: 'x', v: '1,5' }, { a: 'y', v: '2.5' }], x: 'a', y: 'v' }).issues.map(i => i.code)).toEqual(['some_not_numeric'])
  })
  it('limits rows and requires data', () => {
    expect(codes({ type: 'bar', x: 'a', y: 'b' })).toContain('missing_required')
    expect(codes({ type: 'bar', data: [], x: 'a', y: 'b' })).toContain('empty_data')
    expect(codes({ type: 'bar', data: new Array(50_001).fill({ a: 1, b: 1 }), x: 'a', y: 'b' })).toContain('too_many_rows')
    expect(codes({ type: 'bar', data: [1, 2], x: 'a', y: 'b' })).toContain('bad_type')
  })
  it('refuses colours that are not plain colours', () => {
    const r = validatePlot({ type: 'bar', data, x: 'region', y: 'revenue', colors: { APAC: 'red;background:url(http://evil)' } })
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toMatchObject({ code: 'bad_color', path: 'colors.APAC' })
  })
  it('checks annotations', () => {
    const r = validatePlot({ type: 'bar', data, x: 'region', y: 'revenue', annotations: [{ axis: 'z', value: 1 }, { axis: 'y', value: 1, bogus: 1 }] })
    expect(r.issues.map(i => i.code).sort()).toEqual(['bad_enum', 'unknown_field'])
  })
  it('checks ranges and formats', () => {
    expect(codes({ type: 'pie', data, label: 'region', value: 'revenue', maxSlices: 99 })).toContain('out_of_range')
    expect(codes({ type: 'bar', data, x: 'region', y: 'revenue', format: 'percentage' })).toContain('bad_format')
    expect(codes({ type: 'bar', data, x: 'region', y: 'revenue', yDomain: [5, 1] })).toContain('bad_value')
  })
  it('throws a readable error from the throwing API', () => {
    expect(() => compileOrThrow({ type: 'bar', data, x: 'nope', y: 'revenue' })).toThrow(PlotSpecError)
    try {
      compileOrThrow({ type: 'bar', data, x: 'nope', y: 'revenue' })
    } catch (e) {
      expect((e as Error).message).toContain('Column "nope" does not exist')
    }
  })
})

describe('catalog and schema', () => {
  const ajv = new Ajv({ strict: false })
  const schema = plotJsonSchema()
  const validate = ajv.compile(schema)
  it('every example validates against our validator and the JSON Schema', () => {
    for (const info of chartCatalog()) {
      const r = validatePlot(info.example)
      expect(r.issues.filter(i => i.severity === 'error'), info.type).toEqual([])
      const ok = validate(JSON.parse(JSON.stringify(info.example)))
      expect(ok, `${info.type}: ${JSON.stringify(validate.errors?.slice(0, 2))}`).toBe(true)
    }
  })
  it('the schema rejects what the validator rejects', () => {
    expect(validate({ type: 'bar', data, x: 'a', y: 'b', stak: 'stack' })).toBe(false)
    expect(validate({ type: 'bar', data, x: 'a', y: 'b', legend: 'sideways' })).toBe(false)
    expect(validate({ type: 'bar', x: 'a', y: 'b' })).toBe(false)
  })
  it('lists every chart type with guidance for an agent', () => {
    const types = chartCatalog().map(c => c.type)
    expect(types).toEqual(['bar', 'line', 'area', 'scatter', 'pie', 'donut', 'histogram', 'box', 'violin', 'heatmap', 'calendar', 'waterfall', 'bullet', 'bump', 'radar', 'treemap', 'sunburst', 'sankey', 'parallel', 'funnel', 'choropleth', 'bubble-map', 'column-map', 'flow-map'])
    for (const c of chartCatalog()) {
      expect(c.useWhen.length).toBeGreaterThan(40)
      expect(c.fields.find(f => f.name === 'data')?.required).toBe(true)
    }
  })
})
