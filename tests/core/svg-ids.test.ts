import { describe, expect, it } from 'vitest'
import { renderToSvg } from '../../packages/core/src'

const bar = { type: 'bar', title: 'Revenue', x: 'k', y: 'v', data: [{ k: 'a', v: 3 }, { k: 'b', v: 5 }] }
const line = { type: 'line', title: 'Visits', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }] }
const ids = (svg: string): string[] => [...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1])

describe('default SVG ids', () => {
  it('differ between two charts, so one page can hold several (aria-labelledby reads its own title)', () => {
    const a = renderToSvg(bar)
    const b = renderToSvg(line)
    const [ta, da] = ids(a)
    const [tb, db] = ids(b)
    expect(a).toContain(`aria-labelledby="${ta} ${da}"`)
    expect(ta).toMatch(/^sp[0-9a-z]+-t$/)
    expect(new Set([ta, da, tb, db]).size).toBe(4)
    expect(ids(a).filter(i => ids(b).includes(i))).toEqual([])
  })
  it('are derived from the drawing: the same spec writes the same bytes, another size or theme another prefix', () => {
    expect(renderToSvg(bar)).toBe(renderToSvg(bar))
    expect(ids(renderToSvg(bar, { width: 500 }))[0]).not.toBe(ids(renderToSvg(bar))[0])
    expect(ids(renderToSvg(bar, { theme: 'dark' }))[0]).not.toBe(ids(renderToSvg(bar))[0])
  })
  it('idPrefix still names them', () => {
    const svg = renderToSvg(bar, { idPrefix: 'rev' })
    expect(ids(svg).slice(0, 2)).toEqual(['rev-t', 'rev-d'])
    expect(svg).toContain('aria-labelledby="rev-t rev-d"')
  })
})
