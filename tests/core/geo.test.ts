import { afterEach, describe, expect, it } from 'vitest'
import {
  registerGeography, unregisterGeography, getGeography, listGeographies, readGeography, matchRegion, normalizeRegion, GeographyError, GEO_PRESETS, GEO_LIMITS,
  makeView, project, projectFlat, unprojectFlat, dragCamera, zoomCamera, clampCamera, defaultCamera, angularDistance, slerp, CAMERA_LIMITS,
  type Issue, type ViewInput
} from '@supersolutions/super-plot-core'

const square = (x: number, y: number, s = 2): number[][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]
const fc = (features: unknown[]): unknown => ({ type: 'FeatureCollection', features })
const feat = (id: unknown, coords: number[][][], props: Record<string, unknown> = {}, type = 'Polygon'): unknown => ({ type: 'Feature', id, properties: props, geometry: { type, coordinates: coords } })
const read = (data: unknown, options = {}): { geo: ReturnType<typeof readGeography>; issues: Issue[] } => {
  const issues: Issue[] = []
  return { geo: readGeography(data, options, issues, 'geo'), issues }
}
const codes = (issues: Issue[]): string[] => issues.map(i => `${i.severity}:${i.code}`)

afterEach(() => { for (const g of listGeographies()) unregisterGeography(g.name) })

describe('reading GeoJSON', () => {
  it('reads polygons, multipolygons and holes; keys from id, then properties.id, then name', () => {
    const { geo, issues } = read(fc([
      feat('A', [square(0, 0)], { name: 'Alpha' }),
      feat(undefined, [[square(10, 0)], [square(14, 0)]].map(p => p[0]).map(r => [r]) as unknown as number[][][], { id: 'B', name: 'Beta' }, 'MultiPolygon'),
      feat(undefined, [square(20, 0, 4), square(21, 1, 1)], { name: 'Gamma' })
    ]))
    expect(issues).toEqual([])
    expect(geo!.regions.map(r => r.key)).toEqual(['A', 'B', 'Gamma'])
    expect(geo!.byKey.get('A')!.name).toBe('Alpha')
    expect(geo!.byKey.get('B')!.polygons).toHaveLength(2)
    expect(geo!.byKey.get('Gamma')!.polygons[0]).toHaveLength(2) // outer + hole
    expect(geo!.bbox).toEqual([0, 0, 24, 4])
  })

  it('joins by key, name or alias, ignoring case and spacing', () => {
    const { geo } = read(fc([feat('TWN', [square(120, 22)], { name: 'Example  Land' })]), { aliases: { 'ex land': 'TWN' } })
    expect(matchRegion(geo!, 'twn')).toBe('TWN')
    expect(matchRegion(geo!, ' example land ')).toBe('TWN')
    expect(matchRegion(geo!, 'EX LAND')).toBe('TWN')
    expect(matchRegion(geo!, 'nowhere')).toBeUndefined()
    expect(normalizeRegion('  A\tB  ')).toBe('a b')
  })

  it('unwraps a ring that crosses the antimeridian instead of drawing a band across the world', () => {
    const { geo } = read(fc([feat('X', [[[178, 0], [-178, 0], [-178, 2], [178, 2], [178, 0]]])]))
    const r = geo!.byKey.get('X')!
    expect(r.bbox[2] - r.bbox[0]).toBeCloseTo(4, 6)
  })

  it('warns about and skips what it cannot use, keeping the rest', () => {
    const { geo, issues } = read(fc([
      feat('A', [square(0, 0)]),
      feat('A', [square(5, 0)]),
      feat('C', [[[0, 0], [1, 1]]]),
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
      feat(undefined, [square(9, 9)], {})
    ]))
    expect(geo!.regions.map(r => r.key)).toEqual(['A'])
    expect(geo!.byKey.get('A')!.polygons).toHaveLength(2) // duplicates are merged
    expect(codes(issues).sort()).toEqual(['warning:duplicate_region', 'warning:geo_bad_ring', 'warning:geo_feature_skipped', 'warning:geo_no_key'])
    expect(issues.find(i => i.code === 'geo_bad_ring')!.path).toBe('geo.features[2].geometry.coordinates[0]')
  })

  it('positions outside longitude/latitude are an error (projected metres get a specific hint)', () => {
    const swapped = read(fc([feat('D', [square(0, 95)])]))
    expect(swapped.geo).toBeNull()
    expect(codes(swapped.issues)).toEqual(['error:geo_out_of_range'])
    const metres = read(fc([feat('M', [square(500000, 2700000, 1000)])]))
    expect(metres.issues[0].hint).toMatch(/EPSG:4326/)
  })

  it('rejects what is not a geography at all', () => {
    expect(codes(read(42).issues)).toEqual(['error:bad_type'])
    expect(read({ type: 'Feature' }).geo).toBeNull()
    expect(read(fc([])).geo).toBeNull()
  })

  it('reads the disputed flag from the data only (never decided by the library)', () => {
    const { geo } = read(fc([feat('A', [square(0, 0)], { disputed: true }), feat('B', [square(3, 0)], { disputed: 'yes' })]))
    expect(geo!.byKey.get('A')!.disputed).toBe(true)
    expect(geo!.byKey.get('B')!.disputed).toBe(false)
  })
})

describe('reading TopoJSON', () => {
  // Two squares sharing an edge, quantized with a transform.
  const topo = {
    type: 'Topology',
    transform: { scale: [0.01, 0.01], translate: [100, 10] },
    objects: {
      lands: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', id: 'W', properties: { name: 'West' }, arcs: [[0, 1]] },
          { type: 'Polygon', id: 'E', properties: { name: 'East' }, arcs: [[2, -1]] }
        ]
      }
    },
    // Delta-encoded arcs: shared edge (arc 0) from (200,0) to (200,200).
    arcs: [
      [[200, 0], [0, 200]],
      [[200, 200], [-200, 0], [0, -200], [200, 0]],
      [[200, 200], [200, 0], [0, -200], [-200, 0]]
    ]
  }
  it('decodes arcs, delta encoding, the transform and reversed arcs', () => {
    const { geo, issues } = read(topo)
    expect(issues.filter(i => i.severity === 'error')).toEqual([])
    expect(geo!.regions.map(r => r.key)).toEqual(['W', 'E'])
    expect(geo!.byKey.get('W')!.bbox).toEqual([100, 10, 102, 12])
    expect(geo!.byKey.get('E')!.bbox).toEqual([102, 10, 104, 12])
  })
  it('a missing object is an error', () => {
    expect(codes(read(topo, { object: 'nope' }).issues).some(c => c.startsWith('error:'))).toBe(true)
  })
})

describe('registry and presets', () => {
  it('registers by name, lists, and unregisters', () => {
    const warnings = registerGeography('demo', fc([feat('A', [square(0, 0)], { name: 'Alpha' })]))
    expect(warnings).toEqual([])
    expect(getGeography('demo')!.regions).toHaveLength(1)
    expect(listGeographies()).toEqual([{ name: 'demo', regions: 1, sample: [{ key: 'A', name: 'Alpha' }] }])
    expect(unregisterGeography('demo')).toBe(true)
    expect(getGeography('demo')).toBeUndefined()
  })
  it('throws GeographyError with issues for unusable data and bad names', () => {
    expect(() => registerGeography('x', '{oops')).toThrow(GeographyError)
    expect(() => registerGeography('bad name!', fc([]))).toThrow(GeographyError)
    expect(() => registerGeography('x', fc([feat('A', [square(0, 0)])]), 'no-such-preset' as never)).toThrow(/Unknown preset/)
    try { registerGeography('x', 7) } catch (e) { expect((e as GeographyError).issues[0].code).toBe('bad_type') }
  })
  it('natural-earth preset: ISO_A3 key with the -99 fallback, NAME, and disputed from TYPE', () => {
    registerGeography('ne', fc([
      feat(undefined, [square(0, 0)], { ISO_A3: 'AAA', ADM0_A3: 'AAA', NAME: 'Aland' }),
      feat(undefined, [square(3, 0)], { ISO_A3: '-99', ADM0_A3: 'BBB', NAME: 'Bland', TYPE: 'Disputed' })
    ]), 'natural-earth-admin0')
    const g = getGeography('ne')!
    expect(g.regions.map(r => [r.key, r.name, r.disputed])).toEqual([['AAA', 'Aland', false], ['BBB', 'Bland', true]])
  })
  it('every preset says where the data comes from', () => {
    for (const p of Object.values(GEO_PRESETS)) {
      expect(p.description.length).toBeGreaterThan(20)
      expect(p.url).toMatch(/^https:\/\//)
    }
  })
  it('limits are enforced', () => {
    const many = fc(Array.from({ length: GEO_LIMITS.maxRegions + 1 }, (_, i) => feat(`R${i}`, [square((i % 80) * 2 - 80, Math.floor(i / 80) - 60, 1)])))
    expect(codes(read(many).issues)).toContain('error:too_many_regions')
  })
})

describe('projections and camera', () => {
  const rect = { x: 0, y: 0, w: 800, h: 400 }
  const flat = (camera = {}): ViewInput => ({ kind: 'flat', projection: 'equirectangular', rect, focus: [-180, -90, 180, 90], camera })
  it('flat projections put 0,0 at the origin and are invertible', () => {
    for (const p of ['equal-earth', 'mercator', 'equirectangular'] as const) {
      expect(projectFlat(p, 0, 0).map(v => Math.abs(v) < 1e-12 ? 0 : v)).toEqual([0, 0])
      for (const [lng, lat] of [[121.5, 25], [-74, 40.7], [151.2, -33.9]]) {
        const [x, y] = projectFlat(p, lng, lat)
        const [l2, p2] = unprojectFlat(p, x, y)
        expect(l2).toBeCloseTo(lng, 5)
        expect(p2).toBeCloseTo(lat, 5)
      }
    }
  })
  it('the fitted world fills the rectangle and the centre lands in the middle', () => {
    const v = makeView(flat())
    const c = project(v, 0, 0)
    expect(c.x).toBeCloseTo(400, 6)
    expect(c.y).toBeCloseTo(200, 6)
    const east = project(v, 180, 0)
    expect(east.x).toBeLessThanOrEqual(800.0001)
    expect(east.x).toBeGreaterThan(700)
  })
  it('the globe hides the far side', () => {
    const v = makeView({ kind: 'globe', projection: 'equal-earth', rect, focus: [-180, -90, 180, 90], camera: { lng: 0, lat: 0 } })
    expect(project(v, 0, 0).z).toBeGreaterThan(0)
    expect(project(v, 180, 0).z).toBeLessThan(0)
    expect(project(v, 0, 0).x).toBeCloseTo(400, 6)
  })
  it('dragging moves the map with the pointer; zoom and turn are clamped', () => {
    const v = makeView(flat({ lng: 0, lat: 0 }))
    expect(dragCamera(v, 100, 0).lng).toBeLessThan(0) // drag right: the view moves west
    expect(dragCamera(v, 0, 100).lat).toBeGreaterThan(0) // drag down: the view moves north
    const turned = dragCamera(v, 50, -400, true)
    expect(turned.bearing).toBeCloseTo(20, 6)
    expect(turned.pitch).toBe(CAMERA_LIMITS.pitch[1])
    expect(zoomCamera(v, 1000).zoom).toBe(CAMERA_LIMITS.zoom[1])
    expect(clampCamera({ lng: 190, lat: 95, zoom: 0, pitch: -5, bearing: -90 })).toEqual({ lng: -170, lat: 89.9, zoom: CAMERA_LIMITS.zoom[0], pitch: 0, bearing: 270 })
  })
  it('a camera read back from a view and passed in again shows the same view (no jump on the first turn)', () => {
    for (const projection of ['mercator', 'equal-earth'] as const) {
      const input: ViewInput = { kind: 'flat', projection, rect: { x: 0, y: 0, w: 800, h: 500 }, focus: [-10, 35, 30, 70] }
      const v = makeView(input)
      const again = makeView({ ...input, camera: v.camera })
      const a = project(v, 12, 50), b = project(again, 12, 50)
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01)
    }
  })
  it('the default camera centres on the data', () => {
    expect(defaultCamera({ kind: 'flat', focus: [100, 10, 120, 30] })).toEqual({ lng: 110, lat: 20, zoom: 1, pitch: 0, bearing: 0 })
  })
  it('great-circle helpers', () => {
    expect(angularDistance([0, 0], [180, 0])).toBeCloseTo(Math.PI, 9)
    const [lng, lat] = slerp([0, 0], [90, 0], 0.5)
    expect(lng).toBeCloseTo(45, 9)
    expect(lat).toBeCloseTo(0, 9)
  })
})
