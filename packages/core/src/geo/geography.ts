// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Geographies: region boundaries a map joins data to. Super Plot ships none. Boundaries are political
 * (who draws which line is a claim), so the host imports the dataset it has chosen, under its licence, with
 * `registerGeography`, or a spec carries a small one inline. Presets only say where common open datasets
 * keep their key and name; they never fetch or bundle anything.
 *
 * Input is GeoJSON (a FeatureCollection, RFC 7946) or TopoJSON (a Topology). Coordinates are longitude and
 * latitude in degrees. Only Polygon and MultiPolygon features become regions; other geometry is skipped.
 */
import type { Issue } from '../schema.js'
import { closest } from '../util/num.js'

/** One ring as interleaved [lng, lat, lng, lat, ...], longitudes unwrapped so no edge jumps across ±180. */
export type Ring = Float64Array

export interface GeoRegion {
  /** Join key: what a data row's `region` value is matched against. */
  key: string
  /** Display name for tooltips and descriptions. */
  name: string
  /** Flagged as disputed by the imported data (never decided by Super Plot). */
  disputed: boolean
  /** Polygons; each polygon is [outer ring, ...holes]. */
  polygons: Ring[][]
  /** [west, south, east, north] over the unwrapped rings. */
  bbox: [number, number, number, number]
  /** Representative point (centroid of the largest polygon), for bubbles, columns, arcs and labels. */
  center: [number, number]
}

export interface Geography {
  name: string
  regions: GeoRegion[]
  /** Normalised key, name or alias to the region's key. */
  lookup: Map<string, string>
  byKey: Map<string, GeoRegion>
  /** [west, south, east, north] of everything. */
  bbox: [number, number, number, number]
  vertices: number
  attribution?: string
}

type Pick = string | ((properties: Record<string, unknown>, id: unknown) => unknown)

export interface GeographyOptions {
  /** TopoJSON: which object to read (default: the first). */
  object?: string
  /** Property (or function) giving the join key. Default: feature `id`, then `properties.id`, then `properties.name`. */
  key?: Pick
  /** Property (or function) giving the display name. Default: `properties.name`, else the key. */
  name?: Pick
  /** Extra spellings that should match a region: alias -> key. */
  aliases?: Record<string, string>
  /** Property (or function) that marks a region as disputed in the source data. Default: `properties.disputed === true`. */
  disputed?: Pick
  /** Credit line for the dataset; used as the chart's source line when the spec has none. */
  attribution?: string
}

export const GEO_LIMITS = { maxRegions: 5000, maxVertices: 1_000_000, maxIssues: 20, maxNameLength: 120 }

/** Case, accent-insensitive-enough key for joining: trimmed, lower case, inner whitespace collapsed. */
export const normalizeRegion = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Where common open boundary datasets keep their join key and name. Templates only: download the file
 * yourself (check its licence and its stance on disputed areas), then `registerGeography(name, data, preset)`.
 */
export const GEO_PRESETS: Record<string, GeographyOptions & { description: string; url: string }> = {
  'natural-earth-admin0': {
    description: 'Natural Earth admin-0 countries (public domain). Ships "point of view" editions that draw disputed areas as a given country sees them; pick the edition you need.',
    url: 'https://www.naturalearthdata.com/downloads/',
    key: p => (typeof p.ISO_A3 === 'string' && p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3),
    name: p => p.NAME ?? p.ADMIN,
    disputed: p => typeof p.TYPE === 'string' && /disputed|indeterminate/i.test(p.TYPE)
  },
  'natural-earth-admin1': {
    description: 'Natural Earth admin-1 states and provinces (public domain).',
    url: 'https://www.naturalearthdata.com/downloads/',
    key: p => p.iso_3166_2 ?? p.adm1_code,
    name: p => p.name
  },
  'world-atlas': {
    description: 'The world-atlas TopoJSON files (derived from Natural Earth); ids are ISO 3166-1 numeric codes.',
    url: 'https://github.com/topojson/world-atlas',
    object: 'countries',
    key: (_p, id) => id,
    name: p => p.name
  },
  geoboundaries: {
    description: 'geoBoundaries (CC BY 4.0, cite it). The CGAZ composite resolves disputed areas by its own documented rule.',
    url: 'https://www.geoboundaries.org/',
    key: p => p.shapeISO || p.shapeGroup || p.shapeID,
    name: p => p.shapeName,
    attribution: 'geoBoundaries'
  }
}

const registry = new Map<string, Geography>()

export class GeographyError extends Error {
  readonly issues: Issue[]
  constructor(issues: Issue[]) {
    super(issues.filter(i => i.severity === 'error').map(i => `${i.path}: ${i.message}${i.hint ? ` ${i.hint}` : ''}`).join('\n') || 'Invalid geography')
    this.name = 'GeographyError'
    this.issues = issues
  }
}

/**
 * Make a geography available to specs by name (`geo: "<name>"`). `data` is GeoJSON or TopoJSON (an object
 * or a JSON string). `options` may be a preset name. Throws `GeographyError` when the data is unusable;
 * returns the warnings (skipped features, duplicate keys) otherwise.
 */
export function registerGeography(name: string, data: unknown, options: GeographyOptions | keyof typeof GEO_PRESETS = {}): Issue[] {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new GeographyError([{ severity: 'error', code: 'bad_value', path: 'name', message: `Geography name must be 1-64 letters, digits, ".", "_" or "-", got ${JSON.stringify(name)}.` }])
  const opts = typeof options === 'string' ? GEO_PRESETS[options] : options
  if (!opts) throw new GeographyError([{ severity: 'error', code: 'bad_enum', path: 'options', message: `Unknown preset "${String(options)}".`, hint: `Presets: ${Object.keys(GEO_PRESETS).join(', ')}.` }])
  const issues: Issue[] = []
  let input = data
  if (typeof data === 'string') {
    try {
      input = JSON.parse(data)
    } catch (e) {
      throw new GeographyError([{ severity: 'error', code: 'invalid_json', path: 'data', message: `Geography is not valid JSON: ${(e as Error).message}.` }])
    }
  }
  const geo = readGeography(input, opts, issues, 'data', name)
  if (!geo || issues.some(i => i.severity === 'error')) throw new GeographyError(issues)
  registry.set(name, geo)
  return issues
}

export const unregisterGeography = (name: string): boolean => registry.delete(name)
export const getGeography = (name: string): Geography | undefined => registry.get(name)

/** What an agent or a picker needs: the registered names, their size and a sample of region keys. */
export function listGeographies(): { name: string; regions: number; sample: { key: string; name: string }[]; attribution?: string }[] {
  return [...registry.values()].map(g => ({
    name: g.name,
    regions: g.regions.length,
    sample: g.regions.slice(0, 12).map(r => ({ key: r.key, name: r.name })),
    ...(g.attribution ? { attribution: g.attribution } : {})
  }))
}

// ---- reading ---------------------------------------------------------------------------------

interface Reader {
  issues: Issue[]
  errors: number
  path: string
}

function report(rd: Reader, severity: Issue['severity'], code: string, path: string, message: string, hint?: string): void {
  if (rd.errors >= GEO_LIMITS.maxIssues) return
  if (severity === 'error') rd.errors++
  rd.issues.push({ severity, code, path, message, ...(hint ? { hint } : {}) })
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const pick = (p: Pick | undefined, props: Record<string, unknown>, id: unknown): unknown => (p === undefined ? undefined : typeof p === 'function' ? p(props, id) : props[p])

const asLabel = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, GEO_LIMITS.maxNameLength) : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)

/** Raw polygons: [polygon][ring][position]. */
type RawPolys = number[][][][]

interface RawFeature { id: unknown; properties: Record<string, unknown>; polys: RawPolys; path: string }

/**
 * Validate and read GeoJSON or TopoJSON into a Geography. Problems are pushed to `issues` with paths under
 * `path` (e.g. `geo.features[3].geometry`). Returns null when nothing usable remains.
 */
export function readGeography(input: unknown, options: GeographyOptions, issues: Issue[], path: string, name = 'inline'): Geography | null {
  const rd: Reader = { issues, errors: 0, path }
  if (!isObj(input)) {
    report(rd, 'error', 'bad_type', path, `${path} must be a GeoJSON FeatureCollection or a TopoJSON Topology object.`, 'Register boundaries with registerGeography(name, data) and use the name here.')
    return null
  }
  let raw: RawFeature[] | null
  let vertices = 0
  if (input.type === 'FeatureCollection') {
    raw = readFeatureCollection(input, rd)
    if (raw) for (const f of raw) for (const poly of f.polys) for (const ring of poly) vertices += ring.length
  } else if (input.type === 'Topology') {
    const t = readTopology(input, options.object, rd)
    raw = t?.features ?? null
    vertices = t?.vertices ?? 0
  } else {
    report(rd, 'error', 'bad_geo', `${path}.type`, `${path}.type must be "FeatureCollection" (GeoJSON) or "Topology" (TopoJSON), got ${JSON.stringify(input.type) ?? 'nothing'}.`, input.type === 'Feature' || input.type === 'Polygon' || input.type === 'MultiPolygon' ? 'Wrap it: {"type":"FeatureCollection","features":[...]}.' : undefined)
    return null
  }
  if (!raw) return null
  if (vertices > GEO_LIMITS.maxVertices) {
    report(rd, 'error', 'too_many_vertices', path, `The boundaries have ${vertices} points; the limit is ${GEO_LIMITS.maxVertices}.`, 'Simplify them first (for example mapshaper -simplify 10%), or use a coarser edition such as 1:50m or 1:110m.')
    return null
  }
  if (raw.length > GEO_LIMITS.maxRegions) {
    report(rd, 'error', 'too_many_regions', path, `${raw.length} regions; the limit is ${GEO_LIMITS.maxRegions}.`, 'Split the boundaries into several geographies, or dissolve small regions.')
    return null
  }

  const regions: GeoRegion[] = []
  const byKey = new Map<string, GeoRegion>()
  const lookup = new Map<string, string>()
  for (const f of raw) {
    const defKey = f.id ?? f.properties.id ?? f.properties.name
    const key = asLabel(options.key !== undefined ? pick(options.key, f.properties, f.id) : defKey)
    if (key === null) {
      report(rd, 'warning', 'geo_no_key', f.path, `Feature has no ${options.key !== undefined ? 'value for the key property' : 'id, properties.id or properties.name'}; it is skipped.`, 'Give every feature an id, or pass options.key to registerGeography.')
      continue
    }
    if (byKey.has(key)) {
      report(rd, 'warning', 'duplicate_region', f.path, `Region key "${key}" appears more than once; the parts are merged.`)
      const prev = byKey.get(key)!
      const merged = toRegion(key, prev.name, prev.disputed, [...prev.polygons.map(p => p.map(r => Array.from(r))).map(p => p.map(r => pairs(r))), ...f.polys])
      if (merged) {
        regions[regions.indexOf(prev)] = merged
        byKey.set(key, merged)
      }
      continue
    }
    const nm = asLabel(options.name !== undefined ? pick(options.name, f.properties, f.id) : f.properties.name) ?? key
    const disputedRaw = options.disputed !== undefined ? pick(options.disputed, f.properties, f.id) : f.properties.disputed === true
    const region = toRegion(key, nm, disputedRaw === true, f.polys)
    if (!region) continue
    regions.push(region)
    byKey.set(key, region)
  }
  if (rd.errors) return null
  if (!regions.length) {
    report(rd, 'error', 'geo_empty', path, 'No usable Polygon or MultiPolygon features.', 'A map needs region polygons with longitude/latitude coordinates.')
    return null
  }
  for (const r of regions) {
    lookup.set(normalizeRegion(r.key), r.key)
    if (!lookup.has(normalizeRegion(r.name))) lookup.set(normalizeRegion(r.name), r.key)
  }
  for (const [alias, key] of Object.entries(options.aliases ?? {})) {
    if (byKey.has(key)) lookup.set(normalizeRegion(alias), key)
    else report(rd, 'warning', 'bad_alias', `${path}.aliases.${alias}`, `Alias "${alias}" points at "${key}", which is not a region key.`)
  }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const r of regions) {
    w = Math.min(w, r.bbox[0]); s = Math.min(s, r.bbox[1]); e = Math.max(e, r.bbox[2]); n = Math.max(n, r.bbox[3])
  }
  return { name, regions, lookup, byKey, bbox: [w, s, e, n], vertices, ...(options.attribution ? { attribution: options.attribution } : {}) }
}

const pairs = (r: ArrayLike<number>): number[][] => {
  const out: number[][] = []
  for (let i = 0; i + 1 < r.length; i += 2) out.push([r[i], r[i + 1]])
  return out
}

function readFeatureCollection(fc: Record<string, unknown>, rd: Reader): RawFeature[] | null {
  if (!Array.isArray(fc.features)) {
    report(rd, 'error', 'bad_geo', `${rd.path}.features`, 'A FeatureCollection needs a "features" array.')
    return null
  }
  const out: RawFeature[] = []
  fc.features.forEach((f, i) => {
    const p = `${rd.path}.features[${i}]`
    if (!isObj(f) || f.type !== 'Feature') return report(rd, 'error', 'bad_geo', p, `${p} must be a {"type":"Feature"} object.`)
    const props = isObj(f.properties) ? f.properties : {}
    const g = f.geometry
    if (g === null || g === undefined) return report(rd, 'warning', 'geo_feature_skipped', p, 'Feature has no geometry; it is skipped.')
    if (!isObj(g)) return report(rd, 'error', 'bad_geo', `${p}.geometry`, 'geometry must be an object.')
    let polys: unknown
    if (g.type === 'Polygon') polys = [g.coordinates]
    else if (g.type === 'MultiPolygon') polys = g.coordinates
    else return report(rd, 'warning', 'geo_feature_skipped', `${p}.geometry`, `${String(g.type)} geometry is not a region; it is skipped.`, 'Maps join data to Polygon and MultiPolygon features. Plot point data with lat/lng columns instead.')
    const read = readPolys(polys, rd, `${p}.geometry.coordinates`, g.type === 'Polygon')
    if (read) out.push({ id: f.id, properties: props, polys: read, path: p })
  })
  return out
}

function readPolys(value: unknown, rd: Reader, path: string, single: boolean): RawPolys | null {
  if (!Array.isArray(value)) {
    report(rd, 'error', 'bad_geo', path, 'coordinates must be nested arrays of [longitude, latitude] positions.')
    return null
  }
  const polys: RawPolys = []
  for (let pi = 0; pi < value.length; pi++) {
    const poly = value[pi]
    const pp = single ? path : `${path}[${pi}]`
    if (!Array.isArray(poly)) { report(rd, 'error', 'bad_geo', pp, 'A polygon must be an array of rings.'); return null }
    const rings: number[][][] = []
    for (let ri = 0; ri < poly.length; ri++) {
      const ring = readRing(poly[ri], rd, `${pp}[${ri}]`)
      if (ring === null) return null
      // Without its outer ring a polygon's holes mean nothing: skip the polygon.
      if (!ring.length && ri === 0) break
      if (ring.length) rings.push(ring)
    }
    if (rings.length) polys.push(rings)
  }
  return polys
}

function readRing(ring: unknown, rd: Reader, path: string): number[][] | null {
  if (!Array.isArray(ring)) { report(rd, 'error', 'bad_geo', path, 'A ring must be an array of [longitude, latitude] positions.'); return null }
  const out: number[][] = []
  for (let k = 0; k < ring.length; k++) {
    const pos = ring[k]
    if (!Array.isArray(pos) || pos.length < 2 || typeof pos[0] !== 'number' || typeof pos[1] !== 'number' || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) {
      report(rd, 'error', 'bad_geo', `${path}[${k}]`, 'A position must be [longitude, latitude] with two finite numbers.')
      return null
    }
    if (!checkPosition(pos[0], pos[1], rd, `${path}[${k}]`)) return null
    out.push([pos[0], pos[1]])
  }
  return closeRing(out, rd, path)
}

function checkPosition(lng: number, lat: number, rd: Reader, path: string): boolean {
  if (Math.abs(lng) <= 360 && Math.abs(lat) <= 90) return true
  const projected = Math.abs(lng) > 1000 || Math.abs(lat) > 1000
  report(rd, 'error', 'geo_out_of_range', path, `Position [${lng}, ${lat}] is not a longitude/latitude in degrees.`, projected ? 'This looks like projected coordinates (metres). Re-export the boundaries in WGS 84 (EPSG:4326).' : 'Longitude must be within -360..360 and latitude within -90..90; check for swapped values.')
  return false
}

function closeRing(ring: number[][], rd: Reader, path: string): number[][] | null {
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([ring[0][0], ring[0][1]])
  if (ring.length < 4) {
    // A sliver left over from simplification: drop it rather than reject a whole file for it.
    report(rd, 'warning', 'geo_bad_ring', path, `A ring needs at least 4 positions (a closed triangle), got ${ring.length}; it is skipped.`)
    return []
  }
  return ring
}

function readTopology(t: Record<string, unknown>, object: string | undefined, rd: Reader): { features: RawFeature[]; vertices: number } | null {
  const path = rd.path
  if (!isObj(t.objects) || !Object.keys(t.objects).length) { report(rd, 'error', 'bad_geo', `${path}.objects`, 'A Topology needs a non-empty "objects" map.'); return null }
  if (!Array.isArray(t.arcs)) { report(rd, 'error', 'bad_geo', `${path}.arcs`, 'A Topology needs an "arcs" array.'); return null }
  const names = Object.keys(t.objects)
  const objName = object ?? names[0]
  const obj = (t.objects as Record<string, unknown>)[objName]
  if (!isObj(obj)) {
    const near = closest(objName, names)
    report(rd, 'error', 'bad_geo', `${path}.objects`, `Topology has no object "${objName}".`, `${near ? `Did you mean "${near}"? ` : ''}Objects: ${names.join(', ')}.`)
    return null
  }
  let scale = [1, 1], translate = [0, 0], quantized = false
  if (t.transform !== undefined) {
    const tr = t.transform
    if (!isObj(tr) || !Array.isArray(tr.scale) || !Array.isArray(tr.translate) || tr.scale.length !== 2 || tr.translate.length !== 2 || ![...tr.scale, ...tr.translate].every(v => typeof v === 'number' && Number.isFinite(v))) {
      report(rd, 'error', 'bad_geo', `${path}.transform`, 'transform must be {"scale":[sx,sy],"translate":[tx,ty]} with numbers.')
      return null
    }
    scale = tr.scale as number[]
    translate = tr.translate as number[]
    quantized = true
  }
  // Decode every arc once (delta-encoded when quantized).
  const arcs: number[][][] = []
  let vertices = 0
  for (let i = 0; i < t.arcs.length; i++) {
    const a = t.arcs[i]
    const p = `${path}.arcs[${i}]`
    if (!Array.isArray(a)) { report(rd, 'error', 'bad_geo', p, 'An arc must be an array of positions.'); return null }
    vertices += a.length
    if (vertices > GEO_LIMITS.maxVertices) return { features: [], vertices }
    let x = 0, y = 0
    const out: number[][] = []
    for (let k = 0; k < a.length; k++) {
      const pos = a[k]
      if (!Array.isArray(pos) || pos.length < 2 || typeof pos[0] !== 'number' || typeof pos[1] !== 'number' || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) {
        report(rd, 'error', 'bad_geo', `${p}[${k}]`, 'An arc position must be two finite numbers.')
        return null
      }
      if (quantized) { x += pos[0]; y += pos[1] } else { x = pos[0]; y = pos[1] }
      const lng = x * scale[0] + translate[0]
      const lat = y * scale[1] + translate[1]
      if (!checkPosition(lng, lat, rd, `${p}[${k}]`)) return null
      out.push([lng, lat])
    }
    arcs.push(out)
  }
  const ringOf = (ids: unknown, p: string): number[][] | null => {
    if (!Array.isArray(ids) || !ids.length) { report(rd, 'error', 'bad_geo', p, 'A ring must be a non-empty array of arc indexes.'); return null }
    const ring: number[][] = []
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k]
      const idx = typeof id === 'number' && Number.isInteger(id) ? (id < 0 ? ~id : id) : -1
      if (idx < 0 || idx >= arcs.length) { report(rd, 'error', 'bad_geo', `${p}[${k}]`, `Arc index ${JSON.stringify(id)} does not exist (there are ${arcs.length} arcs).`); return null }
      const arc = (id as number) < 0 ? [...arcs[idx]].reverse() : arcs[idx]
      for (let j = ring.length ? 1 : 0; j < arc.length; j++) ring.push(arc[j])
    }
    return closeRing(ring, rd, p)
  }
  const polyOf = (rings: unknown, p: string): number[][][] | null => {
    if (!Array.isArray(rings)) { report(rd, 'error', 'bad_geo', p, 'A polygon must be an array of rings.'); return null }
    const out: number[][][] = []
    for (let k = 0; k < rings.length; k++) {
      const r = ringOf(rings[k], `${p}[${k}]`)
      if (!r) return null
      if (!r.length && k === 0) break
      if (r.length) out.push(r)
    }
    return out
  }
  const geoms = obj.type === 'GeometryCollection' ? obj.geometries : [obj]
  const objPath = `${path}.objects.${objName}`
  if (!Array.isArray(geoms)) { report(rd, 'error', 'bad_geo', `${objPath}.geometries`, 'A GeometryCollection needs a "geometries" array.'); return null }
  const features: RawFeature[] = []
  geoms.forEach((g, i) => {
    const p = obj.type === 'GeometryCollection' ? `${objPath}.geometries[${i}]` : objPath
    if (!isObj(g)) return report(rd, 'error', 'bad_geo', p, 'A geometry must be an object.')
    const props = isObj(g.properties) ? g.properties : {}
    let polys: RawPolys | null = null
    if (g.type === 'Polygon') {
      const pl = polyOf(g.arcs, `${p}.arcs`)
      polys = pl ? (pl.length ? [pl] : []) : null
    } else if (g.type === 'MultiPolygon') {
      if (!Array.isArray(g.arcs)) return report(rd, 'error', 'bad_geo', `${p}.arcs`, 'A MultiPolygon needs an array of polygons.')
      polys = []
      for (let k = 0; k < g.arcs.length; k++) {
        const pl = polyOf(g.arcs[k], `${p}.arcs[${k}]`)
        if (!pl) { polys = null; break }
        if (pl.length) polys.push(pl)
      }
    } else if (g.type === null || g.type === undefined) return report(rd, 'warning', 'geo_feature_skipped', p, 'Geometry has no type; it is skipped.')
    else return report(rd, 'warning', 'geo_feature_skipped', p, `${String(g.type)} geometry is not a region; it is skipped.`)
    if (polys) features.push({ id: g.id, properties: props, polys, path: p })
  })
  return { features, vertices }
}

/** Unwrap longitudes so a ring never jumps across ±180, then pack as Float64Array. */
function unwrap(ring: number[][]): Ring {
  const out = new Float64Array(ring.length * 2)
  let prev = ring[0][0]
  let shift = 0
  for (let i = 0; i < ring.length; i++) {
    let lng = ring[i][0] + shift
    if (i > 0) {
      while (lng - prev > 180) { lng -= 360; shift -= 360 }
      while (lng - prev < -180) { lng += 360; shift += 360 }
    }
    out[i * 2] = lng
    out[i * 2 + 1] = ring[i][1]
    prev = lng
  }
  return out
}

/** Signed area of a ring in degrees² (planar), positive when counter-clockwise. */
export function ringArea(r: Ring): number {
  let a = 0
  for (let i = 0; i + 3 < r.length; i += 2) a += r[i] * r[i + 3] - r[i + 2] * r[i + 1]
  return a / 2
}

function toRegion(key: string, name: string, disputed: boolean, polys: RawPolys): GeoRegion | null {
  const polygons: Ring[][] = []
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  let best: Ring | null = null
  let bestArea = -1
  for (const poly of polys) {
    const rings = poly.map(unwrap)
    // Keep an outer ring whose holes unwrapped near it: shift holes by 360 if they landed a turn away.
    const outer = rings[0]
    for (let k = 1; k < rings.length; k++) {
      const d = Math.round((rings[k][0] - outer[0]) / 360) * 360
      if (d) for (let i = 0; i < rings[k].length; i += 2) rings[k][i] -= d
    }
    polygons.push(rings)
    for (let i = 0; i < outer.length; i += 2) {
      w = Math.min(w, outer[i]); e = Math.max(e, outer[i]); s = Math.min(s, outer[i + 1]); n = Math.max(n, outer[i + 1])
    }
    const area = Math.abs(ringArea(outer))
    if (area > bestArea) { bestArea = area; best = outer }
  }
  if (!best) return null
  return { key, name, disputed, polygons, bbox: [w, s, e, n], center: centroid(best) }
}

/** Planar centroid of a ring (falls back to the bbox centre for degenerate rings); longitude wrapped to -180..180. */
export function centroid(r: Ring): [number, number] {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i + 3 < r.length; i += 2) {
    const f = r[i] * r[i + 3] - r[i + 2] * r[i + 1]
    a += f
    cx += (r[i] + r[i + 2]) * f
    cy += (r[i + 1] + r[i + 3]) * f
  }
  let lng: number, lat: number
  if (Math.abs(a) < 1e-12) {
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity
    for (let i = 0; i < r.length; i += 2) { w = Math.min(w, r[i]); e = Math.max(e, r[i]); s = Math.min(s, r[i + 1]); n = Math.max(n, r[i + 1]) }
    lng = (w + e) / 2
    lat = (s + n) / 2
  } else {
    lng = cx / (3 * a)
    lat = cy / (3 * a)
  }
  return [wrapLng(lng), lat]
}

export const wrapLng = (lng: number): number => {
  const v = ((((lng + 180) % 360) + 360) % 360) - 180
  return v === -180 && lng > 0 ? 180 : v
}

/** Resolve a spec's `geo` value: a registered name or an inline object. */
export function resolveGeo(value: unknown, issues: Issue[], path = 'geo'): Geography | null {
  if (typeof value === 'string') {
    const g = registry.get(value)
    if (g) return g
    const names = [...registry.keys()]
    const near = closest(value, names)
    issues.push({
      severity: 'error', code: 'unknown_geography', path,
      message: `No geography named "${value}" is registered.`,
      hint: names.length
        ? `${near ? `Did you mean "${near}"? ` : ''}Registered: ${names.slice(0, 20).join(', ')}.`
        : 'Super Plot ships no boundaries. Import the dataset you have chosen with registerGeography(name, geojsonOrTopojson, preset), or put a small FeatureCollection inline.'
    })
    return null
  }
  if (!value || typeof value !== 'object') return readGeography(value, {}, issues, path)
  // An inline geography is read once per object, however often the spec is validated or drawn.
  let hit = inlineCache.get(value)
  if (!hit || hit.path !== path) {
    const own: Issue[] = []
    hit = { geo: readGeography(value, {}, own, path), issues: own, path }
    inlineCache.set(value, hit)
  }
  issues.push(...hit.issues)
  return hit.geo
}

const inlineCache = new WeakMap<object, { geo: Geography | null; issues: Issue[]; path: string }>()

/** Match a data value to a region key (key, name or alias; case and spacing ignored). */
export const matchRegion = (geo: Geography, value: unknown): string | undefined => geo.lookup.get(normalizeRegion(value))
