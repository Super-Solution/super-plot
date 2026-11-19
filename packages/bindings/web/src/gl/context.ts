// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
/**
 * WebGL2 plumbing shared by the 2D mark renderer and the 3D map renderer: program compilation, colour
 * parsing, and a page-wide budget of live contexts (browsers cap them at roughly 8-16 and silently drop the
 * oldest, so plots past the budget stay on canvas instead).
 */

export const MAX_CONTEXTS = 8
let live = 0

export function acquireContext(): boolean {
  if (live >= MAX_CONTEXTS) return false
  live++
  return true
}

export function releaseContext(): void {
  live = Math.max(0, live - 1)
}

export const liveContexts = (): number => live

let probe: { ok: boolean; software: boolean; renderer: string } | null = null

/**
 * Does this browser give WebGL2, and is it a real GPU? A software rasteriser (SwiftShader, llvmpipe) draws
 * correctly but is slower than canvas for flat marks, so `auto` only picks WebGL for 2D charts on hardware.
 */
export function probeWebGL(doc: Document): { ok: boolean; software: boolean; renderer: string } {
  if (probe) return probe
  try {
    const c = doc.createElement('canvas')
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl || typeof gl.createShader !== 'function') return (probe = { ok: false, software: false, renderer: '' })
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return (probe = { ok: true, software: /swiftshader|llvmpipe|software|basic render|softpipe/i.test(renderer), renderer })
  } catch {
    return (probe = { ok: false, software: false, renderer: '' })
  }
}

/** For tests: forget the cached probe. */
export const resetProbe = (): void => { probe = null }

export function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`Super Plot WebGL shader: ${gl.getShaderInfoLog(s)}`)
    return s
  }
  const p = gl.createProgram()!
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Super Plot WebGL program: ${gl.getProgramInfoLog(p)}`)
  return p
}

export function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
  return Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]))
}

/** Parses CSS colours to RGBA bytes with the browser's own parser (a 2D context), cached per string. */
export class ColorParser {
  private ctx: CanvasRenderingContext2D | null
  private cache = new Map<string, [number, number, number, number]>()

  constructor(doc: Document) {
    this.ctx = doc.createElement('canvas').getContext('2d')
  }

  rgba(css: string): [number, number, number, number] {
    const hit = this.cache.get(css)
    if (hit) return hit
    let out: [number, number, number, number] = [0, 0, 0, 255]
    const c = this.ctx
    if (c) {
      c.fillStyle = '#000'
      c.fillStyle = css
      const v = String(c.fillStyle)
      if (v.startsWith('#')) {
        const n = parseInt(v.slice(1, 7), 16)
        out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
      } else {
        const m = /rgba?\(([^)]+)\)/.exec(v)
        if (m) {
          const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
          out = [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? Math.round(p[3] * 255) : 255]
        }
      }
    }
    if (this.cache.size > 4096) this.cache.clear()
    this.cache.set(css, out)
    return out
  }
}

/** Mark index (or -1) to a pick colour and back: 24 bits, so up to 16 million pickable items. */
export const pickColor = (i: number): [number, number, number, number] => {
  const v = i + 1
  return [v & 255, (v >> 8) & 255, (v >> 16) & 255, 255]
}
export const pickIndex = (px: Uint8Array): number => (px[3] === 0 ? -1 : (px[0] | (px[1] << 8) | (px[2] << 16)) - 1)
