// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * The WebGL2 map renderer: draws `scene.geo` (regions, raised regions, columns, arcs, points, the sea and
 * graticule) with a depth buffer, projecting longitude/latitude in the vertex shader with the same formulas
 * as core's `project`. Moving the camera is a uniform update: nothing is re-triangulated or re-uploaded.
 * Picking renders item ids to an offscreen buffer and reads one pixel.
 */
import earcut from 'earcut'
import type { SceneGeo, ViewParams } from '@supersolutions/super-plot-core/base'
import { arcPoints, OBLIQUE } from '@supersolutions/super-plot-core/view'
import { ColorParser, pickColor, pickIndex, program, uniforms } from './context.js'

const PROJECT = `
uniform int u_kind;        // 0 flat, 1 globe
uniform int u_proj;        // 0 equal-earth, 1 mercator, 2 equirectangular
uniform vec2 u_size;
uniform vec4 u_rect;
uniform vec2 u_center;
uniform float u_scale;
uniform float u_radius;
uniform float u_dist;
uniform float u_heightPx;
uniform vec2 u_cam;        // centre lng, lat (radians)
uniform vec2 u_rot;        // cos, sin of the bearing
uniform vec2 u_pitch;      // cos, sin of the pitch
uniform float u_depthK;
const float RAD = 0.017453292519943295;
const float OBLIQUE = ${OBLIQUE.toFixed(4)};

vec2 projectFlat(vec2 ll) {
  float l = ll.x * RAD;
  if (u_proj == 1) {
    float p = clamp(ll.y, -85.0511287798, 85.0511287798) * RAD;
    return vec2(l, log(tan(0.7853981633974483 + p * 0.5)));
  }
  if (u_proj == 2) return vec2(l, ll.y * RAD);
  const float A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = 0.8660254037844386;
  float t = asin(M * sin(ll.y * RAD));
  float t2 = t * t; float t6 = t2 * t2 * t2;
  return vec2(l * cos(t) / (M * (A1 + 3.0 * A2 * t2 + t6 * (7.0 * A3 + 9.0 * A4 * t2))), t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)));
}

// Screen pixels (x, y) and a depth towards the viewer (z); w is 1 when the point is hidden behind the globe.
vec4 projectLL(vec3 lla) {
  vec2 c = u_rect.xy + u_rect.zw * 0.5;
  if (u_kind == 1) {
    float l = lla.x * RAD - u_cam.x;
    float p = lla.y * RAD;
    float cp = cos(p);
    float x = cp * sin(l);
    float y = cos(u_cam.y) * sin(p) - sin(u_cam.y) * cp * cos(l);
    float z = sin(u_cam.y) * sin(p) + cos(u_cam.y) * cp * cos(l);
    float k = 1.0 + lla.z;
    float xr = (x * u_rot.x - y * u_rot.y) * k;
    float yr = (x * u_rot.y + y * u_rot.x) * k;
    float zr = z * k;
    float hidden = (zr < 0.0 && xr * xr + yr * yr < 1.0) ? 1.0 : 0.0;
    return vec4(c.x + xr * u_radius, c.y - yr * u_radius, zr * u_radius, hidden);
  }
  vec2 pr = projectFlat(lla.xy);
  float x = (pr.x - u_center.x) * u_scale;
  float y = (pr.y - u_center.y) * u_scale;
  float h = lla.z * u_heightPx;
  float x1 = x * u_rot.x - y * u_rot.y;
  float y1 = x * u_rot.y + y * u_rot.x;
  if (u_dist <= 0.0) return vec4(c.x + x1, c.y - y1 - h * OBLIQUE, h - y1, 0.0);
  float Y = y1 * u_pitch.x + h * u_pitch.y;
  float Z = -y1 * u_pitch.y + h * u_pitch.x;
  float f = u_dist / max(1.0, u_dist - Z);
  return vec4(c.x + x1 * f, c.y - Y * f, Z, 0.0);
}

vec4 toClip(vec4 s) {
  vec2 c = s.xy / u_size * 2.0 - 1.0;
  return vec4(c.x, -c.y, clamp(-s.z * u_depthK, -0.999, 0.999), 1.0);
}
`

const MESH_VS = `#version 300 es
layout(location=0) in vec3 pos;
layout(location=1) in vec4 color;
layout(location=2) in vec4 pick;
layout(location=3) in float shade;
${PROJECT}
out vec4 vColor; out vec4 vPick; out float vHidden; out float vLng;
void main() {
  vec4 s = projectLL(pos);
  vHidden = s.w; vLng = pos.x;
  vColor = vec4(color.rgb * shade, color.a); vPick = pick;
  gl_Position = toClip(s);
}`

const FLAT_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vColor; in vec4 vPick; in float vHidden; in float vLng;
uniform int u_pickMode; uniform int u_kind; uniform float u_alpha;
out vec4 o;
void main() {
  if (vHidden > 0.5) discard;
  if (u_kind == 0 && abs(vLng) > 180.0001) discard;
  if (u_pickMode == 1) { if (vPick.a == 0.0) discard; o = vPick; return; }
  float a = vColor.a * u_alpha;
  o = vec4(vColor.rgb * a, a);
}`

const LINE_VS = `#version 300 es
layout(location=0) in vec3 pos;
layout(location=1) in vec4 color;
layout(location=2) in float dash;
${PROJECT}
out vec4 vColor; out float vHidden; out float vLng; out float vDash;
void main() {
  vec4 s = projectLL(pos);
  vHidden = s.w; vLng = pos.x; vDash = dash; vColor = color;
  gl_Position = toClip(s);
}`

const LINE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vColor; in float vHidden; in float vLng; in float vDash;
uniform int u_kind;
out vec4 o;
void main() {
  if (vHidden > 0.5) discard;
  if (u_kind == 0 && abs(vLng) > 180.0001) discard;
  if (vDash >= 0.0 && mod(vDash, 1.2) > 0.7) discard;
  o = vec4(vColor.rgb * vColor.a, vColor.a);
}`

// Arcs: a ribbon extruded in screen space from each point and its neighbours.
const RIBBON_VS = `#version 300 es
layout(location=0) in vec3 pos;
layout(location=1) in vec3 prev;
layout(location=2) in vec3 next;
layout(location=3) in vec2 sideWidth;
layout(location=4) in vec4 color;
layout(location=5) in vec4 pick;
${PROJECT}
out vec4 vColor; out vec4 vPick; out float vHidden; out float vLng;
void main() {
  vec4 s = projectLL(pos);
  vec4 a = projectLL(prev);
  vec4 b = projectLL(next);
  vec2 d = b.xy - a.xy;
  float len = length(d);
  vec2 n = len > 1e-4 ? vec2(-d.y, d.x) / len : vec2(0.0, 1.0);
  s.xy += n * sideWidth.x * sideWidth.y * 0.5;
  vHidden = s.w; vLng = 0.0; vColor = color; vPick = pick;
  gl_Position = toClip(s);
}`

// Columns: an instanced box with its footprint in degrees, so it stands on the globe or the tilted map.
const BOX_VS = `#version 300 es
layout(location=0) in vec3 corner;    // x, y in -1..1, z 0 (foot) or 1 (top)
layout(location=1) in float faceShade;
layout(location=2) in vec4 inst;      // lng, lat, height, half width (px)
layout(location=3) in vec4 color;
layout(location=4) in vec4 pick;
${PROJECT}
out vec4 vColor; out vec4 vPick; out float vHidden; out float vLng;
void main() {
  float unit = u_kind == 1 ? u_radius : u_scale;
  float d = inst.w / max(unit, 1e-6) / RAD;           // half width in degrees
  float dl = d / max(0.2, cos(inst.y * RAD));
  float dp = (u_kind == 0 && u_proj == 1) ? d * cos(inst.y * RAD) : d;
  if (u_kind == 0) dl = d;   // flat maps: a degree of longitude is the same width at every latitude
  vec3 lla = vec3(inst.x + corner.x * dl, inst.y + corner.y * dp, corner.z * inst.z + 0.001);
  vec4 s = projectLL(lla);
  vHidden = s.w; vLng = 0.0;
  vColor = vec4(color.rgb * faceShade, color.a); vPick = pick;
  gl_Position = toClip(s);
}`

// Points (bubbles) and the globe's sea: screen-space discs.
const DISC_VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 inst;      // lng, lat, radius (px), stroke width
layout(location=2) in vec4 fill;
layout(location=3) in vec4 stroke;
layout(location=4) in vec4 pick;
uniform int u_screenDisc;             // 1: inst.xy are already screen pixels
uniform float u_lift;
${PROJECT}
out vec2 vLocal; out float vR; out float vSW; out vec4 vFill; out vec4 vStroke; out vec4 vPick; out float vHidden;
void main() {
  vec4 s = u_screenDisc == 1 ? vec4(inst.xy, -1e6, 0.0) : projectLL(vec3(inst.xy, u_lift));
  float pad = inst.w * 0.5 + 1.5;
  vLocal = corner * (inst.z + pad);
  vR = inst.z; vSW = inst.w; vFill = fill; vStroke = stroke; vPick = pick; vHidden = s.w;
  if (u_kind == 1 && u_screenDisc == 0 && s.z < 0.0) vHidden = 1.0;
  vec4 p = toClip(vec4(s.xy + vLocal, s.z, 1.0));
  gl_Position = p;
}`

const DISC_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vLocal; in float vR; in float vSW; in vec4 vFill; in vec4 vStroke; in vec4 vPick; in float vHidden;
uniform int u_pickMode; uniform float u_px;
out vec4 o;
void main() {
  if (vHidden > 0.5) discard;
  float d = length(vLocal) - vR;
  if (u_pickMode == 1) { if (d > 0.0 || vPick.a == 0.0) discard; o = vPick; return; }
  float aa = u_px;
  float outer = clamp(0.5 - (d - vSW * 0.5) / aa, 0.0, 1.0);
  float inner = clamp(0.5 - (d + vSW * 0.5) / aa, 0.0, 1.0);
  if (vSW <= 0.0) { inner = clamp(0.5 - d / aa, 0.0, 1.0); outer = inner; }
  vec4 f = vec4(vFill.rgb * vFill.a, vFill.a) * inner;
  vec4 s = vec4(vStroke.rgb * vStroke.a, vStroke.a) * (outer - inner);
  o = f + s * (1.0 - f.a);
  if (o.a <= 0.002) discard;
}`

const PROJ_ID: Record<string, number> = { 'equal-earth': 0, mercator: 1, equirectangular: 2 }
const UNIFORMS = ['u_kind', 'u_proj', 'u_size', 'u_rect', 'u_center', 'u_scale', 'u_radius', 'u_dist', 'u_heightPx', 'u_cam', 'u_rot', 'u_pitch', 'u_depthK', 'u_pickMode', 'u_alpha', 'u_screenDisc', 'u_lift', 'u_px']

interface Geometry { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; count: number; indexed?: boolean; instances?: number; mode: number }

/** Densify a ring (interleaved lng/lat) so no step is longer than `step` degrees. */
function densify(r: ArrayLike<number>, step: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < r.length; i += 2) {
    const x = r[i], y = r[i + 1]
    if (i + 3 < r.length) {
      const nx = r[i + 2], ny = r[i + 3]
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(nx - x), Math.abs(ny - y)) / step))
      for (let k = 0; k < n; k++) out.push(x + ((nx - x) * k) / n, y + ((ny - y) * k) / n)
    } else out.push(x, y)
  }
  return out
}

/** Split triangles until no edge is longer than `max` degrees, so surfaces follow the globe's curve. */
function subdivide(coords: number[], tris: number[], max: number): number[] {
  const out: number[] = []
  const mids = new Map<string, number>()
  const mid = (a: number, b: number): number => {
    const k = a < b ? `${a},${b}` : `${b},${a}`
    let m = mids.get(k)
    if (m === undefined) {
      m = coords.length / 2
      coords.push((coords[a * 2] + coords[b * 2]) / 2, (coords[a * 2 + 1] + coords[b * 2 + 1]) / 2)
      mids.set(k, m)
    }
    return m
  }
  const len = (a: number, b: number): number => Math.max(Math.abs(coords[a * 2] - coords[b * 2]), Math.abs(coords[a * 2 + 1] - coords[b * 2 + 1]))
  const stack = tris.slice()
  let guard = 0
  while (stack.length && guard++ < 4_000_000) {
    const c = stack.pop()!, b = stack.pop()!, a = stack.pop()!
    const ab = len(a, b), bc = len(b, c), ca = len(c, a)
    const m = Math.max(ab, bc, ca)
    if (m <= max) { out.push(a, b, c); continue }
    if (m === ab) { const d = mid(a, b); stack.push(a, d, c, d, b, c) }
    else if (m === bc) { const d = mid(b, c); stack.push(a, b, d, a, d, c) }
    else { const d = mid(c, a); stack.push(a, b, d, d, b, c) }
  }
  return out
}

// Triangulation depends only on the geometry, which a registered geography shares between compiles: moving
// the camera or changing the data recolours a map without triangulating it again.
const triCache = new WeakMap<Float64Array[], Map<string, { coords: number[]; tris: number[] }>>()

function triangulate(poly: Float64Array[], step: number, shift: number): { coords: number[]; tris: number[] } {
  let byKey = triCache.get(poly)
  if (!byKey) triCache.set(poly, (byKey = new Map()))
  const key = `${step}|${shift}`
  const hit = byKey.get(key)
  if (hit) return hit
  const coords: number[] = []
  const holes: number[] = []
  for (let k = 0; k < poly.length; k++) {
    if (k) holes.push(coords.length / 2)
    const d = densify(poly[k], step)
    // Drop the closing duplicate: earcut wants open rings.
    for (let i = 0; i + 2 < d.length; i += 2) coords.push(d[i] + shift, d[i + 1])
  }
  const tris = subdivide(coords, earcut(coords, holes.length ? holes : undefined, 2), step)
  const out = { coords, tris }
  byKey.set(key, out)
  return out
}

export class GlMap {
  private mesh: WebGLProgram
  private line: WebGLProgram
  private ribbon: WebGLProgram
  private box: WebGLProgram
  private disc: WebGLProgram
  private u: Map<WebGLProgram, Record<string, WebGLUniformLocation | null>> = new Map()
  private parts: { regions?: Geometry; outlines?: Geometry; graticule?: Geometry; arcs?: Geometry; columns?: Geometry; points?: Geometry; sea?: Geometry } = {}
  private quad: WebGLBuffer
  private cube: WebGLBuffer
  private geo: SceneGeo | null = null
  private view: ViewParams | null = null
  private pickFb: WebGLFramebuffer | null = null
  private pickTex: WebGLTexture | null = null
  private pickDepth: WebGLRenderbuffer | null = null
  private pickSize = [0, 0]
  private pickDirty = true
  private seaColor: [number, number, number, number] = [0, 0, 0, 0]
  private seaStroke: [number, number, number, number] = [0, 0, 0, 0]

  constructor(private gl: WebGL2RenderingContext, private colors: ColorParser) {
    this.mesh = program(gl, MESH_VS, FLAT_FS)
    this.line = program(gl, LINE_VS, LINE_FS)
    this.ribbon = program(gl, RIBBON_VS, FLAT_FS)
    this.box = program(gl, BOX_VS, FLAT_FS)
    this.disc = program(gl, DISC_VS, DISC_FS)
    for (const p of [this.mesh, this.line, this.ribbon, this.box, this.disc]) this.u.set(p, uniforms(gl, p, UNIFORMS))
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.cube = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cube)
    gl.bufferData(gl.ARRAY_BUFFER, cubeVertices(), gl.STATIC_DRAW)
  }

  /** Upload a map. `resolve` turns `var(...)` paints into colours. */
  set(geo: SceneGeo, resolve: (paint: string) => string): void {
    this.clear()
    this.geo = geo
    this.view = geo.view
    this.pickDirty = true
    const paints = new Map<string, [number, number, number, number]>()
    const rgba = (p: string | undefined): [number, number, number, number] => {
      if (!p || p === 'none' || p === 'transparent') return [0, 0, 0, 0]
      let c = paints.get(p)
      if (!c) paints.set(p, (c = this.colors.rgba(resolve(p))))
      return [c[0], c[1], c[2], c[3]]
    }
    const flat = geo.view.kind === 'flat'
    const step = geo.view.kind === 'globe' ? 3 : 4

    // Regions: roofs (and walls when raised), triangulated in longitude/latitude.
    const pos: number[] = [], col: number[] = [], pick: number[] = [], shade: number[] = [], idx: number[] = []
    const lines: number[] = [], lineCol: number[] = [], dash: number[] = []
    const addVert = (lng: number, lat: number, alt: number, c: number[], p: number[], s: number): number => {
      pos.push(lng, lat, alt); col.push(...c); pick.push(...p); shade.push(s)
      return pos.length / 3 - 1
    }
    for (const r of geo.regions) {
      const c = rgba(r.fill)
      const sc = rgba(r.stroke)
      const p = r.mark >= 0 ? pickColor(r.mark) : [0, 0, 0, 0]
      const alt = r.height > 0 ? r.height : 0
      let west = Infinity, east = -Infinity
      for (const poly of r.polygons) for (let i = 0; i < poly[0].length; i += 2) { west = Math.min(west, poly[0][i]); east = Math.max(east, poly[0][i]) }
      const shifts = flat ? [0, ...(east > 180 ? [-360] : []), ...(west < -180 ? [360] : [])] : [0]
      for (const sh of shifts) {
        for (const poly of r.polygons) {
          const { coords: flatCoords, tris } = triangulate(poly, step, sh)
          const base = pos.length / 3
          for (let i = 0; i < flatCoords.length; i += 2) addVert(flatCoords[i], flatCoords[i + 1], alt + 0.0005, c, p, 1)
          for (const t of tris) idx.push(base + t)
          // Walls for raised regions.
          if (alt > 0) {
            const ring = densify(poly[0], step)
            for (let i = 0; i + 3 < ring.length; i += 2) {
              const a = addVert(ring[i] + sh, ring[i + 1], 0, c, p, 0.72)
              const b = addVert(ring[i + 2] + sh, ring[i + 3], 0, c, p, 0.72)
              const a2 = addVert(ring[i] + sh, ring[i + 1], alt, c, p, 0.72)
              const b2 = addVert(ring[i + 2] + sh, ring[i + 3], alt, c, p, 0.72)
              idx.push(a, b, b2, a, b2, a2)
            }
          }
          // Outlines.
          if (sc[3] > 0) {
            for (const ring of poly) {
              const d = densify(ring, step)
              let run = 0
              for (let i = 0; i + 3 < d.length; i += 2) {
                lines.push(d[i] + sh, d[i + 1], alt + 0.0008, d[i + 2] + sh, d[i + 3], alt + 0.0008)
                lineCol.push(...sc, ...sc)
                const seg = Math.hypot(d[i + 2] - d[i], d[i + 3] - d[i + 1])
                dash.push(r.dashed ? run : -1, r.dashed ? run + seg : -1)
                run += seg
              }
            }
          }
        }
      }
    }
    if (idx.length) this.parts.regions = this.geometry(this.gl.TRIANGLES, [[pos, 3, 'f'], [col, 4, 'u8'], [pick, 4, 'u8'], [shade, 1, 'f']], idx)
    if (lines.length) this.parts.outlines = this.geometry(this.gl.LINES, [[lines, 3, 'f'], [lineCol, 4, 'u8'], [dash, 1, 'f']])

    // Graticule.
    if (geo.graticule) {
      const gc = rgba(geo.graticule)
      const g: number[] = [], gcol: number[] = [], gd: number[] = []
      const seg = (a: number[], b: number[]): void => { g.push(a[0], a[1], 0, b[0], b[1], 0); gcol.push(...gc, ...gc); gd.push(-1, -1) }
      for (let lng = -180; lng < 180; lng += 30) for (let lat = -90; lat < 90; lat += 3) seg([lng, lat], [lng, lat + 3])
      for (let lat = -60; lat <= 60; lat += 30) for (let lng = -180; lng < 180; lng += 3) seg([lng, lat], [lng + 3, lat])
      this.parts.graticule = this.geometry(this.gl.LINES, [[g, 3, 'f'], [gcol, 4, 'u8'], [gd, 1, 'f']])
    }

    // Arcs as ribbons.
    if (geo.arcs.length) {
      const P: number[] = [], PR: number[] = [], NX: number[] = [], SW: number[] = [], C: number[] = [], K: number[] = [], I: number[] = []
      for (const a of geo.arcs) {
        const pts = arcPoints(geo.view, a.from, a.to, a.height, 64)
        const c = rgba(a.stroke)
        c[3] = Math.round(c[3] * a.opacity)
        const p = a.mark >= 0 ? pickColor(a.mark) : [0, 0, 0, 0]
        const base = P.length / 3
        pts.forEach((q, i) => {
          const pr = pts[Math.max(0, i - 1)], nx = pts[Math.min(pts.length - 1, i + 1)]
          for (const side of [-1, 1]) {
            P.push(q.lng, q.lat, q.alt + 0.001); PR.push(pr.lng, pr.lat, pr.alt + 0.001); NX.push(nx.lng, nx.lat, nx.alt + 0.001)
            SW.push(side, Math.max(1.5, a.width)); C.push(...c); K.push(...p)
          }
          if (i) { const v = base + (i - 1) * 2; I.push(v, v + 1, v + 2, v + 1, v + 3, v + 2) }
        })
      }
      this.parts.arcs = this.geometry(this.gl.TRIANGLES, [[P, 3, 'f'], [PR, 3, 'f'], [NX, 3, 'f'], [SW, 2, 'f'], [C, 4, 'u8'], [K, 4, 'u8']], I)
    }

    // Columns: instanced boxes.
    if (geo.columns.length) {
      const inst: number[] = [], C: number[] = [], K: number[] = []
      for (const c of geo.columns) {
        inst.push(c.lng, c.lat, c.height, c.width / 2)
        C.push(...rgba(c.fill)); K.push(...(c.mark >= 0 ? pickColor(c.mark) : [0, 0, 0, 0]))
      }
      this.parts.columns = this.instanced(this.gl.TRIANGLES, this.cube, [[3, 0], [1, 12]], 16, 36, [[inst, 4, 'f'], [C, 4, 'u8'], [K, 4, 'u8']], geo.columns.length)
    }

    // Points.
    if (geo.points.length) {
      const inst: number[] = [], F: number[] = [], S: number[] = [], K: number[] = []
      for (const p of geo.points) {
        inst.push(p.lng, p.lat, p.r, p.stroke ? 1 : 0)
        const f = rgba(p.fill)
        f[3] = Math.round(f[3] * p.opacity)
        F.push(...f); S.push(...rgba(p.stroke || undefined)); K.push(...(p.mark >= 0 ? pickColor(p.mark) : [0, 0, 0, 0]))
      }
      this.parts.points = this.instanced(this.gl.TRIANGLE_STRIP, this.quad, [[2, 0]], 8, 4, [[inst, 4, 'f'], [F, 4, 'u8'], [S, 4, 'u8'], [K, 4, 'u8']], geo.points.length)
    }

    // The sea behind the globe.
    if (geo.sphere && geo.view.kind === 'globe') {
      this.seaColor = rgba(geo.sphere.fill)
      this.seaStroke = rgba(geo.sphere.stroke)
      this.parts.sea = this.instanced(this.gl.TRIANGLE_STRIP, this.quad, [[2, 0]], 8, 4, [[[0, 0, 1, 1], 4, 'f'], [[...this.seaColor], 4, 'u8'], [[...this.seaStroke], 4, 'u8'], [[0, 0, 0, 0], 4, 'u8']], 1)
    }
  }

  /** Move the camera without re-uploading anything. */
  setView(view: ViewParams): void {
    this.view = view
    this.pickDirty = true
  }

  getView(): ViewParams | null { return this.view }

  private setUniforms(p: WebGLProgram, width: number, height: number, dpr: number, pickMode: number): void {
    const gl = this.gl
    const v = this.view!
    const u = this.u.get(p)!
    const b = (v.camera.bearing * Math.PI) / 180
    const t = (v.camera.pitch * Math.PI) / 180
    gl.uniform1i(u.u_kind, v.kind === 'globe' ? 1 : 0)
    gl.uniform1i(u.u_proj, PROJ_ID[v.projection] ?? 0)
    gl.uniform2f(u.u_size, width, height)
    gl.uniform4f(u.u_rect, v.rect.x, v.rect.y, v.rect.w, v.rect.h)
    gl.uniform2f(u.u_center, v.centerX, v.centerY)
    gl.uniform1f(u.u_scale, v.scale)
    gl.uniform1f(u.u_radius, v.radius)
    gl.uniform1f(u.u_dist, v.distance)
    gl.uniform1f(u.u_heightPx, v.heightPx)
    gl.uniform2f(u.u_cam, (v.camera.lng * Math.PI) / 180, (v.camera.lat * Math.PI) / 180)
    gl.uniform2f(u.u_rot, Math.cos(b), Math.sin(b))
    gl.uniform2f(u.u_pitch, Math.cos(t), Math.sin(t))
    gl.uniform1f(u.u_depthK, v.kind === 'globe' ? 1 / (v.radius * 2.2) : 1 / (Math.max(v.rect.w, v.rect.h) * 8))
    gl.uniform1i(u.u_pickMode, pickMode)
    gl.uniform1f(u.u_alpha, 1)
    gl.uniform1f(u.u_px, 1 / dpr)
    gl.uniform1i(u.u_screenDisc, 0)
    gl.uniform1f(u.u_lift, 0.002)
  }

  /** Draw into the current framebuffer (`pickMode`: item ids, no blending). */
  draw(width: number, height: number, dpr: number, pickMode = 0): void {
    const gl = this.gl
    const v = this.view
    if (!v || !this.geo) return
    const vp = gl.getParameter(gl.VIEWPORT) as Int32Array
    gl.enable(gl.SCISSOR_TEST)
    const sx = vp[2] / width, sy = vp[3] / height
    gl.scissor(Math.floor(v.rect.x * sx), Math.floor((height - v.rect.y - v.rect.h) * sy), Math.ceil(v.rect.w * sx), Math.ceil(v.rect.h * sy))
    if (pickMode) gl.disable(gl.BLEND)
    else { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) }
    const P = this.parts
    // The sea: a disc behind everything, no depth.
    if (P.sea && !pickMode) {
      gl.disable(gl.DEPTH_TEST)
      gl.useProgram(this.disc)
      this.setUniforms(this.disc, width, height, dpr, 0)
      const u = this.u.get(this.disc)!
      gl.uniform1i(u.u_screenDisc, 1)
      // Rewrite the single instance with the current centre and radius.
      const cx = v.rect.x + v.rect.w / 2, cy = v.rect.y + v.rect.h / 2
      gl.bindBuffer(gl.ARRAY_BUFFER, P.sea.buffers[0])
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([cx, cy, v.radius, 1]))
      gl.bindVertexArray(P.sea.vao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1)
    }
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    if (P.graticule && !pickMode) {
      gl.depthMask(false)
      this.run(this.line, P.graticule, width, height, dpr, 0)
      gl.depthMask(true)
    }
    if (P.regions) this.run(this.mesh, P.regions, width, height, dpr, pickMode)
    if (P.outlines && !pickMode) this.run(this.line, P.outlines, width, height, dpr, 0)
    if (P.columns) this.run(this.box, P.columns, width, height, dpr, pickMode)
    if (P.arcs) {
      gl.depthMask(false)
      this.run(this.ribbon, P.arcs, width, height, dpr, pickMode)
      gl.depthMask(true)
    }
    if (P.points) {
      gl.disable(gl.DEPTH_TEST)
      this.run(this.disc, P.points, width, height, dpr, pickMode)
    }
    gl.bindVertexArray(null)
    gl.disable(gl.SCISSOR_TEST)
    gl.disable(gl.DEPTH_TEST)
  }

  private run(p: WebGLProgram, g: Geometry, width: number, height: number, dpr: number, pickMode: number): void {
    const gl = this.gl
    gl.useProgram(p)
    this.setUniforms(p, width, height, dpr, pickMode)
    gl.bindVertexArray(g.vao)
    if (g.instances !== undefined) gl.drawArraysInstanced(g.mode, 0, g.count, g.instances)
    else if (g.indexed) gl.drawElements(g.mode, g.count, gl.UNSIGNED_INT, 0)
    else gl.drawArrays(g.mode, 0, g.count)
  }

  /** The mark index under a scene-pixel point, from an id render (redrawn only when the view changed). */
  pick(x: number, y: number, width: number, height: number, dpr: number): number {
    const gl = this.gl
    if (!this.view) return -1
    const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr))
    if (!this.pickFb || this.pickSize[0] !== w || this.pickSize[1] !== h) {
      this.disposePick()
      this.pickTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.pickTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.pickDepth = gl.createRenderbuffer()
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth)
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h)
      this.pickFb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth)
      this.pickSize = [w, h]
      this.pickDirty = true
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFb)
    gl.viewport(0, 0, w, h)
    if (this.pickDirty) {
      gl.clearColor(0, 0, 0, 0)
      gl.clearDepth(1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      this.draw(width, height, dpr, 1)
      this.pickDirty = false
    }
    const px = new Uint8Array(4)
    const px0 = Math.min(w - 1, Math.max(0, Math.floor(x * dpr)))
    const py0 = Math.min(h - 1, Math.max(0, h - 1 - Math.floor(y * dpr)))
    gl.readPixels(px0, py0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return pickIndex(px)
  }

  private geometry(mode: number, attrs: [number[], number, 'f' | 'u8'][], indices?: number[]): Geometry {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const buffers: WebGLBuffer[] = []
    attrs.forEach(([data, size, type], loc) => {
      const b = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, type === 'f' ? new Float32Array(data) : new Uint8Array(data), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, type === 'f' ? gl.FLOAT : gl.UNSIGNED_BYTE, type === 'u8', 0, 0)
      buffers.push(b)
    })
    let count = attrs[0][0].length / attrs[0][1]
    if (indices) {
      const ib = gl.createBuffer()!
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW)
      buffers.push(ib)
      count = indices.length
    }
    gl.bindVertexArray(null)
    return { vao, buffers, count, indexed: !!indices, mode }
  }

  /** A shared per-vertex buffer (`layout`: [size, byte offset] per attribute) plus per-instance attributes. */
  private instanced(mode: number, shape: WebGLBuffer, layout: [number, number][], stride: number, count: number, attrs: [number[], number, 'f' | 'u8'][], instances: number): Geometry {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, shape)
    layout.forEach(([size, offset], loc) => {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
    })
    const buffers: WebGLBuffer[] = []
    attrs.forEach(([data, size, type], k) => {
      const loc = layout.length + k
      const b = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, type === 'f' ? new Float32Array(data) : new Uint8Array(data), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, type === 'f' ? gl.FLOAT : gl.UNSIGNED_BYTE, type === 'u8', 0, 0)
      gl.vertexAttribDivisor(loc, 1)
      buffers.push(b)
    })
    gl.bindVertexArray(null)
    return { vao, buffers, count, instances, mode }
  }

  private clear(): void {
    const gl = this.gl
    for (const g of Object.values(this.parts)) {
      if (!g) continue
      gl.deleteVertexArray(g.vao)
      for (const b of g.buffers) gl.deleteBuffer(b)
    }
    this.parts = {}
    this.geo = null
  }

  private disposePick(): void {
    const gl = this.gl
    if (this.pickFb) gl.deleteFramebuffer(this.pickFb)
    if (this.pickTex) gl.deleteTexture(this.pickTex)
    if (this.pickDepth) gl.deleteRenderbuffer(this.pickDepth)
    this.pickFb = null
    this.pickTex = null
    this.pickDepth = null
  }

  dispose(): void {
    this.clear()
    this.disposePick()
    const gl = this.gl
    gl.deleteBuffer(this.quad)
    gl.deleteBuffer(this.cube)
    for (const p of [this.mesh, this.line, this.ribbon, this.box, this.disc]) gl.deleteProgram(p)
  }
}

/** A box from the ground (z 0) to its top (z 1) as 12 triangles: x, y, z, then a light factor per face. */
function cubeVertices(): Float32Array {
  const v: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[], light: number): void => {
    for (const p of [a, b, c, a, c, d]) v.push(p[0], p[1], p[2], light)
  }
  const P = (x: number, y: number, z: number): number[] => [x, y, z]
  quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), 1.0) // top
  quad(P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1), 0.78) // south
  quad(P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1), 0.88) // east
  quad(P(1, 1, 0), P(-1, 1, 0), P(-1, 1, 1), P(1, 1, 1), 0.7) // north
  quad(P(-1, 1, 0), P(-1, -1, 0), P(-1, -1, 1), P(-1, 1, 1), 0.82) // west
  quad(P(-1, -1, 0), P(-1, 1, 0), P(1, 1, 0), P(1, -1, 0), 0.6) // bottom
  return new Float32Array(v)
}
