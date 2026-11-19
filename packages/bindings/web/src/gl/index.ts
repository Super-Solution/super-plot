/**
 * The WebGL2 layer of the canvas view: one context per plot that draws the marks a 2D canvas is slow at
 * (tens of thousands of dots, a map's geography in 3D) and leaves everything else (text, axes, legend) to the
 * 2D canvases above and below it. Loaded on demand, so charts that never need it never download it.
 */
import { makeView, type Camera, type Mark, type Scene, type ViewParams } from '@supersolutions/super-plot-core/base'
import { acquireContext, ColorParser, probeWebGL, releaseContext } from './context.js'
import { GlMap } from './map.js'
import { GlMarks, takesMark } from './marks.js'

export { probeWebGL, liveContexts, MAX_CONTEXTS } from './context.js'

export class GlView {
  readonly canvas: HTMLCanvasElement
  private marks: GlMarks
  private map: GlMap
  private hasMap = false
  private scene: Scene | null = null
  private width = 0
  private height = 0
  private dpr = 1
  private lost = false
  private released = false
  /** Why the last `create` failed after getting a context (a shader the driver rejected), for diagnostics. */
  static lastError = ''

  /** Null when the browser gives no WebGL2 or the page already holds as many contexts as it safely can. */
  static create(doc: Document, onLost: () => void): GlView | null {
    if (!probeWebGL(doc).ok) {
      GlView.lastError = 'This browser has no WebGL2.'
      return null
    }
    if (!acquireContext()) {
      GlView.lastError = 'Too many WebGL plots on this page; this one draws on canvas.'
      return null
    }
    const canvas = doc.createElement('canvas')
    let gl: WebGL2RenderingContext | null = null
    try {
      gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, depth: true, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null
    } catch {
      gl = null
    }
    if (!gl) {
      GlView.lastError = 'The browser returned no WebGL2 context.'
      releaseContext()
      return null
    }
    try {
      return new GlView(doc, canvas, gl, onLost)
    } catch (e) {
      GlView.lastError = e instanceof Error ? e.message : String(e)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      releaseContext()
      return null
    }
  }

  private constructor(doc: Document, canvas: HTMLCanvasElement, private gl: WebGL2RenderingContext, onLost: () => void) {
    this.canvas = canvas
    canvas.style.pointerEvents = 'none'
    canvas.setAttribute('aria-hidden', 'true')
    const colors = new ColorParser(doc)
    this.marks = new GlMarks(gl, colors)
    this.map = new GlMap(gl, colors)
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault()
      if (this.released) return
      this.lost = true
      onLost()
    })
  }

  get isLost(): boolean { return this.lost || this.gl.isContextLost() }

  /** Which marks of a scene this layer draws (the 2D canvases skip them). */
  takes(scene: Scene): (m: Mark) => boolean {
    return scene.geo ? (m => m.layer === 'geo') : takesMark
  }

  /** Upload a scene and draw it. */
  set(scene: Scene, dpr: number, resolve: (paint: string) => string): void {
    this.scene = scene
    this.width = scene.width
    this.height = scene.height
    this.dpr = dpr
    this.canvas.width = Math.round(scene.width * dpr)
    this.canvas.height = Math.round(scene.height * dpr)
    if (scene.geo) {
      this.marks.clear()
      this.map.set(scene.geo, resolve)
      this.hasMap = true
    } else {
      this.hasMap = false
      this.marks.set(scene, resolve)
    }
    this.draw()
  }

  /** Move a map's camera: a uniform change, nothing is rebuilt. Returns the view now on screen. */
  setCamera(camera: Partial<Camera>): ViewParams | null {
    const geo = this.scene?.geo
    if (!geo || !this.hasMap) return null
    const view = makeView({ ...geo.input, camera: { ...geo.view.camera, ...camera } })
    this.map.setView(view)
    this.draw()
    return view
  }

  getView(): ViewParams | null { return this.hasMap ? this.map.getView() : null }

  draw(): void {
    if (this.isLost) return
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    if (this.hasMap) this.map.draw(this.width, this.height, this.dpr)
    else this.marks.draw(this.width, this.height, this.dpr)
  }

  /** The mark index of a map item under a scene-pixel point, or -1. */
  pick(x: number, y: number): number {
    if (!this.hasMap || this.isLost) return -1
    const i = this.map.pick(x, y, this.width, this.height, this.dpr)
    // The pick buffer is a separate framebuffer; restore the screen's viewport.
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    return i
  }

  /** Read the screen buffer into a 2D canvas (PNG export). Draws first so the buffer is not yet cleared. */
  copyTo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.isLost) return
    this.draw()
    ctx.drawImage(this.canvas, 0, 0, w, h)
  }

  dispose(): void {
    if (this.released) return
    this.released = true
    if (!this.isLost) {
      this.marks.dispose()
      this.map.dispose()
    }
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.canvas.remove()
    releaseContext()
  }
}
