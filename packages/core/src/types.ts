import type { Row } from './schema.js'

export type { Row }

export type LegendPosition = 'auto' | 'top' | 'bottom' | 'right' | 'none'
export type Stack = 'none' | 'stack' | 'normalize'

export interface Annotation {
  /** Which axis `value` is on. */
  axis: 'x' | 'y'
  value: string | number
  /** Second bound: draws a band between `value` and `to`. */
  to?: string | number
  label?: string
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info'
}

/** Fields every chart accepts. */
export interface BaseSpec {
  /** Spec format version. Only 1 exists. */
  version?: 1
  type: string
  /** Tabular rows: one object per observation. */
  data: Row[]
  title?: string
  subtitle?: string
  /** Long description for screen readers and agents. Generated from the data when omitted. */
  description?: string
  /** Small "Source: ..." line under the chart. */
  source?: string
  legend?: LegendPosition
  tooltip?: boolean
  /** Value format for ticks, tooltips and labels. */
  format?: string
  /** Series name (or slice/category name) to CSS colour. */
  colors?: Record<string, string>
}

export interface CartesianSpec extends BaseSpec {
  x?: string
  /** One column, or several columns for wide-form data (one series per column). */
  y?: string | string[]
  series?: string
  xLabel?: string
  yLabel?: string
  xType?: 'auto' | 'category' | 'linear' | 'time'
  yDomain?: [number | null, number | null]
  annotations?: Annotation[]
}

export interface BarSpec extends CartesianSpec {
  type: 'bar'
  stack?: Stack
  orientation?: 'vertical' | 'horizontal'
  sort?: 'none' | 'asc' | 'desc'
  labels?: boolean
}

export interface LineSpec extends CartesianSpec {
  type: 'line'
  curve?: 'linear' | 'smooth' | 'step'
  points?: boolean
  labels?: boolean
}

export interface AreaSpec extends CartesianSpec {
  type: 'area'
  stack?: Stack
  curve?: 'linear' | 'smooth' | 'step'
}

export interface ScatterSpec extends CartesianSpec {
  type: 'scatter'
  /** Column driving bubble area. */
  size?: string
  /** Column used as the point's name in tooltips. */
  label?: string
  trend?: 'none' | 'linear'
}

export interface PieSpec extends BaseSpec {
  type: 'pie' | 'donut'
  /** Column naming each slice. */
  label?: string
  /** Column holding each slice's size. Rows with the same label are summed. */
  value?: string
  /** Hole radius as a share of the outer radius: 0 for a pie. */
  innerRadius?: number
  sort?: 'none' | 'asc' | 'desc'
  /** Keep at most this many slices; the rest merge into "Other". */
  maxSlices?: number
  labels?: boolean
  centerLabel?: string
}

export interface HistogramSpec extends BaseSpec {
  type: 'histogram'
  value?: string
  series?: string
  bins?: number | 'auto'
  binWidth?: number
  mode?: 'count' | 'density' | 'percent'
  showMean?: boolean
  xLabel?: string
  yLabel?: string
}

export interface BoxSpec extends BaseSpec {
  type: 'box'
  /** Group column; omit for a single box. */
  x?: string
  y?: string
  outliers?: boolean
  orientation?: 'vertical' | 'horizontal'
  xLabel?: string
  yLabel?: string
  yDomain?: [number | null, number | null]
}

export interface HeatmapSpec extends BaseSpec {
  type: 'heatmap'
  x?: string
  y?: string
  value?: string
  labels?: boolean
  domain?: [number | null, number | null]
  xLabel?: string
  yLabel?: string
}

export type PlotSpec = BarSpec | LineSpec | AreaSpec | ScatterSpec | PieSpec | HistogramSpec | BoxSpec | HeatmapSpec
