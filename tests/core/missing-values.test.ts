import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, renderToSvg, validatePlot, PlotSpecError } from '../../packages/core/src'

const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => i.code)
const pie = (data: unknown[], extra: object = {}): Record<string, unknown> => ({ type: 'pie', label: 'k', value: 'v', data, ...extra })

describe('pie and donut: nothing positive to draw', () => {
  it('all zero or negative: pie_no_positive with a hint, still valid', () => {
    const r = validatePlot(pie([{ k: 'a', v: 0 }, { k: 'b', v: -4 }]))
    expect(r.ok).toBe(true)
    expect(r.issues.map(i => i.code).sort()).toEqual(['negative_slices', 'pie_no_positive'])
    const i = r.issues.find(x => x.code === 'pie_no_positive')!
    expect(i).toMatchObject({ severity: 'warning', path: 'value' })
    expect(i.hint).toMatch(/bar chart/)
    expect(codes({ ...pie([{ k: 'a', v: 0 }]), type: 'donut' })).toEqual(['pie_no_positive'])
  })
  it('names zero slices and negative values when others are positive; says nothing when all is well', () => {
    expect(codes(pie([{ k: 'a', v: 3 }, { k: 'b', v: 0 }, { k: 'c', v: -1 }]))).toEqual(['negative_slices', 'zero_slices'])
    expect(codes(pie([{ k: 'a', v: 3 }, { k: 'b', v: 1 }]))).toEqual([])
    // Rows with one label are summed first: 5 and -5 are two rows (the negative is dropped), not 0.
    expect(codes(pie([{ k: 'a', v: 5 }, { k: 'a', v: -5 }]))).toEqual(['negative_slices'])
  })
  it('compile does not repeat what validation said, and draws the message in the middle', () => {
    const r = compilePlot(pie([{ k: 'a', v: 0 }, { k: 'b', v: -4 }]))
    expect(r.ok && r.issues.filter(i => i.code === 'negative_slices')).toHaveLength(1)
    expect(r.ok && r.scene.marks.some(m => m.type === 'text' && m.text === 'No positive values to show')).toBe(true)
    expect(r.ok && r.scene.marks.filter(m => m.role === 'data')).toHaveLength(0)
    const t = compilePlot(pie([{ k: 'a', v: 0 }]), { strings: { noPositive: 'Nichts zu zeigen' } })
    expect(t.ok && t.scene.marks.some(m => m.type === 'text' && m.text === 'Nichts zu zeigen')).toBe(true)
    const fine = compilePlot(pie([{ k: 'a', v: 2 }]))
    expect(fine.ok && fine.scene.marks.some(m => m.type === 'text' && m.text === 'No positive values to show')).toBe(false)
  })
  it('the description says nothing is drawn', () => {
    const d = describePlot(pie([{ k: 'a', v: 0 }, { k: 'b', v: -4 }]))
    expect(d.ok && d.text).toMatch(/1 slice totalling 0\. No slice has a positive value, so nothing is drawn\.$/)
  })
})

describe('bar: a category with no number is missing, not 0', () => {
  const bar = { type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 5 }, { k: 'b', v: Number.NaN }, { k: 'c', v: null }, { k: 'd', v: 3 }] }
  it('names it, and leaves it out of the lowest and the total', () => {
    const d = describePlot(bar)
    expect(d.ok && d.text).toBe('Bar chart. 4 categories. Highest: a (5). Lowest: d (3). Total: 8. Missing: b, c (no value, so not counted above).')
  })
  it('a category with a real 0 is still 0', () => {
    const d = describePlot({ ...bar, data: [{ k: 'a', v: 5 }, { k: 'b', v: 0 }] })
    expect(d.ok && d.text).toBe('Bar chart. 2 categories. Highest: a (5). Lowest: b (0). Total: 5.')
  })
})

describe('renderToSvg onInvalid', () => {
  it('throws by default, with issues an agent can read', () => {
    try {
      renderToSvg({ type: 'bar', x: 'k', y: 'v', data: [] })
      throw new Error('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(PlotSpecError)
      expect((e as PlotSpecError).issues[0].code).toBe('empty_data')
    }
  })
  it("'placeholder' draws why there is no chart, at the asked size, and never throws", () => {
    const svg = renderToSvg({ type: 'bar', x: 'k', y: 'v', data: [] }, { onInvalid: 'placeholder', width: 400, height: 200 })
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 400 200"/)
    expect(svg).toContain('This chart cannot be drawn')
    expect(svg).toContain('empty_data')
    expect(svg).toContain('role="img"')
    expect(renderToSvg('not json', { onInvalid: 'placeholder' })).toContain('invalid_json')
    expect(renderToSvg({ type: 'nope' }, { onInvalid: 'placeholder', strings: { chartUnavailable: 'Kein Diagramm' } })).toContain('Kein Diagramm')
  })
  it('a spec that draws is drawn the same either way', () => {
    const ok = { type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }] }
    expect(renderToSvg(ok, { onInvalid: 'placeholder' })).toBe(renderToSvg(ok))
  })
})
