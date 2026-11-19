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

## Log scales, intervals, point notes, gaps, trends, lollipops

All of these are spec fields (see [SPEC.md](SPEC.md)); validation explains every refusal with a `code`, a `path` and a `hint`.

```ts
// Log axes: ticks at powers of ten (with 2 and 5 between on short ranges), labels in the value format.
{ type: 'scatter', x: 'rows', y: 'ms', xScale: 'log', yScale: 'log', trend: 'loess', trendBandwidth: 0.3, data }
// A band behind each line (long-form `series` works), dropped to zero where a value is missing.
{ type: 'line', x: 'date', y: 'mean', series: 'region', yLower: 'p5', yUpper: 'p95', gaps: 'zero', data }
// Error bars on a scatter (`xLower`/`xUpper` too), whiskers on grouped bars, lollipops.
{ type: 'bar', x: 'team', y: 'score', yLower: 'lo', yUpper: 'hi', mark: 'lollipop', orientation: 'horizontal', sort: 'desc', data }
// A labelled point next to the existing line and band annotations.
annotations: [{ x: '2026-03-01', y: 120, label: 'Launch' }, { axis: 'y', value: 100, label: 'Target' }]
```

- `yScale: 'log'` works on line and scatter, `xScale: 'log'` on scatter and on a line with a numeric x. Values at or below zero are left out with a `log_nonpositive` warning that gives the count (an error when nothing is left). Bars, areas and histograms refuse `log` (`log_scale_refused`): their marks start at zero, which a log axis cannot show. Zoom, pan and brush work in log space; `scene.axes.x.scale === 'log'` tells a custom renderer or binding to do the same, and the brush's `filters` still report data values.
- `gaps`: `break` (the default, what earlier versions drew), `connect`, `zero` (the tooltip says "missing").
- Intervals are columns, not computed: compute a confidence interval upstream or in your query. The tooltip, the spoken label and `onSelect`'s `datum` carry both ends.
- `trend: 'loess'` is a deterministic local regression (`loess(xs, ys, bandwidth, grid)` is exported from core with the exact algorithm in its doc comment); on log axes the fit is made in log space.
- Point annotations take `x` and `y` in the units of the horizontal and vertical axis (on a horizontal bar chart `x` is the value). They are listed in the description ("Marked: ...").

## Transform steps: bin, window, fold

Next to filter, timeUnit, aggregate, sort and top, `transform` takes three more plain-data steps (no expressions, still at most 10 steps):

```ts
transform: [
  { fold: { fields: ['Q1', 'Q2', 'Q3', 'Q4'], as: ['quarter', 'revenue'] } },                          // wide to long
  { window: { op: 'sum', field: 'revenue', as: 'running', groupBy: ['region'], sortBy: 'quarter' } }, // running total
  { bin: { field: 'price', maxbins: 10, as: ['from', 'to'] } }                                         // histogram-style bins
]
```

Window ops: `sum`, `mean`, `count` (cumulative), `rank` (1, 2, 2, 4), `pctChange`, `lag`, `lead`, `movingMean` (`frame` rows, default 3). The table of steps with their keys is generated in [SPEC.md](SPEC.md#transform-steps); the Go and Python ports will be checked against the new `transformCases` in `conformance/plot.v1.json`.

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
