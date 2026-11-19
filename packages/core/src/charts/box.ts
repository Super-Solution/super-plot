import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark } from '../scene.js'
import { bandScale, linearScale, niceLinear } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { distinct } from '../data.js'
import { mean, quantile, toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatter, lead, fmtList } from './shared.js'

export interface BoxStats { n: number; min: number; q1: number; median: number; q3: number; max: number; mean: number; lowWhisker: number; highWhisker: number; outliers: number[] }

/** Tukey box statistics: whiskers reach the furthest value within 1.5 x IQR of the box. */
export function boxStats(values: number[]): BoxStats | null {
  if (!values.length) return null
  const v = [...values].sort((a, b) => a - b)
  const q1 = quantile(v, 0.25)
  const q3 = quantile(v, 0.75)
  const iqr = q3 - q1
  const lf = q1 - 1.5 * iqr
  const hf = q3 + 1.5 * iqr
  const inside = v.filter(x => x >= lf && x <= hf)
  return { n: v.length, min: v[0], q1, median: quantile(v, 0.5), q3, max: v[v.length - 1], mean: mean(v), lowWhisker: inside[0], highWhisker: inside[inside.length - 1], outliers: v.filter(x => x < lf || x > hf) }
}

function groups(spec: Record<string, any>): Map<string, number[]> {
  const g = new Map<string, number[]>()
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.y])
    if (v === null) continue
    const k = spec.x ? String(r[spec.x] ?? '') : String(spec.y)
    let a = g.get(k)
    if (!a) g.set(k, (a = []))
    a.push(v)
  }
  return g
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const g = groups(s)
  const keys = [...g.keys()]
  const stats = new Map(keys.map(k => [k, boxStats(g.get(k)!)!]))
  const horizontal = s.orientation === 'horizontal'
  if (horizontal) c.axisFields = { x: s.y, y: s.x }
  const showOut = s.outliers !== false
  let lo = Infinity
  let hi = -Infinity
  for (const st of stats.values()) {
    lo = Math.min(lo, showOut ? st.min : st.lowWhisker)
    hi = Math.max(hi, showOut ? st.max : st.highWhisker)
  }
  const override = s.yDomain as [number | null, number | null] | undefined
  const vScale = override && (override[0] !== null || override[1] !== null) ? linearScale([override[0] ?? lo, override[1] ?? hi]) : niceLinear(lo, hi)
  const cats = bandScale(keys, 0.4)
  const frame = c.frame({ series: [] })
  const vAxis = valueAxis(c, vScale, { title: horizontal ? s.xLabel ?? String(s.y) : s.yLabel ?? String(s.y), vertical: !horizontal, format: s.format })
  const cAxis = bandAxis(cats, Object.fromEntries(keys.map(k => [k, clip(k, 60)])), horizontal ? s.yLabel : s.xLabel, c.locale)
  const plot = horizontal ? layoutCartesian(c, frame, vAxis, cAxis) : layoutCartesian(c, frame, cAxis, vAxis)
  drawAnnotations(c, plot, horizontal ? vAxis : cAxis, horizontal ? cAxis : vAxis)

  const fmt = c.format
  const boxW = Math.min(64, cats.bandwidth * 0.7)
  const hits: Mark[] = []
  const out: Mark[] = []
  for (const k of keys) {
    const st = stats.get(k)!
    const col = (s.colors?.[k] as string | undefined) ?? c.seriesColor(String(s.y), 0)
    const mid = cats.at(k)
    const P = (v: number): number => vScale.at(v)
    const rect = (a: number, b: number, extra: Partial<Mark> = {}): Mark => horizontal
      ? { type: 'rect', role: 'data', series: k, x: Math.min(P(a), P(b)), y: mid - boxW / 2, w: Math.abs(P(b) - P(a)), h: boxW, ...extra } as Mark
      : { type: 'rect', role: 'data', series: k, x: mid - boxW / 2, y: Math.min(P(a), P(b)), w: boxW, h: Math.abs(P(b) - P(a)), ...extra } as Mark
    const seg = (a: number, b: number, across: number, w = 1.5): Mark => horizontal
      ? { type: 'line', role: 'data', series: k, x1: P(a), x2: P(b), y1: mid - across, y2: mid + across, stroke: col, strokeWidth: w }
      : { type: 'line', role: 'data', series: k, x1: mid - across, x2: mid + across, y1: P(a), y2: P(b), stroke: col, strokeWidth: w }
    const tip = {
      title: clip(k, 60),
      rows: [['Max', st.max], ['Q3', st.q3], ['Median', st.median], ['Q1', st.q1], ['Min', st.min]].map(([label, v]) => ({ label: label as string, value: fmt(v as number) })).concat([{ label: 'Mean', value: fmt(st.mean) }, { label: 'n', value: String(st.n) }])
    }
    out.push(seg(st.lowWhisker, st.q1, 0), seg(st.q3, st.highWhisker, 0))
    out.push(seg(st.lowWhisker, st.lowWhisker, boxW * 0.25), seg(st.highWhisker, st.highWhisker, boxW * 0.25))
    out.push(rect(st.q1, st.q3, { fill: col, opacity: 0.22, stroke: col, strokeWidth: 1.5, r: 3, tip, aria: `${k}: median ${fmt(st.median)}, Q1 ${fmt(st.q1)}, Q3 ${fmt(st.q3)}`, anim: horizontal ? 'x' : 'y', datum: { group: k, ...st } }))
    out.push(seg(st.median, st.median, boxW / 2, c.theme.lineWidth + 0.5))
    if (showOut) {
      for (const v of st.outliers) {
        out.push({ type: 'circle', role: 'data', series: k, cx: horizontal ? P(v) : mid, cy: horizontal ? mid : P(v), r: 3.5, fill: c.c('background'), stroke: col, strokeWidth: 1.5, tip: { title: `${clip(k, 40)} outlier`, rows: [{ label: String(s.y), value: fmt(v) }] }, aria: `${k} outlier ${fmt(v)}` })
      }
    }
  }
  c.marks.push(...out, ...hits)
  return { series: [] }
}

export const box: ChartDef = {
  type: 'box',
  name: 'Box plot',
  summary: 'Summarises the distribution of a number for each group: median, quartiles, whiskers and outliers.',
  useWhen: 'Comparing the spread and centre of one measure across many groups, where overlaid histograms would be too busy. Needs ~10+ values per group to be meaningful.',
  cartesian: true,
  fields: {
    x: { kind: 'column', role: 'any', desc: 'Column that defines the groups (one box each). Omit for a single box.' },
    y: { kind: 'column', role: 'number', required: true, desc: 'Numeric column whose distribution is summarised.' },
    outliers: { kind: 'boolean', default: true, desc: 'Draw points beyond the whiskers (1.5 x IQR).' },
    orientation: { kind: 'enum', values: ['vertical', 'horizontal'], default: 'vertical', desc: '`horizontal` suits long group names.' },
    yDomain: { kind: 'domain', desc: 'Fix the value axis range.' }
  },
  example: {
    type: 'box', title: 'Delivery time by carrier', subtitle: 'Days from dispatch to door', x: 'carrier', y: 'days', yLabel: 'Days',
    data: ['Aero', 'Bolt', 'Cargo'].flatMap((carrier, ci) => Array.from({ length: 30 }, (_, i) => ({ carrier, days: Math.round((2 + ci * 0.8 + ((Math.abs(Math.sin((i + 1) * (ci + 3.1) * 12.9898) * 43758.5453) % 1) * 3) ** (1 + ci * 0.15) + (i === 7 ? 6 + ci * 2 : 0)) * 10) / 10 })))
  },
  compile,
  describe(spec, env) {
    const g = groups(spec)
    const f = formatter(spec, env.locale)
    const keys = distinct([...g.keys()])
    let t = `${lead(spec, 'Box plot')} Distribution of ${spec.y}${spec.x ? ` for ${keys.length} groups (${fmtList(keys)})` : ''}.`
    for (const k of keys.slice(0, 6)) {
      const st = boxStats(g.get(k)!)
      if (st) t += ` ${clip(k, 30)}: median ${f(st.median)}, middle half ${f(st.q1)} to ${f(st.q3)}, range ${f(st.min)} to ${f(st.max)}${st.outliers.length ? `, ${st.outliers.length} outlier${st.outliers.length > 1 ? 's' : ''}` : ''}.`
    }
    return t
  }
}
