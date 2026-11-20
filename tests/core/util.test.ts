import { describe, expect, it } from 'vitest'
import { linearTicks, niceDomain, quantile, correlation, closest } from '../../packages/core/src/util/num'
import { pow10 } from '../../packages/core/src/util/num'
import { timeTicks, toTime } from '../../packages/core/src/util/time'
import { tickFormatter, valueFormatter } from '../../packages/core/src/util/format'
import { isSafeColor, mix, inkOn } from '../../packages/core/src/util/color'
import { resolveVars } from '../../packages/core/src/theme'
import { estimateWidth, fit } from '../../packages/core/src/util/text'
import { binEdges, binCounts } from '../../packages/core/src/charts/histogram'
import { boxStats } from '../../packages/core/src/charts/box'

describe('ticks', () => {
  it('gives round numbers', () => {
    expect(linearTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(linearTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(linearTicks(-3, 7, 5)).toEqual([-2, 0, 2, 4, 6])
  })
  it('widens a domain to tick boundaries', () => {
    expect(niceDomain(3, 97, 5)).toEqual([0, 100])
    expect(niceDomain(0.12, 0.93, 5)).toEqual([0, 1])
  })
  it('handles a flat domain', () => {
    expect(niceDomain(5, 5, 5)[0]).toBeLessThan(5)
    expect(niceDomain(0, 0, 5)).toEqual([0, 1])
  })
  it('does not accumulate float noise', () => {
    for (const t of linearTicks(0, 1, 10)) expect(String(t).length).toBeLessThan(6)
  })
})

describe('statistics', () => {
  it('quantiles match the R type 7 definition', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(quantile(v, 0.25)).toBe(3)
    expect(quantile(v, 0.5)).toBe(5)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
  })
  it('box stats put outliers beyond 1.5 IQR', () => {
    const s = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 30])!
    expect(s.median).toBe(5.5)
    expect(s.outliers).toEqual([30])
    expect(s.highWhisker).toBe(9)
    expect(s.n).toBe(10)
  })
  it('correlation is exact for a line', () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull()
  })
  it('histogram bins cover every value exactly once', () => {
    const values = Array.from({ length: 137 }, (_, i) => (i * 37) % 101)
    const edges = binEdges(values, 'auto')
    expect(edges[0]).toBeLessThanOrEqual(Math.min(...values))
    expect(edges[edges.length - 1]).toBeGreaterThanOrEqual(Math.max(...values))
    expect(binCounts(values, edges).reduce((a, b) => a + b, 0)).toBe(values.length)
  })
  it('the maximum lands in the last bin', () => {
    const edges = [0, 10, 20]
    expect(binCounts([0, 10, 20], edges)).toEqual([1, 2])
  })
  it('suggests close names', () => {
    expect(closest('revnue', ['region', 'revenue'])).toBe('revenue')
    expect(closest('zzzzzz', ['region', 'revenue'])).toBeUndefined()
  })
})

describe('time', () => {
  it('parses ISO dates as UTC', () => {
    expect(toTime('2026-11-19')).toBe(Date.UTC(2026, 10, 19))
    expect(toTime('2026-11')).toBe(Date.UTC(2026, 10, 1))
    expect(toTime('2026-11-19T10:30:00Z')).toBe(Date.UTC(2026, 10, 19, 10, 30))
    expect(toTime('hello')).toBeNull()
    expect(toTime('12')).toBeNull()
    // Strict and engine-independent: impossible dates and times are not times (V8 alone would accept some).
    expect(toTime('2026-02-30')).toBeNull()
    expect(toTime('2025-02-29')).toBeNull()
    expect(toTime('2024-02-29')).toBe(Date.UTC(2024, 1, 29))
    expect(toTime('2026-13-01')).toBeNull()
    expect(toTime('2026-01-01T25:00:00Z')).toBeNull()
    expect(toTime('2026-01-01T24:00:00Z')).toBeNull()
    expect(toTime('2026-01-01T10:00:61Z')).toBeNull()
    expect(toTime('2026-01-01T10:00+0530')).toBe(Date.UTC(2026, 0, 1, 4, 30))
    expect(toTime('2026-01-01 10:00:00.123456Z')).toBe(Date.UTC(2026, 0, 1, 10, 0, 0, 123))
    expect(toTime('2026-01-01T10:00:00')).toBe(Date.UTC(2026, 0, 1, 10))
  })
  it('ticks month starts for a year', () => {
    const t = timeTicks(Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31), 6, 'en')
    expect(t.length).toBeGreaterThanOrEqual(4)
    for (const x of t) expect(new Date(x.value).getUTCDate()).toBe(1)
    expect(t[0].label).toBe('2026')
  })
  it('ticks hours inside a day', () => {
    const t = timeTicks(Date.UTC(2026, 10, 19, 0), Date.UTC(2026, 10, 19, 23), 6, 'en')
    expect(t.length).toBeGreaterThan(3)
  })
})

describe('formatting', () => {
  it('formats values', () => {
    expect(valueFormatter('percent', 'en')(0.256)).toBe('25.6%')
    expect(valueFormatter('currency:USD', 'en')(1234567)).toBe('$1,234,567')
    expect(valueFormatter('compact', 'en')(48200)).toBe('48.2K')
    expect(valueFormatter('fixed:2', 'en')(3)).toBe('3.00')
  })
  it('shares one precision across ticks and keeps years plain', () => {
    const f = tickFormatter('auto', 'en', [0, 1], 5)
    expect(f(0.2)).toBe('0.2')
    expect(f(0)).toBe('0.0')
    expect(tickFormatter('auto', 'en', [2018, 2025], 7)(2020)).toBe('2020')
  })
})

describe('colour and text', () => {
  it('accepts plain colours and refuses anything that can escape', () => {
    for (const ok of ['#fff', '#2962FF', 'rgb(1, 2, 3)', 'hsl(10 20% 30%)', 'tomato', 'var(--brand)', 'var(--brand, #fff)']) expect(isSafeColor(ok)).toBe(true)
    for (const bad of ['red;background:url(x)', 'url(http://x)', '"><script>', 'expression(alert(1))', 'var(--x,url(y))', '#12345', 5, '']) expect(isSafeColor(bad)).toBe(false)
  })
  it('mixes and picks readable ink', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(inkOn('#FFFFFF')).toBe('#131722')
    expect(inkOn('#131722')).toBe('#FFFFFF')
  })
  it('resolves css variables to their fallback', () => {
    expect(resolveVars('var(--sp-text, #131722)')).toBe('#131722')
    expect(resolveVars('var(--a, var(--b, #fff))')).toBe('#fff')
  })
  it('measures CJK as full width and truncates with an ellipsis', () => {
    expect(estimateWidth('營收', 10)).toBe(20)
    const m = estimateWidth
    const s = fit('A very long category name', 60, 12, m)
    expect(s.endsWith('…')).toBe(true)
    expect(m(s, 12)).toBeLessThanOrEqual(60)
  })
})

describe('pow10', () => {
  it('is exact where Math.pow is not (the ticks of a narrow range depend on it)', () => {
    for (let k = -12; k <= 12; k++) expect(pow10(k)).toBe(Number(`1e${k}`))
    expect(pow10(-4)).toBe(0.0001)
    expect(pow10(-5)).toBe(0.00001)
  })
})

describe('currency digits', () => {
  it('come from our own table, so every runtime shows the same decimals', async () => {
    const { currencyDigits } = await import('../../packages/core/src/util/currency')
    const { CURRENCY_CODES } = await import('../../packages/core/src/util/currency-codes')
    expect(CURRENCY_CODES).toContain('USD')
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length)
    expect([currencyDigits('JPY'), currencyDigits('usd'), currencyDigits('KWD'), currencyDigits('XYZ')]).toEqual([0, 2, 3, 2])
    // CLDR changed these between Node 22 and Node 24; the table fixes them to 2.
    expect(valueFormatter('currency:COP', 'en')(1.5)).toMatch(/^COP\s1\.50$/)
    expect(valueFormatter('currency:JPY', 'en')(1.5)).toBe('¥1.5')
    expect(valueFormatter('currency:KWD', 'en')(1.5)).toMatch(/^KWD\s1\.50$/)
    expect(valueFormatter('currency:USD', 'en')(1234.5)).toBe('$1,235')
  })
})
