// Writes conformance/plot.v1.json: language-neutral cases another implementation (Go, Python, Rust, ...) must reproduce.
//   node scripts/export-conformance.mjs           write
//   node scripts/export-conformance.mjs --check   fail when the file is out of date
// Reads the built core (run `npm run build` first).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href)
const { linearTicks, niceDomain, quantile, boxStats, binEdges, binCounts, kde, silverman, densityPeaks, validatePlot, describePlot, chartCatalog, getChart, chartTypes, COMMON_FIELDS, CARTESIAN_FIELDS, LIMITS } = core
const { registerGeography, unregisterGeography, getGeography, matchRegion, GeographyError, GEO_LIMITS, CAMERA_LIMITS } = core

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

// Violin densities: Silverman's bandwidth, the grid (its size included) and the Gaussian sum, and the peaks.
const densityIn = [
  { values: [1, 2, 2, 3, 3, 3, 4, 4, 5, 9] },
  { values: [1, 2, 2, 3, 3, 3, 4, 4, 5, 9], bandwidth: 0.5 },
  { values: [5, 5, 5, 5, 5, 5, 5, 9] },
  { values: [10, 10.4, 10.8, 11.2, 30, 30.4, 30.8, 31.2, 10.2, 30.6] },
  { values: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 100] },
  { values: [4, 4, 4] },
  { values: [7] }
]
const density = densityIn.map(c => { const d = kde(c.values, c.bandwidth); return { in: c, out: { silverman: silverman(c.values), ...d, peaks: densityPeaks(d) } } })
const { logTicks, niceLogDomain, loess, transformBinEdges } = core
const logTickCases = [[1, 1e6, 5], [1, 1000, 8], [1, 100, 8], [0.01, 1, 9], [20, 80, 5], [3, 800, 4], [0.5, 2e9, 6], [1e-6, 1e-3, 3]].map(([a, b, n]) => ({ in: [a, b, n], out: logTicks(a, b, n) }))
const logNiceCases = [[3, 800], [10, 10], [1, 1000], [0.02, 0.5], [7, 7.5]].map(([a, b]) => ({ in: [a, b], out: niceLogDomain(a, b) }))
const loessXs = [5, 1, 3, 2, 4, 8, 6, 7, 9, 10]
const loessYs = [2, 9, 4, 7, 3, 6, 1, 8, 5, 2]
const loessCases = [
  { xs: loessXs, ys: loessYs, bandwidth: 0.5, grid: 10 },
  { xs: loessXs, ys: loessYs, bandwidth: 0.3, grid: 50 },
  { xs: loessXs, ys: loessYs, bandwidth: 1, grid: 7 },
  { xs: [1, 1, 1, 2, 2, 3], ys: [1, 2, 3, 4, 5, 6], bandwidth: 0.3, grid: 5 },
  { xs: [4, 4, 4], ys: [1, 2, 6], bandwidth: 0.3, grid: 50 },
  { xs: [1, 2], ys: [1, 2], bandwidth: 0.3, grid: 50 },
  { xs: Array.from({ length: 25 }, (_, i) => i * 0.4), ys: Array.from({ length: 25 }, (_, i) => Math.sin(i * 0.4) * 10), bandwidth: 0.2, grid: 12 }
].map(c => ({ in: c, out: loess(c.xs, c.ys, c.bandwidth, c.grid) }))
const binStepCases = [{ values: [0, 13], maxbins: 10 }, { values: [1, 2, 2, 3, 9], maxbins: 4 }, { values: [0.1, 0.66], maxbins: 3 }, { values: [5, 5], maxbins: 10 }, { values: [0, 97], maxbins: 10, step: 7 }].map(c => ({ in: c, out: transformBinEdges(c.values, c.maxbins, c.step) }))

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

// ---- maps ------------------------------------------------------------------------------------------------
// Invented boundaries (squares in the open sea), so no case makes a political claim.
const sq = (x, y, s = 1) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]
const feat = (id, name, ring, props = {}) => ({ type: 'Feature', ...(id === undefined ? {} : { id }), properties: { ...(name === undefined ? {} : { name }), ...props }, geometry: { type: 'Polygon', coordinates: [ring] } })
const FC = (...features) => ({ type: 'FeatureCollection', features })
const G3 = FC(feat('N', 'North', sq(0, 2)), feat('S', 'South', sq(0, 0)), feat('E', 'East Isle', sq(2, 0)))
// Two squares, delta-encoded: `zones` (the first object, though not the first in the alphabet) and `areas`.
const TOPO = {
  type: 'Topology',
  transform: { scale: [0.5, 0.5], translate: [10, 20] },
  arcs: [[[0, 0], [2, 0], [0, 2], [-2, 0], [0, -2]], [[4, 0], [2, 0], [0, 2], [-2, 0], [0, -2]]],
  objects: {
    zones: { type: 'GeometryCollection', geometries: [
      { type: 'Polygon', id: 'A', properties: { name: 'Alpha' }, arcs: [[0]] },
      { type: 'MultiPolygon', id: 'B', properties: { name: 'Beta' }, arcs: [[[-2]]] },
      { type: 'Point', id: 'P', coordinates: [1, 1] }
    ] },
    areas: { type: 'Polygon', id: 'Z', properties: { name: 'Zed' }, arcs: [[1]] }
  }
}

// Geographies every implementation registers (by `name`, with `options`) before it replays the cases below.
// `options` holds property names only (`key`, `name`, `disputed`), `object`, `aliases` and `attribution`.
const GEOGRAPHIES = [
  { name: 'conf-islands', data: G3, options: { aliases: { 'the north': 'N', 'Eastern  Island': 'E' }, attribution: 'Invented' } },
  { name: 'conf-zones', data: TOPO, options: {} }
]
for (const g of GEOGRAPHIES) registerGeography(g.name, g.data, g.options)

// Reading a geography: `registerGeography(name, data, options | preset)`. The contract is whether it is accepted,
// the set of (severity, code, path), the regions (key, name, disputed) in order, and what the probes match.
const PROBES = ['N', ' north ', 'NORTH', 'East  Isle', 'east\tisle', 'the North', 'eastern island', 'West', '', null, 7, 'i̇stanbul', 'İSTANBUL', 'οδός', 'ΟΔΌΣ', 'οδόσ', 'Alpha', 'b', 'zed']
const bad25 = Array.from({ length: 25 }, (_, i) => feat(`r${i}`, `R${i}`, [[i, 0], [i + 1, 0], [i, 100]]))
const GEOGRAPHY = [
  ['geojson: ok', G3],
  ['geojson: JSON text', JSON.stringify(G3)],
  ['geojson: broken JSON text', '{"type":"FeatureCollection",'],
  ['geojson: not an object', [1, 2]],
  ['geojson: invalid name', G3, {}, 'not a name!'],
  ['geojson: key, name and disputed properties', FC(feat('x', 'ignored', sq(0, 0), { code: 'AA', label: 'First', contested: true }), feat('y', 'ignored', sq(2, 0), { code: 'BB', contested: 'yes' })), { key: 'code', name: 'label', disputed: 'contested' }],
  ['geojson: key property missing', FC(feat('x', 'One', sq(0, 0), { code: 'AA' }), feat('y', 'Two', sq(2, 0))), { key: 'code' }],
  ['geojson: aliases, one points nowhere', G3, { aliases: { Nord: 'N', Nowhere: 'X', 'south': 'E' } }],
  ['geojson: duplicate keys are merged', FC(feat('N', 'North', sq(0, 2)), feat('N', 'North again', sq(4, 4)), feat('S', 'South', sq(0, 0)))],
  ['geojson: key from properties.id, then properties.name', FC(feat(undefined, 'Named', sq(0, 0)), feat(undefined, 'Has id', sq(2, 0), { id: 'pid' }), feat(null, undefined, sq(4, 0)), feat('', 'Empty id', sq(6, 0)))],
  ['geojson: numeric ids, trimmed and long names', FC(feat(7, '  Seven  ', sq(0, 0)), feat(2.5, 'N'.repeat(130), sq(2, 0)), feat(1e21, 12, sq(4, 0)), feat(true, 'Bool id', sq(6, 0)))],
  ['geojson: names that collide with keys', FC(feat('a', 'B', sq(0, 0)), feat('b', 'A', sq(2, 0)), feat('C', 'c', sq(4, 0)), feat('c', 'lower', sq(6, 0)))],
  ['geojson: case mapping of İ and final sigma', FC(feat('TR', 'İstanbul', sq(0, 0)), feat('GR', 'ΟΔΌΣ', sq(2, 0)))],
  ['geojson: points and missing geometry are skipped', FC(feat('N', 'North', sq(0, 2)), { type: 'Feature', id: 'P', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }, { type: 'Feature', id: 'Q', properties: {}, geometry: null }, { type: 'Feature', id: 'L', properties: {} })],
  ['geojson: nothing usable', FC({ type: 'Feature', id: 'P', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } })],
  ['geojson: empty polygon is dropped', FC(feat('N', 'North', sq(0, 2)), { type: 'Feature', id: 'E', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [] } }, { type: 'Feature', id: 'F', properties: {}, geometry: { type: 'Polygon', coordinates: [] } })],
  ['geojson: multipolygon with a hole', FC({ type: 'Feature', id: 'M', properties: { name: 'Multi' }, geometry: { type: 'MultiPolygon', coordinates: [[sq(0, 0, 4), sq(1, 1)], [sq(10, 10)]] } })],
  ['geojson: unclosed ring is closed', FC(feat('T', 'Triangle', [[0, 0], [1, 0], [0, 1]]))],
  ['geojson: degenerate rings are skipped', FC(feat('N', 'North', sq(0, 2)), feat('H', 'Bad hole', [[0, 0], [1, 0]]), { type: 'Feature', id: 'O', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0]], [[0, 0], [1, 'unread']]], [sq(5, 5), [[5, 5], [6, 5]], sq(5.2, 5.2, 0.2)]] } })],
  ['geojson: only degenerate rings', FC(feat('T', 'Two points', [[0, 0], [1, 0]]), feat('U', 'Closed pair', [[0, 0], [1, 0], [0, 0]]), feat('V', 'Empty ring', []))],
  ['geojson: a bare Feature', feat('N', 'North', sq(0, 2))],
  ['geojson: no type', { features: [] }],
  ['geojson: features is not an array', { type: 'FeatureCollection', features: {} }],
  ['geojson: broken features', FC(5, { type: 'Thing' }, { type: 'Feature', geometry: 'x' }, { type: 'Feature', id: 'a', geometry: { type: 'Polygon', coordinates: 3 } }, { type: 'Feature', id: 'b', geometry: { type: 'Polygon', coordinates: [5] } }, { type: 'Feature', id: 'c', geometry: { type: 'MultiPolygon', coordinates: [[sq(0, 0)], 4] } }, { type: 'Feature', id: 'd', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, '2'], [1, 1]]]] } }, { type: 'Feature', id: 'e', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1], [1, 1]]] } }, feat('ok', 'Fine', sq(0, 0)))],
  ['geojson: projected and swapped coordinates', FC(feat('m', 'Metres', [[500000, 4649776], [500100, 4649776], [500100, 4649876]]), feat('s', 'Swapped', [[10, 95], [11, 95], [11, 96]]), feat('w', 'Wide but allowed', [[350, 0], [360, 0], [360, 10]]), feat('x', 'Too wide', [[361, 0], [362, 0], [362, 1]]))],
  ['geojson: errors stop at the limit', FC(feat(undefined, undefined, sq(0, 0)), ...bad25, { type: 'Feature', id: 'P', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } })],
  ['topojson: quantized, the first object', TOPO],
  ['topojson: object option', TOPO, { object: 'areas' }],
  ['topojson: unknown object', TOPO, { object: 'zone' }],
  ['topojson: array-index object names come first', { ...TOPO, objects: { zones: TOPO.objects.zones, 10: TOPO.objects.areas, 9: { type: 'Polygon', id: 'nine', arcs: [[0]] } } }],
  ['topojson: not quantized, arcs stitched and reversed', { type: 'Topology', arcs: [[[0, 0], [2, 0]], [[2, 0], [2, 2], [0, 2]], [[0, 0], [0, 2]], []], objects: { o: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 'sq', arcs: [[0, 1, -3]] }, { type: 'Polygon', id: 'open', arcs: [[3, 0, 1]] }, { type: null, id: 'n' }, { id: 'u' }] } } }],
  ['topojson: bad arc indexes', { type: 'Topology', arcs: [[[0, 0], [1, 0], [1, 1], [0, 0]]], objects: { o: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 'a', arcs: [[1]] }, { type: 'Polygon', id: 'b', arcs: [[-2]] }, { type: 'Polygon', id: 'c', arcs: [[0.5]] }, { type: 'Polygon', id: 'd', arcs: [['0']] }, { type: 'Polygon', id: 'e', arcs: [[]] }, { type: 'Polygon', id: 'f', arcs: 3 }, { type: 'MultiPolygon', id: 'g', arcs: 3 }, { type: 'MultiPolygon', id: 'h', arcs: [[[0]], 3] }, { type: 'Polygon', id: 'i', arcs: [[-4294967297]] }, { type: 'Polygon', id: 'j', arcs: [[-4294967296]] }, { type: 'Polygon', id: 'ok', arcs: [[-1]] }, 4, null] } } }],
  ['topojson: degenerate rings are skipped', { type: 'Topology', arcs: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0, 0], [1, 0]], []], objects: { o: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 'a', arcs: [[1], [9]] }, { type: 'Polygon', id: 'b', arcs: [[0], [2], [-1]] }, { type: 'MultiPolygon', id: 'c', arcs: [[[1]], [[0]]] }, { type: 'MultiPolygon', id: 'd', arcs: [[[2]]] }, { type: 'Polygon', id: 'e', arcs: [] }] } } }],
  ['topojson: bad transform', { ...TOPO, transform: { scale: [1, '1'], translate: [0, 0] } }],
  ['topojson: null transform', { ...TOPO, transform: null }],
  ['topojson: no objects', { type: 'Topology', arcs: [], objects: {} }],
  ['topojson: no arcs', { type: 'Topology', objects: TOPO.objects }],
  ['topojson: bad arcs', { type: 'Topology', arcs: [[[0, 0], [1, 0]], 7], objects: TOPO.objects }],
  ['topojson: bad arc position', { type: 'Topology', arcs: [[[0, 0], [1]]], objects: TOPO.objects }],
  ['topojson: decoded arc out of range', { ...TOPO, transform: { scale: [100, 100], translate: [0, 0] } }],
  ['topojson: geometries is not an array', { ...TOPO, objects: { o: { type: 'GeometryCollection' } } }],
  ['topojson: empty multipolygon is dropped', { ...TOPO, objects: { o: { type: 'GeometryCollection', geometries: [{ type: 'MultiPolygon', id: 'none', arcs: [] }, { type: 'Polygon', id: 'A', arcs: [[0]] }] } } }],
  ['preset: world-atlas', { ...TOPO, objects: { land: TOPO.objects.areas, countries: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: '004', properties: { name: 'First' }, arcs: [[0]] }, { type: 'Polygon', id: 8, properties: { name: 'Second' }, arcs: [[1]] }] } } }, 'world-atlas'],
  ['preset: natural-earth-admin0', FC(feat('f1', 'x', sq(0, 0), { ISO_A3: 'AAA', ADM0_A3: 'AA0', NAME: 'Aland', ADMIN: 'Admin A', TYPE: 'Sovereign country' }), feat('f2', 'x', sq(2, 0), { ISO_A3: '-99', ADM0_A3: 'BB0', NAME: null, ADMIN: 'Admin B', TYPE: 'Disputed' }), feat('f3', 'x', sq(4, 0), { ISO_A3: 5, ADM0_A3: 'CC0', TYPE: 'Indeterminate area' }), feat('f4', 'x', sq(6, 0), { NAME: 'No code' })), 'natural-earth-admin0'],
  ['preset: natural-earth-admin1', FC(feat('f1', 'One', sq(0, 0), { iso_3166_2: 'AA-01', adm1_code: 'AA-1' }), feat('f2', 'Two', sq(2, 0), { iso_3166_2: null, adm1_code: 'AA-2' }), feat('f3', 'Three', sq(4, 0), { iso_3166_2: '', adm1_code: 'AA-3' })), 'natural-earth-admin1'],
  ['preset: geoboundaries', FC(feat('f1', 'x', sq(0, 0), { shapeISO: 'AAA', shapeGroup: 'G1', shapeID: 'i1', shapeName: 'One' }), feat('f2', 'x', sq(2, 0), { shapeISO: '', shapeGroup: 'G2', shapeID: 'i2', shapeName: 'Two' }), feat('f3', 'x', sq(4, 0), { shapeISO: 0, shapeGroup: null, shapeID: 'i3' }), feat('f4', 'x', sq(6, 0), { shapeISO: [], shapeGroup: 'G4', shapeID: 'i4' })), 'geoboundaries']
].map(([name, data, options = {}, as = 'conf-case']) => {
  const pin = i => ({ severity: i.severity, code: i.code, path: i.path })
  const base = { name, as, data, ...(typeof options === 'string' ? { preset: options } : { options }) }
  try {
    const issues = registerGeography(as, data, options)
    const g = getGeography(as)
    const out = { ...base, ok: true, issues: issues.map(pin), regions: g.regions.map(x => ({ key: x.key, name: x.name, disputed: x.disputed })), matches: PROBES.map(p => [p, matchRegion(g, p) ?? null]) }
    unregisterGeography(as)
    return out
  } catch (e) {
    if (!(e instanceof GeographyError)) throw e
    return { ...base, ok: false, issues: e.issues.map(pin), regions: null, matches: null }
  }
})

const P = [{ place: 'Quay', lat: 3.4, lng: 1.2, n: 42, k: 'a' }, { place: 'Pier', lat: -2.1, lng: -3.3, n: 18, k: 'b' }]
const RV = [{ r: 'N', v: 10 }, { r: 'South', v: 4 }, { r: ' east  isle ', v: 7 }]
const FL = [{ a: 'N', b: 'S', n: 5 }, { a: 'S', b: 'East Isle', n: 2 }]
const FLL = [{ a: 'One', b: 'Two', alat: 1, alng: 2, blat: 3, blng: 4, n: 5 }, { a: 'Two', b: 'Three', alat: 3, alng: 4, blat: -5, blng: 6, n: 9 }]
const fll = { fromLat: 'alat', fromLng: 'alng', toLat: 'blat', toLng: 'blng' }
const MAP_VALIDATION = [
  ['map: unknown geography name', { type: 'choropleth', geo: 'nowhere-registered', region: 'r', value: 'v', data: RV }],
  ['map: geography name close to a registered one', { type: 'choropleth', geo: 'conf-island', region: 'r', value: 'v', data: RV }],
  ['map: empty geography name', { type: 'choropleth', geo: '', region: 'r', value: 'v', data: RV }],
  ['map: geo is a number', { type: 'choropleth', geo: 5, region: 'r', value: 'v', data: RV }],
  ['map: geo is an array', { type: 'bubble-map', geo: [G3], lat: 'lat', lng: 'lng', data: P }],
  ['map: geo is null', { type: 'bubble-map', geo: null, lat: 'lat', lng: 'lng', data: P }],
  ['map: choropleth without geo', { type: 'choropleth', region: 'r', value: 'v', data: RV }],
  ['map: registered geography, matched by key, name and spacing', { type: 'choropleth', geo: 'conf-islands', region: 'r', value: 'v', data: RV }],
  ['map: registered geography, matched by alias', { type: 'choropleth', geo: 'conf-islands', region: 'r', value: 'v', data: [{ r: 'The North', v: 1 }, { r: 'eastern island', v: 2 }] }],
  ['map: registered TopoJSON geography', { type: 'choropleth', geo: 'conf-zones', region: 'r', value: 'v', extrude: true, view: 'globe', data: [{ r: 'alpha', v: 1 }, { r: 'B', v: 2 }] }],
  ['map: camera ok', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: { lng: 121, lat: 24, zoom: 2, pitch: 30, bearing: -45 }, data: P }],
  ['map: camera empty', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: {}, data: P }],
  ['map: camera at the limits', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: { lng: -180, lat: 90, zoom: 0.5, pitch: 70, bearing: 360 }, data: P }],
  ['map: bad camera field', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: { lon: 121, lat: 24, tilt: 3 }, data: P }],
  ['map: camera is not an object', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: [121, 24], data: P }],
  ['map: camera is a string', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: 'north', data: P }],
  ['map: camera value is not a number', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: { lng: '121', lat: null, zoom: true }, data: P }],
  ['map: camera out of range', { type: 'bubble-map', lat: 'lat', lng: 'lng', camera: { lng: 181, lat: -91, zoom: 0.4, pitch: 71, bearing: 400 }, data: P }],
  ['map: bad projection, view and disputed', { type: 'bubble-map', lat: 'lat', lng: 'lng', projection: 'mercatr', view: 'sphere', disputed: 'hidden', graticule: 'yes', data: P }],
  ['map: lat column out of range', { type: 'bubble-map', lat: 'lat', lng: 'lng', data: [{ lat: 120, lng: 20 }, { lat: -95.5, lng: 30 }] }],
  ['map: lng column out of range', { type: 'bubble-map', lat: 'lat', lng: 'lng', data: [{ lat: 12, lng: 200 }, { lat: -5, lng: '181' }] }],
  ['map: some lat and lng values out of range', { type: 'bubble-map', lat: 'lat', lng: 'lng', data: [{ lat: 120, lng: 20 }, { lat: 45, lng: 300 }, { lat: 90, lng: -180 }, { lat: 'n/a', lng: '' }, { lat: null, lng: 5 }] }],
  ['map: lat and lng swapped (projected metres)', { type: 'column-map', lat: 'y', lng: 'x', value: 'v', data: [{ x: 500000, y: 4649776, v: 1 }] }],
  ['map: lat column is not numeric', { type: 'bubble-map', lat: 'place', lng: 'lng', data: P }],
  ['map: lat column does not exist', { type: 'bubble-map', lat: 'latitude', lng: 'lng', data: P }],
  ['choropleth: region not found in geography (some)', { type: 'choropleth', geo: G3, region: 'r', value: 'v', data: [...RV, { r: 'Nroth', v: 1 }, { r: 'Atlantis', v: 2 }, { r: null, v: 3 }, { r: '', v: 3 }] }],
  ['choropleth: region not found in geography (none)', { type: 'choropleth', geo: G3, region: 'r', value: 'v', data: [{ r: 'Atlantis', v: 2 }, { r: 'Lemuria', v: 3 }] }],
  ['choropleth: region not found in a registered geography', { type: 'choropleth', geo: 'conf-islands', region: 'r', value: 'v', data: [{ r: 'Atlantis', v: 2 }] }],
  ['choropleth: region values that are not strings', { type: 'choropleth', geo: FC(feat(7, 'Seven', sq(0, 0)), feat('true', 'Yes', sq(2, 0)), feat('1,2', 'List', sq(4, 0))), region: 'r', value: 'v', data: [{ r: 7, v: 1 }, { r: true, v: 2 }, { r: [1, 2], v: 3 }, { r: { a: 1 }, v: 4 }] }],
  ['choropleth: no row has a region and a value', { type: 'choropleth', geo: G3, region: 'r', value: 'v', data: [{ r: 'N', v: null }, { r: null, v: 3 }, { r: '', v: 4 }] }],
  ['choropleth: TopoJSON inline geography', { type: 'choropleth', geo: TOPO, region: 'r', value: 'v', data: [{ r: 'A', v: 1 }, { r: 'beta', v: 2 }, { r: 'Zed', v: 3 }] }],
  ['choropleth: TopoJSON inline, broken', { type: 'choropleth', geo: { ...TOPO, arcs: [TOPO.arcs[0]] }, region: 'r', value: 'v', data: [{ r: 'A', v: 1 }] }],
  ['choropleth: duplicate region keys', { type: 'choropleth', geo: FC(feat('N', 'North', sq(0, 2)), feat('N', 'North again', sq(4, 4)), feat('S', 'South', sq(0, 0))), region: 'r', value: 'v', data: [{ r: 'north', v: 1 }, { r: 'North again', v: 2 }, { r: 'S', v: 3 }] }],
  ['choropleth: inline geography with skipped features', { type: 'choropleth', geo: FC(feat('N', 'North', sq(0, 2)), feat(undefined, undefined, sq(0, 0)), { type: 'Feature', id: 'P', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }), region: 'r', value: 'v', data: [{ r: 'N', v: 1 }] }],
  ['choropleth: inline geography with broken rings', { type: 'choropleth', geo: FC(feat('N', 'North', [[0, 0], [1, 0]]), feat('S', 'South', [[0, 0], [1, 0], [1, 100]]), feat('E', 'East', sq(2, 0))), region: 'r', value: 'v', data: RV }],
  ['choropleth: inline geography with a degenerate ring', { type: 'choropleth', geo: FC(feat('N', 'North', [[0, 0], [1, 0]]), feat('S', 'South', sq(0, 0)), feat('E', 'East Isle', sq(2, 0))), region: 'r', value: 'v', data: RV }],
  ['choropleth: inline geography is a bare Feature', { type: 'choropleth', geo: feat('N', 'North', sq(0, 2)), region: 'r', value: 'v', data: RV }],
  ['choropleth: inline geography with nothing usable', { type: 'choropleth', geo: FC(), region: 'r', value: 'v', data: RV }],
  ['choropleth: ok with every map field', { type: 'choropleth', geo: G3, region: 'r', value: 'v', view: 'globe', scale: 'diverging', domain: [0, 10], extrude: true, projection: 'mercator', disputed: 'muted', graticule: false, camera: { zoom: 2 }, data: RV }],
  ['bubble-map: ok by lat and lng', { type: 'bubble-map', lat: 'lat', lng: 'lng', size: 'n', series: 'k', label: 'place', data: P }],
  ['bubble-map: ok by region', { type: 'bubble-map', geo: G3, region: 'r', size: 'v', data: RV }],
  ['bubble-map: lat without lng', { type: 'bubble-map', lat: 'lat', data: P }],
  ['bubble-map: lng without lat', { type: 'bubble-map', lng: 'lng', data: P }],
  ['bubble-map: no place fields', { type: 'bubble-map', size: 'n', data: P }],
  ['bubble-map: region without a geography', { type: 'bubble-map', region: 'place', data: P }],
  ['bubble-map: lat and lng win over an unmatched region', { type: 'bubble-map', geo: G3, region: 'place', lat: 'lat', lng: 'lng', data: P }],
  ['bubble-map: regions unmatched', { type: 'bubble-map', geo: G3, region: 'place', data: P }],
  ['bubble-map: some regions unmatched', { type: 'bubble-map', geo: G3, region: 'r', data: [...RV, { r: 'Atlantis', v: 1 }] }],
  ['bubble-map: no usable points', { type: 'bubble-map', lat: 'lat', lng: 'lng', size: 'n', data: [{ lat: 1, lng: 2, n: -4 }, { lat: 100, lng: 2, n: 3 }, { lat: 5, lng: 6, n: 'big' }, { lat: 5, lng: null, n: 1 }] }],
  ['column-map: ok', { type: 'column-map', lat: 'lat', lng: 'lng', value: 'n', data: P }],
  ['column-map: negative values', { type: 'column-map', lat: 'lat', lng: 'lng', value: 'n', data: [...P, { lat: 1, lng: 1, n: -3 }, { lat: 2, lng: 2, n: '-4' }] }],
  ['column-map: missing value', { type: 'column-map', lat: 'lat', lng: 'lng', data: P }],
  ['column-map: by region, some unmatched', { type: 'column-map', geo: 'conf-islands', region: 'r', value: 'v', view: 'flat', data: [...RV, { r: 'Atlantis', v: -1 }] }],
  ['column-map: no place fields', { type: 'column-map', value: 'n', data: P }],
  ['flow-map: ok by lat and lng', { type: 'flow-map', ...fll, from: 'a', to: 'b', value: 'n', data: FLL }],
  ['flow-map: ok by regions', { type: 'flow-map', geo: G3, from: 'a', to: 'b', value: 'n', data: FL }],
  ['flow-map: three of four coordinates', { type: 'flow-map', fromLat: 'alat', fromLng: 'alng', toLng: 'blng', data: FLL }],
  ['flow-map: one coordinate', { type: 'flow-map', toLng: 'blng', from: 'a', to: 'b', data: FLL }],
  ['flow-map: nothing given', { type: 'flow-map', data: FL }],
  ['flow-map: from without to', { type: 'flow-map', geo: G3, from: 'a', data: FL }],
  ['flow-map: to without from', { type: 'flow-map', geo: G3, to: 'b', data: FL }],
  ['flow-map: regions without a geography', { type: 'flow-map', from: 'a', to: 'b', data: FL }],
  ['flow-map: regions unmatched on both ends', { type: 'flow-map', geo: G3, from: 'a', to: 'b', data: [...FL, { a: 'Atlantis', b: 'N', n: 1 }, { a: 'N', b: 'Lemuria', n: 1 }] }],
  ['flow-map: no destination matches', { type: 'flow-map', geo: G3, from: 'a', to: 'b', data: [{ a: 'N', b: 'Lemuria', n: 1 }] }],
  ['flow-map: no usable flows', { type: 'flow-map', ...fll, value: 'n', data: [{ alat: 1, alng: 2, blat: 3, blng: 4, n: -1 }, { alat: 1, alng: 2, blat: 99, blng: 4, n: 5 }, { alat: 1, alng: 2, blat: 3, blng: null, n: 5 }] }]
]

// Validation cases. The contract is the set of (severity, code, path); order and message text are not.
// Fields added after the first release: textures, small multiples, zoom and brush, combo bars, density, and
// ranges given as ISO dates (normalised to epoch milliseconds).
const W = [{ d: '2026-01-05', k: 'a', g: 'p', v: 3, t: 5, w: 'n/a' }, { d: '2026-02-09', k: 'b', g: 'q', v: 8, t: 5, w: 4 }, { d: '2026-03-16', k: 'c', g: 'p', v: 6, t: '7', w: '' }]
const bars = extra => ({ type: 'bar', x: 'k', y: 'v', data: W, ...extra })
const lines = extra => ({ type: 'line', x: 'd', y: 'v', data: W, ...extra })
const FEATURE_VALIDATION = [
  ['patterns: on', bars({ patterns: true })],
  ['patterns: off, on a pie', { type: 'pie', label: 'k', value: 'v', patterns: false, data: W }],
  ['patterns: not a boolean', bars({ patterns: 'yes' })],
  ['facet: a column', bars({ facet: 'g' })],
  ['facet: no such column', bars({ facet: 'group' })],
  ['facet: not a string', lines({ facet: ['g'] })],
  ['facet: not on a pie', { type: 'pie', label: 'k', value: 'v', facet: 'g', data: W }],
  ['zoom: x on a line', lines({ zoom: 'x' })],
  ['zoom: xy on a scatter', { type: 'scatter', x: 'v', y: 't', zoom: 'xy', brush: 'xy', data: W }],
  ['zoom: accepted on a bar (ignored when drawn)', bars({ zoom: 'x', brush: 'x', facet: 'g' })],
  ['zoom: bad value', lines({ zoom: 'both' })],
  ['zoom: not on a radar', { type: 'radar', x: 'k', y: 'v', zoom: 'x', data: W }],
  ['brush: none', { type: 'histogram', value: 'v', brush: 'none', zoom: 'none', data: W }],
  ['brush: bad value', { type: 'box', y: 'v', brush: true, data: W }],
  ['bar line: one column', bars({ line: 't' })],
  ['bar line: a list', bars({ line: ['t', 'v'] })],
  ['bar line: no such column', bars({ line: ['t', 'target'] })],
  ['bar line: not numeric', bars({ line: 'k' })],
  ['bar line: partly numeric', bars({ line: 'w' })],
  ['bar line: empty list', bars({ line: [] })],
  ['bar line: ignored when horizontal', bars({ line: 't', orientation: 'horizontal' })],
  ['bar line: ignored when stacked to 100%', bars({ line: ['t'], stack: 'normalize', y: ['v', 't'] })],
  ['bar line: kept when stacked', bars({ line: 't', stack: 'stack' })],
  ['bar line: not on a line chart', lines({ line: 't' })],
  ['density: hex', { type: 'scatter', x: 'v', y: 't', density: 'hex', series: 'g', data: W }],
  ['density: auto', { type: 'scatter', x: 'v', y: 't', density: 'auto', data: W }],
  ['density: bad value', { type: 'scatter', x: 'v', y: 't', density: 'hexagons', data: W }],
  ['domain: ISO dates on x', lines({ xDomain: ['2026-01-01', '2026-06-30'] })],
  ['domain: ISO date and time, with offset', lines({ xDomain: ['2026-01-01T08:00:00+08:00', '2026-01-01 12:30'] })],
  ['domain: open end, month only', { type: 'area', x: 'd', y: 'v', xDomain: [null, '2026-07'], data: W }],
  ['domain: a number and a date', { type: 'scatter', x: 'd', y: 'v', xDomain: [0, '2026-06-30'], yDomain: [0, 10], data: W }],
  ['domain: numbers still pass', lines({ xDomain: [1, 2], yDomain: [null, null] })],
  ['time x: numbers at and past what a Date holds', { type: 'line', x: 'd', y: 'v', xType: 'time', xDomain: [-8.64e15, 8.64e15], data: [{ d: 1e16, v: 1 }, { d: -8.64e15 - 1, v: 2 }, { d: 8.64e15, v: 3 }, { d: -8.64e15, v: 5 }] }],
  ['time x: bars over numbers past what a Date holds', { type: 'bar', x: 'd', y: 'v', data: [{ d: 1e16, v: 1 }, { d: -1e16, v: 2 }] }],
  ['time x: a scatter with nothing left to place', { type: 'scatter', x: 'd', y: 'v', xType: 'time', data: [{ d: 1e16, v: 1 }, { d: -1e16, v: 2 }] }],
  ['domain: not a date', lines({ xDomain: ['tomorrow', '2026-06-30'] })],
  ['domain: impossible date', lines({ xDomain: ['2026-02-30', '2026-06-30'] })],
  ['domain: numeric string is not a number', lines({ yDomain: ['5', 10] })],
  ['domain: dates in the wrong order', lines({ xDomain: ['2026-06-30', '2026-01-01'] })],
  ['domain: equal dates', lines({ xDomain: ['2026-06-30', '2026-06-30T00:00:00Z'] })],
  ['domain: three values', lines({ xDomain: ['2026-01-01', '2026-06-30', '2026-12-31'] })],
  ['domain: ISO on a value axis', bars({ yDomain: ['1970-01-01', '1970-01-02'] })],
  ['domain: xDomain is not a bar field', bars({ xDomain: [0, 1] })],
  // Round 5: log scales, intervals, point annotations, gaps, loess trends, lollipops.
  ['log: y on a line', lines({ yScale: 'log' })],
  ['log: y on a line, some values at or below zero', { type: 'line', x: 'x', y: 'v', yScale: 'log', data: [{ x: 1, v: 10 }, { x: 2, v: 0 }, { x: 3, v: -5 }, { x: 4, v: 1000 }] }],
  ['log: every value at or below zero', { type: 'scatter', x: 'v', y: 't', yScale: 'log', data: [{ v: 1, t: 0 }, { v: 2, t: -1 }] }],
  ['log: x and y on a scatter', { type: 'scatter', x: 'v', y: 't', xScale: 'log', yScale: 'log', data: W }],
  ['log: x on a line over dates is refused', lines({ xScale: 'log' })],
  ['log: x on a scatter over dates is refused', { type: 'scatter', x: 'd', y: 'v', xScale: 'log', data: W }],
  ['log: a domain at zero', lines({ yScale: 'log', yDomain: [0, 10] })],
  ['log: refused on a bar', bars({ yScale: 'log' })],
  ['log: linear accepted on a bar', bars({ yScale: 'linear' })],
  ['log: refused on an area', { type: 'area', x: 'd', y: 'v', yScale: 'log', data: W }],
  ['log: refused on a histogram', { type: 'histogram', value: 'v', yScale: 'log', data: W }],
  ['log: bad value', lines({ yScale: 'log2' })],
  ['log: gaps zero on a log axis', lines({ yScale: 'log', gaps: 'zero' })],
  ['interval: band on a line', lines({ yLower: 'v', yUpper: 't' })],
  ['interval: lower only', lines({ yLower: 'v' })],
  ['interval: upper only on a scatter', { type: 'scatter', x: 'v', y: 't', xUpper: 't', data: W }],
  ['interval: several y columns', lines({ y: ['v', 't'], yLower: 'v', yUpper: 't' })],
  ['interval: on a stacked area', { type: 'area', x: 'd', y: 'v', series: 'g', stack: 'stack', yLower: 'v', yUpper: 't', data: W }],
  ['interval: whiskers on grouped bars', bars({ yLower: 'v', yUpper: 't' })],
  ['interval: whiskers on stacked bars', bars({ stack: 'stack', yLower: 'v', yUpper: 't' })],
  ['interval: ends swapped', { type: 'scatter', x: 'v', y: 't', yLower: 't', yUpper: 'v', data: [{ v: 1, t: 5 }, { v: 2, t: 1 }] }],
  ['interval: not numeric', lines({ yLower: 'k', yUpper: 't' })],
  ['interval: no such column', lines({ yLower: 'low', yUpper: 't' })],
  ['annotation: a point', lines({ annotations: [{ x: '2026-02-09', y: 8, label: 'Peak', tone: 'positive' }] })],
  ['annotation: a point with a category', bars({ annotations: [{ x: 'b', y: 8, label: 'Best' }, { axis: 'y', value: 5, label: 'Target' }] })],
  ['annotation: a point without label', lines({ annotations: [{ x: '2026-02-09', y: 8 }] })],
  ['annotation: a point without y', lines({ annotations: [{ x: '2026-02-09', label: 'Peak' }] })],
  ['annotation: a point with a bad x', lines({ annotations: [{ x: null, y: 8, label: 'Peak' }] })],
  ['annotation: a point with a line field', lines({ annotations: [{ x: 1, y: 8, label: 'Peak', to: 3 }] })],
  ['annotation: a line with a point field', lines({ annotations: [{ axis: 'y', value: 8, y: 3 }] })],
  ['gaps: connect', lines({ gaps: 'connect' })],
  ['gaps: zero on an area', { type: 'area', x: 'd', y: 'v', gaps: 'zero', data: W }],
  ['gaps: bad value', lines({ gaps: 'skip' })],
  ['gaps: not on a bar', bars({ gaps: 'connect' })],
  ['trend: loess', { type: 'scatter', x: 'v', y: 't', trend: 'loess', trendBandwidth: 0.5, data: W }],
  ['trend: bandwidth without loess', { type: 'scatter', x: 'v', y: 't', trendBandwidth: 0.5, data: W }],
  ['trend: bandwidth out of range', { type: 'scatter', x: 'v', y: 't', trend: 'loess', trendBandwidth: 2, data: W }],
  ['mark: lollipop', bars({ mark: 'lollipop', labels: true })],
  ['mark: lollipop stacked', bars({ mark: 'lollipop', stack: 'normalize', y: ['v', 't'] })],
  ['mark: bad value', bars({ mark: 'dot' })]
]

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
  ['box: points all', { type: 'box', y: 'b', points: 'all', data: B }],
  ['box: points with outliers false', { type: 'box', y: 'b', points: 'outliers', outliers: false, data: B }],
  ['box: patterns', { type: 'box', y: 'b', patterns: true, data: B }],
  ['violin: ok', { type: 'violin', x: 'a', y: 'b', data: rowsOf(12, i => ({ a: i % 2 ? 'p' : 'q', b: i * 1.5 })) }],
  ['violin: bandwidth zero, few values', { type: 'violin', y: 'b', bandwidth: 0, data: B }],
  ['violin: bad inner', { type: 'violin', y: 'b', inner: 'boxes', data: B }],
  ['calendar: ok', { type: 'calendar', x: 'd', value: 'b', data: [{ d: '2026-01-01', b: 1 }, { d: 1767312000000, b: 2 }] }],
  ['calendar: no dates', { type: 'calendar', x: 'a', value: 'b', data: B }],
  ['calendar: some not dates, too many years', { type: 'calendar', x: 'd', value: 'b', weekStart: 'sunday', data: [...rowsOf(7, i => ({ d: `${2018 + i}-05-05`, b: i })), { d: 'soon', b: 1 }] }],
  ['calendar: bad weekStart', { type: 'calendar', x: 'd', value: 'b', weekStart: 'saturday', data: [{ d: '2026-01-01', b: 1 }] }],
  ['sunburst: ok', { type: 'sunburst', path: ['a', 'c'], value: 'b', data: [{ a: 'x', c: 'y', b: 1 }, { a: 'x', c: 'z', b: 2 }] }],
  ['sunburst: one column as a string', { type: 'sunburst', path: 'a', value: 'b', data: B }],
  ['sunburst: duplicate level, skipped values', { type: 'sunburst', path: ['a', 'a'], value: 'b', data: [{ a: 'x', b: 1 }, { a: 'y', b: -1 }] }],
  ['sunburst: too many levels', { type: 'sunburst', path: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], value: 'v', data: [{ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, v: 1 }] }],
  ['sunburst: empty path', { type: 'sunburst', path: [], value: 'b', data: B }],
  ['parallel: ok', { type: 'parallel', dimensions: ['b', 'c'], series: 'a', data: [{ a: 'x', b: 1, c: 2 }, { a: 'y', b: 3, c: 1 }] }],
  ['parallel: one dimension', { type: 'parallel', dimensions: ['b'], data: B }],
  ['parallel: a single string', { type: 'parallel', dimensions: 'b', data: B }],
  ['parallel: thirteen dimensions', { type: 'parallel', dimensions: rowsOf(13, i => `c${i}`), data: [Object.fromEntries(rowsOf(13, i => [`c${i}`, i]))] }],
  ['parallel: incomplete rows, duplicate, patterns', { type: 'parallel', dimensions: ['b', 'c', 'b'], patterns: true, data: [{ b: 1, c: 2 }, { b: 2 }] }],
  ['parallel: sampled', { type: 'parallel', dimensions: ['b', 'c'], data: rowsOf(2001, i => ({ b: i, c: i % 7 })) }],
  ['sankey: too many flows', { type: 'sankey', from: 'a', to: 'c', value: 'b', data: rowsOf(301, i => ({ a: `s${i % 20}`, c: `t${Math.floor(i / 20)}`, b: 1 })) }],
  ['waterfall: total column and list', { type: 'waterfall', x: 'a', y: 'b', total: 't', data: [{ a: 'x', b: 1, t: 'Yes' }, { a: 'y', b: 2, t: 0 }] }],
  ['waterfall: total list with a typo and a number', { type: 'waterfall', x: 'a', y: 'b', total: ['y', 'xx', 3], data: B }],
  ['waterfall: total list is empty', { type: 'waterfall', x: 'a', y: 'b', total: [], data: B }],
  ['waterfall: total list has an object', { type: 'waterfall', x: 'a', y: 'b', total: ['x', {}], data: B }],
  ['waterfall: total column missing', { type: 'waterfall', x: 'a', y: 'b', total: 'tt', data: B }],
  ['waterfall: total column never says yes', { type: 'waterfall', x: 'a', y: 'b', total: 'a', data: B }],
  ['waterfall: reported total differs', { type: 'waterfall', x: 'a', y: 'b', total: ['z'], start: 5, data: [...B, { a: 'z', b: 10 }] }],
  ['waterfall: repeated steps', { type: 'waterfall', x: 'a', y: 'b', data: [...B, { a: 'x', b: 4 }] }],
  ['waterfall: nothing to draw', { type: 'waterfall', x: 'a', y: 'b', data: [{ a: 'x', b: null, c: 1 }] }],
  ['funnel: ok', { type: 'funnel', stage: 'a', value: 'b', data: [{ a: 'x', b: 9 }, { a: 'y', b: 4 }] }],
  ['funnel: rises, negative, repeated', { type: 'funnel', stage: 'a', value: 'b', data: [{ a: 'x', b: 2 }, { a: 'y', b: 5 }, { a: 'z', b: -1 }, { a: 'x', b: 1 }] }],
  ['funnel: too many stages', { type: 'funnel', stage: 'a', value: 'b', data: rowsOf(41, i => ({ a: `s${i}`, b: 100 - i })) }],
  ['funnel: zoom is not a funnel field', { type: 'funnel', stage: 'a', value: 'b', zoom: 'x', data: B }],
  ['bullet: ok', { type: 'bullet', x: 'a', value: 'b', target: 'c', ranges: ['p', 'q'], data: [{ a: 'x', b: 1, c: 2, p: 1, q: 3 }] }],
  ['bullet: plain bar, repeated and unordered', { type: 'bullet', x: 'a', value: 'b', data: [...B, { a: 'x', b: 3 }] }],
  ['bullet: unordered ranges', { type: 'bullet', x: 'a', value: 'b', ranges: ['p', 'q'], data: [{ a: 'x', b: 1, p: 3, q: 1 }] }],
  ['bullet: scale enum', { type: 'bullet', x: 'a', value: 'b', target: 'b', scale: 'own', data: B }],
  ['bump: ok from values', { type: 'bump', x: 'x', y: 'v', series: 's', rankBy: 'asc', data: [{ x: 1, s: 'p', v: 1 }, { x: 1, s: 'q', v: 2 }, { x: 2, s: 'p', v: 3 }, { x: 2, s: 'q', v: 1 }] }],
  ['bump: neither rank nor y', { type: 'bump', x: 'x', series: 's', data: [{ x: 1, s: 'p' }] }],
  ['bump: rank without series', { type: 'bump', x: 'x', rank: 'r', data: [{ x: 1, r: 1 }] }],
  ['bump: rank and y, bad ranks, repeats, rankBy unused', { type: 'bump', x: 'x', rank: 'r', y: 'r', series: 's', rankBy: 'asc', patterns: true, data: [{ x: 1, s: 'p', r: 1 }, { x: 1, s: 'p', r: 2 }, { x: 1, s: 'q', r: 0 }, { x: 2, s: 'q', r: 1 }] }],
  ['bump: one series, one step', { type: 'bump', x: 'x', y: 'v', data: [{ x: 1, v: 1 }] }],
  ['bump: too many series', { type: 'bump', x: 'x', y: 'v', series: 's', data: rowsOf(20, i => ({ x: 1 + (i % 2), s: `s${i >> 1}`, v: i })) }],
  ...FEATURE_VALIDATION,
  ...MAP_VALIDATION
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
  D('waterfall: opening total, changes, computed and reported totals', { type: 'waterfall', x: 'k', y: 'v', total: 't', format: 'currency:USD', data: [{ k: 'Open', v: 100, t: true }, { k: 'In', v: 30.5 }, { k: 'Out', v: -50 }, { k: 'Sub', t: 'subtotal' }, { k: 'Fee', v: -2 }, { k: 'Close', v: 80, t: 'TOTAL' }] }),
  D('waterfall: start, no totals, only rises', { type: 'waterfall', x: 'k', y: 'v', start: -10, data: [{ k: 'a', v: 4 }, { k: 'b', v: 6 }, { k: 'a', v: 1 }] }),
  D('funnel: zero first stage, a rise', { type: 'funnel', stage: 's', value: 'n', data: [{ s: 'a', n: 0 }, { s: 'b', n: 5 }, { s: 'c', n: 2 }] }),
  D('funnel: one stage', { type: 'funnel', stage: 's', value: 'n', format: 'compact', data: [{ s: 'only', n: 12500 }] }),
  D('bullet: no target, above every range, missing value', { type: 'bullet', x: 'k', value: 'v', ranges: ['lo', 'hi'], data: [{ k: 'a', v: 9, lo: 3, hi: 6 }, { k: 'b', lo: 1, hi: 2 }, { k: 'c', v: 2, lo: 3, hi: 6 }] }),
  D('bullet: seven measures on their own scales (list is cut)', { type: 'bullet', x: 'k', value: 'v', target: 't', scale: 'each', data: rowsOf(7, i => ({ k: `m${i}`, v: i * 10, t: i === 3 ? 0 : 25 })) }),
  D('bump: rank column, gaps and dates', { type: 'bump', x: 'd', rank: 'r', series: 's', data: [{ d: '2026-03-01', s: 'p', r: 2 }, { d: '2026-01-01', s: 'p', r: 1 }, { d: '2026-01-01', s: 'q', r: 2 }, { d: '2026-03-01', s: 'q', r: 1 }, { d: '2026-02-01', s: 'q', r: 1 }] }),
  D('bump: wide form, ascending, ties keep series order', { type: 'bump', x: 'x', y: ['a', 'b', 'c'], rankBy: 'asc', data: [{ x: 'r1', a: 3, b: 3, c: 1 }, { x: 'r2', a: 1, b: 2, c: 3 }] }),
  D('violin: fixed bandwidth, two groups', { type: 'violin', x: 'g', y: 'v', bandwidth: 2, format: 'fixed:1', data: [1, 2, 2, 3, 3, 3, 4, 4, 5, 9, 20, 21, 21, 22, 40].map((v, i) => ({ v, g: i < 10 ? 'a' : 'b' })) }),
  D('violin: one value repeated', { type: 'violin', y: 'v', data: [{ v: 3 }, { v: 3 }, { v: 3 }] }),
  D('calendar: timestamps summed per UTC day, gaps', { type: 'calendar', x: 't', value: 'v', data: [{ t: Date.UTC(2026, 2, 2, 23, 30), v: 2 }, { t: '2026-03-02T08:00:00Z', v: 1 }, { t: '2026-03-05', v: 0 }, { t: '2026-03-09T01:00:00+02:00', v: 4 }] }),
  D('calendar: two years', { type: 'calendar', x: 'd', value: 'v', format: 'compact', data: [{ d: '2025-12-30', v: 1200 }, { d: '2026-01-02', v: 800 }, { d: '2026-01-03', v: 800 }] }),
  D('calendar: past five years', { type: 'calendar', x: 'd', value: 'v', data: rowsOf(7, i => ({ d: `${2018 + i}-05-05`, v: i })) }),
  D('sunburst: ragged rows stop at an empty level', { type: 'sunburst', path: ['a', 'b'], value: 'v', data: [{ a: 'x', b: 'p', v: 3 }, { a: 'x', b: '', v: 1 }, { a: 'y', b: null, v: 2 }, { a: 'z', b: 'q', v: 0 }] }),
  D('sunburst: one level', { type: 'sunburst', path: 'a', value: 'v', data: [{ a: 'x', v: 1 }, { a: 'y', v: 3 }] }),
  D('parallel: no groups, negative link', { type: 'parallel', dimensions: ['a', 'b', 'c'], format: 'fixed:1', data: rowsOf(6, i => ({ a: i, b: 10 - i * 2, c: (i * 3) % 4 })) }),
  D('explicit description wins', { type: 'bar', x: 'a', y: 'b', description: 'Written by hand.', data: B }),
  D('unicode and long labels', { type: 'bar', x: 'k', y: 'v', title: '營收 by 地區 😀', data: [{ k: '台灣'.repeat(30), v: 3 }, { k: 'B 😀', v: 1 }] }),
  D('does not validate', { type: 'bar', x: 'nope', y: 'b', data: B }),
  D('choropleth: registered geography, raised, duplicates summed', { type: 'choropleth', geo: 'conf-islands', region: 'r', value: 'v', extrude: true, format: 'fixed:1', title: 'Rain', data: [...RV, { r: 'N', v: 2.5 }, { r: 'n', v: 100 }, { r: 'S', v: null }] }),
  D('choropleth: inline geography, one region', { type: 'choropleth', geo: G3, region: 'r', value: 'v', data: [{ r: 'N', v: -3 }] }),
  D('choropleth: ties keep the first', { type: 'choropleth', geo: G3, region: 'r', value: 'v', format: 'percent', data: [{ r: 'N', v: 0.5 }, { r: 'S', v: 0.5 }, { r: 'East Isle', v: 0.5 }] }),
  D('bubble-map: places only', { type: 'bubble-map', lat: 'lat', lng: 'lng', data: [...P, { lat: 91, lng: 0 }, { lat: '12.5', lng: '-7' }] }),
  D('bubble-map: sized, grouped, labelled', { type: 'bubble-map', lat: 'lat', lng: 'lng', size: 'n', series: 'k', label: 'place', format: 'compact', data: [...P, { place: null, lat: 0, lng: 0, n: 42000, k: 'a' }, { place: 'Skipped', lat: 0, lng: 0, n: -1, k: 'c' }] }),
  D('bubble-map: by region, unnamed and unmatched rows', { type: 'bubble-map', geo: G3, region: 'r', size: 'v', data: [...RV, { r: 'Atlantis', v: 99 }, { r: null, v: 1000 }] }),
  D('bubble-map: one group is not listed', { type: 'bubble-map', lat: 'lat', lng: 'lng', series: 'k', data: [P[0], { ...P[1], k: 'a' }] }),
  D('column-map: globe, groups, total', { type: 'column-map', lat: 'lat', lng: 'lng', value: 'n', series: 'k', label: 'place', format: 'integer', data: [...P, { place: 'Low', lat: 9, lng: 9, n: -5, k: 'z' }] }),
  D('column-map: tilted map by region', { type: 'column-map', geo: 'conf-islands', region: 'r', value: 'v', view: 'flat', title: 'Sales', data: RV }),
  D('column-map: nothing to raise', { type: 'column-map', lat: 'lat', lng: 'lng', value: 'n', data: [{ lat: 1, lng: 1, n: -3 }, { lat: 95, lng: 1, n: 3 }] }),
  D('flow-map: weighted, by coordinates', { type: 'flow-map', ...fll, from: 'a', to: 'b', value: 'n', format: 'currency:USD', data: FLL }),
  D('flow-map: unweighted, unnamed', { type: 'flow-map', ...fll, data: FLL }),
  D('bar: with a line', { type: 'bar', x: 'k', y: 'v', line: 't', data: [{ k: 'a', v: 3, t: 5 }, { k: 'b', v: 8, t: 5 }] }),
  D('bar: with two lines, one of them also a bar', { type: 'bar', x: 'k', y: ['v', 'w'], line: ['t', 'w', 'u'], stack: 'stack', data: [{ k: 'a', v: 3, w: 1, t: 5, u: 2 }, { k: 'b', v: 8, w: 2, t: 5, u: 2 }] }),
  D('bar: the line repeats the only bar column', { type: 'bar', x: 'k', y: 'v', line: 'v', data: [{ k: 'a', v: 3 }, { k: 'b', v: 8 }] }),
  D('bar: the line is ignored when horizontal', { type: 'bar', x: 'k', y: 'v', line: 't', orientation: 'horizontal', data: [{ k: 'a', v: 3, t: 5 }, { k: 'b', v: 8, t: 5 }] }),
  D('bar: the line is ignored when stacked to 100%', { type: 'bar', x: 'k', y: ['v', 't'], line: 'u', stack: 'normalize', data: [{ k: 'a', v: 3, t: 5, u: 1 }, { k: 'b', v: 8, t: 5, u: 1 }] }),
  D('bar: facet and patterns do not change the reading', { type: 'bar', x: 'k', y: 'v', facet: 'g', patterns: true, data: [{ k: 'a', g: 'p', v: 3 }, { k: 'b', g: 'q', v: 8 }] }),
  D('line: a fixed ISO range does not change the reading', { type: 'line', x: 'd', y: 'v', xDomain: ['2026-01-12', null], zoom: 'x', brush: 'x', data: dates(6, i => ({ v: i * i })) }),
  D('line: dates in the year 0 and before read as the year of the era', { type: 'line', x: 'd', y: 'v', data: [{ d: '0000-12-31', v: 1 }, { d: '0001-01-01', v: 2 }, { d: '0000-01-01', v: 3 }, { d: '0050-06-15', v: 4 }] }),
  D('line: the ends of what a Date holds are times', { type: 'line', x: 'd', y: 'v', xType: 'time', data: [{ d: 8.64e15, v: 1 }, { d: -8.64e15, v: 2 }, { d: 0, v: 3 }] }),
  D('area: a number past what a Date holds is not a time', { type: 'area', x: 'd', y: 'v', xType: 'time', data: [{ d: 1e16, v: 1 }, { d: -8.64e15 - 1, v: 2 }, { d: 8.64e15, v: 3 }, { d: '2026-01-05', v: 4 }, { d: -8.64e15, v: 5 }] }),
  D('line: only numbers past what a Date holds, read as time', { type: 'line', x: 'd', y: 'v', xType: 'time', data: [{ d: 1e16, v: 1 }, { d: -8.64e15 - 1, v: 2 }] }),
  D('line: dates and a number past what a Date holds fall back to categories', { type: 'line', x: 'd', y: 'v', data: [{ d: '2026-01-05', v: 1 }, { d: 1e16, v: 2 }, { d: '2026-01-12', v: 3 }] }),
  D('line: numbers past what a Date holds are still numbers', { type: 'line', x: 'd', y: 'v', data: [{ d: 1e16, v: 1 }, { d: -8.64e15 - 1, v: 2 }, { d: 8.64e15, v: 3 }] }),
  D('scatter: time x with numbers at and past the ends', { type: 'scatter', x: 'd', y: 'v', xType: 'time', data: [{ d: 1e16, v: 1 }, { d: -8.64e15 - 1, v: 2 }, { d: 8.64e15, v: 3 }, { d: -8.64e15, v: 5 }, { d: '2026-01-05', v: 4 }] }),
  D('scatter: dates and numbers past the ends, kind detected', { type: 'scatter', x: 'd', y: 'v', data: [{ d: 1e16, v: 1 }, { d: '2026-01-05', v: 4 }, { d: '2026-02-05', v: 6 }, { d: -1e16, v: 2 }] }),
  D('scatter: density', { type: 'scatter', x: 'a', y: 'b', series: 's', density: 'hex', data: rowsOf(12, i => ({ a: i, b: (i * 7) % 5, s: i % 2 ? 'odd' : 'even' })) }),
  D('line: after a transform', { type: 'line', x: 'm', y: 'v', title: 'Monthly mean', transform: [{ timeUnit: { field: 'd', unit: 'month', as: 'm' } }, { aggregate: { groupBy: ['m'], fields: { v: 'mean' } } }], data: dates(12, i => ({ v: i * 1.5 })) }),
  D('pie: after a filter and an aggregate', { type: 'pie', label: 'k', value: 'n', transform: [{ filter: { field: 'v', gte: 2 } }, { aggregate: { groupBy: ['k'], count: 'n' } }], data: [{ k: 'a', v: 1 }, { k: 'a', v: 2 }, { k: 'b', v: 3 }, { k: 'a', v: 4 }, { k: 'c', v: 0 }] }),
  D('bar: a transform that leaves nothing', { type: 'bar', x: 'k', y: 'v', transform: [{ filter: { field: 'v', gt: 100 } }], data: [{ k: 'a', v: 1 }] }),
  D('flow-map: by regions', { type: 'flow-map', geo: G3, from: 'a', to: 'b', value: 'n', series: 'a', data: [...FL, { a: ' N ', b: 'S', n: 5 }] })
]

const { MIN_TIME, MAX_TIME } = core
// `transform`: the steps run before the chart reads its columns. Each case carries the rows the chart then sees
// (`rows`, null when a step is refused) besides the issues, the normalised spec and the description.
const S = [
  { date: '2026-01-05', region: 'APAC', revenue: 120, units: 3 },
  { date: '2026-01-19', region: 'EMEA', revenue: 80, units: '2' },
  { date: '2026-02-02T10:30:00Z', region: 'APAC', revenue: 60.5, units: null },
  { date: '2026-02-14', region: 'EMEA', revenue: null, units: 5 },
  { date: '2026-03-01', region: 'LATAM', revenue: 40, units: 1 },
  { date: 1775001600000, region: 'APAC', revenue: '10', units: 2 }
]
const MIX = [{ k: 'b', v: 10 }, { k: 'a', v: '9' }, { k: null, v: null }, { k: 'B', v: 'x' }, { k: '😀', v: '2026-01-01' }, { k: '～', v: -1 }, { v: 2.5 }, { k: 'a', v: 10 }, { k: '', v: '' }, { k: 7, v: true }]
const TS = [{ t: '2026-01-01', n: 1 }, { t: '2026-03-31T23:59:59Z', n: 2 }, { t: '2026-04-01T00:00:00+02:00', n: 3 }, { t: '2025-12-29', n: 4 }, { t: '2026-01-04T12:00', n: 5 }, { t: '2024-02-29T05:45:10.5Z', n: 6 }, { t: -86400000, n: 7 }, { t: '1969-07-20T20:17:40Z', n: 8 }, { t: 1767225600000.75, n: 9 }]
const pipe = (transform, extra = {}) => ({ type: 'bar', x: 'region', y: 'revenue', data: S, transform, ...extra })
const mix = (transform, extra = {}) => ({ type: 'bar', x: 'k', y: 'v', data: MIX, transform, ...extra })
const times = (unit, extra = {}) => ({ type: 'bar', x: 'b', y: 'n', data: TS, transform: [{ timeUnit: { field: 't', unit, as: 'b' } }], ...extra })
const TRANSFORM = [
  ['no steps', pipe([])],
  ['filter: oneOf', pipe([{ filter: { field: 'region', oneOf: ['APAC', 'LATAM'] } }])],
  ['filter: oneOf compares as text', mix([{ filter: { field: 'v', oneOf: [10, '9', true, null] } }])],
  ['filter: equal', pipe([{ filter: { field: 'region', equal: 'EMEA' } }], { y: 'units' })],
  ['filter: equal null, and a missing cell', mix([{ filter: { field: 'k', equal: null } }])],
  ['filter: valid true', mix([{ filter: { field: 'k', valid: true } }])],
  ['filter: valid false', { type: 'treemap', label: 'k', value: 'n', data: MIX, transform: [{ filter: { field: 'v', valid: false } }, { aggregate: { groupBy: ['k'], count: 'n' } }] }],
  ['filter: range of ISO dates, from inclusive, to exclusive', pipe([{ filter: { field: 'date', range: ['2026-01-19', '2026-03-01'] } }])],
  ['filter: range with an open end, numbers', pipe([{ filter: { field: 'revenue', range: [60.5, null] } }])],
  ['filter: range open at both ends keeps what has an order', mix([{ filter: { field: 'v', range: [null, null] } }])],
  ['filter: gt and lte', pipe([{ filter: { field: 'revenue', gt: 40, lte: 120 } }])],
  ['filter: gte and lt on dates, epoch ms included', pipe([{ filter: { field: 'date', gte: '2026-02-14', lt: 1775001600001 } }])],
  ['filter: several tests must all hold', pipe([{ filter: { field: 'units', valid: true, gte: '2', oneOf: [2, 3, 5] } }])],
  ['filter: two steps', pipe([{ filter: { field: 'region', oneOf: ['APAC', 'EMEA'] } }, { filter: { field: 'revenue', valid: true } }])],
  ['timeUnit: year', times('year')],
  ['timeUnit: quarter', times('quarter')],
  ['timeUnit: month', times('month')],
  ['timeUnit: week starts on Monday', times('week')],
  ['timeUnit: day', times('day')],
  ['timeUnit: hour', times('hour')],
  ['timeUnit: in place', { type: 'line', x: 't', y: 'n', data: TS, transform: [{ timeUnit: { field: 't', unit: 'month' } }] }],
  ['timeUnit: some values are not dates', { type: 'bar', x: 'm', y: 'n', data: [...TS.slice(0, 3), { t: 'soon', n: 1 }, { t: null, n: 2 }, { n: 3 }, { t: '2026-02-30', n: 4 }], transform: [{ timeUnit: { field: 't', unit: 'month', as: 'm' } }] }],
  ...core.TIME_UNITS.map(unit => [`timeUnit: ${unit} in the year 50, the first and the last day there is`, { type: 'bar', x: 'b', y: 'n', data: [{ t: '0050-06-15T13:20:00Z', n: 1 }, { t: '0099-12-31', n: 2 }, { t: '0001-01-01', n: 3 }, { t: MIN_TIME, n: 4 }, { t: MAX_TIME, n: 5 }, { t: '9999-12-31T23:59:59.999Z', n: 6 }, { t: '0100-03-01', n: 7 }, { t: '0001-01-07T23:00:00Z', n: 8 }], transform: [{ timeUnit: { field: 't', unit, as: 'b' } }] }]),
  ['timeUnit: times outside the years 1 to 9999 are not dates', { type: 'bar', x: 'b', y: 'n', data: [{ t: MIN_TIME - 1, n: 1 }, { t: MAX_TIME + 1, n: 2 }, { t: 1e16, n: 3 }, { t: '0000-12-31', n: 4 }, { t: -1e16, n: 5 }, { t: MIN_TIME, n: 6 }, { t: MAX_TIME, n: 7 }, { t: '0001-01-01T00:00:00+00:01', n: 8 }, { t: '9999-12-31T23:59:59-00:01', n: 9 }, { t: 8.64e15, n: 10 }], transform: [{ timeUnit: { field: 't', unit: 'day', as: 'b' } }] }],
  ['timeUnit: beyond what a Date holds, with a filter on the same column', { type: 'bar', x: 'b', y: 'n', data: [{ t: 1e16, n: 1 }, { t: 8.64e15, n: 2 }, { t: '2026-01-05', n: 3 }, { t: -8.64e15 - 1, n: 4 }], transform: [{ filter: { field: 't', gt: 0 } }, { timeUnit: { field: 't', unit: 'month', as: 'b' } }, { sort: { field: 't', order: 'descending' } }] }],
  ['timeUnit: every time is outside the years 1 to 9999', { type: 'bar', x: 't', y: 'n', data: [{ t: 1e16, n: 1 }, { t: MAX_TIME + 1, n: 2 }, { t: '0000-06-01', n: 3 }], transform: [{ timeUnit: { field: 't', unit: 'year' } }] }],
  ['a column named "": sort', { type: 'bar', x: '', y: 'v', data: [{ '': 'b', v: 2 }, { '': 'a', v: 1 }, { '': 'c', v: 3 }], transform: [{ sort: { field: '' } }] }],
  ['a column named "": filter', { type: 'bar', x: '', y: 'v', data: [{ '': 'b', v: 2 }, { '': 'a', v: 1 }, { '': 'c', v: 3 }], transform: [{ filter: { field: '', oneOf: ['a', 'c'] } }] }],
  ['a column named "": top', { type: 'bar', x: '', y: 'v', data: [{ '': 5, v: 2 }, { '': 9, v: 1 }, { '': 7, v: 3 }], transform: [{ top: { n: 2, by: '' } }] }],
  ['a column named "": timeUnit, then aggregate by it', { type: 'bar', x: '', y: 'v', data: [{ '': '2026-03-09', v: 2 }, { '': '2026-03-20', v: 1 }, { '': '2026-04-01', v: 3 }], transform: [{ timeUnit: { field: '', unit: 'month' } }, { aggregate: { groupBy: [''], fields: { v: 'sum' } } }] }],
  ['a column named "" that does not exist', pipe([{ sort: { field: '' } }])],
  ['aggregate: sum per group', pipe([{ aggregate: { groupBy: ['region'], fields: { revenue: 'sum' } } }])],
  ['aggregate: every operation', { type: 'bar', x: 'region', y: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], data: S.map(r => ({ region: r.region, a: r.revenue, b: r.revenue, c: r.revenue, d: r.revenue, e: r.revenue, f: r.revenue, g: r.revenue })), transform: [{ aggregate: { groupBy: ['region'], fields: { a: 'sum', b: 'mean', c: 'median', d: 'min', e: 'max', f: 'count', g: 'distinct' } } }] }],
  ['aggregate: median of an even count, count of rows', pipe([{ aggregate: { groupBy: ['region'], fields: { units: 'median' }, count: 'rows' } }], { y: ['units', 'rows'] })],
  ['aggregate: count only', pipe([{ aggregate: { groupBy: ['region'], count: 'orders' } }], { y: 'orders' })],
  ['aggregate: no groups gives one row', { type: 'pie', label: 'orders', value: 'revenue', data: S, transform: [{ aggregate: { fields: { revenue: 'mean' }, count: 'orders' } }] }],
  ['aggregate: two group columns', pipe([{ timeUnit: { field: 'date', unit: 'month', as: 'month' } }, { aggregate: { groupBy: ['month', 'region'], fields: { revenue: 'sum' }, count: 'orders' } }], { x: 'month', series: 'region' })],
  ['aggregate: groups keep their type (1 is not "1"), null and missing are one group', { type: 'bar', x: 'k', y: 'n', data: [{ k: 1 }, { k: '1' }, { k: 1.0 }, { k: null }, {}, { k: true }, { k: 'true' }, { k: '' }, { k: -0 }, { k: 0 }], transform: [{ aggregate: { groupBy: ['k'], count: 'n' } }] }],
  ['aggregate: a group with no numbers is null', pipe([{ filter: { field: 'region', oneOf: ['EMEA', 'LATAM'] } }, { aggregate: { groupBy: ['region'], fields: { units: 'max', revenue: 'min' } } }, { filter: { field: 'region', equal: 'EMEA' } }, { aggregate: { groupBy: ['units'], fields: { region: 'sum' }, count: 'n' } }], { x: 'units', y: 'n' })],
  ['sort: ascending by number', pipe([{ sort: { field: 'revenue' } }])],
  ['sort: descending by date', pipe([{ sort: { field: 'date', order: 'descending' } }], { x: 'date' })],
  ['sort: numbers, then text by UTF-16 unit, missing last', mix([{ sort: { field: 'v', order: 'ascending' } }])],
  ['sort: text column, descending, ties keep their order', mix([{ sort: { field: 'k', order: 'descending' } }])],
  ['top: the three largest', pipe([{ top: { n: 3, by: 'revenue' } }])],
  ['top: more than there are', mix([{ top: { n: 1000, by: 'v' } }])],
  ['pipeline: monthly revenue with an order count as a line', pipe([{ filter: { field: 'revenue', valid: true } }, { timeUnit: { field: 'date', unit: 'month', as: 'month' } }, { aggregate: { groupBy: ['month'], fields: { revenue: 'sum' }, count: 'orders' } }, { sort: { field: 'month' } }], { x: 'month', line: 'orders', title: 'Monthly revenue' })],
  ['pipeline: top regions as a pie', { type: 'pie', label: 'region', value: 'revenue', format: 'currency:USD', data: S, transform: [{ aggregate: { groupBy: ['region'], fields: { revenue: 'sum' } } }, { top: { n: 2, by: 'revenue' } }] }],
  ['pipeline: weekly line with a fixed ISO range', { type: 'line', x: 'week', y: 'units', xDomain: ['2026-01-01', '2026-04-01'], data: S, transform: [{ timeUnit: { field: 'date', unit: 'week', as: 'week' } }, { aggregate: { groupBy: ['week'], fields: { units: 'sum' } } }] }],
  ['pipeline: ten steps', pipe(rowsOf(10, () => ({ sort: { field: 'revenue' } })))],
  ['a column made by a step can be used by the next and by the chart', pipe([{ timeUnit: { field: 'date', unit: 'quarter', as: 'q' } }, { filter: { field: 'q', equal: '2026-01-01' } }], { x: 'q', facet: 'region' })],
  ['the chart reads the output: a column aggregate dropped', pipe([{ aggregate: { groupBy: ['region'], count: 'n' } }])],
  ['the chart reads the output: rows a filter kept', pipe([{ filter: { field: 'revenue', valid: false } }], { y: 'units' })],
  ['the chart reads the output: not numeric after the step', pipe([{ filter: { field: 'region', equal: 'LATAM' } }, { aggregate: { groupBy: ['region'], fields: { revenue: 'distinct', date: 'sum' } } }], { y: 'date' })],
  ['empty after a filter', pipe([{ filter: { field: 'region', equal: 'Mars' } }])],
  ['empty after an empty oneOf', pipe([{ filter: { field: 'region', oneOf: [] } }, { timeUnit: { field: 'date', unit: 'day' } }])],
  ['not an array', pipe({ filter: { field: 'region', equal: 'APAC' } })],
  ['null', pipe(null)],
  ['eleven steps', pipe(rowsOf(11, () => ({ sort: { field: 'revenue' } })))],
  ['step is not an object', pipe([{ sort: { field: 'revenue' } }, 'sort'])],
  ['step is an array', pipe([[]])],
  ['step has no key', pipe([{}])],
  ['step has two keys', pipe([{ sort: { field: 'revenue' }, top: { n: 1, by: 'revenue' } }])],
  ['misspelt step', pipe([{ filtr: { field: 'region', equal: 'APAC' } }])],
  ['unknown step', pipe([{ pivot: {} }])],
  ['step body is not an object', pipe([{ filter: 'region' }])],
  ['step body is null', pipe([{ top: null }])],
  ['unknown field in a step', pipe([{ filter: { field: 'region', equals: 'APAC' } }])],
  ['unknown field, no near match', pipe([{ sort: { field: 'revenue', zzzzzzzz: 1 } }])],
  ['filter: no field', pipe([{ filter: { equal: 'APAC' } }])],
  ['filter: field is not a string', pipe([{ filter: { field: 3, equal: 'APAC' } }])],
  ['filter: no such column', pipe([{ filter: { field: 'regoin', equal: 'APAC' } }])],
  ['filter: no test', pipe([{ filter: { field: 'region' } }])],
  ['filter: equal is an object', pipe([{ filter: { field: 'region', equal: { a: 1 } } }])],
  ['filter: oneOf is not an array', pipe([{ filter: { field: 'region', oneOf: 'APAC' } }])],
  ['filter: oneOf holds an array', pipe([{ filter: { field: 'region', oneOf: ['APAC', ['EMEA']] } }])],
  ['filter: range of one', pipe([{ filter: { field: 'revenue', range: [1] } }])],
  ['filter: range is not a date', pipe([{ filter: { field: 'date', range: ['2026-01-01', 'later'] } }])],
  ['filter: range from after to', pipe([{ filter: { field: 'date', range: ['2026-03-01', '2026-01-01'] } }])],
  ['filter: range from equals to is allowed (and empty)', pipe([{ filter: { field: 'revenue', range: [5, 5] } }])],
  ['filter: gt is not a bound', pipe([{ filter: { field: 'revenue', gt: true } }])],
  ['filter: lte is null', pipe([{ filter: { field: 'revenue', lte: null } }])],
  ['filter: valid is not a boolean', pipe([{ filter: { field: 'revenue', valid: 'yes' } }])],
  ['timeUnit: no unit', pipe([{ timeUnit: { field: 'date' } }])],
  ['timeUnit: misspelt unit', pipe([{ timeUnit: { field: 'date', unit: 'months' } }])],
  ['timeUnit: unit is a number', pipe([{ timeUnit: { field: 'date', unit: 7 } }])],
  ['timeUnit: as is empty', pipe([{ timeUnit: { field: 'date', unit: 'day', as: '' } }])],
  ['timeUnit: as is too long', pipe([{ timeUnit: { field: 'date', unit: 'day', as: 'x'.repeat(65) } }])],
  ['timeUnit: as of 64 characters', pipe([{ timeUnit: { field: 'date', unit: 'day', as: 'x'.repeat(64) } }])],
  ['timeUnit: no dates in the column', pipe([{ timeUnit: { field: 'region', unit: 'day' } }])],
  ['timeUnit: no such column', pipe([{ timeUnit: { field: 'when', unit: 'day' } }])],
  ['aggregate: nothing to compute', pipe([{ aggregate: { groupBy: ['region'] } }])],
  ['aggregate: empty', pipe([{ aggregate: {} }])],
  ['aggregate: groupBy is a string', pipe([{ aggregate: { groupBy: 'region', count: 'n' } }])],
  ['aggregate: five group columns', pipe([{ aggregate: { groupBy: ['region', 'date', 'units', 'revenue', 'region'], count: 'n' } }])],
  ['aggregate: no such group column', pipe([{ aggregate: { groupBy: ['region', 'month'], count: 'n' } }])],
  ['aggregate: fields is an array', pipe([{ aggregate: { groupBy: ['region'], fields: ['revenue'] } }])],
  ['aggregate: no such field column', pipe([{ aggregate: { groupBy: ['region'], fields: { revenu: 'sum' } } }])],
  ['aggregate: unknown operation', pipe([{ aggregate: { groupBy: ['region'], fields: { revenue: 'average' } } }])],
  ['aggregate: operation is not a string', pipe([{ aggregate: { groupBy: ['region'], fields: { revenue: 1 } } }])],
  ['aggregate: the first bad field is reported (keys in Object.keys order)', pipe([{ aggregate: { fields: { units: 'total', revenue: 'avg', 2: 'sum', 1: 'sum' } } }])],
  ['aggregate: two bad fields, the first as written is reported', pipe([{ aggregate: { fields: { units: 'total', revenue: 'avg' }, groupBy: ['region'] } }])],
  ['unknown fields in a step: the first as written is reported', pipe([{ top: { zeta: 1, n: 2, alpha: 2, by: 'revenue' } }])],
  ['aggregate: count is not a name', pipe([{ aggregate: { groupBy: ['region'], count: true } }])],
  ['sort: no field', pipe([{ sort: {} }])],
  ['sort: bad order', pipe([{ sort: { field: 'revenue', order: 'desc' } }])],
  ['top: no by', pipe([{ top: { n: 3 } }])],
  ['top: no n', pipe([{ top: { by: 'revenue' } }])],
  ['top: n is zero', pipe([{ top: { by: 'revenue', n: 0 } }])],
  ['top: n is not whole', pipe([{ top: { by: 'revenue', n: 2.5 } }])],
  ['top: n is too large', pipe([{ top: { by: 'revenue', n: 1001 } }])],
  ['a later step reads the output of an earlier one', pipe([{ aggregate: { groupBy: ['region'], fields: { revenue: 'sum' } } }, { sort: { field: 'date' } }])],
  ['only the first bad step is reported', pipe([{ sort: { field: 'nope' } }, { top: { n: 0, by: 'nope' } }], { y: 'nope', stak: 1 })],
  ['a warning from a step survives a later error', pipe([{ timeUnit: { field: 'date', unit: 'month', as: 'm' } }, { filter: { field: 'm', equal: 'x' } }], { data: [...S, { date: 'soon', region: 'APAC', revenue: 1, units: 1 }] })],
  // Round 5: bin, window and fold.
  ['bin: default maxbins, default names', pipe([{ bin: { field: 'revenue' } }])],
  ['bin: maxbins is a maximum (the histogram step is made coarser)', { type: 'bar', x: 'b0', y: 'n', data: rowsOf(14, i => ({ v: i })), transform: [{ bin: { field: 'v', maxbins: 4, as: ['b0', 'b1'] } }, { aggregate: { groupBy: ['b0', 'b1'], count: 'n' } }] }],
  ['bin: a step', pipe([{ bin: { field: 'revenue', step: 25, as: ['from', 'to'] } }], { x: 'from' })],
  ['bin: one value', { type: 'bar', x: 'v_start', y: 'n', data: [{ v: 3 }, { v: 3 }], transform: [{ bin: { field: 'v' } }, { aggregate: { groupBy: ['v_start'], count: 'n' } }] }],
  ['bin: decimals', { type: 'bar', x: 'lo', y: 'n', data: rowsOf(9, i => ({ v: 0.1 + i * 0.07 })), transform: [{ bin: { field: 'v', maxbins: 3, as: ['lo', 'hi'] } }, { aggregate: { groupBy: ['lo'], count: 'n' } }] }],
  ['bin: not numeric', pipe([{ bin: { field: 'region' } }])],
  ['bin: no field', pipe([{ bin: { maxbins: 3 } }])],
  ['bin: maxbins too large', pipe([{ bin: { field: 'revenue', maxbins: 201 } }])],
  ['bin: maxbins not whole', pipe([{ bin: { field: 'revenue', maxbins: 2.5 } }])],
  ['bin: step zero', pipe([{ bin: { field: 'revenue', step: 0 } }])],
  ['bin: step too small', pipe([{ bin: { field: 'revenue', step: 0.1 } }])],
  ['bin: as of one name', pipe([{ bin: { field: 'revenue', as: ['b'] } }])],
  ['bin: as twice the same', pipe([{ bin: { field: 'revenue', as: ['b', 'b'] } }])],
  ...['sum', 'mean', 'count', 'rank', 'pctChange', 'lag', 'lead', 'movingMean'].map(op => [`window: ${op} per region by date`, pipe([{ window: { op, field: 'revenue', as: 'w', groupBy: ['region'], sortBy: 'date' } }], { y: 'units', x: 'date', series: 'region' })]),
  ['window: sum descending, no groups', pipe([{ window: { op: 'sum', field: 'units', as: 'w', sortBy: 'revenue', order: 'desc' } }], { y: 'w' })],
  ['window: rank without sortBy ranks the field, ties share', mix([{ window: { op: 'rank', field: 'v', as: 'r', order: 'desc' } }])],
  ['window: rank of text', mix([{ window: { op: 'rank', field: 'k', as: 'r' } }], { y: 'r' })],
  ['window: movingMean over 2 rows', pipe([{ window: { op: 'movingMean', field: 'revenue', as: 'm', sortBy: 'date', frame: 2 } }], { y: 'm' })],
  ['window: data order without sortBy', mix([{ window: { op: 'lag', field: 'k', as: 'prev' } }])],
  ['window: frame ignored', pipe([{ window: { op: 'sum', field: 'revenue', as: 'w', frame: 4 } }])],
  ['window: order without sortBy', pipe([{ window: { op: 'sum', field: 'revenue', as: 'w', order: 'desc' } }])],
  ['window: as in place', pipe([{ window: { op: 'sum', field: 'revenue', as: 'revenue', sortBy: 'date' } }])],
  ['window: unknown op', pipe([{ window: { op: 'cumsum', field: 'revenue', as: 'w' } }])],
  ['window: no op', pipe([{ window: { field: 'revenue', as: 'w' } }])],
  ['window: no as', pipe([{ window: { op: 'sum', field: 'revenue' } }])],
  ['window: no such sortBy', pipe([{ window: { op: 'sum', field: 'revenue', as: 'w', sortBy: 'when' } }])],
  ['window: groupBy is a string', pipe([{ window: { op: 'sum', field: 'revenue', as: 'w', groupBy: 'region' } }])],
  ['window: bad order', pipe([{ window: { op: 'sum', field: 'revenue', as: 'w', sortBy: 'date', order: 'descending' } }])],
  ['window: frame zero', pipe([{ window: { op: 'movingMean', field: 'revenue', as: 'w', frame: 0 } }])],
  ['fold: two columns', { type: 'bar', x: 'region', y: 'value', series: 'key', data: S, transform: [{ fold: { fields: ['revenue', 'units'] } }] }],
  ['fold: named, then a window over the folded rows', { type: 'line', x: 'date', y: 'total', series: 'measure', data: S, transform: [{ fold: { fields: ['revenue', 'units'], as: ['measure', 'amount'] } }, { window: { op: 'sum', field: 'amount', as: 'total', groupBy: ['measure'], sortBy: 'date' } }] }],
  ['fold: a folded column is gone for the next step', pipe([{ fold: { fields: ['revenue', 'units'] } }, { sort: { field: 'revenue' } }])],
  ['fold: no fields', pipe([{ fold: {} }])],
  ['fold: empty fields', pipe([{ fold: { fields: [] } }])],
  ['fold: no such column', pipe([{ fold: { fields: ['revenue', 'cost'] } }])],
  ['fold: a column twice', pipe([{ fold: { fields: ['revenue', 'revenue'] } }])],
  ['fold: as of one name', pipe([{ fold: { fields: ['revenue'], as: ['k'] } }])],
  ['pipeline: fold, bin, aggregate, window', { type: 'line', x: 'from', y: 'cum', series: 'k', data: rowsOf(40, i => ({ a: (i * 37) % 23, b: (i * 11) % 17 })), transform: [{ fold: { fields: ['a', 'b'], as: ['k', 'v'] } }, { bin: { field: 'v', maxbins: 4, as: ['from', 'to'] } }, { aggregate: { groupBy: ['k', 'from'], count: 'n' } }, { window: { op: 'sum', field: 'n', as: 'cum', groupBy: ['k'], sortBy: 'from' } }] }],
  ['no expression step', pipe([{ calculate: 'datum.revenue * 2', as: 'x2' }])],
  ['transform is not run when data is missing', { type: 'bar', x: 'region', y: 'revenue', transform: [{ nope: 1 }] }],
  ['transform as a JSON string spec', JSON.stringify(pipe([{ aggregate: { fields: { revenue: 'sum', units: 'mean' }, groupBy: ['region'] } }, { top: { by: 'revenue', n: 2 } }]))]
].map(([name, spec]) => {
  const v = validatePlot(spec)
  const d = describePlot(spec)
  return { name, spec, ok: v.ok, issues: v.issues.map(i => ({ severity: i.severity, code: i.code, path: i.path })), normalized: v.spec ? withoutData(v.spec) : null, rows: v.spec ? v.spec.data : null, describe: d.ok ? d.text : null }
})

// English currency symbols and default fraction digits, straight from Intl, so a port never guesses them.
const currencies = Object.fromEntries(Intl.supportedValuesOf('currency').map(code => {
  const nf = new Intl.NumberFormat('en', { style: 'currency', currency: code })
  const symbol = nf.formatToParts(1).find(p => p.type === 'currency').value
  return [code, { symbol, digits: nf.resolvedOptions().maximumFractionDigits }]
}))

const fields = {
  version: 1,
  limits: LIMITS,
  // Maps: the size limits of a geography, and the allowed range of each camera field.
  geoLimits: GEO_LIMITS,
  camera: { lng: [-180, 180], lat: [-90, 90], ...CAMERA_LIMITS },
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
  density,
  histogramBins: bins,
  logTicks: logTickCases,
  logNiceDomain: logNiceCases,
  loess: loessCases,
  binStep: binStepCases,
  chartExamples: examples,
  brokenSpecs: broken,
  geographies: GEOGRAPHIES,
  geographyCases: GEOGRAPHY,
  validationCases: VALIDATION,
  transformCases: TRANSFORM,
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
