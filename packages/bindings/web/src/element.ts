import type { Camera, Issue } from '@supersolutions/super-plot-core/base'
import { SuperPlot, type BrushSelection, type SelectEvent, type SuperPlotOptions, type ZoomRange } from './plot.js'

/**
 * `<super-plot>`: the plot as a web component, for any framework (Vue, Svelte, Angular, plain HTML).
 *
 *   <super-plot theme="dark" spec='{"type":"bar", ...}'></super-plot>
 *
 * Properties: `spec` (object or JSON string), `theme`, `locale`, `renderer` (auto | svg | canvas | webgl).
 * Events (bubbling CustomEvents): `plot-select` (detail: SelectEvent), `plot-issues` (detail: Issue[]),
 * `plot-hover` (SelectEvent or null), `plot-render` (RenderEvent), `plot-zoom` (ZoomRange or null),
 * `plot-brush` (BrushSelection or null) and, for maps, `plot-camera` (Camera) when the viewer moved the map.
 * Methods: `appendRows(rows, { max })`, `setZoom()`, `getZoom()`, `setBrush()`, `getBrush()`, `toSvg()`, `toPng()`.
 */
export function defineSuperPlot(name = 'super-plot'): CustomElementConstructor {
  const existing = customElements.get(name)
  if (existing) return existing
  class SuperPlotElement extends HTMLElement {
    static observedAttributes = ['spec', 'theme', 'locale', 'renderer']
    private plot: SuperPlot | null = null
    private _spec: unknown = undefined
    private pending: Partial<SuperPlotOptions> = {}

    get spec(): unknown { return this._spec }
    set spec(v: unknown) {
      this._spec = typeof v === 'string' ? safeParse(v) : v
      this.sync()
    }

    connectedCallback(): void {
      if (this.style.display === '') this.style.display = 'block'
      this.sync()
    }

    disconnectedCallback(): void {
      this.plot?.dispose()
      this.plot = null
    }

    attributeChangedCallback(attr: string, _old: string | null, value: string | null): void {
      if (attr === 'spec') this.spec = value ?? undefined
      else {
        const patch = attr === 'renderer' ? rendererOf(value) : { [attr]: value ?? undefined }
        this.pending = { ...this.pending, ...patch }
        this.plot?.setOptions(attr === 'renderer' && !value ? { renderer: 'auto' } : patch)
      }
    }

    /** The underlying instance, for everything else (`getScene()`, `setCamera()`, ...). */
    get instance(): SuperPlot | null { return this.plot }
    appendRows(rows: readonly unknown[], options?: { max?: number }): void { this.plot?.appendRows(rows, options) }
    getZoom(): ZoomRange | null { return this.plot?.getZoom() ?? null }
    setZoom(z: { x?: unknown; y?: unknown } | null): void { this.plot?.setZoom(z) }
    getBrush(): BrushSelection | null { return this.plot?.getBrush() ?? null }
    setBrush(b: { x?: unknown; y?: unknown } | null): void { this.plot?.setBrush(b) }
    toSvg(): string { if (!this.plot) throw new Error('Not mounted.'); return this.plot.toSvg() }
    toPng(scale?: number): Promise<Blob> { return this.plot ? this.plot.toPng(scale) : Promise.reject(new Error('Not mounted.')) }

    private sync(): void {
      if (!this.isConnected || this._spec === undefined) return
      if (this.plot) this.plot.setSpec(this._spec)
      else {
        this.plot = new SuperPlot(this, this._spec, {
          theme: this.getAttribute('theme') ?? undefined,
          locale: this.getAttribute('locale') ?? undefined,
          ...rendererOf(this.getAttribute('renderer')),
          ...this.pending,
          onSelect: (e: SelectEvent) => this.dispatchEvent(new CustomEvent('plot-select', { detail: e, bubbles: true })),
          onIssues: (issues: Issue[]) => this.dispatchEvent(new CustomEvent('plot-issues', { detail: issues, bubbles: true })),
          onCameraChange: (camera: Camera) => this.dispatchEvent(new CustomEvent('plot-camera', { detail: camera, bubbles: true })),
          onHover: e => this.dispatchEvent(new CustomEvent('plot-hover', { detail: e, bubbles: true })),
          onRender: e => this.dispatchEvent(new CustomEvent('plot-render', { detail: e, bubbles: true })),
          onZoom: z => this.dispatchEvent(new CustomEvent('plot-zoom', { detail: z, bubbles: true })),
          onBrush: b => this.dispatchEvent(new CustomEvent('plot-brush', { detail: b, bubbles: true }))
        })
      }
    }
  }
  customElements.define(name, SuperPlotElement)
  return SuperPlotElement
}

const RENDERERS = ['auto', 'svg', 'canvas', 'webgl'] as const
const rendererOf = (v: string | null): Partial<SuperPlotOptions> => (RENDERERS.includes(v as (typeof RENDERERS)[number]) ? { renderer: v as (typeof RENDERERS)[number] } : {})

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
