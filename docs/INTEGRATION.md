# Integration

## Import only what you use

The package roots register every chart, so `import { renderToSvg } from '@supersolutions/super-plot-core'` keeps working. To ship only the charts you draw, import from `/base` and register from `/charts`:

```ts
import { registerChart, validatePlot, renderToSvg } from '@supersolutions/super-plot-core/base'
import { bar, line } from '@supersolutions/super-plot-core/charts'
import { SuperPlot } from '@supersolutions/super-plot-web/base'      // React: '@supersolutions/super-plot-react/base'
registerChart(bar); registerChart(line)
```

Measured with `npm run size` (esbuild, minified + gzip): validating a bar chart 16.1 KB against 52.1 KB for everything; `renderToSvg` with bar 23.1 KB against 58.0 KB; the browser binding with bar and line 45.6 KB against 75.5 KB (WebGL chunk excluded: it loads on first use). Map code (geography import, projections) only comes in with the map charts, and the WebGL layer is a separate chunk loaded on first use.

## Events, zoom, brush and linked charts

```ts
const daily = new SuperPlot(el, { type: 'line', x: 'date', y: 'revenue', data, zoom: 'x', brush: 'x' }, {
  onBrush: sel => totals.setSpec({ ...totalsSpec, transform: [...(sel?.filters ?? []).map(filter => ({ filter })), ...totalsSpec.transform] }),
  onZoom: z => console.log(z?.x?.range),         // ['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'], or null at full range
  onHover: e => console.log(e?.datum),           // the mark under the pointer or the keyboard, null when off it
  onRender: e => console.log(e.renderer, e.ms)    // after every draw
})
daily.setZoom({ x: ['2026-02-01', '2026-03-01'] }); daily.getBrush(); daily.setBrush(null)
```

A selection is `{ x?: { field, range } | { field, oneOf }, y?: ..., filters }`: plain JSON an agent can read, store or send back as a transform. Viewers drag to brush (Shift-drag pans when zoom is on too), Ctrl/⌘-scroll or pinch to zoom, double-click to reset; from the keyboard + / - / 0, Shift+arrows, and `[` / `]` on a focused mark. `<super-plot>` dispatches the same as `plot-zoom`, `plot-brush`, `plot-hover`, `plot-render`.

## Live data

`plot.appendRows(rows, { max: 500 })` adds rows to the end, drops the oldest past `max`, and draws once per frame however often it is called. Zoom, brush and hidden series stay; the spec object you passed is not changed.

## Plugins

```ts
new SuperPlot(el, spec, { plugins: [{
  name: 'watermark',
  afterCompile: scene => ({ ...scene, marks: [...scene.marks, { type: 'text', role: 'annotation', x: 12, y: 12, text: 'Draft', size: 11, fill: 'var(--sp-text-muted)' }] }),
  afterDraw: ({ svg, ctx, scene, renderer }) => { /* draw on the SVG element or the 2D context */ }
}] })
```

`afterCompile` also runs in `compilePlot` / `renderToSvg` on a server. A plugin that throws becomes a `plugin_error` warning and the chart still draws.

## Accessibility options

`patterns: true` in the spec adds a texture per series (bars, areas, slices, cells, legend swatches). `dataTable: true` puts a table of the data the chart shows (after `transform`) next to it for screen readers; `'visible'` shows it to everyone. `plotTable(spec)` in core returns the same table as data. On canvas the chart is one focusable element: the arrow keys step through marks, Home and End jump, Enter selects, and each step is announced.

## Violin, calendar, sunburst and parallel coordinates

```ts
{ type: 'box', x: 'carrier', y: 'days', points: 'all' }                  // every value as a dot; 'outliers' (default) or 'none'
{ type: 'violin', x: 'plan', y: 'minutes', inner: 'quartiles', points: 'all', bandwidth: 2 }
{ type: 'calendar', x: 'date', value: 'commits', weekStart: 'sunday', domain: [0, 20] }
{ type: 'sunburst', path: ['region', 'country', 'city'], value: 'sales' }
{ type: 'parallel', dimensions: ['price', 'power', 'weight', 'range'], series: 'drive' }
```

- `points` on box and violin draws observations as dots. The jitter is fixed (the golden-ratio sequence by row order within a group), so the same spec always gives the same picture. On box, `points` replaces the older `outliers` boolean, which still works; when both are set `points` wins and a `outliers_ignored` warning says so.
- The violin's density is a Gaussian kernel estimate over the observed range (it never draws past the smallest or largest value), bandwidth by Silverman's rule unless `bandwidth` is given. Each violin is as wide as the others at its densest point. The maths is exported for other code (`kde`, `silverman`, `densityPeaks` from core) and pinned in the conformance data (`density`).
- Calendar days are UTC: an ISO date or a timestamp both land on their UTC day, and rows on one day are summed. Days without data are outlined empty cells, never the colour of zero. One row of panels per year, at most 5 (the most recent; a `too_many_years` warning says so).
- Sunburst rows that stop early (an empty level) still count toward their parents and leave a gap outside them. More than 30 children under one parent: the smallest merge into "Other". The legend is the first level; hiding one gives its share of the circle back to the others. There is no click-to-zoom in core: drill down by filtering with `transform` (an `onSelect` handler gets the arc's `datum.path`).
- Parallel coordinates draw at most 2,000 lines: past that one row in every k is drawn (a `lines_sampled` warning gives k), while each axis still spans every row. Rows missing a value in any dimension are skipped (`incomplete_rows`).
- `facet` works on violin (as on box). Calendar, sunburst and parallel have no axes to share and refuse `facet` as an unknown field, like heatmap, pie and treemap. `patterns` textures the sunburst by first-level branch; on box, violin, calendar and parallel there is nothing to tell apart by texture, so it is ignored with a `patterns_unsupported` warning.

## Agents and MCP

```ts
import { plotTools, getPlotTool } from '@supersolutions/super-plot-core/tools'
const tool = getPlotTool('plot_validate')!
tool.run({ spec })        // { ok, issues: [{ code, path, message, hint, severity }] }
```

Tools: `plot_catalog` (which chart, which fields, an example), `plot_schema`, `plot_validate`, `plot_describe`, `plot_geographies` (the map boundaries the host registered; none ship), `plot_render_svg`.
All have `authority: 'read'`, `inputSchema` (JSON Schema) and `run(args)`, so they can be wrapped by any MCP server or
tool registry in a few lines. Suggested agent loop: `plot_catalog` -> write spec -> `plot_validate` -> fix by `code` and `hint` -> `plot_render_svg`.

## Super Chat

Today Super Chat has a built-in `chart` card. `fromChatChartCard(card)` converts it to a spec so the same data can be drawn by Super Plot:

```ts
import { fromChatChartCard } from '@supersolutions/super-plot-core/adapters'
const { ok, spec, notes } = fromChatChartCard(card)   // notes say what could not be carried over
```

Not carried over, and reported in `notes`: series on the right axis, mixed series types beyond the first, candlesticks (use Super Chart).

Proposal, not done: a `super-plot.chart` card kind in the Apache `super-protocol` (a card is `{ kind, spec }`), and a small chat-plugin
package, mirroring Super Chart's chat plugin. This needs the owner's go because it changes a shared contract.

## Super Chart

- Same palette, same neutrals, same token style (`--sp-*` next to `--sc-*`); see THEMING for `alias`.
- Split of work: price and indicator charts go to Super Chart; distributions, shares, comparisons and correlations go to Super Plot.
- A shared theme package would let both read one source of tokens.

## Other languages

Core is TypeScript. **Go and Python ports exist** in [`ports/`](../ports/README.md): `ValidatePlot` / `validate_plot`, `DescribePlot` / `describe_plot`, and the shared numbers and formats. They run `transform` too (`apply_transform` / `ApplyTransform`), so the normalised spec carries the same transformed rows as TypeScript. A backend in either language can take a spec from an agent, return every problem with its `code`, `path` and `hint`, repair-loop it, and write the alt text; the browser or Node draws it.

```go
v := superplot.ValidatePlot(specJSON)   // v.OK, v.Issues, v.Spec (normalised)
alt, err := superplot.DescribePlot(specJSON)
```
```python
v = validate_plot(spec_json)            # v.ok, v.issues, v.spec
alt = describe_plot(spec_json)
```

They do not draw. To add another language (Rust, Java, ...):

1. Accept the same JSON spec; read the fields from `conformance/fields.v1.json` (generated; it is the one source of every chart's fields, ranges, enums and defaults, plus the English currency table), so validation needs no per-chart code.
2. Reproduce `conformance/plot.v1.json`: ticks, nice domains, quantiles, box statistics, histogram bins, number formats, validation codes and paths, normalised specs and descriptions. The contract for an issue is `(severity, code, path)`.
3. Port the few cross-field checks and the per-chart descriptions (each function in the Go and Python ports names the TypeScript one it mirrors), then add the language to `scripts/ports.mjs` and `ports/fuzz`.

Regenerate the data with `npm run conformance`; `npm run test:ports` and `npm run fuzz:ports` check the ports.

## Framework notes

- React: `<SuperPlot spec onSelect onIssues onHiddenChange onHover onRender onZoom onBrush plugins dataTable />`; the ref is the `SuperPlot` instance (`appendRows`, `setZoom`, `setBrush`, `toPng`).
- shadcn/ui: `theme="shadcn"` reads the project's `--chart-1..5` and surface tokens; nothing to configure.
- Vue, Svelte, Angular, plain HTML: `<super-plot>`; set `spec` as a property (object) or attribute (JSON string).
- Next.js and SSR: render `renderToSvg` on the server for a static chart, or mount `<SuperPlot>` on the client (the server renders an empty div).
