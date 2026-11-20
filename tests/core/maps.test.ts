import { afterEach, describe, expect, it } from 'vitest'
import { chartCatalog, compilePlot, renderToSvg, validatePlot, describePlot, registerGeography, unregisterGeography, type Scene } from '@supersolutions/super-plot-core'

const ex = (t: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === t)!.example) as Record<string, any>
const scene = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 420, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => `${i.severity}:${i.code}:${i.path}`)
const square = (x: number, y: number, s = 4): number[][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]
const twoLands = { type: 'FeatureCollection', features: [
  { type: 'Feature', id: 'N', properties: { name: 'Northland' }, geometry: { type: 'Polygon', coordinates: [square(10, 10)] } },
  { type: 'Feature', id: 'S', properties: { name: 'Southland', disputed: true }, geometry: { type: 'Polygon', coordinates: [square(10, 4)] } }
] }

afterEach(() => { unregisterGeography('lands') })

describe('map charts', () => {
  it('every map example validates cleanly and compiles to a scene with a geo payload', () => {
    for (const t of ['choropleth', 'bubble-map', 'column-map', 'flow-map']) {
      expect(validatePlot(ex(t)).issues).toEqual([])
      const s = scene(ex(t))
      expect(s.geo).toBeDefined()
      const geoMarks = s.marks.filter(m => m.layer === 'geo')
      expect(geoMarks.length).toBeGreaterThan(0)
      for (const m of geoMarks) expect(s.clips![m.clip!]).toBeTruthy()
    }
  })

  it('a named geography resolves after registerGeography, and is an error before', () => {
    const spec = { type: 'choropleth', geo: 'lands', region: 'r', value: 'v', data: [{ r: 'northland', v: 3 }, { r: 'S', v: 5 }] }
    expect(codes(spec)).toContain('error:unknown_geography:geo')
    registerGeography('lands', twoLands)
    expect(validatePlot(spec).issues).toEqual([])
    expect(describePlot(spec)).toMatchObject({ ok: true })
    expect((describePlot(spec) as { text: string }).text).toContain('Highest: S (5)')
  })

  it('rows whose region is not in the geography are reported, not silently dropped', () => {
    registerGeography('lands', twoLands)
    const c = codes({ type: 'choropleth', geo: 'lands', region: 'r', value: 'v', data: [{ r: 'N', v: 1 }, { r: 'Atlantis', v: 2 }] })
    expect(c.some(x => x.includes(':region'))).toBe(true)
  })

  it('validates the camera and lat/lng columns', () => {
    const b = ex('bubble-map')
    expect(codes({ ...b, camera: { zom: 2 } })).toContain('error:unknown_field:camera.zom')
    expect(codes({ ...b, camera: { pitch: 90 } })).toContain('error:out_of_range:camera.pitch')
    expect(codes({ ...b, camera: { lng: '10' } })).toContain('error:bad_type:camera.lng')
    const bad = { ...b, data: b.data.map((r: Record<string, unknown>) => ({ ...r, lat: 500 })) }
    expect(codes(bad)).toContain('error:out_of_range:lat')
  })

  it('disputed regions look like any other by default; dashed or muted only when asked', () => {
    registerGeography('lands', twoLands)
    const spec = { type: 'choropleth', geo: 'lands', region: 'r', value: 'v', data: [{ r: 'N', v: 1 }, { r: 'S', v: 2 }] }
    const dashedOf = (s: Scene): number => s.geo!.regions.filter(r => r.dashed).length
    expect(dashedOf(scene(spec))).toBe(0)
    expect(renderToSvg(spec)).not.toContain('stroke-dasharray')
    expect(dashedOf(scene({ ...spec, disputed: 'dashed' }))).toBe(1)
    expect(dashedOf(scene({ ...spec, disputed: 'muted' }))).toBe(1)
  })

  it('extrude raises regions and tilts the flat view; the camera option overrides the spec', () => {
    const s = scene({ ...ex('choropleth'), extrude: true })
    expect(s.geo!.regions.some(r => r.height > 0)).toBe(true)
    expect(s.geo!.view.camera.pitch).toBe(40)
    const turned = scene({ ...ex('choropleth'), extrude: true }, { camera: { pitch: 10, bearing: 30 } })
    expect(turned.geo!.view.camera).toMatchObject({ pitch: 10, bearing: 30 })
  })

  it('on a globe, places on the far side have no hover target but stay in the 3D payload', () => {
    const s = scene({ ...ex('column-map'), camera: { lng: 20, lat: 15 } })
    const hidden = s.geo!.columns.filter(c => c.mark < 0)
    const shown = s.geo!.columns.filter(c => c.mark >= 0)
    expect(shown.length).toBeGreaterThan(0)
    for (const c of shown) expect(s.marks[c.mark].tip).toBeDefined()
    expect(hidden.length + shown.length).toBe(ex('column-map').data.length)
  })

  it('flows have a hover target at the top of each arc', () => {
    const s = scene(ex('flow-map'))
    const arcs = s.geo!.arcs.filter(a => a.mark >= 0)
    expect(arcs.length).toBeGreaterThan(0)
    for (const a of arcs) expect(s.marks[a.mark].tip!.rows.length).toBeGreaterThan(0)
  })

  it('is deterministic and the SVG clips to the map', () => {
    const a = renderToSvg({ ...ex('choropleth'), view: 'globe' })
    expect(renderToSvg({ ...ex('choropleth'), view: 'globe' })).toBe(a)
    expect(a).toContain('<clipPath')
    expect(a).toContain('fill-rule="evenodd"')
  })
})
