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

## Navigator, drill-down, touch and print

```ts
new SuperPlot(el, { type: 'line', x: 'date', y: 'revenue', data, zoom: 'x' }, { navigator: true })       // overview strip under the chart
new SuperPlot(el, { type: 'sunburst', path: ['region', 'country', 'city'], value: 'sales', data }, { onDrill: path => save(path) })
{ type: 'treemap', label: 'product', value: 'revenue', group: 'line', focus: ['Cloud'], data }           // the spec field: draw one group
```

- **`navigator: true`** (web option, default false) adds a 44 px overview strip under a chart with `zoom` on a numeric or time x (line, area, scatter): the whole x range drawn small (the first visible series' line, or a density strip of the dots for a scatter), a window over what is on screen and a handle at each end. Drag the window to pan, a handle to zoom, press the strip to move the window there. The window and both handles are focusable sliders (`role="slider"`, `aria-valuemin/max/now` in axis units: epoch ms on a time axis, with a readable `aria-valuetext`); arrow keys move a handle by a fiftieth of the range (the window by a tenth of its width), Page Up/Down ten times that, Home/End to the ends. It drives the same zoom as the wheel and `setZoom`, so `onZoom` (once per drag, when it ends), sync groups and `getZoom` agree with it. A fixed height (the host's or `height`) includes the strip; an automatic height adds it below. Works with the SVG and canvas renderers (the strip is its own small SVG). A chart that cannot zoom draws without it and reports `navigator_unsupported`. Server-rendered markup is not adopted while the strip is on (the chart is shorter than the server drew it).
- **`focus`** (treemap and sunburst spec field) is a path of group values from the top: only that subtree is drawn, with a breadcrumb line ("All › Asia › Japan") at the top; rings and tiles keep the colours they have in the whole tree, so the legend gives way to the breadcrumb. A treemap drills into a `group` (one value). A path that does not exist warns `focus_not_found` (with "did you mean" and the names that are there), one that ends on a leaf `focus_leaf`; both draw the whole tree. The description says what is shown.
- **Drill-down in the browser** (`drill`, default on when the spec has more than one level): clicking or pressing Enter on a group shows only it (a treemap tile stands for its group), the breadcrumb items are buttons back up, Escape goes up one level. The plot keeps its own focus path (your spec object is never changed) until `setSpec` gets another hierarchy or another `focus`; new data for the same hierarchy keeps it. `onDrill(path)` / `plot-drill` report each step; `onSelect` still fires for the clicked group. Keyboard focus stays in the chart and the change is announced.
- **Live data announcements** (`announce`): after `appendRows`, the polite live region says "3 new points; latest Jan 5, 14:09: revenue 1.4K" (the count, then the tooltip of the mark at the newest row's x), at most once every 5 s (points in between are added up). By default only while keyboard focus is in the chart or `dataTable` is on, so a dashboard of live charts stays quiet; `true` always, `false` never.
- **Touch**: two fingers zoom (spread) and pan (move together) at the same time, anchored to the point under them; `onZoom` fires once when they lift. A finger or pen that lands within 12 px of a dot or a thin bar picks it (tooltip on tap, `onSelect` on click), on SVG and canvas; under `(pointer: coarse)` hit circles, toolbar and map buttons and navigator handles are at least 24 px.
- **Print**: the toolbar, tooltip, map buttons and navigator handles are hidden, and the chart is kept on one page. A chart in a built-in dark theme (`dark`, `accessible-dark`, or `auto` on a dark screen) is redrawn in its light counterpart on `beforeprint` and back on `afterprint` (`printLight: false` keeps it dark). A custom dark Theme object, or `--sp-*` variables your page sets for its dark mode, are left alone; tools that print without firing `beforeprint` (some headless PDF exporters) print what is on screen.

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

Three render options (not spec fields, like `locale`). The web binding takes them as options (`new SuperPlot(el, spec, { timeZone, strings })`, `setOptions`). React's `<SuperPlot>` takes them as props and redraws when any one of them changes (`strings` is compared by value, so an inline object does not redraw on every render). `<super-plot>` has the attributes `locale`, `time-zone` (an IANA name) and `strings` (JSON), and the properties `locale`, `timeZone` and `strings` (an object; what Vue, Svelte and Angular bind); an attribute wins over the property, and the property over the same key in `options`.

```ts
renderToSvg(spec, { locale: 'de', timeZone: 'Europe/Berlin', strings: { other: 'Andere', total: 'Summe' } })
```

- **`locale`** already names months and weekdays through `Intl.DateTimeFormat` (`Mär`, `janv.`, `1月5日`) in ticks, tooltips, calendars and descriptions; `en` output is unchanged byte for byte.
- **`timeZone`** (IANA name, default `UTC`) moves time-axis ticks to local boundaries (midnights, Mondays, first days of months and years; hour ticks on local hours, both 01:00 ticks of a fall-back night) and shows dates and times in that zone in ticks, tooltips, `aria`, the calendar's day assignment and the scene description (`describePlot(spec, { timeZone })` too). Across a daylight-saving change ticks stay on local boundaries. An unknown name is a `bad_time_zone` warning and UTC is used. Data are **instants**: ISO strings without an offset are read as UTC, as everywhere in Super Plot (and in the ports). So date-only data under another zone are midnights UTC that fall between the local day ticks; a `time_zone_dates` warning says so. Give instants with an offset (`2026-03-01T00:00-05:00`) or as timestamps, or keep UTC for calendar dates. Category axes made by `timeUnit` (UTC buckets) keep their UTC labels. The Go and Python ports describe in English and UTC; `timeZone` changes nothing in validation or conformance.
- **`strings`** overrides the English text core writes into a scene: names it invents ("Other", the waterfall's "Increase", "Decrease", "Total"), tooltip row labels ("Share", "Median", "Running total", "Start", "Duration"), short phrases ("up to {value}", "{value} (missing)"), duration units and the `aria` templates of marks and legend entries ("{label}: toggle series"). `DEFAULT_STRINGS` (exported from core) is the full list of keys with their English text; `{name}` placeholders are filled in. Unknown keys (`unknown_string`, with a "did you mean"), non-strings (`bad_string`) and over-long values (`string_truncated`, 120 characters) warn and keep the English default. Series keys stay stable (the merged slice is still `Other` in `colors`, legend toggles and `datum`); only labels change. Descriptions stay English (the ports reproduce them word for word): set the spec's `description` for another language. Text from the spec (titles, column names, categories) is never translated.
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
  | Navigator | `navOverview`, `navWindow`, `navStart`, `navEnd` (each with `{field}`, the x column), `navRange` ("{from} to {to}", the window's value text) |

  A change through `setOptions({ strings })` relabels the toolbar and map buttons in place (they keep keyboard focus) and rebuilds the table caption. A bad override is reported once by the compile (`unknown_string`, `bad_string`) and the binding keeps English for it. The navigator's dates in `aria-valuetext` follow `timeZone` too (UTC when it is unset or unknown).

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

- React: `<SuperPlot spec onSelect onIssues onHiddenChange onHover onRender onZoom onBrush onDrill plugins dataTable sync toolbar tooltipFormat navigator drill announce printLight locale timeZone strings />`; the ref is the `SuperPlot` instance (`appendRows`, `setZoom`, `setBrush`, `toPng`, `toCsv`, `sonify`). `sync`, `toolbar` and `strings` may be inline objects or arrays (compared by value); `tooltipFormat` and the callbacks always call the latest function without a redraw.
- shadcn/ui: `theme="shadcn"` reads the project's `--chart-1..5` and surface tokens; nothing to configure.
- Plain HTML: `<super-plot spec='{"type":"bar",...}' theme="auto" toolbar sync="sales">`. Attributes: `spec` (JSON), `theme`, `locale`, `time-zone`, `strings` (JSON), `renderer`, `toolbar` (present for the default buttons, a comma list such as `"png,csv,sound"`, or `"false"`), `sync` (a key), `navigator` and `drill` (flags: present for true, `"false"`). Events add `plot-drill`. Properties: `spec`, `locale`, `timeZone`, `strings` and `options` (any `SuperPlotOptions` as an object, callbacks included); an attribute wins over a property, a property over the same key in `options`. Methods: `appendRows`, `setZoom`, `getZoom`, `setBrush`, `getBrush`, `toSvg`, `toPng`, `toCsv`, `sonify`, and `instance` for the rest.
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
