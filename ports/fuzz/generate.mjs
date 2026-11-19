// Differential fuzzing of the ports against the reference implementation.
//   node ports/fuzz/generate.mjs <seed> <out.json>
// Writes random numbers (formatting, ticks, bins, box statistics) and random specs of every chart type together
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
const numeric = { out, ticks, bins }

s = seed + 1
const pick = a => a[Math.floor(rnd() * a.length)]
const chance = p => rnd() < p
const words = ['alpha', 'Beta', 'gamma', 'δelta', '台灣', 'Other', 'a b', '', 'x'.repeat(45), '😀 smile', 'Q1', 'Q2']
const dates = ['2026-01-05', '2026-02-10', '2026-03-31', '2026-03-01T10:30:00Z', '2025-12-01', '2026-02-30', '2024-02-29', '2026-07']
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
for (let i = 0; i < 4000 + limitSpecs.length; i++) {
  const spec = i < 4000 ? makeSpec() : limitSpecs[i - 4000]
  const v = core.validatePlot(spec)
  const d = core.describePlot(spec)
  specOut.push({ spec, ok: v.ok, issues: v.issues.map(x => [x.severity, x.code, x.path]), normalized: v.spec ? (({ data, ...r }) => r)(v.spec) : null, describe: d.ok ? d.text : null })
}
const specs = specOut

writeFileSync(target, JSON.stringify({ ...numeric, specs }))
console.log(`seed ${seed}: ${numeric.out.length + numeric.ticks.length + numeric.bins.length} numeric cases, ${specs.length} specs`)
