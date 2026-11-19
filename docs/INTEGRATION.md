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

## Synchronised charts

Plots that share a `sync` key form a group on the page (like uPlot's `cursor.sync`, ECharts `connect`, Highcharts synchronized charts):

```ts
new SuperPlot(a, revenueSpec, { sync: 'q3' })                                        // hover and zoom
new SuperPlot(b, usersSpec, { sync: { key: 'q3', brush: true } })                    // also mirror the brush
new SuperPlot(c, costSpec, { sync: { key: 'q3', hover: true, zoom: false } })        // hover only
```

- A string is the key with `hover` and `zoom` on and `brush` off; in the object form `hover` and `zoom` default to true, `brush` to false. A plot takes part in a kind only when both it and the plot the viewer is using have it on.
- **Hover** (pointer or keyboard): the others show their guide and tooltip at the nearest x (a line chart's column, else the nearest data mark). The value travels as data (epoch ms on a time axis, numbers on a linear one, the category on a band axis), so charts of different sizes and ranges line up. A plot whose x axis is of another kind, that does not show the value, is faceted, is a map, or has categories on y (horizontal bars) is skipped quietly. Field names are not compared: putting charts in one group is the declaration that their x axes mean the same thing.
- **Zoom**: zooming or panning x (wheel, pinch, drag, keyboard, double-click or toolbar reset) sets the same x range on the others whose spec has `zoom`; their y zoom stays. **Brush**: the brushed x range (or categories) is drawn on the others whose spec has `brush`.
- Only the plot the viewer used fires `onHover`, `onZoom` and `onBrush`; the others are updated as if by `setZoom` / `setBrush`, which fire nothing, so nothing echoes back. Code-driven `setZoom` / `setBrush` are not shared either.
- The group lives in the module (nothing on `window`); `dispose()` and `setOptions({ sync })` leave it. Linking through `onBrush` filters (above) still works for charts that should *filter* rather than mirror each other.

## Custom tooltips

```ts
new SuperPlot(el, spec, { tooltipFormat: (tip, e) => `${e.series}: ${(e.datum as { value: number }).value} USD` })
```

`tip` is the default content (`{ title, rows: [{ label, value, color }] }`), `e` what `onSelect` would get (`datum`, `series`, `tip`). A string is shown as text (`textContent`, never parsed as HTML, line breaks kept); a `Node` is inserted as is (you built it, so you are responsible for what is in it); `null` or `undefined` keeps the default. It applies to pointer and keyboard tooltips and to synced ones, on SVG and canvas. A function that throws falls back to the default and reports `tooltip_format_error` once. The canvas view's screen-reader announcement keeps the plain default reading.

## Export: CSV and the toolbar

`plotCsv(spec, { maxRows?, separator? })` (core) returns the rows `plotTable` reads (after `transform`, every row by default) as RFC 4180 CSV with a header and CRLF line ends. Text that a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, a tab or a carriage return) gets a leading `'`; number values, negative ones included, are written as numbers. `plot.toCsv()` and `<super-plot>.toCsv()` do the same for what is on screen (appended rows included; hidden series are still in the table, as in `plotTable`).

`toolbar: true` adds a row of real buttons in the chart's top right corner: PNG, SVG, CSV, Table (toggles the visible data table) and, when the spec has `zoom`, Reset. A list chooses and orders them: `toolbar: ['csv', 'sound']`. The buttons have accessible names, work from the keyboard, show a focus ring, follow the theme, appear on hover, keyboard focus and touch screens, and are never printed. Downloads are named after the spec's title (`"Revenue: Q3/Q4"` -> `Revenue-Q3-Q4.csv`). Default `false`: existing charts do not change. A failed export reports `export_failed`.

## Sonification

```ts
const sound = plot.sonify({ duration: 6, volume: 0.3 })   // also the toolbar's 'sound' button
sound.stop(); await sound.done
```

The first visible series is played left to right as short sine notes (Web Audio), higher values higher (220 to 880 Hz by default, `minFrequency` / `maxFrequency`), with start and end announced in a live region. A second call stops the first and starts again; `dispose()` stops it. Without Web Audio it returns a controller that did nothing and reports `sonify_unavailable` through `onIssues`; nothing to play is `sonify_empty`. The mapping is the pure `sonifyNotes(scene, options)` (exported), which returns the notes with their time, length, frequency, value and label, so it can be tested or played by your own synthesiser.

## Server rendering and hydration

```ts
// server
const html = `<div id="chart" style="width:600px">${renderToSvg(spec, { width: 600, hydrate: true })}</div>`
// browser
new SuperPlot(document.getElementById('chart')!, spec)
```

"Hydration" here means exactly this: `renderToSvg(spec, { hydrate: true })` writes the same markup the browser binding would draw (hover hooks, `var(--sp-*)` colours) and stamps it with `data-sp-key`, a hash of that markup, and `data-sp-id`, its id prefix (derived from the content, or `idPrefix`). When a `SuperPlot` is created on a host whose child is such an `<svg>`, its first draw compiles the spec as usual, serialises it with that id prefix and compares hashes. If they are equal, it keeps the server's nodes (no flash, no layout shift, no entrance animation) and attaches hover, tooltips, keyboard, legend toggling, zoom and brush to them. If they differ (another width or height, theme, dark mode under `theme: 'auto'`, locale, hidden series, plugins, or a chart that will be drawn on canvas), it draws as usual and the server markup is removed. Plain `renderToSvg` output (no `hydrate`) is never adopted and is left where it is.

To match, the server must draw at the size the browser will measure: the host's width, and either the host's CSS height or no height on either side (both then use `defaultHeight`). A hydrated plot measures text with the same estimator as the server for its whole life, so later redraws do not move labels; a server that passes its own `measure` will not match and is redrawn. React's `<SuperPlot>` still renders an empty container on the server (hydration is for the web binding and `<super-plot>`).

## High contrast

Under `forced-colors: active` (Windows high contrast) the chart keeps its own colours and background, like an image (`forced-color-adjust: none` on the SVG and canvas), while everything around it uses system colours: focus rings and the brush in `Highlight`, the tooltip in `Canvas` / `CanvasText`, toolbar and map buttons in `ButtonFace` / `ButtonText`. Series identity therefore still comes from the palette, the legend labels and, with `patterns: true`, textures. Under `prefers-contrast: more` focus rings and the brush are thicker and dimmed series fainter.

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

- React: `<SuperPlot spec onSelect onIssues onHiddenChange onHover onRender onZoom onBrush plugins dataTable sync toolbar tooltipFormat />`; the ref is the `SuperPlot` instance (`appendRows`, `setZoom`, `setBrush`, `toPng`, `toCsv`, `sonify`). `sync` and `toolbar` may be inline objects or arrays (compared by value); `tooltipFormat` and the callbacks always call the latest function without a redraw.
- shadcn/ui: `theme="shadcn"` reads the project's `--chart-1..5` and surface tokens; nothing to configure.
- Plain HTML: `<super-plot spec='{"type":"bar",...}' theme="auto" toolbar sync="sales">`. Attributes: `spec` (JSON), `theme`, `locale`, `renderer`, `toolbar` (present for the default buttons, a comma list such as `"png,csv,sound"`, or `"false"`), `sync` (a key). Properties: `spec` and `options` (any `SuperPlotOptions` as an object, callbacks included; an attribute wins over the same key). Methods: `appendRows`, `setZoom`, `getZoom`, `setBrush`, `getBrush`, `toSvg`, `toPng`, `toCsv`, `sonify`, and `instance` for the rest.
- Next.js and SSR: render `renderToSvg` on the server for a static chart, or mount `<SuperPlot>` on the client (the server renders an empty div). For the web binding see "Server rendering and hydration".

### Vue, Svelte and Angular

There are no separate bindings for these (see `OPEN-DECISIONS.md`): they use `<super-plot>`, and all three pass objects to a custom element as properties. Register the element once before the app mounts: `import { defineSuperPlot } from '@supersolutions/super-plot-web/element'; defineSuperPlot()`. Properties set before that are taken over when the element upgrades.

Vue 3 (tell the compiler the tag is a custom element: `app.config.compilerOptions.isCustomElement = tag => tag === 'super-plot'`, or `vue({ template: { compilerOptions: { isCustomElement } } })` in Vite):

```vue
<super-plot :spec.prop="spec" :options.prop="{ toolbar: true, sync: 'sales' }" @plot-select="e => pick(e.detail)" style="height: 320px" />
```

Svelte 5 (an element property exists, so Svelte sets it as one; listen with an attribute or `addEventListener`):

```svelte
<super-plot spec={spec} options={{ toolbar: true, sync: 'sales' }} onplot-select={e => pick(e.detail)} style="height: 320px"></super-plot>
```

Angular (`schemas: [CUSTOM_ELEMENTS_SCHEMA]` on the component or module; `[x]` binds properties):

```html
<super-plot [spec]="spec" [options]="{ toolbar: true, sync: 'sales' }" (plot-select)="pick($event.detail)" style="display:block;height:320px"></super-plot>
```

Events carry their payload in `event.detail`. `tests/web/element.test.ts` checks the element the way these frameworks drive it (properties, before and after definition, and the events).
