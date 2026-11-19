import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import { distinct } from '../data.js'
import { formatPercent } from '../util/format.js'
import { inkOn } from '../util/color.js'
import { toNumber, r2 } from '../util/num.js'
import { clip } from '../util/text.js'
import { formatter, lead, fmtList } from './shared.js'

interface Slice { key: string; value: number; other?: boolean }

function slices(spec: Record<string, any>, hidden: Set<string> = new Set()): { all: Slice[]; shown: Slice[]; order: string[]; skipped: number } {
  const sums = new Map<string, number>()
  let skipped = 0
  for (const r of spec.data as Record<string, unknown>[]) {
    const v = toNumber(r[spec.value])
    const k = String(r[spec.label] ?? '')
    if (v === null) continue
    if (v < 0) {
      skipped++
      continue
    }
    sums.set(k, (sums.get(k) ?? 0) + v)
  }
  const order = distinct((spec.data as Record<string, unknown>[]).map(r => String(r[spec.label] ?? ''))).filter(k => sums.has(k))
  let all: Slice[] = order.map(key => ({ key, value: sums.get(key)! }))
  if (spec.sort && spec.sort !== 'none') all = [...all].sort((a, b) => (spec.sort === 'asc' ? a.value - b.value : b.value - a.value))
  const max = spec.maxSlices ?? 8
  if (all.length > max) {
    // Keep the largest max-1 (by value), merge the rest; keep display order of survivors.
    const keep = new Set([...all].sort((a, b) => b.value - a.value).slice(0, max - 1).map(s => s.key))
    const rest = all.filter(s => !keep.has(s.key))
    all = [...all.filter(s => keep.has(s.key)), { key: 'Other', value: rest.reduce((q, s) => q + s.value, 0), other: true }]
  }
  return { all, shown: all.filter(s => !hidden.has(s.key) && s.value > 0), order, skipped }
}

const arc = (cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string => {
  const pt = (r: number, a: number): string => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const m = a0 + Math.PI
    const outer = `M${pt(r1, a0)}A${r1} ${r1} 0 1 1 ${pt(r1, m)}A${r1} ${r1} 0 1 1 ${pt(r1, a0)}`
    return r0 > 0 ? `${outer}M${pt(r0, a0)}A${r0} ${r0} 0 1 0 ${pt(r0, m)}A${r0} ${r0} 0 1 0 ${pt(r0, a0)}Z` : outer + 'Z'
  }
  if (r0 <= 0) return `M${cx} ${cy}L${pt(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)}Z`
  return `M${pt(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)}Z`
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const { all, shown, order, skipped } = slices(s, c.hidden)
  if (skipped) c.warn('negative_slices', 'data', `${skipped} negative value(s) were skipped; a pie cannot show negatives.`)
  const series = c.makeSeries(all.map(a => a.key)).map(si => {
    const slice = all.find(a => a.key === si.key)!
    // Colour follows the entity (position in the data), not its rank after sorting.
    const idx = slice.other ? -1 : order.indexOf(si.key)
    return { ...si, color: slice.other ? ((s.colors as Record<string, string> | undefined)?.Other ?? c.c('other')) : c.seriesColor(si.key, idx) }
  })
  const total = shown.reduce((q, a) => q + a.value, 0)
  const pct = (v: number): string => formatPercent(total ? v / total : 0, c.locale)
  const frame = c.frame({ series, alwaysLegend: true, autoSide: 'right', trailing: key => (c.hidden.has(key) ? '' : pct(all.find(a => a.key === key)!.value)) })
  const R = Math.max(20, Math.min(frame.w, frame.h) / 2 - 4)
  const cx = frame.x + frame.w / 2
  const cy = frame.y + frame.h / 2
  const inner = (s.innerRadius ?? (s.type === 'donut' ? 0.62 : 0)) as number
  const r0 = inner * R
  let a = -Math.PI / 2
  for (const sl of shown) {
    const sweep = (sl.value / total) * Math.PI * 2
    const info = series.find(x => x.key === sl.key)!
    const mid = a + sweep / 2
    c.marks.push({
      type: 'path', role: 'data', series: sl.key, d: arc(cx, cy, r0, R, a, a + sweep), fill: info.color, stroke: c.c('background'), strokeWidth: c.theme.gap, anim: 'fade',
      tip: { title: clip(sl.key, 60), rows: [{ label: s.value, value: c.format(sl.value), color: info.color }, { label: 'Share', value: pct(sl.value) }] },
      aria: `${sl.key}: ${c.format(sl.value)} (${pct(sl.value)})`, datum: { label: sl.key, value: sl.value }
    })
    if (s.labels !== false) {
      const rm = r0 > 0 ? (R + r0) / 2 : R * 0.62
      const text = formatPercent(sl.value / total, c.locale, 0)
      const arcLen = sweep * rm
      const tw = c.measure(text, c.size)
      // The label must fit the ring across (slices at the sides are as wide as the text) and along the arc.
      if (arcLen > tw + 10 && R - r0 > Math.max(c.size * 2, tw + 10)) {
        const hex = sl.other ? c.theme.colors.other : c.seriesHex(sl.key, order.indexOf(sl.key))
        c.marks.push(c.text(cx + rm * Math.cos(mid), cy + rm * Math.sin(mid), text, { role: 'label', anchor: 'middle', baseline: 'middle', weight: 600, fill: inkOn(hex) }))
      }
    }
    a += sweep
  }
  if (r0 > 36 && total > 0) {
    const big = c.compact ? 18 : 24
    c.marks.push(c.text(cx, cy - 2, s.centerLabel ? clip(s.centerLabel, 24) : c.format(total), { role: 'label', anchor: 'middle', baseline: 'alphabetic', size: big, weight: 600, fill: c.c('text') }))
    if (!s.centerLabel) c.marks.push(c.text(cx, cy + c.size + 4, 'Total', { role: 'label', anchor: 'middle', baseline: 'alphabetic', fill: c.c('text-muted') }))
  }
  return { series }
}

const FIELDS: ChartDef['fields'] = {
  label: { kind: 'column', role: 'any', required: true, desc: 'Column naming each slice.' },
  value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each slice\'s size. Rows with the same label are summed; negatives are skipped.' },
  sort: { kind: 'enum', values: ['none', 'asc', 'desc'], default: 'desc', desc: 'Slice order. `desc` puts the biggest slice first; `none` keeps the data order.' },
  maxSlices: { kind: 'number', min: 2, max: 12, integer: true, default: 8, desc: 'Show at most this many slices; the smallest merge into "Other". Keeps colours distinguishable.' },
  labels: { kind: 'boolean', default: true, desc: 'Print each slice\'s percentage on it when it fits.' },
  centerLabel: { kind: 'string', max: 24, desc: 'Donut only: text in the hole (default: the total).' }
}

function describePie(spec: Record<string, any>, env: { locale: string }, name: string): string {
  const { all } = slices(spec)
  const total = all.reduce((q, a) => q + a.value, 0)
  const f = formatter(spec, env.locale)
  let t = `${lead(spec, name)} ${all.length} ${all.length === 1 ? 'slice' : 'slices'} totalling ${f(total)}.`
  if (total > 0) {
    const sorted = [...all].sort((a, b) => b.value - a.value)
    t += ` Largest: ${clip(sorted[0].key, 40)} (${formatPercent(sorted[0].value / total, env.locale)}).`
    if (sorted.length > 2) t += ` The top ${Math.min(3, sorted.length)} (${fmtList(sorted.slice(0, 3).map(x => clip(x.key, 30)), 3)}) make up ${formatPercent(sorted.slice(0, 3).reduce((q, x) => q + x.value, 0) / total, env.locale)}.`
  }
  return t
}

export const pie: ChartDef = {
  type: 'pie',
  name: 'Pie chart',
  summary: 'Shows each category\'s share of a whole as angles of a circle.',
  useWhen: 'Few (2-6) parts of one whole where the point is "who has the biggest share". Prefer a bar chart to compare sizes precisely or to show more than ~7 parts. Not for time or for values that do not add up to a whole.',
  cartesian: false,
  fields: {
    ...FIELDS,
    innerRadius: { kind: 'number', min: 0, max: 0.9, desc: 'Hole radius as a share of the outer radius. 0 for a pie. `donut` defaults to 0.62.' }
  },
  example: {
    type: 'pie', title: 'Where the budget goes', subtitle: 'Share of FY2026 operating spend',
    label: 'area', value: 'amount', format: 'currency:USD',
    data: [{ area: 'Engineering', amount: 5400000 }, { area: 'Sales', amount: 3100000 }, { area: 'Marketing', amount: 1900000 }, { area: 'Support', amount: 1200000 }, { area: 'G&A', amount: 900000 }]
  },
  compile,
  describe: (spec, env) => describePie(spec, env, 'Pie chart')
}

export const donut: ChartDef = {
  ...pie,
  type: 'donut',
  name: 'Donut chart',
  summary: 'A pie chart with a hole; the hole shows the total.',
  useWhen: 'Same as a pie chart, when you also want to show the total in the middle.',
  example: { ...pie.example, type: 'donut', title: 'Traffic by source', subtitle: 'Sessions, last 30 days', label: 'source', value: 'sessions', format: 'compact', data: [{ source: 'Organic', sessions: 48200 }, { source: 'Direct', sessions: 21800 }, { source: 'Referral', sessions: 12400 }, { source: 'Social', sessions: 9300 }, { source: 'Email', sessions: 6100 }] },
  describe: (spec, env) => describePie(spec, env, 'Donut chart')
}
