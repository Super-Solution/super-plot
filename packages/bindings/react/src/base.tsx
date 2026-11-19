import { forwardRef, useEffect, useRef, type CSSProperties, type ForwardedRef } from 'react'
import { SuperPlot as Plot, type SuperPlotOptions } from '@supersolutions/super-plot-web/base'

export type { BrushSelection, DrawTarget, RenderEvent, SelectEvent, SuperPlotOptions, ZoomRange } from '@supersolutions/super-plot-web/base'

export interface SuperPlotProps extends SuperPlotOptions {
  /** The plot spec. Create it once or memoize it: a new object re-renders the chart. */
  spec: unknown
  className?: string
  style?: CSSProperties
}

/**
 * `<SuperPlot spec={...} />`. A thin binding over the web mount: one effect creates it, props
 * update it, unmount disposes it. Safe under Strict Mode and server rendering (the DOM work
 * happens in an effect; on the server use `renderToSvg` from core for a static chart).
 * The ref is the underlying `SuperPlot` instance (`toSvg()`, `toPng()`, `getScene()`).
 */
export const SuperPlot = forwardRef<Plot | null, SuperPlotProps>(function SuperPlot({ spec, className, style, ...options }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<Plot | null>(null)
  const latest = useRef(options)
  latest.current = options
  const outer = useRef<ForwardedRef<Plot | null>>(ref)
  outer.current = ref
  const expose = (v: Plot | null): void => {
    const r = outer.current
    if (typeof r === 'function') r(v)
    else if (r) r.current = v
  }

  useEffect(() => {
    const p = new Plot(host.current!, spec, {
      ...latest.current,
      // Callbacks read the latest props, so inline handlers never force a re-mount.
      onSelect: e => latest.current.onSelect?.(e),
      onIssues: i => latest.current.onIssues?.(i),
      onHiddenChange: h => latest.current.onHiddenChange?.(h),
      onCameraChange: c => latest.current.onCameraChange?.(c),
      onHover: e => latest.current.onHover?.(e),
      onRender: e => latest.current.onRender?.(e),
      onZoom: z => latest.current.onZoom?.(z),
      onBrush: b => latest.current.onBrush?.(b)
    })
    plot.current = p
    expose(p)
    return () => {
      p.dispose()
      plot.current = null
      expose(null)
    }
    // Mounted once; spec and options are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const first = useRef(true)
  useEffect(() => {
    if (first.current) return
    plot.current?.setSpec(spec)
  }, [spec])

  const { theme, locale, width, height, animate, tooltip, hidden, renderer, canvasAbove, webglAbove, interactive, camera, plugins, dataTable } = options
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    plot.current?.setOptions({ theme, locale, width, height, animate, tooltip, renderer, canvasAbove, webglAbove, interactive, dataTable, ...(plugins ? { plugins } : {}), ...(hidden ? { hidden } : {}), ...(camera ? { camera } : {}) })
  }, [theme, locale, width, height, animate, tooltip, hidden, renderer, canvasAbove, webglAbove, interactive, camera, plugins, dataTable])

  return <div ref={host} className={className} style={style} />
})
