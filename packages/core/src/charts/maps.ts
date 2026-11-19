/**
 * Maps: data joined to region boundaries or placed by longitude/latitude, drawn flat or on a globe, with
 * optional heights (raised regions, columns, arcs). Super Plot ships no boundaries: `geo` names a geography
 * the host registered (`registerGeography`) or carries a small one inline.
 */
import type { ChartDef } from '../registry.js'
import type { ChartCtx } from '../context.js'
import type { FieldMap, ValidateCtx } from '../schema.js'
import type { SeriesInfo, Tip } from '../scene.js'
import { distinct } from '../data.js'
import { extent, toNumber } from '../util/num.js'
import { clip } from '../util/text.js'
import { mix } from '../util/color.js'
import { tokenValue } from '../theme.js'
import { formatter, lead, fmtList } from './shared.js'
import { matchRegion, normalizeRegion, resolveGeo, type Geography } from '../geo/geography.js'
import { makeView, type Camera, type GeoViewKind, type Projection, type ViewInput } from '../geo/view.js'
import { arcHeight, drawGeo, type ArcDraw, type ColumnDraw, type PointDraw, type RegionDraw } from '../geo/draw.js'
import { closest } from '../util/num.js'

type Spec = Record<string, any>
type R = Record<string, unknown>

// ---- shared fields -------------------------------------------------------------------------

const viewField = (def: GeoViewKind): FieldMap[string] => ({ kind: 'enum', values: ['flat', 'globe'], default: def, desc: '`flat`: a world projection fitted to the data (tilt it with camera.pitch). `globe`: a sphere the viewer can turn.' })

const MAP_FIELDS: FieldMap = {
  projection: { kind: 'enum', values: ['equal-earth', 'mercator', 'equirectangular'], default: 'equal-earth', desc: 'Flat view only. `equal-earth` keeps areas true (best for comparing regions); `mercator` keeps shapes for zoomed-in maps.' },
  camera: { kind: 'camera', desc: 'Starting view: {lng, lat} centre in degrees, zoom (1 fits the data), pitch (0-70 degrees of tilt, flat view) and bearing (degrees). The viewer can drag and zoom from there.' },
  disputed: { kind: 'enum', values: ['same', 'dashed', 'muted'], default: 'same', desc: 'How to draw regions your geography marks as disputed: `same` as any other (no judgement), `dashed` outline, or `muted` fill with a dashed outline. Super Plot never decides what is disputed.' },
  graticule: { kind: 'boolean', desc: 'Draw meridians and parallels every 30 degrees. Default: on for the globe and for flat maps without geo, off otherwise.' }
}

const geoField = (required: boolean, what: string): FieldMap[string] => ({ kind: 'geo', required, desc: `${what} The name of a geography registered with registerGeography (Super Plot ships none), or an inline GeoJSON FeatureCollection / TopoJSON Topology (key: feature id, else properties.id, else properties.name).` })

// ---- an invented example geography (no real place, so no political claim) -------------------

/** Hexagonal regions around 0°, 0° in the open sea: a made-up archipelago for examples and tests. */
function exampleIslands(): R {
  const names = ['Alba', 'Brio', 'Cora', 'Dune', 'Echo', 'Fern', 'Gale', 'Haze', 'Iris', 'Jade', 'Kite', 'Lumen', 'Mira', 'Nova', 'Opal', 'Pike', 'Quill', 'Reed', 'Sol']
  const cells: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2], [2, -1], [-2, 1], [1, 1], [-1, -1], [2, -2], [-2, 2], [1, -2], [-1, 2]]
  const R0 = 2
  const features = cells.map(([q, r], i) => {
    const cx = R0 * Math.sqrt(3) * (q + r / 2)
    const cy = R0 * 1.5 * r
    const ring = Array.from({ length: 7 }, (_, k) => {
      const a = (Math.PI / 180) * (60 * (k % 6) - 30)
      return [Math.round((cx + R0 * 0.96 * Math.cos(a)) * 1000) / 1000, Math.round((cy + R0 * 0.96 * Math.sin(a)) * 1000) / 1000]
    })
    return { type: 'Feature', id: names[i], properties: { name: names[i] }, geometry: { type: 'Polygon', coordinates: [ring] } }
  })
  return { type: 'FeatureCollection', features }
}
const ISLANDS = exampleIslands()

// ---- helpers -------------------------------------------------------------------------------

const geoOf = (spec: Spec): Geography | null => (spec.geo === undefined ? null : resolveGeo(spec.geo, []))

function focusOf(boxes: [number, number, number, number][], pad = 0.08, minSpan = 6): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const b of boxes) { w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]) }
  if (!Number.isFinite(w)) return [-180, -60, 180, 80]
  if (e - w >= 300) { w = -180; e = 180 }
  const pw = Math.max((e - w) * pad, (minSpan - (e - w)) / 2, 0)
  const ph = Math.max((n - s) * pad, (minSpan - (n - s)) / 2, 0)
  return [Math.max(-180, w - pw), Math.max(-89, s - ph), Math.min(e > 180 ? e + pw : 180, e + pw), Math.min(89, n + ph)]
}

interface MapFrame { input: ViewInput; rect: { x: number; y: number; w: number; h: number } }

function mapView(c: ChartCtx, rect: MapFrame['rect'], focus: [number, number, number, number], lift: number, cameraDefaults: Partial<Camera> = {}): ViewInput {
  const s = c.spec
  return {
    kind: s.view as GeoViewKind,
    projection: s.projection as Projection,
    rect,
    focus,
    camera: { ...cameraDefaults, ...(s.camera ?? {}), ...(c.env.camera ?? {}) },
    lift
  }
}

const sphereOf = (c: ChartCtx): { fill: string; stroke: string } => ({ fill: c.c('ocean'), stroke: c.c('axis') })
/** Meridians and parallels: on the globe, and on flat maps with no land to read positions from. */
const graticuleOf = (c: ChartCtx): string | null => ((c.spec.graticule ?? (c.spec.view === 'globe' || c.spec.geo === undefined)) ? c.c('grid') : null)

/** Regions of the geography that carry no data: the land under bubbles, columns and arcs. */
function basemap(c: ChartCtx, geo: Geography | null, skip = new Set<string>()): RegionDraw[] {
  if (!geo) return []
  const land = c.c('land')
  const border = c.c('background')
  return geo.regions.filter(r => !skip.has(r.key)).map(r => ({
    polygons: r.polygons, bbox: r.bbox, center: r.center, fill: land, stroke: border, strokeWidth: 0.6, height: 0,
    ...(r.disputed && c.spec.disputed !== 'same' ? { dashed: true } : {})
  }))
}

/** Rows to places: longitude/latitude columns, or a region's representative point. */
function placeOf(spec: Spec, geo: Geography | null, r: R, lat = 'lat', lng = 'lng', region = 'region'): { lng: number; lat: number; name: string | null } | null {
  if (spec[lat] && spec[lng]) {
    const la = toNumber(r[spec[lat]])
    const lo = toNumber(r[spec[lng]])
    if (la === null || lo === null || Math.abs(la) > 90 || Math.abs(lo) > 180) return null
    return { lng: lo, lat: la, name: null }
  }
  if (spec[region] && geo) {
    const key = matchRegion(geo, r[spec[region]])
    const g = key ? geo.byKey.get(key) : undefined
    return g ? { lng: g.center[0], lat: g.center[1], name: g.name } : null
  }
  return null
}

const DISPUTED_NOTE = { label: 'Note', value: 'Marked disputed in the source data' }

function colorbar(c: ChartCtx, x: number, y: number, w: number, lo: number, hi: number, colorAt: (t: number) => string): void {
  const n = 32
  for (let i = 0; i < n; i++) c.marks.push({ type: 'rect', role: 'legend', x: x + (w / n) * i, y, w: w / n + 0.5, h: 8, fill: colorAt(i / (n - 1)) })
  c.marks.push(c.text(x, y + 12, c.format(lo), { role: 'legend', baseline: 'hanging', size: c.size - 1 }))
  c.marks.push(c.text(x + w, y + 12, c.format(hi), { role: 'legend', baseline: 'hanging', anchor: 'end', size: c.size - 1 }))
}

/** Warn about data values that name no region; error when none match at all. */
function checkRegions(spec: Spec, ctx: ValidateCtx, fields: string[]): void {
  const geo = geoOf(spec)
  if (!geo) return
  const names = geo.regions.map(r => r.name)
  for (const field of fields) {
    const col = spec[field]
    if (!col) continue
    const seen = new Map<string, string>()
    for (const r of ctx.rows) {
      const v = r[col]
      if (v === null || v === undefined || v === '') continue
      const k = normalizeRegion(v)
      if (!seen.has(k)) seen.set(k, String(v).trim())
    }
    const unmatched = [...seen.entries()].filter(([k]) => !geo.lookup.has(k)).map(([, raw]) => raw)
    if (!unmatched.length) continue
    const where = typeof spec.geo === 'string' ? `geography "${spec.geo}"` : 'the inline geography'
    if (unmatched.length === seen.size) {
      ctx.issues.push({ severity: 'error', code: 'no_regions_matched', path: field, message: `None of the ${seen.size} values in "${col}" match a region of ${where}.`, hint: `Regions are matched by key, name or alias (case ignored). Some keys: ${fmtList(geo.regions.slice(0, 8).map(r => r.key), 8)}.` })
      continue
    }
    const near = unmatched.slice(0, 5).map(u => [u, closest(u, names)] as const).filter(([, m]) => m)
    ctx.issues.push({
      severity: 'warning', code: 'unmatched_regions', path: field,
      message: `${unmatched.length} of ${seen.size} values in "${col}" match no region of ${where} and are left out: ${fmtList(unmatched.map(u => clip(u, 40)), 8)}.`,
      ...(near.length ? { hint: `Did you mean ${near.map(([u, m]) => `"${m}" for "${clip(u, 40)}"`).join(', ')}? Or add aliases when registering the geography.` } : { hint: 'Add aliases when registering the geography, or fix the names in the data.' })
    })
  }
}

function checkPlaces(spec: Spec, ctx: ValidateCtx, lat: string, lng: string, region: string | null): boolean {
  const hasLL = !!(spec[lat] && spec[lng])
  if (spec[lat] && !spec[lng]) { ctx.issues.push({ severity: 'error', code: 'missing_required', path: lng, message: `"${lat}" is set, so "${lng}" is needed too.` }); return false }
  if (spec[lng] && !spec[lat]) { ctx.issues.push({ severity: 'error', code: 'missing_required', path: lat, message: `"${lng}" is set, so "${lat}" is needed too.` }); return false }
  if (hasLL) return true
  if (region && spec[region]) {
    if (spec.geo === undefined) { ctx.issues.push({ severity: 'error', code: 'missing_required', path: 'geo', message: `"${region}" places rows at regions, which needs a geography.`, hint: 'Set geo to a registered geography, or give lat and lng columns instead.' }); return false }
    return true
  }
  ctx.issues.push({ severity: 'error', code: 'missing_required', path: lat, message: `Give "${lat}" and "${lng}" columns${region ? `, or "${region}" with a geography` : ''}.`, hint: 'Longitude and latitude in degrees (WGS 84).' })
  return false
}

// ---- choropleth ----------------------------------------------------------------------------

interface Val { key: string; label: string; value: number }

function regionValues(spec: Spec, geo: Geography | null): Val[] {
  const sums = new Map<string, Val>()
  for (const r of spec.data as R[]) {
    const v = toNumber(r[spec.value])
    if (v === null) continue
    const raw = r[spec.region]
    if (raw === null || raw === undefined || raw === '') continue
    const key = geo ? matchRegion(geo, raw) : String(raw).trim()
    if (!key) continue
    const cur = sums.get(key)
    if (cur) cur.value += v
    else sums.set(key, { key, label: geo?.byKey.get(key)?.name ?? String(raw).trim(), value: v })
  }
  return [...sums.values()]
}

/** Describe-side values: grouped by the data's own spelling, so every language reads them the same way. */
function rawValues(spec: Spec): Val[] {
  const sums = new Map<string, Val>()
  for (const r of spec.data as R[]) {
    const v = toNumber(r[spec.value])
    const raw = r[spec.region]
    if (v === null || raw === null || raw === undefined || raw === '') continue
    const key = String(raw).trim()
    const cur = sums.get(key)
    if (cur) cur.value += v
    else sums.set(key, { key, label: key, value: v })
  }
  return [...sums.values()]
}

function choroplethCompile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const geo = geoOf(s)!
  const vals = regionValues(s, geo)
  const byKey = new Map(vals.map(v => [v.key, v]))
  const ex = extent(vals.map(v => v.value)) ?? [0, 1]
  const lo = s.domain?.[0] ?? ex[0]
  const hi = s.domain?.[1] ?? ex[1]
  const diverging = s.scale === 'diverging'
  const mid = diverging ? (lo < 0 && hi > 0 ? 0 : (lo + hi) / 2) : lo
  const T = (k: string): string => tokenValue(c.theme, k)
  const colorAt = (t: number): string => {
    const u = Math.max(0, Math.min(1, t))
    if (!diverging) return mix(T('seq-low'), T('seq-high'), u)
    return u < 0.5 ? mix(T('div-low'), T('div-mid'), u * 2) : mix(T('div-mid'), T('div-high'), (u - 0.5) * 2)
  }
  const tOf = (v: number): number => {
    if (!diverging) return hi === lo ? 1 : (v - lo) / (hi - lo)
    if (v < mid) return mid === lo ? 0.5 : 0.5 * ((v - lo) / (mid - lo))
    return hi === mid ? 0.5 : 0.5 + 0.5 * ((v - mid) / (hi - mid))
  }
  const frame = c.frame({ series: [] })
  const barH = 34
  const rect = { x: frame.x, y: frame.y, w: frame.w, h: Math.max(40, frame.h - barH) }
  const fmt = c.format
  const extrude = s.extrude === true
  const focus = focusOf(vals.length ? vals.map(v => geo.byKey.get(v.key)!.bbox) : [geo.bbox])
  const input = mapView(c, rect, focus, extrude ? 0.32 : 0, extrude && s.view === 'flat' ? { pitch: 40 } : {})
  const view = makeView(input)
  const border = c.c('background')
  const nodata = c.c('nodata')
  const regions: RegionDraw[] = geo.regions.map(g => {
    const v = byKey.get(g.key)
    const disputed = g.disputed && s.disputed !== 'same'
    if (!v) return { polygons: g.polygons, bbox: g.bbox, center: g.center, fill: nodata, stroke: border, strokeWidth: 0.6, height: 0, ...(disputed ? { dashed: true } : {}) }
    const muted = g.disputed && s.disputed === 'muted'
    const fill = muted ? T('nodata') : colorAt(tOf(v.value))
    const tip: Tip = { title: clip(g.name, 60), rows: [{ label: String(s.value), value: fmt(v.value), color: fill }, ...(disputed ? [DISPUTED_NOTE] : [])] }
    const t = Math.max(0, Math.min(1, hi === lo ? 1 : (v.value - lo) / (hi - lo)))
    return {
      polygons: g.polygons, bbox: g.bbox, center: g.center, fill, stroke: border, strokeWidth: 0.6, height: extrude ? 0.02 + 0.3 * t : 0,
      ...(disputed ? { dashed: true } : {}), tip, aria: `${g.name}: ${fmt(v.value)}`, datum: { region: g.key, name: g.name, value: v.value }
    }
  })
  const payload = drawGeo(c, { view, input, sphere: s.view === 'globe' ? sphereOf(c) : null, graticule: graticuleOf(c), regions, points: [], columns: [], arcs: [] })
  c.geo = payload
  if (vals.length) {
    const w = Math.min(220, rect.w * 0.6)
    colorbar(c, frame.x + frame.w - w, frame.y + frame.h - barH + 10, w, lo, hi, colorAt)
    c.marks.push(c.text(frame.x + frame.w - w - 10, frame.y + frame.h - barH + 14, clip(String(s.value), 40), { role: 'legend', anchor: 'end', baseline: 'middle', size: c.size - 1 }))
  }
  return { series: [] }
}

export const choropleth: ChartDef = {
  type: 'choropleth',
  name: 'Choropleth map',
  summary: 'Colours each region of a map by a number; raise regions by the value for a 3D view.',
  useWhen: 'Comparing a rate or share across countries, provinces or districts. Map rates (per person, percent), not raw totals, or big regions dominate. Needs region boundaries (geo). For exact ranking use a sorted bar chart.',
  cartesian: false,
  fields: {
    geo: geoField(true, 'Region boundaries to colour.'),
    region: { kind: 'column', role: 'any', required: true, desc: 'Column naming each row\'s region: its key, name or an alias (case ignored). Rows with the same region are summed.' },
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column that colours the region.' },
    view: viewField('flat'),
    scale: { kind: 'enum', values: ['sequential', 'diverging'], default: 'sequential', desc: '`sequential`: light to dark for magnitude. `diverging`: two hues around 0 (or the middle) for above/below.' },
    domain: { kind: 'domain', desc: 'Fix the colour range, e.g. [0, 100], to compare maps.' },
    extrude: { kind: 'boolean', default: false, desc: 'Raise each region by its value (3D). The flat view tilts to 40 degrees unless the camera says otherwise.' },
    ...MAP_FIELDS
  },
  example: {
    type: 'choropleth', title: 'Rainfall across the Example Islands', subtitle: 'Annual total, mm (invented data on invented islands)', geo: ISLANDS, region: 'island', value: 'rain', format: 'integer',
    data: ['Alba', 'Brio', 'Cora', 'Dune', 'Echo', 'Fern', 'Gale', 'Haze', 'Iris', 'Jade', 'Kite', 'Lumen', 'Mira', 'Nova', 'Opal', 'Pike', 'Quill', 'Reed'].map((island, i) => ({ island, rain: 600 + ((i * 377) % 1500) }))
  },
  check(spec, ctx) {
    checkRegions(spec, ctx, ['region'])
    if (!ctx.issues.some(i => i.severity === 'error') && !rawValues({ ...spec, data: ctx.rows }).length) ctx.issues.push({ severity: 'error', code: 'no_values', path: 'value', message: 'No row has both a region and a numeric value.' })
  },
  compile: choroplethCompile,
  describe(spec, env) {
    const vals = rawValues(spec)
    const f = formatter(spec, env.locale)
    const on = typeof spec.geo === 'string' ? ` of "${clip(spec.geo, 64)}"` : ''
    if (!vals.length) return `${lead(spec, 'Choropleth map')} No values.`
    const max = vals.reduce((a, b) => (b.value > a.value ? b : a))
    const min = vals.reduce((a, b) => (b.value < a.value ? b : a))
    return `${lead(spec, 'Choropleth map')} ${vals.length} regions${on} coloured by ${spec.value}${spec.extrude ? ' and raised by it' : ''}. Highest: ${clip(max.label, 40)} (${f(max.value)}). Lowest: ${clip(min.label, 40)} (${f(min.value)}).`
  }
}

// ---- bubble map ----------------------------------------------------------------------------

interface Place { lng: number; lat: number; name: string; size: number | null; s: string; row: R }

function places(spec: Spec, geo: Geography | null): Place[] {
  const out: Place[] = []
  for (const r of spec.data as R[]) {
    const p = placeOf(spec, geo, r)
    if (!p) continue
    const size = spec.size ? toNumber(r[spec.size]) : null
    if (spec.size && (size === null || size < 0)) continue
    out.push({ lng: p.lng, lat: p.lat, name: spec.label ? String(r[spec.label] ?? '') : p.name ?? (spec.region ? String(r[spec.region] ?? '') : ''), size, s: spec.series ? String(r[spec.series] ?? '') : '', row: r })
  }
  return out
}

/** Places for describe: no geography needed (region rows count by name). */
function rawPlaces(spec: Spec): { name: string; size: number | null; s: string }[] {
  const out: { name: string; size: number | null; s: string }[] = []
  for (const r of spec.data as R[]) {
    if (spec.lat && spec.lng) {
      const la = toNumber(r[spec.lat]), lo = toNumber(r[spec.lng])
      if (la === null || lo === null || Math.abs(la) > 90 || Math.abs(lo) > 180) continue
    } else if (spec.region) {
      const v = r[spec.region]
      if (v === null || v === undefined || v === '') continue
    } else continue
    const size = spec.size ? toNumber(r[spec.size]) : null
    if (spec.size && (size === null || size < 0)) continue
    out.push({ name: spec.label ? String(r[spec.label] ?? '') : spec.region ? String(r[spec.region] ?? '').trim() : '', size, s: spec.series ? String(r[spec.series] ?? '') : '' })
  }
  return out
}

function bubbleCompile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const geo = geoOf(s)
  const all = places(s, geo)
  const keys = s.series ? distinct(all.map(p => p.s)) : []
  const series = c.makeSeries(keys)
  const show = all.filter(p => !c.hidden.has(p.s))
  const frame = c.frame({ series, autoSide: 'top' })
  const sizes = extent(show.map(p => p.size).filter((v): v is number => v !== null))
  const dense = show.length > 2000
  const radius = (p: Place): number => (p.size === null || !sizes ? (dense ? 2 : 4.5) : 3 + 21 * Math.sqrt(sizes[1] === 0 ? 1 : p.size / sizes[1]))
  const focus = geo ? focusOf([geo.bbox], 0.02) : focusOf(all.map(p => [p.lng, p.lat, p.lng, p.lat]), 0.12, 8)
  const input = mapView(c, frame, focus, 0)
  const view = makeView(input)
  const fmt = c.format
  const color = (p: Place): string => (s.series ? series[keys.indexOf(p.s)].color : c.seriesColor(String(s.size ?? 'value'), 0))
  // Largest first, so small bubbles stay on top and reachable.
  const order = [...show].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
  const points: PointDraw[] = order.map(p => {
    const rows = [
      ...(s.size && p.size !== null ? [{ label: String(s.size), value: fmt(p.size) }] : []),
      ...(s.series ? [{ label: String(s.series), value: clip(p.s, 40), color: color(p) }] : []),
      { label: 'Lat, lng', value: `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}` }
    ]
    return {
      lng: p.lng, lat: p.lat, r: radius(p), fill: color(p), stroke: dense ? '' : c.c('background'), opacity: p.size !== null ? 0.72 : dense ? 0.6 : 0.85,
      tip: { title: clip(p.name, 60) || undefined, rows }, ...(show.length <= 2000 ? { aria: `${p.name || `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`}${p.size !== null ? `: ${fmt(p.size)}` : ''}` } : {}),
      datum: { lng: p.lng, lat: p.lat, name: p.name, size: p.size, series: p.s }, ...(s.series ? { series: p.s } : {})
    }
  })
  c.geo = drawGeo(c, { view, input, sphere: s.view === 'globe' ? sphereOf(c) : null, graticule: graticuleOf(c), regions: basemap(c, geo), points, columns: [], arcs: [] })
  return { series }
}

const placeFields = (what: string): FieldMap => ({
  lat: { kind: 'column', role: 'lat', desc: `Latitude column, degrees (-90..90). With lng, places each ${what}.` },
  lng: { kind: 'column', role: 'lng', desc: 'Longitude column, degrees (-180..180).' },
  region: { kind: 'column', role: 'any', desc: `Instead of lat/lng: a region column; each ${what} sits at its region's centre (needs geo).` }
})

export const bubbleMap: ChartDef = {
  type: 'bubble-map',
  name: 'Bubble map',
  summary: 'Places a circle per row on a map by longitude/latitude (or region), sized by a number and coloured by group.',
  useWhen: 'Showing where things are and how big they are: cities, sites, events, stores. Totals belong here rather than on a choropleth. Tens of thousands of points are fine (the web binding switches renderer). Use `geo` only to draw land under the points.',
  cartesian: false,
  fields: {
    geo: geoField(false, 'Optional boundaries drawn as land under the bubbles (needed when placing by region).'),
    ...placeFields('bubble'),
    size: { kind: 'column', role: 'number', desc: 'Numeric column mapped to bubble area (negative values are skipped).' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours bubbles by group.' },
    label: { kind: 'column', role: 'any', desc: 'Column used as each bubble\'s name in the tooltip.' },
    view: viewField('flat'),
    ...MAP_FIELDS
  },
  example: {
    type: 'bubble-map', title: 'Harbour traffic, Example Islands', subtitle: 'Ships per week (invented)', geo: ISLANDS, lat: 'lat', lng: 'lng', size: 'ships', label: 'harbour', series: 'kind',
    data: [
      { harbour: 'North Quay', kind: 'Cargo', lat: 3.4, lng: 1.2, ships: 42 }, { harbour: 'Sol Bay', kind: 'Ferry', lat: -2.1, lng: -3.3, ships: 18 },
      { harbour: 'East Pier', kind: 'Cargo', lat: 0.4, lng: 6.1, ships: 65 }, { harbour: 'Reed Cove', kind: 'Fishing', lat: -4.8, lng: 2.6, ships: 9 },
      { harbour: 'West Point', kind: 'Ferry', lat: 1.1, lng: -6.4, ships: 27 }, { harbour: 'Mira Port', kind: 'Fishing', lat: 5.2, lng: -2.2, ships: 14 }
    ]
  },
  check(spec, ctx) {
    if (!checkPlaces(spec, ctx, 'lat', 'lng', 'region')) return
    if (!spec.lat) checkRegions(spec, ctx, ['region'])
    if (!ctx.issues.some(i => i.severity === 'error') && !rawPlaces({ ...spec, data: ctx.rows }).length) ctx.issues.push({ severity: 'error', code: 'no_points', path: 'data', message: 'No row has a usable place (and size, when set).' })
  },
  compile: bubbleCompile,
  describe(spec, env) {
    const ps = rawPlaces(spec)
    const f = formatter(spec, env.locale)
    const groups = spec.series ? distinct(ps.map(p => p.s)) : []
    let t = `${lead(spec, 'Bubble map')} ${ps.length} places${spec.size ? ` sized by ${spec.size}` : ''}${groups.length > 1 ? `, in ${groups.length} groups (${fmtList(groups)})` : ''}.`
    const sized = ps.filter(p => p.size !== null)
    if (sized.length) {
      const big = sized.reduce((a, b) => ((b.size as number) > (a.size as number) ? b : a))
      t += ` Largest: ${clip(big.name || 'unnamed', 40)} (${f(big.size as number)}).`
    }
    return t
  }
}

// ---- column map ----------------------------------------------------------------------------

function columnCompile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const geo = geoOf(s)
  const rows: { p: Place; v: number }[] = []
  for (const r of s.data as R[]) {
    const p = placeOf(s, geo, r)
    const v = toNumber(r[s.value])
    if (!p || v === null || v < 0) continue
    rows.push({ p: { lng: p.lng, lat: p.lat, name: s.label ? String(r[s.label] ?? '') : p.name ?? (s.region ? String(r[s.region] ?? '') : ''), size: v, s: s.series ? String(r[s.series] ?? '') : '', row: r }, v })
  }
  const keys = s.series ? distinct(rows.map(x => x.p.s)) : []
  const series = c.makeSeries(keys)
  const show = rows.filter(x => !c.hidden.has(x.p.s))
  const frame = c.frame({ series, autoSide: 'top' })
  const max = Math.max(...show.map(x => x.v), 0)
  const focus = geo ? focusOf([geo.bbox], 0.02) : focusOf(rows.map(x => [x.p.lng, x.p.lat, x.p.lng, x.p.lat]), 0.15, 10)
  const input = mapView(c, frame, focus, 0.38, s.view === 'flat' ? { pitch: 45 } : {})
  const view = makeView(input)
  const fmt = c.format
  const width = show.length > 400 ? 3 : show.length > 120 ? 5 : 8
  const columns: ColumnDraw[] = show.map(({ p, v }) => {
    const fill = s.series ? series[keys.indexOf(p.s)].color : c.seriesColor(String(s.value), 0)
    return {
      lng: p.lng, lat: p.lat, height: max > 0 ? 0.01 + 0.36 * (v / max) : 0.01, width, fill,
      tip: { title: clip(p.name, 60) || undefined, rows: [{ label: String(s.value), value: fmt(v), color: fill }, ...(s.series ? [{ label: String(s.series), value: clip(p.s, 40) }] : [])] },
      aria: `${p.name || `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`}: ${fmt(v)}`, datum: { lng: p.lng, lat: p.lat, name: p.name, value: v, series: p.s }, ...(s.series ? { series: p.s } : {})
    }
  })
  c.geo = drawGeo(c, { view, input, sphere: s.view === 'globe' ? sphereOf(c) : null, graticule: graticuleOf(c), regions: basemap(c, geo), points: [], columns, arcs: [] })
  return { series }
}

export const columnMap: ChartDef = {
  type: 'column-map',
  name: '3D column map',
  summary: 'Raises a column per row from its place on a globe or a tilted map, height by a number.',
  useWhen: 'Showing totals at places in 3D (population of cities, sales per store) where a bubble would overlap. Tall columns hide what is behind them: let the viewer turn the map, and give a ranked list too. For exact comparison use a bar chart.',
  cartesian: false,
  fields: {
    geo: geoField(false, 'Optional boundaries drawn as land under the columns (needed when placing by region).'),
    ...placeFields('column'),
    value: { kind: 'column', role: 'number', required: true, desc: 'Numeric column giving each column\'s height (negative values are skipped).' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours columns by group.' },
    label: { kind: 'column', role: 'any', desc: 'Column used as each column\'s name in the tooltip.' },
    view: viewField('globe'),
    ...MAP_FIELDS
  },
  example: {
    type: 'column-map', title: 'Readings by station', subtitle: 'Invented monitoring network', lat: 'lat', lng: 'lng', value: 'reading', label: 'station', series: 'network', camera: { lng: 20, lat: 15 },
    data: [
      { station: 'A1', network: 'Coastal', lat: 38, lng: -9, reading: 42 }, { station: 'B2', network: 'Coastal', lat: -34, lng: 18, reading: 77 },
      { station: 'C3', network: 'Inland', lat: 9, lng: 38, reading: 55 }, { station: 'D4', network: 'Inland', lat: 52, lng: 13, reading: 31 },
      { station: 'E5', network: 'Coastal', lat: 25, lng: 55, reading: 90 }, { station: 'F6', network: 'Inland', lat: 15, lng: -17, reading: 23 },
      { station: 'G7', network: 'Coastal', lat: 60, lng: 25, reading: 18 }, { station: 'H8', network: 'Inland', lat: -1, lng: 37, reading: 64 }
    ]
  },
  check(spec, ctx) {
    if (!checkPlaces(spec, ctx, 'lat', 'lng', 'region')) return
    if (!spec.lat) checkRegions(spec, ctx, ['region'])
    let neg = 0
    for (const r of ctx.rows) { const v = toNumber(r[spec.value as string]); if (v !== null && v < 0) neg++ }
    if (neg) ctx.issues.push({ severity: 'warning', code: 'negative_skipped', path: 'value', message: `${neg} negative values are skipped: a column cannot be lower than the ground.`, hint: 'Use a choropleth with scale "diverging" for values above and below zero.' })
  },
  compile: columnCompile,
  describe(spec, env) {
    const f = formatter(spec, env.locale)
    const cols: { name: string; v: number; s: string }[] = []
    for (const r of spec.data as R[]) {
      const v = toNumber(r[spec.value])
      if (v === null || v < 0) continue
      if (spec.lat && spec.lng) {
        const la = toNumber(r[spec.lat]), lo = toNumber(r[spec.lng])
        if (la === null || lo === null || Math.abs(la) > 90 || Math.abs(lo) > 180) continue
      } else if (!spec.region || r[spec.region] === null || r[spec.region] === undefined || r[spec.region] === '') continue
      cols.push({ name: spec.label ? String(r[spec.label] ?? '') : spec.region ? String(r[spec.region] ?? '').trim() : '', v, s: spec.series ? String(r[spec.series] ?? '') : '' })
    }
    if (!cols.length) return `${lead(spec, '3D column map')} No values.`
    const top = cols.reduce((a, b) => (b.v > a.v ? b : a))
    const total = cols.reduce((q, x) => q + x.v, 0)
    const groups = spec.series ? distinct(cols.map(x => x.s)) : []
    return `${lead(spec, '3D column map')} ${cols.length} columns of ${spec.value} on a ${spec.view === 'flat' ? 'tilted map' : 'globe'}${groups.length > 1 ? `, in ${groups.length} groups (${fmtList(groups)})` : ''}, totalling ${f(total)}. Tallest: ${clip(top.name || 'unnamed', 40)} (${f(top.v)}).`
  }
}

// ---- flow map ------------------------------------------------------------------------------

interface Flow { a: [number, number]; b: [number, number]; from: string; to: string; v: number | null; s: string }

function flows(spec: Spec, geo: Geography | null): Flow[] {
  const out: Flow[] = []
  for (const r of spec.data as R[]) {
    const a = placeOf(spec, geo, r, 'fromLat', 'fromLng', 'from')
    const b = placeOf(spec, geo, r, 'toLat', 'toLng', 'to')
    if (!a || !b) continue
    const v = spec.value ? toNumber(r[spec.value]) : null
    if (spec.value && (v === null || v < 0)) continue
    out.push({ a: [a.lng, a.lat], b: [b.lng, b.lat], from: spec.from ? String(r[spec.from] ?? '').trim() : a.name ?? '', to: spec.to ? String(r[spec.to] ?? '').trim() : b.name ?? '', v, s: spec.series ? String(r[spec.series] ?? '') : '' })
  }
  return out
}

function rawFlows(spec: Spec): { from: string; to: string; v: number | null; s: string }[] {
  const out: { from: string; to: string; v: number | null; s: string }[] = []
  const ok = (r: R, lat: string, lng: string, region: string): boolean => {
    if (spec[lat] && spec[lng]) {
      const la = toNumber(r[spec[lat]]), lo = toNumber(r[spec[lng]])
      return la !== null && lo !== null && Math.abs(la) <= 90 && Math.abs(lo) <= 180
    }
    const v = spec[region] ? r[spec[region]] : undefined
    return v !== null && v !== undefined && v !== ''
  }
  for (const r of spec.data as R[]) {
    if (!ok(r, 'fromLat', 'fromLng', 'from') || !ok(r, 'toLat', 'toLng', 'to')) continue
    const v = spec.value ? toNumber(r[spec.value]) : null
    if (spec.value && (v === null || v < 0)) continue
    out.push({ from: spec.from ? String(r[spec.from] ?? '').trim() : '', to: spec.to ? String(r[spec.to] ?? '').trim() : '', v, s: spec.series ? String(r[spec.series] ?? '') : '' })
  }
  return out
}

function flowCompile(c: ChartCtx): { series: SeriesInfo[] } {
  const s = c.spec
  const geo = geoOf(s)
  const all = flows(s, geo)
  const keys = s.series ? distinct(all.map(f => f.s)) : []
  const series = c.makeSeries(keys)
  const show = all.filter(f => !c.hidden.has(f.s))
  const frame = c.frame({ series, autoSide: 'top' })
  const max = Math.max(...show.map(f => f.v ?? 0), 0)
  const boxes = all.flatMap(f => [[f.a[0], f.a[1], f.a[0], f.a[1]], [f.b[0], f.b[1], f.b[0], f.b[1]]] as [number, number, number, number][])
  const focus = geo ? focusOf([geo.bbox], 0.02) : focusOf(boxes, 0.15, 10)
  const input = mapView(c, frame, focus, 0.36)
  const view = makeView(input)
  const fmt = c.format
  const label = (f: Flow): string => `${clip(f.from || 'origin', 30)} → ${clip(f.to || 'destination', 30)}`
  const arcs: ArcDraw[] = show.map(f => {
    const stroke = s.series ? series[keys.indexOf(f.s)].color : c.seriesColor(String(s.value ?? 'flow'), 0)
    return {
      from: f.a, to: f.b, height: arcHeight(f.a, f.b, view.kind === 'globe' ? 1 : 0.9), width: f.v === null || max === 0 ? 1.6 : 1 + 5 * Math.sqrt(f.v / max), stroke, opacity: 0.85,
      tip: { title: label(f), rows: [...(f.v !== null ? [{ label: String(s.value), value: fmt(f.v), color: stroke }] : []), ...(s.series ? [{ label: String(s.series), value: clip(f.s, 40) }] : [])] },
      aria: `${label(f)}${f.v !== null ? `: ${fmt(f.v)}` : ''}`, datum: { from: f.from, to: f.to, value: f.v, series: f.s }, ...(s.series ? { series: f.s } : {})
    }
  })
  // End points: one small dot per distinct place.
  const ends = new Map<string, PointDraw>()
  for (const f of show) {
    for (const [p, name] of [[f.a, f.from], [f.b, f.to]] as const) {
      const k = `${p[0]},${p[1]}`
      if (!ends.has(k)) ends.set(k, { lng: p[0], lat: p[1], r: 3, fill: c.c('text-muted'), stroke: c.c('background'), opacity: 0.9, tip: name ? { title: clip(name, 60), rows: [] } : undefined })
    }
  }
  c.geo = drawGeo(c, { view, input, sphere: s.view === 'globe' ? sphereOf(c) : null, graticule: graticuleOf(c), regions: basemap(c, geo), points: [...ends.values()], columns: [], arcs })
  return { series }
}

export const flowMap: ChartDef = {
  type: 'flow-map',
  name: 'Flow map',
  summary: 'Draws an arc from origin to destination per row, width by a number, on a globe or a flat map.',
  useWhen: 'Showing movement between places: trade, migration, flights, shipments. Keep it to the biggest flows (a few hundred at most) or the map turns to string. Origins and destinations are lat/lng columns, or regions with a geography.',
  cartesian: false,
  fields: {
    geo: geoField(false, 'Optional boundaries drawn as land (needed when from/to name regions).'),
    from: { kind: 'column', role: 'any', desc: 'Origin region column (needs geo), or the origin\'s name when fromLat/fromLng are given.' },
    to: { kind: 'column', role: 'any', desc: 'Destination region column (needs geo), or the destination\'s name.' },
    fromLat: { kind: 'column', role: 'lat', desc: 'Origin latitude column, degrees.' },
    fromLng: { kind: 'column', role: 'lng', desc: 'Origin longitude column, degrees.' },
    toLat: { kind: 'column', role: 'lat', desc: 'Destination latitude column, degrees.' },
    toLng: { kind: 'column', role: 'lng', desc: 'Destination longitude column, degrees.' },
    value: { kind: 'column', role: 'number', desc: 'Numeric column giving each arc\'s width.' },
    series: { kind: 'column', role: 'any', desc: 'Column that colours arcs by group.' },
    view: viewField('globe'),
    ...MAP_FIELDS
  },
  example: {
    type: 'flow-map', title: 'Shipments between depots', subtitle: 'Containers per month (invented)', from: 'origin', to: 'dest', fromLat: 'olat', fromLng: 'olng', toLat: 'dlat', toLng: 'dlng', value: 'boxes', camera: { lng: 30, lat: 20 },
    data: [
      { origin: 'Depot A', dest: 'Depot C', olat: 38, olng: -9, dlat: 25, dlng: 55, boxes: 1200 }, { origin: 'Depot B', dest: 'Depot C', olat: -34, olng: 18, dlat: 25, dlng: 55, boxes: 640 },
      { origin: 'Depot C', dest: 'Depot D', olat: 25, olng: 55, dlat: 1.3, dlng: 104, boxes: 980 }, { origin: 'Depot A', dest: 'Depot E', olat: 38, olng: -9, dlat: 52, dlng: 13, boxes: 310 },
      { origin: 'Depot E', dest: 'Depot D', olat: 52, olng: 13, dlat: 1.3, dlng: 104, boxes: 450 }
    ]
  },
  check(spec, ctx) {
    const ll = ['fromLat', 'fromLng', 'toLat', 'toLng'].filter(k => spec[k])
    if (ll.length && ll.length < 4) {
      const miss = ['fromLat', 'fromLng', 'toLat', 'toLng'].find(k => !spec[k])!
      ctx.issues.push({ severity: 'error', code: 'missing_required', path: miss, message: 'Give all four of fromLat, fromLng, toLat and toLng, or none of them.' })
      return
    }
    if (!ll.length) {
      if (!spec.from || !spec.to) { ctx.issues.push({ severity: 'error', code: 'missing_required', path: spec.from ? 'to' : 'from', message: 'Give from and to region columns (with geo), or fromLat/fromLng/toLat/toLng columns.' }); return }
      if (spec.geo === undefined) { ctx.issues.push({ severity: 'error', code: 'missing_required', path: 'geo', message: 'from and to name regions, which needs a geography.', hint: 'Set geo to a registered geography, or give fromLat/fromLng/toLat/toLng columns.' }); return }
      checkRegions(spec, ctx, ['from', 'to'])
    }
    if (!ctx.issues.some(i => i.severity === 'error') && !rawFlows({ ...spec, data: ctx.rows }).length) ctx.issues.push({ severity: 'error', code: 'no_points', path: 'data', message: 'No row has a usable origin and destination (and value, when set).' })
  },
  compile: flowCompile,
  describe(spec, env) {
    const fs = rawFlows(spec)
    const f = formatter(spec, env.locale)
    let t = `${lead(spec, 'Flow map')} ${fs.length} flows${spec.value ? ` weighted by ${spec.value}` : ''}.`
    const weighted = fs.filter(x => x.v !== null)
    if (weighted.length) {
      const big = weighted.reduce((a, b) => ((b.v as number) > (a.v as number) ? b : a))
      const total = weighted.reduce((q, x) => q + (x.v as number), 0)
      t += ` Total ${f(total)}. Largest: ${clip(big.from || 'origin', 30)} to ${clip(big.to || 'destination', 30)} (${f(big.v as number)}).`
    }
    return t
  }
}

export const isMapType = (type: string): boolean => type === 'choropleth' || type === 'bubble-map' || type === 'column-map' || type === 'flow-map'
