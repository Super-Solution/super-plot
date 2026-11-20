# Super Plot against its competitors

**Last verified:** 2026-11-19 · **Against:** Super Plot 0.1.0 (rounds 5 and 6, unpublished) · **Method:** super-dev-docs `docs/30-runbooks/competitive-review.md` · **Evidence:** [COMPETITORS-2026-11-19.md](COMPETITORS-2026-11-19.md) (18 libraries, 62 capabilities, 66 sources opened that day)

This page answers one question per row: a competitor does X, what does Super Plot do about it? Each row is **built** (with the field, option or event that does it), **refused** (with the reason, tied to a Super Kit principle) or **open** (waiting for the owner, also in [OPEN-DECISIONS.md](OPEN-DECISIONS.md)). Competitor cells, sources and the "deliberately does not do" notes are in the evidence file; nothing here repeats a vendor number as if it were ours.

Status marks: ✅ built · 🚧 built with a stated limit · ⛔ refused on purpose · ❓ open for the owner.

## Our own defects found this round (fixed first, P26)

| Defect | Found by | Fix |
|---|---|---|
| Empty-string column names silently disabled a transform; years 0–99 became 1900–1999; huge timestamps threw in `describePlot` | Go/Python port fuzzing (round 4) | Fixed in core with regression tests; the ports reproduce the fixed behaviour |
| A line without fill was hit-tested as the polygon its points enclose (hovering inside the shape picked it) | Round 5 canvas work | Hit along the stroke only |
| Facets of horizontal charts each had their own value range | Round 5 bullet work | One shared range, as on vertical facets |
| `patterns` on a box plot was silently ignored | Round 5 violin work | `patterns_unsupported` warning on charts without fills |
| Keyboard focus was lost from toolbar and map zoom buttons on every redraw | Round 5 toolbar work | Buttons are kept across redraws |

## A. Chart types

| Capability | Who has it (see evidence) | Super Plot | How, or why not |
|---|---|---|---|
| bar, line, area, scatter, pie/donut | all | ✅ | `bar`, `line`, `area`, `scatter`, `pie`, `donut` |
| histogram, box | most | ✅ | `histogram`, `box` (`points: 'outliers' \| 'all' \| 'none'`, fixed jitter) |
| violin | Plotly, Vega-Lite (density), Highcharts, Bokeh (assembled) | ✅ | `violin`: Gaussian KDE, Silverman bandwidth, exported `kde()` so the ports match |
| heatmap, calendar heatmap | ECharts, Nivo, Highcharts | ✅ | `heatmap`, `calendar` (UTC days or `timeZone`, empty days never coloured as zero) |
| treemap, sunburst | ECharts, Plotly, Highcharts, Nivo, AG (paid) | ✅ | `treemap`, `sunburst` (`path` of 1–6 columns), drill-down via `focus` |
| sankey | ECharts, Plotly, Highcharts, Nivo | ✅ | `sankey` |
| funnel | ECharts, Plotly, Highcharts, AG, ApexCharts, amCharts | ✅ | `funnel`: centred bars; a trapezoid was refused because it encodes one value with two edges |
| waterfall | ECharts, Plotly, Highcharts, AG (paid), ApexCharts | ✅ | `waterfall`: increase, decrease and total each have a legend entry, so colour is not the only cue |
| bullet | Nivo, Highcharts | ✅ | `bullet` (`scale: 'shared' \| 'each'`) |
| bump / rank | Nivo | ✅ | `bump` from a rank column or ranked `y` |
| parallel coordinates | ECharts, Plotly, Highcharts, Nivo | ✅ | `parallel`, sampled every k-th row past 2,000 lines with a warning |
| radar | most | ✅ | `radar` |
| waffle / unit | Nivo, Observable Plot, Highcharts item | ✅ | `waffle`, largest-remainder cells that always add up |
| beeswarm / dodge | Observable Plot, Nivo, ECharts 6, ApexCharts (paid) | ✅ | `beeswarm`, deterministic dodge (exported) |
| timeline / Gantt / range bar | Highcharts Gantt, amCharts, ApexCharts, Nivo | ✅ | `timeline` with `start`/`end`, dates or numbers |
| stream graph | ECharts, Highcharts, Nivo, Vega-Lite (`stack: center`) | ✅ | `area` with `stack: 'center'`; the value axis shows no ticks because there is no zero |
| choropleth, bubble, column and flow maps; globe | ECharts, Plotly, Highcharts Maps, amCharts, deck.gl | ✅ | Round 3 (no boundaries ship; neutral on disputed areas) |
| gauge | ECharts, Highcharts, AG, ApexCharts, amCharts | ✅ | Round 6 (refusal overruled by the owner): `gauge` with `value`, `label` (one gauge per row, at most 6), `min`, `max`, `target`, `bands` (2 or 3 threshold columns) and `bandOrder`, `arc`. Honesty: the filled arc's length is the share of `min`..`max` (no needle-only mode); a value outside the range is clamped on the arc and printed as it is (`value_outside_range`); a missing `max` is derived and warned (`max_derived`); bands are named in text, not by colour alone. The docs still point to a stat tile or a one-row `bullet` |
| candlestick, indicators | ECharts, Plotly, Highcharts Stock, amCharts Stock, AG | ⛔ | Super Chart's job; never duplicated across Super libs |
| network graph, chord, arc, venn, marimekko | ECharts, Highcharts, Nivo, amCharts, visx | ❓ | Force layouts are not deterministic without extra care and are hard to read; build if a use case asks (OPEN-DECISIONS) |
| word cloud | Highcharts, visx, ECharts (third-party) | ✅ | Round 6 (refusal overruled by the owner): `wordcloud` with `text`, `value`, `series`, `rotate: 'none' \| 'some'`; deterministic integer spiral (`cloudLayout`, port-reproducible). Honesty: font size by the square root of the value; the description lists the top words with their values in order, every word has `aria`, a tooltip and `datum`, the data table lists every word, dropped and floored words are warned (`words_dropped`, `sizes_floored`); the docs state that long words look bigger and point to a sorted bar chart |
| 3D charts other than maps | Plotly, ECharts GL, Highcharts 3D | ✅ | `scatter3d` and `surface` (round 6). Safe by default: orthographic projection, exact x, y, z in tooltips, description and data table, an `info` issue (`perspective_3d`) naming the 2D chart that compares exactly, no auto-rotation, keyboard turning and Tab through the data in x order. `perspective` is opt-in and says what it distorts. No 3D bars (`bar3D`): a 3D bar hides its neighbours and its height reads against a slanted floor; a heatmap or grouped bars say the same |
| pictorial bars | ECharts, Highcharts | ⛔ | Decoration over data; a waffle covers countable shares |

## B. Scales and marks

| Capability | Super Plot | How, or why not |
|---|---|---|
| log scale | ✅ | `xScale`/`yScale: 'log'` on scatter and line; zoom and brush work in log space; refused on bar, area and histogram (`log_scale_refused`: a length must start at zero) |
| dual y-axis | ✅ | Round 6, at the owner's request: `yRight` (+ `yRightLabel`, `rightDomain`, `formatRight`) on line, unstacked area and vertical bars. Two scales can still invent a correlation, so it is safe by default: an `info` issue `dual_axis` always says so and names the alternatives (`index` step, `sync`); axis labels take their series' colour (contrast-checked); the legend and tooltips say "(right axis)"; tooltips use each axis's format; on bars both axes include zero and the zeros line up; the description names each axis's series, unit and range; y-zoom and y-brush are refused with a warning; facets share both ranges |
| error bars / bands | ✅ | `yLower`/`yUpper` (bands on line/area, bars on scatter and grouped bars), `xLower`/`xUpper` on scatter |
| regression / loess | ✅ | `trend: 'linear' \| 'loess'`, `trendBandwidth`; exported `loess()` |
| point annotations / callouts | ✅ | `annotations: [{ x, y, label }]`, kept inside the plot, read out in the description |
| small multiples | ✅ | `facet` (round 4) |
| layered marks | ✅ | `line` over bars (round 4); one value axis |
| missing-data gaps | ✅ | `gaps: 'break' \| 'connect' \| 'zero'` |
| lollipop | ✅ | bar `mark: 'lollipop'` |
| broken axis | ✅ | Round 6, at the owner's request: `yBreak: [from, to]` on grouped bars (vertical and horizontal) and lines. It still hides magnitude, so: an `info` issue `axis_break` always states the hidden span; a zigzag gap crosses the axis and every bar or line; ticks on both sides with the same units per pixel; real values in tooltips, labels and the description; a break containing a bar's zero baseline is refused (`break_misleading`); values inside the cut are a `break_hides_values` warning and are drawn marked at its edge; refused on log, stacked and two-axis charts; zoom and brush on the broken axis are refused |
| label collision avoidance | 🚧 | Tick labels never collide (round 1); end labels on bump and direct labels are spaced; no general label solver |

## C. Data

| Capability | Super Plot | How, or why not |
|---|---|---|
| declarative transforms | ✅ | `transform`: filter, timeUnit, aggregate, sort, top, **bin, window, fold**, and (round 6) **index** (each group rescaled to 100 at its first or a chosen point, as Datawrapper's and Flourish's "index to 100"; groups with a zero, negative or missing base are dropped with a warning that names them); every step validated with codes; ports reproduce them (the `index` cases are in `transformCases`) |
| expression / calculate language | ⛔ | No eval in a spec (security, P-security) and no second language to port to Go and Python; the agent computes columns upstream |
| streaming append | ✅ | `appendRows(rows, { max })` ring buffer (round 4), with throttled screen-reader announcements |
| decimation | ✅ | Lines keep min and max per pixel column (Chart.js's default algorithm); LTTB refused because it can drop extremes |
| large-data GPU mode | ✅ | WebGL renderer for dots and maps, same features as the normal path (round 3); fast stamped dots on canvas (round 4) |
| columnar input (Arrow) | ❓ | Would add a dependency or a second data shape; rows stay the contract |

## D. Interaction

| Capability | Super Plot | How, or why not |
|---|---|---|
| tooltip | ✅ | Default on, keyboard reachable |
| custom tooltip formatter | ✅ | `tooltipFormat(tip, e)` returns text or a Node, never HTML strings (XSS) |
| legend toggle | ✅ | `hidden`, `onHiddenChange`; colours follow the entity |
| zoom / pan, brush | ✅ | `zoom`, `brush` (round 4), log axes included |
| point selection | ✅ | `onSelect` on click, Enter or Space |
| cross-chart sync | ✅ | `sync: 'key'` or `{ key, hover, zoom, brush }`, no loops, nothing on `window` |
| range slider / navigator | ✅ | `navigator: true` with keyboard sliders |
| drill-down with breadcrumbs | ✅ | `focus` spec field on treemap and sunburst; the web binding drills on click/Enter, Escape goes up, `onDrill` |
| entrance animation | ✅ | `animate`, skipped under reduced motion |
| animated data transitions | ✅ | `transition` web option (round 6), **off by default**: marks matched by series and datum move, new bars grow from zero, gone marks fade; axes, labels, tooltips, aria and the data table show the new state at once; skipped under reduced motion, on a hidden page, on the first draw, during gestures, on WebGL, above 5,000 marks and for fast `appendRows` streams; at most 1,000 ms; SVG and canvas. uPlot, visx and Plot refuse them because motion can hide what changed: hence opt-in, short, and documented as a risk |
| export toolbar | ✅ | `toolbar` (PNG, SVG, CSV, table, reset, sound), off by default; `toPng`, `toSvg`, `toCsv`, core `plotCsv` with formula-injection protection |
| input widgets bound to parameters | ⛔ | A host's job (P9: no app-specific UI in the lib); selections and `transform` filters are the hand-off |
| undo/redo, context menu, on-chart drawing tools | ⛔ | Editor features; drawings belong to Super Chart |

## E. Accessibility

| Capability | Super Plot | How |
|---|---|---|
| keyboard navigation | ✅ | SVG and canvas marks, zoom keys, toolbar, navigator sliders, drill-down |
| screen-reader description | ✅ | Generated `description`, `aria` on every data mark, live region |
| data-table view | ✅ | `dataTable` (round 4) |
| pattern fills | ✅ | `patterns` (round 4) |
| colour-blind check | ✅ | `colors_indistinct` warning on user colours (Machado 2009, OKLab); the default palettes measured (default min 14.0, accessible 9.6) |
| sonification | ✅ | `sonify()`; pure `sonifyNotes()` |
| forced colours / high contrast | ✅ | `forced-colors` and `prefers-contrast` rules |
| reduced motion | ✅ | Entrance animation and data transitions off (read live) |
| live data announcements | ✅ | After `appendRows`, throttled |
| print | ✅ | `@media print` rules |
| translatable UI text | ✅ | `strings` render option (`DEFAULT_STRINGS`), `locale`, `timeZone` |
| voice input, tactile export | ⛔ | Highcharts only; out of scope for a lib without a UI shell |

## F. Platform

| Capability | Super Plot | How, or why not |
|---|---|---|
| SVG / Canvas / WebGL | ✅ | `renderer: 'auto' \| 'svg' \| 'canvas' \| 'webgl'` |
| server rendering, no DOM | ✅ | `renderToSvg`, `compilePlot` |
| hydration | 🚧 | `renderToSvg(spec, { hydrate: true })` is adopted when the client would draw the same bytes; React's `<SuperPlot>` still renders an empty div on the server |
| worker / OffscreenCanvas | ❓ | `drawScene` takes any 2D context so a host can do it; the binding does not, since hover and keyboard need the scene on the main thread and 50k-point redraws already take about 180 ms (headless, no GPU) |
| React, web component | ✅ | `super-plot-react`, `<super-plot>` |
| Vue, Svelte, Angular | ✅ via the element | Documented and tested through properties and events; no extra packages (P: no wrapper on wrapper) |
| theming via CSS variables | ✅ | `--sp-*`, shadcn `--chart-1..5`, Super Chart aliases |
| plugin / hook API | ✅ | `afterCompile`, `afterDraw`, events |
| tree-shaking | ✅ | `/base` + `/charts` (round 4); chart groups (`/charts/basic` ...), transform steps registered like charts, the canvas renderer and the projections loaded on demand, a per-module `dist` and size budgets in the gate (package split, 2026-11-20) |
| JSON spec and schema for agents | ✅ | One field DSL drives validation, JSON Schema, SPEC.md, the catalog and the Go/Python ports |
| licence | ✅ | Apache-2.0, © SUPER SOLUTION LABS INC (same as super-chat and super-protocol) |

## What was not copied, in one place

Candlestick, 3D bars, pictorial bars, an expression language, LTTB, input widgets, editor features (undo, drawing tools, context menus), voice and tactile export. Each has its reason above. Gauge, word cloud, non-map 3D (`scatter3d`, `surface`), dual axes, broken axes and animated data transitions, refused until round 5, are built in round 6 at the owner's request, each safe by default and with its risk stated in its row (and, for the axes and 3D, as an `info` issue every time it is used; see [INTEGRATION.md](INTEGRATION.md#two-value-axes-broken-axes-and-indexed-series-read-the-risks-first)). The expression language stays refused: code in a spec is an injection risk, and it would need a second and third implementation in Go and Python, so columns are computed upstream. Network-style charts, Arrow input and drawing in a worker are open, not refused.
