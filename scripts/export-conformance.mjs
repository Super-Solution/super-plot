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
  ['sankey: too many flows', { type: 'sankey', from: 'a', to: 'c', value: 'b', data: rowsOf(301, i => ({ a: `s${i % 20}`, c: `t${Math.floor(i / 20)}`, b: 1 })) }],
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
  D('flow-map: by regions', { type: 'flow-map', geo: G3, from: 'a', to: 'b', value: 'n', series: 'a', data: [...FL, { a: ' N ', b: 'S', n: 5 }] })
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
  histogramBins: bins,
  chartExamples: examples,
  brokenSpecs: broken,
  geographies: GEOGRAPHIES,
  geographyCases: GEOGRAPHY,
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
