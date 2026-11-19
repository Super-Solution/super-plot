// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { Mark, SeriesInfo } from '../scene.js'
import { CARTESIAN_FIELDS, type Row } from '../schema.js'
import { bandScale } from '../scale.js'
import { xKey } from '../data.js'
import { toNumber, r2 } from '../util/num.js'
import { formatPercent } from '../util/format.js'
import { inkOn } from '../util/color.js'
import { clip, fit } from '../util/text.js'
import { fmtList, formatter, lead } from './shared.js'

/** More stages than this is a list, not a funnel. */
export const MAX_STAGES = 40

export interface FunnelStage {
  key: string
  value: number
  /** Share of the first stage, or null when the first stage is 0. */
  ofFirst: number | null
  /** Share of the stage before (null for the first stage, or when that one is 0). */
  ofPrevious: number | null
}

/** Stages in data order, duplicates summed; rows without a number and negative values are left out. */
export function funnelStages(spec: Record<string, any>): { stages: FunnelStage[]; negative: number; duplicates: number } {
  const order: string[] = []
  const sums = new Map<string, number>()
  let negative = 0
  let duplicates = 0
  for (const r of spec.data as Row[]) {
    const v = toNumber(r[spec.value])
    if (v === null) continue
    if (v < 0) {
      negative++
      continue
    }
    const k = xKey(r[spec.stage])
    if (sums.has(k)) duplicates++
    else order.push(k)
    sums.set(k, (sums.get(k) ?? 0) + v)
  }
  const first = order.length ? sums.get(order[0])! : 0
  const stages = order.map((key, i) => {
    const value = sums.get(key)!
    const prev = i ? sums.get(order[i - 1])! : 0
    return { key, value, ofFirst: first > 0 ? value / first : null, ofPrevious: i && prev > 0 ? value / prev : null }
  })
  return { stages, negative, duplicates }
}

function compile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const { stages } = funnelStages(s)
  const key = String(s.value)
  const series = c.makeSeries([key])
  const color = series[0].color
  const hex = c.seriesHex(key, 0)
  const area = c.frame({ series })
  const fmt = c.format
  const pct = (v: number | null): string => (v === null ? '–' : formatPercent(v, c.locale))

  const labelW = Math.min(area.w * 0.32, Math.max(0, ...stages.map(st => c.measure(clip(st.key, 60)))))
  const x0 = area.x + labelW + 12
  const w = Math.max(20, area.x + area.w - x0)
  const mid = x0 + w / 2
  const rows = bandScale(stages.map(st => st.key), stages.length > 1 ? 0.18 : 0.5)
  rows.range = [area.y, area.y + area.h]
  const h = Math.min(rows.bandwidth, 64)
  const max = Math.max(0, ...stages.map(st => st.value))
  const widthOf = (v: number): number => (max > 0 ? Math.max(1, (w * v) / max) : 1)

  const marks: Mark[] = []
  const links: Mark[] = []
  const labels: Mark[] = []
  const hidden = c.hidden.has(key)
  stages.forEach((st, i) => {
    const cy = rows.at(st.key)
    const top = cy - h / 2
    const bw = widthOf(st.value)
    labels.push(c.text(x0 - 12, cy, fit(clip(st.key, 60), labelW, c.size, c.env.measure), { anchor: 'end', baseline: 'middle', fill: c.c('text') }))
    if (hidden) return
    const next = stages[i + 1]
    if (s.connectors !== false && next) {
      // The drop-off between two stages, as a faint band joining their bars.
      const nw = widthOf(next.value)
      const ntop = rows.at(next.key) - h / 2
      const b = top + h
      links.push({ type: 'path', role: 'data', d: `M${r2(mid - bw / 2)} ${r2(b)}L${r2(mid + bw / 2)} ${r2(b)}L${r2(mid + nw / 2)} ${r2(ntop)}L${r2(mid - nw / 2)} ${r2(ntop)}Z`, fill: color, opacity: 0.14 })
    }
    const rowsTip = [
      { label: series[0].label, value: fmt(st.value), color },
      { label: c.t('ofFirstStage'), value: pct(st.ofFirst) },
      ...(i ? [{ label: c.t('ofStageBefore'), value: pct(st.ofPrevious) }] : [])
    ]
    marks.push({
      type: 'rect', role: 'data', series: key, x: mid - bw / 2, y: top, w: bw, h, r: Math.min(c.theme.barRadius, h / 2, bw / 2), fill: color, anim: 'x',
      tip: { title: clip(st.key, 60), rows: rowsTip },
      aria: `${st.key}: ${fmt(st.value)}, ${c.t('ofFirstStageAria', { share: pct(st.ofFirst) })}${i ? `, ${c.t('ofStageBeforeAria', { share: pct(st.ofPrevious) })}` : ''}`,
      datum: { stage: st.key, value: st.value, ofFirst: st.ofFirst, ofPrevious: st.ofPrevious }
    })
    if (s.labels !== false) {
      // The value and the share; the share alone when space is short (the tooltip keeps both).
      const place = (text: string): { text: string; inside: boolean } | null => {
        const tw = c.measure(text, c.size - 1)
        return bw >= tw + 16 ? { text, inside: true } : (w - bw) / 2 >= tw + 8 ? { text, inside: false } : null
      }
      const got = place(`${fmt(st.value)} · ${pct(st.ofFirst)}`) ?? place(pct(st.ofFirst))
      if (got) {
        const { text, inside } = got
        labels.push(inside
          ? c.text(mid, cy, text, { role: 'label', anchor: 'middle', baseline: 'middle', size: c.size - 1, fill: inkOn(hex), weight: 500 })
          : c.text(mid + bw / 2 + 6, cy, text, { role: 'label', baseline: 'middle', size: c.size - 1, fill: c.c('text') }))
      }
    }
  })
  c.marks.push(...links, ...marks, ...labels)
  return { series }
}

export const funnel: ChartDef = {
  type: 'funnel',
  name: 'Funnel chart',
  summary: 'Shows how many remain at each stage of a process, as centred bars whose width is the value, labelled with the share of the first stage.',
  useWhen: 'An ordered process where each stage is a subset of the one before (visit, sign-up, purchase), 3 to ~10 stages. Use a bar chart when the stages are not nested; a funnel whose values rise misleads (Super Plot warns). One number on its own is a stat tile, not a chart.',
  cartesian: false,
  fields: {
    stage: { kind: 'column', role: 'any', required: true, desc: 'Column holding the stage name. Stages are drawn top to bottom in data order; repeated names are summed.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column with the count (or amount) at each stage. Negative values are skipped.' },
    labels: { kind: 'boolean', default: true, desc: 'Print the value and the share of the first stage on (or beside) each bar. The tooltip also has the share of the stage before.' },
    connectors: { kind: 'boolean', default: true, desc: 'Shade the drop-off between consecutive bars. The bar widths alone carry the values; the shading only joins them.' },
    facet: CARTESIAN_FIELDS.facet
  },
  example: {
    type: 'funnel',
    title: 'Checkout funnel',
    subtitle: 'Sessions, November 2026',
    stage: 'step',
    value: 'sessions',
    format: 'integer',
    data: [
      { step: 'Visited product', sessions: 48200 },
      { step: 'Added to cart', sessions: 12650 },
      { step: 'Started checkout', sessions: 7410 },
      { step: 'Entered payment', sessions: 5120 },
      { step: 'Purchased', sessions: 4380 }
    ]
  },
  check(spec, ctx) {
    const { stages, negative, duplicates } = funnelStages({ ...spec, data: ctx.rows })
    if (stages.length > MAX_STAGES) ctx.issues.push({ severity: 'error', code: 'too_many_stages', path: 'stage', message: `${stages.length} stages; a funnel takes at most ${MAX_STAGES}.`, hint: 'Group stages, or use a bar chart.' })
    if (!stages.length) ctx.issues.push({ severity: 'error', code: 'empty_data', path: 'value', message: 'No stage has a value of 0 or more.' })
    if (negative) ctx.issues.push({ severity: 'warning', code: 'negative_values', path: 'value', message: `${negative} negative value(s) were skipped; a funnel cannot show them.` })
    if (duplicates) ctx.issues.push({ severity: 'warning', code: 'duplicate_stages', path: 'stage', message: `${duplicates} row(s) repeat a stage name; their values were summed.` })
    const rise = stages.findIndex((st, i) => i > 0 && st.value > stages[i - 1].value)
    if (rise > 0) {
      ctx.issues.push({ severity: 'warning', code: 'funnel_increases', path: 'value', message: `"${clip(stages[rise].key, 40)}" is larger than the stage before it ("${clip(stages[rise - 1].key, 40)}"); a funnel reads as narrowing, so it misleads here. Drawn anyway.`, hint: 'Check the stage order, or use a bar chart for stages that are not subsets of each other.' })
    }
  },
  compile,
  describe(spec, env) {
    const { stages } = funnelStages(spec)
    const f = formatter(spec, env.locale)
    const pct = (v: number | null): string => (v === null ? '–' : formatPercent(v, env.locale))
    if (!stages.length) return `${lead(spec, 'Funnel chart')} No stages.`
    const first = stages[0]
    const last = stages[stages.length - 1]
    if (stages.length === 1) return `${lead(spec, 'Funnel chart')} 1 stage: ${clip(first.key, 40)}, ${f(first.value)}.`
    let t = `${lead(spec, 'Funnel chart')} ${stages.length} stages (${fmtList(stages.map(st => clip(st.key, 30)))}), from ${f(first.value)} at ${clip(first.key, 40)} to ${f(last.value)} at ${clip(last.key, 40)}`
    t += last.ofFirst === null ? '; the first stage is 0, so there are no shares of it.' : `: ${pct(last.ofFirst)} of the first stage reach the last.`
    let worst: FunnelStage | null = null
    let worstIdx = 0
    stages.forEach((st, i) => {
      if (i && st.ofPrevious !== null && (worst === null || st.ofPrevious < worst.ofPrevious!)) {
        worst = st
        worstIdx = i
      }
    })
    const w = worst as FunnelStage | null
    if (w && w.ofPrevious! < 1) t += ` Largest drop: ${clip(stages[worstIdx - 1].key, 40)} to ${clip(w.key, 40)}, ${pct(w.ofPrevious)} continue.`
    if (stages.some((st, i) => i && st.value > stages[i - 1].value)) t += ' The value rises between some stages.'
    return t
  }
}
