// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * Draws a scene's data circles and rectangles with instanced WebGL2 quads: one draw call per run of marks of
 * the same kind, shapes cut by a signed distance in the fragment shader (anti-aliased edge, optional stroke,
 * rounded corners). Positions stay in scene pixels; the vertex shader maps them to clip space.
 */
import type { Mark, Scene } from '@supersolutions/super-plot-core/base'
import { ColorParser, program, uniforms } from './context.js'

const VS = `#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 geom;     // circle: cx, cy, r, 0      rect: x, y, w, h
layout(location=2) in vec3 extra;    // stroke width, opacity, corner radius
layout(location=3) in vec4 fill;
layout(location=4) in vec4 stroke;
uniform vec2 size;
uniform int kind;                    // 0 circle, 1 rect
out vec2 local;
out vec2 vHalf;
out vec3 vExtra;
out vec4 vFill;
out vec4 vStroke;
void main() {
  float pad = extra.x * 0.5 + 1.5;
  vec2 c; vec2 h;
  if (kind == 0) { c = geom.xy; h = vec2(geom.z); }
  else { c = geom.xy + geom.zw * 0.5; h = max(geom.zw * 0.5, vec2(0.0)); }
  vec2 p = c + corner * (h + pad);
  local = corner * (h + pad);
  vHalf = h;
  vExtra = extra; vFill = fill; vStroke = stroke;
  gl_Position = vec4(p / size * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 local;
in vec2 vHalf;
in vec3 vExtra;
in vec4 vFill;
in vec4 vStroke;
uniform int kind;
uniform float px;                    // one device pixel in scene pixels
out vec4 o;
void main() {
  float d;
  if (kind == 0) d = length(local) - vHalf.x;
  else {
    float r = min(vExtra.z, min(vHalf.x, vHalf.y));
    vec2 q = abs(local) - vHalf + r;
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float sw = vExtra.x;
  float aa = px;
  float inside = clamp(0.5 - d / aa, 0.0, 1.0);
  vec4 col = vFill;
  if (sw > 0.0) {
    // The stroke straddles the edge, like canvas and SVG.
    float outer = clamp(0.5 - (d - sw * 0.5) / aa, 0.0, 1.0);
    float inner = clamp(0.5 - (d + sw * 0.5) / aa, 0.0, 1.0);
    vec4 f = vec4(vFill.rgb * vFill.a, vFill.a) * inner;
    vec4 s = vec4(vStroke.rgb * vStroke.a, vStroke.a) * (outer - inner);
    vec4 c = f + s * (1.0 - f.a);
    o = c * vExtra.y;
    if (o.a <= 0.001) discard;
    return;
  }
  float a = col.a * inside * vExtra.y;
  if (a <= 0.001) discard;
  o = vec4(col.rgb * a, a);
}`

/** Which marks this renderer takes over from the 2D canvas. */
export const takesMark = (m: Mark): boolean => m.role === 'data' && (m.type === 'circle' || (m.type === 'rect' && !Array.isArray(m.r))) && !m.layer

interface Batch { kind: 0 | 1; vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; count: number }

export class GlMarks {
  private prog: WebGLProgram
  private u: Record<string, WebGLUniformLocation | null>
  private corner: WebGLBuffer
  private batches: Batch[] = []

  constructor(private gl: WebGL2RenderingContext, private colors: ColorParser) {
    this.prog = program(gl, VS, FS)
    this.u = uniforms(gl, this.prog, ['size', 'kind', 'px'])
    this.corner = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corner)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  }

  /** Upload the scene's GL marks. `resolve` turns `var(...)` paints into colours. Returns how many were taken. */
  set(scene: Scene, resolve: (paint: string) => string): number {
    this.clear()
    const gl = this.gl
    let taken = 0
    let run: Mark[] = []
    let runKind: 0 | 1 = 0
    // Thousands of dots share a handful of paints: resolve each (CSS variables, colour parsing) once.
    const NONE: [number, number, number, number] = [0, 0, 0, 0]
    const paints = new Map<string, [number, number, number, number]>()
    const paint = (p: string | undefined): [number, number, number, number] => {
      if (!p || p === 'none' || p === 'transparent') return NONE
      let c = paints.get(p)
      if (!c) paints.set(p, (c = this.colors.rgba(resolve(p))))
      return c
    }
    const flush = (): void => {
      if (!run.length) return
      const n = run.length
      const geom = new Float32Array(n * 4)
      const extra = new Float32Array(n * 3)
      const col = new Uint8Array(n * 8)
      for (let i = 0; i < n; i++) {
        const m = run[i]
        const g = i * 4, e = i * 3, k = i * 8
        const sw = m.type === 'circle' || m.type === 'rect' ? (m.stroke && m.stroke !== 'none' ? m.strokeWidth ?? 1 : 0) : 0
        if (m.type === 'circle') {
          geom[g] = m.cx; geom[g + 1] = m.cy; geom[g + 2] = m.r
          extra[e] = sw; extra[e + 1] = m.opacity ?? 1
        } else if (m.type === 'rect') {
          geom[g] = m.x; geom[g + 1] = m.y; geom[g + 2] = Math.max(0, m.w); geom[g + 3] = Math.max(0, m.h)
          extra[e] = sw; extra[e + 1] = m.opacity ?? 1; extra[e + 2] = typeof m.r === 'number' ? m.r : 0
        }
        const f = paint((m as { fill?: string }).fill)
        const s = paint((m as { stroke?: string }).stroke)
        col[k] = f[0]; col[k + 1] = f[1]; col[k + 2] = f[2]; col[k + 3] = f[3]
        col[k + 4] = s[0]; col[k + 5] = s[1]; col[k + 6] = s[2]; col[k + 7] = s[3]
      }
      const vao = gl.createVertexArray()!
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.corner)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      const bg = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, bg)
      gl.bufferData(gl.ARRAY_BUFFER, geom, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(1, 1)
      const be = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, be)
      gl.bufferData(gl.ARRAY_BUFFER, extra, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(2)
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0)
      gl.vertexAttribDivisor(2, 1)
      const bc = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, bc)
      gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(3)
      gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 8, 0)
      gl.vertexAttribDivisor(3, 1)
      gl.enableVertexAttribArray(4)
      gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 8, 4)
      gl.vertexAttribDivisor(4, 1)
      gl.bindVertexArray(null)
      this.batches.push({ kind: runKind, vao, buffers: [bg, be, bc], count: n })
      taken += n
      run = []
    }
    for (const m of scene.marks) {
      if (!takesMark(m)) continue
      const k: 0 | 1 = m.type === 'circle' ? 0 : 1
      if (run.length && k !== runKind) flush()
      runKind = k
      run.push(m)
    }
    flush()
    return taken
  }

  draw(width: number, height: number, dpr: number): void {
    const gl = this.gl
    if (!this.batches.length) return
    gl.useProgram(this.prog)
    gl.uniform2f(this.u.size, width, height)
    gl.uniform1f(this.u.px, 1 / dpr)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.disable(gl.DEPTH_TEST)
    for (const b of this.batches) {
      gl.uniform1i(this.u.kind, b.kind)
      gl.bindVertexArray(b.vao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count)
    }
    gl.bindVertexArray(null)
  }

  clear(): void {
    const gl = this.gl
    for (const b of this.batches) {
      gl.deleteVertexArray(b.vao)
      for (const buf of b.buffers) gl.deleteBuffer(buf)
    }
    this.batches = []
  }

  dispose(): void {
    this.clear()
    this.gl.deleteBuffer(this.corner)
    this.gl.deleteProgram(this.prog)
  }
}
