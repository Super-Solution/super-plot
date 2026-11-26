// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { formatPercent } from '../util/format.js'
import { toNumber, r2 } from '../util/num.js'
import { clip, fit } from '../util/text.js'
import { chordLayout } from '../util/chord.js'
import { arc, flowLinks, formatter, lead } from './shared.js'

const MAX_NODES = 24
const MAX_LINKS = 300

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const ls = flowLinks(s)
  const { nodes, ribbons } = chordLayout(ls)
  const frame = c.frame({ series: [] })
  const fmt = c.format
  const names = nodes.map(n => n.name)
  const labelRoom = Math.min(frame.w * (c.compact ? 0.3 : 0.24), Math.max(...names.map(n => c.measure(clip(n, 22), c.size - 1))) + 10)
  const cx = frame.x + frame.w / 2
  const cy = frame.y + frame.h / 2
  const r1 = Math.max(36, Math.min(frame.w / 2 - labelRoom, frame.h / 2 - c.size - 4))
  const r0 = r1 - (c.compact ? 10 : 14)
  const rr = r0 - 2
  const start = -Math.PI / 2
  const pt = (r: number, a: number): string => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`
  const colorOf = (name: string): string => c.seriesColor(name, names.indexOf(name))
  const whole = ls.reduce((q, l) => q + l.value, 0)
  const io = new Map(nodes.map(n => [n.name, { in: 0, out: 0 }]))
  for (const l of ls) { io.get(l.source)!.out += l.value; io.get(l.target)!.in += l.value }

  // Ribbons first, so the arcs and their labels sit over them.
  ls.forEach((l, i) => {
    const q = ribbons[i]
    const s0 = start + q.sourceStart, s1 = start + q.sourceEnd, t0 = start + q.targetStart, t1 = start + q.targetEnd
    const big = (a: number, b: number): number => (b - a > Math.PI ? 1 : 0)
    const d = `M${pt(rr, s0)}A${r2(rr)} ${r2(rr)} 0 ${big(s0, s1)} 1 ${pt(rr, s1)}Q${r2(cx)} ${r2(cy)} ${pt(rr, t0)}A${r2(rr)} ${r2(rr)} 0 ${big(t0, t1)} 1 ${pt(rr, t1)}Q${r2(cx)} ${r2(cy)} ${pt(rr, s0)}Z`
    c.marks.push({
      type: 'path', role: 'data', series: l.source, d, fill: colorOf(l.source), opacity: 0.38, stroke: c.c('background'), strokeWidth: 0.5, anim: 'fade',
      tip: { title: `${clip(l.source, 40)} → ${clip(l.target, 40)}`, rows: [{ label: String(s.value), value: fmt(l.value), color: colorOf(l.source) }, { label: c.t('shareOfTotal'), value: formatPercent(l.value / (whole || 1), c.locale) }] },
      aria: c.t('linkAria', { source: l.source, target: l.target, value: fmt(l.value) }), datum: { source: l.source, target: l.target, value: l.value },
      rows: c.rowsBy([s.from, s.to], [l.source, l.target])
    })
  })
  for (const n of nodes) {
    const col = colorOf(n.name)
    const a0 = start + n.start, a1 = start + n.end
    const f = io.get(n.name)!
    c.marks.push({
      type: 'path', role: 'data', series: n.name, d: arc(cx, cy, r0, r1, a0, a1), fill: col, stroke: c.c('background'), strokeWidth: 1, anim: 'fade',
      tip: { title: clip(n.name, 60), rows: [...(f.out ? [{ label: c.t('flowOut'), value: fmt(f.out), color: col }] : []), ...(f.in ? [{ label: c.t('flowIn'), value: fmt(f.in), color: col }] : [])] },
      aria: c.t('nodeAria', { name: n.name, in: fmt(f.in), out: fmt(f.out) }), datum: { node: n.name, in: f.in, out: f.out },
      rows: [...new Set([...c.rowsBy([s.from], [n.name]), ...c.rowsBy([s.to], [n.name])])].sort((x, y) => x - y)
    })
    // A label needs its arc to be about a line of text long; the shorter ones are still in the tooltip and the description.
    if ((a1 - a0) * r1 < c.size * 0.9) continue
    const am = (a0 + a1) / 2
    const right = Math.cos(am) >= 0
    const x = cx + (r1 + 6) * Math.cos(am)
    const y = cy + (r1 + 6) * Math.sin(am)
    c.marks.push(c.text(x, y, fit(n.name, labelRoom - 6, c.size - 1, c.env.measure, 500), { role: 'label', anchor: right ? 'start' : 'end', baseline: 'middle', size: c.size - 1, weight: 500, fill: c.c('text') }))
  }
  return { series: [] }
}

export const chord: ChartDef = {
  type: 'chord',
  name: 'Chord diagram',
  summary: 'Shows how much flows between every pair of groups on a circle: an arc for each group, a ribbon between two arcs, the width is the amount.',
  useWhen: 'Flows that go both ways between a handful of groups (trade between regions, migration, who talks to whom). Arcs follow the order the groups first appear in the data, so the picture is the same every time. Not for flows that only go forward through stages (use a sankey), for a single split (use a pie or bar), or for more than about 20 groups.',
  cartesian: false,
  ref: { x: ['from', 'to'], y: ['value'] },
  fields: {
    from: { kind: 'column', role: 'any', required: true, desc: 'Column naming the group each flow starts at.' },
    to: { kind: 'column', role: 'any', required: true, desc: 'Column naming the group each flow ends at.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving the size of each flow. Rows with the same source and target are summed; a flow from a group to itself, zero and negative values are skipped. A ribbon is as wide as the flow in both groups, so the two directions between a pair are two ribbons.' }
  },
  example: {
    type: 'chord', title: 'Trade between regions', subtitle: 'Exports, USD billions. Invented figures', from: 'from', to: 'to', value: 'billions', format: 'integer',
    data: [
      { from: 'Asia', to: 'Europe', billions: 120 }, { from: 'Europe', to: 'Asia', billions: 95 }, { from: 'Asia', to: 'Americas', billions: 150 },
      { from: 'Americas', to: 'Asia', billions: 70 }, { from: 'Europe', to: 'Americas', billions: 85 }, { from: 'Americas', to: 'Europe', billions: 110 },
      { from: 'Africa', to: 'Europe', billions: 45 }, { from: 'Europe', to: 'Africa', billions: 30 }, { from: 'Asia', to: 'Africa', billions: 40 }
    ]
  },
  check(spec, ctx) {
    const named = (r: Record<string, unknown>, k: 'from' | 'to'): string => String(r[spec[k] as string] ?? '')
    const kept = ctx.rows.filter(r => { const v = toNumber(r[spec.value as string]); return v !== null && v > 0 && named(r, 'from') !== named(r, 'to') })
    const flows = kept.map(r => ({ source: named(r, 'from'), target: named(r, 'to') }))
    const nodes = new Set(flows.flatMap(l => [l.source, l.target]))
    if (kept.length !== ctx.rows.length) ctx.issues.push({ severity: 'warning', code: 'flows_skipped', path: 'value', message: 'Flows with zero, negative or no number, or that start and end at the same group, are skipped.' })
    if (!kept.length) ctx.issues.push({ severity: 'error', code: 'no_flows', path: 'value', message: 'No row has a positive number between two different groups, so there is nothing to draw.', hint: 'Check the from, to and value columns.' })
    if (nodes.size > MAX_NODES) ctx.issues.push({ severity: 'error', code: 'too_many_nodes', path: 'from', message: `A chord diagram can show at most ${MAX_NODES} groups; this has ${nodes.size}.`, hint: 'Merge small groups into "Other".' })
    if (new Set(flows.map(l => `${l.source}\u0000${l.target}`)).size > MAX_LINKS) ctx.issues.push({ severity: 'error', code: 'too_many_links', path: 'data', message: `A chord diagram can show at most ${MAX_LINKS} flows.` })
  },
  compile,
  describe(spec, env) {
    const ls = flowLinks(spec)
    const f = formatter(spec, env.locale)
    if (!ls.length) return `${lead(spec, 'Chord diagram')} No positive flows.`
    const { nodes } = chordLayout(ls)
    const whole = ls.reduce((q, l) => q + l.value, 0)
    const busy = nodes.reduce((a, b) => (b.total > a.total ? b : a))
    const big = ls.reduce((a, b) => (b.value > a.value ? b : a))
    return `${lead(spec, 'Chord diagram')} ${nodes.length} groups, ${ls.length} flows, ${f(whole)} in all. Busiest group: ${clip(busy.name, 30)} (${f(busy.total)} in and out). Largest flow: ${clip(big.source, 30)} to ${clip(big.target, 30)} (${f(big.value)}). Arcs follow the order the groups first appear in the data.`
  }
}
