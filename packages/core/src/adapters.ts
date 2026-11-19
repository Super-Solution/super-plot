// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { isSafeColor } from './util/color.js'

/**
 * Structural copy of super-chat's `chart` card (`ChartCard`), so Super Plot can draw it without
 * importing super-chat. Candlesticks are not here: they belong to Super Chart.
 */
export interface ChatChartCard {
  kind: 'chart'
  title?: string
  variant?: 'series' | 'candlestick'
  xLabel?: string
  yLabel?: string
  xType?: 'time' | 'number' | 'category'
  series?: { name: string; points: [string | number, number][]; type?: 'line' | 'area' | 'bar' | 'scatter'; color?: string; axis?: 'left' | 'right' }[]
  candles?: unknown[]
  annotations?: { type: 'hline' | 'vline' | 'band'; value: string | number; to?: string | number; label?: string; tone?: string }[]
  stacked?: boolean
}

export interface Adapted {
  ok: boolean
  /** A plot spec when `ok`. */
  spec?: Record<string, unknown>
  /** What could not be carried over, in plain words. */
  notes: string[]
}

/**
 * super-chat `chart` card -> plot spec. One chart type per card (the first series' type wins, mixed
 * types are noted), one value axis (series on the right axis are left out with a note, not silently rescaled: the
 * card's long-form points would need pivoting to wide columns for `yRight`).
 */
export function fromChatChartCard(card: ChatChartCard): Adapted {
  const notes: string[] = []
  if (card.variant === 'candlestick' || (card.candles && !card.series?.length)) {
    return { ok: false, notes: ['Candlestick cards are financial charts: render them with Super Chart.'] }
  }
  const all = card.series ?? []
  if (!all.length) return { ok: false, notes: ['The card has no series.'] }
  const series = all.filter(s => s.axis !== 'right')
  if (series.length < all.length) notes.push(`${all.length - series.length} series on the right axis were left out: this adapter keeps one value axis. Plot them as a second chart, index both to a common base (the "index" transform step), or, knowing the risk, add them as "yRight" columns in wide-form data.`)
  if (!series.length) return { ok: false, notes }
  const type = series[0].type ?? 'line'
  if (series.some(s => (s.type ?? 'line') !== type)) notes.push(`Mixed series types: all drawn as "${type}".`)
  const xType = card.xType === 'number' ? 'linear' : card.xType ?? 'auto'
  const data = series.flatMap(s => s.points.map(([x, y]) => ({ x, y, series: s.name })))
  const colors: Record<string, string> = {}
  for (const s of series) if (s.color && isSafeColor(s.color)) colors[s.name] = s.color
  const annotations = (card.annotations ?? []).map(a => ({
    axis: (a.type === 'vline' || (a.type === 'band' && xType === 'time') ? 'x' : 'y') as 'x' | 'y',
    value: a.value,
    ...(a.to !== undefined ? { to: a.to } : {}),
    ...(a.label ? { label: a.label } : {}),
    ...(a.tone && ['neutral', 'positive', 'negative', 'warning', 'info'].includes(a.tone) ? { tone: a.tone } : {})
  }))
  if (card.annotations?.some(a => a.type === 'band')) notes.push('A `band` annotation is drawn on the x axis for time charts and on the y axis otherwise.')
  const spec: Record<string, unknown> = {
    type,
    data,
    x: 'x',
    y: 'y',
    series: 'series',
    ...(card.title ? { title: card.title } : {}),
    ...(card.xLabel ? { xLabel: card.xLabel } : {}),
    ...(card.yLabel ? { yLabel: card.yLabel } : {}),
    ...(type === 'scatter' ? { xType: xType === 'category' || xType === 'auto' ? 'auto' : xType } : { xType }),
    ...(card.stacked && (type === 'bar' || type === 'area') ? { stack: 'stack' } : {}),
    ...(series.length === 1 ? { legend: 'none' } : {}),
    ...(Object.keys(colors).length ? { colors } : {}),
    ...(annotations.length ? { annotations } : {})
  }
  return { ok: true, spec, notes }
}
