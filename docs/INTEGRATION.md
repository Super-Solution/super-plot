# Integration

## Import only what you use

Start from `/base` and register what the page draws. The everyday charts are one group:

```ts
import { registerCharts, validatePlot, renderToSvg } from '@supersolutions/super-plot-core/base'
import { basicCharts } from '@supersolutions/super-plot-core/charts/basic'   // bar, line, area, scatter, pie, donut, histogram, box, heatmap
import { SuperPlot } from '@supersolutions/super-plot-web/base'              // React: '@supersolutions/super-plot-react/base'
registerCharts(basicCharts)
```

Add more the same way, a group or single charts: `/charts/business` (waterfall, bullet, funnel, waffle, timeline,
gauge), `/charts/stats` (violin, beeswarm, parallel, radar, bump, calendar), `/charts/maps` (choropleth, bubble map,
column map, flow map: they bring the projection maths), `/charts/hierarchy` (treemap, sunburst, sankey), `/charts/3d`
(scatter3d, surface) and `/charts/text` (wordcloud). Each group exports its charts one by one too
(`import { waterfall } from '@supersolutions/super-plot-core/charts/business'; registerChart(waterfall)`), and
`/charts` still exports every chart, `allCharts` and `chartGroups`. Every chart is in exactly one group.

**Transform steps are registered the same way.** `/base` checks the shape of a `transform` (every step is still in
the JSON Schema and SPEC.md) but carries no step code. Register the steps the specs use:

```ts
import { registerTransforms } from '@supersolutions/super-plot-core/base'
import { filterStep, aggregateStep } from '@supersolutions/super-plot-core/transforms'   // or allTransforms
registerTransforms([filterStep, aggregateStep])
```

A spec that uses a step this bundle did not register is refused, never run without it: the error
`transform_not_registered` at `transform[i].<step>`, with a hint that names the import. Specs without `transform`
need nothing.

**Quick start, agents, servers: the package root.** `@supersolutions/super-plot-core`, `@supersolutions/super-plot-web`
and `@supersolutions/super-plot-react` register every chart type and transform step and re-export every entry point,
so `import { renderToSvg } from '@supersolutions/super-plot-core'` draws any spec an agent sends. Use it where bundle
size does not matter (Node, a server, a prototype, an agent tool that must accept every chart); the MCP tools in
`/tools` use it.

### Entry points and what they cost

`npm run size` (esbuild, minified + gzip, the entry and what it imports statically; code loaded on demand apart;
measured on the built packages, as an app imports them). `npm run gate` fails when a case grows past its budget
(`scripts/size.mjs`).

| Import | What is in it | KB gzip |
|---|---|---|
| core `/base`, `renderToSvg`, no chart | validation, layout, SVG, themes, the transform loop; no chart, no step | 21.4 |
| core `/base` + `bar`, `validatePlot` | | 25.2 |
| core `/base` + `bar`, `renderToSvg` | | 36.2 |
| core `/base` + `bar`, `resolveRef` | validation and the reference resolver, no drawing | 28.5 |
| core `/base` + `/charts/basic` | the nine everyday charts | 56.6 |
| core `/base` + `/charts/basic` + `/transforms` | every transform step (5.3 KB more) | 61.9 |
| core `.` (everything) | every chart and step, `/canvas`, `/view` | 127.8 |
| web `/base`, no chart | `SuperPlot` (SVG path, hover, keyboard, zoom, brush, sync, sound, references, styles) | 48.1 |
| web `/base` + bar + line | | 71.5 |
| web `/base` + `/charts/basic` | | 84.4 |
| web `.` (everything) | | 157.0 |
| chat plugin `.` | web `.`, the `super.plot` card and the agent tools | 162.3 |

Core entry points that are not chart groups: `/charts` (every chart), `/transforms` (the steps, `TRANSFORM_DOCS`,
`filterRow`, `bucket`), `/canvas` (`drawScene`, `drawHover`, `buildHitIndex`, `resolveColor`, `drawPatternTile`: draw
a scene on any 2D context), `/view` (map projections and the 3D view: `makeView`, `project`, `makeView3d`,
`project3d`, `arcPoints`, ...; `/base` keeps the cameras and their limits, `clampCamera`, `clampCamera3d`), `/tools`
(agent tools) and `/adapters`. The package root re-exports all of them.

**Loaded on demand.** Parts of the browser binding that only some pages use are separate chunks, fetched the first time a plot needs them (your bundler emits them next to the main file; serve them from the same place): the canvas renderer (6.6 KB gzip with core's `/canvas`), the WebGL layer (9.4 KB), the transitions (3.9 KB), the `navigator` strip (3.4 KB), the map and 3D camera controls (drag, pinch, keys and zoom buttons, 2.3 KB, plus 1.8 KB of projection maths shared with the WebGL layer) and the `toolbar` (0.7 KB); sizes as `npm run size` lists them for a web `/base` page. An SVG chart is always drawn before the constructor, `setSpec` or `setOptions` returns; a chunk only adds its part a moment later, without moving anything: the navigator's 44 px are kept at once (an empty strip until it is drawn), the toolbar and the map buttons float over the chart. A chart that needs the canvas renderer (`renderer: 'canvas'` or `'webgl'`, or `auto` above `canvasAbove` marks) waits for it the first time on a page: the plot keeps its room and what it showed (the previous drawing, or the server's markup), and `getScene()`, `onRender` and the canvas come with the first canvas frame. Later plots on the page draw at once. The `<script>` bundle (`super-plot.global.js`) has everything inlined.

```ts
const plot = new SuperPlot(el, spec, { navigator: true, toolbar: true })
await plot.ready()   // the strip and the buttons are drawn: take the screenshot, run the test
```

`plot.ready()` settles once every chunk this plot needs for what it shows now is loaded and drawn (canvas renderer, navigator, toolbar, map controls, WebGL layer, transitions); with nothing pending it settles at once. `toPng()` waits for it. It never rejects: a chunk that fails to load (a 404, the network) is reported once through `onIssues` as the warning `load_failed` (the chart stays, without that part; a canvas chart is drawn on SVG instead; the next draw tries again), and WebGL falls back to canvas as before. `sonify()` is not split: it returns its notes at once (the controller's `notes`), which needs the note plan in the bundle, so `sonifyNotes` stays in web `/base` (about 1.6 KB gzip).

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
// A connected scatter: the points of each series joined in the order of a column, with the quadrants shaded.
{ type: 'scatter', x: 'growth', y: 'inflation', order: 'year', xDomain: [-2, 6], yDomain: [0, 6], annotations: [{ xFrom: 2, yFrom: 3, label: 'Overheating' }, { xTo: 2, yTo: 3, label: 'Slowdown' }], data }
// A prefix before every figure and a unit after it.
{ type: 'bar', x: 'quarter', y: 'revenue', format: 'NT$^compact~ B', data }
```

- `yScale: 'log'` works on line and scatter, `xScale: 'log'` on scatter and on a line with a numeric x. Values at or below zero are left out with a `log_nonpositive` warning that gives the count (an error when nothing is left). Bars, areas and histograms refuse `log` (`log_scale_refused`): their marks start at zero, which a log axis cannot show. Zoom, pan and brush work in log space; `scene.axes.x.scale === 'log'` tells a custom renderer or binding to do the same, and the brush's `filters` still report data values.
- `gaps`: `break` (the default, what earlier versions drew), `connect`, `zero` (the tooltip says "missing").
- Intervals are columns, not computed: compute a confidence interval upstream or in your query. The tooltip, the spoken label and `onSelect`'s `datum` carry both ends.
- `trend: 'loess'` is a deterministic local regression (`loess(xs, ys, bandwidth, grid)` is exported from core with the exact algorithm in its doc comment); on log axes the fit is made in log space.
- Point annotations take `x` and `y` in the units of the horizontal and vertical axis (on a horizontal bar chart `x` is the value). They are listed in the description ("Marked: ...").
- Region annotations take `xFrom`, `xTo`, `yFrom`, `yTo` (numbers or dates) and shade the rectangle between them; a side left out runs to the edge of the plot, so `{ xFrom: 2, yFrom: 3 }` is the top-right quadrant. Numeric and time axes only (a category axis skips the region with `annotation_out_of_range`). They are listed in the description ("Shaded: ...").
- **Missing, zero and negative values are said, not drawn as 0.** A pie or donut whose rows add up to nothing positive warns `pie_no_positive` and draws "No positive values to show" where the circle would be (`strings.noPositive`); rows below 0 are dropped with `negative_slices`, and a label that adds up to exactly 0 gets no angle but stays in the legend (`zero_slices`). All three are warnings from `validatePlot`, so `plot_validate` shows them before anything is drawn. A bar category with no number at all (null, `NaN`, text) is called "Missing: b" in the description and left out of its highest, lowest and total, instead of being read as 0; the chart already drew an empty bar for it.
- `order` (scatter) joins each series by a line in the order of a column; `format: 'prefix^…'` prints text before the figure, after a minus sign.

## Transform steps: bin, window, fold

Next to filter, timeUnit, aggregate, sort and top, `transform` takes three more plain-data steps (no expressions, still at most 10 steps):

```ts
transform: [
  { fold: { fields: ['Q1', 'Q2', 'Q3', 'Q4'], as: ['quarter', 'revenue'] } },                          // wide to long
  { window: { op: 'sum', field: 'revenue', as: 'running', groupBy: ['region'], sortBy: 'quarter' } }, // running total
  { bin: { field: 'price', maxbins: 10, as: ['from', 'to'] } }                                         // histogram-style bins
]
```

Window ops: `sum`, `mean`, `count` (cumulative), `rank` (1, 2, 2, 4), `pctChange`, `lag`, `lead`, `movingMean` (`frame` rows, default 3) and `ema`, the exponential moving average. `ema` is `alpha * x + (1 - alpha) * average` with `alpha = 2 / (frame + 1)`, so `frame` is its *span* (default 3, alpha 0.5; 1 returns the series itself, 9 gives alpha 0.2): the first number seen is the starting average, a row whose cell is not a number gets `null` and the average carries on unchanged (a gap is neither a reset nor a 0), and rows before the first number are `null`. Sort first (`sortBy`), as an average of unordered rows means nothing; there is no look-back warm-up, so the first few values lean on the starting number. The three languages compute it in the same order of operations and agree to the last digit (conformance cases). A ninth step, `index`, rescales each group to a common base (see [below](#index-rescale-each-group-to-a-common-base)). The table of steps with their keys is generated in [SPEC.md](SPEC.md#transform-steps); the Go and Python ports will be checked against the new `transformCases` in `conformance/plot.v1.json`.
## Two value axes, broken axes and indexed series (read the risks first)

These three were refused in round 5 and are built in round 6 because people ask for them. Each one can mislead; each is off unless the spec asks for it, says its risk as an issue the agent sees, and has a safer alternative named in that issue's `hint`.

```ts
// Safer first: index every series to 100 at its first month, then compare growth on one axis.
{ type: 'line', x: 'month', y: 'revenue', series: 'region', yLabel: 'Index (Jan = 100)', data,
  transform: [{ index: { field: 'revenue', groupBy: ['region'], sortBy: 'month' } }] }
// A second value axis on the right (line, unstacked area, and lines over vertical bars).
{ type: 'line', x: 'week', y: 'orders', yRight: 'conversion', formatRight: 'percent', yLabel: 'Orders', yRightLabel: 'Conversion rate', rightDomain: [0, 0.05], data }
{ type: 'bar', x: 'month', y: 'revenue', yRight: 'margin', formatRight: 'percent', data }
// A broken value axis: one outlier no longer flattens the rest.
{ type: 'bar', x: 'service', y: 'requests', yBreak: [40, 900], labels: true, data }
```

### `yRight`: a second value axis

**The risk, plainly:** two scales on one plot can be set so that any two series seem to cross, move together or diverge. Where the lines meet, how far apart they are and how steep each looks are choices of the two ranges, not facts in the data. Readers take a crossing as meaningful.

- What protects the reader: validation always adds an `info` issue `dual_axis` (path `yRight`) that says this and suggests the alternatives. Each axis's title, tick labels and axis line take the colour of its series when it has exactly one (mixed towards the text colour until it reads at 4.5:1; neutral when an axis carries several series). The legend and the tooltip label say "Revenue (right axis)" (`strings.rightAxis`), so identity is never colour alone. Tooltips show each value in its own axis's format (`formatRight`, default `format`). The description names the series on each axis and their ranges in their units, and repeats the risk.
- Ranges: the right axis is fitted to its series like the left (`rightDomain` fixes it). On bars both axes include zero by default, and whenever both do, the two zeros are lined up (the axis whose zero sits lower is extended downwards, never cut), so a value of zero means zero on both sides. Lines get no zero alignment; fix both ranges if they should match.
- Where it works: `line`, `area` with `stack: "none"` (a stacked area refuses it: `dual_axis_refused`), and vertical `bar` (drawn as lines with points, like `line`; ignored with a `dual_axis_ignored` warning on horizontal and 100% stacked bars). Refused with a log `yScale` and together with `yBreak`. A column on both axes is `dual_axis_overlap`; `yRightLabel`, `rightDomain` or `formatRight` without `yRight` is a `right_axis_unused` warning. Reference lines and point annotations use the left axis.
- Interaction: zoom and brush keep working along x. A `zoom: "xy"` or `brush: "xy"` is reduced to x with a `zoom_refused` / `brush_refused` warning, because a vertical range would mean different values on each side. `scene.axes.y2` carries the right axis (domain, pixel range, `field` when it is one column, `ink`) for custom renderers.
- `facet`: every panel gets both axes; the right range is shared across panels like the left one, and the right title is drawn once at the right edge.
- Safer alternatives: the `index` step below (growth on one axis), two charts with `sync` (levels, each with its own honest axis), or `line` over bars when both measures share a unit.

### `yBreak`: a broken value axis

**The risk, plainly:** a cut makes a large value look much closer to the small ones than it is: the bar that crosses the cut is drawn shorter than its value. A reader who misses the cut compares lengths that are no longer proportional.

- What protects the reader: the cut is drawn as a gap in the background colour across the whole plot with a zigzag on each edge, crossing the axis and every bar or line that passes through it. Both sides keep the same pixels per unit; tick labels appear on both sides of the gap (labels too close to it are thinned). Tooltips, value labels, `aria` and the description give the real values. Validation always adds an `info` issue `axis_break` that states the hidden span.
- Where it works: `bar` (grouped, vertical or horizontal, bars or lollipops) and `line`. Refused (`break_refused`, error) on stacked and 100% stacked bars (the cut would fall inside segments), with a log scale, and with `yRight`.
- Refused as misleading (`break_misleading`, error): a break that contains zero on a bar chart, because bars start at zero and those that do not cross the break would lose their baseline. A break is meant to remove a span that is empty or that every bar crossing it crosses whole: keep it above every short bar (or below every negative one).
- A value inside the cut is a `break_hides_values` warning with the count and the values; it is drawn at the edge of the cut with a dashed outline (bars) or a ring (points) over the gap, and its tooltip says "(inside the axis break, drawn at its edge)" (`strings.inBreak`). A break with no value beyond it is a `break_outside` warning and is removed from the normalised spec (nothing drawn).
- Interaction: zoom and brush on the broken axis are refused (`zoom_refused`, `brush_refused`): a pixel in the gap has no single value. On a line chart, zoom and brush along x still work (the break stays where it is; it is not drawn when the zoomed range no longer reaches it). On horizontal bars the value axis is x, so a brush there is refused. `scene.axes.y.breaks` (or `x.breaks`) carries `[from, to]`.
- Safer alternatives: `facet` by size class, a log `yScale` on a line or scatter, or sorted bars with `labels: true`.

### `index`: rescale each group to a common base

`{ index: { field, as?, groupBy?, sortBy?, base?: 100, at?: 'first' | <a sortBy value> } }` is a transform step (plain data, like the others). Each `groupBy` group is rescaled so its value at the base row equals `base`: v x base / baseValue. The base row is the first in `sortBy` order (`at: "first"`, the default; without `sortBy`, the data order) or the first row whose `sortBy` value equals `at` (numbers and dates compare by value, so `"2026-01-01"` matches `1767225600000`). The result goes to `as` (default: in place, so set `yLabel` to say it is an index).

A group whose base value is 0, negative, missing or not a number, or that has no row at `at`, cannot be divided by: the whole group is dropped and one `index_group_dropped` warning lists each group and why. Other non-numbers in a kept group become null. Validation: `missing_required` (no `field`; `at` without `sortBy`), `no_such_column`, `not_numeric`, `bad_value` (`base` not a positive number), `bad_type` (`at`, `as`, `groupBy`), `unknown_field` with "did you mean". The Go and Python ports will be checked against the `index` cases in `conformance/plot.v1.json` (`transformCases`).

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

`toolbar: true` adds a row of real buttons in the chart's top right corner: PNG, SVG, CSV, Table (toggles the visible data table) and, when the spec has `zoom`, Reset. A list chooses and orders them: `toolbar: ['csv', 'sound']`. The buttons have accessible names, work from the keyboard, show a focus ring, follow the theme, appear on hover, keyboard focus and touch screens, and are never printed. Downloads are named after the spec's title (`"Revenue: Q3/Q4"` -> `Revenue-Q3-Q4.csv`). Default `false`: existing charts do not change. A failed export reports `export_failed`. The buttons are a chunk loaded on first use (`await plot.ready()` to wait for them).

## Sonification

```ts
const sound = plot.sonify({ duration: 6, volume: 0.3 })   // also the toolbar's 'sound' button
sound.stop(); await sound.done
```

The first visible series is played left to right as short sine notes (Web Audio), higher values higher (220 to 880 Hz by default, `minFrequency` / `maxFrequency`), with start and end announced in a live region. A second call stops the first and starts again; `dispose()` stops it. Without Web Audio it returns a controller that did nothing and reports `sonify_unavailable` through `onIssues`; nothing to play is `sonify_empty`. The mapping is the pure `sonifyNotes(scene, options)` (exported), which returns the notes with their time, length, frequency, value and label, so it can be tested or played by your own synthesiser.

## Narrow charts

Rules that follow the chart's width, not an option: nothing to switch on, no spec field. Each keeps what a wide chart draws and only changes what would otherwise be cut off. Under **420 px** a chart is `compact` (smaller type, 12 px padding); the rules below that name another size say so.

- **Titles take two lines.** A title that does not fit on one line breaks at spaces (between any two characters of Chinese, Japanese and Korean) and is shortened with an ellipsis only on the second line. The plot starts lower by the line it needed. `scene.title`, `<title>` and the accessible name always carry the whole title.
- **Category labels wrap.** A label on the x axis that is wider than its slot (and the slots are at least 48 px) breaks over two lines before it is shortened; below 48 px the labels still turn 45 degrees as before. Labels of a horizontal bar chart wrap too, when a row is at least 2.4 text heights tall (otherwise two lines would touch the next row). A word longer than the room is still shortened, so the ellipsis is the last resort, not the first.
- **Annotations become a numbered key.** Under 420 px, a chart with one to four labelled annotations draws "1", "2" beside the line, band, region or point and lists "1  Target" under the plot, in the same order. The room for the key comes off the plot, and only when a plot of at least 140 px is left: a short chart, a wider one or one with more than four labels keeps the labels beside the marks. The annotation's note and tooltip stay on the number; the key is plain text.
- **A calendar is cut into rows.** Each day keeps at least 8 px: a year that would get less is split into the fewest equal rows of weeks (two rows of about 27 weeks on a phone), the year's name once above the first. The colour scale goes in a row under the weeks (lowest value, five steps, highest, "No data") where there is no room beside them. A few months that fit stay in one row. `defaultHeight(type, width, spec)` gives such a calendar the taller box it needs; the browser binding uses it when the host sets no height, so does `renderToSvg` without `height`. A chart you size yourself keeps your size, and cells get smaller (with the `calendar_cramped` warning under 6 px).

Not done: the legend below the chart on a phone still wraps by rows without a limit, titles keep two lines at most, and a vertical category axis with long labels and short rows still shortens them. A narrow chart does not hide the data table or the tooltip: they work as on a wide one.

## Server rendering and hydration

```ts
// server
const html = `<div id="chart" style="width:600px">${renderToSvg(spec, { width: 600, hydrate: true })}</div>`
// browser
new SuperPlot(document.getElementById('chart')!, spec)
```

"Hydration" here means exactly this: `renderToSvg(spec, { hydrate: true })` writes the same markup the browser binding would draw (hover hooks, `var(--sp-*)` colours) and stamps it with `data-sp-key`, a hash of that markup, and `data-sp-id`, its id prefix (derived from the content, or `idPrefix`). When a `SuperPlot` is created on a host whose child is such an `<svg>`, its first draw compiles the spec as usual, serialises it with that id prefix and compares hashes. If they are equal, it keeps the server's nodes (no flash, no layout shift, no entrance animation) and attaches hover, tooltips, keyboard, legend toggling, zoom and brush to them. If they differ (another width or height, theme, dark mode under `theme: 'auto'`, locale, hidden series, plugins, or a chart that will be drawn on canvas), it draws as usual and the server markup is removed. Plain `renderToSvg` output (no `hydrate`) is never adopted and is left where it is.

**Element ids.** Every SVG names its title and description (`aria-labelledby`), textures and clips with ids. Unless you pass `idPrefix`, the prefix is `sp` plus a hash of the drawing (`sp1k2x9f-t`, `-d`, `-p0`, `-c…`), so several charts in one HTML page, a report or an agent's reply never read each other's title and description. It is derived, not random: the same spec, size, theme and locale write the same bytes (cache-friendly, easy to diff), and a different drawing gets a different prefix. Two identical charts on one page share ids, which is harmless because their titles and descriptions are identical too; give one an `idPrefix` if you also address the ids from CSS or script. `hydrate: true` keeps its own prefix (`data-sp-id`), which the browser binding re-uses.

**A spec that cannot be drawn.** `renderToSvg` throws a `PlotSpecError` (its `issues` say how to fix each problem). Pass `onInvalid: 'placeholder'` where a report or a reply should show *why* instead of failing: it returns an SVG of the asked size that says "This chart cannot be drawn" (`strings.chartUnavailable`), the first error with its path and code, and how many more there are, and lists every error in `<desc>` for a screen reader. It never throws for an invalid spec, and a spec that draws is drawn exactly as without the option. The placeholder is never stamped for hydration. Nothing is hidden: a spec with only warnings is still a chart.

To match, the server must draw at the size the browser will measure: the host's width, and either the host's CSS height or no height on either side (both then use `defaultHeight`). A hydrated plot measures text with the same estimator as the server for its whole life, so later redraws do not move labels; a server that passes its own `measure` will not match and is redrawn. React's `<SuperPlot>` still renders an empty container on the server (hydration is for the web binding and `<super-plot>`).

## High contrast

Under `forced-colors: active` (Windows high contrast) the chart keeps its own colours and background, like an image (`forced-color-adjust: none` on the SVG and canvas), while everything around it uses system colours: focus rings and the brush in `Highlight`, the tooltip in `Canvas` / `CanvasText`, toolbar and map buttons in `ButtonFace` / `ButtonText`. Series identity therefore still comes from the palette, the legend labels and, with `patterns: true`, textures. Under `prefers-contrast: more` focus rings and the brush are thicker and dimmed series fainter.

## Navigator, drill-down, touch and print

```ts
new SuperPlot(el, { type: 'line', x: 'date', y: 'revenue', data, zoom: 'x' }, { navigator: true })       // overview strip under the chart
new SuperPlot(el, { type: 'sunburst', path: ['region', 'country', 'city'], value: 'sales', data }, { onDrill: path => save(path) })
{ type: 'treemap', label: 'product', value: 'revenue', group: 'line', focus: ['Cloud'], data }           // the spec field: draw one group
```

- **`navigator: true`** (web option, default false) adds a 44 px overview strip under a chart with `zoom` on a numeric or time x (line, area, scatter): the whole x range drawn small (the first visible series' line, or a density strip of the dots for a scatter), a window over what is on screen and a handle at each end. Drag the window to pan, a handle to zoom, press the strip to move the window there. The window and both handles are focusable sliders (`role="slider"`, `aria-valuemin/max/now` in axis units: epoch ms on a time axis, with a readable `aria-valuetext`); arrow keys move a handle by a fiftieth of the range (the window by a tenth of its width), Page Up/Down ten times that, Home/End to the ends. It drives the same zoom as the wheel and `setZoom`, so `onZoom` (once per drag, when it ends), sync groups and `getZoom` agree with it. A fixed height (the host's or `height`) includes the strip; an automatic height adds it below. Works with the SVG and canvas renderers (the strip is its own small SVG). A chart that cannot zoom draws without it and reports `navigator_unsupported`. Server-rendered markup is not adopted while the strip is on (the chart is shorter than the server drew it). The strip's code is a chunk loaded on first use: its height is kept from the first draw and it is drawn when the chunk is here (`await plot.ready()`).
- **`focus`** (treemap and sunburst spec field) is a path of group values from the top: only that subtree is drawn, with a breadcrumb line ("All › Asia › Japan") at the top; rings and tiles keep the colours they have in the whole tree, so the legend gives way to the breadcrumb. A treemap drills into a `group` (one value). A path that does not exist warns `focus_not_found` (with "did you mean" and the names that are there), one that ends on a leaf `focus_leaf`; both draw the whole tree. The description says what is shown.
- **Drill-down in the browser** (`drill`, default on when the spec has more than one level): clicking or pressing Enter on a group shows only it (a treemap tile stands for its group), the breadcrumb items are buttons back up, Escape goes up one level. The plot keeps its own focus path (your spec object is never changed) until `setSpec` gets another hierarchy or another `focus`; new data for the same hierarchy keeps it. `onDrill(path)` / `plot-drill` report each step; `onSelect` still fires for the clicked group. Keyboard focus stays in the chart and the change is announced.
- **Live data announcements** (`announce`): after `appendRows`, the polite live region says "3 new points; latest Jan 5, 14:09: revenue 1.4K" (the count, then the tooltip of the mark at the newest row's x), at most once every 5 s (points in between are added up). By default only while keyboard focus is in the chart or `dataTable` is on, so a dashboard of live charts stays quiet; `true` always, `false` never.
- **Touch**: two fingers zoom (spread) and pan (move together) at the same time, anchored to the point under them; `onZoom` fires once when they lift. A finger or pen that lands within 12 px of a dot or a thin bar picks it (tooltip on tap, `onSelect` on click), on SVG and canvas; under `(pointer: coarse)` hit circles, toolbar and map buttons and navigator handles are at least 24 px.
- **Print**: the toolbar, tooltip, map buttons and navigator handles are hidden, and the chart is kept on one page. A chart in a built-in dark theme (`dark`, `accessible-dark`, or `auto` on a dark screen) is redrawn in its light counterpart on `beforeprint` and back on `afterprint` (`printLight: false` keeps it dark). A custom dark Theme object, or `--sp-*` variables your page sets for its dark mode, are left alone; tools that print without firing `beforeprint` (some headless PDF exporters) print what is on screen.

## Live data

`plot.appendRows(rows, { max: 500 })` adds rows to the end, drops the oldest past `max`, and draws once per frame however often it is called. Zoom, brush and hidden series stay; the spec object you passed is not changed.

## Transitions between data states

```ts
new SuperPlot(el, spec, { transition: true })                                   // 300 ms, eased
new SuperPlot(el, spec, { transition: { duration: 500, easing: 'linear' } })     // at most 1,000 ms
```

Off by default, and meant to stay short: motion draws the eye to what moved, which is not always what changed most, and an in-between frame shows values that are in no row (a bar halfway to its new height). Keep it for small dashboards where seeing a bar move helps, not for charts people read closely. With `transition` on, `setSpec`, `appendRows`, legend toggles and `setOptions({ hidden })` animate from what is on screen to the new state:

- **What moves.** Data marks of the old and new scene are matched by series and datum identity (the datum's text fields such as the category, group, label or ISO date, its `x` when that is a number and there is no numeric `y`, a beeswarm `row`); marks with no identity (a line's path, its dots, scatter points) are matched in order within their series. Matched rects move and resize, circles move and change radius, lines move, paths with the same commands have their numbers interpolated (others cross-fade), new bars grow from the zero line, other new marks fade in, and gone marks fade out. Colours follow the entity, so they are not tweened. After `appendRows`, marks matched only by order cross-fade instead of moving, since the n-th point is then another row.
- **What does not.** Axes, ticks, labels, legend, titles and hit targets show the new state at once: no tick text is invented in between. Tooltips, `aria` labels, the live region, the data table, `getScene()`, exports and `onRender` carry the new data from the first frame; on canvas, hover and the keyboard test the final scene.
- **When it is skipped** (the chart draws the new state at once): under `prefers-reduced-motion: reduce` (read on every draw and every frame), on a hidden page, on the first draw (`animate` covers that), when the chart type or renderer changes, on WebGL, during a zoom, pan, brush or map drag, above 5,000 data marks, and for `appendRows` calls closer together than the duration. A new update during a transition cancels it and starts from where the marks are. Resizes, zooms, theme and drill-down redraws never animate.
- Works on the SVG renderer (data elements move in place; copies of gone marks fade out, `aria-hidden` and without pointer events) and on canvas (each frame redraws the chart; plugins' `afterDraw` runs again on the final picture, since frames repaint it). React: the `transition` prop (an inline object is compared by value). `<super-plot transition>` (present for true, a number of ms, or `"false"`).

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
- Sunburst rows that stop early (an empty level) still count toward their parents and leave a gap outside them. More than 30 children under one parent: the smallest merge into "Other". The legend is the first level; hiding one gives its share of the circle back to the others. Drill down with the `focus` field (see "Navigator, drill-down, touch and print"); the web binding does it on click.
- Parallel coordinates draw at most 2,000 lines: past that one row in every k is drawn (a `lines_sampled` warning gives k), while each axis still spans every row. Rows missing a value in any dimension are skipped (`incomplete_rows`).
- `facet` works on violin (as on box). Calendar, sunburst and parallel have no axes to share and refuse `facet` as an unknown field, like heatmap, pie and treemap. `patterns` textures the sunburst by first-level branch; on box, violin, calendar and parallel there is nothing to tell apart by texture, so it is ignored with a `patterns_unsupported` warning.

### Colour-vision check

When a spec sets `colors`, compiling checks each pair of neighbouring series (legend order) that involves one of those colours. If the two are closer than 8 (OKLab distance x 100) with normal vision or under simulated protanopia, deuteranopia or tritanopia (Machado 2009, full severity), the result carries a `colors_indistinct` warning on path `colors` that names the pair and the worst simulation; the chart still draws. Fix it with `patterns: true` (which turns the check off, since textures then carry identity), the `accessible` theme, or colours that differ more in lightness. Colours the check cannot read (`var(--x)`, uncommon names) are skipped; pairs of theme colours alone are not checked. The maths is exported for your own palettes:

```ts
import { indistinctPairs, cvdDistances, parseColor } from '@supersolutions/super-plot-core/base'
indistinctPairs(['#d62728', '#2ca02c'])   // [{ index: 0, worst: 'deuteranopia', min: 3.9, distances: { normal: 33.8, ... } }]
```

## Waffle and beeswarm

```ts
{ type: 'waffle', label: 'mode', value: 'answers', cells: 100 }           // 10 x 10; each square is 1%
{ type: 'beeswarm', x: 'ms', y: 'region', series: 'cache', label: 'id' } // one dot per row, one lane per region
```

A waffle shares `cells` (50 to 400, a multiple of 10) out by largest remainder, so the squares always add up; `waffleCells(values, cells)` gives the same counts. Categories past 8 merge into "Other" with a warning, as on a pie. A beeswarm places dots in value order at the smallest offset that does not overlap (`dodge(xs, radii)` is the exported layout); past 2,000 dots it draws an evenly spaced sample and says so (`too_many_points`), and a lane too short for its swarm shrinks the dots, then warns (`swarm_overflow`). Both work with `facet`; beeswarm also with `zoom` and `brush` on x.

## Gauges and word clouds

Both read worse than the plain alternative and are here because dashboards and text summaries expect them. Each is safe by default and says what it cannot show.

```ts
{ type: 'gauge', value: 'used', max: 1, format: 'percent', data: [{ used: 0.72 }] }                     // one arc
{ type: 'gauge', label: 'resource', value: 'used', target: 'plan', bands: ['good', 'busy', 'saturated'], bandOrder: 'best-first', min: 0, max: 1, data }  // one gauge per row, at most 6
{ type: 'wordcloud', text: 'term', value: 'mentions', data }                                            // horizontal words
{ type: 'wordcloud', text: 'tag', value: 'tickets', series: 'area', rotate: 'some', data }               // coloured by group
```

- **Gauge.** The filled arc's **length** is the value's share of `min`..`max` (default 0 to the `max` you give), always starting at `min`; there is no needle-only mode, because an angle alone is read less exactly than a length. Give `max` (what a full arc means: 100%, the capacity, the plan): without it the top is rounded up from the largest value, target or threshold (`niceDomain`), and a `max_derived` warning says the share then means nothing. A value outside the range fills nothing or everything but the number in the middle, the tooltip, `aria` and the description print it as it is (`value_outside_range`, `target_outside_range`). `bands` names two or three threshold columns in order along the arc; each band is coloured with the theme's status tones (negative, warning, positive; `bandOrder: 'best-first'` reverses them for "lower is better") and **named by its column in text beside it**, so colour never carries the meaning alone; the band of the value is printed under the number. Several rows draw a grid of gauges on one shared range (`label` is then required; at most 6, `too_many_gauges` past that). `facet` is refused (the rows already are the panels). `arc` sets the sweep (90 to 330 degrees, default 240). A stat tile reads a lone number faster, and a one-row `bullet` compares a value with a target and ranges more precisely: prefer them when the arc shape is not expected.
- **Word cloud.** Rows with the same `text` are summed; values at or below zero are left out (`nonpositive_values`); only the 150 largest words are drawn (`too_many_words`). Font size is `floor(maxFont * sqrt(value / largest))`, at least 10 px (`cloudFontSize`), so a word's box area follows its value for words of equal length; the misleading part cannot be removed: **a long word looks bigger than a short word of the same value**, and words under the floor are drawn larger than their value implies (`sizes_floored`). Hence the honesty measures: the description lists the top ten words with their values in order, every word has a tooltip, `aria` ("delivery: 214, rank 1 of 24") and `datum`, the SVG tab order is value order (the canvas arrow keys go left to right, as on every chart), and `dataTable` lists every row. Words that do not fit are left out with `words_dropped` naming them (the layout first retries with smaller fonts). `rotate: 'some'` turns every fourth word a quarter turn; the default keeps all horizontal. `series` colours by group (with a legend; hiding a group keeps the other words in place); without it one hue darkens from small to large words, never fading towards the background. `facet` is refused: the font scale is per panel, so panels would not compare.
- **Layout** is `cloudLayout(words, width, height, measure)`, exported with its algorithm in the doc comment: an Archimedean spiral in 5-degree steps from the centre, stretched to the area, in integer pixels from a table of 19 cosines (`CLOUD_COS`), so the Go and Python ports can reproduce it exactly from the same text widths (`conformance/plot.v1.json`, `cloudLayout`). On a server the widths come from core's estimate; the browser measures with canvas, so a server-rendered SVG and the browser can place words a few pixels differently (each box carries 1 px of padding).

## Timeline and stream graphs

```ts
{ type: 'timeline', y: 'task', start: 'from', end: 'to', series: 'team', annotations: [{ axis: 'x', value: '2026-04-06', label: 'Today' }], data }
{ type: 'timeline', y: 'machine', start: 'startMin', end: 'endMin', labels: true, format: 'fixed:1', data }   // plain numbers work too
{ type: 'area', x: 'year', y: ['Solar', 'Wind', 'Hydro'], stack: 'center', data }                             // a stream graph
```

- **Timeline** (Gantt, x-range, range bar): one lane per value of `y` in order of first appearance, a bar from `start` to `end` per row. Start and end are read together: both ISO dates or timestamps (a time axis with the usual ticks), or both numbers (`xType` overrides). `series` colours bars and gives the legend; `label` names a bar (tooltip title, and the text on it with `labels: true`; without `label`, `labels` prints the duration). The tooltip, `aria` and `datum` carry start, end and the duration, written as at most two units (`3 d 4 h`, `2 h 15 min`; elapsed time, so a day across a daylight-saving change is 23 or 25 h; numbers use `format`).
  Validation: `range_reversed` (an end before its start is **swapped** and drawn, as `interval_reversed` does for intervals), `missing_range` (rows without both ends are skipped), `no_ranges` and `not_time_or_number` (errors), `overlapping_ranges` (two bars in one lane cover each other), `too_many_lanes` (only the first `LIMITS.maxCategories`, 500, are drawn) and `timeline_cramped` at draw time. Line, band and point annotations work (`{axis: 'x', value: <date>}` is a "today" line). `zoom: 'x'` and `brush: 'x'` use the shared scene axes (`xDomain` cuts bars at the edge); the brushed x range carries no filter column, since a bar spans two columns and "overlaps the range" is not one filter step. `facet` gives one timeline per value.
- **Stream graph** (`stack: 'center'` on area): each x starts at minus half its total, so the stack is centred on a middle line. The vertical position then has no zero, so the value axis shows **no ticks or gridlines** (labels there would read as amounts that do not exist); the tooltip lists every value and the total, and the description says the axis has no zero. Negative values count as 0, as in every stack; hidden series leave the centring. `yDomain` still fixes the range (in units from the middle). The other `stack` values are unchanged.

## 3D scatter and surface

```ts
{ type: 'scatter3d', x: 'width', y: 'depth', z: 'height', series: 'kind', label: 'id', data }   // a point per row in a box
{ type: 'surface', x: 'temp', y: 'pressure', z: 'yield', format: 'fixed:1', data }             // one row per grid point
```

Both draw a box whose axes are scaled to the data, with ticks and titles on the edges that face the viewer, a floor
grid and two back walls. `scatter3d` takes `size` (area, as in a bubble chart) and `dropLines` (a line to the floor
per point; on by default, off with a `drop_lines_dense` warning above 2,000 points unless set to `true`). `surface`
wants one row per point of a regular grid (at most 200 x 200: `grid_too_large`, with a hint to bin or use
`scatter3d`); missing points are holes (`missing_cells`), a repeated point keeps its first value
(`duplicate_cells`), and the colour is the sequential scale and legend of a heatmap (`domain`, `mesh: false` to
hide the grid lines).

**Safe by default, and why it still is a 3D chart.** Depth hides points, and a position on screen mixes all three
values, so every 3D spec gets an `info` issue `perspective_3d` (path `projection`) naming a 2D chart that compares
exactly. Issues can now have severity `'info'`: valid, nothing to fix, but worth saying. The projection is
`orthographic` by default (sizes do not change with depth); `projection: 'perspective'` draws nearer things larger
and says so in the same issue. Tooltips, `aria`, the description and the data table give exact x, y and z. The box
never turns by itself.

**Camera.** `camera: { zoom, pitch, bearing }` has the map camera's names and meanings: `pitch` 0 looks straight
down, 90 from the side (default 60); `bearing` turns clockwise (default 35, kept in [0, 360)); `zoom` 0.5 to 8. A
map's `lng`/`lat` is refused in a spec and dropped from the `camera` option. `getCamera<Camera3d>()`,
`setCamera({ pitch: 20 })` (merged and clamped, no event), `resetCamera()` and `onCameraChange` (once per
gesture) work as on maps, so its parameter is now `Camera | Camera3d` (narrow with `'lng' in c`). In the browser:
drag turns (horizontal) and tilts (vertical), the arrow keys turn by 15 and tilt by 10 degrees, + and - zoom, 0
resets, and the corner buttons zoom and reset. Tab steps through the points (or grid points) in order of x,
then y, showing each tooltip; Shift+Tab goes back, and past the last point focus moves on to the legend. On canvas
the chart keeps focus and the point is outlined and read out. With `interactive: false` the box stays still and
Tab still steps through the data. UI strings: `chart3dRole`, `chart3dKeys`, `chart3dSteps`.

**Renderers.** Core compiles the box to ordinary 2D marks in painter's order (far first), so SVG, canvas, PNG and
server rendering all work. `renderer: 'webgl'` draws a 3D scatter's points with the GPU dot layer (in the same
order, no depth buffer); the surface's tiles, the box and the drop lines stay on canvas, and every turn recompiles
the scene. `facet` is not available on these charts.

## Dates, time zones and UI strings

Three render options (not spec fields, like `locale`). The web binding takes them as options (`new SuperPlot(el, spec, { timeZone, strings })`, `setOptions`). React's `<SuperPlot>` takes them as props and redraws when any one of them changes (`strings` is compared by value, so an inline object does not redraw on every render). `<super-plot>` has the attributes `locale`, `time-zone` (an IANA name) and `strings` (JSON), and the properties `locale`, `timeZone` and `strings` (an object; what Vue, Svelte and Angular bind); an attribute wins over the property, and the property over the same key in `options`.

```ts
renderToSvg(spec, { locale: 'de', timeZone: 'Europe/Berlin', strings: { other: 'Andere', total: 'Summe' } })
```

- **`locale`** already names months and weekdays through `Intl.DateTimeFormat` (`Mär`, `janv.`, `1月5日`) in ticks, tooltips, calendars and descriptions; `en` output is unchanged byte for byte.
- **`timeZone`** (IANA name, default `UTC`) moves time-axis ticks to local boundaries (midnights, Mondays, first days of months and years; hour ticks on local hours, both 01:00 ticks of a fall-back night) and shows dates and times in that zone in ticks, tooltips, `aria`, the calendar's day assignment and the scene description (`describePlot(spec, { timeZone })` too). Across a daylight-saving change ticks stay on local boundaries. An unknown name is a `bad_time_zone` warning and UTC is used. Data are **instants**: ISO strings without an offset are read as UTC, as everywhere in Super Plot (and in the ports). So date-only data under another zone are midnights UTC that fall between the local day ticks; a `time_zone_dates` warning says so. Give instants with an offset (`2026-03-01T00:00-05:00`) or as timestamps, or keep UTC for calendar dates. Category axes made by `timeUnit` (UTC buckets) keep their UTC labels. The Go and Python ports describe in English and UTC; `timeZone` changes nothing in validation or conformance.
- **`strings`** overrides the English text core writes into a scene: names it invents ("Other", the waterfall's "Increase", "Decrease", "Total"), tooltip row labels ("Share", "Median", "Running total", "Start", "Duration"), short phrases ("up to {value}", "{value} (missing)", "{label} (right axis)", "{value} (inside the axis break, drawn at its edge)"), duration units and the `aria` templates of marks and legend entries ("{label}: toggle series"). `DEFAULT_STRINGS` (exported from core) is the full list of keys with their English text; `{name}` placeholders are filled in. Unknown keys (`unknown_string`, with a "did you mean"), non-strings (`bad_string`) and over-long values (`string_truncated`, 120 characters) warn and keep the English default. Series keys stay stable (the merged slice is still `Other` in `colors`, legend toggles and `datum`); only labels change. Descriptions stay English (the ports reproduce them word for word): set the spec's `description` for another language. Text from the spec (titles, column names, categories) is never translated.
- **The web binding's own text** reads the same `strings` object, with the same English defaults in `DEFAULT_STRINGS` (one table; these keys come after core's). Core never writes them, so a static SVG is not affected. The keys:

  | Where | Keys (English default) |
  |---|---|
  | Toolbar | `toolbar` ("Chart tools", the group's name); `toolPng`, `toolSvg`, `toolCsv`, `toolTable`, `toolReset`, `toolSound` (button text) and the same with `Name` (accessible name and tooltip: "Download PNG", "Data table", "Reset zoom", "Play as sound", ...) |
  | Canvas | `canvasKeys` ("Use the arrow keys to move between marks.", after the chart's name) |
  | Maps | `mapRole` ("interactive map"), `mapKeys` ("{title}. Drag or use the arrow keys to move, ..."), `mapZoomIn`, `mapZoomOut`, `mapReset` |
  | Data table | `tableFirstRows` ("{caption}: first {n} of {total} rows") |
  | Sound | `soundPlaying` ("Playing {what}: {n} notes, left to right, higher pitch for higher values."), `soundPlayingOne`, `soundFinished` ("Finished playing {title}."), `soundStopped` |
  | Live data | `newPoint` / `newPoints` ("{n} new points"), `newRow` / `newRows` (charts without axes), `newsLatest` ("{count}; latest {mark}."), `newsCount` ("{count}.") |
  | Drill-down | `breadcrumbRoot` ("All"), `breadcrumbUp` ("Go up to {name}"), both written by core into the scene; `drillShowing` ("Showing {path}."), `drillShowingAll` |
  | References | `refShowing` ("Showing {label}.", said by `reveal`) |
  | Navigator | `navOverview`, `navWindow`, `navStart`, `navEnd` (each with `{field}`, the x column), `navRange` ("{from} to {to}", the window's value text) |

  A change through `setOptions({ strings })` relabels the toolbar and map buttons in place (they keep keyboard focus) and rebuilds the table caption. A bad override is reported once by the compile (`unknown_string`, `bad_string`) and the binding keeps English for it. The navigator's dates in `aria-valuetext` follow `timeZone` too (UTC when it is unset or unknown).

## Agents and MCP

```ts
import { plotTools, getPlotTool } from '@supersolutions/super-plot-core/tools'
const tool = getPlotTool('plot_validate')!
tool.run({ spec })        // { ok, issues: [{ code, path, message, hint, severity }] }
```

`severity` is `error` (refused), `warning` (drawn, but something was changed or left out) or `info` (drawn as asked, with a note the agent should pass on: `dual_axis`, `axis_break`). Only errors make `ok` false.

Tools: `plot_catalog` (which chart, which fields, an example), `plot_schema`, `plot_suggest` (which charts fit a table), `plot_validate`, `plot_describe`, `plot_geographies` (the map boundaries the host registered; none ship), `plot_render_svg`.
All have `authority: 'read'`, `inputSchema` (JSON Schema) and `run(args)`, so they can be wrapped by any MCP server or
tool registry in a few lines. Suggested agent loop: `plot_suggest` (when you have a table and no chart yet) or `plot_catalog` -> write spec -> `plot_validate` -> fix by `code` and `hint` -> `plot_render_svg`.

### Which chart for this table: `plot_suggest`

```ts
import { suggestPlots } from '@supersolutions/super-plot-core/base'   // or getPlotTool('plot_suggest')
const r = suggestPlots({ rows, intent: 'trend', max: 3 })
// r.columns      what each column was taken to be: number, time, category, boolean, text or empty
// r.suggestions  [{ code: 'trend_line', type: 'line', score: 100, why, notes, spec: { type: 'line', x: 'month', y: 'sales' } }]
// r.issues       info, warning and error issues with a code, a path and a hint
```

The answer is deterministic: fixed rules over a profile of the columns, no model and no randomness, so the same table gives the same bytes and an agent can branch on `code`. Each suggestion says why it fits (naming the columns) and what to check (rows that will be summed, categories left out). With `rows`, every spec is validated against a sample of them; one that would not draw is dropped with the warning `suggestion_invalid` rather than handed over. The spec comes without `data` unless you pass `includeData`: add your rows and it draws. `intent` (`trend`, `compare`, `ranking`, `composition`, `distribution`, `relationship`) adds 40 to the score of the rules that answer it (at most 100); without it the data's shape alone decides. Ties keep the order of the table below, and `SUGGEST_VERSION` (now 1) is raised whenever a rule changes what it proposes or how it scores.

When the table has too many rows to send, send `columns` instead: `{ name, kind, distinct?, rows?, min?, integer?, granularity?, avgLength? }` per column (a `GROUP BY`/`COUNT(DISTINCT)` gives them). The suggestions are then not checked against any rows (info `unvalidated`). In the chat plugin, `plot_suggest` takes a card and reads its rows.

| Code | Chart | Answers | Applies when |
|---|---|---|---|
| `trend_line` | line | trend | A time column and one or more number columns, no category to split by: one line per number column (up to 4). |
| `trend_line_series` | line | trend | A time column, a number column and a category of 2 to 8 values with several rows per time: one line per category. |
| `calendar_daily` | calendar | trend | A column of dates (day granularity) over at least 60 days and a number column: one cell per day. |
| `compare_bar` | bar | compare | A category of 2 to 50 values and a number column: bars, biggest first. |
| `compare_bar_grouped` | bar | compare | A category of 2 to 12 values and two to four number columns: grouped bars. |
| `composition_pie` | pie | composition | A category of 2 to 6 values, each once, and a number column with no negatives: shares of a whole. |
| `composition_stacked_bar` | bar | composition | Two categories (2 to 12 and 2 to 8 values) and a number column with no negatives: stacked bars. |
| `composition_stacked_area` | area | composition | A time column, a category of 2 to 8 values and a number column with no negatives: stacked areas. |
| `matrix_heatmap` | heatmap | compare | Two categories (at most 30 values each) and a number column: a grid coloured by the number. |
| `relationship_scatter` | scatter | relationship | Two number columns (identifiers excluded) and at least 8 rows: a dot per row; a third number sets the size and a category of up to 8 values the colour. |
| `distribution_histogram` | histogram | distribution | A number column (identifiers excluded) with at least 8 rows: how its values spread. |
| `distribution_box` | box | distribution | A number column and a category of 2 to 12 values with at least 5 rows each on average: one box per category. |

Issue codes: errors `missing_required`, `empty_data`, `bad_type`, `bad_value`, `bad_enum` (the input is not usable); warnings `suggestion_invalid`, `no_chart`; info `rows_sampled` (only the first 1000 rows are read), `unvalidated`, `column_empty`, `id_column_skipped` (an integer column named like `id` with a different value on every row is not used as a measure), `text_column_skipped` (more than 50 different values, mostly unique: not usable on an axis or a legend), `chart_not_registered`, `more_available`.

Limits, said plainly: a column is a category when it is not a number, a time or a boolean and does not look like free text, so a numeric code such as a postal code is read as a number and a year column (`2024`) as a number, not a time (name it `"2024-01-01"`-style or pass a `columns` profile to say otherwise). The rules know twelve shapes of table, not every chart type: maps, networks, funnels, Sankey and the like need a fact about the data (a geography, links) that a column profile cannot show, so they are never suggested; use `plot_catalog`. A score is a ranking, not a probability. Whether the reader understands the chart, and whether the title says the right thing, is not something a rule can check.

## References and agent annotations

A **card reference** lets text elsewhere (a chat message, a report, an agent's answer) point into a plot:
`[March was highest](ref:sales?x=2026-03)`. Hovering or focusing the words highlights the matching marks; a click or
Enter brings them into view. The link format is the Super Protocol card-reference shell (`parseCardRef`,
`formatCardRef`, `CARD_REF_LIMITS`; core's marked copy of protocol 0.3.0's, since core imports nothing):
`ref:<target>?<name>=<value>&...`, the target being the card's id, a repeated name a list (`x=a&x=b`), values
percent-encoded, at most 512 characters. What the names mean is Super Plot's own vocabulary:

| Name | Matches | Values |
|---|---|---|
| `key` | annotations by their `key`, and rows by the spec's `key` column (compared as text) | any text |
| `x` | the chart's category, position or time column(s), any of them (table below) | a number `5` or range `2..8` (either end may be left out: `..5`, `60..`); a date as an ISO prefix, the whole period (`2026` is the year, `2026-03` all of March, `2026-03-01T09:30`), or a range of them (`2026-01..2026-03` is the first quarter, end inclusive); a category as its text, or a range in data order (`Feb..Apr`) |
| `y` | a value or range on the chart's value column(s), per point (each column of a wide `y` its own series); on charts marked *row* below, the row instead | numbers and ranges as above (a row: as `x`) |
| `series` | legend entries: the series column, the legend column of a chart without one (a pie's slices), or a wide `y`'s column names | the series name |

Names are ANDed, the values of one name ORed, and `ref:sales` alone is the whole plot. Matching runs on the data after
`transform`, the same as what is drawn. Dates are UTC (`:` is written `%3A` inside a link).

| Chart | `x` reads | `y` reads | `series` reads |
|---|---|---|---|
| bar, line, area | `x` | `y`, `line`, `yRight` | `series` (or a wide `y`'s columns) |
| scatter, scatter3d, radar | `x` | `y` | `series` |
| pie, donut, waffle | `label` | `value` | `label` |
| histogram | `value` | | `series` |
| box, violin | `x` | `y` | `x` |
| heatmap, surface | `x` | `y` (row) | |
| beeswarm | `x` | `y` (row) | `series` |
| timeline | `start`..`end` (overlap) | `y` (row) | `series` |
| calendar, waterfall, bullet | `x` | `value` / `y` | |
| bump | `x` | `rank`, `y` | `series` |
| treemap | `label` | `value` | `group` |
| sunburst | any level of `path` | `value` | |
| sankey, flow-map | `from`, `to` | `value` | (flow-map: `series`) |
| funnel | `stage` | `value` | |
| gauge | `label` | `value` | |
| wordcloud | `text` | `value` | `series` |
| choropleth | `region` | `value` | |
| bubble-map, column-map | `region`, `label` | `size` / `value` | `series` |
| parallel | | | `series` |

(The machine-readable form is each chart's `ref` in `fields.v1.json`.)

**Resolving** is plain data, in core and in both ports, with the same answer (conformance `refCases`, about 9,000 fuzzed
references per seed):

```ts
import { resolveRef, matchMarks, markRef } from '@supersolutions/super-plot-core/base'
resolveRef(spec, 'ref:sales?x=2026-01..2026-03')
// { ok: true, rows: [0, 1, 2], points: [{ row: 0 }, { row: 1 }, { row: 2 }], series: ['sales'], keys: [], label: '3 points' }
// or { ok: false, code, reason }
```

```python
from super_plot import resolve_ref       # Go: superplot.ResolveRef(spec, ref, hidden)
resolve_ref(spec, "ref:sales?x=2026-03")
```

Codes: `ref_invalid` (not a reference), `ref_spec_invalid` (the spec does not validate), `ref_param_unknown` (a name
other than the four), `ref_param_unsupported` (this chart has nothing that name can read), `ref_bad_value` (a value
its column cannot read), `ref_hidden_series` (everything it names is in series the viewer hid; `series` lists them)
and `ref_no_match`. Every data mark lists the rows it draws (`Mark.rows`, indexes into the transformed data), so
`matchMarks(scene, match)` gives any renderer the marks to outline, the line points to ring and the mark to focus;
`markRef(spec, mark, target)` goes the other way.

**In the browser:**

```ts
plot.highlight('ref:sales?x=2026-03')   // { ok: true, label } or { ok: false, code, reason }
plot.highlight(null)                    // clear
plot.reveal('ref:sales?x=2026-03')      // bring it into view and focus it
new SuperPlot(el, spec, { refTarget: 'sales', onRefChange: ref => ... })   // the reference of the hovered mark
```

- `highlight` outlines each matched mark (an outline in the text colour over a halo in the background colour) and
  dims the rest of the plot area under a veil; a line that draws more than matched is not outlined, its matched
  points are ringed. It is one overlay drawn from the scene, so it is the same on SVG, canvas and WebGL. Exactly one
  matched point shows its tooltip. It stays through resizes, new data and legend toggles (points in hidden series
  are left out) until `highlight(null)` or **Escape** in the chart, which clears it before it does anything else.
  The same call twice changes nothing. Above 200 marks the outline is thin with no halo; at most 2,000 are outlined.
- `reveal` unhides the matched series (`onHiddenChange`), leaves a drill-down that hides the match (`onDrill`), zooms
  out (`onZoom`) or puts a map back to its own view (`onCameraChange`) when the match is off screen, scrolls the
  chart into view, highlights the match, moves keyboard focus to its first point (the mark on SVG, the canvas view's
  cursor on canvas, the chart itself when no mark can take focus) and says `refShowing` ("Showing {label}.") in the
  live region.
- `onRefChange(ref | null)` reports the reference of the mark under the pointer or keyboard, once per change, with
  `refTarget` (default `"plot"`) as its target; `reveal`'s own focus move is not reported. `<super-plot>` fires it as
  `plot-ref` and has `highlight()` and `reveal()`; React passes `onRefChange` and `refTarget` through and the ref is
  the instance.

**Accessibility.** The highlight is a shape, never colour alone: an outline, a halo and a dimmed surround. In
forced-colours mode the outline is `Highlight` and the veil `Canvas`; with `prefers-contrast: more` the veil is
darker. Nothing animates, ever; under `prefers-reduced-motion` `reveal` scrolls without smooth scrolling. The
overlay is `aria-hidden`: what matched is said in words (the `label`, the tooltip, the live region), and focus moves
only on `reveal`, which a person asked for.

**Agent annotations.** Any annotation may carry `key` (a stable id a reference names: `key=peak`), `note` (up to
2,048 characters, shown as its tooltip) and `by`: `author` (default) or `assistant`. An assistant's annotation is
drawn with `assistantMark` ("✦") before its label, its tooltip says `assistantNote` ("Added by the assistant"), and
the description says "The assistant marked ...", so a reader always knows which marks are not the author's. A plot
holds at most 256 annotations.

**The chat plugin** (`@supersolutions/super-plot-chat-plugin`) puts this together for a chat host: the `super.plot`
card, its handle's `ref(ref, 'enter' | 'leave' | 'activate')` (highlight, clear, reveal), and agent tools to read a
plot, check a reference before writing it, highlight part of a plot and add or remove its own annotations. See its
README; `examples/chat` is a demo host.

The card fits where the host shows it (super-protocol 0.4 `CardMountContext.placement`, read structurally so older
hosts keep working): `inline` is the chat card with its `height`; `panel` fills a side panel (at least 320 px) and
ignores `height`, and the manifest declares a `panel` capability for `super.plot`; `document` (inside a Super Editor
report) keeps `height` and draws without the entrance animation. Moving a card between places keeps the plot, its zoom
and its highlight.

## Super Chat

Today Super Chat has a built-in `chart` card. `fromChatChartCard(card)` converts it to a spec so the same data can be drawn by Super Plot:

```ts
import { fromChatChartCard } from '@supersolutions/super-plot-core/adapters'
const { ok, spec, notes } = fromChatChartCard(card)   // notes say what could not be carried over
```

Not carried over, and reported in `notes`: series on the right axis, mixed series types beyond the first, candlesticks (use Super Chart).

The generic `super.plot` card (`{ kind: "super.plot", id?, title?, height?, spec, alt }`, super-protocol 0.3.0) is
drawn by the chat plugin above, which also answers `ref:` links in messages and gives the agent its plot tools.

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

- React: `<SuperPlot spec onSelect onIssues onHiddenChange onHover onRender onZoom onBrush onDrill plugins dataTable sync toolbar tooltipFormat navigator drill announce printLight transition locale timeZone strings />`; the ref is the `SuperPlot` instance (`appendRows`, `setZoom`, `setBrush`, `toPng`, `toCsv`, `sonify`, `ready`). `sync`, `toolbar`, `transition` and `strings` may be inline objects or arrays (compared by value); `tooltipFormat` and the callbacks always call the latest function without a redraw.
- shadcn/ui: `theme="shadcn"` reads the project's `--chart-1..5` and surface tokens; nothing to configure.
- Plain HTML: `<super-plot spec='{"type":"bar",...}' theme="auto" toolbar sync="sales">`. Attributes: `spec` (JSON), `theme`, `locale`, `time-zone`, `strings` (JSON), `renderer`, `toolbar` (present for the default buttons, a comma list such as `"png,csv,sound"`, or `"false"`), `sync` (a key), `navigator` and `drill` (flags: present for true, `"false"`), `transition` (present for true, a number of ms, or `"false"`). Events add `plot-drill`. Properties: `spec`, `locale`, `timeZone`, `strings` and `options` (any `SuperPlotOptions` as an object, callbacks included); an attribute wins over a property, a property over the same key in `options`. Methods: `appendRows`, `setZoom`, `getZoom`, `setBrush`, `getBrush`, `toSvg`, `toPng`, `toCsv`, `sonify`, and `instance` for the rest.
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
