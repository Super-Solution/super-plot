# @supersolutions/super-plot-core

Renderer-free statistical charts. A plot is one JSON spec; core validates it, lays it out into a flat,
serializable scene and writes SVG. No DOM, runs in Node, workers and edge runtimes.

```ts
import { renderToSvg, validatePlot, describePlot } from '@supersolutions/super-plot-core'

const check = validatePlot(spec)           // { ok, issues: [{ code, path, message, hint, severity }] }
const alt   = describePlot(spec)           // { ok, text } plain-language summary, also the SVG <desc>
const svg   = renderToSvg(spec, { width: 640, height: 360, theme: 'dark' })
```

- `compilePlot(spec, opts)` returns `{ ok, scene, issues }` for a custom renderer. `drawScene(ctx, scene, opts)` draws a scene on any object shaped like a 2D canvas context (no DOM), and `buildHitIndex(scene)` gives fast hover lookup.
- `valueFormatter(format, locale)` and `formatPercent` format numbers the way the charts do.
- `chartCatalog()` and `plotJsonSchema()` describe every chart for agents; `registerChart(def)` adds one.
- `createTheme`, `registerTheme`, `resolveVars` for themes; see `docs/THEMING.md`.
- `@supersolutions/super-plot-core/tools`: agent tools (`plot_catalog`, `plot_schema`, `plot_validate`, `plot_describe`, `plot_render_svg`), all read-only.
- `@supersolutions/super-plot-core/adapters`: `fromChatChartCard` turns a Super Chat `chart` card into a spec.

Text width in core is estimated (no DOM); the web binding measures with canvas for exact layout.
