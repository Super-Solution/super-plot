// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { Issue, Row } from './schema.js'
import { getChart } from './registry.js'
import { validatePlot } from './validate.js'
import { toNumber } from './util/num.js'
import { toTime } from './util/time.js'

/**
 * `suggestPlots`: which charts fit these columns, as ready specs with the reason for each. Deterministic rules over a
 * column profile, no model and no randomness: the same columns always give the same answer, so an agent can rely on
 * the codes, and a host can show the reason. Pure: no DOM, no network, no clock. The rules are public
 * (`SUGGEST_RULES`, documented in INTEGRATION.md) and versioned (`SUGGEST_VERSION`); a change to what a rule
 * proposes or how it scores bumps the version. Observable Plot's "auto mark" says its heuristics may change; these are
 * written down so they cannot change silently.
 */
export const SUGGEST_VERSION = 1

/** How many rows are read to profile the columns; the rest are ignored (`rows_sampled`). */
export const SUGGEST_SAMPLE = 1000

export type ColumnKind = 'number' | 'time' | 'category' | 'boolean' | 'text' | 'empty'

/** What the rules know about one column. Give these (e.g. from SQL) instead of rows when the rows are too many to send. */
export interface ColumnProfile {
  name: string
  kind: ColumnKind
  /** Different values. For a category, the number of categories. */
  distinct?: number
  /** Rows the profile is about. */
  rows?: number
  /** Rows with no value (null, undefined or ""). */
  missing?: number
  /** Numbers: the smallest and the largest value. */
  min?: number
  max?: number
  /** Numbers: every value is a whole number. */
  integer?: boolean
  /** Times: `day` when every value is a date without a time of day. */
  granularity?: 'day' | 'time'
  /** Category and text: the average length of a value, in characters. */
  avgLength?: number
}

export type SuggestIntent = 'trend' | 'compare' | 'ranking' | 'composition' | 'distribution' | 'relationship'

export interface SuggestInput {
  /** Rows (objects). The first {@link SUGGEST_SAMPLE} are profiled. */
  rows?: readonly Row[]
  /** A profile given instead of rows. Suggestions are then not checked against the data (`unvalidated`). */
  columns?: readonly ColumnProfile[]
  /** What the reader should see; the matching rules score 40 higher (at most 100). Without it the rules rank on the data alone. */
  intent?: SuggestIntent
  /** At most this many suggestions, 1 to 8. Default 5. */
  max?: number
  /** Put the rows in each suggested spec as `data`, so it validates and draws as it is. Default: no, add your own rows. */
  includeData?: boolean
}

export interface Suggestion {
  /** Stable rule code (see `SUGGEST_RULES`): what an agent can branch on. */
  code: string
  /** The chart type. */
  type: string
  /** 0 to 100: how well the columns fit, higher first. Only the order is meant to be read. */
  score: number
  /** Why this chart, in words, naming the columns. */
  why: string
  /** What to check before trusting it (rows that are summed, categories left out, values that are cut). */
  notes: string[]
  /** The spec without `data` (unless `includeData`): add the rows as `data` and it validates. */
  spec: Record<string, unknown>
}

export interface SuggestResult {
  ok: boolean
  /** The version of the rules that answered. */
  version: number
  /** What each column was taken to be. */
  columns: ColumnProfile[]
  suggestions: Suggestion[]
  /** `info`, `warning` and `error` issues with a code, a path and a hint, as `validatePlot` gives. */
  issues: Issue[]
}

export interface SuggestRule {
  code: string
  type: string
  /** The reader's question this rule answers (the {@link SuggestIntent} that scores it higher). */
  intent: SuggestIntent
  /** When it applies, in one sentence. */
  when: string
}

interface Facts {
  rows: number
  time: ColumnProfile[]
  nums: ColumnProfile[]
  cats: ColumnProfile[]
  all: ColumnProfile[]
}

interface Built { score: number; why: string; spec: Record<string, unknown>; notes?: string[] }
interface Rule extends SuggestRule { build(f: Facts): Built | null }

const list = (names: string[]): string => names.map(n => `"${n}"`).join(', ')
const distinctOf = (c: ColumnProfile): number => c.distinct ?? 0
/** A category on an axis or in a legend: not too many values to tell apart. */
const small = (c: ColumnProfile, max: number): boolean => distinctOf(c) >= 2 && distinctOf(c) <= max
const nonNegative = (c: ColumnProfile): boolean => c.min !== undefined && c.min >= 0
const longLabels = (c: ColumnProfile): boolean => (c.avgLength ?? 0) > 10

const RULES: Rule[] = [
  {
    code: 'trend_line', type: 'line', intent: 'trend', when: 'A time column and one or more number columns, no category to split by: one line per number column (up to 4).',
    build(f) {
      const t = f.time.find(c => distinctOf(c) >= 3)
      if (!t || !f.nums.length || f.cats.some(c => small(c, 8) && f.rows > distinctOf(t))) return null
      const ys = f.nums.slice(0, 4).map(c => c.name)
      const notes = f.rows > distinctOf(t) ? [`Several rows share a time in "${t.name}"; the line passes through each, so aggregate them first (transform: timeUnit, aggregate) if you want one value per time.`] : []
      return { score: 90, why: `"${t.name}" is a time and ${list(ys)} ${ys.length === 1 ? 'is a number' : 'are numbers'}: a line shows how ${ys.length === 1 ? 'it' : 'they'} change over time.`, spec: { type: 'line', x: t.name, y: ys.length === 1 ? ys[0] : ys }, notes }
    }
  },
  {
    code: 'trend_line_series', type: 'line', intent: 'trend', when: 'A time column, a number column and a category of 2 to 8 values with several rows per time: one line per category.',
    build(f) {
      const t = f.time.find(c => distinctOf(c) >= 3)
      const cat = f.cats.find(c => small(c, 8))
      const n = f.nums[0]
      if (!t || !cat || !n || f.rows <= distinctOf(t)) return null
      return { score: 88, why: `"${t.name}" is a time, "${n.name}" a number and "${cat.name}" splits the rows into ${distinctOf(cat)} groups: one line per group over time.`, spec: { type: 'line', x: t.name, y: n.name, series: cat.name } }
    }
  },
  {
    code: 'calendar_daily', type: 'calendar', intent: 'trend', when: 'A column of dates (day granularity) over at least 60 days and a number column: one cell per day.',
    build(f) {
      const t = f.time.find(c => c.granularity === 'day' && distinctOf(c) >= 60)
      const n = f.nums[0]
      if (!t || !n) return null
      return { score: 55, why: `"${t.name}" has ${distinctOf(t)} different days and "${n.name}" a number for each: a calendar shows weekly rhythm and streaks that a line hides.`, spec: { type: 'calendar', x: t.name, value: n.name }, notes: ['Days without a row stay empty, which is different from 0.'] }
    }
  },
  {
    code: 'compare_bar', type: 'bar', intent: 'compare', when: 'A category of 2 to 50 values and a number column: bars, biggest first.',
    build(f) {
      const c = f.cats.find(x => small(x, 50))
      const n = f.nums[0]
      if (!c || !n || f.time.length && f.cats.length === 1 && f.nums.length >= 1 && f.rows > distinctOf(c) * 3 && small(c, 8)) return null
      const many = distinctOf(c) > 12
      const horizontal = distinctOf(c) > 8 || longLabels(c)
      const notes: string[] = []
      const spec: Record<string, unknown> = { type: 'bar', x: c.name, y: n.name, sort: 'desc', ...(horizontal ? { orientation: 'horizontal' } : {}) }
      if (f.rows > distinctOf(c)) notes.push(`"${c.name}" repeats across rows, so the bars show the sum of "${n.name}" for each.`)
      else if (many) {
        spec.transform = [{ top: { n: 12, by: n.name } }]
        notes.push(`${distinctOf(c)} categories: only the 12 largest are drawn (transform top).`)
      }
      return { score: 85, why: `"${c.name}" names ${distinctOf(c)} categories and "${n.name}" is a number: bars compare sizes exactly${horizontal ? ' (horizontal, so the names stay readable)' : ''}.`, spec, notes }
    }
  },
  {
    code: 'compare_bar_grouped', type: 'bar', intent: 'compare', when: 'A category of 2 to 12 values and two to four number columns: grouped bars.',
    build(f) {
      const c = f.cats.find(x => small(x, 12))
      if (!c || f.nums.length < 2 || f.rows > distinctOf(c)) return null
      const ys = f.nums.slice(0, 4).map(n => n.name)
      return { score: 75, why: `"${c.name}" names ${distinctOf(c)} categories, each with ${list(ys)}: grouped bars put the numbers side by side.`, spec: { type: 'bar', x: c.name, y: ys, ...(longLabels(c) ? { orientation: 'horizontal' } : {}) }, notes: ['The columns share one value axis: they should be in the same unit.'] }
    }
  },
  {
    code: 'composition_pie', type: 'pie', intent: 'composition', when: 'A category of 2 to 6 values, each once, and a number column with no negatives: shares of a whole.',
    build(f) {
      const c = f.cats.find(x => small(x, 6))
      const n = f.nums.find(nonNegative)
      if (!c || !n || f.rows !== distinctOf(c)) return null
      return { score: 50, why: `"${c.name}" has ${distinctOf(c)} parts and "${n.name}" is never negative: a pie shows each part's share of the whole.`, spec: { type: 'pie', label: c.name, value: n.name }, notes: ['A bar chart compares the sizes more exactly; a pie fits when the point is the biggest share.'] }
    }
  },
  {
    code: 'composition_stacked_bar', type: 'bar', intent: 'composition', when: 'Two categories (2 to 12 and 2 to 8 values) and a number column with no negatives: stacked bars.',
    build(f) {
      const cs = f.cats.filter(x => small(x, 12))
      const n = f.nums.find(nonNegative)
      if (cs.length < 2 || !n) return null
      const series = cs.slice(1).find(x => small(x, 8))
      if (!series) return null
      const x = cs.find(c => c !== series)!
      return { score: 70, why: `"${x.name}" and "${series.name}" are categories and "${n.name}" is never negative: stacking splits each "${x.name}" by "${series.name}".`, spec: { type: 'bar', x: x.name, y: n.name, series: series.name, stack: 'stack' }, notes: ['Add stack: "normalize" to compare shares instead of sizes.'] }
    }
  },
  {
    code: 'composition_stacked_area', type: 'area', intent: 'composition', when: 'A time column, a category of 2 to 8 values and a number column with no negatives: stacked areas.',
    build(f) {
      const t = f.time.find(c => distinctOf(c) >= 3)
      const cat = f.cats.find(c => small(c, 8))
      const n = f.nums.find(nonNegative)
      if (!t || !cat || !n || f.rows <= distinctOf(t)) return null
      return { score: 60, why: `"${t.name}" is a time and "${n.name}" is never negative: stacked areas show how "${cat.name}" divides the total over time.`, spec: { type: 'area', x: t.name, y: n.name, series: cat.name, stack: 'stack' } }
    }
  },
  {
    code: 'matrix_heatmap', type: 'heatmap', intent: 'compare', when: 'Two categories (at most 30 values each) and a number column: a grid coloured by the number.',
    build(f) {
      const cs = f.cats.filter(c => small(c, 30))
      const n = f.nums[0]
      if (cs.length < 2 || !n) return null
      return { score: 65, why: `"${cs[0].name}" by "${cs[1].name}" is a grid of ${distinctOf(cs[0]) * distinctOf(cs[1])} cells, each with a number "${n.name}": colour shows where it is high.`, spec: { type: 'heatmap', x: cs[0].name, y: cs[1].name, value: n.name } }
    }
  },
  {
    code: 'relationship_scatter', type: 'scatter', intent: 'relationship', when: 'Two number columns (identifiers excluded) and at least 8 rows: a dot per row; a third number sets the size and a category of up to 8 values the colour.',
    build(f) {
      if (f.nums.length < 2 || f.rows < 8) return null
      const [a, b, size] = f.nums
      const cat = f.cats.find(c => small(c, 8))
      const spec: Record<string, unknown> = { type: 'scatter', x: a.name, y: b.name, ...(cat ? { series: cat.name } : {}), ...(size ? { size: size.name } : {}) }
      return { score: 80, why: `"${a.name}" and "${b.name}" are both numbers: a dot per row shows whether they move together${cat ? `, coloured by "${cat.name}"` : ''}${size ? `, sized by "${size.name}"` : ''}.`, spec, notes: ['Correlation is not cause: a scatter shows that two columns move together, not why.'] }
    }
  },
  {
    code: 'distribution_histogram', type: 'histogram', intent: 'distribution', when: 'A number column (identifiers excluded) with at least 8 rows: how its values spread.',
    build(f) {
      const n = f.nums[0]
      if (!n || f.rows < 8) return null
      const alone = !f.time.length && !f.cats.length
      return { score: alone ? 70 : 50, why: `"${n.name}" is a number with ${f.rows} rows: a histogram shows where the values pile up and how far they spread.`, spec: { type: 'histogram', value: n.name } }
    }
  },
  {
    code: 'distribution_box', type: 'box', intent: 'distribution', when: 'A number column and a category of 2 to 12 values with at least 5 rows each on average: one box per category.',
    build(f) {
      const c = f.cats.find(x => small(x, 12) && f.rows / distinctOf(x) >= 5)
      const n = f.nums[0]
      if (!c || !n) return null
      return { score: 65, why: `"${n.name}" has about ${Math.round(f.rows / distinctOf(c))} rows for each "${c.name}": a box per category compares their middle, spread and outliers.`, spec: { type: 'box', x: c.name, y: n.name, ...(longLabels(c) ? { orientation: 'horizontal' } : {}) } }
    }
  }
]

/** The rules, in the order they are tried (ties in score keep this order): what each proposes and when. */
export const SUGGEST_RULES: readonly SuggestRule[] = RULES.map(({ code, type, intent, when }) => ({ code, type, intent, when }))

/** What a rule that answers the reader's question gains: enough that the question, not the data's shape alone, decides the first suggestion. */
const INTENT_BONUS = 40
const MAX_COLUMNS = 200
const MISSING = (v: unknown): boolean => v === null || v === undefined || v === ''

/** Profile the columns of rows: what each is taken to be, and the counts the rules read. */
export function profileColumns(rows: readonly Row[]): ColumnProfile[] {
  const sample = rows.slice(0, SUGGEST_SAMPLE)
  const names: string[] = []
  const seen = new Set<string>()
  for (const r of sample) {
    if (!r || typeof r !== 'object') continue
    for (const k of Object.keys(r)) {
      if (seen.has(k) || names.length >= MAX_COLUMNS) continue
      seen.add(k)
      names.push(k)
    }
  }
  return names.map(name => {
    const values = sample.map(r => (r as Row)?.[name])
    const present = values.filter(v => !MISSING(v))
    const base = { name, rows: sample.length, missing: sample.length - present.length }
    if (!present.length) return { ...base, kind: 'empty' as const, distinct: 0 }
    const distinct = new Set(present.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v)))).size
    if (present.every(v => typeof v === 'boolean')) return { ...base, kind: 'boolean' as const, distinct }
    const nums = present.map(toNumber)
    if (nums.every(n => n !== null)) {
      const ns = nums as number[]
      return { ...base, kind: 'number' as const, distinct, min: Math.min(...ns), max: Math.max(...ns), integer: ns.every(Number.isInteger) }
    }
    if (present.every(v => typeof v === 'string' && toNumber(v) === null && toTime(v) !== null)) {
      const day = present.every(v => /^\s*\d{4}-\d{2}-\d{2}\s*$/.test(v as string))
      return { ...base, kind: 'time' as const, distinct, granularity: day ? ('day' as const) : ('time' as const) }
    }
    const avgLength = Math.round(present.reduce<number>((q, v) => q + String(v).length, 0) / present.length)
    // Names, ids and free text: so many different values that none can be told apart on an axis or in a legend.
    return { ...base, kind: distinct > 50 && distinct > present.length / 2 ? ('text' as const) : ('category' as const), distinct, avgLength }
  })
}

/** An integer column with a different value on every row is an identifier, not a measure. */
const identifier = (c: ColumnProfile): boolean => c.kind === 'number' && c.integer === true && (c.rows ?? 0) >= 10 && c.distinct === (c.rows ?? 0) - (c.missing ?? 0) && /(^|[_\s-])id$|^id($|[_\s-])/i.test(c.name)

/**
 * Chart recommendations for a table. Give `rows` (the first {@link SUGGEST_SAMPLE} are read) or a `columns` profile;
 * get back what each column was taken to be and up to `max` specs, best first, each with a stable `code`, a score, the
 * reason in words and what to check. With rows, every spec is checked with `validatePlot` against a sample of them, so
 * a suggestion that would not draw is dropped (`suggestion_invalid`) rather than handed over. Order: score, then the
 * order of {@link SUGGEST_RULES}.
 */
export function suggestPlots(input: SuggestInput): SuggestResult {
  const issues: Issue[] = []
  const done = (columns: ColumnProfile[], suggestions: Suggestion[], ok = true): SuggestResult => ({ ok, version: SUGGEST_VERSION, columns, suggestions, issues })
  const bad = (code: string, path: string, message: string, hint: string): SuggestResult => {
    issues.push({ severity: 'error', code, path, message, hint })
    return done([], [], false)
  }
  if (!input || typeof input !== 'object') return bad('bad_type', '', 'The input must be an object with `rows` or `columns`.', 'E.g. { rows: [{ month: "2026-01", sales: 12 }] }.')
  const max = input.max === undefined ? 5 : input.max
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 8) return bad('bad_value', 'max', `max must be an integer from 1 to 8, got ${JSON.stringify(input.max)}.`, 'Omit it for 5.')
  if (input.intent !== undefined && !['trend', 'compare', 'ranking', 'composition', 'distribution', 'relationship'].includes(input.intent)) {
    return bad('bad_enum', 'intent', `intent must be one of trend, compare, ranking, composition, distribution, relationship; got ${JSON.stringify(input.intent)}.`, 'Omit it to rank on the data alone.')
  }
  let rows: Row[] | undefined
  let columns: ColumnProfile[]
  if (input.rows !== undefined) {
    if (!Array.isArray(input.rows) || !input.rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) return bad('bad_type', 'rows', 'rows must be an array of row objects.', 'Example: [{"region":"APAC","revenue":120}, ...]')
    if (!input.rows.length) return bad('empty_data', 'rows', 'rows is empty: there is nothing to chart.', 'Send at least one row, or a `columns` profile.')
    rows = input.rows as Row[]
    if (rows.length > SUGGEST_SAMPLE) issues.push({ severity: 'info', code: 'rows_sampled', path: 'rows', message: `Only the first ${SUGGEST_SAMPLE} of ${rows.length} rows were profiled.`, hint: 'Profile the whole table elsewhere and send `columns` if the first rows are not typical.' })
    columns = profileColumns(rows)
  } else if (Array.isArray(input.columns) && input.columns.length) {
    const kinds = ['number', 'time', 'category', 'boolean', 'text', 'empty']
    for (const [i, c] of input.columns.entries()) {
      if (!c || typeof c.name !== 'string' || !c.name || !kinds.includes(c.kind)) return bad('bad_type', `columns[${i}]`, `columns[${i}] needs a name and a kind (${kinds.join(', ')}).`, 'E.g. { name: "month", kind: "time", distinct: 12 }.')
    }
    columns = input.columns.map(c => ({ ...c }))
    issues.push({ severity: 'info', code: 'unvalidated', path: 'columns', message: 'Suggestions were made from the profile you gave and not checked against any rows.', hint: 'Add your rows as `data` and run plot_validate before drawing.' })
  } else return bad('missing_required', 'rows', 'Give `rows` (the data) or `columns` (a profile of it).', 'E.g. { rows: [{ month: "2026-01", sales: 12 }] }.')

  const usable = columns.filter(c => c.kind !== 'empty')
  for (const c of columns) {
    if (c.kind === 'empty') issues.push({ severity: 'info', code: 'column_empty', path: `columns.${c.name}`, message: `Column "${c.name}" has no values and is not used.`, hint: 'Drop it from the rows, or fill it.' })
    else if (identifier(c)) issues.push({ severity: 'info', code: 'id_column_skipped', path: `columns.${c.name}`, message: `Column "${c.name}" looks like an identifier (a whole number, different on every row) and is not used as a measure.`, hint: 'Rename it if it is a real measure.' })
    else if (c.kind === 'text') issues.push({ severity: 'info', code: 'text_column_skipped', path: `columns.${c.name}`, message: `Column "${c.name}" has ${c.distinct} different values: too many to tell apart on an axis or in a legend, so it is not used.`, hint: 'Aggregate or group it first (transform), or use a word cloud or the data table.' })
  }
  const nrows = Math.max(0, ...usable.map(c => c.rows ?? 0))
  const facts: Facts = {
    rows: nrows,
    time: usable.filter(c => c.kind === 'time'),
    nums: usable.filter(c => c.kind === 'number' && !identifier(c)),
    cats: usable.filter(c => c.kind === 'category' || c.kind === 'boolean'),
    all: usable
  }
  // Without a row count (a hand-written profile), the rules that compare rows to categories read the largest distinct count.
  if (!facts.rows) facts.rows = Math.max(0, ...usable.map(c => c.distinct ?? 0))

  const wanted = input.intent === 'ranking' ? 'compare' : input.intent
  const found: (Suggestion & { order: number })[] = []
  RULES.forEach((rule, order) => {
    const built = rule.build(facts)
    if (!built) return
    if (!getChart(rule.type)) {
      issues.push({ severity: 'info', code: 'chart_not_registered', path: rule.code, message: `Rule ${rule.code} proposes a ${rule.type} chart, which is not registered here, so it was skipped.`, hint: 'Register it (registerCharts), or import the package root.' })
      return
    }
    let score = built.score + (wanted !== undefined && rule.intent === wanted ? INTENT_BONUS : 0)
    // A ranking is a bar chart in order: the plain bar rule leads it.
    if (input.intent === 'ranking' && rule.code === 'compare_bar') score += 5
    if (rows) {
      const v = validatePlot({ ...built.spec, data: rows.slice(0, 200) })
      if (!v.ok) {
        const first = v.issues.find(i => i.severity === 'error')!
        issues.push({ severity: 'warning', code: 'suggestion_invalid', path: rule.code, message: `Rule ${rule.code} built a spec that does not validate (${first.code} at ${first.path || 'spec'}), so it was dropped.`, hint: first.hint ?? 'Check the column types.' })
        return
      }
    }
    found.push({ code: rule.code, type: rule.type, score: Math.min(100, score), why: built.why, notes: built.notes ?? [], spec: input.includeData && rows ? { ...built.spec, data: rows } : built.spec, order })
  })
  found.sort((a, b) => b.score - a.score || a.order - b.order)
  const suggestions = found.slice(0, max).map(({ order: _order, ...s }) => s)
  if (!suggestions.length) issues.push({ severity: 'warning', code: 'no_chart', path: '', message: 'No rule fits these columns: there is no time, category pair or two numbers to chart.', hint: 'Send a table with a time or category column and a number column, or show it as a data table.' })
  else if (found.length > suggestions.length) issues.push({ severity: 'info', code: 'more_available', path: 'max', message: `${found.length - suggestions.length} more suggestion(s) were left out.`, hint: 'Raise max (up to 8) to see them.' })
  return done(columns, suggestions)
}
