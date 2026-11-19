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

## Waterfall, funnel, bullet and bump

Four more chart types, each one spec like the others (`/charts` exports `waterfall`, `funnel`, `bullet`, `bump` for per-chart imports):

```ts
{ type: 'waterfall', x: 'item', y: 'amount', total: ['Gross profit', 'Net income'], labels: true, data }   // or total: 'isTotal' (a yes/no column)
{ type: 'funnel', stage: 'step', value: 'sessions', data }
{ type: 'bullet', x: 'kpi', value: 'actual', target: 'target', ranges: ['poor', 'fair', 'good'], scale: 'each', data }
{ type: 'bump', x: 'year', y: 'share', series: 'language', data }                                          // or rank: 'position'
```

- **Waterfall**: steps in data order; a change floats from the running total, a total row stands on 0 and shows the running total (or its own value, an opening or reported balance: `total_mismatch` warns when that differs from the sum before it). Increase, decrease and total are three legend entries on the `positive`, `negative` and `text-muted` tokens (override with `colors: { increase, decrease, total }`), so colour is never the only carrier; `patterns: true` textures them too. The tooltip and `datum` carry the change and the running total. `orientation: 'horizontal'`, `start`, `connectors: false`.
- **Funnel**: centred bars whose width is the value, labelled with the value and the share of the first stage; the tooltip and `datum` add the share of the stage before. A stage larger than the one before draws but warns (`funnel_increases`). `facet` gives one funnel per segment, each against its own first stage. Not cartesian: `zoom`/`brush` are unknown fields, as on a pie.
- **Bullet**: one row per measure: qualitative ranges as bands of one neutral tone (darkest first), the value as a bar, the target as a tick; hovering anywhere on a row shows every number. `scale: 'each'` gives each measure its own range and ticks (mixed units); `shared` (default) puts all on one axis and supports `orientation: 'vertical'`, annotations, brush and facets.
- **Bump**: the rank of each series per x, rank 1 on top, from a `rank` column or by ranking `y` per x (`rankBy: 'desc' | 'asc'`, ties keep the series order). Lines are labelled at their ends (`labels: false` to rely on the legend); a hidden series does not re-rank the others. At most `LIMITS.maxSeries` (8) lines: the best by average rank, with `too_many_series`.
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
- Calendar days: a date-only string (`"2026-03-14"`) is that day; an instant (a timestamp or an ISO string with a time) lands on its day in the render `timeZone` (UTC by default). Rows on one day are summed. Days without data are outlined empty cells, never the colour of zero. One row of panels per year, at most 5 (the most recent; a `too_many_years` warning says so).
- Sunburst rows that stop early (an empty level) still count toward their parents and leave a gap outside them. More than 30 children under one parent: the smallest merge into "Other". The legend is the first level; hiding one gives its share of the circle back to the others. There is no click-to-zoom in core: drill down by filtering with `transform` (an `onSelect` handler gets the arc's `datum.path`).
- Parallel coordinates draw at most 2,000 lines: past that one row in every k is drawn (a `lines_sampled` warning gives k), while each axis still spans every row. Rows missing a value in any dimension are skipped (`incomplete_rows`).
- `facet` works on violin (as on box). Calendar, sunburst and parallel have no axes to share and refuse `facet` as an unknown field, like heatmap, pie and treemap. `patterns` textures the sunburst by first-level branch; on box, violin, calendar and parallel there is nothing to tell apart by texture, so it is ignored with a `patterns_unsupported` warning.

## Timeline and stream graphs

```ts
{ type: 'timeline', y: 'task', start: 'from', end: 'to', series: 'team', annotations: [{ axis: 'x', value: '2026-04-06', label: 'Today' }], data }
{ type: 'timeline', y: 'machine', start: 'startMin', end: 'endMin', labels: true, format: 'fixed:1', data }   // plain numbers work too
{ type: 'area', x: 'year', y: ['Solar', 'Wind', 'Hydro'], stack: 'center', data }                             // a stream graph
```

- **Timeline** (Gantt, x-range, range bar): one lane per value of `y` in order of first appearance, a bar from `start` to `end` per row. Start and end are read together: both ISO dates or timestamps (a time axis with the usual ticks), or both numbers (`xType` overrides). `series` colours bars and gives the legend; `label` names a bar (tooltip title, and the text on it with `labels: true`; without `label`, `labels` prints the duration). The tooltip, `aria` and `datum` carry start, end and the duration, written as at most two units (`3 d 4 h`, `2 h 15 min`; elapsed time, so a day across a daylight-saving change is 23 or 25 h; numbers use `format`).
  Validation: `range_reversed` (an end before its start is **swapped** and drawn, as `interval_reversed` does for intervals), `missing_range` (rows without both ends are skipped), `no_ranges` and `not_time_or_number` (errors), `overlapping_ranges` (two bars in one lane cover each other), `too_many_lanes` (only the first `LIMITS.maxCategories`, 500, are drawn) and `timeline_cramped` at draw time. Line, band and point annotations work (`{axis: 'x', value: <date>}` is a "today" line). `zoom: 'x'` and `brush: 'x'` use the shared scene axes (`xDomain` cuts bars at the edge); the brushed x range carries no filter column, since a bar spans two columns and "overlaps the range" is not one filter step. `facet` gives one timeline per value.
- **Stream graph** (`stack: 'center'` on area): each x starts at minus half its total, so the stack is centred on a middle line. The vertical position then has no zero, so the value axis shows **no ticks or gridlines** (labels there would read as amounts that do not exist); the tooltip lists every value and the total, and the description says the axis has no zero. Negative values count as 0, as in every stack; hidden series leave the centring. `yDomain` still fixes the range (in units from the middle). The other `stack` values are unchanged.

## Dates, time zones and UI strings

Three render options (not spec fields, like `locale`). The web binding takes them as options (`new SuperPlot(el, spec, { timeZone, strings })`, `setOptions`); React passes them on mount, but does not yet re-render when only `timeZone` or `strings` change (its option effect lists the older options), and `<super-plot>` has no attribute for them yet.

```ts
renderToSvg(spec, { locale: 'de', timeZone: 'Europe/Berlin', strings: { other: 'Andere', total: 'Summe' } })
```

- **`locale`** already names months and weekdays through `Intl.DateTimeFormat` (`Mär`, `janv.`, `1月5日`) in ticks, tooltips, calendars and descriptions; `en` output is unchanged byte for byte.
- **`timeZone`** (IANA name, default `UTC`) moves time-axis ticks to local boundaries (midnights, Mondays, first days of months and years; hour ticks on local hours, both 01:00 ticks of a fall-back night) and shows dates and times in that zone in ticks, tooltips, `aria`, the calendar's day assignment and the scene description (`describePlot(spec, { timeZone })` too). Across a daylight-saving change ticks stay on local boundaries. An unknown name is a `bad_time_zone` warning and UTC is used. Data are **instants**: ISO strings without an offset are read as UTC, as everywhere in Super Plot (and in the ports). So date-only data under another zone are midnights UTC that fall between the local day ticks; a `time_zone_dates` warning says so. Give instants with an offset (`2026-03-01T00:00-05:00`) or as timestamps, or keep UTC for calendar dates. Category axes made by `timeUnit` (UTC buckets) keep their UTC labels. The Go and Python ports describe in English and UTC; `timeZone` changes nothing in validation or conformance.
- **`strings`** overrides the English text core writes into a scene: names it invents ("Other", the waterfall's "Increase", "Decrease", "Total"), tooltip row labels ("Share", "Median", "Running total", "Start", "Duration"), short phrases ("up to {value}", "{value} (missing)"), duration units and the `aria` templates of marks and legend entries ("{label}: toggle series"). `DEFAULT_STRINGS` (exported from core) is the full list of keys with their English text; `{name}` placeholders are filled in. Unknown keys (`unknown_string`, with a "did you mean"), non-strings (`bad_string`) and over-long values (`string_truncated`, 120 characters) warn and keep the English default. Series keys stay stable (the merged slice is still `Other` in `colors`, legend toggles and `datum`); only labels change. Descriptions stay English (the ports reproduce them word for word): set the spec's `description` for another language. Text from the spec (titles, column names, categories) is never translated.

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
