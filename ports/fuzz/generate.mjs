// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Differential fuzzing of the ports against the reference implementation.
//   node ports/fuzz/generate.mjs <seed> <out.json>
// Writes random numbers (formatting, ticks, bins, box statistics, timeUnit buckets, log ticks, kernel densities,
// LOESS fits, bin steps, waffle cells, durations, exact numbers, word cloud layouts) and random specs of every chart type (every transform step and
// every field included, sound and broken) together
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
// Round 5 statistics: log axes, kernel density (bandwidth, grid, peaks), LOESS, the bin step's edges, waffle cells
// and durations. The ports must agree to the last bit, so the values go through the same elementary functions.
const some = (n, f) => Array.from({ length: n }, f)
const logs = some(2000, () => {
  const a0 = 10 ** (rnd() * 12 - 6)
  const a = chance01(0.5) ? Number(a0.toPrecision(1 + Math.floor(rnd() * 3))) : a0
  const b = chance01(0.1) ? a : a * 10 ** (rnd() * (chance01(0.5) ? 2 : 9))
  const n = 2 + Math.floor(rnd() * 9)
  return [a, b, n, core.logTicks(a, b, n), core.niceLogDomain(a, b)]
})
function chance01(p) { return rnd() < p }
const sample = () => {
  const n = 1 + Math.floor(rnd() * rnd() * 80)
  const sc = 10 ** (Math.floor(rnd() * 7) - 3)
  const shape = Math.floor(rnd() * 4)
  return some(n, () => {
    const v = shape === 0 ? rnd() * sc : shape === 1 ? Math.round(rnd() * 12) * sc : shape === 2 ? (rnd() < 0.5 ? rnd() : 5 + rnd()) * sc : (rnd() + rnd() + rnd() - 1.5) * sc
    return Math.round(v * 1e6) / 1e6
  })
}
const densities = some(250, () => {
  const values = sample()
  const bandwidth = chance01(0.3) ? Number((rnd() * 3 + 0.01).toPrecision(3)) : undefined
  const d = core.kde(values, bandwidth)
  return [values, bandwidth ?? null, core.silverman(values), d.bandwidth, d.grid, d.density, core.densityPeaks(d)]
})
const fits = some(400, () => {
  const xs = sample()
  const ys = xs.map(x => Math.round((Math.sin(x) * 10 + rnd() * 5) * 1000) / 1000)
  const bandwidth = pick01([0.3, 0.3, 0.05, 0.5, 1, Number((0.05 + rnd() * 0.95).toFixed(3))])
  const grid = pick01([50, 50, 2, 7, 10, 25])
  return [xs, ys, bandwidth, grid, core.loess(xs, ys, bandwidth, grid)]
})
function pick01(a) { return a[Math.floor(rnd() * a.length)] }
const binSteps = some(600, () => {
  const values = sample()
  const maxbins = pick01([10, 10, 1, 2, 5, 20, 40, 200])
  const lo = Math.min(...values), hi = Math.max(...values)
  const step = chance01(0.3) && hi > lo ? Number(((hi - lo) / (1 + Math.floor(rnd() * 150))).toPrecision(2)) : undefined
  return [values, maxbins, step ?? null, core.transformBinEdges(values, maxbins, step)]
})
const waffles = some(600, () => {
  const values = some(1 + Math.floor(rnd() * 9), () => pick01([() => Math.round(rnd() * 100), () => rnd() * 1000, () => 0, () => -rnd() * 5, () => 1, () => rnd() / 1000])())
  const cells = pick01([100, 100, 50, 200, 400, 10 * (5 + Math.floor(rnd() * 36))])
  return [values, cells, core.waffleCells(values, cells)]
})
const durations = some(3000, () => {
  const ms = pick01([() => rnd() * 1e3, () => rnd() * 1e5, () => Math.round(rnd() * 1e7), () => rnd() * 1e9, () => Math.round(rnd() * 400) * 864e5, () => Math.round(rnd() * 3e11), () => pick01([0, 59499, 59500, 59999.5, 3599500, 3599499, 86399500, 86400000 - 1, 9999, 10000, 172799999, -90000, 3155e11])])()
  return [ms, core.formatDuration(ms, 'en')]
})
// Round 6: the exact number format of the 3D charts' descriptions (up to 10 decimals), and word cloud layouts
// (integer boxes on a spiral; the widths stand in for a text measurement).
const exactFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 10 })
const exacts = [...vals.slice(0, 4000), ...some(1500, () => Number((rnd() * 10 ** (Math.floor(rnd() * 14) - 11)).toPrecision(1 + Math.floor(rnd() * 12)))), -1e-11, 5e-11, 4.9e-11, -5e-11, 0.30000000000000004, 1e21, 123456789.12345678].map(v => [v, exactFormat.format(v)])
const clouds = some(300, () => {
  const n = 1 + Math.floor(rnd() * rnd() * 70)
  const top = pick01([64, 64, 40, 24, 12])
  const words = some(n, (_, i) => ({ text: `w${i}`, size: Math.max(10, Math.floor(top * Math.sqrt((n - i) / n))), rotate: chance01(0.2) }))
  const widths = words.map(w => Math.round(w.size * (1 + Math.floor(rnd() * 12)) * 0.55 * 100) / 100 + (chance01(0.2) ? 0 : rnd()))
  const [width, height] = pick01([() => [320.6, 200], () => [320, 200], () => [640, 380], () => [90, 260], () => [260, 60], () => [0, 0], () => [40, 12], () => [50 + rnd() * 700, 30 + rnd() * 500], () => [Math.round(rnd() * 400), Math.round(rnd() * 300)]])()
  const byText = new Map(words.map((w, i) => [w.text, widths[i]]))
  return [words, widths, width, height, core.cloudLayout(words, width, height, text => byText.get(text))]
})
const numeric = { out, ticks, bins, buckets, logs, densities, fits, binSteps, waffles, durations, exacts, clouds }

s = seed + 1
const pick = a => a[Math.floor(rnd() * a.length)]
const chance = p => rnd() < p
const words = ['alpha', 'Beta', 'gamma', 'δelta', '台灣', 'Other', 'a b', '', 'x'.repeat(45), '😀 smile', 'Q1', 'Q2', '～wave', '10', 'true']
const dates = ['2026-01-05', '2026-02-10', '2026-03-31', '2026-03-01T10:30:00Z', '2025-12-01', '2026-02-30', '2024-02-29', '2026-07', '2026-01-01T00:30:00+05:30', '2024-12-30', '1969-12-31T23:59:59Z', '2026-03-29 18:45']
const numval = () => pick([() => Math.round(rnd() * 100), () => rnd() * 1000, () => -rnd() * 50, () => Math.round(rnd() * 1e6), () => rnd() / 100, () => 0, () => 1e7 * rnd(), () => String(Math.round(rnd() * 50)), () => null, () => 'n/a', () => '', () => true])()
const cat = () => pick(words)
const types = core.chartTypes()
const randDate = () => new Date(Date.UTC(2014 + Math.floor(rnd() * 13), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28))).toISOString().slice(0, 10)
const stamp = () => new Date(Date.UTC(2026, 2, 1 + Math.floor(rnd() * 5), Math.floor(rnd() * 24), pick([0, 0, 15, 30, 59]), pick([0, 0, 0, 30]))).toISOString()

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
const cameraValue = () => pick([() => ({ lng: rnd() * 400 - 200, lat: rnd() * 200 - 100 }), () => ({ zoom: pick([0.4, 0.5, 2, 8, 9, 40, 41]), pitch: pick([-1, 0, 45, 70, 71, 90, 91]), bearing: pick([-361, -360, 0, 35, 360, 400]) }), () => ({ pitch: pick([0, 30, 60, 80]), bearing: pick([-30, 35, 359.5]), zoom: pick([0.5, 1, 1.5, 8]) }), () => ({ pitch: 30 }), () => ({}), () => ({ lon: 1 }), () => ({ lng: '3' }), () => ({ lat: 2, pitch: 20 }), () => ({ roll: 1, zoom: 2 }), () => ({ toString: 1 }), () => ({ ptich: 40 }), () => [1, 2], () => 'here', () => ({ zoom: null }), () => ({ bearing: '35' })])()
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
const NUMERIC = ['a', 'b', 'c', 'la', 'lo', 'la2', 'lo2', 'lw', 'hi', 'rk', 'gx', 'gy', 'gz']
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
  const kind = oops(0.1) ? 'junk' : pick(['filter', 'filter', 'filter', 'timeUnit', 'aggregate', 'aggregate', 'sort', 'sort', 'top', 'bin', 'bin', 'window', 'window', 'window', 'fold', 'fold', 'index', 'index', 'index'])
  const numeric = () => { const c = cols.filter(x => NUMERIC.includes(x)); return c.length && !oops(0.15) ? pick(c) : col() }
  const pair = (a, b) => (!oops(0.2) ? pick([[a, b], [a, b], [`${a}2`, b], ['k', 'g']]) : pick([[a, a], [a], a, ['', b], [a, b, 'c'], [a, 5], null, ['x'.repeat(65), b]]))
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
  } else if (kind === 'bin') {
    body = { field: numeric() }
    if (chance(0.5)) body.maxbins = !oops(0.2) ? pick([10, 5, 5, 1, 20, 200]) : pick([0, 201, 2.5, '10', null, -3])
    if (chance(0.3)) body.step = !oops(0.2) ? pick([1, 5, 10, 25, 0.5, 100, 1000]) : pick([0, -1, '5', null, 1e-9, true])
    if (chance(0.5)) body.as = pair('from', 'to')
    const names = Array.isArray(body.as) ? body.as : typeof body.field === 'string' ? [`${body.field}_start`, `${body.field}_end`] : []
    for (const c of names) if (typeof c === 'string' && c && !cols.includes(c)) cols.push(c)
  } else if (kind === 'window') {
    body = { op: !oops(0.1) ? pick(core.WINDOW_OPS) : pick(['total', 'Sum', 'cumsum', 5, null, undefined]), field: chance(0.8) ? numeric() : col() }
    if (!oops(0.08)) body.as = !oops(0.1) ? pick(['w', 'w', 'run', 'a', 'k', 'n']) : pick(['', 'x'.repeat(65), 4, null])
    if (chance(0.4)) body.groupBy = !oops(0.15) ? rowsN(1 + Math.floor(rnd() * 2), () => pick(cols)) : pick([() => 'g', () => rowsN(5, () => pick(cols)), () => ['nope'], () => [3], () => null])()
    if (chance(0.5)) body.sortBy = col()
    if (chance(0.4)) body.order = !oops(0.15) ? pick(['asc', 'desc']) : pick(['ascending', 'descending', null, 1])
    if (chance(body.op === 'movingMean' ? 0.6 : 0.1)) body.frame = !oops(0.15) ? pick([1, 2, 3, 5, 1000]) : pick([0, 1001, 2.5, '3', null])
    if (typeof body.as === 'string' && body.as && !cols.includes(body.as)) cols.push(body.as)
  } else if (kind === 'index') {
    body = {}
    if (!oops(0.08)) body.field = chance(0.85) ? numeric() : col()
    if (chance(0.5)) body.as = !oops(0.15) ? pick(['i', 'i', 'ix', 'a', 'k']) : pick(['', 'x'.repeat(65), 4, null])
    if (chance(0.5)) body.groupBy = !oops(0.15) ? rowsN(1 + Math.floor(rnd() * 2), () => pick(cols.includes('g') && chance(0.6) ? ['g'] : cols)) : pick([() => 'g', () => rowsN(5, () => pick(cols)), () => ['nope'], () => [3], () => null])()
    if (chance(0.6)) body.sortBy = chance(0.6) && cols.includes('k') ? 'k' : col()
    if (chance(0.4)) body.base = !oops(0.2) ? pick([100, 100, 1, 50, 0.5, 1000]) : pick([0, -100, '100', null, true])
    // A base value: mostly one the sort column has (as it is, or the same date or number written another way).
    if (chance(body.sortBy === undefined ? 0.1 : 0.5)) {
      const seen = () => { const v = pick(data)[typeof body.sortBy === 'string' ? body.sortBy : 'k']; return v === undefined ? 'undefined' : v }
      const other = v => (typeof v === 'number' ? String(v) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? pick([`${v}T00:00:00Z`, Date.parse(v), v]) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v)
      body.at = !oops(0.15) ? pick([seen, seen, seen, () => other(seen()), () => other(seen()), () => 'first', bound, cat, () => 'null', () => 'undefined'])() : pick([null, {}, [1], true, 'x'.repeat(201)])
    }
    if (typeof body.as === 'string' && body.as && !cols.includes(body.as)) cols.push(body.as)
  } else if (kind === 'fold') {
    const wide = ['a', 'b', 'c'].filter(c => cols.includes(c))
    body = {}
    if (!oops(0.08)) body.fields = !oops(0.2) && wide.length ? wide.slice(0, 1 + Math.floor(rnd() * wide.length)) : pick([() => [], () => 'a', () => ['a', 'a'], () => ['nope'], () => [pick(cols), 3], () => rowsN(51, () => 'a'), () => [pick(cols), pick(cols)], () => null])()
    if (chance(0.5)) body.as = pair('key', 'value')
    if (Array.isArray(body.fields) && body.fields.every(c => typeof c === 'string')) {
      const names = Array.isArray(body.as) ? body.as : ['key', 'value']
      cols.splice(0, cols.length, ...new Set([...cols.filter(c => !body.fields.includes(c)), ...names.filter(c => typeof c === 'string' && c)]))
    }
  } else {
    return pick([{ calculate: { expr: 'a + b', as: 'c' } }, { bin: 'a' }, { window: [] }, { fold: null }, {}, { filtr: { field: 'a', valid: true } }, { sort: { field: 'a' }, top: { n: 1, by: 'a' } }, 5, null, [], 'sort', { filter: null }, { sort: 'a' }, { top: [] }, { index: 'a' }, { index: [] }, { indx: { field: 'a' } }, { Filter: { field: 'a', valid: true } }, { aggregate: { groupby: ['g'], count: 'n' } }, { zeta: 1, alpha: 2 }])
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
  // ... or the long form a fold left, or a running value.
  if (cols.includes('value') && cols.includes('key') && chance(0.6)) { if (typeof spec.series === 'string' || chance(0.3)) spec.series = 'key'; if (typeof spec.y === 'string') spec.y = 'value'; else if (typeof spec.value === 'string') spec.value = 'value' }
  for (const made of ['w', 'run', 'from', 'i', 'ix']) if (cols.includes(made) && chance(0.3)) { if (typeof spec.y === 'string') spec.y = made; else if (typeof spec.value === 'string') spec.value = made }
  if (cols.includes('n') && chance(0.3)) { if (spec.type === 'bar' && chance(0.5)) spec.line = 'n'; else if (typeof spec.value === 'string') spec.value = 'n'; else if (typeof spec.y === 'string') spec.y = 'n' }
}
const fieldsOf = Object.fromEntries(core.chartCatalog().map(c => [c.type, Object.fromEntries(c.fields.map(f => [f.name, f]))]))
const domainValue = () => pick([[0, 100], [0, 100], [null, 50], [-5, null], ['2026-01-01', '2026-03-01'], ['2026-01-01', null], [null, '2026-06-30'], [null, 50], [-5, null], [null, null], ['2026-01-01', '2026-03-01'], ['2026-01-01', null], [1767225600000, '2026-06-30T12:00:00Z'], [0, '2026-07'], ['2026-03-01', '2026-01-01'], ['soon', '2026-01-01'], ['5', 10], ['2026-02-30', null], [1], 'x', [3, 3], [1, 2, 3], [true, 1]])

function makeSpec() {
  const type = pick(types)
  const n = 1 + Math.floor(rnd() * 14)
  const data = []
  const wide = chance(0.3)
  const xKind = (type === 'calendar' || type === 'bump') && chance(0.7) ? 'date' : pick(['cat', 'date', 'num'])
  const longDates = type === 'calendar' && chance(0.5)
  const rangeKind = pick(['date', 'date', 'stamp', 'num', 'num', 'mixed'])
  const edge = () => (chance(0.06) ? pick([null, '', 'n/a', 'soon', true]) : rangeKind === 'date' ? (chance(0.5) ? randDate() : pick(dates)) : rangeKind === 'stamp' ? stamp() : rangeKind === 'num' ? Math.round(rnd() * 200) / 2 : pick([randDate, stamp, () => Math.round(rnd() * 100), () => 1767225600000 + Math.round(rnd() * 1e10)])())
  for (let i = 0; i < n; i++) {
    const row = {}
    row.k = xKind === 'cat' ? cat() : xKind === 'date' ? (longDates ? randDate() : pick(dates)) : Math.round(rnd() * 30) / (chance(0.3) ? 4 : 1)
    row.g = pick(['p', 'q', 'r', 's'])
    row.a = numval(); row.b = numval(); row.c = numval(); row.d = cat(); row.e = cat()
    if (chance(0.05)) delete row.a
    // Interval ends, ranks, a yes/no column and the two ends of a range, for the fields that read them.
    if (['bar', 'line', 'area', 'scatter', 'bullet', 'parallel', 'gauge', 'scatter3d'].includes(type)) { const m = Math.round(rnd() * 100); row.lw = chance(0.9) ? m - Math.round(rnd() * 10) : numval(); row.hi = chance(0.9) ? m + Math.round(rnd() * 10) : numval() }
    if (type === 'bump') row.rk = pick([() => 1 + Math.floor(rnd() * 6), () => 1 + Math.floor(rnd() * 6), () => 1.5, () => 0, () => -2, () => null, () => 'n/a', () => String(1 + Math.floor(rnd() * 4))])()
    if (type === 'waterfall') row.f = pick([false, false, false, true, 'yes', 'no', 'Total', ' subtotal ', 1, 0, null, '', 'TRUE', 2])
    if (type === 'timeline') { row.t0 = edge(); row.t1 = edge() }
    data.push(row)
  }
  const spec = { type, data }
  const num = () => pick(['a', 'b', 'c'])
  switch (type) {
    case 'bar': case 'line': case 'area': case 'radar':
      spec.x = chance(0.9) ? 'k' : 'd'; spec.y = wide ? ['a', 'b'].slice(0, 1 + Math.floor(rnd() * 2)) : num()
      if (!wide && chance(0.4)) spec.series = 'g'
      if (type === 'bar' && chance(0.4)) { spec.stack = pick(['none', 'stack', 'normalize']); spec.sort = pick(['asc', 'desc', 'none']) }
      if (type === 'area' && chance(0.5)) spec.stack = pick(['stack', 'normalize', 'center', 'center'])
      if (type === 'bar' && chance(0.2)) spec.mark = pick(['bar', 'lollipop', 'lollipop', 'dot'])
      if (type === 'line' && chance(0.15)) spec.gaps = pick(['break', 'connect', 'zero', 'zero', 'skip'])
      if ((type === 'line' || type === 'area') && chance(0.3)) spec.xType = pick(['auto', 'category', 'linear', 'time'])
      break
    case 'scatter':
      spec.x = chance(0.7) ? 'a' : 'k'; spec.y = num(); if (chance(0.4)) spec.series = 'g'; if (chance(0.2)) spec.xType = pick(['linear', 'time'])
      if (chance(0.3)) spec.trend = pick(['none', 'linear', 'loess', 'loess', 'cubic'])
      if (chance(0.2)) spec.trendBandwidth = pick([0.05, 0.3, 0.5, 1, 2, 0, '0.5'])
      if (chance(0.15)) { const [l, u] = pick([['lw', 'hi'], ['lw', 'hi'], ['hi', 'lw'], ['lw', undefined], [undefined, 'hi'], ['d', 'hi'], ['nope', 'hi']]); if (l) spec.xLower = l; if (u) spec.xUpper = u }
      break
    case 'pie': case 'donut': spec.label = 'd'; spec.value = num(); if (chance(0.5)) spec.sort = pick(['none', 'asc', 'desc']); if (chance(0.5)) spec.maxSlices = 2 + Math.floor(rnd() * 6); break
    case 'histogram': spec.value = num(); if (chance(0.4)) spec.series = 'g'; if (chance(0.3)) spec.bins = 1 + Math.floor(rnd() * 20); if (chance(0.2)) spec.binWidth = pick([0.5, 2, 25]); break
    case 'box': case 'violin':
      spec.y = num(); if (chance(0.7)) spec.x = 'g'
      if (chance(0.4)) spec.points = pick(['outliers', 'all', 'none', 'some']); if (type === 'box' && chance(0.3)) spec.outliers = pick([true, false, false, 'no'])
      if (type === 'violin' && chance(0.4)) spec.bandwidth = pick([0, 0.5, 5, 50, 2.5, -1, '2']); if (type === 'violin' && chance(0.2)) spec.inner = pick(['box', 'quartiles', 'none', 'stick'])
      // A violin wants several values per group: repeat the rows with other numbers.
      if (type === 'violin' && chance(0.6)) for (const row of [...data]) for (let j = 0; j < 3; j++) data.push({ ...row, a: Math.round(rnd() * 100), b: rnd() * 1000, c: Math.round((rnd() < 0.5 ? rnd() : 5 + rnd()) * 100) / 10 })
      break
    case 'calendar': spec.x = chance(0.9) ? 'k' : 'd'; spec.value = num(); if (chance(0.3)) spec.weekStart = pick(['monday', 'sunday', 'friday']); break
    case 'waterfall':
      spec.x = chance(0.8) ? 'd' : 'k'; spec.y = num()
      if (chance(0.7)) spec.total = pick([() => 'f', () => 'f', () => rowsN(1 + Math.floor(rnd() * 3), cat), () => rowsN(1 + Math.floor(rnd() * 2), () => String(pick(data).d)), () => [pick(data).d, 10, 'True'], () => [], () => 'nope', () => [null], () => [{}], () => 5, () => 'g', () => rowsN(501, i => `s${i}`)])()
      if (chance(0.3)) spec.start = pick([0, 100, -5.5, 1e6, '10', null])
      break
    case 'bullet':
      spec.x = chance(0.8) ? 'd' : 'k'; spec.value = num()
      if (chance(0.6)) spec.target = num()
      if (chance(0.6)) spec.ranges = pick([['lw', 'hi'], ['lw', 'hi'], ['hi', 'lw'], 'lw', ['a', 'b', 'c'], [], ['lw', 'nope'], ['lw', 'd']])
      if (chance(0.3)) spec.scale = pick(['shared', 'each', 'own'])
      break
    case 'bump':
      spec.x = chance(0.9) ? 'k' : 'd'
      if (chance(0.45)) { spec.rank = chance(0.9) ? 'rk' : pick(['a', 'd']); if (chance(0.9)) spec.series = 'g'; if (chance(0.15)) spec.y = num() } else { if (chance(0.95)) spec.y = wide ? ['a', 'b', 'c'].slice(0, 1 + Math.floor(rnd() * 3)) : num(); if (chance(0.8)) spec.series = pick(['g', 'g', 'd']) }
      if (chance(0.3)) spec.rankBy = pick(['asc', 'desc', 'up'])
      break
    case 'timeline':
      spec.y = pick(['d', 'g', 'g']); if (chance(0.97)) spec.start = 't0'; if (chance(0.97)) spec.end = pick(['t1', 't1', 't1', 't1', 't1', 't1', 't1', 't0', 'a'])
      if (chance(0.4)) spec.series = 'g'; if (chance(0.4)) spec.label = pick(['e', 'd', 'a'])
      if (chance(0.25)) spec.xType = pick(['auto', 'linear', 'time', 'category'])
      // Many lanes: past the limit of what is drawn.
      if (chance(0.01)) { spec.y = 'lane'; for (let j = 0; j < 520; j++) data.push({ lane: `l${j}`, g: 'p', t0: j, t1: j + 2, d: 'x', e: 'y', a: 1 }) }
      break
    case 'sunburst': spec.path = pick([() => 'd', () => ['g', 'd'], () => ['g', 'd'], () => ['g', 'd', 'e'], () => ['g', 'k', 'd', 'e'], () => ['g', 'g'], () => [], () => 'nope', () => ['g', 'a'], () => ['g', 'd', 'e', 'k', 'a', 'b', 'c'], () => ['g', 4]])(); spec.value = num(); break
    case 'parallel': spec.dimensions = pick([() => ['a', 'b'], () => ['a', 'b', 'c'], () => ['a', 'b', 'c', 'lw', 'hi'], () => ['lw', 'hi'], () => ['a'], () => 'a', () => ['a', 'a'], () => ['a', 'd'], () => rowsN(13, () => 'a'), () => ['a', 'b', 'a']])(); if (chance(0.4)) spec.series = 'g'; break
    case 'funnel': spec.stage = chance(0.8) ? 'd' : 'k'; spec.value = num(); if (chance(0.3)) for (const row of data) row[spec.value] = Math.round(rnd() * 1000); break
    case 'waffle': spec.label = 'd'; spec.value = num(); if (chance(0.5)) spec.cells = pick([100, 50, 200, 400, 250, 55, 45, 410, 100.5, '100']); if (chance(0.5)) spec.sort = pick(['none', 'asc', 'desc', 'value']); break
    case 'beeswarm': spec.x = chance(0.9) ? num() : 'k'; if (chance(0.6)) spec.y = pick(['g', 'g', 'd']); if (chance(0.3)) spec.series = 'g'; if (chance(0.2)) spec.radius = pick([1, 4, 12, 0, 13]); break
    case 'heatmap': spec.x = 'd'; spec.y = 'e'; spec.value = num(); break
    case 'treemap': spec.label = 'd'; spec.value = num(); if (chance(0.5)) spec.group = pick(['e', 'g', 'g', 'd']); break
    case 'sankey': spec.from = 'd'; spec.to = 'e'; spec.value = num(); break
    case 'choropleth': case 'bubble-map': case 'column-map': case 'flow-map': mapFields(spec, type, data); break
    // Round 6: gauge, word cloud and the 3D charts.
    case 'gauge':
      if (chance(0.45)) data.splice(1)
      if (chance(0.03)) for (const row of data) { row.a = pick([0, -3, null]); row.b = pick([0, -1]) }
      if (chance(0.95)) spec.value = chance(0.95) ? num() : pick(['d', 'nope'])
      if (chance(data.length > 1 ? 0.9 : 0.4)) spec.label = pick(['d', 'd', 'k', 'g', 'e'])
      if (chance(0.4)) spec.min = pick([0, 0, -50, 10, 100, 0.5, '0', null])
      if (chance(0.6)) spec.max = pick([100, 100, 1000, 50, 1e6, 1e7, 0, -10, 10, 99.5, '100'])
      if (chance(0.5)) spec.target = chance(0.9) ? num() : pick(['d', 'lw'])
      if (chance(0.5)) spec.bands = pick([['lw', 'hi'], ['lw', 'hi'], ['hi', 'lw'], ['a', 'b', 'c'], ['lw', 'b', 'hi'], ['lw'], ['a', 'b', 'c', 'lw'], 'lw', ['lw', 'nope'], ['lw', 'd'], ['lw', 'lw'], []])
      if (chance(0.3)) spec.bandOrder = pick(['worst-first', 'best-first', 'best-first', 'best'])
      if (chance(0.2)) spec.arc = pick([180, 240, 90, 330, 89, 331, 200.5, '240'])
      break
    case 'wordcloud':
      if (chance(0.95)) spec.text = pick(['d', 'd', 'd', 'e', 'k', 'g', 'a', 'nope'])
      if (chance(0.95)) spec.value = chance(0.95) ? num() : 'd'
      if (chance(0.4)) spec.series = pick(['g', 'g', 'e', 'd'])
      if (chance(0.3)) spec.rotate = pick(['none', 'some', 'some', 'all'])
      // Words: padded, repeated, not text; values at and below zero; more words than are drawn.
      if (chance(0.3)) for (const row of data) if (chance(0.4)) row.d = pick([` ${row.d} `, `${row.d}\t`, '   ', 7, 7.5, true, null, 'alpha', ['a', 'b'], '\u00a0nb\u00a0'])
      if (chance(0.5)) for (const row of data) for (const c of ['a', 'b', 'c']) if (chance(0.7)) row[c] = pick([() => 1 + Math.round(rnd() * 500), () => rnd() * 100, () => 2500, () => 0, () => -4, () => String(1 + Math.round(rnd() * 30))])()
      if (chance(0.03)) for (let j = 0; j < 140 + Math.floor(rnd() * 30); j++) data.push({ d: `word ${j % 155}`, e: cat(), g: pick(['p', 'q']), k: j, a: 1 + (j * 7) % 23, b: rnd() * 10, c: j % 5 })
      break
    case 'scatter3d': {
      const col = () => pick(['a', 'b', 'c', 'lw', 'hi'])
      if (chance(0.97)) spec.x = chance(0.95) ? col() : pick(['d', 'k', 'nope']); if (chance(0.97)) spec.y = col(); if (chance(0.97)) spec.z = chance(0.95) ? col() : 'd'
      if (chance(0.4)) spec.series = pick(['g', 'g', 'd', '']); if (chance(0.4)) spec.size = pick(['a', 'b', 'lw', 'lw', 'd']); if (chance(0.4)) spec.label = pick(['d', 'e', 'k'])
      if (chance(0.2)) spec.dropLines = pick([true, false, 'no'])
      // Clean numbers in most rows, so that many charts have points; minus zero as text (a number can not carry it in JSON).
      if (chance(0.7)) for (const row of data) for (const c of ['a', 'b', 'c']) if (chance(0.85)) row[c] = pick([() => Math.round(rnd() * 100), () => rnd() * 1000 - 300, () => Math.round(rnd() * 1e7) / 1e4, () => 0.1 + 0.2, () => 1234567.891, () => '-0', () => 0, () => 1e-11 * Math.round(rnd() * 99)])()
      break
    }
    case 'surface': {
      // A grid: every combination of a few x and y values, with holes and repeats; now and then no grid at all.
      const nx = pick([1, 2, 2, 3, 4, 6]), ny = pick([1, 2, 3, 3, 5])
      const x0 = pick([0, 0, '-0', 5, -3.5, 1e6, 0.1]), dx = pick([1, 0.5, 10, 0.1, 1000])
      const y0 = pick([0, '-0', 1, -20, 0.2]), dy = pick([1, 2.5, 0.1, 100])
      const at = (v0, d, i) => (i === 0 ? v0 : Number(v0) + d * i)
      const grid = []
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let r = chance(0.08) ? 2 : chance(0.07) ? 0 : 1; r > 0; r--) {
        grid.push({ ...data[(i * ny + j) % data.length], gx: chance(0.03) ? pick([null, 'n/a', String(at(x0, dx, i))]) : at(x0, dx, i), gy: at(y0, dy, j), gz: chance(0.9) ? pick([() => Math.round(rnd() * 100), () => rnd() * 50 - 10, () => 40])() : numval() })
      }
      if (chance(0.01)) for (let i = 0; i < 201; i++) for (let j = 0; j < 2; j++) grid.push({ gx: i, gy: j, gz: i + j, g: 'p', d: 'x' })
      if (chance(0.5)) grid.sort(() => rnd() - 0.5)
      if (grid.length && chance(0.9)) data.splice(0, data.length, ...grid)
      const onGrid = 'gx' in data[0]
      if (chance(0.97)) spec.x = onGrid && chance(0.95) ? 'gx' : pick(['a', 'd', 'nope']); if (chance(0.97)) spec.y = onGrid && chance(0.95) ? 'gy' : pick(['b', 'k']); if (chance(0.97)) spec.z = onGrid && chance(0.9) ? 'gz' : num()
      if (chance(0.2)) spec.mesh = pick([true, false, 'on'])
      break
    }
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
  // Round 6: the 3D camera and projection, axis titles, a second value axis and a broken axis.
  if (type === 'scatter3d' || type === 'surface') {
    if (chance(0.35)) spec.projection = pick(['orthographic', 'perspective', 'perspective', 'mercator'])
    if (chance(0.35)) spec.camera = cameraValue()
    for (const k of ['xLabel', 'yLabel', 'zLabel']) if (chance(0.15)) spec[k] = pick(['Width (mm)', '台灣', 'x'.repeat(90), 5])
  }
  if (has('yRight') && chance(0.3)) spec.yRight = pick([num, num, num, () => 'lw', () => 'hi', () => [num(), 'lw'], () => ['lw', 'hi'], () => ['lw', 'hi', 'c'], () => 'd', () => 'nope', () => [], () => ['a', 'nope'], () => 7])()
  if (has('yRightLabel') && chance('yRight' in spec ? 0.4 : 0.04)) spec.yRightLabel = pick(['Share', 'Rate (%)', '', 'x'.repeat(90), 3])
  if (has('formatRight') && chance('yRight' in spec ? 0.5 : 0.04)) spec.formatRight = pick(['percent', 'fixed:1', 'compact', 'integer', 'currency:USD', 'pct'])
  if (has('rightDomain') && chance('yRight' in spec ? 0.3 : 0.04)) spec.rightDomain = domainValue()
  if (has('yLabel') && chance(0.15)) spec.yLabel = pick(['Orders', 'Where the lines meet', '', 'x'.repeat(70)])
  if (has('yBreak') && chance(0.3)) {
    // Mostly a span between two of the values the axis shows, so that something lies beyond it.
    const seen = data.flatMap(row => (Array.isArray(spec.y) ? spec.y : [spec.y]).map(c => (typeof row[c] === 'number' ? row[c] : NaN))).filter(Number.isFinite).sort((a, b) => a - b)
    const between = () => { if (seen.length < 2) return [10, 50]; const i = Math.floor(rnd() * (seen.length - 1)); const j = i + 1 + Math.floor(rnd() * (seen.length - 1 - i)); const a = seen[i] + (chance(0.5) ? 0 : (seen[i + 1] - seen[i]) / 4), b = seen[j] - (chance(0.5) ? 0 : (seen[j] - seen[j - 1]) / 4); return [Math.round(a * 100) / 100, Math.round(b * 100) / 100] }
    spec.yBreak = pick([between, between, between, between, () => [10, 50], () => [20, 90], () => [1, 1e5], () => [-50, -5], () => [0, 5], () => [-5, 5], () => [0.5, 2], () => [null, 5], () => [40, null], () => [9, 4], () => ['2026-01-01', '2026-03-01'], () => 'x', () => [5]])()
  }
  // Drill-down: a path of group values, mostly ones the data has.
  if (has('focus') && chance(type === 'treemap' || type === 'sunburst' ? 0.4 : 0.02)) {
    const row = pick(data)
    const levels = type === 'sunburst' ? (Array.isArray(spec.path) ? spec.path : [spec.path]) : [spec.group, spec.label]
    const along = levels.map(l => (typeof l === 'string' && row[l] !== undefined && row[l] !== null ? row[l] : 'x'))
    spec.focus = pick([() => along.slice(0, 1), () => along.slice(0, 1), () => along.slice(0, 2), () => along.slice(0, 2), () => along, () => [pick(['p', 'q', 'r', 'P', 'zz', 10])], () => [along[0], cat()], () => [], () => 'p', () => [null], () => [{}], () => ['p', true], () => rowsN(7, () => 'p'), () => [along[0], along[1], 'deeper']])()
  }
  // Round 5: log axes, intervals and annotations (reference lines, bands, labelled points).
  for (const k of ['xScale', 'yScale']) if (has(k) && chance(0.2)) spec[k] = pick(['log', 'log', 'log', 'linear', 'ln'])
  if (has('yLower') && chance(0.2)) { const [l, u] = pick([['lw', 'hi'], ['lw', 'hi'], ['lw', 'hi'], ['hi', 'lw'], ['lw', undefined], [undefined, 'hi'], ['d', 'hi'], ['lw', 'nope']]); if (l) spec.yLower = l; if (u) spec.yUpper = u }
  if (has('annotations') && chance(0.15)) {
    const at = () => pick([() => Math.round(rnd() * 100), () => pick(dates), cat, () => rnd() * 10])()
    const tone = () => pick(['neutral', 'positive', 'negative', 'warning', 'info'])
    const note = () => pick([
      () => ({ axis: pick(['x', 'y']), value: at() }), () => ({ axis: 'y', value: at(), label: cat(), tone: tone() }), () => ({ axis: 'x', value: at(), to: at(), label: 'band' }),
      () => ({ x: at(), y: at(), label: pick(['Launch', 'Peak', 'x'.repeat(90), '台灣 note']) }), () => ({ x: at(), y: at(), label: 'Launch', tone: tone() }), () => ({ x: at(), y: Math.round(rnd() * 50), label: cat() }),
      () => ({ x: at(), label: 'no y' }), () => ({ y: 3, label: 'no x' }), () => ({ x: at(), y: at() }), () => ({ x: at(), y: at(), label: pick(['', '  ', null, 5]) }), () => ({ x: pick([true, null, {}, [1]]), y: 1, label: 'bad x' }),
      () => ({ x: 1, y: 2, label: 'p', tone: pick(['loud', null, 3]) }), () => ({ x: 1, y: 2, label: 'p', value: 3 }), () => ({ axis: 'x', value: 1, x: 2, y: 3, label: 'both' }), () => ({ axis: pick(['z', null, 1]), value: 1 }),
      () => ({ axis: 'y', value: pick([null, true, {}]) }), () => ({ axis: 'y', value: 1, to: pick([null, true]) }), () => ({ axis: 'y', value: 1, tone: pick([null, 'loud']) }), () => ({ axis: 'y', value: 1, label: pick([null, 7]) }), () => ({ axis: 'y', value: 1, extra: 1 }), () => 5, () => null
    ])()
    spec.annotations = chance(0.95) ? rowsN(1 + Math.floor(rnd() * (chance(0.1) ? 8 : 3)), note) : pick(['x', {}, rowsN(51, () => ({ axis: 'y', value: 1 }))])
  }
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
// Round 6, on purpose: charts that are mostly sound, so that the second value axis, the broken axis, the index step
// and the new charts are compared on what they say (notes, ranges, refusals) and not only on how they fail.
function axesSpec() {
  const type = pick(['bar', 'bar', 'bar', 'line', 'line', 'area'])
  const n = 3 + Math.floor(rnd() * 7)
  const scale = pick([1, 1, 10, 1000, 0.01]), low = pick([0, 0, 0, -40, 20, 500])
  const xs = type === 'bar' || chance(0.3) ? rowsN(n, i => `Q${i + 1}`) : chance(0.6) ? rowsN(n, i => `2026-${String(i + 1).padStart(2, '0')}-01`) : rowsN(n, i => i * 5)
  const data = rowsN(n, i => ({ x: xs[i], g: pick(['p', 'q']), u: Math.round((low + rnd() * 100) * scale * 100) / 100, v: Math.round((low + rnd() * 80) * scale * 100) / 100, r: Math.round(rnd() * 1000) / 1000, s: Math.round(rnd() * 400) / 10, t: 7 }))
  // One value far above the rest (what a break is for), holes, numbers as text, a column of nothing.
  if (chance(0.5)) data[Math.floor(rnd() * n)][pick(['u', 'u', 'v'])] = Math.round((low + 100) * scale * pick([8, 30, 200]))
  if (chance(0.15)) data[Math.floor(rnd() * n)][pick(['u', 'v', 'r', 's'])] = pick([null, 'n/a', '12', -3, 0])
  if (chance(0.05)) for (const row of data) row.r = pick([null, 'n/a'])
  const spec = { type, data, x: 'x', y: pick(['u', 'u', 'u', ['u', 'v'], ['u', 'v'], ['u']]) }
  if (chance(0.15)) spec.series = 'g'
  if (chance(0.75)) spec.yRight = pick(['r', 'r', 'r', 's', ['r', 's'], ['r', 's'], ['s', 'r'], ['r', 'r'], 'u', 'v', ['r', 'v'], 't', []])
  if ('yRight' in spec) {
    if (chance(0.4)) spec.yRightLabel = pick(['Share', 'Rate (%)', 'Share of orders, by quarter'])
    if (chance(0.4)) spec.formatRight = pick(['percent', 'fixed:1', 'compact', 'integer'])
    if (chance(0.25)) spec.rightDomain = pick([[0, 1], [0, 100], [null, 50], [0, null], [5, 2], [0.2, 0.4], [1000, 2000]])
  }
  if (chance(0.3)) spec.yLabel = pick(['Orders', 'Units sold'])
  if (chance(0.4)) spec.format = pick(['compact', 'integer', 'fixed:2', 'currency:USD', 'percent'])
  if (type === 'bar') {
    if (chance(0.3)) spec.line = pick(['v', 'v', 's', ['v', 's']])
    if (chance(0.15)) spec.orientation = 'horizontal'
    if (chance(0.2)) spec.stack = pick(['stack', 'normalize', 'none'])
    if (chance(0.1)) spec.sort = pick(['asc', 'desc'])
  } else {
    if (type === 'area' && chance(0.5)) spec.stack = pick(['none', 'none', 'stack', 'normalize', 'center'])
    if (chance(0.1)) spec.yScale = 'log'
  }
  if (chance(0.6)) {
    const cols = [...(Array.isArray(spec.y) ? spec.y : [spec.y]), ...(spec.line === undefined ? [] : [spec.line].flat())]
    const seen = [...new Set(data.flatMap(row => cols.map(c => row[c])).filter(v => typeof v === 'number'))].sort((a, b) => a - b)
    const i = Math.floor(rnd() * (seen.length - 1)), j = Math.min(seen.length - 1, i + 1 + Math.floor(rnd() * rnd() * (seen.length - 1 - i)))
    const top = seen[seen.length - 1]
    spec.yBreak = pick([
      () => [seen[i], seen[j]], () => [seen[i], seen[j]], () => [seen[i] + (seen[i + 1] - seen[i]) / 4, seen[j] - (seen[j] - seen[j - 1]) / 4], () => [seen[seen.length - 2], top], () => [seen[seen.length - 2] * 1.1, top * 0.9],
      () => [seen[0], top], () => [-5, 5], () => [0, seen[0]], () => [seen[0] / 2, 0], () => [top * 2, top * 3], () => [top, top * 3], () => [seen[0] - 20, seen[0] - 10], () => [top * 0.999, top * 0.9995], () => [seen[j], seen[i]], () => [seen[i], seen[i]]
    ])().map(v => Math.round(v * 1e4) / 1e4)
    if (chance(0.15)) spec.yDomain = pick([[0, null], [null, top * 2], [seen[0], top], [0, seen[i]]])
  }
  if (chance(0.2)) {
    const step = { field: pick(['u', 'u', 'v', 'r']) }
    if (chance(0.5)) step.groupBy = ['g']
    if (chance(0.5)) step.sortBy = 'x'
    if (chance(0.4)) step.base = pick([100, 1, 50])
    if (chance(0.4)) step.as = pick(['ix', 'u'])
    if (chance(0.3) && step.sortBy) step.at = pick([xs[0], xs[1], xs[n - 1], 'Q9'])
    spec.transform = [{ index: step }]
    if (step.as === 'ix' && chance(0.7)) spec.y = 'ix'
  }
  return spec
}
function moreSpec() {
  const kind = pick(['gauge', 'gauge', 'wordcloud', 'wordcloud', 'scatter3d', 'scatter3d', 'surface', 'surface', 'crowd', 'wide'])
  const round = (v, d = 100) => Math.round(v * d) / d
  if (kind === 'crowd') return { type: 'wordcloud', text: 'w', value: 'n', data: rowsN(CLOUD_MAX - 2 + Math.floor(rnd() * 6), i => ({ w: `word ${i}`, n: 1 + (i * 7) % 23 })), ...(chance(0.5) ? { rotate: 'some' } : {}) }
  if (kind === 'wide') { const side = pick([200, 200, 201, 202]), tall = chance(0.5); return { type: 'surface', x: 'x', y: 'y', z: 'z', data: rowsN(side * 2, i => ({ [tall ? 'y' : 'x']: i >> 1, [tall ? 'x' : 'y']: i & 1, z: (i * 13) % 31 })) } }
  if (kind === 'gauge') {
    const many = chance(0.4) ? 1 + Math.floor(rnd() * 5) : 1
    const lo = pick([0, 0, 0, -50, 10]), hi = lo + pick([100, 100, 1, 250, 4000])
    const data = rowsN(many, i => ({ name: `Line ${i + 1}`, now: round(lo + (hi - lo) * (chance(0.1) ? rnd() * 1.6 - 0.3 : rnd())), goal: round(lo + (hi - lo) * rnd()) }))
    const spec = { type: 'gauge', value: 'now', data }
    if (many > 1 || chance(0.5)) spec.label = 'name'
    if (chance(0.7)) { spec.min = lo; spec.max = hi }
    if (chance(0.4)) spec.target = chance(0.5) ? 'goal' : round(lo + (hi - lo) * 0.8)
    if (chance(0.6)) {
      const cuts = rowsN(pick([1, 2, 2, 3, 4]), () => round(lo + (hi - lo) * rnd())).sort((a, b) => a - b)
      spec.bands = chance(0.9) ? cuts : pick([cuts.slice().reverse(), [...cuts, cuts[0]], [hi * 2]])
      if (chance(0.5)) spec.bandOrder = pick(['worst-first', 'best-first'])
    }
    if (chance(0.3)) spec.arc = pick([180, 240, 270, 330, 90])
    if (chance(0.4)) spec.format = pick(['percent', 'integer', 'fixed:1', 'compact'])
    return spec
  }
  if (kind === 'wordcloud') {
    const n = 1 + Math.floor(rnd() * 40)
    const data = rowsN(n, i => ({ w: chance(0.1) ? `word ${Math.floor(rnd() * n)}` : `word ${i}`, n: chance(0.08) ? pick([0, -2, null, '7']) : pick([() => 1 + Math.round(rnd() * 500), () => round(rnd() * 20)])(), g: pick(['p', 'q', 'r']) }))
    const spec = { type: 'wordcloud', text: 'w', value: 'n', data }
    if (chance(0.4)) spec.series = 'g'
    if (chance(0.4)) spec.rotate = pick(['none', 'some', 'all'])
    if (chance(0.3)) spec.format = pick(['integer', 'compact', 'fixed:1'])
    return spec
  }
  const view = spec => {
    if (chance(0.5)) spec.projection = pick(['orthographic', 'perspective'])
    if (chance(0.5)) spec.camera = pick([() => ({ pitch: pick([0, 20, 30, 60, 90]), bearing: pick([-360, -30, 0, 35, 360]) }), () => ({ zoom: pick([0.5, 1, 2.5, 8]) }), () => ({ pitch: round(rnd() * 90, 10), bearing: round(rnd() * 720 - 360, 10), zoom: round(0.5 + rnd() * 7.5) })])()
    for (const k of ['xLabel', 'yLabel', 'zLabel']) if (chance(0.25)) spec[k] = pick(['Width (mm)', 'Depth', '台灣'])
    if (chance(0.3)) spec.format = pick(['integer', 'compact', 'fixed:2', 'percent'])
    return spec
  }
  const value = () => pick([() => Math.round(rnd() * 100), () => rnd() * 1000 - 300, () => round(rnd() * 1000, 1e4), () => 0.1 + 0.2, () => 1234567.891, () => 1e-11 * Math.round(rnd() * 99), () => -(1e-11 * Math.round(rnd() * 9)), () => 0, () => round(rnd() * 1e9, 1e-3), () => rnd() * 1e-6])()
  if (kind === 'scatter3d') {
    const data = rowsN(1 + Math.floor(rnd() * 12), i => ({ px: value(), py: value(), pz: chance(0.05) ? pick([null, 'n/a', '4']) : value(), g: pick(['p', 'q']), w: round(rnd() * 30), id: `p${i}` }))
    const spec = { type: 'scatter3d', x: 'px', y: 'py', z: 'pz', data }
    if (chance(0.4)) spec.series = 'g'
    if (chance(0.3)) spec.size = 'w'
    if (chance(0.3)) spec.label = 'id'
    if (chance(0.3)) spec.dropLines = chance(0.5)
    return view(spec)
  }
  const nx = 2 + Math.floor(rnd() * 5), ny = 2 + Math.floor(rnd() * 4)
  const x0 = pick([0, 0, -3.5, 0.1, 1e6]), dx = pick([1, 0.5, 0.1, 1000]), y0 = pick([0, 1, -20, 0.2]), dy = pick([1, 2.5, 0.1])
  const data = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let r = chance(0.05) ? 2 : chance(0.05) ? 0 : 1; r > 0; r--) data.push({ x: x0 + dx * i, y: y0 + dy * j, z: value() })
  if (chance(0.5)) data.sort(() => rnd() - 0.5)
  const spec = { type: 'surface', x: 'x', y: 'y', z: 'z', data }
  if (chance(0.3)) spec.mesh = chance(0.5)
  return view(spec)
}
const CLOUD_MAX = core.CLOUD_LIMITS.maxWords
const specOut = []
const SPECS = 5000
const AXES = 700, MORE = 500
const pool = [...rowsN(SPECS, () => makeSpec()), ...rowsN(AXES, () => axesSpec()), ...rowsN(MORE, () => moreSpec())]
for (let i = 0; i < pool.length + limitSpecs.length; i++) {
  // Through JSON, as a port receives it (an `undefined` value is an absent key).
  const spec = i < pool.length ? JSON.parse(JSON.stringify(pool[i])) : limitSpecs[i - pool.length]
  const v = core.validatePlot(spec)
  const d = core.describePlot(spec)
  specOut.push({ spec, ok: v.ok, issues: v.issues.map(x => [x.severity, x.code, x.path]), normalized: v.spec ? (({ data, ...r }) => r)(v.spec) : null, describe: d.ok ? d.text : null, ...(v.spec && spec.transform !== undefined ? { rows: v.spec.data } : {}) })
}
const specs = specOut

writeFileSync(target, JSON.stringify({ ...numeric, specs }))
const stats = { valid: specs.filter(c => c.ok).length, transforms: specs.filter(c => c.spec.transform !== undefined).length, transformed: specs.filter(c => c.rows).length }
const count = t => specs.filter(c => c.spec.type === t).length
const withStep = k => specs.filter(c => Array.isArray(c.spec.transform) && c.spec.transform.some(st => st && typeof st === 'object' && k in st)).length
const coded = code => specs.filter(c => c.issues.some(x => x[1] === code)).length
if (process.env.FUZZ_STATS) console.log(JSON.stringify({ gauge: count('gauge'), wordcloud: count('wordcloud'), scatter3d: count('scatter3d'), surface: count('surface'), validNew: specs.filter(c => c.ok && ['gauge', 'wordcloud', 'scatter3d', 'surface'].includes(c.spec.type)).length, yRight: specs.filter(c => 'yRight' in c.spec).length, yBreak: specs.filter(c => 'yBreak' in c.spec).length, index: withStep('index'), codes: Object.fromEntries(['dual_axis', 'dual_axis_refused', 'dual_axis_ignored', 'dual_axis_overlap', 'right_axis_unused', 'axis_break', 'break_misleading', 'break_hides_values', 'break_refused', 'break_outside', 'perspective_3d', 'index_group_dropped', 'max_derived', 'value_outside_range', 'bands_not_increasing', 'missing_cells', 'duplicate_cells', 'grid_too_small', 'grid_too_large', 'too_many_words', 'nonpositive_values', 'incomplete_rows', 'negative_skipped', 'too_many_gauges'].map(c => [c, coded(c)])) }))
console.log(`seed ${seed}: ${Object.values(numeric).reduce((n, l) => n + l.length, 0)} numeric cases, ${specs.length} specs (${stats.valid} valid; ${stats.transforms} with a transform, ${stats.transformed} of them valid)`)
