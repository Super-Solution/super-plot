// Writes conformance/plot.v1.json: language-neutral cases another implementation (Go, Python, Rust, ...) must reproduce.
//   node scripts/export-conformance.mjs           write
//   node scripts/export-conformance.mjs --check   fail when the file is out of date
// Reads the built core (run `npm run build` first).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href)
const { linearTicks, niceDomain, quantile, boxStats, binEdges, binCounts, validatePlot, describePlot, chartCatalog, getChart, chartTypes, COMMON_FIELDS, CARTESIAN_FIELDS, LIMITS } = core

const r = v => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)
const rows = o => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'number' ? r(v) : v)))

const ticks = [[0, 100, 5], [0, 1, 4], [3, 97, 6], [-5, 5, 5], [0.001, 0.009, 4], [1000, 250000, 5], [7, 7, 5]].map(([a, b, n]) => ({ in: [a, b, n], out: linearTicks(a, b, n) }))
const nice = [[0, 97, 5], [-3.2, 12.4, 5], [0.12, 0.87, 4], [5, 5, 5]].map(([a, b, n]) => ({ in: [a, b, n], out: niceDomain(a, b, n) }))
const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const quant = [0, 0.25, 0.5, 0.75, 0.9, 1].map(p => ({ in: { sorted, p }, out: quantile(sorted, p) }))
const boxIn = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 2, 3, 3, 3, 4, 4, 5, 40], [5], [2, 2, 2, 2]]
const box = boxIn.map(v => ({ in: v, out: boxStats(v) }))
const binIn = [{ values: [1, 2, 2, 3, 3, 3, 4, 4, 5, 9], bins: 4 }, { values: [0, 10, 20, 30, 40, 50], bins: 'auto' }, { values: [1.5, 2.5, 3.5, 9.5], bins: 3 }]
const bins = binIn.map(c => { const edges = binEdges(c.values, c.bins); return { in: c, out: { edges, counts: binCounts(c.values, edges) } } })

const withoutData = spec => { const { data, ...rest } = spec; return rest }

// Every chart's catalog example must validate cleanly and describe the same way in every language.
const examples = chartCatalog().map(c => {
  const v = validatePlot(c.example)
  const d = describePlot(c.example)
  return { type: c.type, spec: c.example, valid: v.ok, issueCodes: v.issues.map(i => i.code), normalized: v.spec ? withoutData(v.spec) : null, describe: d.ok ? d.text : null }
})

// Broken specs: the stable `code` and `path` are the contract; message text is not.
const broken = [
  { name: 'unknown type', spec: { type: 'donutt', data: [] } },
  { name: 'missing column', spec: { type: 'bar', data: [{ a: 'x', b: 1 }], x: 'a', y: 'c' } },
  { name: 'wrong field type', spec: { type: 'bar', data: 'rows', x: 'a', y: 'b' } },
  { name: 'unsafe colour', spec: { type: 'bar', data: [{ a: 'x', b: 1 }], x: 'a', y: 'b', colors: { b: 'url(javascript:1)' } } },
  { name: 'no data', spec: { type: 'pie', data: [], label: 'a', value: 'b' } },
  { name: 'not an object', spec: 42 }
].map(c => { const v = validatePlot(c.spec); return { name: c.name, spec: c.spec, ok: v.ok, issues: v.issues.map(i => ({ code: i.code, path: i.path, severity: i.severity })) } })


const rowsOf = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const B = [{ a: 'x', b: 1 }, { a: 'y', b: 2 }]

// Validation cases. The contract is the set of (severity, code, path); order and message text are not.
const VALIDATION = [
  ['json string, valid', JSON.stringify({ type: 'bar', x: 'a', y: 'b', data: B })],
  ['json string, broken', '{"type": "bar",'],
  ['array instead of object', [1, 2]],
  ['missing type', { data: B }],
  ['type is a number', { type: 5, data: B }],
  ['misspelt type', { type: 'bars', x: 'a', y: 'b', data: B }],
  ['missing data', { type: 'bar', x: 'a', y: 'b' }],
  ['row is not an object', { type: 'bar', x: 'a', y: 'b', data: [1, 2] }],
  ['missing required field', { type: 'bar', y: 'b', data: B }],
  ['unknown field with near match', { type: 'bar', x: 'a', y: 'b', data: B, stak: 'stack' }],
  ['unknown field, no match', { type: 'bar', x: 'a', y: 'b', data: B, qqqqqqqq: 1 }],
  ['x is not a string', { type: 'bar', x: 3, y: 'b', data: B }],
  ['y is an empty list', { type: 'bar', x: 'a', y: [], data: B }],
  ['y list has a number', { type: 'bar', x: 'a', y: ['b', 4], data: B }],
  ['y list with a missing column', { type: 'bar', x: 'a', y: ['b', 'zz'], data: B }],
  ['y column is not numeric', { type: 'bar', x: 'a', y: 'a', data: B }],
  ['y column is partly numeric', { type: 'bar', x: 'a', y: 'b', data: [{ a: 'x', b: 1 }, { a: 'y', b: 'n/a' }, { a: 'z', b: 3 }] }],
  ['bad enum', { type: 'bar', x: 'a', y: 'b', data: B, stack: 'stacked' }],
  ['enum is not a string', { type: 'bar', x: 'a', y: 'b', data: B, stack: 1 }],
  ['boolean wrong type', { type: 'bar', x: 'a', y: 'b', data: B, labels: 'yes' }],
  ['title wrong type', { type: 'bar', x: 'a', y: 'b', data: B, title: 7 }],
  ['title too long (warning)', { type: 'bar', x: 'a', y: 'b', data: B, title: 'T'.repeat(130) }],
  ['version ok', { type: 'bar', x: 'a', y: 'b', data: B, version: 1 }],
  ['version wrong', { type: 'bar', x: 'a', y: 'b', data: B, version: 2 }],
  ['bad format', { type: 'bar', x: 'a', y: 'b', data: B, format: 'money' }],
  ['good formats', { type: 'bar', x: 'a', y: 'b', data: B, format: 'currency:eur' }],
  ['domain ok with null', { type: 'bar', x: 'a', y: 'b', data: B, yDomain: [null, 10] }],
  ['domain reversed', { type: 'bar', x: 'a', y: 'b', data: B, yDomain: [10, 1] }],
  ['domain wrong shape', { type: 'bar', x: 'a', y: 'b', data: B, yDomain: [1, 2, 3] }],
  ['domain with a string', { type: 'bar', x: 'a', y: 'b', data: B, yDomain: [0, '5'] }],
  ['colors ok (trimmed)', { type: 'bar', x: 'a', y: 'b', data: B, colors: { b: ' #2962ff ', c: 'rgb(1, 2, 3)', d: 'var(--brand, #fff)', e: 'tomato' } }],
  ['colors is an array', { type: 'bar', x: 'a', y: 'b', data: B, colors: ['red'] }],
  ['colors with unsafe values', { type: 'bar', x: 'a', y: 'b', data: B, colors: { b: 'red; background:url(x)', c: 'url(#x)', d: 7, e: 'a'.repeat(70) } }],
  ['annotations ok', { type: 'bar', x: 'a', y: 'b', data: B, annotations: [{ axis: 'y', value: 1, label: 'Goal', tone: 'info' }, { axis: 'x', value: 'x', to: 'y' }] }],
  ['annotations not an array', { type: 'bar', x: 'a', y: 'b', data: B, annotations: {} }],
  ['annotation problems', { type: 'bar', x: 'a', y: 'b', data: B, annotations: [5, { axis: 'z', value: 1 }, { axis: 'y' }, { axis: 'y', value: 1, to: true }, { axis: 'y', value: 1, tone: 'loud' }, { axis: 'y', value: 1, label: 3 }, { axis: 'y', value: 1, colour: 'red' }] }],
  ['too many annotations', { type: 'bar', x: 'a', y: 'b', data: B, annotations: rowsOf(LIMITS.maxAnnotations + 1, i => ({ axis: 'y', value: i })) }],
  ['annotations on a chart without axes', { type: 'pie', label: 'a', value: 'b', data: B, annotations: [] }],
  ['bar: series ignored', { type: 'bar', x: 'a', y: ['b', 'c'], series: 'a', data: [{ a: 'x', b: 1, c: 2 }] }],
  ['bar: negative in stack', { type: 'bar', x: 'a', y: 'b', stack: 'stack', data: [{ a: 'x', b: -1 }, { a: 'y', b: 2 }] }],
  ['bar: many bars over time', { type: 'bar', x: 'd', y: 'v', data: rowsOf(61, i => ({ d: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, v: i })) }],
  ['line: ok with dates', { type: 'line', x: 'd', y: 'v', data: [{ d: '2026-01-01', v: 1 }, { d: '2026-01-02', v: 2 }] }],
  ['line: series ignored', { type: 'line', x: 'd', y: ['v', 'w'], series: 'd', data: [{ d: '1', v: 1, w: 2 }] }],
  ['area: stack enum', { type: 'area', x: 'd', y: 'v', stack: 'normalise', data: [{ d: '1', v: 1 }] }],
  ['scatter: no numeric pairs', { type: 'scatter', x: 'a', y: 'b', data: [{ a: 'n', b: 'm' }, { a: 'o', b: 1 }] }],
  ['scatter: ok', { type: 'scatter', x: 'a', y: 'b', trend: 'linear', data: [{ a: 1, b: 2 }, { a: 2, b: 4 }, { a: 3, b: 7 }] }],
  ['pie: ok', { type: 'pie', label: 'a', value: 'b', data: B }],
  ['pie: maxSlices out of range', { type: 'pie', label: 'a', value: 'b', maxSlices: 40, data: B }],
  ['pie: innerRadius out of range', { type: 'pie', label: 'a', value: 'b', innerRadius: 1.5, data: B }],
  ['donut: centerLabel too long', { type: 'donut', label: 'a', value: 'b', centerLabel: 'C'.repeat(30), data: B }],
  ['histogram: bins forms', { type: 'histogram', value: 'b', bins: 0, data: B }],
  ['histogram: bins non-integer', { type: 'histogram', value: 'b', bins: 2.5, data: B }],
  ['histogram: binWidth zero', { type: 'histogram', value: 'b', binWidth: 0, data: B }],
  ['histogram: ok', { type: 'histogram', value: 'b', bins: 12, mode: 'density', data: B }],
  ['box: ok without x', { type: 'box', y: 'b', data: B }],
  ['heatmap: missing value', { type: 'heatmap', x: 'a', y: 'a', data: B }],
  ['radar: too few spokes', { type: 'radar', x: 'a', y: 'b', data: B }],
  ['radar: too many spokes', { type: 'radar', x: 'a', y: 'b', data: rowsOf(17, i => ({ a: `s${i}`, b: i })) }],
  ['radar: dates as spokes', { type: 'radar', x: 'a', y: 'b', data: [{ a: '2026-01-01', b: 1 }, { a: '2026-02-01', b: 2 }, { a: '2026-03-01', b: 3 }] }],
  ['radar: rings out of range', { type: 'radar', x: 'a', y: 'b', rings: 9, data: rowsOf(3, i => ({ a: `s${i}`, b: i })) }],
  ['treemap: skipped values', { type: 'treemap', label: 'a', value: 'b', data: [{ a: 'x', b: 1 }, { a: 'y', b: 0 }, { a: 'z', b: -2 }] }],
  ['treemap: group is label', { type: 'treemap', label: 'a', value: 'b', group: 'a', data: B }],
  ['sankey: ok', { type: 'sankey', from: 'a', to: 'c', value: 'b', data: [{ a: 'x', c: 'y', b: 1 }, { a: 'y', c: 'z', b: 1 }] }],
  ['sankey: loop', { type: 'sankey', from: 'a', to: 'c', value: 'b', data: [{ a: 'x', c: 'y', b: 1 }, { a: 'y', c: 'z', b: 1 }, { a: 'z', c: 'x', b: 1 }] }],
  ['sankey: skipped flows', { type: 'sankey', from: 'a', to: 'c', value: 'b', data: [{ a: 'x', c: 'y', b: 1 }, { a: 'x', c: 'x', b: 1 }, { a: 'y', c: 'z', b: 0 }] }],
  ['sankey: too many nodes', { type: 'sankey', from: 'a', to: 'c', value: 'b', data: rowsOf(41, i => ({ a: `n${i}`, c: `n${i + 1}`, b: 1 })) }],
  ['sankey: too many flows', { type: 'sankey', from: 'a', to: 'c', value: 'b', data: rowsOf(301, i => ({ a: `s${i % 20}`, c: `t${Math.floor(i / 20)}`, b: 1 })) }]
].map(([name, spec]) => {
  const v = validatePlot(spec)
  return { name, spec, ok: v.ok, issues: v.issues.map(i => ({ severity: i.severity, code: i.code, path: i.path })), normalized: v.spec ? withoutData(v.spec) : null }
})

// Number formats, English. Values include ties, tiny numbers, negatives and magnitude roll-over.
const FORMAT_VALUES = [0, 1, -1, 0.5, 1.005, 2.675, 0.125, 0.285, 12.5, 99.995, 999, 999.5, 999.95, 1000, 1234, 1234.5, 9999.99, 12345.678, 99999, 999499, 999500, 999999, 1000000, 1234567, 15000000, 999999999, 2.5e9, 7.1e12, 3.3e14, 1.2e15, 123456789012345680000, 0.00001, -0.00001, 0.0004, 0.00049, 0.07, 0.0999, 0.1, 0.1234, 0.9999, 5e-7, -12.34, -1234.5, -999999, 48200, 21800, 5400000, 1324, 463]
const FORMATS = ['auto', 'compact', 'integer', 'percent', 'fixed:0', 'fixed:2', 'fixed:3', 'currency:USD', 'currency:EUR', 'currency:JPY', 'currency:TWD', 'currency:CHF', 'currency:KWD', 'currency:xyz']
const formats = []
for (const format of FORMATS) {
  for (const value of FORMAT_VALUES) formats.push({ in: { format, value }, out: core.valueFormatter(format, 'en')(value) })
}
for (const code of Intl.supportedValuesOf('currency')) for (const value of [0, 1.5, 1234.5, -7]) formats.push({ in: { format: `currency:${code}`, value }, out: core.valueFormatter(`currency:${code}`, 'en')(value) })
const percents = [0, 0.001, 0.0449, 0.045, 0.2, 0.255, 0.3333, 0.5, 0.999, 1, 1.5, -0.25].flatMap(ratio => [0, 1, 2].map(digits => ({ in: { ratio, digits }, out: core.formatPercent(ratio, 'en', digits) })))

// Descriptions beyond the catalog examples: formats, time axes, merging, groups, stacking, edge cases.
const D = (name, spec) => { const d = describePlot(spec); return { name, spec, describe: d.ok ? d.text : null, issueCodes: d.issues.map(i => i.code) } }
const dates = (n, f, start = Date.UTC(2026, 0, 5)) => rowsOf(n, i => ({ d: new Date(start + i * 86400000 * 7).toISOString().slice(0, 10), ...f(i) }))
const describeCases = [
  D('bar: currency, one series, sorted', { type: 'bar', x: 'k', y: 'v', format: 'currency:USD', sort: 'desc', title: 'Spend', data: [{ k: 'a', v: 1200 }, { k: 'b', v: 56.5 }, { k: 'c', v: 15000 }] }),
  D('bar: stacked long form', { type: 'bar', x: 'k', y: 'v', series: 's', stack: 'normalize', data: [{ k: 'a', s: 'p', v: 1 }, { k: 'a', s: 'q', v: 3 }, { k: 'b', s: 'p', v: 2 }, { k: 'b', s: 'q', v: 2 }] }),
  D('bar: one category', { type: 'bar', x: 'k', y: 'v', format: 'percent', data: [{ k: 'only', v: 0.256 }] }),
  D('bar: numeric category labels and nulls', { type: 'bar', x: 'k', y: 'v', data: [{ k: 2024, v: 1.5 }, { k: 2025, v: null }, { k: 2026, v: '3' }] }),
  D('bar: many series (list is cut)', { type: 'bar', x: 'k', y: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], data: [{ k: 'x', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }] }),
  D('line: weekly dates, two series', { type: 'line', x: 'd', y: ['a', 'b'], title: 'Users', format: 'compact', data: dates(10, i => ({ a: 1000 * (i + 1), b: 40000 - i * 1500 })) }),
  D('line: month strings and a flat series', { type: 'line', x: 'd', y: 'v', data: [{ d: '2026-01', v: 0 }, { d: '2026-02', v: 5 }, { d: '2026-03', v: 0 }] }),
  D('line: timestamps with a time of day', { type: 'line', x: 'd', y: 'v', xType: 'time', data: [{ d: '2026-03-01T09:30:00Z', v: 3 }, { d: '2026-03-01T18:45:00+02:00', v: 4 }, { d: '2026-03-02 08:00', v: 2 }] }),
  D('line: numeric x and series column', { type: 'line', x: 'x', y: 'v', series: 's', data: [{ x: 3, s: 'a', v: 2 }, { x: 1, s: 'a', v: 1 }, { x: 2, s: 'b', v: 10 }, { x: 4, s: 'b', v: 5 }] }),
  D('area: stacked, fixed decimals', { type: 'area', x: 'x', y: ['a', 'b'], stack: 'stack', xType: 'linear', format: 'fixed:1', data: [{ x: 1, a: 1, b: 2 }, { x: 2, a: 2, b: 3 }] }),
  D('area: normalised', { type: 'area', x: 'x', y: ['a', 'b'], stack: 'normalize', data: [{ x: 'u', a: 1, b: 2 }, { x: 'v', a: 2, b: 3 }] }),
  D('scatter: dates on x', { type: 'scatter', x: 'd', y: 'v', data: [{ d: '2026-01-01', v: 1 }, { d: '2026-02-01', v: 3 }, { d: '2026-03-01', v: 2 }, { d: '2026-04-01', v: 5 }] }),
  D('scatter: weak negative correlation, groups', { type: 'scatter', x: 'x', y: 'y', series: 'g', data: [{ x: 1, y: 5, g: 'a' }, { x: 2, y: 3, g: 'b' }, { x: 3, y: 6, g: 'a' }, { x: 4, y: 4, g: 'b' }, { x: 5, y: 3.5, g: 'c' }] }),
  D('scatter: constant y has no correlation', { type: 'scatter', x: 'x', y: 'y', data: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }] }),
  D('pie: merges past maxSlices', { type: 'pie', label: 'k', value: 'v', maxSlices: 3, format: 'compact', data: [{ k: 'a', v: 50 }, { k: 'b', v: 30 }, { k: 'c', v: 10 }, { k: 'd', v: 6 }, { k: 'e', v: 4 }] }),
  D('pie: duplicates are summed, negatives skipped', { type: 'pie', label: 'k', value: 'v', sort: 'none', data: [{ k: 'a', v: 1 }, { k: 'a', v: 2 }, { k: 'b', v: -4 }, { k: 'c', v: 3 }] }),
  D('pie: one slice', { type: 'pie', label: 'k', value: 'v', data: [{ k: 'solo', v: 7 }] }),
  D('donut: ascending', { type: 'donut', label: 'k', value: 'v', sort: 'asc', format: 'currency:EUR', data: [{ k: 'a', v: 5 }, { k: 'b', v: 1500 }, { k: 'c', v: 20.25 }] }),
  D('histogram: groups share bins', { type: 'histogram', value: 'v', series: 'g', bins: 5, data: [1, 2, 2, 3, 3, 3, 8].map((v, i) => ({ v, g: i % 2 ? 'odd' : 'even' })) }),
  D('histogram: one value', { type: 'histogram', value: 'v', data: [{ v: 4 }, { v: 4 }] }),
  D('histogram: bin width', { type: 'histogram', value: 'v', binWidth: 2.5, data: [0, 1, 4, 5, 9, 12].map(v => ({ v })) }),
  D('box: single box with outliers', { type: 'box', y: 'v', format: 'fixed:1', data: [1, 2, 2, 3, 3, 3, 4, 4, 5, 40, -30].map(v => ({ v })) }),
  D('box: seven groups (list is cut)', { type: 'box', x: 'g', y: 'v', data: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].flatMap((g, i) => [i, i + 1, i + 2].map(v => ({ g, v }))) }),
  D('heatmap: duplicate cells are summed', { type: 'heatmap', x: 'a', y: 'b', value: 'v', data: [{ a: 'x', b: 'p', v: 1 }, { a: 'x', b: 'p', v: 4 }, { a: 'y', b: 'p', v: 2 }, { a: 'y', b: 'q', v: 9 }] }),
  D('radar: long form', { type: 'radar', x: 'm', y: 'v', series: 's', data: [{ m: 'a', s: 'p', v: 1 }, { m: 'b', s: 'p', v: 5 }, { m: 'c', s: 'p', v: 3 }, { m: 'a', s: 'q', v: 4 }, { m: 'b', s: 'q', v: 2 }] }),
  D('radar: seven spokes', { type: 'radar', x: 'm', y: ['p', 'q', 'r', 's'], data: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((m, i) => ({ m, p: i, q: 7 - i, r: 3, s: i * 2 })) }),
  D('treemap: plain', { type: 'treemap', label: 'k', value: 'v', data: [{ k: 'a', v: 3 }, { k: 'b', v: 1 }, { k: 'a', v: 2 }, { k: 'c', v: 0 }] }),
  D('treemap: nothing positive', { type: 'treemap', label: 'k', value: 'v', data: [{ k: 'a', v: 0 }] }),
  D('sankey: two sources, merged flows', { type: 'sankey', from: 'a', to: 'b', value: 'v', format: 'integer', data: [{ a: 'x', b: 'm', v: 3.2 }, { a: 'y', b: 'm', v: 2 }, { a: 'x', b: 'm', v: 1 }, { a: 'm', b: 'z', v: 6.2 }] }),
  D('explicit description wins', { type: 'bar', x: 'a', y: 'b', description: 'Written by hand.', data: B }),
  D('unicode and long labels', { type: 'bar', x: 'k', y: 'v', title: '營收 by 地區 😀', data: [{ k: '台灣'.repeat(30), v: 3 }, { k: 'B 😀', v: 1 }] }),
  D('does not validate', { type: 'bar', x: 'nope', y: 'b', data: B })
]

// English currency symbols and default fraction digits, straight from Intl, so a port never guesses them.
const currencies = Object.fromEntries(Intl.supportedValuesOf('currency').map(code => {
  const nf = new Intl.NumberFormat('en', { style: 'currency', currency: code })
  const symbol = nf.formatToParts(1).find(p => p.type === 'currency').value
  return [code, { symbol, digits: nf.resolvedOptions().maximumFractionDigits }]
}))

const fields = {
  version: 1,
  limits: LIMITS,
  currencies,
  charts: chartTypes().map(type => {
    const def = getChart(type)
    const all = { type: { kind: 'string', required: true, desc: `Chart type: ${def.type}.` }, ...COMMON_FIELDS, ...(def.cartesian ? CARTESIAN_FIELDS : {}), ...def.fields }
    return { type, fields: Object.entries(all).map(([name, f]) => ({ name, ...f })) }
  })
}

const doc = rows({
  $comment: 'Generated by scripts/export-conformance.mjs. Do not edit; run `npm run conformance`. Numbers are compared to 1e-9.',
  version: 1,
  linearTicks: ticks,
  niceDomain: nice,
  quantile: quant,
  boxStats: box,
  histogramBins: bins,
  chartExamples: examples,
  brokenSpecs: broken,
  validationCases: VALIDATION,
  formats,
  percents,
  describeCases
})
const outputs = [
  ['conformance/plot.v1.json', JSON.stringify(doc, null, 2) + '\n'],
  // The field definitions are the single source for validation in every language: ports embed this file.
  ['conformance/fields.v1.json', JSON.stringify(fields, null, 2) + '\n'],
  ['ports/go/superplot/fields.v1.json', JSON.stringify(fields, null, 2) + '\n'],
  ['ports/python/src/super_plot/fields.v1.json', JSON.stringify(fields, null, 2) + '\n']
]
if (process.argv.includes('--check')) {
  const stale = outputs.filter(([f, text]) => !existsSync(join(root, f)) || readFileSync(join(root, f), 'utf8') !== text).map(([f]) => f)
  if (stale.length) { console.error(`out of date: ${stale.join(', ')}. Run \`npm run conformance\``); process.exit(1) }
  console.log('conformance up to date')
} else {
  for (const [f, text] of outputs) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), text)
    console.log(`wrote ${f} (${text.length} bytes)`)
  }
}
