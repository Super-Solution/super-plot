import { describe, expect, it } from 'vitest'
import { compilePlot, isValueFormat, validatePlot, valueFormatter } from '../../packages/core/src'

const fmt = (f: string, locale = 'en') => valueFormatter(f, locale)

describe('format modifiers', () => {
  it('currency:CODE:compact abbreviates large amounts, with no padding zeros', () => {
    expect(fmt('currency:USD:compact')(61.25e9)).toBe('$61.3B')
    expect(fmt('currency:USD:compact')(950)).toBe('$950')
    expect(fmt('currency:USD:compact')(-1500)).toBe('-$1.5K')
  })
  it(':narrow uses the narrow symbol where the locale would say US$', () => {
    expect(fmt('currency:USD:narrow', 'zh-TW')(3.4)).toBe('$3.40')
    expect(fmt('currency:USD:compact:narrow', 'zh-TW')(2e9)).toMatch(/^\$/)
    expect(fmt('currency:CAD:narrow')(5)).toBe('$5.00')
    expect(fmt('currency:CAD')(5)).toBe('CA$5.00')
  })
  it('percent:N shows exactly N decimals', () => {
    expect(fmt('percent:1')(0.6432)).toBe('64.3%')
    expect(fmt('percent:0')(0.5)).toBe('50%')
    expect(fmt('percent:2')(0.0123)).toBe('1.23%')
  })
  it('a ~suffix follows every value, and the axis ticks too', () => {
    expect(fmt('integer~ days')(92.4)).toBe('92 days')
    expect(fmt('currency:USD:compact~/yr')(2e9)).toBe('$2B/yr')
    const r = compilePlot({ type: 'line', x: 'q', y: ['a'], format: 'integer~ d', data: [{ q: 'x', a: 40 }, { q: 'y', a: 90 }] }, { width: 600, height: 300 })
    if (!r.ok) throw new Error('compile')
    const ticks = r.scene.marks.filter(m => m.type === 'text' && (m as any).role === 'axis-label').map(m => (m as any).text as string)
    expect(ticks.some(t => /\d d$/.test(t))).toBe(true)
  })
  it('is validated: fixed order, a suffix of 1 to 16 characters without control characters', () => {
    for (const ok of ['currency:USD:compact:narrow~/yr', 'percent:1', 'integer~ days', 'currency:usd:narrow']) expect(isValueFormat(ok)).toBe(true)
    for (const bad of ['currency:USD:narrow:compact', 'integer~', 'integer~12345678901234567', 'integer~a~b', 'percent:12', 'compact:1', 'integer~\n']) expect(isValueFormat(bad)).toBe(false)
    expect(validatePlot({ type: 'bar', x: 'a', y: 'b', data: [{ a: 'x', b: 1 }], format: 'integer~' }).ok).toBe(false)
  })
})
