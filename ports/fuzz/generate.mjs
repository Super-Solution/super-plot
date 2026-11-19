// Differential fuzzing of the ports against the reference implementation.
//   node ports/fuzz/generate.mjs <seed> <out.json>
// Writes random numbers (formatting, ticks, bins, box statistics, timeUnit buckets) and random specs of every chart
// type (transform pipelines and every field included, sound and broken) together
// with what the TypeScript implementation says about them. `check.py` and `cmd/fuzzcheck` compare a port to it.
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../..', import.meta.url).pathname
const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href)
const seed = Number(process.argv[2] ?? 7)
const target = process.argv[3]
let s = seed
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
s = seed
const vals = []
for (let i = 0; i < 6000; i++) {
  const mag = Math.floor(rnd() * 22) - 7
  let v = (rnd() - 0.4) * 10 ** mag
  const r = rnd()
  if (r < 0.3) v = Math.round(v * 100) / 100
  else if (r < 0.4) v = Math.round(v * 1000) / 1000 + 0.0005
  else if (r < 0.5) v = Math.round(v)
  else if (r < 0.55) v = Math.round(v * 2) / 2
  if (Object.is(v, -0)) v = 0
  vals.push(v)
}
const formats = ['auto', 'compact', 'integer', 'percent', 'fixed:1', 'fixed:4', 'currency:USD', 'currency:EUR', 'currency:JPY']
const out = []
for (const f of formats) { const fn = core.valueFormatter(f, 'en'); for (const v of vals) out.push([f, v, fn(v)]) }
const ticks = []
for (let i = 0; i < 3000; i++) { const a = (rnd() - 0.3) * 10 ** (Math.floor(rnd() * 8) - 3); const b = a + rnd() * 10 ** (Math.floor(rnd() * 8) - 3); const n = 2 + Math.floor(rnd() * 9); ticks.push([a, b, n, core.linearTicks(a, b, n), core.niceDomain(a, b, n)]) }
const bins = []
for (let i = 0; i < 800; i++) { const n = 2 + Math.floor(rnd() * 150); const sc = 10 ** (Math.floor(rnd() * 6) - 2); const vs = Array.from({ length: n }, () => Math.round(rnd() * rnd() * sc * 100) / 100); const b = rnd() < 0.5 ? 'auto' : 1 + Math.floor(rnd() * 40); bins.push([vs, b, core.binEdges(vs, b), core.binCounts(vs, core.binEdges(vs, b)), core.boxStats(vs)]) }
const { MIN_TIME, MAX_TIME } = core
// timeUnit buckets: ordinary times, the years 1 to 100, and both ends of what a step buckets (MIN_TIME to MAX_TIME).
const buckets = []
const SPAN = MAX_TIME - MIN_TIME
for (let i = 0; i < 6000; i++) {
  const r = rnd()
  const t = r < 0.35 ? (rnd() - 0.5) * 8e12 : r < 0.6 ? Math.round(MIN_TIME + rnd() * SPAN) : r < 0.75 ? MIN_TIME + rnd() * 3.2e12 : r < 0.85 ? MAX_TIME - Math.round(rnd() * 3e10) : r < 0.92 ? MIN_TIME + Math.round(rnd() * 3e10)
    : [0, -1, 1, -0.5, 0.5, 86399999, -86400000, MIN_TIME, MAX_TIME, MIN_TIME + 0.5, MAX_TIME - 0.5, -62135596800000 + 6 * 864e5, -59011459200000, -59011459200001][Math.floor(rnd() * 14)]
  const unit = core.TIME_UNITS[Math.floor(rnd() * core.TIME_UNITS.length)]
  buckets.push([t, unit, core.bucket(t, unit)])
}
const numeric = { out, ticks, bins, buckets }

s = seed + 1
const pick = a => a[Math.floor(rnd() * a.length)]
const chance = p => rnd() < p
const words = ['alpha', 'Beta', 'gamma', 'δelta', '台灣', 'Other', 'a b', '', 'x'.repeat(45), '😀 smile', 'Q1', 'Q2', '～wave', '10', 'true']
const dates = ['2026-01-05', '2026-02-10', '2026-03-31', '2026-03-01T10:30:00Z', '2025-12-01', '2026-02-30', '2024-02-29', '2026-07', '2026-01-01T00:30:00+05:30', '2024-12-30', '1969-12-31T23:59:59Z', '2026-03-29 18:45']
const numval = () => pick([() => Math.round(rnd() * 100), () => rnd() * 1000, () => -rnd() * 50, () => Math.round(rnd() * 1e6), () => rnd() / 100, () => 0, () => 1e7 * rnd(), () => String(Math.round(rnd() * 50)), () => null, () => 'n/a', () => '', () => true])()
const cat = () => pick(words)
const types = core.chartTypes()
const colsFor = { bar: ['x', 'y'], line: ['x', 'y'], area: ['x', 'y'], scatter: ['x', 'y'], pie: ['label', 'value'], donut: ['label', 'value'], histogram: ['value'], box: ['y'], heatmap: ['x', 'y', 'value'], radar: ['x', 'y'], treemap: ['label', 'value'], sankey: ['from', 'to', 'value'] }

// Maps: invented boundaries (squares in the open sea), sound and broken, as GeoJSON and as TopoJSON.
const places = ['North', 'South', 'East Isle', 'İstanbul', 'ΟΔΌΣ', 'N', 's', ' east  isle ', 'Atlantis', 'nroth', '', null, 7, true, 'A', 'beta', 'Zed']
const sq = (x, y, d = 1) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]
const coord = () => pick([() => Math.round(rnd() * 40 - 20), () => rnd() * 300 - 150, () => 0, () => 200, () => 5e5, () => '3', () => null])()
const ring = () => pick([() => sq(Math.round(rnd() * 20), Math.round(rnd() * 20)), () => sq(170, 10, 15), () => [[0, 0], [1, 0], [0, 1]], () => [[0, 0], [1, 0]], () => [], () => [[coord(), coord()], [coord(), coord()], [coord(), coord()], [coord(), coord()]], () => [[1, 2], [3], [4, 5]], () => 5])()
const geometry = () => pick([
  () => ({ type: 'Polygon', coordinates: [ring()] }), () => ({ type: 'Polygon', coordinates: [sq(0, 0, 9), ring()] }), () => ({ type: 'Polygon', coordinates: [ring(), ring()] }),
  () => ({ type: 'MultiPolygon', coordinates: [[ring()], [ring(), ring()]] }), () => ({ type: 'MultiPolygon', coordinates: [] }), () => ({ type: 'Polygon', coordinates: [] }),
  () => ({ type: 'Point', coordinates: [1, 2] }), () => null, () => ({ type: 'Polygon', coordinates: pick([3, [4], 'x']) }), () => 'shape', () => ({})
])()
const feature = i => {
  if (chance(0.03)) return pick([4, null, { type: 'Thing' }, []])
  const f = { type: 'Feature', properties: {}, geometry: chance(0.75) ? { type: 'Polygon', coordinates: [sq(i * 2, 0)] } : geometry() }
  if (chance(0.7)) f.id = pick(['N', 'S', 'E', 'TR', 'GR', 'A', 7, '', null, ' n ', 'atlantis'])
  if (chance(0.8)) f.properties.name = pick(['North', 'South', 'East Isle', 'İstanbul', 'ΟΔΌΣ', 'S', 'n', '  ', 12, null, 'x'.repeat(130)])
  if (chance(0.2)) f.properties.id = pick(['pid', 3, null])
  if (chance(0.1)) f.properties.disputed = pick([true, 'yes'])
  if (chance(0.03)) f.properties = pick([null, 'x', [1]])
  return f
}
const topology = () => {
  const arcs = [[[0, 0], [2, 0], [0, 2], [-2, 0], [0, -2]], [[4, 0], [2, 0], [0, 2], [-2, 0], [0, -2]], [[0, 0], [1, 0]], []]
  if (chance(0.1)) arcs.push(pick([7, [[1]], [[1, 'x']], [[5e6, 0]]]))
  const ref = () => pick([0, 1, -1, -2, 2, 3, -3, 9, 0.5, '0', null, -4294967297])
  const aring = () => (chance(0.8) ? [pick([0, 1, -1, -2])] : pick([() => [ref(), ref()], () => [], () => 5, () => [ref()]])())
  const geom = i => pick([
    () => ({ type: 'Polygon', id: pick(['A', 'B', 'N', i]), properties: { name: pick(['Alpha', 'Beta', 'North']) }, arcs: [aring()] }),
    () => ({ type: 'Polygon', id: `p${i}`, arcs: [aring(), aring()] }), () => ({ type: 'MultiPolygon', id: `m${i}`, arcs: [[aring()], [aring(), aring()]] }),
    () => ({ type: 'MultiPolygon', id: `e${i}`, arcs: pick([[], 3, [[]], [4]]) }), () => ({ type: 'Polygon', arcs: pick([[], 3]) }), () => ({ type: 'Point', coordinates: [0, 0] }), () => ({ id: 'untyped' }), () => 4
  ])()
  const coll = () => ({ type: 'GeometryCollection', geometries: chance(0.95) ? rowsN(1 + Math.floor(rnd() * 4), geom) : 'none' })
  const objects = pick([() => ({ zones: coll(), areas: geom(0) }), () => ({ only: coll() }), () => ({ b: geom(0), a: coll(), 2: coll(), 1: geom(1) }), () => ({}), () => 5, () => ({ zones: 3, areas: coll() })])()
  const t = { type: 'Topology', arcs: chance(0.95) ? arcs : 'arcs', objects }
  if (chance(0.7)) t.transform = chance(0.9) ? { scale: [0.5, 0.5], translate: [10, 20] } : pick([null, { scale: [1], translate: [0, 0] }, { scale: [1, '1'], translate: [0, 0] }, { scale: [1000, 1], translate: [0, 0] }])
  return t
}
const rowsN = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const sound = () => ({ type: 'FeatureCollection', features: [['N', 'North'], ['S', 'South'], ['E', 'East Isle'], ['TR', 'İstanbul'], ['GR', 'ΟΔΌΣ']].map(([id, name], i) => ({ type: 'Feature', id, properties: { name }, geometry: { type: 'Polygon', coordinates: [sq(i * 2, 0)] } })) })
const geoValue = () => pick([
  sound, sound, sound, sound,
  () => ({ type: 'FeatureCollection', features: rowsN(1 + Math.floor(rnd() * 5), feature) }), () => ({ type: 'FeatureCollection', features: rowsN(1 + Math.floor(rnd() * 5), feature) }),
  topology, topology, () => 'not-registered', () => ({ type: 'Feature' }), () => ({ type: 'FeatureCollection', features: pick([[], {}, 3]) }), () => 5, () => [], () => null, () => ({})
])()
const cameraValue = () => pick([() => ({ lng: rnd() * 400 - 200, lat: rnd() * 200 - 100 }), () => ({ zoom: pick([0.4, 0.5, 2, 40, 41]), pitch: pick([-1, 0, 45, 70, 71]), bearing: pick([-361, -360, 0, 400]) }), () => ({}), () => ({ lon: 1 }), () => ({ lng: '3' }), () => [1, 2], () => 'here', () => ({ zoom: null })])()
function mapFields(spec, type, data) {
  for (const row of data) {
    row.la = pick([() => rnd() * 180 - 90, () => rnd() * 180 - 90, () => rnd() * 400 - 200, () => String(Math.round(rnd() * 80)), () => null, () => 'n/a', () => ''])()
    row.lo = pick([() => rnd() * 360 - 180, () => rnd() * 360 - 180, () => rnd() * 800 - 400, () => String(Math.round(rnd() * 170)), () => null, () => 'x'])()
    row.la2 = chance(0.9) ? rnd() * 170 - 85 : pick([95, null, 'n/a'])
    row.lo2 = chance(0.9) ? rnd() * 350 - 175 : pick([195, null])
    row.r = pick(places); row.r2 = pick(places)
  }
  const num = () => pick(['a', 'b', 'c'])
  if (chance(type === 'choropleth' ? 0.95 : 0.5)) spec.geo = geoValue()
  if (type === 'choropleth') {
    if (chance(0.95)) spec.region = pick(['r', 'r', 'r', 'd', 'nope']); if (chance(0.95)) spec.value = num()
    if (chance(0.3)) spec.extrude = pick([true, false, 'yes']); if (chance(0.2)) spec.scale = pick(['sequential', 'diverging', 'log']); if (chance(0.2)) spec.domain = pick([[0, 100], [5, 1], [null, 3]])
  } else if (type === 'flow-map') {
    const ll = { fromLat: 'la', fromLng: 'lo', toLat: 'la2', toLng: 'lo2' }
    if (chance(0.6)) for (const k of Object.keys(ll)) if (chance(0.93)) spec[k] = chance(0.97) ? ll[k] : pick(['d', 'nope'])
    if (chance(0.7)) spec.from = 'r'; if (chance(0.7)) spec.to = 'r2'
    if (chance(0.6)) spec.value = num(); if (chance(0.3)) spec.series = 'g'
  } else {
    if (chance(0.7)) spec.lat = chance(0.95) ? 'la' : pick(['d', 'lo', 'nope']); if (chance(0.7)) spec.lng = chance(0.95) ? 'lo' : pick(['d', 'la'])
    if (chance(0.5)) spec.region = 'r'
    if (type === 'bubble-map') { if (chance(0.6)) spec.size = num() } else if (chance(0.95)) spec.value = num()
    if (chance(0.4)) spec.series = 'g'; if (chance(0.4)) spec.label = pick(['d', 'e'])
  }
  if (chance(0.4)) spec.view = pick(['flat', 'globe', 'round']); if (chance(0.2)) spec.projection = pick(['mercator', 'equal-earth', 'peters'])
  if (chance(0.3)) spec.camera = cameraValue(); if (chance(0.15)) spec.disputed = pick(['same', 'dashed', 'muted', 'hide']); if (chance(0.15)) spec.graticule = pick([true, false, 1])
}

// `transform`: pipelines that mostly make sense for the chart (so that many specs stay valid and the rows are
// compared), mixed with steps that are wrong in every way a step can be.
const NUMERIC = ['a', 'b', 'c', 'la', 'lo', 'la2', 'lo2']
const bound = () => pick([() => Math.round(rnd() * 60), () => rnd() * 1000 - 100, () => pick(dates), () => String(Math.round(rnd() * 40)), () => 1767225600000 + Math.round(rnd() * 1e10)])()
// Bounds that let most rows through, so that a pipeline has something left to plot.
const low = () => (chance(0.4) ? bound() : pick([-1e9, -50, 0, 0, 1, '1900-01-01', '2026-01-05']))
const high = () => (chance(0.4) ? bound() : pick([1e15, 1e15, 1767225600000, '2999-12-31', '2026-03-31', 100]))
const badBound = () => pick([true, null, 'later', {}, [1], ''])
const span = () => pick([
  () => { const a = Math.round(rnd() * 50 - 10); return [a, a + Math.round(rnd() * 60)] },
  () => { const i = Math.floor(rnd() * 3); return [['2025-12-01', '2026-01-05', '2026-02-10'][i], ['2026-02-10', '2026-03-31', '2026-07'][Math.floor(rnd() * 3)]] },
  () => [null, bound()], () => [bound(), null], () => [bound(), bound()], () => [null, null]
])()
function usedColumns(spec, cols) {
  const out = []
  for (const [k, v] of Object.entries(spec)) {
    if (k === 'type' || k === 'data' || k === 'title' || k === 'transform') continue
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string' && cols.includes(x) && !out.includes(x)) out.push(x)
  }
  return out
}
// A messy pipeline gets steps that are wrong on purpose; a tidy one only what its data makes of it.
let messy = false
const oops = p => messy && chance(p)
function makeStep(spec, data, cols) {
  const col = () => (!oops(0.06) ? pick(cols) : pick(['nope', 'K', 'A', 3, null, undefined]))
  const kind = oops(0.1) ? 'junk' : pick(['filter', 'filter', 'filter', 'timeUnit', 'aggregate', 'aggregate', 'sort', 'sort', 'top'])
  let body
  if (kind === 'filter') {
    body = { field: col() }
    const seen = () => { const v = pick(data)[body.field]; return v === undefined ? 'undefined' : v }
    // A bound that is a value of the column, so rows land exactly on it (range: from inclusive, to exclusive).
    const edge = () => { const v = seen(); return typeof v === 'number' || (typeof v === 'string' && /^\d/.test(v)) ? v : 0 }
    const edges = () => { const a = edge(), b = edge(); return chance(0.15) ? [null, b] : typeof a === typeof b && a > b ? [b, a] : [a, b] }
    const tests = {
      equal: () => (!oops(0.1) ? seen() : pick([cat(), null, {}, 'null', [1]])),
      oneOf: () => (!oops(0.1) ? rowsN((messy ? 0 : 1) + Math.floor(rnd() * 5), () => (chance(0.8) ? seen() : pick([cat(), null, true, 10, '10']))) : pick(['p', [['p']], null, [{}]])),
      range: () => (!oops(0.12) ? (chance(0.5) ? edges() : span()) : pick([[1], [5, 1], ['a', 'b'], 'x', [null, null, null], null, [true, 3], ['2026-03-01', '2026-01-01']])),
      gt: () => (!oops(0.1) ? (chance(0.5) ? edge() : low()) : badBound()), gte: () => (!oops(0.1) ? (chance(0.5) ? edge() : low()) : badBound()),
      lt: () => (!oops(0.1) ? (chance(0.5) ? edge() : high()) : badBound()), lte: () => (!oops(0.1) ? (chance(0.5) ? edge() : high()) : badBound()),
      valid: () => (!oops(0.1) ? chance(0.75) : pick(['yes', 1, null]))
    }
    const names = [...Object.keys(tests), 'equal', 'oneOf', 'oneOf', 'valid']
    for (let i = oops(0.08) ? 0 : pick([1, 1, 1, 1, 1, 2, 2, 3]); i > 0; i--) { const k = pick(names); body[k] = tests[k]() }
  } else if (kind === 'timeUnit') {
    body = { field: !oops(0.3) ? (chance(0.6) || (typeof data[0].k === 'string' && /^\d{4}-/.test(data[0].k)) ? 'k' : pick(['a', 'b', 'c'])) : col(), unit: !oops(0.08) ? pick(core.TIME_UNITS) : pick(['months', 'Week', 5, null, undefined]) }
    if (chance(0.5)) body.as = !oops(0.15) ? pick(['m', 'm', 'k', 'bucket', 'g']) : pick(['', 'x'.repeat(65), 4, null])
    if (typeof body.as === 'string' && body.as && !cols.includes(body.as)) cols.push(body.as)
  } else if (kind === 'aggregate') {
    if (!oops(0.5)) {
      const used = usedColumns(spec, cols)
      const nums = used.filter(c => NUMERIC.includes(c))
      body = { groupBy: used.filter(c => !nums.includes(c)).slice(0, 4), fields: Object.fromEntries(nums.map(c => [c, pick(core.AGGREGATE_OPS)])) }
      if (chance(0.3) || !nums.length) body.count = !oops(0.1) ? pick(['n', 'n', 'count', 'a']) : pick(['', 5, null, 'x'.repeat(65)])
      if (oops(0.1)) delete body.groupBy
    } else {
      body = {}
      if (chance(0.8)) body.groupBy = pick([() => rowsN(Math.floor(rnd() * 3), () => pick(cols)), () => rowsN(1 + Math.floor(rnd() * 2), col), () => 'g', () => rowsN(5, () => pick(cols)), () => null, () => [3]])()
      if (chance(0.8)) body.fields = pick([() => Object.fromEntries(rowsN(Math.floor(rnd() * 4), () => [chance(0.9) ? pick(cols) : pick(['nope', '7', '2']), chance(0.9) ? pick(core.AGGREGATE_OPS) : pick(['avg', 'total', 1, null])])), () => [], () => null, () => 'sum', () => ({})])()
      if (chance(0.5)) body.count = pick(['n', 'n', 'rows', '', true])
    }
    const next = [...(Array.isArray(body.groupBy) ? body.groupBy : []), ...(body.fields && typeof body.fields === 'object' ? Object.keys(body.fields) : []), ...(typeof body.count === 'string' ? [body.count] : [])].filter(c => typeof c === 'string')
    cols.splice(0, cols.length, ...new Set(next.length ? next : cols))
  } else if (kind === 'sort') {
    body = { field: col() }
    if (chance(0.7)) body.order = !oops(0.1) ? pick(['ascending', 'descending']) : pick(['desc', 'asc', null, 1])
  } else if (kind === 'top') {
    body = { n: !oops(0.1) ? pick([1, 2, 3, 5, 10, 1000]) : pick([0, 2.5, '3', 1001, null, undefined, -1]), by: col() }
  } else {
    return pick([{}, { filtr: { field: 'a', valid: true } }, { sort: { field: 'a' }, top: { n: 1, by: 'a' } }, 5, null, [], 'sort', { filter: null }, { sort: 'a' }, { top: [] }, { Filter: { field: 'a', valid: true } }, { aggregate: { groupby: ['g'], count: 'n' } }, { zeta: 1, alpha: 2 }])
  }
  if (oops(0.04)) body[pick(['fild', 'extra', 'orderBy', 'groupby', 'N'])] = 1
  if (oops(0.03)) body[pick(['zz', '1', 'by'])] = pick(cols)
  return { [kind]: body }
}
// Times at and past the ends of what timeUnit buckets, the years 0 to 99, and a column named "".
const oddTime = () => pick([MIN_TIME, MIN_TIME - 1, MAX_TIME, MAX_TIME + 1, 1e16, -1e16, 8.64e15 + 1, -8.64e15 - 1, -8.64e15, 8.64e15, '0050-06-15', '0099-12-31T23:00:00Z', '0001-01-01', '0000-12-31', '9999-12-31T23:59:59.999Z', '0001-01-03T10:00:00+14:00', '9999-12-31T20:00:00-05:00', '0100-01-01'])
function addTransform(spec, data) {
  if (chance(0.06)) { for (const row of data) row[''] = pick([cat, numval, () => pick(dates)])(); if (chance(0.5)) spec[pick(['x', 'label', 'series'])] = '' }
  if (chance(0.12)) { const c = pick(['k', 'k', 'a', 'd']); for (const row of data) if (chance(0.4)) row[c] = oddTime() }
  messy = chance(0.4)
  if (oops(0.07)) { spec.transform = pick([null, 'filter', {}, 5, { filter: { field: 'a', valid: true } }]); return }
  const cols = [...new Set(data.flatMap(Object.keys))]
  const n = oops(0.05) ? 11 : pick([0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 10])
  spec.transform = rowsN(n, () => makeStep(spec, data, cols))
  // Sometimes the chart reads the column a step made.
  if (typeof spec.x === 'string' && cols.includes('m') && chance(0.4)) spec.x = 'm'
  if (cols.includes('n') && chance(0.3)) { if (spec.type === 'bar' && chance(0.5)) spec.line = 'n'; else if (typeof spec.value === 'string') spec.value = 'n'; else if (typeof spec.y === 'string') spec.y = 'n' }
}
const fieldsOf = Object.fromEntries(core.chartCatalog().map(c => [c.type, Object.fromEntries(c.fields.map(f => [f.name, f]))]))
const domainValue = () => pick([[0, 100], [0, 100], [null, 50], [-5, null], ['2026-01-01', '2026-03-01'], ['2026-01-01', null], [null, '2026-06-30'], [null, 50], [-5, null], [null, null], ['2026-01-01', '2026-03-01'], ['2026-01-01', null], [1767225600000, '2026-06-30T12:00:00Z'], [0, '2026-07'], ['2026-03-01', '2026-01-01'], ['soon', '2026-01-01'], ['5', 10], ['2026-02-30', null], [1], 'x', [3, 3], [1, 2, 3], [true, 1]])

function makeSpec() {
  const type = pick(types)
  const n = 1 + Math.floor(rnd() * 14)
  const data = []
  const wide = chance(0.3)
  const xKind = pick(['cat', 'date', 'num'])
  for (let i = 0; i < n; i++) {
    const row = {}
    row.k = xKind === 'cat' ? cat() : xKind === 'date' ? pick(dates) : Math.round(rnd() * 30) / (chance(0.3) ? 4 : 1)
    row.g = pick(['p', 'q', 'r', 's'])
    row.a = numval(); row.b = numval(); row.c = numval(); row.d = cat(); row.e = cat()
    if (chance(0.05)) delete row.a
    data.push(row)
  }
  const spec = { type, data }
  const num = () => pick(['a', 'b', 'c'])
  switch (type) {
    case 'bar': case 'line': case 'area': case 'radar':
      spec.x = chance(0.9) ? 'k' : 'd'; spec.y = wide ? ['a', 'b'].slice(0, 1 + Math.floor(rnd() * 2)) : num()
      if (!wide && chance(0.4)) spec.series = 'g'
      if (type === 'bar' && chance(0.4)) { spec.stack = pick(['none', 'stack', 'normalize']); spec.sort = pick(['asc', 'desc', 'none']) }
      if (type === 'area' && chance(0.5)) spec.stack = pick(['stack', 'normalize'])
      if ((type === 'line' || type === 'area') && chance(0.3)) spec.xType = pick(['auto', 'category', 'linear', 'time'])
      break
    case 'scatter': spec.x = chance(0.7) ? 'a' : 'k'; spec.y = num(); if (chance(0.4)) spec.series = 'g'; if (chance(0.2)) spec.xType = pick(['linear', 'time']); break
    case 'pie': case 'donut': spec.label = 'd'; spec.value = num(); if (chance(0.5)) spec.sort = pick(['none', 'asc', 'desc']); if (chance(0.5)) spec.maxSlices = 2 + Math.floor(rnd() * 6); break
    case 'histogram': spec.value = num(); if (chance(0.4)) spec.series = 'g'; if (chance(0.3)) spec.bins = 1 + Math.floor(rnd() * 20); if (chance(0.2)) spec.binWidth = pick([0.5, 2, 25]); break
    case 'box': spec.y = num(); if (chance(0.7)) spec.x = 'g'; break
    case 'heatmap': spec.x = 'd'; spec.y = 'e'; spec.value = num(); break
    case 'treemap': spec.label = 'd'; spec.value = num(); if (chance(0.5)) spec.group = pick(['e', 'g', 'd']); break
    case 'sankey': spec.from = 'd'; spec.to = 'e'; spec.value = num(); break
    case 'choropleth': case 'bubble-map': case 'column-map': case 'flow-map': mapFields(spec, type, data); break
  }
  if (chance(0.5)) spec.format = pick(['auto', 'compact', 'integer', 'percent', 'fixed:2', 'currency:USD', 'currency:EUR'])
  if (chance(0.3)) spec.title = pick(words)
  if (chance(0.08)) spec.legend = pick(['top', 'weird'])
  if (chance(0.05)) spec.colors = { a: pick(['red', 'url(x)', '#fff', 'rgb(1,2,3)']) }
  if (chance(0.05)) spec.bogus = 1
  // Fields added later: textures, small multiples, zoom and brush, combo bars, density, ranges as ISO dates.
  if (chance(0.08)) spec.patterns = pick([true, false, 'yes'])
  const has = f => f in fieldsOf[type] || chance(0.04)
  if (has('facet') && chance(0.15)) spec.facet = pick(['g', 'g', 'g', 'd', 'k', 'nope', 3])
  if (has('zoom') && chance(0.12)) spec.zoom = pick(['none', 'x', 'x', 'xy', 'xy', 'both'])
  if (has('brush') && chance(0.12)) spec.brush = pick(['none', 'x', 'x', 'xy', 'xy', true])
  if (type === 'bar' && chance(0.3)) spec.line = pick([num, num, () => [num(), num()], () => 'd', () => [], () => ['a', 'nope'], () => 7])()
  if (type === 'bar' && chance(0.2)) spec.orientation = pick(['horizontal', 'vertical', 'sideways'])
  if (type === 'scatter' && chance(0.3)) spec.density = pick(['points', 'hex', 'auto', 'hexbin'])
  for (const k of ['xDomain', 'yDomain', 'domain']) if (has(k) && chance(0.2) && !(k in spec)) spec[k] = domainValue()
  // Times at the ends of what a Date holds, and past them, in a column a chart may read as time.
  if (chance(0.04)) { const c = pick(['k', 'k', 'a']); for (const row of data) if (chance(0.3)) row[c] = oddTime() }
  if (chance(0.45)) addTransform(spec, data)
  return spec
}
// The size limits of a geography: too many regions, too many points (GeoJSON and TopoJSON), and more errors than are reported.
const big = geo => ({ type: 'choropleth', geo, region: 'r', value: 'v', data: [{ r: 'r0', v: 1 }] })
const tiny = i => ({ type: 'Feature', id: `r${i}`, properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1]]] } })
const L = core.GEO_LIMITS
const limitSpecs = [
  big({ type: 'FeatureCollection', features: rowsN(L.maxRegions, tiny) }),
  big({ type: 'FeatureCollection', features: rowsN(L.maxRegions + 1, tiny) }),
  big({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'r0', properties: {}, geometry: { type: 'Polygon', coordinates: [[...rowsN(L.maxVertices - 1, i => [i % 300, 0]), [0, 0]]] } }] }),
  big({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'r0', properties: {}, geometry: { type: 'Polygon', coordinates: [[...rowsN(L.maxVertices, i => [i % 300, 0]), [0, 0]]] } }] }),
  big({ type: 'Topology', arcs: [[[0, 0], [1, 0], [0, 1], [0, 0]], rowsN(L.maxVertices - 4, () => [0, 0])], objects: { o: { type: 'Polygon', id: 'r0', arcs: [[0]] } } }),
  big({ type: 'Topology', arcs: [[[0, 0], [1, 0], [0, 1], [0, 0]], rowsN(L.maxVertices - 3, () => [0, 0]), 'never read'], objects: { o: { type: 'Polygon', id: 'r0', arcs: [[0]] } } }),
  big({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }, ...rowsN(L.maxIssues + 5, i => (i % 2 ? 7 : tiny(i))).map((f, i) => (i % 2 ? f : { ...f, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 99]]] } })), { type: 'Feature', properties: {}, geometry: null }] })
]
const specOut = []
const SPECS = 5000
for (let i = 0; i < SPECS + limitSpecs.length; i++) {
  // Through JSON, as a port receives it (an `undefined` value is an absent key).
  const spec = i < SPECS ? JSON.parse(JSON.stringify(makeSpec())) : limitSpecs[i - SPECS]
  const v = core.validatePlot(spec)
  const d = core.describePlot(spec)
  specOut.push({ spec, ok: v.ok, issues: v.issues.map(x => [x.severity, x.code, x.path]), normalized: v.spec ? (({ data, ...r }) => r)(v.spec) : null, describe: d.ok ? d.text : null, ...(v.spec && spec.transform !== undefined ? { rows: v.spec.data } : {}) })
}
const specs = specOut

writeFileSync(target, JSON.stringify({ ...numeric, specs }))
const stats = { valid: specs.filter(c => c.ok).length, transforms: specs.filter(c => c.spec.transform !== undefined).length, transformed: specs.filter(c => c.rows).length }
console.log(`seed ${seed}: ${numeric.out.length + numeric.ticks.length + numeric.bins.length + numeric.buckets.length} numeric cases, ${specs.length} specs (${stats.valid} valid; ${stats.transforms} with a transform, ${stats.transformed} of them valid)`)
