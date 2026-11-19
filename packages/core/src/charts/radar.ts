// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { detectXKind, distinct, observations, xKey } from '../data.js'
import { niceDomain, r2 } from '../util/num.js'
import { clip, fit } from '../util/text.js'
import { fmtList, formatter, lead, matrix } from './shared.js'

const MAX_AXES = 16

function model(spec: Record<string, any>): { axes: string[]; keys: string[]; m: Map<string, Map<string, number>> } {
  const obs = observations(spec.data, spec.x, spec.y, spec.series)
  return { axes: distinct(obs.map(o => xKey(o.x))), keys: distinct(obs.map(o => o.s)), m: matrix(obs) }
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const { axes, keys, m } = model(s)
  const series = c.makeSeries(keys)
  const visible = keys.filter(k => !c.hidden.has(k))
  const frame = c.frame({ series })
  const n = axes.length
  let max = 0
  for (const row of m.values()) for (const [k, v] of row) if (!c.hidden.has(k) && v > max) max = v
  const top = (s.max as number | undefined) ?? niceDomain(0, max || 1, s.rings ?? 4)[1]
  const rings = (s.rings ?? 4) as number

  // Leave room for the axis names around the polygon.
  const labelW = Math.min(frame.w * 0.28, Math.max(...axes.map(a => c.measure(clip(a, 24), c.size))) + 8)
  const R = Math.max(30, Math.min((frame.w - labelW * 2) / 2, (frame.h - c.size * 3) / 2))
  const cx = frame.x + frame.w / 2
  const cy = frame.y + frame.h / 2
  const ang = (i: number): number => -Math.PI / 2 + (i / n) * Math.PI * 2
  const pt = (i: number, v: number): [number, number] => {
    const r = (Math.max(0, Math.min(v, top)) / top) * R
    return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]
  }
  const poly = (f: (i: number) => [number, number]): string => axes.map((_, i) => `${i ? 'L' : 'M'}${r2(f(i)[0])} ${r2(f(i)[1])}`).join('') + 'Z'

  for (let g = 1; g <= rings; g++) c.marks.push({ type: 'path', role: 'grid', d: poly(i => pt(i, (top * g) / rings)), fill: 'none', stroke: c.c('grid'), strokeWidth: 1 })
  axes.forEach((_, i) => {
    const [x, y] = pt(i, top)
    c.marks.push({ type: 'line', role: 'grid', x1: cx, y1: cy, x2: r2(x), y2: r2(y), stroke: c.c('grid'), strokeWidth: 1 })
  })
  // Scale labels on the first spoke, quiet.
  for (let g = 1; g <= rings; g++) {
    const v = (top * g) / rings
    const [x, y] = pt(0, v)
    c.marks.push(c.text(x + 4, y, c.format(v), { role: 'axis-label', baseline: 'middle', size: c.size - 2, opacity: 0.8 }))
  }
  axes.forEach((a, i) => {
    const th = ang(i)
    const x = cx + (R + 10) * Math.cos(th)
    const y = cy + (R + 10) * Math.sin(th)
    const cos = Math.cos(th)
    const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end'
    const sin = Math.sin(th)
    c.marks.push(c.text(x, y + (sin > 0.5 ? c.size * 0.4 : sin < -0.5 ? -c.size * 0.2 : 0), fit(a, labelW, c.size, c.env.measure), { role: 'axis-label', anchor, baseline: 'middle', fill: c.c('text') }))
  })

  for (const k of visible) {
    const info = series.find(x => x.key === k)!
    const vals = axes.map(a => m.get(a)?.get(k) ?? 0)
    const d = poly(i => pt(i, vals[i]))
    if (s.fill !== false) c.marks.push({ type: 'path', role: 'data', series: k, d, fill: info.color, opacity: 0.14, anim: 'fade' })
    c.marks.push({ type: 'path', role: 'data', series: k, d, fill: 'none', stroke: info.color, strokeWidth: c.theme.lineWidth, anim: 'fade' })
    axes.forEach((a, i) => {
      const [x, y] = pt(i, vals[i])
      c.marks.push({
        type: 'circle', role: 'data', series: k, cx: r2(x), cy: r2(y), r: 3.5, fill: info.color, stroke: c.c('background'), strokeWidth: 1.5,
        tip: { title: clip(a, 60), rows: [{ label: clip(k, 40), value: c.format(vals[i]), color: info.color }] },
        aria: `${a}, ${k}: ${c.format(vals[i])}`, datum: { axis: a, series: k, value: vals[i] }
      })
    })
  }
  return { series }
}

export const radar: ChartDef = {
  type: 'radar',
  name: 'Radar chart',
  summary: 'Compares a few items across several measures on spokes around a centre; each item is a closed shape.',
  useWhen: 'Comparing 1-4 items across 4-10 measures that share one scale (skills, product scorecards). The shape is easy to read, exact values are not: use a bar chart when precision matters, and avoid it for measures on different scales or for many items.',
  cartesian: false,
  fields: {
    x: { kind: 'column', role: 'any', required: true, desc: 'Column naming each spoke (the measures). 3 to 16 distinct values.' },
    y: { kind: 'columns', role: 'number', required: true, desc: 'Numeric column for the distance along the spoke. Several columns give one shape per column (wide-form data).' },
    series: { kind: 'column', role: 'any', desc: 'Column that splits the spokes into shapes (long-form data). Not needed when `y` lists several columns.' },
    max: { kind: 'number', min: 0.000001, desc: 'Value at the outer ring. Default: the largest value rounded up. Set it to compare several radars.' },
    rings: { kind: 'number', min: 2, max: 8, integer: true, default: 4, desc: 'Number of grid rings.' },
    fill: { kind: 'boolean', default: true, desc: 'Tint the inside of each shape.' }
  },
  example: {
    type: 'radar', title: 'Phone comparison', subtitle: 'Score out of 10', x: 'measure', y: ['Alpha', 'Beta'], max: 10,
    data: [
      { measure: 'Battery', Alpha: 8, Beta: 6 }, { measure: 'Camera', Alpha: 6, Beta: 9 }, { measure: 'Display', Alpha: 9, Beta: 8 },
      { measure: 'Speed', Alpha: 7, Beta: 9 }, { measure: 'Design', Alpha: 6, Beta: 7 }, { measure: 'Price', Alpha: 9, Beta: 5 }
    ]
  },
  check(spec, ctx) {
    const axes = distinct(ctx.rows.map(r => xKey(r[spec.x as string])))
    if (axes.length < 3) ctx.issues.push({ severity: 'error', code: 'too_few_axes', path: 'x', message: `A radar chart needs at least 3 spokes; "${spec.x}" has ${axes.length} distinct value(s).`, hint: 'Use a bar chart for fewer measures.' })
    if (axes.length > MAX_AXES) ctx.issues.push({ severity: 'error', code: 'too_many_axes', path: 'x', message: `A radar chart can show at most ${MAX_AXES} spokes; "${spec.x}" has ${axes.length}.`, hint: 'Group measures, or use a heatmap or bar chart.' })
    if (detectXKind('auto', ctx.rows.map(r => r[spec.x as string])) === 'time') ctx.issues.push({ severity: 'warning', code: 'prefer_line', path: 'type', message: 'Spokes look like dates: a line chart shows change over time better.' })
  },
  compile,
  describe(spec, env) {
    const { axes, keys, m } = model(spec)
    const f = formatter(spec, env.locale)
    let t = `${lead(spec, 'Radar chart')} ${axes.length} spokes (${fmtList(axes, 6)}), ${keys.length} ${keys.length === 1 ? 'shape' : 'shapes'} (${fmtList(keys)}).`
    for (const k of keys.slice(0, 3)) {
      const pairs = axes.map(a => ({ a, v: m.get(a)?.get(k) ?? 0 }))
      const hi = pairs.reduce((p, q) => (q.v > p.v ? q : p))
      const lo = pairs.reduce((p, q) => (q.v < p.v ? q : p))
      t += ` ${clip(k, 30)}: highest ${clip(hi.a, 30)} (${f(hi.v)}), lowest ${clip(lo.a, 30)} (${f(lo.v)}).`
    }
    return t
  }
}

