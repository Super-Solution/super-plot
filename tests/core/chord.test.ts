import { describe, expect, it } from 'vitest'
import { chordLayout, CHORD_GAP, compilePlot, describePlot, renderToSvg, validatePlot, type Mark } from '../../packages/core/src'

const trade = [
  { from: 'Asia', to: 'Europe', v: 120 }, { from: 'Europe', to: 'Asia', v: 95 }, { from: 'Asia', to: 'Americas', v: 150 },
  { from: 'Americas', to: 'Asia', v: 70 }, { from: 'Europe', to: 'Americas', v: 85 }, { from: 'Americas', to: 'Europe', v: 110 }
]
const spec = { type: 'chord', from: 'from', to: 'to', value: 'v', data: trade }
const flows = (rows = trade): { source: string; target: string; value: number }[] => rows.map(r => ({ source: r.from, target: r.to, value: r.v }))
type Path = Extract<Mark, { type: 'path' }>
const scene = (s: Record<string, unknown>, width = 600): ReturnType<typeof compilePlot> => compilePlot(s, { width, height: 420 })

describe('chordLayout', () => {
  it('puts the arcs in the order the groups first appear, one gap apart, around one full turn', () => {
    const { nodes } = chordLayout(flows())
    expect(nodes.map(n => n.name)).toEqual(['Asia', 'Europe', 'Americas'])
    expect(nodes[0].start).toBe(0)
    for (let i = 1; i < nodes.length; i++) expect(nodes[i].start - nodes[i - 1].end).toBeCloseTo(CHORD_GAP, 12)
    expect(nodes[2].end + CHORD_GAP).toBeCloseTo(2 * Math.PI, 12)
  })
  it('sizes an arc by in plus out, on one scale', () => {
    const { nodes } = chordLayout(flows())
    expect(nodes.map(n => n.total)).toEqual([120 + 95 + 150 + 70, 120 + 95 + 85 + 110, 150 + 70 + 85 + 110])
    const k = (nodes[0].end - nodes[0].start) / nodes[0].total
    for (const n of nodes) expect((n.end - n.start) / n.total).toBeCloseTo(k, 12)
  })
  it('gives a ribbon the same width at both ends, inside the two arcs and never overlapping its neighbours', () => {
    const { nodes, ribbons } = chordLayout(flows())
    const byName = new Map(nodes.map(n => [n.name, n]))
    ribbons.forEach((r, i) => {
      const f = flows()[i]
      expect(r.sourceEnd - r.sourceStart).toBeCloseTo(r.targetEnd - r.targetStart, 12)
      const a = byName.get(f.source)!, b = byName.get(f.target)!
      expect(r.sourceStart).toBeGreaterThanOrEqual(a.start - 1e-12)
      expect(r.sourceEnd).toBeLessThanOrEqual(a.end + 1e-12)
      expect(r.targetStart).toBeGreaterThanOrEqual(b.start - 1e-12)
      expect(r.targetEnd).toBeLessThanOrEqual(b.end + 1e-12)
    })
    // An arc is exactly filled by the pieces of its flows.
    for (const n of nodes) {
      const pieces = ribbons.flatMap((r, i) => [flows()[i].source === n.name ? r.sourceEnd - r.sourceStart : 0, flows()[i].target === n.name ? r.targetEnd - r.targetStart : 0])
      expect(pieces.reduce((q, p) => q + p, 0)).toBeCloseTo(n.end - n.start, 12)
    }
  })
  it('is deterministic: the same flows give the same numbers, and the order of the data decides the order of the arcs', () => {
    expect(chordLayout(flows())).toEqual(chordLayout(flows().map(f => ({ ...f }))))
    const reversed = chordLayout([...flows()].reverse())
    expect(reversed.nodes.map(n => n.name)).toEqual(['Americas', 'Europe', 'Asia'])
  })
  it('has nothing to lay out without flows', () => {
    expect(chordLayout([])).toEqual({ nodes: [], ribbons: [] })
  })
})

describe('chord chart', () => {
  it('draws one ribbon per flow and one arc per group, with the tooltips and labels of both', () => {
    const r = scene(spec)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const paths = r.scene.marks.filter((m): m is Path => m.type === 'path' && m.role === 'data')
    expect(paths).toHaveLength(trade.length + 3)
    expect(paths[0].tip!.title).toBe('Asia → Europe')
    expect(paths[0].datum).toEqual({ source: 'Asia', target: 'Europe', value: 120 })
    const arc = paths.find(p => (p.datum as { node?: string }).node === 'Europe')!
    expect(arc.datum).toEqual({ node: 'Europe', in: 230, out: 180 })
    expect(arc.tip!.rows.map(x => x.label)).toEqual(['Out', 'In'])
    const labels = r.scene.marks.filter(m => m.type === 'text' && m.role === 'label').map(m => (m as { text: string }).text)
    expect(labels).toEqual(['Asia', 'Europe', 'Americas'])
    for (const m of paths) expect(m.aria).toBeTruthy()
  })
  it('ties rows to its marks, so references and the data table find them', () => {
    const r = scene(spec)
    if (!r.ok) throw new Error('invalid')
    const ribbon = r.scene.marks.find(m => m.type === 'path' && (m.datum as { source?: string } | undefined)?.source === 'Asia' && (m.datum as { target?: string }).target === 'Americas')!
    expect(ribbon.rows).toEqual([2])
  })
  it('the same data draws the same bytes, in light and dark, and at phone width', () => {
    for (const theme of ['light', 'dark'] as const) for (const width of [390, 1000]) {
      const svg = renderToSvg(spec, { width, theme })
      expect(svg).toBe(renderToSvg({ ...spec }, { width, theme }))
      expect(svg).toContain('<path')
    }
  })
  it('stays inside its box at phone width', () => {
    const r = scene(spec, 360)
    if (!r.ok) throw new Error('invalid')
    for (const m of r.scene.marks) if (m.type === 'text' && m.role === 'label') {
      expect(m.x).toBeGreaterThan(0)
      expect(m.x).toBeLessThan(360)
    }
  })
  it('describes the groups, the busiest group, the largest flow and how the arcs are ordered', () => {
    const r = describePlot(spec)
    if (!r.ok) throw new Error('invalid')
    expect(r.text).toBe('Chord diagram. 3 groups, 6 flows, 630 in all. Busiest group: Asia (435 in and out). Largest flow: Asia to Americas (150). Arcs follow the order the groups first appear in the data.')
  })
  it('sums repeated pairs and skips what cannot be drawn, with a warning', () => {
    const rows = [...trade, { from: 'Asia', to: 'Europe', v: 5 }, { from: 'Asia', to: 'Asia', v: 9 }, { from: 'Europe', to: 'Asia', v: 0 }, { from: 'Europe', to: 'Asia', v: 'n/a' }]
    const v = validatePlot({ ...spec, data: rows })
    expect(v.ok).toBe(true)
    expect(v.issues.map(i => i.code)).toContain('flows_skipped')
    const r = describePlot({ ...spec, data: rows })
    if (!r.ok) throw new Error('invalid')
    expect(r.text).toContain('3 groups, 6 flows, 635 in all')
  })
  it('allows flows both ways and loops (it is not a sankey)', () => {
    expect(validatePlot(spec).issues).toEqual([])
    expect(validatePlot({ ...spec, data: [{ from: 'a', to: 'b', v: 1 }, { from: 'b', to: 'c', v: 1 }, { from: 'c', to: 'a', v: 1 }] }).issues).toEqual([])
  })
  it('refuses nothing to draw, too many groups and too many flows, with a code, a path and a hint', () => {
    const none = validatePlot({ ...spec, data: [{ from: 'a', to: 'a', v: 1 }] })
    expect(none.ok).toBe(false)
    expect(none.issues.find(i => i.code === 'no_flows')).toMatchObject({ path: 'value', hint: expect.any(String) })
    const many = validatePlot({ ...spec, data: Array.from({ length: 25 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, v: 1 })) })
    expect(many.issues.find(i => i.code === 'too_many_nodes')).toMatchObject({ severity: 'error', path: 'from' })
    const links = validatePlot({ ...spec, data: Array.from({ length: 301 }, (_, i) => ({ from: `s${i % 20}`, to: `t${Math.floor(i / 20)}`, v: 1 })) })
    expect(links.issues.find(i => i.code === 'too_many_links')).toMatchObject({ severity: 'error', path: 'data' })
  })
})
