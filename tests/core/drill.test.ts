import { describe, expect, it } from 'vitest'
import { compilePlot, describePlot, validatePlot, renderToSvg, chartCatalog, buildHitIndex, plotJsonSchema, type Scene, type Mark } from '../../packages/core/src'

const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const issuesOf = (spec: unknown): { code: string; path: string; severity: string; hint?: string }[] => validatePlot(spec).issues
type M<T extends Mark['type']> = Extract<Mark, { type: T }>
const of = <T extends Mark['type']>(s: Scene, type: T, role = 'data'): M<T>[] => s.marks.filter((m): m is M<T> => m.type === type && m.role === role)
const ex = (type: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === type)!.example)
const pathOf = (m: Mark): string => (m.datum as { path: string[] }).path.join('/')

describe('sunburst focus', () => {
  const spec = ex('sunburst')
  it('draws only the focused subtree, its first ring starting the circle, with a breadcrumb and no legend', () => {
    const whole = compile(spec)
    const s = compile({ ...spec, focus: ['Asia'] })
    const arcs = of(s, 'path')
    expect(arcs.every(a => pathOf(a).startsWith('Asia/'))).toBe(true)
    expect(arcs.map(pathOf).slice(0, 3)).toEqual(['Asia/Japan', 'Asia/Japan/Tokyo', 'Asia/Japan/Osaka'])
    // Same branch colour and the same shade per depth as in the whole tree.
    const fillIn = (sc: Scene, p: string): string | undefined => of(sc, 'path').find(a => pathOf(a) === p)?.fill
    expect(fillIn(s, 'Asia/Japan')).toBe(fillIn(whole, 'Asia/Japan'))
    expect(arcs.every(a => a.series === 'Asia')).toBe(true)
    const crumbs = s.marks.filter(m => m.role === 'label' && m.drill !== undefined)
    const texts = of(s, 'text', 'label').map(t => t.text)
    expect(texts.slice(0, 3)).toEqual(['All', '›', 'Asia'])
    expect(crumbs.filter(m => m.type === 'rect').map(m => [m.drill, m.aria])).toEqual([[[], 'Go up to All']])
    expect(crumbs.find(m => m.type === 'text')!.drill).toEqual(['Asia'])
    expect(of(s, 'rect', 'legend')).toHaveLength(0)
    expect(of(whole, 'rect', 'legend').length).toBeGreaterThan(0)
    // Shares: of the parent (Asia) and of the whole tree.
    const japan = arcs[0]
    expect(japan.tip!.rows.map(r => r.label)).toEqual(['sales', 'Share of parent', 'Share of total'])
    expect(japan.tip!.rows[1].value).toBe('48.1%')
    // The centre shows the focused total and its name.
    expect(texts).toContain('Asia')
  })
  it('marks parents as drill targets (leaves are not), two levels deep too', () => {
    const whole = compile(spec)
    const asia = of(whole, 'path').find(a => pathOf(a) === 'Asia')!
    const tokyo = of(whole, 'path').find(a => pathOf(a) === 'Asia/Japan/Tokyo')!
    expect(asia.drill).toEqual(['Asia'])
    expect(tokyo.drill).toBeUndefined()
    const s = compile({ ...spec, focus: ['Asia', 'Japan'] })
    expect(of(s, 'path').map(pathOf)).toEqual(['Asia/Japan/Tokyo', 'Asia/Japan/Osaka'])
    expect(of(s, 'text', 'label').slice(0, 5).map(t => t.text)).toEqual(['All', '›', 'Asia', '›', 'Japan'])
    expect(s.marks.filter(m => m.type === 'rect' && m.role === 'label' && m.drill).map(m => m.drill)).toEqual([[], ['Asia']])
  })
  it('validates the path: unknown or a leaf warns and draws the whole tree', () => {
    const nf = issuesOf({ ...spec, focus: ['Asia', 'Japn'] })
    expect(validatePlot({ ...spec, focus: ['Asia', 'Japn'] }).ok).toBe(true)
    const w = nf.find(i => i.code === 'focus_not_found')!
    expect(w).toMatchObject({ severity: 'warning', path: 'focus[1]' })
    expect(w.hint).toContain('Did you mean "Japan"?')
    expect(issuesOf({ ...spec, focus: ['Mars'] }).find(i => i.code === 'focus_not_found')!.path).toBe('focus[0]')
    expect(issuesOf({ ...spec, focus: ['Asia', 'Japan', 'Tokyo'] }).map(i => i.code)).toContain('focus_leaf')
    expect(of(compile({ ...spec, focus: ['Mars'] }), 'path').length).toBe(of(compile(spec), 'path').length)
    expect(issuesOf({ ...spec, focus: 'Asia' }).find(i => i.code === 'bad_type')!.path).toBe('focus')
    expect(issuesOf({ ...spec, focus: [{}] }).find(i => i.code === 'bad_type')!.path).toBe('focus[0]')
    expect(issuesOf({ ...spec, focus: [] }).filter(i => i.code.startsWith('focus'))).toEqual([])
    // Numbers are group values too, compared as strings.
    expect(validatePlot({ type: 'sunburst', path: ['y', 'q'], value: 'v', data: [{ y: 2025, q: 1, v: 3 }, { y: 2025, q: 2, v: 1 }], focus: [2025] }).spec!.focus).toEqual(['2025'])
  })
  it('the description says what is shown', () => {
    const d = describePlot({ ...spec, focus: ['Asia'] })
    expect(d.ok && d.text).toContain('Showing only Asia: 1.3K, 39% of the total, in 3 groups, largest Japan (48.1%), India (27.5%), Taiwan (24.4%).')
    const plain = describePlot(spec)
    expect(plain.ok && plain.text).not.toContain('Showing only')
  })
  it('breadcrumb items are buttons in interactive SVG and click targets on canvas', () => {
    const s = compile({ ...spec, focus: ['Asia'] })
    const i = s.marks.findIndex(m => m.type === 'rect' && m.role === 'label' && m.drill !== undefined)
    const m = s.marks[i] as M<'rect'>
    expect(buildHitIndex(s).at(m.x + m.w / 2, m.y + m.h / 2)).toBe(i)
    const html = renderToSvg({ ...spec, focus: ['Asia'] }, { width: 640, height: 420, interactive: true, resolveVars: false })
    expect(html).toMatch(/<rect [^>]*class="sp-m sp-label"[^>]*role="button" tabindex="0" aria-label="Go up to All"/)
    // The current item's text is not a button.
    expect(html.match(/role="button"/g)).toHaveLength(1)
    // A static SVG keeps the breadcrumb as text, without buttons.
    const still = renderToSvg({ ...spec, focus: ['Asia'] }, { width: 640, height: 420 })
    expect(still).toContain('>All</text>')
    expect(still).not.toContain('role="button"')
  })
})

describe('treemap focus', () => {
  const spec = ex('treemap')
  it('shows one group\'s tiles over the whole frame, in that group\'s colour', () => {
    const whole = compile(spec)
    const s = compile({ ...spec, focus: ['Cloud'] })
    const tiles = of(s, 'rect')
    expect(tiles.map(t => (t.datum as { label: string }).label)).toEqual(['Compute', 'Storage', 'Network'])
    expect(tiles[0].fill).toBe(of(whole, 'rect').find(t => (t.datum as { label: string }).label === 'Compute')!.fill)
    expect(tiles.every(t => t.drill === undefined)).toBe(true)
    expect(of(whole, 'rect').every(t => t.drill?.[0] === (t.datum as { group: string }).group)).toBe(true)
    expect(of(s, 'text', 'label').slice(0, 3).map(t => t.text)).toEqual(['All', '›', 'Cloud'])
    const area = tiles.reduce((q, t) => q + t.w * t.h, 0)
    const wholeArea = of(whole, 'rect').filter(t => (t.datum as { group: string }).group === 'Cloud').reduce((q, t) => q + t.w * t.h, 0)
    expect(area).toBeGreaterThan(wholeArea * 1.5)
    expect(tiles[0].tip!.rows.at(-1)).toEqual({ label: 'Share', value: '53.2%' })
  })
  it('needs a group, a known one, and only one level', () => {
    const { group: _g, ...flat } = spec
    expect(issuesOf({ ...flat, focus: ['Cloud'] }).find(i => i.code === 'focus_not_found')!.hint).toContain('`group`')
    expect(issuesOf({ ...spec, focus: ['Clod'] }).find(i => i.code === 'focus_not_found')!.hint).toContain('Did you mean "Cloud"?')
    expect(issuesOf({ ...spec, focus: ['Cloud', 'Compute'] }).map(i => i.code)).toContain('focus_leaf')
    expect(of(compile({ ...spec, focus: ['Clod'] }), 'rect').length).toBe(of(compile(spec), 'rect').length)
  })
  it('describes the focus', () => {
    const d = describePlot({ ...spec, focus: ['Cloud'] })
    expect(d.ok && d.text).toContain('Showing only Cloud: 3 tiles totalling 790 (50.3% of the total), largest Compute (53.2%).')
  })
})

describe('focus in the schema', () => {
  it('is a list of values in the JSON Schema of both charts', () => {
    const schema = plotJsonSchema() as { oneOf?: { properties?: Record<string, { type?: string; items?: unknown }> }[] } & Record<string, unknown>
    const text = JSON.stringify(schema)
    expect(text).toContain('Drill-down: a path of group values')
    const sb = chartCatalog().find(c => c.type === 'sunburst')!
    expect(JSON.stringify(sb)).toContain('focus')
  })
})
