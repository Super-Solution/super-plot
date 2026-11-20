// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { Row } from './schema.js'
import type { Mark, Scene } from './scene.js'
import { getChart, type RefShape } from './registry.js'
import { validatePlot } from './validate.js'
import { detectXKind, xKey, type XKind } from './data.js'
import { toNumber } from './util/num.js'
import { toTime } from './util/time.js'
import { clip } from './util/text.js'
import { CARD_REF_LIMITS, formatCardRef, parseCardRef, type CardRef } from './ref.js'

/** The names a plot reference reads. Anything else is `ref_param_unknown`. */
export const REF_PARAMS = ['key', 'x', 'y', 'series'] as const

/** What a reference matched, or why it matched nothing. Assignable to the protocol's `CardRefResult`. */
export type RefMatch =
  | {
      ok: true
      /** Indexes into the spec's data after `transform`, ascending: the rows a mark draws carry the same numbers (`Mark.rows`). */
      rows: number[]
      /**
       * Each matched data point: its row, and its series where one row draws several (wide form: `y: ["Q1", "Q2"]`,
       * a bar chart's `line`), so a highlight outlines only that series' mark.
       */
      points: { row: number; series?: string }[]
      /** The legend entries (series keys) of the matched points, in order of first appearance. */
      series: string[]
      /** The `key` of each matched annotation, in the spec's order. */
      keys: string[]
      /** A short plain description of what matched, for a screen reader or a chat. */
      label: string
    }
  | { ok: false; code: string; reason: string; series?: string[] }

export interface ResolveOptions {
  /** Series the viewer hid (legend toggles): points in them do not count, and a reference that matches only them is `ref_hidden_series`. */
  hidden?: Iterable<string>
}

const DECIMAL = /^-?[0-9]+(?:\.[0-9]+)?$/
const PREFIX = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?Z?)?)?)?$/
const DAY = 86_400_000
const leap = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
const daysIn = (y: number, m: number): number => (m === 2 ? (leap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31)

/** A closed interval of numbers (epoch ms on a time column), or a set of category texts. */
type Want = { lo: number; hi: number } | { text: string } | { from: string; to: string }

/** A date written as a prefix of ISO 8601, as the closed interval of the whole period it names; null when it is not one. */
export function datePeriod(value: string): [number, number] | null {
  const m = PREFIX.exec(value)
  if (!m) {
    const t = toTime(value)
    return t === null ? null : [t, t]
  }
  const y = Number(m[1])
  const start = toTime(m[2] === undefined ? `${m[1]}-01` : value)
  if (start === null) return null
  const span = m[2] === undefined ? (leap(y) ? 366 : 365) * DAY : m[3] === undefined ? daysIn(y, Number(m[2])) * DAY : m[4] === undefined ? DAY : m[6] === undefined ? 60_000 : 1000
  return [start, start + span - 1]
}

const fail = (code: string, reason: string, series?: string[]): RefMatch => ({ ok: false, code, reason, ...(series ? { series } : {}) })
const list = (spec: Record<string, any>, field: string): string[] => {
  const v = spec[field]
  return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : []
}
const present = (spec: Record<string, any>, fields: readonly string[] | undefined): string[] => (fields ?? []).flatMap(f => list(spec, f))

/**
 * Reads one param value as what it asks of a column of this kind: a number or a range of numbers (`10`, `10..20`,
 * `..5`, `5..`), a date (`2026-03`, `2026-03..2026-05`) or a category (`EU`, or `Feb..Apr` in data order). A string
 * when the value cannot be read for this kind.
 */
function want(value: string, kind: XKind | 'number'): Want | string {
  const dots = value.indexOf('..')
  if (kind === 'category') return dots < 0 ? { text: value } : { from: value.slice(0, dots), to: value.slice(dots + 2) }
  const one = (v: string, end: 0 | 1): number | null => {
    if (v === '') return end === 0 ? -Infinity : Infinity
    if (kind === 'time') return datePeriod(v)?.[end] ?? null
    return DECIMAL.test(v) ? Number(v) : null
  }
  const what = kind === 'time' ? 'a date such as 2026, 2026-03 or 2026-03-01, or a range of them (2026-01..2026-03)' : 'a number or a range such as 10..20'
  const a = one(dots < 0 ? value : value.slice(0, dots), 0)
  const b = one(dots < 0 ? value : value.slice(dots + 2), 1)
  if (a === null || b === null || (dots < 0 && value === '')) return `"${clip(value, 40)}" is not ${what}.`
  if (a > b) return `"${clip(value, 40)}" starts after it ends.`
  return { lo: a, hi: b }
}

/** Does this cell satisfy any of the wanted values? `order` is the column's distinct texts in data order (category ranges). */
function hit(cell: unknown, wants: Want[], kind: XKind | 'number', order: () => string[]): boolean {
  if (cell === null || cell === undefined || cell === '') return false
  const text = xKey(cell)
  const n = kind === 'time' ? toTime(cell) : kind === 'category' ? null : toNumber(cell)
  for (const w of wants) {
    if ('text' in w) {
      if (text === w.text) return true
    } else if ('from' in w) {
      // A category that is itself written with two dots is matched as text first.
      if (text === `${w.from}..${w.to}`) return true
      const o = order()
      const a = o.indexOf(w.from)
      const b = o.indexOf(w.to)
      const i = o.indexOf(text)
      if (a >= 0 && b >= 0 && i >= Math.min(a, b) && i <= Math.max(a, b)) return true
    } else if (n !== null && n >= w.lo && n <= w.hi) return true
  }
  return false
}

/**
 * What a reference points at in a plot, worked out on the spec's data after `transform` (not on pixels), so a Go or
 * Python service gets the same answer and a renderer draws it from the scene (`Mark.rows`, `matchMarks`).
 *
 * `ref` is a `CardRef` or its `ref:` text (read with `parseCardRef`). Its `target` is not checked here: that is the
 * card's id, which the caller knows. The params, each a list of values (a repeated param: `x=a&x=b`, any of them):
 *
 * - `key`: annotation keys (`annotations[].key`) and row ids (the spec's `key` column, compared as text).
 * - `x`: the column(s) of the chart's `x` fields (the table in INTEGRATION.md; `RefShape.x`), any of them.
 * - `y`: a value or range on the chart's value column(s), per point (each column of a wide-form `y` is its own
 *   series); with `RefShape.yRow` (a heatmap's rows, a timeline's lanes) a match on the row instead.
 * - `series`: series names (legend keys: the series column, or the legend column of a chart without one, such as a
 *   pie's slices); in wide form the column names.
 *
 * Params are ANDed, the values of one param ORed; no params at all is the whole plot. A value is read by the kind
 * of the column, `detectXKind` over its cells (a `y` value column is always numeric):
 *
 * - numbers: a plain decimal `n` (that value: [n, n]), or a range `a..b`, inclusive, either end may be left out
 *   (`..5`, `5..`). Cells are read with `toNumber`.
 * - dates: an ISO 8601 prefix, `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS` (a
 *   trailing `Z` allowed), in UTC, is the whole period it names: `2026-03` is every instant of March 2026, as the
 *   closed interval [start, start of the next period - 1 ms]. A range `a..b` runs from the start of `a` to the end of
 *   `b`'s period, so `2026-01..2026-03` is the first quarter. Any other text `toTime` reads is that instant. Cells
 *   are read with `toTime`. (`:` must be written `%3A` inside a `ref:` link.)
 * - categories: equality with the cell as text (`String(value)`, null is ""). A value with `..` that is not itself a
 *   cell names a range in data order (`Feb..Apr`): every cell from the first appearance of one end to the other.
 * - spans (`RefShape.span`, a timeline): a row matches when its `[start, end]` overlaps the value's interval.
 *
 * Fails with a `code` and a `reason`: `ref_invalid` (not a reference), `ref_spec_invalid` (the spec does not
 * validate), `ref_param_unknown` (a name other than key, x, y, series), `ref_param_unsupported` (this chart, or
 * this spec, has nothing that name could read; names are checked in alphabetical order), `ref_bad_value` (a value
 * its column cannot read; the first in order), `ref_hidden_series` (everything it matches is in a series the viewer
 * hid; the failure lists them in `series`) and `ref_no_match`. Points in hidden series are left out of a match that
 * has others.
 */
export function resolveRef(spec: unknown, ref: CardRef | string, options: ResolveOptions = {}): RefMatch {
  const text = typeof ref === 'string' ? ref : formatCardRef(ref)
  if (text === null) return fail('ref_invalid', `Not a valid reference: a target of letters, digits, dot, underscore, colon or dash, and up to ${CARD_REF_LIMITS.names} params of up to ${CARD_REF_LIMITS.values} non-empty values each.`)
  const parsed = parseCardRef(text)
  if (!parsed.ok) return fail('ref_invalid', parsed.error)
  const params = parsed.ref.params
  const v = validatePlot(spec)
  if (!v.ok || !v.spec) return fail('ref_spec_invalid', 'The plot spec does not validate; validatePlot lists its issues.')
  const s = v.spec
  const def = getChart(s.type)!
  const shape: RefShape = def.ref ?? {}
  const rows = s.data as Row[]
  const names = Object.keys(params).sort()
  const xCols = present(s, shape.x)
  const span = shape.span && list(s, shape.span[0]).length && list(s, shape.span[1]).length ? [list(s, shape.span[0])[0], list(s, shape.span[1])[0]] as const : null
  const yField = (shape.y ?? []).find(f => list(s, f).length > 0)
  const yCols = yField ? list(s, yField) : []
  const extra = shape.yRow ? [] : present(s, shape.extra).filter(c => !yCols.includes(c))
  const seriesCol = shape.series ? list(s, shape.series)[0] : undefined
  const legendCol = seriesCol ?? (shape.legend ? list(s, shape.legend)[0] : undefined)
  const wide = !shape.yRow && yCols.length + extra.length > 1
  const can: Record<string, boolean> = { key: true, x: xCols.length > 0 || span !== null, y: yCols.length > 0, series: legendCol !== undefined || wide }

  for (const name of names) {
    if (!(REF_PARAMS as readonly string[]).includes(name)) return fail('ref_param_unknown', `"${clip(name, 32)}" is not something a plot reference names; use ${REF_PARAMS.join(', ')}.`)
    if (!can[name]) {
      const ok = REF_PARAMS.filter(n => can[n])
      return fail('ref_param_unsupported', `This ${def.type} chart has nothing "${name}" can name; it takes ${ok.join(', ')}.`)
    }
  }

  const kinds = new Map<string, XKind>()
  const kindOf = (col: string): XKind => {
    let k = kinds.get(col)
    if (!k) kinds.set(col, (k = detectXKind(undefined, rows.map(r => r[col]))))
    return k
  }
  const orders = new Map<string, string[]>()
  const orderOf = (col: string) => (): string[] => {
    let o = orders.get(col)
    if (!o) orders.set(col, (o = [...new Set(rows.map(r => r[col]).filter(c => c !== null && c !== undefined && c !== '').map(xKey))]))
    return o
  }
  /** The wanted values of a param on one column, or the reason the first of them cannot be read. */
  const wants = (name: string, kind: XKind | 'number'): Want[] | string => {
    const out: Want[] = []
    for (const value of params[name]) {
      const w = want(value, kind)
      if (typeof w === 'string') return `${name}: ${w}`
      out.push(w)
    }
    return out
  }
  /** A row filter on columns: a row matches when any column matches; a value no column can read is an error. */
  const rowFilter = (name: string, cols: string[], kindFor: (c: string) => XKind | 'number'): ((r: Row) => boolean) | string => {
    const per: [string, Want[], XKind | 'number'][] = []
    let why = ''
    for (const c of cols) {
      const k = kindFor(c)
      const w = wants(name, k)
      if (typeof w === 'string') why ||= w
      else per.push([c, w, k])
    }
    if (!per.length) return why
    return r => per.some(([c, w, k]) => hit(r[c], w, k, orderOf(c)))
  }

  const filters: ((r: Row) => boolean)[] = []
  const keySet = params.key ? new Set(params.key) : null
  if (keySet) {
    const col = typeof s.key === 'string' ? s.key : undefined
    filters.push(r => col !== undefined && keySet.has(xKey(r[col])) && r[col] !== null && r[col] !== undefined && r[col] !== '')
  }
  if (params.x) {
    if (span) {
      const k = kindOf(span[0]) === 'time' || kindOf(span[1]) === 'time' ? 'time' : 'number'
      const w = wants('x', k)
      if (typeof w === 'string') return fail('ref_bad_value', w)
      const at = (c: unknown): number | null => (k === 'time' ? toTime(c) : toNumber(c))
      filters.push(r => {
        const a = at(r[span[0]])
        const b = at(r[span[1]])
        if (a === null || b === null) return false
        return (w as { lo: number; hi: number }[]).some(q => Math.min(a, b) <= q.hi && Math.max(a, b) >= q.lo)
      })
    } else {
      const f = rowFilter('x', xCols, kindOf)
      if (typeof f === 'string') return fail('ref_bad_value', f)
      filters.push(f)
    }
  }
  let yPoint: Want[] | null = null
  if (params.y) {
    if (shape.yRow) {
      const f = rowFilter('y', yCols, kindOf)
      if (typeof f === 'string') return fail('ref_bad_value', f)
      filters.push(f)
    } else {
      const w = wants('y', 'number')
      if (typeof w === 'string') return fail('ref_bad_value', w)
      yPoint = w
    }
  }
  const seriesSet = params.series ? new Set(params.series) : null
  const hidden = new Set(options.hidden ?? [])

  // Every point of every row that passes the row filters, then the point filters (y on its own column, series).
  const points: { row: number; series?: string; s: string | undefined; col?: string }[] = []
  const valueCols = shape.yRow ? [] : [...yCols, ...extra]
  rows.forEach((r, i) => {
    for (const f of filters) if (!f(r)) return
    const legend = legendCol !== undefined ? xKey(r[legendCol]) : undefined
    if (!valueCols.length) {
      if (seriesSet && (legend === undefined || !seriesSet.has(legend))) return
      points.push({ row: i, s: legend })
      return
    }
    valueCols.forEach((col, j) => {
      // The series a value belongs to, as the charts name it: each column of a wide `y` and each extra column is
      // its own; a single `y` column takes the row's series (or legend) value, or the column's name without one.
      const s = j >= yCols.length || yCols.length > 1 || legend === undefined ? col : legend
      if (seriesSet && !seriesSet.has(s)) return
      if (yPoint && !hit(r[col], yPoint, 'number', () => [])) return
      points.push({ row: i, s, col, ...(wide ? { series: s } : {}) })
    })
  })

  const keys = keySet ? ((s.annotations ?? []) as { key?: string }[]).filter(a => typeof a.key === 'string' && keySet.has(a.key)).map(a => a.key!) : []
  // Only key names annotations: with x, y or series as well, the annotations do not count.
  if (names.some(n => n !== 'key')) keys.length = 0
  const shown = points.filter(p => p.s === undefined || !hidden.has(p.s))
  if (!shown.length && !keys.length) {
    const gone = [...new Set(points.map(p => p.s!).filter(x => x !== undefined))]
    if (points.length) return fail('ref_hidden_series', `What this names is in hidden series only: ${gone.map(g => `"${clip(g, 40)}"`).join(', ')}. Show the series to see it.`, gone)
    return fail('ref_no_match', names.length ? `Nothing in this plot matches ${names.map(n => `${n}=${params[n].map(x => clip(x, 40)).join(' or ')}`).join(' and ')}.` : 'This plot has no data to point at.')
  }
  const rowList = [...new Set(shown.map(p => p.row))].sort((a, b) => a - b)
  const series = [...new Set(shown.map(p => p.s).filter((x): x is string => x !== undefined))]
  return {
    ok: true,
    rows: rowList,
    points: shown.map(p => ({ row: p.row, ...(p.series !== undefined ? { series: p.series } : {}) })),
    series,
    keys,
    label: refLabel(s, rows, shown, keys, { xCols, span, lane: shape.yRow ? yCols[0] : undefined, seriesCol: wide ? undefined : seriesCol, keyCol: typeof s.key === 'string' ? s.key : undefined })
  }
}

/**
 * The short description of a match: one point as its columns and values ("month 2026-03-01, revenue 120": the x
 * column or the span, the lane of a `yRow` chart, the series column, the value column), more as
 * a count ("4 points in 2 series"); annotations by their label or key ('annotation "Launch"', "2 annotations");
 * both joined with "; ". Values as text (`String(value)`), each cut to 40 characters, the whole to 200.
 */
function refLabel(s: Record<string, any>, rows: Row[], pts: { row: number; s: string | undefined; col?: string }[], keys: string[], o: { xCols: string[]; span: readonly [string, string] | null; lane?: string; seriesCol?: string; keyCol?: string }): string {
  const parts: string[] = []
  const one = (col: string, v: unknown): string => `${clip(col, 40)} ${clip(xKey(v), 40)}`
  if (pts.length === 1) {
    const p = pts[0]
    const r = rows[p.row]
    const bits: string[] = []
    if (o.span) bits.push(one(o.span[0], r[o.span[0]]), one(o.span[1], r[o.span[1]]))
    else if (o.xCols.length) bits.push(one(o.xCols[0], r[o.xCols[0]]))
    if (o.lane !== undefined) bits.push(one(o.lane, r[o.lane]))
    if (o.seriesCol !== undefined) bits.push(one(o.seriesCol, r[o.seriesCol]))
    if (p.col !== undefined) bits.push(one(p.col, r[p.col]))
    if (!bits.length && o.keyCol !== undefined) bits.push(one(o.keyCol, r[o.keyCol]))
    parts.push(bits.length ? bits.join(', ') : `row ${p.row + 1}`)
  } else if (pts.length > 1) {
    const n = new Set(pts.map(p => p.s)).size
    parts.push(`${pts.length} points${n > 1 ? ` in ${n} series` : ''}`)
  }
  if (keys.length === 1) {
    const a = ((s.annotations ?? []) as { key?: string; label?: string }[]).find(x => x.key === keys[0])
    parts.push(`annotation "${clip(a?.label || keys[0], 40)}"`)
  } else if (keys.length > 1) parts.push(`${keys.length} annotations`)
  return clip(parts.join('; '), 200)
}

/** What a renderer shows for a match: data marks to outline, rings on line points, and the mark to focus. */
export interface MarkMatch {
  /** Indexes into `scene.marks` of the data and annotation marks to outline. */
  marks: number[]
  /** Points on lines and areas (from the hovered column's `focus` dots) to ring. */
  rings: { x: number; y: number }[]
  /** The mark whose tooltip to show when exactly one point matched, or -1. */
  tip: number
  /** The first matched mark the keyboard can reach, or -1. */
  focus: number
}

/**
 * The marks of a scene that draw a match (see {@link resolveRef}), from `Mark.rows` and `Mark.key`, so any renderer
 * (SVG, canvas, WebGL, a custom one) can show it the same way. A data mark is outlined when it draws a matched point:
 * one of its rows, and (in wide form) the point's series. A line or area that draws more rows than matched is not
 * outlined: its matched points are ringed instead, from the line chart's hover columns. Annotation marks are
 * outlined by key.
 */
export function matchMarks(scene: Scene, match: Extract<RefMatch, { ok: true }>): MarkMatch {
  const byRow = new Map<number, (string | undefined)[]>()
  for (const p of match.points) {
    const l = byRow.get(p.row)
    if (l) l.push(p.series)
    else byRow.set(p.row, [p.series])
  }
  const keys = new Set(match.keys)
  const fits = (m: Mark, row: number): boolean => {
    const ss = byRow.get(row)
    return !!ss && ss.some(x => x === undefined || m.series === undefined || x === m.series)
  }
  const ringed = new Set<number>()
  const found: { x: number; y: number; series?: string; rows: number[] }[] = []
  let tip = -1
  let focus = -1
  scene.marks.forEach((m, i) => {
    if (m.role !== 'hit' || !m.focus || !m.rows) return
    const hitRows = m.rows.filter(r => byRow.has(r))
    if (!hitRows.length) return
    for (const r of hitRows) ringed.add(r)
    const want = new Set(hitRows.flatMap(r => byRow.get(r)!))
    for (const f of m.focus) {
      // A point that says which rows it draws is ringed when one of them matched (for its series, in wide form).
      const rows = f.rows ? f.rows.filter(r => byRow.get(r)?.some(x => x === undefined || f.series === undefined || x === f.series)) : hitRows
      if (f.rows ? rows.length : want.has(undefined) || f.series === undefined || want.has(f.series)) found.push({ x: f.x, y: f.y, series: f.series, rows })
    }
    if (focus < 0) focus = i
    if (tip < 0 && match.points.length === 1 && m.tip) tip = i
  })
  const marks: number[] = []
  scene.marks.forEach((m, i) => {
    if (m.role === 'annotation') {
      if (m.key !== undefined && keys.has(m.key)) {
        marks.push(i)
        if (focus < 0 && m.tip) focus = i
      }
      return
    }
    if (m.role !== 'data' || !m.rows?.length) return
    const got = m.rows.filter(r => fits(m, r))
    if (!got.length) return
    if (got.length < m.rows.length && got.every(r => ringed.has(r))) return
    marks.push(i)
    if (focus < 0 && (m.tip || m.aria)) focus = i
    if (tip < 0 && match.points.length === 1 && m.tip) tip = i
  })
  // A point already outlined as a dot of its own is not ringed as well.
  const dots = new Set<string>()
  for (const i of marks) {
    const m = scene.marks[i]
    if (m.type === 'circle' && m.rows) for (const r of m.rows) dots.add(`${m.series}\u0000${r}`)
  }
  const rings = found.filter(f => !f.rows.length || !f.rows.every(r => dots.has(`${f.series}\u0000${r}`))).map(f => ({ x: f.x, y: f.y }))
  return { marks, rings, tip, focus }
}

/**
 * The reference a mark stands for (the reverse of {@link resolveRef}), for a host that wants the words in a chat to
 * follow the viewer's hover: the annotation's `key`; else the row ids when the spec has a `key` column; else the x
 * value(s) of its rows, with its series where one row draws several or the chart has a series column. Null when
 * the mark has no rows or names more than the reference limits allow. `spec` is the validated spec (with its
 * transformed `data`), as `compilePlot` returns it.
 */
export function markRef(spec: Record<string, any>, mark: Mark, target: string): CardRef | null {
  const out = (params: Record<string, string[]>): CardRef | null => {
    const ref = { target, params }
    return formatCardRef(ref) === null ? null : ref
  }
  if (mark.role === 'annotation') return mark.key !== undefined ? out({ key: [mark.key] }) : null
  if (!mark.rows?.length) return null
  const rows = (spec.data ?? []) as Row[]
  const def = getChart(spec.type)
  const shape: RefShape = def?.ref ?? {}
  const texts = (col: string): string[] => [...new Set(mark.rows!.map(i => rows[i]?.[col]).filter(c => c !== null && c !== undefined && c !== '').map(xKey))]
  if (typeof spec.key === 'string') {
    const ids = texts(spec.key)
    return ids.length && ids.length <= CARD_REF_LIMITS.values ? out({ key: ids }) : null
  }
  const params: Record<string, string[]> = {}
  const x = present(spec, shape.x)[0]
  if (x !== undefined) {
    const xs = texts(x)
    if (!xs.length || xs.length > CARD_REF_LIMITS.values) return null
    params.x = xs
  }
  const yField = (shape.y ?? []).find(f => list(spec, f).length > 0)
  // A heatmap's row, a timeline's lane: the y category is part of where the mark is.
  if (shape.yRow && yField) {
    const ys = texts(list(spec, yField)[0])
    if (!ys.length || ys.length > CARD_REF_LIMITS.values) return null
    params.y = ys
  }
  const wide = !shape.yRow && (yField ? list(spec, yField).length : 0) + present(spec, shape.extra).length > 1
  const seriesCol = shape.series ? list(spec, shape.series)[0] : undefined
  if (mark.series !== undefined && (wide || seriesCol !== undefined)) params.series = [mark.series]
  return Object.keys(params).length ? out(params) : null
}
