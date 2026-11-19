import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { formatPercent } from '../util/format.js'
import { toNumber, r2 } from '../util/num.js'
import { clip, fit } from '../util/text.js'
import { fmtList, formatter, lead } from './shared.js'

const MAX_NODES = 40
const MAX_LINKS = 300

interface Link { source: string; target: string; value: number }

function links(spec: Record<string, any>): Link[] {
  const sums = new Map<string, Link>()
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.value])
    if (v === null || v <= 0) continue
    const source = String(r[spec.from] ?? '')
    const target = String(r[spec.to] ?? '')
    if (source === target) continue
    const k = `${source}\u0000${target}`
    const l = sums.get(k)
    if (l) l.value += v
    else sums.set(k, { source, target, value: v })
  }
  return [...sums.values()]
}

/** Topological order, or the names on a cycle when there is one. */
function cycleOf(ls: { source: string; target: string }[]): string[] | null {
  const out = new Map<string, string[]>()
  for (const l of ls) (out.get(l.source) ?? out.set(l.source, []).get(l.source)!).push(l.target)
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const visit = (n: string): string[] | null => {
    state.set(n, 1)
    stack.push(n)
    for (const t of out.get(n) ?? []) {
      if (state.get(t) === 1) return [...stack.slice(stack.indexOf(t)), t]
      if (!state.has(t)) { const c = visit(t); if (c) return c }
    }
    stack.pop()
    state.set(n, 2)
    return null
  }
  for (const n of out.keys()) if (!state.has(n)) { const c = visit(n); if (c) return c }
  return null
}

interface Node { key: string; layer: number; in: number; out: number; value: number; y: number; h: number; x: number; order: number }

function layout(ls: Link[], w: number, h: number, nodeW: number, padY: number): { nodes: Map<string, Node>; cols: number } {
  const nodes = new Map<string, Node>()
  const get = (key: string): Node => nodes.get(key) ?? nodes.set(key, { key, layer: 0, in: 0, out: 0, value: 0, y: 0, h: 0, x: 0, order: nodes.size }).get(key)!
  for (const l of ls) { get(l.source).out += l.value; get(l.target).in += l.value }
  for (const n of nodes.values()) n.value = Math.max(n.in, n.out)
  // Layer = longest path from a source; sinks go to the last column.
  const out = new Map<string, Link[]>()
  for (const l of ls) (out.get(l.source) ?? out.set(l.source, []).get(l.source)!).push(l)
  let changed = true
  for (let guard = 0; changed && guard < nodes.size + 1; guard++) {
    changed = false
    for (const l of ls) {
      const a = nodes.get(l.source)!
      const b = nodes.get(l.target)!
      if (b.layer < a.layer + 1) { b.layer = a.layer + 1; changed = true }
    }
  }
  const cols = Math.max(...[...nodes.values()].map(n => n.layer)) + 1
  for (const n of nodes.values()) if (n.out === 0) n.layer = cols - 1
  const byLayer: Node[][] = Array.from({ length: cols }, () => [])
  for (const n of nodes.values()) byLayer[n.layer].push(n)
  // One scale for every column so equal flows have equal height.
  let ky = Infinity
  for (const col of byLayer) {
    const sum = col.reduce((q, n) => q + n.value, 0)
    if (sum > 0) ky = Math.min(ky, (h - padY * (col.length - 1)) / sum)
  }
  if (!Number.isFinite(ky) || ky <= 0) ky = 1
  for (const n of nodes.values()) { n.h = Math.max(2, n.value * ky); n.x = cols === 1 ? 0 : (n.layer * (w - nodeW)) / (cols - 1) }
  // Order each column by the average position of its neighbours (a few sweeps reduce crossings).
  const place = (col: Node[]): void => {
    const used = col.reduce((q, n) => q + n.h, 0) + padY * (col.length - 1)
    let y = (h - used) / 2
    for (const n of col) { n.y = y; y += n.h + padY }
  }
  byLayer.forEach(place)
  for (let sweep = 0; sweep < 6; sweep++) {
    const forward = sweep % 2 === 0
    const seq = forward ? byLayer.slice(1) : byLayer.slice(0, -1).reverse()
    for (const col of seq) {
      const centre = (n: Node): number => {
        let sum = 0
        let wgt = 0
        for (const l of ls) {
          const other = forward ? (l.target === n.key ? nodes.get(l.source) : undefined) : l.source === n.key ? nodes.get(l.target) : undefined
          if (other) { sum += (other.y + other.h / 2) * l.value; wgt += l.value }
        }
        return wgt ? sum / wgt : n.y + n.h / 2
      }
      const keyed = col.map(n => ({ n, k: centre(n) })).sort((a, b) => a.k - b.k || a.n.order - b.n.order)
      col.splice(0, col.length, ...keyed.map(q => q.n))
      place(col)
    }
  }
  return { nodes, cols }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const ls = links(s)
  const frame = c.frame({ series: [] })
  const nodeW = c.compact ? 8 : 12
  const names = [...new Set(ls.flatMap(l => [l.source, l.target]))]
  const labelRoom = Math.min(frame.w * 0.28, Math.max(...names.map(n => c.measure(clip(n, 24), c.size))) + 10)
  // Labels sit right of every node; the last column's labels use room taken from the right edge.
  const inner = { x: frame.x, y: frame.y, w: frame.w - labelRoom, h: frame.h }
  const { nodes } = layout(ls, inner.w, inner.h, nodeW, Math.min(14, inner.h / 20))
  const order = [...nodes.keys()]
  const colorOf = (key: string): string => c.seriesColor(key, order.indexOf(key))
  const fmt = c.format
  const outOff = new Map<string, number>()
  const inOff = new Map<string, number>()
  const byTarget = (a: Link, b: Link): number => nodes.get(a.target)!.y - nodes.get(b.target)!.y
  const bySource = (a: Link, b: Link): number => nodes.get(a.source)!.y - nodes.get(b.source)!.y
  const ky = (n: Node): number => (n.value ? n.h / n.value : 0)
  const placed = new Map<Link, { sy: number; ty: number; th: number }>()
  for (const n of nodes.values()) {
    let o = 0
    for (const l of ls.filter(q => q.source === n.key).sort(byTarget)) { placed.set(l, { sy: n.y + o, ty: 0, th: l.value * ky(n) }); o += l.value * ky(n) }
  }
  for (const n of nodes.values()) {
    let o = 0
    for (const l of ls.filter(q => q.target === n.key).sort(bySource)) { const p = placed.get(l)!; p.ty = n.y + o; o += l.value * ky(n) }
  }
  void outOff; void inOff
  const total = ls.filter(l => nodes.get(l.source)!.in === 0).reduce((q, l) => q + l.value, 0)

  for (const l of ls) {
    const a = nodes.get(l.source)!
    const b = nodes.get(l.target)!
    const p = placed.get(l)!
    const x0 = inner.x + a.x + nodeW
    const x1 = inner.x + b.x
    const xm = (x0 + x1) / 2
    const th = l.value * ky(b)
    const sh = p.th
    const d = `M${r2(x0)} ${r2(inner.y + p.sy)}C${r2(xm)} ${r2(inner.y + p.sy)} ${r2(xm)} ${r2(inner.y + p.ty)} ${r2(x1)} ${r2(inner.y + p.ty)}V${r2(inner.y + p.ty + th)}C${r2(xm)} ${r2(inner.y + p.ty + th)} ${r2(xm)} ${r2(inner.y + p.sy + sh)} ${r2(x0)} ${r2(inner.y + p.sy + sh)}Z`
    c.marks.push({
      type: 'path', role: 'data', series: l.source, d, fill: colorOf(l.source), opacity: 0.32, anim: 'fade',
      tip: { title: `${clip(l.source, 40)} → ${clip(l.target, 40)}`, rows: [{ label: String(s.value), value: fmt(l.value), color: colorOf(l.source) }, { label: c.t('shareOfSource', { name: clip(l.source, 24) }), value: formatPercent(l.value / (a.out || 1), c.locale) }] },
      aria: c.t('linkAria', { source: l.source, target: l.target, value: fmt(l.value) }), datum: { source: l.source, target: l.target, value: l.value }
    })
  }
  const lastLayer = Math.max(...[...nodes.values()].map(n => n.layer))
  for (const n of nodes.values()) {
    const col = colorOf(n.key)
    const x = inner.x + n.x
    c.marks.push({
      type: 'rect', role: 'data', series: n.key, x: r2(x), y: r2(inner.y + n.y), w: nodeW, h: r2(n.h), r: 2, fill: col,
      tip: { title: clip(n.key, 60), rows: [...(n.in ? [{ label: c.t('flowIn'), value: fmt(n.in), color: col }] : []), ...(n.out ? [{ label: c.t('flowOut'), value: fmt(n.out), color: col }] : [])] },
      aria: c.t('nodeAria', { name: n.key, in: fmt(n.in), out: fmt(n.out) }), datum: { node: n.key, in: n.in, out: n.out }
    })
    const room = n.layer === lastLayer ? labelRoom - 6 : labelRoom + 40
    c.marks.push(c.text(x + nodeW + 6, inner.y + n.y + n.h / 2, fit(n.key, room, c.size, c.env.measure, 500), { role: 'label', anchor: 'start', baseline: 'middle', fill: c.c('text'), weight: 500 }))
  }
  void total
  return { series: [] }
}

export const sankey: ChartDef = {
  type: 'sankey',
  name: 'Sankey diagram',
  summary: 'Shows how a quantity flows between stages: bands between nodes, the band width is the amount.',
  useWhen: 'A quantity that splits and merges across stages (budget to departments, visitors to pages to outcomes, energy sources to uses). Flows must go one way (no loops). Not for a single split (use a pie or bar) or for more than about 30 nodes.',
  cartesian: false,
  fields: {
    from: { kind: 'column', role: 'any', required: true, desc: 'Column naming where each flow starts.' },
    to: { kind: 'column', role: 'any', required: true, desc: 'Column naming where each flow ends.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving the size of each flow. Rows with the same source and target are summed; zero and negative values are skipped.' }
  },
  example: {
    type: 'sankey', title: 'Where the visitors go', subtitle: 'Sessions, last 30 days', from: 'from', to: 'to', value: 'sessions', format: 'compact',
    data: [
      { from: 'Search', to: 'Home', sessions: 5200 }, { from: 'Social', to: 'Home', sessions: 2100 }, { from: 'Direct', to: 'Home', sessions: 3000 },
      { from: 'Search', to: 'Pricing', sessions: 1800 }, { from: 'Home', to: 'Pricing', sessions: 4100 }, { from: 'Home', to: 'Docs', sessions: 3600 },
      { from: 'Home', to: 'Left', sessions: 2600 }, { from: 'Pricing', to: 'Signed up', sessions: 1700 }, { from: 'Pricing', to: 'Left', sessions: 4200 },
      { from: 'Docs', to: 'Signed up', sessions: 900 }, { from: 'Docs', to: 'Left', sessions: 2700 }
    ]
  },
  check(spec, ctx) {
    const named = (r: Record<string, unknown>, k: 'from' | 'to'): string => String(r[spec[k] as string] ?? '')
    const flows = ctx.rows.filter(r => { const v = r[spec.value as string]; return typeof v !== 'number' || v > 0 }).map(r => ({ source: named(r, 'from'), target: named(r, 'to') })).filter(l => l.source !== l.target)
    const nodes = new Set(flows.flatMap(l => [l.source, l.target]))
    if (flows.length !== ctx.rows.length) ctx.issues.push({ severity: 'warning', code: 'flows_skipped', path: 'value', message: 'Flows with zero or negative value, or that start and end at the same node, are skipped.' })
    if (nodes.size > MAX_NODES) ctx.issues.push({ severity: 'error', code: 'too_many_nodes', path: 'from', message: `A sankey diagram can show at most ${MAX_NODES} nodes; this has ${nodes.size}.`, hint: 'Merge small nodes into "Other".' })
    if (new Set(flows.map(l => `${l.source}\u0000${l.target}`)).size > MAX_LINKS) ctx.issues.push({ severity: 'error', code: 'too_many_links', path: 'data', message: `A sankey diagram can show at most ${MAX_LINKS} flows.` })
    const loop = cycleOf(flows)
    if (loop) ctx.issues.push({ severity: 'error', code: 'cyclic_flow', path: 'to', message: `Flows form a loop: ${loop.slice(0, 6).join(' → ')}.`, hint: 'A sankey diagram needs flows that only go forward. Break the loop, e.g. split the repeated node into "Home (1st visit)" and "Home (return)".' })
  },
  compile,
  describe(spec, env) {
    const ls = links(spec)
    const f = formatter(spec, env.locale)
    if (!ls.length) return `${lead(spec, 'Sankey diagram')} No positive flows.`
    const nodes = new Map<string, { in: number; out: number }>()
    for (const l of ls) {
      ;(nodes.get(l.source) ?? nodes.set(l.source, { in: 0, out: 0 }).get(l.source)!).out += l.value
      ;(nodes.get(l.target) ?? nodes.set(l.target, { in: 0, out: 0 }).get(l.target)!).in += l.value
    }
    const sources = [...nodes].filter(([, n]) => n.in === 0).map(([k]) => k)
    const sinks = [...nodes].filter(([, n]) => n.out === 0).map(([k]) => k)
    const total = ls.filter(l => sources.includes(l.source)).reduce((q, l) => q + l.value, 0)
    const big = ls.reduce((a, b) => (b.value > a.value ? b : a))
    let t = `${lead(spec, 'Sankey diagram')} ${nodes.size} nodes, ${ls.length} flows; ${f(total)} enters from ${fmtList(sources, 4)} and ends in ${fmtList(sinks, 4)}.`
    t += ` Largest flow: ${clip(big.source, 30)} to ${clip(big.target, 30)} (${f(big.value)}).`
    return t
  }
}
