import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, SeriesInfo, Tip } from '../scene.js'
import type { Row } from '../schema.js'
import { bandScale, linearScale, niceLinear, type LinearScale } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { xKey } from '../data.js'
import { linearTicks, toNumber } from '../util/num.js'
import { formatPercent, tickFormatter } from '../util/format.js'
import { clip, fit } from '../util/text.js'
import { fmtList, formatter, lead } from './shared.js'

export interface BulletRow {
  key: string
  value: number | null
  target: number | null
  /** Qualitative ranges as [column name, upper threshold], ascending. */
  ranges: [string, number][]
}

const cols = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])

/** One row per measure (the first row of a repeated name wins). */
export function bulletRows(spec: Record<string, any>): { rows: BulletRow[]; duplicates: number; unordered: string[] } {
  const seen = new Set<string>()
  const rows: BulletRow[] = []
  const unordered: string[] = []
  let duplicates = 0
  const names = cols(spec.ranges)
  for (const r of spec.data as Row[]) {
    const key = xKey(r[spec.x])
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    const given = names.flatMap(n => {
      const v = toNumber(r[n])
      return v === null ? [] : [[n, v] as [string, number]]
    })
    if (given.some((g, i) => i && g[1] < given[i - 1][1])) unordered.push(key)
    rows.push({ key, value: toNumber(r[spec.value]), target: spec.target ? toNumber(r[spec.target]) : null, ranges: [...given].sort((a, b) => a[1] - b[1]) })
  }
  return { rows, duplicates, unordered }
}

/** The range a value falls in: the first whose threshold reaches it, else null (above them all). */
export const rangeOf = (row: BulletRow, v: number): string | null => row.ranges.find(([, t]) => v <= t)?.[0] ?? null

const extent = (rows: BulletRow[]): [number, number] => {
  let lo = 0
  let hi = 0
  for (const r of rows) for (const v of [r.value, r.target, ...r.ranges.map(x => x[1])]) {
    if (v === null) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return [lo, hi]
}

function compile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const { rows } = bulletRows(s)
  const vKey = String(s.value)
  const tKey = typeof s.target === 'string' ? s.target : undefined
  const colors = (s.colors ?? {}) as Record<string, string>
  const series: SeriesInfo[] = [{ key: vKey, label: clip(vKey, 60), color: c.seriesColor(vKey, 0), hidden: c.hidden.has(vKey) }]
  if (tKey && tKey !== vKey) series.push({ key: tKey, label: clip(tKey, 60), color: colors[tKey] ?? c.c('text'), hidden: c.hidden.has(tKey) })
  const vColor = series[0].color
  const tColor = series[1]?.color ?? c.c('text')
  const fmt = c.format
  const horizontal = s.orientation !== 'vertical'
  let each = s.scale === 'each'
  if (each && !horizontal) {
    c.warn('scale_each_horizontal', 'scale', '`scale: "each"` needs horizontal bullets; one shared scale was used.')
    each = false
  }
  if (each) for (const k of ['zoom', 'brush'] as const) if (s[k] && s[k] !== 'none') c.warn(`${k}_unsupported`, k, `${k} needs one shared value axis; it was ignored with \`scale: "each"\`.`)
  if (each && s.yDomain) c.warn('domain_ignored', 'yDomain', '`yDomain` is ignored with `scale: "each"`: every measure gets its own range.')
  if (each && Array.isArray(s.annotations) && s.annotations.length) c.warn('annotations_ignored', 'annotations', 'Annotations need one shared value axis; they were skipped with `scale: "each"`.')

  const tipOf = (r: BulletRow): Tip => {
    const out: Tip['rows'] = []
    if (r.value !== null) out.push({ label: series[0].label, value: fmt(r.value), color: vColor })
    if (r.target !== null && tKey) out.push({ label: clip(tKey, 60), value: fmt(r.target), color: tColor })
    if (r.value !== null && r.target !== null && r.target !== 0) out.push({ label: 'Of target', value: formatPercent(r.value / r.target, c.locale) })
    for (const [n, t] of r.ranges) out.push({ label: clip(n, 40), value: `up to ${fmt(t)}` })
    if (r.value !== null && r.ranges.length) out.push({ label: 'In range', value: clip(rangeOf(r, r.value) ?? `above ${r.ranges[r.ranges.length - 1][0]}`, 40) })
    return { title: clip(r.key, 60), rows: out }
  }
  const ariaOf = (r: BulletRow): string => {
    const parts = [r.value !== null ? `${vKey} ${fmt(r.value)}` : `no ${vKey}`]
    if (r.target !== null && tKey) parts.push(`${tKey} ${fmt(r.target)}`)
    if (r.value !== null && r.ranges.length) {
      const g = rangeOf(r, r.value)
      parts.push(g ? `in range ${g}` : 'above every range')
    }
    return `${r.key}: ${parts.join(', ')}`
  }
  const datumOf = (r: BulletRow): Record<string, unknown> => ({ x: r.key, value: r.value, target: r.target, ranges: Object.fromEntries(r.ranges) })

  /** One bullet across `thick` px centred on `mid`, values along `scale` (x when horizontal). */
  const draw = (r: BulletRow, scale: LinearScale, mid: number, thick: number, slot: { a: number; b: number }, out: Mark[]): void => {
    const [d0, d1] = scale.domain
    const P = (v: number): number => scale.at(Math.max(Math.min(d0, d1), Math.min(Math.max(d0, d1), v)))
    const base = Math.max(Math.min(d0, d1), Math.min(0, Math.max(d0, d1)))
    const seg = (a: number, b: number, across: number, extra: Partial<Mark>): Mark => {
      const p = Math.min(P(a), P(b))
      const len = Math.abs(P(b) - P(a))
      return horizontal
        ? { type: 'rect', role: 'data', x: p, y: mid - across / 2, w: len, h: across, ...extra } as Mark
        : { type: 'rect', role: 'data', x: mid - across / 2, y: p, w: across, h: len, ...extra } as Mark
    }
    // Qualitative ranges: one neutral tone, darkest for the first (worst) range, as in Few's design.
    const n = r.ranges.length
    let prev = base
    r.ranges.forEach(([, t], i) => {
      if (t <= prev) return
      out.push(seg(prev, t, thick, { fill: c.c('text-muted'), opacity: n === 1 ? 0.18 : Math.round((0.34 - (0.24 * i) / (n - 1)) * 100) / 100 }))
      prev = t
    })
    const tip = tipOf(r)
    if (r.value !== null && !c.hidden.has(vKey)) {
      out.push(seg(base, r.value, Math.max(4, thick / 3), { series: vKey, fill: vColor, tip, aria: ariaOf(r), datum: datumOf(r), anim: horizontal ? 'x' : 'y', r: 1 }))
    }
    if (r.target !== null && tKey && !c.hidden.has(tKey)) {
      const p = P(r.target)
      const half = (thick * 0.72) / 2
      out.push(horizontal
        ? { type: 'line', role: 'data', series: tKey, x1: p, x2: p, y1: mid - half, y2: mid + half, stroke: tColor, strokeWidth: 3 }
        : { type: 'line', role: 'data', series: tKey, x1: mid - half, x2: mid + half, y1: p, y2: p, stroke: tColor, strokeWidth: 3 })
    }
    // The whole row answers hover with every number, not only the thin value bar.
    out.push(horizontal
      ? { type: 'rect', role: 'hit', x: Math.min(P(d0), P(d1)), y: slot.a, w: Math.abs(P(d1) - P(d0)), h: slot.b - slot.a, fill: 'transparent', tip, aria: ariaOf(r), datum: datumOf(r) }
      : { type: 'rect', role: 'hit', x: slot.a, y: Math.min(P(d0), P(d1)), w: slot.b - slot.a, h: Math.abs(P(d1) - P(d0)), fill: 'transparent', tip, aria: ariaOf(r), datum: datumOf(r) })
  }

  const area = c.frame({ series, autoSide: 'top' })
  const marks: Mark[] = []
  if (!each) {
    const [lo, hi] = extent(rows)
    const override = s.yDomain as [number | null, number | null] | undefined
    const scale = override && (override[0] !== null || override[1] !== null) ? linearScale([override[0] ?? lo, override[1] ?? hi]) : niceLinear(lo, hi, { zero: true })
    const cats = bandScale(rows.map(r => r.key), 0.3)
    if (horizontal) c.axisFields = { x: vKey, y: s.x }
    const va = valueAxis(c, scale, { title: horizontal ? s.xLabel : s.yLabel, vertical: !horizontal, format: s.format })
    const ca = bandAxis(cats, Object.fromEntries(rows.map(r => [r.key, clip(r.key, 60)])), horizontal ? s.yLabel : s.xLabel, c.locale)
    const plot = horizontal ? layoutCartesian(c, area, va, ca) : layoutCartesian(c, area, ca, va)
    drawAnnotations(c, plot, horizontal ? va : ca, horizontal ? ca : va)
    const thick = Math.min(cats.bandwidth, 40)
    const step = cats.bandwidth / 0.7
    for (const r of rows) {
      const mid = cats.at(r.key)
      draw(r, scale, mid, thick, { a: mid - step / 2, b: mid + step / 2 }, marks)
    }
  } else {
    // Every measure on its own scale (mixed units), with its own ticks under it.
    const size = c.size
    const labelW = Math.min(area.w * 0.3, Math.max(0, ...rows.map(r => c.measure(clip(r.key, 60), size, 500))))
    const left = area.x + labelW + 12
    const right = area.x + area.w - 14
    const plotW = Math.max(40, right - left)
    const rowH = area.h / Math.max(1, rows.length)
    const thick = Math.max(6, Math.min(28, rowH - size - 14))
    if (rowH - size - 14 < 6) c.warn('bullet_cramped', 'x', `${rows.length} measures leave each about ${Math.round(rowH)} px; ticks may touch.`, 'Make the chart taller, or show fewer measures.')
    rows.forEach((r, i) => {
      const top = area.y + i * rowH
      const blockH = thick + 4 + size
      const mid = top + (rowH - blockH) / 2 + thick / 2
      const [lo, hi] = extent([r])
      const scale = niceLinear(lo, hi === lo ? lo + 1 : hi, { zero: true })
      scale.range = [left, left + plotW]
      const count = Math.max(2, Math.round(plotW / (c.compact ? 70 : 90)))
      const tf = tickFormatter(s.format, c.locale, scale.domain, count)
      for (const t of linearTicks(scale.domain[0], scale.domain[1], count)) {
        const px = scale.at(t)
        c.marks.push({ type: 'line', role: 'axis', x1: px, x2: px, y1: mid + thick / 2, y2: mid + thick / 2 + 3, stroke: c.c('axis') })
        c.marks.push(c.text(px, mid + thick / 2 + 4, tf(t), { anchor: 'middle', baseline: 'hanging', size: size - 1 }))
      }
      c.marks.push(c.text(left - 12, mid, fit(clip(r.key, 60), labelW, size, c.env.measure, 500), { anchor: 'end', baseline: 'middle', fill: c.c('text'), weight: 500 }))
      draw(r, scale, mid, thick, { a: top, b: top + rowH }, marks)
    })
  }
  // Ranges first, then values and targets, then the row-wide hover areas on top.
  c.marks.push(...marks.filter(m => m.role !== 'hit'), ...marks.filter(m => m.role === 'hit'))
  return { series }
}

export const bullet: ChartDef = {
  type: 'bullet',
  name: 'Bullet chart',
  summary: 'Compares one value per measure with its target, against qualitative ranges (poor, fair, good): a compact replacement for a gauge.',
  useWhen: 'A few to ~15 KPIs, each with a target and optional thresholds, in little space. Use `scale: "each"` when the measures have different units. Use a bar chart when there is no target or range; use a stat tile for a single number.',
  cartesian: true,
  fields: {
    x: { kind: 'column', role: 'any', required: true, desc: 'Column holding the name of each measure (one bullet per row, in data order).' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column with the actual value, drawn as the bar.' },
    target: { kind: 'column', role: 'number', desc: 'Numeric column with the target, drawn as a tick across the bar.' },
    ranges: { kind: 'columns', role: 'number', desc: 'Columns holding the upper threshold of each qualitative range, worst first, e.g. ["poor", "ok", "good"]. Drawn as bands of one neutral tone, darkest for the first.' },
    orientation: { kind: 'enum', values: ['horizontal', 'vertical'], default: 'horizontal', desc: '`vertical` stands the bullets up as columns (shared scale only).' },
    scale: { kind: 'enum', values: ['shared', 'each'], default: 'shared', desc: '`shared` puts every measure on one value axis (same unit); `each` gives every measure its own range and ticks (mixed units: revenue, margin, NPS).' },
    yDomain: { kind: 'domain', desc: 'Fix the shared value axis range. Ignored with `scale: "each"`.' }
  },
  example: {
    type: 'bullet',
    title: 'Q3 against plan',
    subtitle: 'Each measure on its own scale',
    x: 'kpi',
    value: 'actual',
    target: 'target',
    ranges: ['poor', 'fair', 'good'],
    scale: 'each',
    data: [
      { kpi: 'Revenue (USD k)', actual: 270, target: 250, poor: 150, fair: 225, good: 300 },
      { kpi: 'Profit (%)', actual: 22.5, target: 26, poor: 20, fair: 25, good: 30 },
      { kpi: 'New customers', actual: 1640, target: 2000, poor: 1400, fair: 2000, good: 2500 },
      { kpi: 'Satisfaction (1-5)', actual: 4.4, target: 4.5, poor: 3.5, fair: 4.25, good: 5 }
    ]
  },
  check(spec, ctx) {
    if (!spec.target && !(Array.isArray(spec.ranges) ? spec.ranges.length : spec.ranges)) {
      ctx.issues.push({ severity: 'warning', code: 'prefer_bar', path: 'type', message: 'Without a target or ranges a bullet chart is a bar chart.', hint: 'Add `target` and `ranges`, or use `type: "bar"`.' })
    }
    const { duplicates, unordered } = bulletRows({ ...spec, data: ctx.rows })
    if (duplicates) ctx.issues.push({ severity: 'warning', code: 'duplicate_measures', path: 'x', message: `${duplicates} row(s) repeat a measure name; only the first row of each is drawn.` })
    if (unordered.length) ctx.issues.push({ severity: 'warning', code: 'ranges_not_increasing', path: 'ranges', message: `The thresholds of ${unordered.slice(0, 3).map(k => `"${clip(k, 40)}"`).join(', ')} do not increase in column order; they were sorted.`, hint: 'List range columns worst first, each threshold higher than the one before.' })
  },
  compile,
  describe(spec, env) {
    const { rows } = bulletRows(spec)
    const f = formatter(spec, env.locale)
    const names = cols(spec.ranges)
    let t = `${lead(spec, 'Bullet chart')} ${rows.length} ${rows.length === 1 ? 'measure' : 'measures'} (${fmtList(rows.map(r => clip(r.key, 30)))})${spec.target ? ' against targets' : ''}${names.length ? `, with ranges ${fmtList(names)}` : ''}${spec.scale === 'each' ? ', each on its own scale' : ''}.`
    for (const r of rows.slice(0, 6)) {
      if (r.value === null) {
        t += ` ${clip(r.key, 30)}: no value.`
        continue
      }
      t += ` ${clip(r.key, 30)}: ${f(r.value)}`
      if (r.target !== null) t += ` against ${f(r.target)}${r.target !== 0 ? ` (${formatPercent(r.value / r.target, env.locale)} of target)` : ''}`
      if (r.ranges.length) {
        const g = rangeOf(r, r.value)
        t += g ? `, in ${g}` : ', above every range'
      }
      t += '.'
    }
    if (rows.length > 6) t += ` And ${rows.length - 6} more.`
    return t
  }
}
