import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, SeriesInfo } from '../scene.js'
import { flagged, type Row } from '../schema.js'
import { bandScale, linearScale, niceLinear } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { xKey } from '../data.js'
import { closest, toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatter, lead } from './shared.js'

const MAX_BAR = 56

/** Increase, decrease and total bars: their own legend entries and theme tokens (up, down, neutral). */
export const WATERFALL_KINDS = ['increase', 'decrease', 'total'] as const
export type WaterfallKind = (typeof WATERFALL_KINDS)[number]
const LABEL: Record<WaterfallKind, string> = { increase: 'Increase', decrease: 'Decrease', total: 'Total' }
const TOKEN: Record<WaterfallKind, string> = { increase: 'positive', decrease: 'negative', total: 'text-muted' }

export interface WaterfallStep {
  key: string
  kind: WaterfallKind
  /** Bar ends in value space. A change floats from the running total before it; a total starts at 0. */
  from: number
  to: number
  /** Signed change (changes only). */
  change: number
  /** Running total after this step. */
  running: number
  /** Totals: the sum of the steps before it, when the row's own value replaced it. */
  computed?: number
}

export interface WaterfallModel {
  steps: WaterfallStep[]
  start: number
  end: number
  /** Total steps whose own value differs from the sum before them. */
  mismatches: string[]
  duplicates: number
}

/**
 * Steps in data order (duplicate labels summed). A change floats from the running total; a total bar shows the
 * running total, or the row's own value (an opening or reported balance) when it has one.
 */
export function waterfallModel(spec: Record<string, any>): WaterfallModel {
  const rows = spec.data as Row[]
  const order: string[] = []
  const sum = new Map<string, number | null>()
  const isTotal = new Set<string>()
  let duplicates = 0
  for (const r of rows) {
    const k = xKey(r[spec.x])
    const v = toNumber(r[spec.y])
    if (!sum.has(k)) {
      order.push(k)
      sum.set(k, v)
    } else {
      duplicates++
      const prev = sum.get(k)!
      sum.set(k, v === null ? prev : (prev ?? 0) + v)
    }
    if (flagged(spec.total, r, spec.x)) isTotal.add(k)
  }
  const start = typeof spec.start === 'number' ? spec.start : 0
  let running = start
  const steps: WaterfallStep[] = []
  const mismatches: string[] = []
  order.forEach((key, i) => {
    const v = sum.get(key) ?? null
    if (isTotal.has(key)) {
      const value = v ?? running
      const checked = i > 0 || spec.start !== undefined
      const differs = v !== null && checked && Math.abs(v - running) > 1e-9 * Math.max(1, Math.abs(running))
      if (differs) mismatches.push(key)
      steps.push({ key, kind: 'total', from: 0, to: value, change: 0, running: value, ...(differs ? { computed: running } : {}) })
      running = value
      return
    }
    if (v === null) return
    steps.push({ key, kind: v >= 0 ? 'increase' : 'decrease', from: running, to: running + v, change: v, running: running + v })
    running += v
  })
  return { steps, start, end: running, mismatches, duplicates }
}

function compile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const { steps } = waterfallModel(s)
  const present = WATERFALL_KINDS.filter(k => steps.some(st => st.kind === k))
  const colors = (s.colors ?? {}) as Record<string, string>
  const series: SeriesInfo[] = present.map(k => ({ key: k, label: LABEL[k], color: colors[k] ?? c.c(TOKEN[k]), hidden: c.hidden.has(k) }))
  const colorOf = (k: WaterfallKind): string => colors[k] ?? c.c(TOKEN[k])
  const horizontal = s.orientation === 'horizontal'
  if (horizontal) c.axisFields = { x: s.y, y: s.x }
  const fmt = c.format
  const signed = (v: number): string => (v > 0 ? `+${fmt(v)}` : fmt(v))

  let lo = 0
  let hi = 0
  for (const st of steps) {
    lo = Math.min(lo, st.from, st.to)
    hi = Math.max(hi, st.from, st.to)
  }
  const override = s.yDomain as [number | null, number | null] | undefined
  const valueScale = override && (override[0] !== null || override[1] !== null)
    ? linearScale([override[0] ?? lo, override[1] ?? hi])
    : niceLinear(lo, hi, { zero: true })
  const keys = steps.map(st => st.key)
  const catScale = bandScale(keys, 0.25)

  const area = c.frame({ series, autoSide: 'top' })
  const va = valueAxis(c, valueScale, { title: horizontal ? s.xLabel : s.yLabel, vertical: !horizontal, format: s.format })
  const ca = bandAxis(catScale, Object.fromEntries(keys.map(k => [k, clip(k, 60)])), horizontal ? s.yLabel : s.xLabel, c.locale)
  const plot = horizontal ? layoutCartesian(c, area, va, ca) : layoutCartesian(c, area, ca, va)
  drawAnnotations(c, plot, horizontal ? va : ca, horizontal ? ca : va)
  const [d0, d1] = valueScale.domain
  if (d0 < 0 && d1 > 0) {
    const z = valueScale.at(0)
    c.marks.push(horizontal
      ? { type: 'line', role: 'axis', x1: z, x2: z, y1: plot.y, y2: plot.y + plot.h, stroke: c.c('text-muted') }
      : { type: 'line', role: 'axis', x1: plot.x, x2: plot.x + plot.w, y1: z, y2: z, stroke: c.c('text-muted') })
  }

  const bw = catScale.bandwidth
  const barW = Math.max(1, Math.min(MAX_BAR, bw))
  const radius = Math.min(c.theme.barRadius, barW / 2)
  const bars: Mark[] = []
  const links: Mark[] = []
  const labels: Mark[] = []
  const P = (v: number): number => valueScale.at(Math.max(Math.min(d0, d1), Math.min(Math.max(d0, d1), v)))
  steps.forEach((st, i) => {
    const color = colorOf(st.kind)
    const start = catScale.start(st.key) + (bw - barW) / 2
    // A connector carries the running total from this bar to the next one.
    const next = steps[i + 1]
    if (s.connectors !== false && next) {
      const level = P(st.running)
      const a = start + barW
      const b = catScale.start(next.key) + (bw - barW) / 2
      links.push(horizontal
        ? { type: 'line', role: 'data', x1: level, x2: level, y1: a, y2: b, stroke: c.c('text-muted'), strokeWidth: 1, dash: '3 3' }
        : { type: 'line', role: 'data', x1: a, x2: b, y1: level, y2: level, stroke: c.c('text-muted'), strokeWidth: 1, dash: '3 3' })
    }
    if (c.hidden.has(st.kind)) return
    const p0 = P(st.from)
    const p1 = P(st.to)
    const len = Math.max(1, Math.abs(p1 - p0))
    const tipRows = st.kind === 'total'
      ? [{ label: 'Total', value: fmt(st.running), color }, ...(st.computed !== undefined ? [{ label: 'Sum of the steps before', value: fmt(st.computed) }] : [])]
      : [{ label: LABEL[st.kind], value: signed(st.change), color }, { label: 'Running total', value: fmt(st.running) }]
    const aria = st.kind === 'total' ? `${st.key}: total ${fmt(st.running)}` : `${st.key}: ${st.kind} of ${fmt(Math.abs(st.change))}, running total ${fmt(st.running)}`
    const datum = st.kind === 'total' ? { x: st.key, kind: st.kind, total: st.running } : { x: st.key, kind: st.kind, change: st.change, total: st.running }
    const up = st.to >= st.from
    const r = Math.min(radius, len / 2)
    // Totals round their open end only; floating changes round both ends a little.
    const rr: [number, number, number, number] = st.kind === 'total'
      ? (horizontal ? (up ? [0, r, r, 0] : [r, 0, 0, r]) : (up ? [r, r, 0, 0] : [0, 0, r, r]))
      : [r / 2, r / 2, r / 2, r / 2]
    const common = { role: 'data' as const, series: st.kind, fill: color, tip: { title: clip(st.key, 60), rows: tipRows }, aria, datum, anim: (st.kind === 'total' ? (horizontal ? 'x' : 'y') : 'fade') as 'x' | 'y' | 'fade', r: rr }
    bars.push(horizontal
      ? { type: 'rect', x: Math.min(p0, p1), y: start, w: len, h: barW, ...common }
      : { type: 'rect', x: start, y: Math.min(p0, p1), w: barW, h: len, ...common })
    if (s.labels) {
      const text = st.kind === 'total' ? fmt(st.running) : signed(st.change)
      const tw = c.measure(text, c.size - 1)
      // Past the end the bar moves towards: right of (or above) rises, left of (or below) falls.
      if (horizontal) {
        const x = up ? Math.max(p0, p1) + 6 : Math.min(p0, p1) - 6
        labels.push(c.text(x, start + barW / 2, text, { role: 'label', baseline: 'middle', anchor: up ? 'start' : 'end', size: c.size - 1, fill: c.c('text') }))
      } else if (barW >= tw * 0.9 || steps.length <= 6) {
        const y = up ? Math.min(p0, p1) - 5 : Math.max(p0, p1) + c.size + 1
        labels.push(c.text(start + barW / 2, y, text, { role: 'label', anchor: 'middle', size: c.size - 1, fill: c.c('text') }))
      }
    }
  })
  c.marks.push(...links, ...bars, ...labels)
  return { series }
}

export const waterfall: ChartDef = {
  type: 'waterfall',
  name: 'Waterfall chart',
  summary: 'Shows how a starting value becomes a final one through signed steps: each change floats from the running total, totals stand on the axis.',
  useWhen: 'Explaining a change between two totals (budget to actual, opening to closing balance, price bridges) through a few to ~30 named contributions. Use a bar chart for sizes that do not add up; use a line for a running total over many dates.',
  cartesian: true,
  fields: {
    x: { kind: 'column', role: 'any', required: true, desc: 'Column holding the step label. Steps are drawn in data order; repeated labels are summed.' },
    y: { kind: 'column', role: 'number', required: true, desc: 'Numeric column with the signed change of each step. On a total row it may be empty (the bar shows the running total) or hold a reported balance.' },
    total: { kind: 'flag', desc: 'Marks the steps drawn as totals: a column of yes/no values (true, 1, "yes", "total", "subtotal" count as yes), or a list of step labels such as ["Gross profit", "Net"]. A total bar starts at 0 and shows the running total, or the row\'s own value when it has one.' },
    start: { kind: 'number', desc: 'Running total before the first step. Default 0. For an opening balance you want drawn, use a first row marked as a total instead.' },
    labels: { kind: 'boolean', default: false, desc: 'Print each change (signed) and each total on its bar. The tooltip always has the change and the running total.' },
    connectors: { kind: 'boolean', default: true, desc: 'Draw a thin dashed line carrying the running total from each bar to the next.' },
    orientation: { kind: 'enum', values: ['vertical', 'horizontal'], default: 'vertical', desc: 'Use `horizontal` for long step names; steps then run top to bottom.' },
    yDomain: { kind: 'domain', desc: 'Fix the value axis range, e.g. [0, 500]. The default includes 0 so totals are drawn honestly.' }
  },
  example: {
    type: 'waterfall',
    title: 'From revenue to net income',
    subtitle: 'USD millions, FY2026',
    x: 'item',
    y: 'amount',
    total: ['Gross profit', 'Net income'],
    labels: true,
    yLabel: 'USD m',
    data: [
      { item: 'Revenue', amount: 420 },
      { item: 'Cost of sales', amount: -168 },
      { item: 'Gross profit' },
      { item: 'R&D', amount: -61 },
      { item: 'Sales & marketing', amount: -74 },
      { item: 'Other income', amount: 12 },
      { item: 'Tax', amount: -28 },
      { item: 'Net income' }
    ]
  },
  check(spec, ctx) {
    const keys = [...new Set(ctx.rows.map(r => xKey(r[spec.x as string])))]
    if (Array.isArray(spec.total)) {
      ;(spec.total as string[]).forEach((t, i) => {
        if (keys.includes(t)) return
        const near = closest(t, keys)
        ctx.issues.push({ severity: 'warning', code: 'no_such_step', path: `total[${i}]`, message: `No step is labelled "${clip(t, 60)}"; it was ignored.`, ...(near ? { hint: `Did you mean "${near}"?` } : {}) })
      })
    } else if (typeof spec.total === 'string' && !ctx.rows.some(r => flagged(spec.total, r, undefined))) {
      ctx.issues.push({ severity: 'warning', code: 'no_totals', path: 'total', message: `No row of "${spec.total}" says yes, so no step is drawn as a total.`, hint: 'Use true, 1, "yes" or "total" for the total rows.' })
    }
    const m = waterfallModel({ ...spec, data: ctx.rows })
    if (m.duplicates) ctx.issues.push({ severity: 'warning', code: 'duplicate_steps', path: 'x', message: `${m.duplicates} row(s) repeat a step label; their changes were summed into one bar.` })
    if (m.mismatches.length) ctx.issues.push({ severity: 'warning', code: 'total_mismatch', path: 'total', message: `The value given for ${m.mismatches.slice(0, 3).map(k => `"${clip(k, 40)}"`).join(', ')} differs from the sum of the steps before it; the given value is drawn.`, hint: 'Leave y empty on a total row to draw the computed running total.' })
    if (!m.steps.length) ctx.issues.push({ severity: 'error', code: 'empty_data', path: 'y', message: 'No step has a numeric change and no row is a total.', hint: 'Give each step a signed number in y.' })
  },
  compile,
  describe(spec, env) {
    const { steps, start, end } = waterfallModel(spec)
    const f = formatter(spec, env.locale)
    const sg = (v: number): string => (v > 0 ? `+${f(v)}` : f(v))
    const changes = steps.filter(s => s.kind !== 'total')
    const totals = steps.filter(s => s.kind === 'total')
    const first = steps[0]
    const opening = first && first.kind === 'total' ? first.running : start
    let t = `${lead(spec, 'Waterfall chart')} ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}${totals.length ? ` and ${totals.length} ${totals.length === 1 ? 'total' : 'totals'}` : ''}, from ${f(opening)} to ${f(end)} (net ${sg(end - opening)}).`
    const ups = changes.filter(s => s.change > 0)
    const downs = changes.filter(s => s.change < 0)
    if (ups.length) {
      const u = ups.reduce((a, b) => (b.change > a.change ? b : a))
      t += ` Largest increase: ${clip(u.key, 40)} (${sg(u.change)}).`
    }
    if (downs.length) {
      const d = downs.reduce((a, b) => (b.change < a.change ? b : a))
      t += ` Largest decrease: ${clip(d.key, 40)} (${sg(d.change)}).`
    }
    if (totals.length) t += ` Totals: ${totals.slice(0, 5).map(s => `${clip(s.key, 30)} ${f(s.running)}`).join(', ')}${totals.length > 5 ? ` and ${totals.length - 5} more` : ''}.`
    return t
  }
}
