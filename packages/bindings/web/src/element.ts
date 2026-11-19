// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
import type { Camera, Issue } from '@supersolutions/super-plot-core/base'
import { SuperPlot, type BrushSelection, type SelectEvent, type SuperPlotOptions, type ToolbarItem, type ZoomRange } from './plot.js'
import { idleController, type SonifyController, type SonifyOptions } from './sound.js'

/** Callbacks the element turns into DOM events; one passed in `options` is called as well. */
const EVENTS = ['onSelect', 'onIssues', 'onCameraChange', 'onHover', 'onRender', 'onZoom', 'onBrush', 'onDrill'] as const
type EventKey = (typeof EVENTS)[number]

/**
 * `<super-plot>`: the plot as a web component, for any framework (Vue, Svelte, Angular, plain HTML).
 *
 *   <super-plot theme="dark" toolbar sync="sales" spec='{"type":"bar", ...}'></super-plot>
 *
 * Properties: `spec` (object or JSON string), `options` (any `SuperPlotOptions`, set as an object: what
 * Vue, Svelte and Angular do with a property binding), and `locale`, `timeZone` and `strings` (the UI-string
 * overrides, an object). Attributes: `spec`, `theme`, `locale`, `time-zone` (an IANA name), `strings` (JSON),
 * `renderer` (auto | svg | canvas | webgl), `toolbar` (present for the default buttons, or a comma list such as
 * `"png,csv,sound"`; `"false"` for none), `sync` (a group key), the flags `navigator` and `drill` (present
 * for true, `"false"` for false), and `transition` (present for true, a number of ms, or `"false"`). Attributes win over the properties, and those over the same key in `options`.
 * Events (bubbling CustomEvents): `plot-select` (detail: SelectEvent), `plot-issues` (detail: Issue[]),
 * `plot-hover` (SelectEvent or null), `plot-render` (RenderEvent), `plot-zoom` (ZoomRange or null),
 * `plot-brush` (BrushSelection or null), `plot-drill` (the focus path, string[]) and, for maps, `plot-camera`
 * (Camera) when the viewer moved the map.
 * Methods: `appendRows(rows, { max })`, `setZoom()`, `getZoom()`, `setBrush()`, `getBrush()`, `toSvg()`, `toPng()`,
 * `toCsv()`, `sonify(options)`.
 */
export function defineSuperPlot(name = 'super-plot'): CustomElementConstructor {
  const existing = customElements.get(name)
  if (existing) return existing
  class SuperPlotElement extends HTMLElement {
    static observedAttributes = ['spec', 'theme', 'locale', 'time-zone', 'strings', 'renderer', 'toolbar', 'sync', 'navigator', 'drill', 'transition']
    private plot: SuperPlot | null = null
    private _spec: unknown = undefined
    private _options: Partial<SuperPlotOptions> = {}
    /** Set through the `locale`, `timeZone` and `strings` properties. */
    private props: Partial<SuperPlotOptions> = {}
    private pending: Partial<SuperPlotOptions> = {}

    get spec(): unknown { return this._spec }
    set spec(v: unknown) {
      this._spec = typeof v === 'string' ? safeParse(v) : v
      this.sync()
    }

    /** Options as an object (callbacks included; the element still dispatches its events). */
    get options(): Partial<SuperPlotOptions> { return this._options }
    set options(v: Partial<SuperPlotOptions> | null | undefined) {
      this._options = v && typeof v === 'object' ? v : {}
      this.plot?.setOptions({ ...this.base(), ...this.pending })
    }

    get locale(): string | undefined { return this.pending.locale ?? this.props.locale ?? this._options.locale }
    set locale(v: string | null | undefined) { this.setProp('locale', typeof v === 'string' ? v : undefined) }
    get timeZone(): string | undefined { return this.pending.timeZone ?? this.props.timeZone ?? this._options.timeZone }
    set timeZone(v: string | null | undefined) { this.setProp('timeZone', typeof v === 'string' ? v : undefined) }
    get strings(): SuperPlotOptions['strings'] { return this.pending.strings ?? this.props.strings ?? this._options.strings }
    set strings(v: SuperPlotOptions['strings'] | string | null | undefined) {
      const o = typeof v === 'string' ? safeParse(v) : v
      this.setProp('strings', o && typeof o === 'object' ? o as SuperPlotOptions['strings'] : undefined)
    }

    connectedCallback(): void {
      // A framework may set `spec` or `options` before this class was defined: take those over now.
      for (const k of ['spec', 'options', 'locale', 'timeZone', 'strings'] as const) {
        if (!Object.prototype.hasOwnProperty.call(this, k)) continue
        const v = (this as Record<string, unknown>)[k]
        delete (this as Record<string, unknown>)[k]
        ;(this as Record<string, unknown>)[k] = v
      }
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
        const patch = optionOf(attr, value)
        const key = attrKey(attr)
        if (value === null) {
          const { [key]: _gone, ...rest } = this.pending
          this.pending = rest
        } else this.pending = { ...this.pending, ...patch }
        if (!this.plot) return
        // A removed attribute falls back to `options` (or the default).
        if (value === null) this.plot.setOptions({ [key]: attr === 'renderer' ? this._options.renderer ?? 'auto' : this.base()[key] })
        else this.plot.setOptions(patch)
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
    toCsv(): string { if (!this.plot) throw new Error('Not mounted.'); return this.plot.toCsv() }
    sonify(options?: SonifyOptions): SonifyController { return this.plot ? this.plot.sonify(options) : idleController() }

    /** `options` without its callbacks, with the properties on top. */
    private base(): Partial<SuperPlotOptions> {
      return { ...withoutEvents(this._options), ...this.props }
    }

    private setProp<K extends 'locale' | 'timeZone' | 'strings'>(k: K, v: SuperPlotOptions[K] | undefined): void {
      const { [k]: _old, ...rest } = this.props
      this.props = v === undefined ? rest : { ...rest, [k]: v }
      // An attribute of the same option still wins.
      if (k in this.pending) return
      this.plot?.setOptions({ [k]: this.base()[k] })
    }

    private emit<K extends EventKey>(key: K, type: string): NonNullable<SuperPlotOptions[K]> {
      return ((detail: unknown) => {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }))
        ;(this._options[key] as ((d: unknown) => void) | undefined)?.(detail)
      }) as NonNullable<SuperPlotOptions[K]>
    }

    private sync(): void {
      if (!this.isConnected || this._spec === undefined) return
      if (this.plot) this.plot.setSpec(this._spec)
      else {
        const attrs: Partial<SuperPlotOptions> = {}
        for (const a of SuperPlotElement.observedAttributes) {
          const v = this.getAttribute(a)
          if (a !== 'spec' && v !== null) Object.assign(attrs, optionOf(a, v))
        }
        this.plot = new SuperPlot(this, this._spec, {
          ...this.base(),
          ...attrs,
          ...this.pending,
          onSelect: this.emit('onSelect', 'plot-select') as (e: SelectEvent) => void,
          onIssues: this.emit('onIssues', 'plot-issues') as (issues: Issue[]) => void,
          onCameraChange: this.emit('onCameraChange', 'plot-camera') as (camera: Camera) => void,
          onHover: this.emit('onHover', 'plot-hover'),
          onRender: this.emit('onRender', 'plot-render'),
          onZoom: this.emit('onZoom', 'plot-zoom'),
          onBrush: this.emit('onBrush', 'plot-brush'),
          onDrill: this.emit('onDrill', 'plot-drill')
        })
      }
    }
  }
  customElements.define(name, SuperPlotElement)
  return SuperPlotElement
}

const RENDERERS = ['auto', 'svg', 'canvas', 'webgl'] as const

const attrKey = (attr: string): keyof SuperPlotOptions => (attr === 'time-zone' ? 'timeZone' : attr) as keyof SuperPlotOptions

/** An attribute's option: `renderer` must be a known one, `toolbar` is a flag or a comma list. */
function optionOf(attr: string, v: string | null): Partial<SuperPlotOptions> {
  if (attr === 'renderer') return RENDERERS.includes(v as (typeof RENDERERS)[number]) ? { renderer: v as (typeof RENDERERS)[number] } : {}
  if (attr === 'toolbar') {
    if (v === null) return {}
    const t = v.trim()
    if (t === '' || t === 'true' || t === 'toolbar') return { toolbar: true }
    if (t === 'false') return { toolbar: false }
    return { toolbar: t.split(',').map(s => s.trim()).filter(Boolean) as ToolbarItem[] }
  }
  if (attr === 'navigator' || attr === 'drill') return v === null ? {} : { [attr]: v.trim() !== 'false' }
  if (attr === 'transition') {
    if (v === null) return {}
    const t = v.trim()
    if (t === 'false') return { transition: false }
    const ms = t === '' ? NaN : Number(t)
    return { transition: Number.isFinite(ms) ? { duration: ms } : true }
  }
  if (attr === 'strings') {
    const o = v === null ? null : safeParse(v)
    return o && typeof o === 'object' && !Array.isArray(o) ? { strings: o as SuperPlotOptions['strings'] } : {}
  }
  return { [attrKey(attr)]: v ?? undefined }
}

function withoutEvents(o: Partial<SuperPlotOptions>): Partial<SuperPlotOptions> {
  const out: Record<string, unknown> = { ...o }
  for (const k of EVENTS) delete out[k]
  return out as Partial<SuperPlotOptions>
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
