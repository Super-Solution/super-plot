// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { closest } from './util/num.js'
import type { Issue } from './schema.js'

/**
 * Every piece of English that core itself writes into a scene: legend entries it makes up ("Other", the waterfall's
 * "Increase"), tooltip row labels, short value phrases, centre labels and the accessible names of marks. The web
 * binding's own text (toolbar, keyboard hints, live-region sentences, table caption, navigator) is in the same table,
 * after core's, so one `strings` object covers both. Text that comes from the spec (titles, column names, category
 * values) is not here: it is already the author's language.
 *
 * Override any of them with the `strings` render option, a flat object of key to text. `{name}` placeholders are
 * filled in; a placeholder an override leaves out is simply not shown. Descriptions (`scene.description`,
 * `describePlot`) are not covered: they are full English sentences that the ports reproduce word for word; set the
 * spec's `description` to give one in another language.
 */
export const DEFAULT_STRINGS = {
  /** Legend entry and slice/tile name for the merged remainder (pie, donut, treemap, sunburst). */
  other: 'Other',
  /** Centre label of a pie or sunburst, the total row of stacked bars and stream graphs, a waterfall total. */
  total: 'Total',
  /** Legend swatch for days or regions without a value (calendar). */
  noData: 'No data',
  /** After a 0 drawn for a missing value (`gaps: "zero"`). */
  missing: '{value} (missing)',
  /** Accessible name of a legend entry. */
  legendToggle: '{label}: toggle series',

  /** Waterfall legend and tooltips. */
  increase: 'Increase',
  decrease: 'Decrease',
  runningTotal: 'Running total',
  sumOfStepsBefore: 'Sum of the steps before',
  totalAria: '{name}: total {value}',
  increaseAria: '{name}: increase of {value}, running total {total}',
  decreaseAria: '{name}: decrease of {value}, running total {total}',

  /** Pie, treemap and histogram tooltips; the histogram's default y title. */
  share: 'Share',
  count: 'Count',
  density: 'Density',
  shareOfValues: 'Share of values (%)',
  /** A histogram bin. */
  binRange: '{from} to {to}',
  binAria: '{from} to {to}: {count} values',

  /** Box and violin tooltips. */
  max: 'Max',
  q3: 'Q3',
  median: 'Median',
  q1: 'Q1',
  min: 'Min',
  mean: 'Mean',
  n: 'n',
  bandwidth: 'Bandwidth',
  outlier: '{name} outlier',
  boxAria: '{name}: median {median}, Q1 {q1}, Q3 {q3}',
  violinAria: '{name}: {n} values, median {median}, Q1 {q1}, Q3 {q3}, range {min} to {max}',

  /** Bullet tooltips and accessible names. */
  ofTarget: 'Of target',
  upTo: 'up to {value}',
  above: 'above {range}',
  inRange: 'In range',
  inRangeAria: 'in range {range}',
  aboveEveryRange: 'above every range',
  noValue: 'no {name}',

  /** Gauge tooltips, centre notes and accessible names. */
  fromTo: '{from} to {to}',
  range: 'Range',
  ofRange: 'Share of range',
  band: 'Band',
  aboveEveryBand: 'above every band',
  inBandAria: 'in band {band}',
  aboveMax: 'above the maximum ({max})',
  belowMin: 'below the minimum ({min})',
  gaugeAria: '{value}, {share} of {range}',

  /** Word cloud tooltips and accessible names. */
  rankOf: '{rank} of {n}',
  wordAria: '{word}: {value}, rank {rank} of {n}',

  /** Funnel tooltips and accessible names. */
  ofFirstStage: 'Of the first stage',
  ofStageBefore: 'Of the stage before',
  ofFirstStageAria: '{share} of the first stage',
  ofStageBeforeAria: '{share} of the stage before',

  /** Sunburst tooltips. */
  shareOfParent: 'Share of parent',
  shareOfTotal: 'Share of total',
  shareOfParentAria: '{share} of {parent}',
  shareOfTotalAria: '{share} of the total',

  /** Sankey tooltips and accessible names. */
  shareOfSource: 'Share of {name}',
  flowIn: 'In',
  flowOut: 'Out',
  linkAria: '{source} to {target}: {value}',
  nodeAria: '{name}: in {in}, out {out}',

  /** Calendar tooltip. */
  weekday: 'Weekday',

  /** Scatter density bins (dense data). */
  points: 'Points',
  pointCount: '{n} points',
  pointCountOne: '{n} point',
  binNearAria: '{n} points near {x} {xValue}, {y} {yValue}',

  /** Parallel coordinates: a line without a group name. */
  rowName: 'Row {n}',

  /** Bump chart. */
  rank: 'Rank',
  rankAria: 'rank {rank}',
  sinceStepBefore: 'Since the step before',
  noChange: 'no change',
  rankUp: 'up {n}',
  rankDown: 'down {n}',
  /** Two value axes (`yRight`): the legend entry and tooltip label of a series on the right axis. */
  rightAxis: '{label} (right axis)',
  /** A broken axis (`yBreak`): a value inside the cut-out span, drawn at its edge (tooltip value and spoken label). */
  inBreak: '{value} (inside the axis break, drawn at its edge)',
  /** Tooltip label of a value whose column has no single name. */
  value: 'Value',

  /** Maps. */
  note: 'Note',
  disputed: 'Marked disputed in the source data',
  latLng: 'Lat, lng',

  /** Timeline tooltips and accessible names. */
  start: 'Start',
  end: 'End',
  duration: 'Duration',
  timelineAria: '{task}: {start} to {end} ({duration})',
  /** Duration units, after a number: "3 d 4 h". */
  unitDay: 'd',
  unitHour: 'h',
  unitMinute: 'min',
  unitSecond: 's',

  /** Drill-down breadcrumb (treemap, sunburst): the whole tree, and the accessible name of an item that goes up. */
  breadcrumbRoot: 'All',
  breadcrumbUp: 'Go up to {name}',

  // ---- The web binding's own text (toolbar, keyboard help, live region, navigator). Core never writes these. ----
  /** Toolbar: the group's name, then each button's visible text and accessible name. */
  toolbar: 'Chart tools',
  toolPng: 'PNG',
  toolPngName: 'Download PNG',
  toolSvg: 'SVG',
  toolSvgName: 'Download SVG',
  toolCsv: 'CSV',
  toolCsvName: 'Download CSV',
  toolTable: 'Table',
  toolTableName: 'Data table',
  toolReset: 'Reset',
  toolResetName: 'Reset zoom',
  toolSound: 'Sound',
  toolSoundName: 'Play as sound',
  /** Appended to a canvas chart's accessible name. */
  canvasKeys: 'Use the arrow keys to move between marks.',
  /** Interactive maps: the role description, the keyboard help (after the title) and the zoom buttons. */
  mapRole: 'interactive map',
  mapKeys: '{title}. Drag or use the arrow keys to move, Shift with them to turn and tilt, + and - to zoom, 0 to reset.',
  mapZoomIn: 'Zoom in',
  mapZoomOut: 'Zoom out',
  mapReset: 'Reset view',
  /** Caption of a data table that shows only the first rows. */
  tableFirstRows: '{caption}: first {n} of {total} rows',
  /** Sonification, read out in the live region. */
  soundPlaying: 'Playing {what}: {n} notes, left to right, higher pitch for higher values.',
  soundPlayingOne: 'Playing {what}: one note.',
  soundFinished: 'Finished playing {title}.',
  soundStopped: 'Stopped playing.',
  /** Live data (`appendRows` with `announce`): the count, then the mark at the newest x. */
  newPoints: '{n} new points',
  newPoint: '{n} new point',
  newRows: '{n} new rows',
  newRow: '{n} new row',
  newsLatest: '{count}; latest {mark}.',
  newsCount: '{count}.',
  /** Drill-down, read out in the live region. */
  drillShowing: 'Showing {path}.',
  drillShowingAll: 'Showing everything.',
  /** Navigator (range slider): the strip, the window, its two handles and a range. */
  navOverview: 'Overview of {field}: drag the window or its edges, or use the arrow keys on them, to choose the visible range',
  navWindow: 'Visible range of {field}',
  navStart: 'Start of the visible range of {field}',
  navEnd: 'End of the visible range of {field}',
  navRange: '{from} to {to}'
} as const

export type UiStringKey = keyof typeof DEFAULT_STRINGS
export type UiStrings = Record<UiStringKey, string>

/** At most this many characters per override. */
export const MAX_STRING_LENGTH = 120

/**
 * The defaults with the host's overrides on top. Unknown keys, non-strings and over-long values are left out with
 * a warning (`unknown_string`, `bad_string`, `string_truncated`), so a typo cannot blank a label.
 */
export function resolveStrings(input: unknown, issues: Issue[]): UiStrings {
  const out: UiStrings = { ...DEFAULT_STRINGS }
  if (input === undefined || input === null) return out
  if (typeof input !== 'object' || Array.isArray(input)) {
    issues.push({ severity: 'warning', code: 'bad_strings', path: 'strings', message: 'The strings option must be an object of key to text; it was ignored.', hint: 'E.g. { other: "Andere", total: "Summe" }. See DEFAULT_STRINGS for the keys.' })
    return out
  }
  const keys = Object.keys(DEFAULT_STRINGS)
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!Object.hasOwn(DEFAULT_STRINGS, k)) {
      const near = closest(k, keys)
      issues.push({ severity: 'warning', code: 'unknown_string', path: `strings.${k}`, message: `Unknown UI string "${k}"; it was ignored.`, hint: near ? `Did you mean "${near}"?` : 'See DEFAULT_STRINGS for the keys.' })
      continue
    }
    if (typeof v !== 'string') {
      issues.push({ severity: 'warning', code: 'bad_string', path: `strings.${k}`, message: `strings.${k} must be text; the English default is used.` })
      continue
    }
    if (v.length > MAX_STRING_LENGTH) issues.push({ severity: 'warning', code: 'string_truncated', path: `strings.${k}`, message: `strings.${k} is ${v.length} characters; it was cut to ${MAX_STRING_LENGTH}.` })
    out[k as UiStringKey] = v.slice(0, MAX_STRING_LENGTH)
  }
  return out
}

/** Fill `{name}` placeholders. Values are inserted as text; a missing one becomes empty. */
export function fillString(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : ''))
}
