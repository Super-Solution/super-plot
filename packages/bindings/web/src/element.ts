import type { Issue } from '@supersolutions/super-plot-core'
import { SuperPlot, type SelectEvent, type SuperPlotOptions } from './plot.js'

/**
 * `<super-plot>`: the plot as a web component, for any framework (Vue, Svelte, Angular, plain HTML).
 *
 *   <super-plot theme="dark" spec='{"type":"bar", ...}'></super-plot>
 *
 * Properties: `spec` (object or JSON string), `theme`, `locale`. Events (bubbling CustomEvents):
 * `plot-select` (detail: SelectEvent) and `plot-issues` (detail: Issue[]).
 */
export function defineSuperPlot(name = 'super-plot'): CustomElementConstructor {
  const existing = customElements.get(name)
  if (existing) return existing
  class SuperPlotElement extends HTMLElement {
    static observedAttributes = ['spec', 'theme', 'locale']
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
        this.pending = { ...this.pending, [attr]: value ?? undefined }
        this.plot?.setOptions({ [attr]: value ?? undefined })
      }
    }

    /** The underlying instance, for `toSvg()` / `toPng()` / `getScene()`. */
    get instance(): SuperPlot | null { return this.plot }

    private sync(): void {
      if (!this.isConnected || this._spec === undefined) return
      if (this.plot) this.plot.setSpec(this._spec)
      else {
        this.plot = new SuperPlot(this, this._spec, {
          theme: this.getAttribute('theme') ?? undefined,
          locale: this.getAttribute('locale') ?? undefined,
          ...this.pending,
          onSelect: (e: SelectEvent) => this.dispatchEvent(new CustomEvent('plot-select', { detail: e, bubbles: true })),
          onIssues: (issues: Issue[]) => this.dispatchEvent(new CustomEvent('plot-issues', { detail: issues, bubbles: true }))
        })
      }
    }
  }
  customElements.define(name, SuperPlotElement)
  return SuperPlotElement
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
