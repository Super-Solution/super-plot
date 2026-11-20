import { describe, expect, it } from 'vitest'
import { compilePlot, drawScene, buildHitIndex, resolveColor, dataMarkCount, type Canvas2D, type Scene } from '../../packages/core/src'

/** Records calls so we can assert what would be painted without a canvas. */
function recorder(): { ctx: Canvas2D; calls: string[]; fills: unknown[] } {
  const calls: string[] = []
  const fills: unknown[] = []
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '' }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'stroke', 'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash']) ctx[k] = () => calls.push(k)
  ctx.fill = () => { calls.push('fill'); fills.push(ctx.fillStyle) }
  return { ctx: ctx as unknown as Canvas2D, calls, fills }
}
const scene = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 400, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const scatter = (n: number): unknown => ({ type: 'scatter', x: 'x', y: 'y', data: Array.from({ length: n }, (_, i) => ({ x: (i * 37) % 997, y: (i * 91) % 883 })) })

describe('resolveColor', () => {
  it('takes the fallback, or a variable the host defines', () => {
    expect(resolveColor('var(--sp-text, #131722)')).toBe('#131722')
    expect(resolveColor('var(--sp-text, var(--sc-text, #111))')).toBe('#111')
    expect(resolveColor('var(--sp-text, var(--sc-text, #111))', n => (n === '--sc-text' ? '#abc' : undefined))).toBe('#abc')
    expect(resolveColor('var(--sp-text, var(--sc-text, #111))', n => (n === '--sp-text' ? ' red ' : '#abc'))).toBe('red')
    expect(resolveColor('#fff')).toBe('#fff')
    expect(resolveColor('var(--x)')).toBe('')
  })
})

describe('drawScene', () => {
  it('paints the background, the text, and resolves variables', () => {
    const { ctx, calls, fills } = recorder()
    drawScene(ctx, scene({ type: 'bar', x: 'a', y: 'b', title: 'T', data: [{ a: 'x', b: 1 }] }))
    expect(calls[0]).toBe('save')
    expect(calls).toContain('fillRect')
    expect(calls).toContain('fillText')
    expect(fills.every(f => typeof f === 'string' && !String(f).includes('var('))).toBe(true)
  })
  it('batches dots of the same style into one path', () => {
    const { ctx, calls } = recorder()
    const s = scene(scatter(2000))
    drawScene(ctx, s)
    expect(calls.filter(c => c === 'arc').length).toBeGreaterThanOrEqual(2000)
    // Far fewer fills than dots: one per style run, not one per dot.
    expect(calls.filter(c => c === 'fill').length).toBeLessThan(50)
  })
  it('skips path marks without a Path2D instead of throwing', () => {
    const { ctx } = recorder()
    expect(() => drawScene(ctx, scene({ type: 'pie', label: 'a', value: 'b', data: [{ a: 'x', b: 1 }, { a: 'y', b: 2 }] }))).not.toThrow()
  })
  it('draws 50,000 dots quickly', () => {
    const { ctx } = recorder()
    const s = scene(scatter(50000), { width: 900, height: 500 })
    const t = performance.now()
    drawScene(ctx, s)
    expect(performance.now() - t).toBeLessThan(250)
    expect(dataMarkCount(s)).toBeGreaterThanOrEqual(50000)
  })
})

describe('hit index', () => {
  it('finds the dot under the pointer and the topmost of overlapping ones', () => {
    const s = scene(scatter(300))
    const idx = buildHitIndex(s)
    const dots = s.marks.map((m, i) => ({ m, i })).filter(q => q.m.type === 'circle' && q.m.tip)
    for (const { m, i } of dots.slice(0, 20)) {
      if (m.type !== 'circle') continue
      const hit = idx.at(m.cx, m.cy)
      expect(hit).toBeGreaterThanOrEqual(i) // itself, or something drawn above it
    }
    expect(idx.at(-50, -50)).toBe(-1)
  })
  it('hits legend items and bars, and uses the path callback for slices', () => {
    const bar = scene({ type: 'bar', x: 'a', y: ['p', 'q'], data: [{ a: 'x', p: 1, q: 2 }] })
    const idx = buildHitIndex(bar)
    const legend = bar.marks.findIndex(m => m.legendKey === 'p')
    const lm = bar.marks[legend]
    if (lm.type !== 'rect') throw new Error('legend hit area should be a rect')
    expect(idx.at(lm.x + 2, lm.y + 2)).toBe(legend)
    const pie = scene({ type: 'pie', label: 'a', value: 'b', data: [{ a: 'x', b: 1 }, { a: 'y', b: 2 }] })
    const slice = pie.marks.findIndex(m => m.type === 'path' && m.tip)
    expect(buildHitIndex(pie).at(10, 10, i => i === slice)).toBe(slice)
    expect(buildHitIndex(pie).at(10, 10)).toBe(-1)
  })
  it('is fast on 50,000 marks', () => {
    const s = scene(scatter(50000), { width: 900, height: 500 })
    const idx = buildHitIndex(s)
    const t = performance.now()
    for (let i = 0; i < 1000; i++) idx.at((i * 7) % 900, (i * 13) % 500)
    expect(performance.now() - t).toBeLessThan(100)
  })
})
