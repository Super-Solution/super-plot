// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { Issue } from './schema.js'
import type { AxisInfo, Mark, Rect, SceneGeo, SceneView3d, SeriesInfo, TextMark } from './scene.js'
import type { RenderEnv } from './theme.js'
import { cssVar, resolveVars, seriesVar } from './theme.js'
import { fit, clip } from './util/text.js'
import { parseHex } from './util/color.js'
import { valueFormatter } from './util/format.js'
import { DEFAULT_STRINGS, fillString, type UiStringKey } from './strings.js'

export interface FrameOptions {
  series: SeriesInfo[]
  /** Force a legend even for one series (pie slices). */
  alwaysLegend?: boolean
  /** Extra text shown right-aligned in a `right` legend (for pies: the share). */
  trailing?: (key: string) => string
  /** Preferred side when the spec says `auto`. */
  autoSide?: 'top' | 'right'
}

/** What a chart gets while compiling: its spec, the environment, and the shared frame and helpers. */
export class ChartCtx<S extends Record<string, any> = Record<string, any>> {
  readonly marks: Mark[] = []
  /** Clip paths marks refer to by id (maps). */
  readonly clips: Record<string, string> = {}
  /** Maps: the geography payload for 3D renderers. */
  geo: SceneGeo | undefined
  /** 3D charts: the camera and keyboard order. */
  view3d: SceneView3d | undefined
  /** Set by `layoutCartesian`: the plot rectangle and scales (zoom, brush, facets). */
  axes: { plot: Rect; x: AxisInfo; y: AxisInfo } | undefined
  /** Data columns behind the x and y axes, when a chart's axes are not simply `spec.x` / `spec.y`. */
  axisFields: { x?: string; y?: string } | undefined
  readonly issues: Issue[]
  /** Series keys hidden by the viewer (legend toggles). */
  readonly hidden: Set<string>
  readonly compact: boolean
  readonly pad: number
  readonly size: number
  readonly format: (v: number) => string

  constructor(
    readonly spec: S,
    readonly env: RenderEnv,
    readonly width: number,
    readonly height: number,
    hidden: Iterable<string>,
    issues: Issue[],
    /** Top left corner of this chart inside the scene (small multiples draw several charts in one). */
    readonly origin: { x: number; y: number } = { x: 0, y: 0 }
  ) {
    this.hidden = new Set(hidden)
    this.issues = issues
    this.compact = width < 420
    this.pad = this.compact ? 12 : 16
    this.size = this.compact ? env.theme.fontSize - 1 : env.theme.fontSize
    this.format = valueFormatter(spec.format, env.locale)
  }

  get theme() { return this.env.theme }
  get locale() { return this.env.locale }
  /** IANA time zone for dates on this chart (`UTC` unless the render options name another). */
  get timeZone(): string { return this.env.timeZone ?? 'UTC' }

  /** A UI string (the host's override or the English default) with `{name}` placeholders filled in. */
  t(key: UiStringKey, vars?: Record<string, string | number>): string {
    return fillString(this.env.strings?.[key] ?? DEFAULT_STRINGS[key], vars)
  }

  /** `var(--sp-token, value)` paint for a theme token. */
  c(token: string): string { return cssVar(this.env.theme, token) }

  measure(text: string, size = this.size, weight = 400): number { return this.env.measure(text, size, weight) }

  warn(code: string, path: string, message: string, hint?: string): void {
    this.issues.push({ severity: 'warning', code, path, message, ...(hint ? { hint } : {}) })
  }

  /** Colour for a series: spec override first, then the palette by position. */
  seriesColor(key: string, index: number): string {
    const o = (this.spec.colors as Record<string, string> | undefined)?.[key]
    return o ?? seriesVar(this.env.theme, index)
  }

  /** Plain hex for a series, for maths (label contrast, interpolation). */
  seriesHex(key: string, index: number): string {
    const o = (this.spec.colors as Record<string, string> | undefined)?.[key]
    const p = this.env.theme.palette
    return o && parseHex(o) ? o : resolveVars(p[((index % p.length) + p.length) % p.length])
  }

  makeSeries(keys: string[], labels?: Record<string, string>): SeriesInfo[] {
    if (keys.length > this.env.theme.palette.length) {
      this.warn('too_many_series', 'series', `${keys.length} series is more than the ${this.env.theme.palette.length} distinct palette colours; colours repeat.`, 'Group the smallest series into "Other", or split into small multiples.')
    }
    return keys.map((key, i) => ({ key, label: clip(labels?.[key] ?? key, 60), color: this.seriesColor(key, i), hidden: this.hidden.has(key) }))
  }

  /** Text mark with theme defaults. */
  text(x: number, y: number, text: string, o: Partial<TextMark> = {}): TextMark {
    return { type: 'text', role: 'axis-label', x, y, text, size: this.size, fill: this.c('text-muted'), ...o }
  }

  /** Title, subtitle, legend and source line. Returns the rectangle left for the chart itself. */
  frame(opts: FrameOptions): Rect {
    const { spec, pad } = this
    const w = this.width
    const h = this.height
    const ox = this.origin.x
    const oy = this.origin.y
    let top = oy + pad
    let bottom = oy + h - pad
    let right = ox + w - pad
    const left = ox + pad

    if (spec.title) {
      const size = this.compact ? this.theme.titleSize - 2 : this.theme.titleSize
      this.marks.push(this.text(left, top, fit(String(spec.title), w - pad * 2, size, this.env.measure, 600), { role: 'title', size, weight: 600, fill: this.c('text'), baseline: 'hanging' }))
      top += size * 1.3
    }
    if (spec.subtitle) {
      this.marks.push(this.text(left, top + 2, fit(String(spec.subtitle), w - pad * 2, this.size, this.env.measure), { role: 'title', baseline: 'hanging' }))
      top += this.size * 1.5 + 2
    }
    if (spec.title || spec.subtitle) top += 8

    if (spec.source) {
      bottom -= this.size
      this.marks.push(this.text(left, bottom + 2, fit(String(spec.source), w - pad * 2, this.size - 1, this.env.measure), { role: 'title', size: this.size - 1, baseline: 'hanging' }))
      bottom -= 6
    }

    const wantLegend = spec.legend !== 'none' && (opts.alwaysLegend || opts.series.length > 1)
    if (wantLegend) {
      let side: 'top' | 'bottom' | 'right' = spec.legend === 'top' || spec.legend === 'bottom' || spec.legend === 'right' ? spec.legend : opts.autoSide ?? 'top'
      if (side === 'right' && w < 480) side = 'bottom'
      if (side === 'right') {
        const trailing = opts.trailing
        const labelW = Math.max(...opts.series.map(s => this.measure(s.label)), 0)
        const trailW = trailing ? Math.max(...opts.series.map(s => this.measure(trailing(s.key))), 0) + 12 : 0
        const colW = Math.min(Math.max(120, labelW + trailW + 28), w * 0.4)
        const x0 = ox + w - pad - colW
        const rowH = this.size + 12
        const total = opts.series.length * rowH
        let y = top + Math.max(0, (bottom - top - total) / 2)
        for (const s of opts.series) {
          this.legendItem(s, x0, y, colW, trailing?.(s.key))
          y += rowH
        }
        right = x0 - 16
      } else {
        const rowH = this.size + 12
        const maxW = w - pad * 2
        const widths = opts.series.map(s => 10 + 6 + this.measure(s.label) + 18)
        const rows: number[][] = [[]]
        let used = 0
        widths.forEach((iw, i) => {
          if (used + iw > maxW && rows[rows.length - 1].length) {
            rows.push([])
            used = 0
          }
          rows[rows.length - 1].push(i)
          used += iw
        })
        const blockH = rows.length * rowH
        let y = side === 'top' ? top : bottom - blockH
        for (const row of rows) {
          let x = left
          for (const i of row) {
            this.legendItem(opts.series[i], x, y, widths[i] - 8)
            x += widths[i]
          }
          y += rowH
        }
        if (side === 'top') top += blockH + 4
        else bottom -= blockH + 4
      }
    }
    return { x: left, y: top, w: Math.max(40, right - left), h: Math.max(40, bottom - top) }
  }

  private legendItem(s: SeriesInfo, x: number, y: number, w: number, trailing?: string): void {
    const rowH = this.size + 12
    const cy = y + rowH / 2
    const dim = s.hidden ? 0.4 : 1
    this.marks.push({ type: 'rect', role: 'legend', x, y: cy - 5, w: 10, h: 10, r: 2, fill: s.color, opacity: dim, series: s.key })
    const maxText = w - 16 - (trailing ? this.measure(trailing) + 12 : 0)
    this.marks.push(this.text(x + 16, cy, fit(s.label, maxText, this.size, this.env.measure), { role: 'legend', baseline: 'middle', fill: this.c('text'), opacity: dim, series: s.key }))
    if (trailing) this.marks.push(this.text(x + w, cy, trailing, { role: 'legend', baseline: 'middle', anchor: 'end', opacity: dim, series: s.key }))
    // Last, so it sits on top of the swatch and the label and the whole row is clickable.
    this.marks.push({ type: 'rect', role: 'legend', x: x - 4, y, w: w + 8, h: rowH, fill: 'transparent', legendKey: s.key, series: s.key, aria: this.t('legendToggle', { label: s.label }) })
  }
}
