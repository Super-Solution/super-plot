import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, Rect } from '../scene.js'
import { bandScale, linearScale, niceLinear } from '../scale.js'
import { bandAxis, drawAnnotations, layoutCartesian, valueAxis } from '../cartesian.js'
import { detectXKind, distinct, observations, xKey } from '../data.js'
import { toNumber } from '../util/num.js'
import { formatPercent } from '../util/format.js'
import { inkOn } from '../util/color.js'
import { clip } from '../util/text.js'
import { fmtList, formatter, lead, matrix } from './shared.js'
import { intervalCheck, intervalFields, intervalText, refuseLog, zeroBaselineScale } from './extras.js'

const MAX_BAR = 48

interface Model {
  cats: string[]
  keys: string[]
  m: Map<string, Map<string, number>>
}

function model(spec: Record<string, any>): Model {
  const obs = observations(spec.data, spec.x, spec.y, spec.series)
  const m = matrix(obs)
  let cats = distinct(obs.map(o => xKey(o.x)))
  const keys = distinct(obs.map(o => o.s))
  if (spec.sort && spec.sort !== 'none') {
    const total = (k: string): number => [...(m.get(k)?.values() ?? [])].reduce((a, b) => a + b, 0)
    cats = [...cats].sort((a, b) => (spec.sort === 'asc' ? total(a) - total(b) : total(b) - total(a)))
  }
  return { cats, keys, m }
}

/** Combo chart: columns drawn as lines over vertical bars, on the same value axis (never a second one). */
function lineCols(spec: Record<string, any>): string[] {
  if (spec.line === undefined || spec.orientation === 'horizontal' || spec.stack === 'normalize') return []
  return Array.isArray(spec.line) ? spec.line : [spec.line]
}

function compile(c: ChartCtx): { series: ReturnType<ChartCtx['makeSeries']> } {
  const s = c.spec
  const { cats, keys, m } = model(s)
  const lines = lineCols(s).filter(k => !keys.includes(k))
  const series = c.makeSeries([...keys, ...lines])
  const visible = keys.filter(k => !c.hidden.has(k))
  const stack = (s.stack ?? 'none') as 'none' | 'stack' | 'normalize'
  const horizontal = s.orientation === 'horizontal'
  if (horizontal) c.axisFields = { x: typeof s.y === 'string' ? s.y : undefined, y: s.x }
  // Line values per category (duplicates summed, like bars).
  const lineVal = new Map<string, Map<string, number>>()
  for (const k of lines) {
    const mm = new Map<string, number>()
    for (const r of s.data as Record<string, unknown>[]) {
      const v = toNumber(r[k])
      if (v === null) continue
      const cat = xKey(r[s.x])
      mm.set(cat, (mm.get(cat) ?? 0) + v)
    }
    lineVal.set(k, mm)
  }
  const fmt = c.format
  const labelOf: Record<string, string> = Object.fromEntries(cats.map(k => [k, clip(k, 60)]))
  // Whiskers: grouped bars only (validation warns on stacks). Intervals per category and series, summed like values.
  const whisk = stack === 'none' && !!s.yLower && !!s.yUpper
  const ivl = new Map<string, Map<string, [number, number]>>()
  if (whisk) {
    for (const o of observations(s.data, s.x, s.y, s.series)) {
      const a = toNumber(o.row[s.yLower])
      const b = toNumber(o.row[s.yUpper])
      if (o.y === null || a === null || b === null) continue
      const cat = xKey(o.x)
      let row = ivl.get(cat)
      if (!row) ivl.set(cat, (row = new Map()))
      const prev = row.get(o.s) ?? [0, 0]
      row.set(o.s, [prev[0] + Math.min(a, b), prev[1] + Math.max(a, b)])
    }
  }
  const lollipop = s.mark === 'lollipop' && stack === 'none'

  // Value extent.
  let lo = 0
  let hi = 0
  const totals = new Map<string, number>()
  for (const cat of cats) {
    const row = m.get(cat)
    let pos = 0
    let neg = 0
    let abs = 0
    for (const k of visible) {
      const v = row?.get(k)
      if (v === undefined) continue
      abs += Math.abs(v)
      if (v >= 0) pos += v
      else neg += v
      if (stack === 'none') {
        hi = Math.max(hi, v)
        lo = Math.min(lo, v)
        const iv = ivl.get(cat)?.get(k)
        if (iv) {
          hi = Math.max(hi, iv[1])
          lo = Math.min(lo, iv[0])
        }
      }
    }
    totals.set(cat, abs)
    if (stack === 'stack') {
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    }
  }
  if (stack === 'normalize') {
    hi = 1
    lo = 0
  }
  for (const k of lines) {
    if (c.hidden.has(k)) continue
    for (const v of lineVal.get(k)!.values()) {
      hi = Math.max(hi, v)
      lo = Math.min(lo, v)
    }
  }
  const override = s.yDomain as [number | null, number | null] | undefined
  const valueScale = override && (override[0] !== null || override[1] !== null)
    ? linearScale([override[0] ?? lo, override[1] ?? hi])
    : niceLinear(lo, hi, { zero: true })
  const vfmt = stack === 'normalize' ? 'percent' : s.format
  const catScale = bandScale(cats, 0.3)

  const area = c.frame({ series, autoSide: 'top' })
  const valueTitle = horizontal ? s.xLabel : s.yLabel
  const catTitle = horizontal ? s.yLabel : s.xLabel
  const va = valueAxis(c, valueScale, { title: valueTitle, vertical: !horizontal, format: vfmt })
  const ca = bandAxis(catScale, labelOf, catTitle, c.locale)
  const plot = horizontal ? layoutCartesian(c, area, va, ca) : layoutCartesian(c, area, ca, va)
  drawAnnotations(c, plot, horizontal ? va : ca, horizontal ? ca : va)

  const base = valueScale.at(Math.max(valueScale.domain[0], Math.min(0, valueScale.domain[1])))
  if (valueScale.domain[0] < 0 && valueScale.domain[1] > 0) {
    c.marks.push(horizontal
      ? { type: 'line', role: 'axis', x1: base, x2: base, y1: plot.y, y2: plot.y + plot.h, stroke: c.c('text-muted') }
      : { type: 'line', role: 'axis', x1: plot.x, x2: plot.x + plot.w, y1: base, y2: base, stroke: c.c('text-muted') })
  }

  const nGroup = stack === 'none' ? Math.max(1, visible.length) : 1
  const gap = c.theme.gap
  const bw = catScale.bandwidth
  const barW = Math.max(1, Math.min(MAX_BAR, (bw - gap * (nGroup - 1)) / nGroup))
  const groupW = barW * nGroup + gap * (nGroup - 1)
  const radius = Math.min(c.theme.barRadius, barW / 2)

  const bars: Mark[] = []
  const whiskers: Mark[] = []
  const labels: Mark[] = []
  for (const cat of cats) {
    const row = m.get(cat)
    const start = catScale.start(cat) + (bw - groupW) / 2
    let posAcc = 0
    let negAcc = 0
    const catTotal = totals.get(cat) ?? 0
    visible.forEach((k, gi) => {
      const raw = row?.get(k)
      if (raw === undefined) return
      const si = keys.indexOf(k)
      const v = stack === 'normalize' ? (catTotal ? raw / catTotal : 0) : raw
      let a: number
      let b: number
      let first = true
      if (stack === 'none') {
        a = 0
        b = v
      } else if (v >= 0) {
        first = posAcc === 0
        a = posAcc
        b = posAcc += v
      } else {
        first = negAcc === 0
        a = negAcc
        b = negAcc += v
      }
      let p0 = valueScale.at(a)
      let p1 = valueScale.at(b)
      if (stack !== 'none' && !first) p0 += (p1 > p0 ? 1 : -1) * gap
      const lenPx = Math.abs(p1 - p0)
      if (lenPx < 0.5 && v === 0) return
      const outer = stack === 'none' || isOuter(row, visible, k, v, stack)
      const r = Math.min(radius, lenPx / 2)
      const pos = v >= 0
      const off = stack === 'none' ? gi * (barW + gap) : 0
      const color = series[si].color
      const iv = ivl.get(cat)?.get(k)
      const tipRows = stack === 'none'
        ? [{ label: series[si].label, value: iv ? `${fmt(raw)} (${intervalText(fmt, iv[0], iv[1])})` : fmt(raw), color }]
        : visible.filter(kk => row?.get(kk) !== undefined).map(kk => {
            const rv = row!.get(kk)!
            const sv = series[keys.indexOf(kk)]
            return { label: sv.label, value: stack === 'normalize' ? `${fmt(rv)} (${formatPercent(catTotal ? Math.abs(rv) / catTotal : 0, c.locale)})` : fmt(rv), color: sv.color }
          })
      if (stack !== 'none' && visible.length > 1) {
        const visTotal = visible.reduce((q, kk) => q + (row?.get(kk) ?? 0), 0)
        tipRows.push({ label: 'Total', value: fmt(visTotal), color: undefined as unknown as string })
      }
      const common = {
        role: 'data' as const,
        series: k,
        fill: color,
        anim: (v < 0 ? 'fade' : horizontal ? 'x' : 'y') as 'x' | 'y' | 'fade',
        tip: { title: clip(cat, 60), rows: tipRows },
        aria: `${cat}, ${series[si].label}: ${fmt(raw)}${iv ? ` (${intervalText(fmt, iv[0], iv[1])})` : ''}`,
        datum: { x: cat, series: k, value: raw, ...(iv ? { lower: iv[0], upper: iv[1] } : {}) }
      }
      const mid = start + off + barW / 2
      if (iv) {
        // A whisker with caps from the lower to the upper end, across the middle of the bar.
        const w0 = valueScale.at(iv[0]), w1 = valueScale.at(iv[1])
        const capW = Math.max(3, Math.min(8, barW / 4))
        const ws = { type: 'line' as const, role: 'data' as const, series: k, stroke: c.c('text'), strokeWidth: 1.25, anim: 'fade' as const }
        if (horizontal) whiskers.push({ ...ws, x1: w0, x2: w1, y1: mid, y2: mid }, { ...ws, x1: w0, x2: w0, y1: mid - capW, y2: mid + capW }, { ...ws, x1: w1, x2: w1, y1: mid - capW, y2: mid + capW })
        else whiskers.push({ ...ws, x1: mid, x2: mid, y1: w0, y2: w1 }, { ...ws, x1: mid - capW, x2: mid + capW, y1: w0, y2: w0 }, { ...ws, x1: mid - capW, x2: mid + capW, y1: w1, y2: w1 })
      }
      if (lollipop) {
        // Stem from the baseline, dot at the value: the same length as the bar, far less ink.
        const dotR = Math.max(3, Math.min(6, barW / 2))
        bars.push(horizontal
          ? { type: 'line', role: 'data', series: k, x1: p0, x2: p1, y1: mid, y2: mid, stroke: color, strokeWidth: 2, anim: 'x' }
          : { type: 'line', role: 'data', series: k, x1: mid, x2: mid, y1: p0, y2: p1, stroke: color, strokeWidth: 2, anim: 'y' })
        bars.push({ type: 'circle', cx: horizontal ? p1 : mid, cy: horizontal ? mid : p1, r: dotR, stroke: c.c('background'), strokeWidth: 1.5, ...common, anim: 'fade' })
      } else if (horizontal) {
        const x = Math.min(p0, p1)
        const rr: [number, number, number, number] = outer ? (pos ? [0, r, r, 0] : [r, 0, 0, r]) : [0, 0, 0, 0]
        bars.push({ type: 'rect', x, y: start + off, w: Math.max(1, lenPx), h: barW, r: rr, ...common })
      } else {
        const y = Math.min(p0, p1)
        const rr: [number, number, number, number] = outer ? (pos ? [r, r, 0, 0] : [0, 0, r, r]) : [0, 0, 0, 0]
        bars.push({ type: 'rect', x: start + off, y, w: barW, h: Math.max(1, lenPx), r: rr, ...common })
      }
      if (s.labels) {
        const text = stack === 'normalize' ? formatPercent(catTotal ? Math.abs(raw) / catTotal : 0, c.locale, 0) : fmt(raw)
        const tw = c.measure(text, c.size - 1)
        const hex = c.seriesHex(k, si)
        if (stack === 'none') {
          // Past the whisker's far end, so the label never sits on it.
          const far = iv ? (horizontal ? (pos ? Math.max(p1, valueScale.at(iv[1])) : Math.min(p1, valueScale.at(iv[0]))) : (pos ? Math.min(p1, valueScale.at(iv[1])) : Math.max(p1, valueScale.at(iv[0])))) : p1
          const end = lollipop ? p1 : far
          if (lollipop) {
            // Beyond the dot (and the whisker, when there is one).
            const dotR = Math.max(3, Math.min(6, barW / 2))
            const outer = horizontal ? (pos ? Math.max(far, p1 + dotR) : Math.min(far, p1 - dotR)) : (pos ? Math.min(far, p1 - dotR) : Math.max(far, p1 + dotR))
            labels.push(horizontal
              ? c.text(outer + (pos ? 6 : -6), mid, text, { role: 'label', baseline: 'middle', anchor: pos ? 'start' : 'end', size: c.size - 1, fill: c.c('text') })
              : c.text(mid, outer + (pos ? -5 : 13), text, { role: 'label', anchor: 'middle', size: c.size - 1, fill: c.c('text') }))
          } else if (horizontal) {
            const inside = !iv && lenPx > tw + 12
            labels.push(c.text(inside ? end - (pos ? 6 : -6) : end + (pos ? 6 : -6), start + off + barW / 2, text, { role: 'label', baseline: 'middle', anchor: (pos === inside) ? 'end' : 'start', size: c.size - 1, fill: inside ? inkOn(hex) : c.c('text') }))
          } else if (barW >= tw * 0.9 || visible.length === 1) {
            labels.push(c.text(start + off + barW / 2, end + (pos ? -5 : 13), text, { role: 'label', anchor: 'middle', size: c.size - 1, fill: c.c('text') }))
          }
        } else if (lenPx >= (horizontal ? tw + 8 : c.size + 4) && barW >= (horizontal ? c.size : tw + 6)) {
          const mid = (p0 + p1) / 2
          labels.push(horizontal
            ? c.text(mid, start + barW / 2, text, { role: 'label', anchor: 'middle', baseline: 'middle', size: c.size - 1, fill: inkOn(hex) })
            : c.text(start + barW / 2, mid, text, { role: 'label', anchor: 'middle', baseline: 'middle', size: c.size - 1, fill: inkOn(hex) }))
        }
      }
    })
  }
  const overlay: Mark[] = []
  lines.forEach((k, li) => {
    if (c.hidden.has(k)) return
    const si = keys.length + li
    const color = series[si].color
    const pts = cats.flatMap(cat => {
      const v = lineVal.get(k)!.get(cat)
      return v === undefined ? [] : [{ cat, v, x: catScale.at(cat), y: valueScale.at(v) }]
    })
    if (pts.length > 1) overlay.push({ type: 'path', role: 'data', series: k, d: pts.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`).join(''), stroke: color, strokeWidth: c.theme.lineWidth, anim: 'draw' })
    for (const p of pts) {
      overlay.push({ type: 'circle', role: 'data', series: k, cx: p.x, cy: p.y, r: 4, fill: color, stroke: c.c('background'), strokeWidth: 2, anim: 'fade', tip: { title: clip(p.cat, 60), rows: [{ label: series[si].label, value: fmt(p.v), color }] }, aria: `${p.cat}, ${series[si].label}: ${fmt(p.v)}`, datum: { x: p.cat, series: k, value: p.v } })
    }
  })
  c.marks.push(...bars, ...whiskers, ...labels, ...overlay)
  void (plot satisfies Rect)
  return { series }
}

/** In a stack, only the segment at the open end gets the rounded corner. */
function isOuter(row: Map<string, number> | undefined, visible: string[], key: string, v: number, stack: string): boolean {
  if (stack === 'none') return true
  const same = visible.filter(k => row?.get(k) !== undefined && (row.get(k)! >= 0) === (v >= 0))
  return same[same.length - 1] === key
}

export const bar: ChartDef = {
  type: 'bar',
  name: 'Bar chart',
  summary: 'Compares a number across categories with one bar per category (grouped, stacked or 100% stacked).',
  useWhen: 'Comparing sizes across a handful to a few dozen categories, or parts of a whole per category (stacked). Use a line for ordered time; use a histogram to show how one measure is distributed; avoid for more than ~40 categories.',
  cartesian: true,
  fields: {
    x: { kind: 'column', role: 'any', required: true, desc: 'Column holding the category of each bar.' },
    y: { kind: 'columns', role: 'number', required: true, desc: 'Numeric column for bar length. Several columns give one series per column (wide-form data).' },
    series: { kind: 'column', role: 'any', desc: 'Column that splits each category into series (long-form data). Not needed when `y` lists several columns.' },
    stack: { kind: 'enum', values: ['none', 'stack', 'normalize'], default: 'none', desc: '`none` groups series side by side, `stack` stacks them, `normalize` stacks to 100%.' },
    orientation: { kind: 'enum', values: ['vertical', 'horizontal'], default: 'vertical', desc: 'Use `horizontal` for long category names or many categories.' },
    sort: { kind: 'enum', values: ['none', 'asc', 'desc'], default: 'none', desc: 'Order categories by their total. `none` keeps the data order (use it for ordered categories such as months).' },
    labels: { kind: 'boolean', default: false, desc: 'Print values on the bars. Keep off for dense charts; the tooltip carries the numbers.' },
    line: { kind: 'columns', role: 'number', desc: 'Combo chart: numeric column(s) drawn as lines with points over vertical bars, on the same value axis (a target, an average). Ignored for horizontal and 100% stacked bars.' },
    yDomain: { kind: 'domain', desc: 'Fix the value axis range, e.g. [0, 100]. Bars should start at 0; only change it knowingly.' },
    mark: { kind: 'enum', values: ['bar', 'lollipop'], desc: 'Default bar. `lollipop` draws a thin stem from zero and a dot at the value instead of a filled bar: the same chart (sort, orientation, labels, grouped series side by side) with less ink, good for many categories. Not for stacks: falls back to bars with a warning.' },
    ...intervalFields('y', 'a whisker with caps across each bar (grouped bars only; stacked bars ignore it with a warning)'),
    yScale: zeroBaselineScale('A bar\'s length')
  },
  example: {
    type: 'bar',
    title: 'Revenue by region',
    subtitle: 'USD millions, FY2026',
    x: 'region',
    y: ['Q1', 'Q2', 'Q3'],
    yLabel: 'Revenue (USD m)',
    data: [
      { region: 'APAC', Q1: 120, Q2: 138, Q3: 151 },
      { region: 'EMEA', Q1: 98, Q2: 104, Q3: 99 },
      { region: 'Americas', Q1: 142, Q2: 150, Q3: 171 },
      { region: 'LATAM', Q1: 41, Q2: 52, Q3: 58 }
    ]
  },
  check(spec, ctx) {
    if (Array.isArray(spec.y) && spec.y.length > 1 && spec.series) {
      ctx.issues.push({ severity: 'warning', code: 'series_ignored', path: 'series', message: '`series` is ignored when `y` lists several columns.' })
    }
    if (spec.stack === 'stack' || spec.stack === 'normalize') {
      let neg = false
      const ys = Array.isArray(spec.y) ? spec.y : [spec.y]
      for (const r of ctx.rows) for (const col of ys) if (typeof r[col as string] === 'number' && (r[col as string] as number) < 0) neg = true
      if (neg) ctx.issues.push({ severity: 'warning', code: 'negative_in_stack', path: 'y', message: 'Negative values in a stacked bar are stacked below the axis; check that is what you want.' })
    }
    if (spec.line !== undefined && (spec.orientation === 'horizontal' || spec.stack === 'normalize')) {
      ctx.issues.push({ severity: 'warning', code: 'line_ignored', path: 'line', message: `\`line\` is ignored on ${spec.orientation === 'horizontal' ? 'horizontal' : '100% stacked'} bars.` })
    }
    refuseLog(spec, ctx, 'yScale', 'a bar\'s length must start at zero (the honest baseline), and a log axis has no zero.', 'Use a line or a scatter with yScale "log" for values spanning orders of magnitude, or keep bars and set format "compact".')
    const stacked = spec.stack === 'stack' || spec.stack === 'normalize'
    if (spec.mark === 'lollipop' && stacked) ctx.issues.push({ severity: 'warning', code: 'lollipop_stacked', path: 'mark', message: 'Lollipops cannot stack (the dots would hide each other); stacked bars are drawn instead.', hint: 'Set stack to "none" for side-by-side lollipops.' })
    if (intervalCheck(spec, ctx, 'y') && stacked) ctx.issues.push({ severity: 'warning', code: 'interval_ignored_stacked', path: 'yLower', message: 'Whiskers cannot be shown on stacked bars (an interval belongs to one bar, not to a running total); they are left out.', hint: 'Set stack to "none" for grouped bars with whiskers.' })
    const kind = detectXKind('auto', ctx.rows.map(r => r[spec.x as string]))
    if (kind === 'time' && ctx.rows.length > 60) ctx.issues.push({ severity: 'warning', code: 'prefer_line', path: 'type', message: 'Many bars over time: a line or area chart reads better.' })
  },
  compile,
  describe(spec, env) {
    const { cats, keys, m } = model(spec)
    const f = formatter(spec, env.locale)
    const totals = cats.map(c => ({ c, v: [...(m.get(c)?.values() ?? [])].reduce((a, b) => a + b, 0) }))
    let t = `${lead(spec, spec.mark === 'lollipop' && (spec.stack ?? 'none') === 'none' ? 'Lollipop chart' : 'Bar chart')} ${cats.length} ${cats.length === 1 ? 'category' : 'categories'}`
    t += keys.length > 1 ? `, ${keys.length} series (${fmtList(keys)}${spec.stack === 'stack' ? ', stacked' : spec.stack === 'normalize' ? ', stacked to 100%' : ''}).` : '.'
    if (totals.length) {
      const hi = totals.reduce((a, b) => (b.v > a.v ? b : a))
      const lo = totals.reduce((a, b) => (b.v < a.v ? b : a))
      t += ` Highest: ${clip(hi.c, 40)} (${f(hi.v)}).`
      if (totals.length > 1) t += ` Lowest: ${clip(lo.c, 40)} (${f(lo.v)}).`
      t += ` Total: ${f(totals.reduce((a, b) => a + b.v, 0))}.`
    }
    const ls = lineCols(spec).filter(k => !keys.includes(k))
    if (ls.length) t += ` With ${ls.length === 1 ? 'a line' : 'lines'} for ${fmtList(ls)} on the same axis.`
    if (spec.yLower && spec.yUpper && (spec.stack ?? 'none') === 'none') t += ` Whiskers show ${clip(String(spec.yLower), 40)} to ${clip(String(spec.yUpper), 40)}.`
    return t
  }
}
