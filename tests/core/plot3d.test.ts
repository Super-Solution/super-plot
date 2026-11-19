// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import { describe, expect, it } from 'vitest'
import {
  chartCatalog, compilePlot, describePlot, renderToSvg, renderSvg, validatePlot, drawScene, buildHitIndex, plotTable, plotJsonSchema,
  makeView3d, project3d, clampCamera3d, dragCamera3d, zoomCamera3d, DEFAULT_CAMERA3D, MAX_SURFACE_SIDE,
  type Scene, type CircleMark, type Canvas2D
} from '../../packages/core/src'

const ex = (t: string): Record<string, any> => structuredClone(chartCatalog().find(c => c.type === t)!.example) as Record<string, any>
const compile = (spec: unknown, o = {}): Scene => {
  const r = compilePlot(spec, { width: 640, height: 480, ...o })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.scene
}
const codes = (spec: unknown): string[] => validatePlot(spec).issues.map(i => `${i.severity}:${i.code}:${i.path}`)
const dots = (s: Scene): CircleMark[] => s.marks.filter((m): m is CircleMark => m.role === 'data' && m.type === 'circle')
const P = [{ x: 1, y: 2, z: 3, g: 'a' }, { x: 4, y: 1, z: 9, g: 'b' }, { x: 2, y: 8, z: 5, g: 'a' }, { x: 2, y: 3, z: 1, g: 'b' }]
const sc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'scatter3d', x: 'x', y: 'y', z: 'z', data: P, ...extra })
const gridRows = (nx: number, ny: number, skip: (i: number, j: number) => boolean = () => false): Record<string, number>[] => {
  const out: Record<string, number>[] = []
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (!skip(i, j)) out.push({ x: i * 0.5, y: j, z: Math.sin(i) + j })
  return out
}
const sf = (data: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'surface', x: 'x', y: 'y', z: 'z', data, ...extra })

describe('3D camera (view3d)', () => {
  const rect = { x: 0, y: 0, w: 400, h: 300 }
  it('fits the box whatever the camera: every corner stays inside the rectangle', () => {
    for (const camera of [{}, { pitch: 0 }, { pitch: 90, bearing: 45 }, { bearing: 200, pitch: 30 }]) {
      for (const projection of ['orthographic', 'perspective'] as const) {
        const v = makeView3d({ projection, rect, camera })
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          const p = project3d(v, x, y, z)
          expect(p.x).toBeGreaterThanOrEqual(-0.01)
          expect(p.x).toBeLessThanOrEqual(400.01)
          expect(p.y).toBeGreaterThanOrEqual(-0.01)
          expect(p.y).toBeLessThanOrEqual(300.01)
        }
      }
    }
  })
  it('orthographic keeps sizes; perspective makes the near side larger', () => {
    const o = makeView3d({ projection: 'orthographic', rect })
    expect(project3d(o, 0, -1, 0).k).toBe(1)
    expect(project3d(o, 0, 1, 0).k).toBe(1)
    const p = makeView3d({ projection: 'perspective', rect })
    expect(project3d(p, 0, -1, 0).k).toBeGreaterThan(1)
    expect(project3d(p, 0, 1, 0).k).toBeLessThan(1)
    // The front of the floor (y = -1) is nearer than its back.
    expect(project3d(o, 0, -1, -1).z).toBeGreaterThan(project3d(o, 0, 1, -1).z)
  })
  it('pitch 0 looks straight down, 90 from the side; up is up on screen', () => {
    const top = makeView3d({ projection: 'orthographic', rect, camera: { pitch: 0, bearing: 0 } })
    expect(project3d(top, 0.5, 0.5, -1).x).toBeCloseTo(project3d(top, 0.5, 0.5, 1).x, 9)
    expect(project3d(top, 0.5, 0.5, -1).y).toBeCloseTo(project3d(top, 0.5, 0.5, 1).y, 9)
    const side = makeView3d({ projection: 'orthographic', rect, camera: { pitch: 90, bearing: 0 } })
    expect(project3d(side, 0, 1, 0).y).toBeCloseTo(project3d(side, 0, -1, 0).y, 9)
    expect(project3d(side, 0, 0, 1).y).toBeLessThan(project3d(side, 0, 0, -1).y)
  })
  it('clamps, drags and zooms like the map camera', () => {
    expect(clampCamera3d({ pitch: 120, zoom: 99, bearing: -30 })).toEqual({ pitch: 90, zoom: 8, bearing: 330 })
    expect(clampCamera3d({})).toEqual(DEFAULT_CAMERA3D)
    const v = makeView3d({ projection: 'orthographic', rect })
    expect(dragCamera3d(v, 10, 10)).toEqual({ zoom: 1, bearing: DEFAULT_CAMERA3D.bearing + 4, pitch: DEFAULT_CAMERA3D.pitch - 3 })
    expect(zoomCamera3d(v, 2).zoom).toBe(2)
  })
})

describe('scatter3d validation', () => {
  it('accepts the example, with an info note about 3D and no other issue', () => {
    expect(codes(ex('scatter3d'))).toEqual(['info:perspective_3d:projection'])
    expect(validatePlot(ex('scatter3d')).ok).toBe(true)
  })
  it('the note names the perspective distortion when perspective is on, and a 2D alternative', () => {
    const i = validatePlot(sc({ projection: 'perspective' })).issues.find(x => x.code === 'perspective_3d')!
    expect(i.severity).toBe('info')
    expect(i.message).toMatch(/larger/)
    expect(i.hint).toMatch(/scatter plot/)
    expect(validatePlot(sc()).issues.find(x => x.code === 'perspective_3d')!.message).toMatch(/hides points/)
  })
  it('takes zoom, pitch and bearing; refuses the map fields with a hint, and out-of-range values', () => {
    expect(validatePlot(sc({ camera: { pitch: 90, bearing: -360, zoom: 8 } })).ok).toBe(true)
    const lng = validatePlot(sc({ camera: { lng: 3, pitch: 20 } }))
    expect(lng.ok).toBe(false)
    expect(lng.issues.find(i => i.code === 'unknown_field')).toMatchObject({ path: 'camera.lng' })
    expect(lng.issues.find(i => i.code === 'unknown_field')!.hint).toMatch(/map fields/)
    expect(codes(sc({ camera: { pitch: 91, zoom: 0.4 } }))).toEqual(expect.arrayContaining(['error:out_of_range:camera.pitch', 'error:out_of_range:camera.zoom']))
    expect(codes(sc({ camera: { pich: 20 } }))).toContain('error:unknown_field:camera.pich')
    expect(validatePlot(sc({ camera: { pich: 20 } })).issues.find(i => i.path === 'camera.pich')!.hint).toBe('Did you mean "pitch"?')
    expect(codes(sc({ projection: 'isometric' }))).toContain('error:bad_enum:projection')
  })
  it('the JSON Schema has the 3D camera fields only', () => {
    const schema = plotJsonSchema() as any
    const branch = schema.oneOf.find((b: any) => b.properties?.type?.const === 'scatter3d')
    expect(Object.keys(branch.properties.camera.properties)).toEqual(['zoom', 'pitch', 'bearing'])
    expect(branch.properties.camera.properties.pitch.maximum).toBe(90)
  })
  it('reports rows it cannot place, negative sizes and specs with no point', () => {
    expect(codes(sc({ data: [...P, { x: 'n/a', y: 1, z: 2 }] }))).toContain('warning:incomplete_rows:data')
    expect(codes(sc({ size: 's', data: [{ x: 1, y: 1, z: 1, s: 2 }, { x: 2, y: 1, z: 1, s: -3 }] }))).toContain('warning:negative_skipped:size')
    expect(codes(sc({ data: [{ x: 1, y: 'a', z: 2 }, { x: 'b', y: 1, z: 2 }] }))).toContain('error:no_points:data')
    expect(codes(sc({ z: 'w' }))).toContain('error:no_such_column:z')
    expect(codes({ type: 'scatter3d', x: 'x', y: 'y', data: P })).toContain('error:missing_required:z')
  })
  it('refuses facets (one box per chart)', () => {
    expect(codes(sc({ facet: 'g' }))).toContain('error:unknown_field:facet')
  })
})

describe('scatter3d drawing', () => {
  it('paints back to front, steps by x then y, and every point carries exact values', () => {
    const s = compile(sc({ series: 'g' }))
    const d = dots(s)
    expect(d).toHaveLength(4)
    // Keyboard order: x, then y.
    expect(s.view3d!.order.map(i => (s.marks[i].datum as { x: number; y: number }))).toEqual([{ x: 1, y: 2, z: 3, series: 'a' }, { x: 2, y: 3, z: 1, series: 'b' }, { x: 2, y: 8, z: 5, series: 'a' }, { x: 4, y: 1, z: 9, series: 'b' }])
    for (const m of d) {
      expect(m.aria).toMatch(/x \d, y \d, z \d/)
      expect(m.tip!.rows.map(r => r.label)).toEqual(['x', 'y', 'z'])
      expect(m.datum).toBeDefined()
    }
  })
  it('the drawing order follows depth for the camera, and turns with it', () => {
    const near = (bearing: number): unknown => {
      const s = compile(sc({ camera: { bearing, pitch: 60 } }))
      return dots(s).at(-1)!.datum
    }
    // Turning the box half way round brings the other side to the front.
    expect(near(0)).not.toEqual(near(180))
    const a = compile(sc({ camera: { bearing: 0 } })), b = compile(sc({ camera: { bearing: 180 } }))
    const keys = (s: Scene): unknown[] => s.view3d!.order.map(i => s.marks[i].datum)
    expect(keys(a)).toEqual(keys(b))
  })
  it('orthographic draws equal points the same size; perspective does not', () => {
    const o = dots(compile(sc()))
    expect(new Set(o.map(m => m.r)).size).toBe(1)
    const p = dots(compile(sc({ projection: 'perspective' })))
    expect(new Set(p.map(m => Math.round(m.r * 1000))).size).toBeGreaterThan(1)
    // The nearest (drawn last) is the largest.
    expect(p.at(-1)!.r).toBe(Math.max(...p.map(m => m.r)))
  })
  it('drop lines: on by default, off on request, left out above 2000 points with a warning', () => {
    const lines = (s: Scene): number => s.marks.filter(m => m.type === 'line' && m.role === 'grid').length
    expect(lines(compile(sc()))).toBe(4)
    expect(lines(compile(sc({ dropLines: false })))).toBe(0)
    const many = Array.from({ length: 2100 }, (_, i) => ({ x: i % 50, y: Math.floor(i / 50), z: (i * 7) % 13 }))
    const r = compilePlot(sc({ data: many }), { width: 640, height: 480 })
    expect(r.ok && lines(r.scene)).toBe(0)
    expect(r.issues.map(i => i.code)).toContain('drop_lines_dense')
    const forced = compilePlot(sc({ data: many, dropLines: true }), { width: 640, height: 480 })
    expect(forced.ok && lines(forced.scene)).toBe(2100)
    expect(forced.issues.map(i => i.code)).not.toContain('drop_lines_dense')
  })
  it('a hidden series leaves the box as it was', () => {
    const all = compile(sc({ series: 'g' }))
    const some = compile(sc({ series: 'g' }), { hidden: ['b'] })
    expect(dots(some)).toHaveLength(2)
    const ticks = (s: Scene): string[] => s.marks.filter(m => m.type === 'text' && m.role === 'axis-label').map(m => (m as { text: string }).text)
    expect(ticks(some)).toEqual(ticks(all))
  })
  it('the render camera wins over the spec, and only its 3D fields count', () => {
    const s = compile(sc({ camera: { pitch: 20 } }), { camera: { lng: 5, lat: 5, zoom: 2, pitch: 70, bearing: 10 } })
    expect(s.view3d!.view.camera).toEqual({ zoom: 2, pitch: 70, bearing: 10 })
    expect(compile(sc({ camera: { pitch: 20 } })).view3d!.view.camera).toEqual({ zoom: 1, pitch: 20, bearing: DEFAULT_CAMERA3D.bearing })
  })
  it('a straight-down view has no z labels (the edge is seen end-on), but x and y labels', () => {
    const s = compile(ex('scatter3d'), { camera: { pitch: 0 } })
    const text = s.marks.filter(m => m.type === 'text').map(m => (m as { text: string }).text)
    expect(text).toContain('Width (mm)')
    expect(text).toContain('Depth (mm)')
    expect(text).not.toContain('Height (mm)')
    expect(compile(ex('scatter3d')).marks.some(m => m.type === 'text' && m.text === 'Height (mm)')).toBe(true)
  })
  it('SVG: deterministic; points are focused by the binding in x order (tabindex -1), the legend stays a tab stop', () => {
    const a = renderToSvg(ex('scatter3d'))
    expect(renderToSvg(ex('scatter3d'))).toBe(a)
    const s = compile(sc({ series: 'g' }))
    const svg = renderSvg(s, { interactive: true })
    expect(svg.match(/class="sp-m sp-data[^"]*"[^>]*tabindex="-1"/g)).toHaveLength(4)
    expect(svg).not.toMatch(/class="sp-m sp-data[^"]*"[^>]*tabindex="0"/)
    expect(svg).toMatch(/data-lk="a" role="button" tabindex="0"/)
    // Other charts keep their marks in the tab order.
    expect(renderSvg(compile({ type: 'scatter', x: 'x', y: 'y', data: P }), { interactive: true })).toMatch(/class="sp-m sp-data[^"]*"[^>]*tabindex="0"/)
  })
  it('describes ranges and extremes in words', () => {
    const d = describePlot(sc({ series: 'g', title: 'T' }))
    expect(d.ok && d.text).toBe('3D scatter plot "T". 4 points of z against x and y, in 2 groups (a, b). x ranges from 1 to 4, y from 1 to 8 and z from 1 to 9. Highest z: 9 (x 4, y 1). Lowest: 1 (x 2, y 3).')
  })
  it('the data table lists every row with x, y and z', () => {
    const t = plotTable(sc({ series: 'g' }))!
    expect(t.columns.map(c => c.key)).toEqual(['x', 'y', 'z', 'g'])
    expect(t.rows).toHaveLength(4)
  })
  it('draws on a 2D canvas and hit-tests points by their datum', () => {
    const s = compile(sc())
    const calls: string[] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && k !== 'then' ? (..._a: unknown[]) => { calls.push(k); return k === 'measureText' ? { width: 10 } : undefined } : undefined),
      set: (t, k, v) => { t[k as string] = v; return true }
    }) as unknown as Canvas2D
    drawScene(ctx, s)
    expect(calls.filter(c => c === 'arc').length).toBeGreaterThanOrEqual(4)
    const idx = buildHitIndex(s)
    const m = dots(s)[0]
    const i = idx.at(m.cx, m.cy)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(s.marks[i].datum).toBeDefined()
  })
})

describe('surface', () => {
  it('accepts the example with only the 3D note; tiles carry exact values and a colour key', () => {
    expect(codes(ex('surface'))).toEqual(['info:perspective_3d:projection'])
    const s = compile(ex('surface'))
    const tiles = s.marks.filter(m => m.role === 'data')
    expect(tiles).toHaveLength(13 * 11)
    for (const t of tiles) {
      expect(t.tip!.rows.map(r => r.label)).toEqual(['temp', 'pressure', 'yield'])
      expect(t.aria).toMatch(/^temp [\d.]+, pressure [\d.]+: yield [\d.]+$/)
    }
    expect(s.marks.filter(m => m.role === 'legend' && m.type === 'rect').length).toBeGreaterThan(10)
    // Keyboard order is x, then y.
    const ds = s.view3d!.order.map(i => s.marks[i].datum as { x: number; y: number })
    expect(ds[0]).toMatchObject({ x: 14, y: 1 })
    expect(ds[1]).toMatchObject({ x: 14, y: 1.8 })
    expect(ds.at(-1)).toMatchObject({ x: 32, y: 9 })
  })
  it('keeps every axis title inside the plot clip and the colour key below the turn buttons', () => {
    for (const [w, h] of [[420, 340], [640, 480], [300, 260]]) {
      const s = compile(ex('surface'), { width: w, height: h })
      const box = s.clips!.plot3d.match(/^M(-?[\d.]+)[ ,]/)!
      const left = Math.max(0, Number(box[1]))
      for (const t of s.marks.filter(m => m.type === 'text' && m.role === 'axis-label') as { x: number; text: string; anchor?: string }[]) {
        const width = t.text.length * 6.5
        const start = t.anchor === 'end' ? t.x - width : t.anchor === 'middle' ? t.x - width / 2 : t.x
        expect(start, `${t.text} at ${w}x${h}`).toBeGreaterThanOrEqual(left)
      }
      const key = s.marks.filter(m => m.role === 'legend' && m.type === 'text') as { y: number }[]
      expect(Math.min(...key.map(k => k.y)), `${w}x${h}`).toBeGreaterThan(h * 0.3)
    }
  })
  it('missing grid points are warned about and drawn as holes; sparse data is told to use scatter3d', () => {
    const data = gridRows(5, 4, (i, j) => i === 2 && j === 1)
    const v = validatePlot(sf(data))
    const miss = v.issues.find(i => i.code === 'missing_cells')!
    expect(miss).toMatchObject({ severity: 'warning', path: 'data' })
    expect(miss.message).toMatch(/1 of 20 grid points/)
    expect(miss.message).toMatch(/\(1, 1\)/)
    expect(compile(sf(data)).marks.filter(m => m.role === 'data')).toHaveLength(19)
    const sparse = validatePlot(sf(Array.from({ length: 6 }, (_, i) => ({ x: i, y: i * 2, z: i }))))
    expect(sparse.issues.find(i => i.code === 'missing_cells')!.hint).toMatch(/scatter3d/)
  })
  it('repeated points keep the first value, with a warning', () => {
    const data = [...gridRows(3, 3), { x: 0, y: 0, z: 99 }]
    expect(codes(sf(data))).toContain('warning:duplicate_cells:data')
    const s = compile(sf(data))
    const first = s.marks.find(m => m.role === 'data' && (m.datum as { x: number; y: number }).x === 0 && (m.datum as { y: number }).y === 0)!
    expect((first.datum as { z: number }).z).toBe(0)
  })
  it('caps the grid at 200 by 200 and needs 2 by 2', () => {
    expect(MAX_SURFACE_SIDE).toBe(200)
    const wide = Array.from({ length: 201 }, (_, i) => [{ x: i, y: 0, z: 1 }, { x: i, y: 1, z: 2 }]).flat()
    const v = validatePlot(sf(wide))
    expect(v.ok).toBe(false)
    expect(v.issues.find(i => i.code === 'grid_too_large')).toMatchObject({ path: 'x', severity: 'error' })
    expect(v.issues.find(i => i.code === 'grid_too_large')!.hint).toMatch(/bin/)
    expect(codes(sf([{ x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 2 }]))).toContain('error:grid_too_small:y')
    expect(codes(sf([{ x: 'a', y: 1, z: 1 }]))).toContain('error:not_numeric:x')
  })
  it('mesh off strokes each tile in its own colour (no seams)', () => {
    const s = compile(sf(gridRows(3, 3), { mesh: false }))
    for (const t of s.marks.filter(m => m.role === 'data') as { fill?: string; stroke?: string }[]) expect(t.stroke).toBe(t.fill)
  })
  it('the colour domain fixes the key', () => {
    const s = compile(sf(gridRows(3, 3), { domain: [0, 100] }))
    const labels = s.marks.filter(m => m.role === 'legend' && m.type === 'text').map(m => (m as { text: string }).text)
    expect(labels).toEqual(expect.arrayContaining(['0', '100']))
  })
  it('describes the grid, the ranges and the extremes', () => {
    const d = describePlot(sf(gridRows(3, 2, (i, j) => i === 1 && j === 1), { title: 'S' }))
    expect(d.ok && d.text).toBe('Surface "S". z over a grid of 3 x by 2 y values (1 of 6 points missing), coloured by z. x ranges from 0 to 1 and y from 0 to 1. Highest z: 1.91 at x 1, y 1. Lowest: 0 at x 0, y 0.')
  })
})
