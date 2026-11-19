// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { closest, toNumber } from './util/num.js'
import { isSafeColor } from './util/color.js'
import { isValueFormat } from './util/format.js'
import { CAMERA_LIMITS } from './geo/view.js'
import { toTime } from './util/time.js'

export type Row = Record<string, unknown>

/**
 * One description of every field a chart accepts. It drives, from a single source:
 *   validation (with actionable errors), JSON Schema, the reference docs, and the agent catalog.
 */
export type FieldDef = { desc: string; required?: boolean } & (
  | { kind: 'column'; role: 'any' | 'number' | 'x' | 'lat' | 'lng' }
  /** `min` / `max`: how many columns the list may name (default 1 to any). */
  | { kind: 'columns'; role: 'number' | 'any'; min?: number; max?: number }
  | { kind: 'enum'; values: readonly string[]; default?: string }
  | { kind: 'number'; min?: number; max?: number; integer?: boolean; default?: number }
  | { kind: 'boolean'; default?: boolean }
  | { kind: 'string'; max?: number }
  | { kind: 'domain' }
  | { kind: 'colors' }
  | { kind: 'annotations' }
  | { kind: 'format' }
  | { kind: 'bins'; default?: 'auto' | number }
  | { kind: 'data' }
  | { kind: 'version' }
  | { kind: 'geo' }
  | { kind: 'camera' }
  | { kind: 'transform' }
  | { kind: 'flag' }
  /** A list of data values (strings or numbers, compared as strings), e.g. a path of group names. `max`: longest list. */
  | { kind: 'values'; max?: number }
)

export type FieldMap = Record<string, FieldDef>

/**
 * How a `geo` field is checked. The map charts install it when they load, so a bundle without maps does not
 * carry the geography code.
 */
let geoResolver: ((value: unknown, issues: Issue[], path: string) => unknown) | null = null
export function setGeoResolver(fn: (value: unknown, issues: Issue[], path: string) => unknown): void {
  geoResolver = fn
}

export interface Issue {
  /**
   * `error`: the spec is refused. `warning`: drawn, but something was changed or left out. `info`: drawn as asked;
   * a note the agent or author should read (e.g. `dual_axis`, `axis_break`: the risk a choice carries).
   */
  severity: 'error' | 'warning' | 'info'
  /** Stable machine-readable code. */
  code: string
  /** JSON path into the spec, e.g. `y` or `annotations[1].axis`. */
  path: string
  message: string
  /** What to do about it. */
  hint?: string
}

export const LIMITS = { maxRows: 50_000, maxString: 200, maxSeries: 8, maxAnnotations: 50, maxCategories: 500 }

/** Fields shared by every chart. */
export const COMMON_FIELDS: FieldMap = {
  version: { kind: 'version', desc: 'Spec format version. Only 1 exists; may be omitted.' },
  data: { kind: 'data', required: true, desc: 'Tabular rows: an array of flat objects, one per observation. Numbers must be numbers (or plain numeric strings).' },
  title: { kind: 'string', max: 120, desc: 'Chart title. State the takeaway or the subject, not "Chart".' },
  subtitle: { kind: 'string', max: 200, desc: 'One line of context under the title: unit, period, filter.' },
  description: { kind: 'string', max: 1000, desc: 'Long description for screen readers and agents. Generated from the data when omitted.' },
  source: { kind: 'string', max: 160, desc: 'Source line shown small under the chart.' },
  legend: { kind: 'enum', values: ['auto', 'top', 'bottom', 'right', 'none'], default: 'auto', desc: 'Legend placement. `auto` hides it for a single series and picks a side from the available width.' },
  tooltip: { kind: 'boolean', default: true, desc: 'Show a hover tooltip (web binding only).' },
  format: { kind: 'format', desc: 'Value format: auto, compact, integer, percent (ratios, 0.25 shows as 25%), fixed:N, currency:CODE.' },
  colors: { kind: 'colors', desc: 'Series (or slice/category) name to CSS colour, e.g. {"Revenue":"#2962FF"}. Hex, rgb(), hsl(), a colour name or var(--x). Unlisted series keep palette colours.' },
  transform: { kind: 'transform', desc: 'Data steps run before the chart reads its columns, in order (at most 10): filter, timeUnit, aggregate, sort, top, bin (round bins: start and end columns), window (running sum, mean, count, rank, pctChange, lag, lead, movingMean, per group, in a sort order), fold (wide columns to key/value rows) and index (rescale each group so its value at a base point is 100). No expressions. E.g. [{"timeUnit":{"field":"date","unit":"month","as":"month"}},{"aggregate":{"groupBy":["month"],"fields":{"revenue":"mean"}}}]. Column fields then refer to the output.' },
  patterns: { kind: 'boolean', desc: 'Default false. Add a texture per series to filled marks (bars, areas, slices, cells) so series stay apart without colour: colour-blind readers, greyscale print.' }
}

/** Extra fields for charts on a pair of axes. */
export const CARTESIAN_FIELDS: FieldMap = {
  xLabel: { kind: 'string', max: 80, desc: 'Title of the horizontal axis.' },
  yLabel: { kind: 'string', max: 80, desc: 'Title of the vertical axis (include the unit).' },
  annotations: { kind: 'annotations', desc: 'Reference marks: {axis:"y", value:100, label:"Target"} draws a line; add `to` for a band. {x:"2026-03-01", y:120, label:"Launch"} marks one point with a short leader and its label (x and y in the units of the horizontal and vertical axis: a category, a number or an ISO date).' },
  facet: { kind: 'column', role: 'any', desc: 'Split into small multiples: one panel per value of this column (at most 12), sharing axes, colours and one legend.' },
  zoom: { kind: 'enum', values: ['none', 'x', 'xy'], desc: 'Default none. Let the viewer zoom and pan a continuous axis (web binding): Ctrl/⌘-scroll or pinch to zoom, drag to pan, double-click or 0 to reset. Scatter, line and area.' },
  brush: { kind: 'enum', values: ['none', 'x', 'xy'], desc: 'Default none. Let the viewer drag out a range to select (web binding). The selection comes back as a filter step, ready for `transform`. With `zoom` too, Shift-drag pans.' }
}

const ANNOTATION_KEYS = ['axis', 'value', 'to', 'label', 'tone']
const POINT_ANNOTATION_KEYS = ['x', 'y', 'label', 'tone']
export const CAMERA_KEYS = ['lng', 'lat', 'zoom', 'pitch', 'bearing'] as const
const CAMERA_RANGE: Record<(typeof CAMERA_KEYS)[number], readonly [number, number]> = { lng: [-180, 180], lat: [-90, 90], zoom: CAMERA_LIMITS.zoom, pitch: CAMERA_LIMITS.pitch, bearing: CAMERA_LIMITS.bearing }
const TONES = ['neutral', 'positive', 'negative', 'warning', 'info']

export interface ValidateCtx {
  issues: Issue[]
  columns: Set<string>
  rows: Row[]
}

const add = (ctx: ValidateCtx, severity: Issue['severity'], code: string, path: string, message: string, hint?: string): void => {
  ctx.issues.push({ severity, code, path, message, ...(hint ? { hint } : {}) })
}

const fmt = (v: unknown): string => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

/** Validate one field; returns the normalised value (or undefined to drop it). */
export function validateField(name: string, def: FieldDef, value: unknown, ctx: ValidateCtx): unknown {
  const bad = (code: string, message: string, hint?: string): undefined => {
    add(ctx, 'error', code, name, message, hint)
    return undefined
  }
  switch (def.kind) {
    case 'version':
      return value === 1 ? 1 : bad('bad_value', `version must be 1, got ${fmt(value)}.`)
    case 'data':
    case 'transform':
      // Checked (and applied) by validatePlot before the column fields.
      return value
    case 'string': {
      if (typeof value !== 'string') return bad('bad_type', `${name} must be a string, got ${fmt(value)}.`)
      const max = def.max ?? LIMITS.maxString
      if (value.length > max) {
        add(ctx, 'warning', 'string_truncated', name, `${name} is ${value.length} characters; it will be cut to ${max}.`)
        return value.slice(0, max)
      }
      return value
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : bad('bad_type', `${name} must be true or false, got ${fmt(value)}.`)
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad('bad_type', `${name} must be a number, got ${fmt(value)}.`)
      if (def.integer && !Number.isInteger(value)) return bad('bad_value', `${name} must be an integer, got ${value}.`)
      if (def.min !== undefined && value < def.min) return bad('out_of_range', `${name} must be at least ${def.min}, got ${value}.`)
      if (def.max !== undefined && value > def.max) return bad('out_of_range', `${name} must be at most ${def.max}, got ${value}.`)
      return value
    }
    case 'enum': {
      if (typeof value === 'string' && def.values.includes(value)) return value
      const near = typeof value === 'string' ? closest(value, def.values) : undefined
      return bad('bad_enum', `${name} must be one of ${def.values.join(', ')}; got ${fmt(value)}.`, near ? `Did you mean "${near}"?` : undefined)
    }
    case 'format':
      return isValueFormat(value) ? value : bad('bad_format', `format ${fmt(value)} is not recognised.`, 'Use auto, compact, integer, percent, fixed:N (N is 0-20) or currency:USD.')
    case 'bins': {
      if (value === 'auto') return value
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 200) return value
      return bad('bad_value', `bins must be "auto" or an integer from 1 to 200, got ${fmt(value)}.`)
    }
    case 'domain': {
      // Dates may be given as ISO strings; they are normalised to epoch milliseconds.
      const norm = Array.isArray(value) ? value.map(v => (typeof v === 'string' ? toTime(v) ?? v : v)) : value
      if (!Array.isArray(norm) || norm.length !== 2 || !norm.every(v => v === null || (typeof v === 'number' && Number.isFinite(v)))) {
        return bad('bad_value', `${name} must be [min, max] with numbers, ISO dates or null for "automatic", got ${fmt(value)}.`)
      }
      if (norm[0] !== null && norm[1] !== null && (norm[0] as number) >= (norm[1] as number)) return bad('bad_value', `${name} min must be below max.`)
      return norm
    }
    case 'colors': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('bad_type', `colors must be an object of name to colour.`)
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (isSafeColor(v)) out[k] = (v as string).trim()
        else add(ctx, 'error', 'bad_color', `colors.${k}`, `colors.${k} is not a plain CSS colour: ${fmt(v)}.`, 'Use #RRGGBB, rgb(), hsl(), a colour name or var(--token). url() and other syntax are refused.')
      }
      return out
    }
    case 'annotations': {
      if (!Array.isArray(value)) return bad('bad_type', 'annotations must be an array.')
      if (value.length > LIMITS.maxAnnotations) return bad('too_many', `At most ${LIMITS.maxAnnotations} annotations.`)
      const out: unknown[] = []
      value.forEach((a, i) => {
        const p = `annotations[${i}]`
        if (!a || typeof a !== 'object' || Array.isArray(a)) return add(ctx, 'error', 'bad_type', p, `${p} must be an object.`)
        const o = a as Record<string, unknown>
        // Two forms: a reference line or band ({axis, value, to?}) and a labelled point ({x, y, label}).
        const point = !('axis' in o) && ('x' in o || 'y' in o)
        const keys = point ? POINT_ANNOTATION_KEYS : ANNOTATION_KEYS
        for (const k of Object.keys(o)) {
          if (!keys.includes(k)) add(ctx, 'error', 'unknown_field', `${p}.${k}`, `Unknown ${point ? 'point annotation' : 'annotation'} field "${k}".`, `Allowed: ${keys.join(', ')}.${!point && (k === 'x' || k === 'y') ? ' A point annotation has x, y and label, and no axis.' : ''}`)
        }
        const tone = (): boolean => {
          if (o.tone !== undefined && !TONES.includes(o.tone as string)) { add(ctx, 'error', 'bad_enum', `${p}.tone`, `${p}.tone must be one of ${TONES.join(', ')}.`); return false }
          return true
        }
        const label = (): boolean => {
          if (o.label !== undefined && typeof o.label !== 'string') { add(ctx, 'error', 'bad_type', `${p}.label`, `${p}.label must be a string.`); return false }
          return true
        }
        if (point) {
          for (const k of ['x', 'y'] as const) {
            if (o[k] === undefined) return add(ctx, 'error', 'missing_required', `${p}.${k}`, `${p} is a point annotation and needs "${k}".`, 'Give both x and y in the units of their axis: a category name, a number or an ISO date.')
            if (!(typeof o[k] === 'string' || (typeof o[k] === 'number' && Number.isFinite(o[k])))) return add(ctx, 'error', 'bad_type', `${p}.${k}`, `${p}.${k} must be a number, an ISO date or a category name, got ${fmt(o[k])}.`)
          }
          if (!tone() || !label()) return
          if (typeof o.label !== 'string' || !o.label.trim()) return add(ctx, 'error', 'missing_required', `${p}.label`, `${p} is a point annotation and needs a short "label".`, 'E.g. {"x":"2026-03-01","y":120,"label":"Launch"}.')
          out.push({ ...o, label: o.label.slice(0, 80) })
          return
        }
        if (o.axis !== 'x' && o.axis !== 'y') return add(ctx, 'error', 'bad_enum', `${p}.axis`, `${p}.axis must be "x" or "y".`, 'For a labelled point, leave out axis and give x, y and label.')
        if (!(typeof o.value === 'string' || typeof o.value === 'number')) return add(ctx, 'error', 'bad_type', `${p}.value`, `${p}.value must be a number or a string.`)
        if (o.to !== undefined && !(typeof o.to === 'string' || typeof o.to === 'number')) return add(ctx, 'error', 'bad_type', `${p}.to`, `${p}.to must be a number or a string.`)
        if (!tone() || !label()) return
        out.push({ ...o, ...(typeof o.label === 'string' ? { label: o.label.slice(0, 80) } : {}) })
      })
      return out
    }
    case 'geo': {
      if (typeof value !== 'string' && (!value || typeof value !== 'object' || Array.isArray(value))) return bad('bad_type', 'geo must be the name of a registered geography or an inline GeoJSON/TopoJSON object.', 'Register boundaries with registerGeography(name, data) and set geo to that name.')
      if (!geoResolver) return bad('unsupported', 'No map chart type is registered.', 'Import the map charts from @supersolutions/super-plot-core/charts and registerChart them.')
      return geoResolver(value, ctx.issues, name) ? value : undefined
    }
    case 'camera': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('bad_type', 'camera must be an object such as {"lng":121,"lat":24,"zoom":2}.')
      const out: Record<string, number> = {}
      let ok = true
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        // Own keys only: `constructor` or `toString` must not pass as camera fields.
        const range = Object.hasOwn(CAMERA_RANGE, k) ? CAMERA_RANGE[k as (typeof CAMERA_KEYS)[number]] : undefined
        if (!range) {
          const near = closest(k, CAMERA_KEYS)
          add(ctx, 'error', 'unknown_field', `${name}.${k}`, `Unknown camera field "${k}".`, near ? `Did you mean "${near}"?` : `Allowed: ${CAMERA_KEYS.join(', ')}.`)
          ok = false
        } else if (typeof v !== 'number' || !Number.isFinite(v)) {
          add(ctx, 'error', 'bad_type', `${name}.${k}`, `camera.${k} must be a number, got ${fmt(v)}.`)
          ok = false
        } else if (v < range[0] || v > range[1]) {
          add(ctx, 'error', 'out_of_range', `${name}.${k}`, `camera.${k} must be within ${range[0]}..${range[1]}, got ${v}.`)
          ok = false
        } else out[k] = v
      }
      return ok ? out : undefined
    }
    case 'flag': {
      if (typeof value === 'string') {
        if (ctx.columns.has(value)) return value
        const near = closest(value, [...ctx.columns])
        return bad('no_such_column', `Column "${value}" does not exist in data.`, `${near ? `Did you mean "${near}"? ` : ''}Give a column of yes/no values, or a list of the marked values, e.g. ["Total"].`)
      }
      if (!Array.isArray(value) || value.length === 0) return bad('bad_type', `${name} must be a column name or a non-empty list of values, got ${fmt(value)}.`)
      if (value.length > LIMITS.maxCategories) return bad('too_many', `${name} lists ${value.length} values; at most ${LIMITS.maxCategories}.`)
      const bad2 = value.findIndex(v => !(typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))))
      if (bad2 >= 0) {
        add(ctx, 'error', 'bad_type', `${name}[${bad2}]`, `${name}[${bad2}] must be a string or a number, got ${fmt(value[bad2])}.`)
        return undefined
      }
      return value.map(v => String(v))
    }
    case 'values': {
      if (!Array.isArray(value)) return bad('bad_type', `${name} must be a list of values, e.g. ["Asia","Japan"], got ${fmt(value)}.`)
      const max = def.max ?? LIMITS.maxCategories
      if (value.length > max) return bad('too_many', `${name} lists ${value.length} values; at most ${max}.`)
      const at = value.findIndex(v => !(typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))))
      if (at >= 0) {
        add(ctx, 'error', 'bad_type', `${name}[${at}]`, `${name}[${at}] must be a string or a number, got ${fmt(value[at])}.`)
        return undefined
      }
      return value.map(v => String(v))
    }
    case 'column':
    case 'columns': {
      const names = def.kind === 'columns' ? (Array.isArray(value) ? value : [value]) : [value]
      if (def.kind === 'column' && typeof value !== 'string') return bad('bad_type', `${name} must be the name of a data column (a string), got ${fmt(value)}.`)
      if (def.kind === 'columns' && !names.every(v => typeof v === 'string') || names.length === 0) return bad('bad_type', `${name} must be a column name or a non-empty array of column names.`)
      const list = names as string[]
      if (def.kind === 'columns' && def.min !== undefined && list.length < def.min) return bad('too_few_columns', `${name} needs at least ${def.min} columns, got ${list.length}.`, `List ${def.min} or more column names, e.g. ["a","b"].`)
      if (def.kind === 'columns' && def.max !== undefined && list.length > def.max) return bad('too_many_columns', `${name} takes at most ${def.max} columns, got ${list.length}.`, 'Keep the most important ones, or split the chart.')
      let ok = true
      list.forEach((c, i) => {
        const path = Array.isArray(value) ? `${name}[${i}]` : name
        if (!ctx.columns.has(c)) {
          ok = false
          const near = closest(c, [...ctx.columns])
          add(ctx, 'error', 'no_such_column', path, `Column "${c}" does not exist in data.`, `${near ? `Did you mean "${near}"? ` : ''}Available columns: ${[...ctx.columns].slice(0, 20).join(', ')}.`)
        } else if (def.role === 'number' || def.role === 'lat' || def.role === 'lng') {
          let nonNum = 0
          let seen = 0
          let outside = 0
          const lim = def.role === 'lat' ? 90 : def.role === 'lng' ? 180 : Infinity
          for (const r of ctx.rows) {
            const v = r[c]
            if (v === null || v === undefined || v === '') continue
            seen++
            const num = toNumber(v)
            if (num === null) nonNum++
            else if (Math.abs(num) > lim) outside++
          }
          if (seen > 0 && nonNum === seen) {
            ok = false
            add(ctx, 'error', 'not_numeric', path, `Column "${c}" has no numeric values.`, 'Convert the values to numbers, or pick another column.')
          } else {
            if (nonNum > 0) add(ctx, 'warning', 'some_not_numeric', path, `${nonNum} of ${seen} values in "${c}" are not numeric and will be skipped.`)
            if (outside > 0) {
              const what = def.role === 'lat' ? 'latitudes (-90..90)' : 'longitudes (-180..180)'
              if (outside === seen - nonNum) {
                ok = false
                add(ctx, 'error', 'out_of_range', path, `No value in "${c}" is a valid ${what.replace('s (', ' (')}.`, 'Use degrees in WGS 84. Projected coordinates (metres) are not supported.')
              } else add(ctx, 'warning', 'some_out_of_range', path, `${outside} of ${seen} values in "${c}" are not valid ${what} and will be skipped.`)
            }
          }
        }
      })
      if (!ok) return undefined
      return def.kind === 'columns' ? (list.length === 1 && !Array.isArray(value) ? list[0] : list) : list[0]
    }
  }
}

/** Does this value, as the JSON Schema for one field. */
export function fieldSchema(def: FieldDef): Record<string, unknown> {
  const d = def.desc
  switch (def.kind) {
    case 'version': return { const: 1, description: d }
    case 'data': return { type: 'array', minItems: 1, maxItems: LIMITS.maxRows, items: { type: 'object' }, description: d }
    case 'string': return { type: 'string', maxLength: def.max ?? LIMITS.maxString, description: d }
    case 'boolean': return { type: 'boolean', ...(def.default !== undefined ? { default: def.default } : {}), description: d }
    case 'number': return { type: def.integer ? 'integer' : 'number', ...(def.min !== undefined ? { minimum: def.min } : {}), ...(def.max !== undefined ? { maximum: def.max } : {}), ...(def.default !== undefined ? { default: def.default } : {}), description: d }
    case 'enum': return { enum: [...def.values], ...(def.default !== undefined ? { default: def.default } : {}), description: d }
    case 'format': return { type: 'string', pattern: '^(auto|compact|integer|percent|fixed:\\d{1,2}|currency:[A-Za-z]{3})$', description: d }
    case 'bins': return { oneOf: [{ const: 'auto' }, { type: 'integer', minimum: 1, maximum: 200 }], default: def.default ?? 'auto', description: d }
    case 'domain': return { type: 'array', minItems: 2, maxItems: 2, items: { type: ['number', 'string', 'null'] }, description: d }
    case 'transform': return { type: 'array', maxItems: 10, items: { type: 'object', minProperties: 1, maxProperties: 1, properties: { filter: { type: 'object', required: ['field'] }, timeUnit: { type: 'object', required: ['field', 'unit'] }, aggregate: { type: 'object' }, sort: { type: 'object', required: ['field'] }, top: { type: 'object', required: ['n', 'by'] }, bin: { type: 'object', required: ['field'] }, window: { type: 'object', required: ['op', 'field', 'as'] }, fold: { type: 'object', required: ['fields'] }, index: { type: 'object', required: ['field'] } }, additionalProperties: false }, description: d }
    case 'colors': return { type: 'object', additionalProperties: { type: 'string', maxLength: 64 }, description: d }
    case 'annotations':
      return {
        type: 'array', maxItems: LIMITS.maxAnnotations, description: d,
        items: {
          oneOf: [
            {
              type: 'object', additionalProperties: false, required: ['axis', 'value'],
              properties: { axis: { enum: ['x', 'y'] }, value: { type: ['number', 'string'] }, to: { type: ['number', 'string'] }, label: { type: 'string', maxLength: 80 }, tone: { enum: TONES } }
            },
            {
              type: 'object', additionalProperties: false, required: ['x', 'y', 'label'],
              properties: { x: { type: ['number', 'string'] }, y: { type: ['number', 'string'] }, label: { type: 'string', minLength: 1, maxLength: 80 }, tone: { enum: TONES } }
            }
          ]
        }
      }
    case 'geo': return { oneOf: [{ type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' }, { type: 'object', required: ['type'], properties: { type: { enum: ['FeatureCollection', 'Topology'] } } }], description: d }
    case 'camera': return { type: 'object', additionalProperties: false, properties: Object.fromEntries(CAMERA_KEYS.map(k => [k, { type: 'number', minimum: CAMERA_RANGE[k][0], maximum: CAMERA_RANGE[k][1] }])), description: d }
    case 'flag': return { oneOf: [{ type: 'string' }, { type: 'array', minItems: 1, maxItems: LIMITS.maxCategories, items: { type: ['string', 'number'] } }], description: `${d} (column name, or a list of values)` }
    case 'values': return { type: 'array', maxItems: def.max ?? LIMITS.maxCategories, items: { type: ['string', 'number'] }, description: d }
    case 'column': return { type: 'string', description: `${d} (name of a column in data)` }
    case 'columns': {
      const arr = { type: 'array', minItems: def.min ?? 1, ...(def.max !== undefined ? { maxItems: def.max } : {}), items: { type: 'string' } }
      return (def.min ?? 1) <= 1 ? { oneOf: [{ type: 'string' }, arr], description: `${d} (column name, or several for wide-form data)` } : { ...arr, description: `${d} (list of column names)` }
    }
  }
}

/** Human description of a field's type, for the generated reference. */
export function fieldType(def: FieldDef): string {
  switch (def.kind) {
    case 'enum': return def.values.map(v => `\`${v}\``).join(' \\| ')
    case 'column': return 'column name'
    case 'columns': return (def.min ?? 1) <= 1 ? 'column name or list of column names' : `list of ${def.min}${def.max !== undefined ? ` to ${def.max}` : ' or more'} column names`
    case 'flag': return 'column name or list of values'
    case 'values': return 'list of values'
    case 'number': return def.integer ? 'integer' : 'number'
    case 'bins': return '`auto` \\| integer'
    case 'domain': return '[min\\|null, max\\|null]'
    case 'transform': return 'array of steps'
    case 'colors': return 'object'
    case 'annotations': return 'array'
    case 'format': return 'format string'
    case 'data': return 'array of rows'
    case 'version': return '`1`'
    case 'geo': return 'geography name or GeoJSON/TopoJSON object'
    case 'camera': return '{lng, lat, zoom, pitch, bearing}'
    default: return def.kind
  }
}

const YES = new Set(['true', 'yes', '1', 'total', 'subtotal'])

/** A yes/no cell of a `flag` column: true, 1, or "true", "yes", "1", "total", "subtotal" (any case, trimmed). Anything else is no. */
export const isYes = (v: unknown): boolean => v === true || v === 1 || (typeof v === 'string' && YES.has(v.trim().toLowerCase()))

/**
 * Is this row marked by a `flag` field? A column name reads the row's yes/no cell; a list matches the row's
 * value in `keyColumn` (as a string).
 */
export function flagged(flag: unknown, row: Row, keyColumn: string | undefined): boolean {
  if (typeof flag === 'string') return isYes(row[flag])
  if (Array.isArray(flag) && keyColumn !== undefined) {
    const v = row[keyColumn]
    return v !== null && v !== undefined && flag.includes(String(v))
  }
  return false
}

export function fieldDefault(def: FieldDef): unknown {
  return 'default' in def ? def.default : undefined
}
