# Super Plot design

Super Plot draws general statistical charts. Super Chart keeps financial time series (candles, drawing tools, indicators).
Both follow the Super Kit principles (`super-dev-docs/docs/03-super-kit-principles.md`, P1 to P37): a language-neutral core,
thin framework bindings, one theme vocabulary. This page says how Super Plot meets them; P-numbers refer to that page.

## Pipeline

```
spec (JSON) -> validatePlot (transform runs here) -> chart.compile(ctx) -> plugins.afterCompile -> Scene -> renderer -> plugins.afterDraw
                                                              |-> renderSvg (core, string)
                                                              |-> web mount (DOM, events): SVG, or canvas for dense charts
                                                              |-> drawScene (core, any 2D context) / your native renderer
```

- The **spec** is plain JSON: `{ type, data: rows, x, y, series, ... }`. Rows are objects (wide or long form).
- The **field DSL** (`packages/core/src/schema.ts`) is the only place a field is declared. Validation, JSON Schema,
  `docs/SPEC.md`, the agent catalog, tests and the gallery all read it, so they cannot disagree.
- A **chart** is a `ChartDef` (`type, name, summary, useWhen, fields, example, compile, describe`). 31 are registered (see `chartTypes()` and [SPEC.md](SPEC.md)): bar, line, area, scatter, pie, donut, histogram, box, violin, heatmap, calendar, waterfall, bullet, bump, timeline, radar, treemap, sunburst, sankey, parallel, funnel, waffle, beeswarm, gauge, wordcloud, scatter3d, surface, and the four maps.
- The **scene** is a serializable list of marks (rect, path, circle, line, text) with roles and tooltips, plus `axes` (the plot
  rectangle and each axis's kind, domain, pixel range and column) and `panels` for small multiples. Renderers do not know about
  charts; the web binding maps pointer pixels back to data through `axes` for zoom, pan and brush.
- **`transform`** turns raw rows into the rows the chart reads (filter, timeUnit, aggregate, sort, top, bin, window, fold, index; at most 10 steps; no expressions), inside
  validation, so every later column check sees the output columns and an agent can send raw data plus "monthly average".

## References and agent annotations

Text outside a plot (a chat message, a report) can point into it: `ref:sales?x=2026-03`. The design keeps every
layer generic, so nothing in core or web knows about chat:

- **The link** is the Super Protocol card-reference shell (`core/src/ref.ts`, Python `ref.py`, Go `ref.go`), a marked
  copy of protocol PR #6 checked against its own conformance cases (`conformance/card-ref.v1.json`, vendored, not
  generated). Core imports nothing, so the copy stays now that protocol 0.3.0 is published. The vocabulary (`key`, `x`, `y`, `series`) is Super Plot's.
- **Rows are the link between data and pixels.** Every data mark lists the rows it draws (`Mark.rows`, indexes into the
  transformed data): a bar summed from three rows lists three, a line every row of its series, a pie's "Other" the rows
  it merged. Charts set them where they know them; `fillRows` in `context.ts` fills the rest from the series column,
  so a chart that forgets cannot break references, only make them coarse. Each `ChartDef` says which fields a name
  reads (`RefShape`, exported into `fields.v1.json`), so the ports read the same columns with no chart code.
- **Resolving is data, not drawing**: `resolveRef(spec, ref)` (and `resolve_ref`, `ResolveRef`) answers with rows,
  points, series, keys and a label, or a stable code. The ports are held to it by conformance (`refCases`, 143 cases) and
  by the fuzzer (about 9,000 references per seed). `matchMarks(scene, match)` turns a match into marks for any
  renderer; `markRef` is the reverse, for `onRefChange`.
- **One overlay for every renderer.** The web binding draws the highlight as an `aria-hidden` SVG the size of the scene
  over whatever drew the chart, from scene geometry, so SVG, canvas and WebGL look the same and no renderer changed.
  It is redrawn after every draw (it survives resize, new data and legend toggles) and taken down while the GPU moves a
  map (it comes back with the redraw at the end of the gesture).
- **Generic calls, no chat wrapper**: `highlight(ref | null)`, `reveal(ref)`, `onRefChange`, `refTarget`. The chat side
  lives in its own package (`packages/integrations/chat-plugin`), which mounts the protocol's `super.plot` card, maps
  `enter`/`leave`/`activate` to those calls and adds the agent tools. Agent annotations are ordinary spec
  annotations with `by: "assistant"`, so they are validated, drawn, described and exported like the author's.

Accessibility: the highlight is a shape (outline over a halo, a dimmed surround), never colour alone; forced colours
use `Highlight` and `Canvas`; nothing animates; focus moves only on `reveal`; what matched is said in words (label,
tooltip, live region). Size: web `/base` grew 6.3 KB gzip with it (OPEN-DECISIONS).

## The eight principles, and where they live

| # | Principle | How it is met |
|---|---|---|
| 1 | Agent friendly | `validatePlot` returns every problem at once, each with a stable `code`, a `path` and a `hint` (including "did you mean"). `describePlot` writes plain-language alt text (also the SVG `<desc>`). `chartCatalog()` says when to use each chart and gives a working example. `plotJsonSchema()` is generated. `transform` lets an agent send raw rows and state the aggregation instead of computing it; each step is checked against the columns of the step before, with the same `code`/`path`/`hint` issues. A brush reports plain JSON whose `filters` drop straight into another spec's `transform`. Five read-only tools in `core/tools` (`plot_catalog`, `plot_schema`, `plot_validate`, `plot_describe`, `plot_render_svg`) match Super Chat's `read` authority. |
| 2 | Multi-framework, multi-language | Core has no DOM. Web is a class plus a `<super-plot>` element (works in Vue, Svelte, Angular, plain HTML; one `global.js` for no bundler). React is a thin binding. The spec is JSON, with a JSON Schema (`schemas/`) and conformance data (`conformance/plot.v1.json`). **Go and Python ports exist** (`ports/`): they validate specs, write the plain-language description and compute the shared numbers, and are held identical to TypeScript by the conformance data and by differential fuzzing. Drawing stays in TypeScript, so a Go or Python service validates and describes and a browser (or Node) draws. A Rust port would be checked against the same data. |
| 3 | Clean, pluggable, low coupling | `registerChart(def)` adds a chart without touching the pipeline. Shared pieces (frame, cartesian layout, scales, ticks, formatters) are reused by charts, not inherited. Layering is enforced by `scripts/check-package.mjs`: core imports nothing, web imports core, react imports web. Extension points: `registerChart`, `registerTheme`, `registerGeography`, and `plugins` (`afterCompile(scene)` may change the scene, `afterDraw({ scene, svg | ctx })` may draw on what was drawn; a throwing plugin becomes a `plugin_error` warning). Charts are tree-shakable: `@supersolutions/super-plot-core/base` plus the chart definitions you register from `/charts` (see INTEGRATION). |
| 4 | Easy integration, good DX | One call per surface (`renderToSvg`, `new SuperPlot`, `<SuperPlot>`, `<super-plot>`). Wide and long data both work; dates and numbers are detected. Bad specs show an on-screen panel with the fix, not a blank box. Defaults are sensible (size follows the host, theme `auto`). Events for what hosts ask first: `onHover`, `onRender`, `onZoom`, `onBrush`, `onSelect`; `appendRows(rows, { max })` for live data. |
| 5 | Rich features | Bar (grouped, stacked, normalized, horizontal, value labels), line and area (dates, stacking, smoothing, reference lines and bands, dense-data decimation), scatter (groups, bubbles, trend line), pie and donut (small slices merged into Other), histogram (auto bins, grouped overlay, mean line), box plot (outliers), heatmap, radar (several shapes on one scale), treemap (squarified, optional one-level groups), sankey (flows between stages, loops refused with the path of the loop). Lines over bars on the same axis (`line`), small multiples (`facet`, shared axes and legend, up to 12 panels), hexagon density for dense scatter (`density: "auto"` past 10,000 points, with a count legend and a warning that says so), data transforms, zoom and pan (`zoom`), interval brush (`brush`) with linked charts, live append. Tooltips, hover dimming, crosshair, legend toggle, keyboard access (SVG marks are focusable; on canvas the arrow keys step through marks with outline, tooltip and a spoken label), textures per series (`patterns`), a data table (`dataTable`), annotations, PNG and SVG export, `prefers-reduced-motion`. |
| 6 | Beautiful default, easy to change | The Super Solution design system's palette and neutrals (the TradingView look stays as the `tradingview` theme), flat and quiet (thin grid, 4 px rounded bar ends, 2 px surface gaps). Three override levels, none needs a fork: CSS variables, a theme object, per-series `colors` in the spec. A colour-vision-safe preset ships too (`theme: 'accessible'` / `'accessible-dark'`: Okabe-Ito hues, blue and vermillion instead of green and red for up and down). A `shadcn` theme reads shadcn/ui's own tokens (`--chart-1` to `--chart-5`, `--card`, `--foreground`, `--border`, ...), so a shadcn project gets matching charts with no configuration. See [THEMING.md](THEMING.md). |
| 7 | No useless wrappers | The React binding has no logic of its own. There is no `Chart` factory layer, no per-type component (`<BarChart>`): `type` is data. Public names are short (`SuperPlot`, `renderToSvg`, `validatePlot`). |
| 8 | Easy with Super Kit | The protocol's generic `super.plot` card is drawn by `@supersolutions/super-plot-chat-plugin`, which also answers `ref:` links in messages (`highlight`, `reveal`) and gives the agent read, highlight and annotate tools. Super Chat's older `chart` card converts with `fromChatChartCard` (core/adapters); candlesticks are refused to Super Chart. Tools use the same shape as the other Super tool lists. Theme tokens can alias Super Chart's. See [INTEGRATION.md](INTEGRATION.md). |

### Integration method (P9 to P16)

- **Abstract the need (P9)**: every addition in round 4 is a general field, event or hook (`zoom`, `brush`, `onHover`, `plugins`, `dataTable`), never an app-shaped option. The library names no product.

- **Parallel abstraction**: a new chart type plugs in behind `ChartDef`; no existing chart changes.
- **Vertical composability**: the scene is the seam. Anything that produces or consumes a `Scene` (a dashboard, an exporter, an annotation layer) composes with every chart.
- **No wrapper on wrapper**: bindings call the web class directly; the web class calls core directly.
- **Docs, performance, security (P24, P25)**: `docs/SPEC.md` is generated; numbers come from `scripts/bench.mjs` and `scripts/size.mjs`, with the misses; see limits below; see Security.
- **No default data, neutral on disputes (P22)**: no boundaries ship; examples generate their sample data in the page and say so.

## Borrowed from competitors (P27)

The competitor review of 2026-11-19 (`super-dev-docs/docs/60-reference/competitive-review-super-plot.md`) is folded in here. Each row is built, tested and documented in round 4.

| Feature in Super Plot | Borrowed from | How it was adapted |
|---|---|---|
| `transform`: filter, timeUnit, aggregate, sort, top | Vega-Lite transforms, ECharts datasets | Part of the JSON spec and of validation, so every step gets `code`/`path`/`hint` issues and the ports reproduce it |
| `zoom`, pan, `brush`; the selection is plain JSON with ready `filters` | Vega-Lite interval selections, uPlot, ECharts dataZoom | Two spec fields, no wrapper; keyboard operable (+, -, 0, Shift+arrows, `[` and `]`); linking is one line in `onBrush` |
| `onHover`, `onRender`, `afterCompile` and `afterDraw` plugins | Chart.js plugins, uPlot hooks, Recharts custom children | Hooks on the existing class and on `compilePlot`; a failing plugin is a warning, not a broken chart |
| Per-chart imports (`/base` + `/charts`) | Plotly partial bundles, visx modules | The package root still registers everything, so old code keeps working; validating one bar chart costs 21.9 KB gzip instead of 93.5 KB (round 5; 16.1 against 52.1 in round 4). Since the package split (2026-11-20): seven chart groups (`/charts/basic` ...), transform steps registered the same way (`/transforms`), and 23.9 KB for that bar chart |
| `patterns`, `dataTable`, keyboard steps through canvas marks | ECharts decals, Highcharts accessibility module (data table, keyboard), Recharts 3 keyboard defaults | The same scene feeds SVG, canvas and the table; the canvas path keeps every feature of the SVG path |
| `shadcn` theme on `--chart-1..5` | shadcn/ui charts | A registered theme, not a wrapper; maths and exports use the plain fallbacks |
| `facet` small multiples | Vega-Lite facet, Observable Plot `fx`/`fy` | Shared axes, colours and one legend; zoom and brush are refused with a warning rather than half-working |
| `appendRows(rows, { max })` | uPlot streaming | Ring buffer, one draw per frame; zoom, brush and hidden series stay |
| `density: "auto"` hexagons | Plotly `scattergl` / Highcharts Boost lesson | Announced with a warning code (`density_merges_series`), never silent; points stay points by default |
| `line` over bars | Vega-Lite layers | One field on the bar chart, on the same value axis (a second axis is the separate, opt-in `yRight`, round 6) |
| Fast dot path: pixels stamped instead of 50,000 arc paths | Highcharts Boost lesson ("a fast mode must not drop features") | Same marks, hover, legend and keyboard; only the rasterisation changes |

### Round 5: every competitor row decided

The second review covered 18 libraries and 62 capabilities from sources opened on 2026-11-19 ([COMPETITORS-2026-11-19.md](COMPETITORS-2026-11-19.md)). [COMPETITIVE.md](COMPETITIVE.md) gives, per row, what Super Plot does (built, refused with a reason, or open) and the defects found on the way. Per-feature design notes (borrowed from, how it fits the principles, limits, choices to revisit) are in [design-notes-0.4.0/](design-notes-0.4.0/): `wp1` waterfall, funnel, bullet, bump; `wp2` violin, calendar, sunburst, parallel, box points; `wp3` log scales, intervals, point annotations, gaps, loess, lollipop, bin/window/fold; `wp4` sync, tooltipFormat, CSV, toolbar, sonify, hydration, high contrast, Vue/Svelte/Angular; `wp6` waffle, beeswarm, colour-vision check; `wp7` timeline, stream graph, time zones, `strings`; `wp8` navigator, drill-down, live announcements, print, touch; `wp9` on-demand chunks (navigator, toolbar, map controls) and the size table; `ports` the Go and Python catch-up; `split` the package split (chart groups, registrable transform steps, canvas and projections on demand, per-module `dist`, size budgets).

The rules held in every row: a capability is a spec field (checked, schema-documented, ported) or a binding option/event, never a wrapper; maths that the ports must reproduce is a pure exported function with its algorithm in the doc comment (kde, loess, dodge, waffle cells, log ticks, bins); nothing random (jitter and sampling are index-based); every refusal is an issue with a code and a hint, not a silent drop; and no new runtime dependency.

### Round 6: the round-5 refusals, built safely

The owner overruled six round-5 refusals (2026-11-19) and kept one: the expression language stays out, because code in a spec is an injection risk and would need a second and third implementation in Go and Python; columns are computed before the spec is written. The other six were built with one rule each: **safe by default, switchable off, and the misleading risk stated plainly** in INTEGRATION.md and, where it helps, as an issue the agent sees every time. Notes per workstream: `r6-a1` gauge and word cloud, `r6-a2` dual and broken axes and the `index` step, `r6-b` scatter3d and surface, `r6-c` data transitions, `ports` (Round 6 section).

| Feature | Field or option | What keeps it honest |
|---|---|---|
| Gauge | `type: 'gauge'` (`value`, `max`, `target`, `bands`, `arc`) | Arc length is the value's share of `min`..`max` and always starts at `min`; out-of-range values are printed as they are and warned; a missing `max` is derived and warned; bands are named in text, not only by colour |
| Word cloud | `type: 'wordcloud'` (`text`, `value`, `series`, `rotate`) | Font size by the square root of the value; the description lists the top words with values in order; dropped and floored words are warned; the docs point to a sorted bar chart. Layout is the pure, integer-only `cloudLayout` |
| Non-map 3D | `type: 'scatter3d'`, `type: 'surface'`, `camera`, `projection` | Orthographic by default (`perspective` opt-in); `perspective_3d` info names the 2D chart that compares exactly; exact x, y, z in tooltips, description and table; no auto-rotation; keyboard turning. 3D bars refused |
| Dual y-axis | `yRight`, `yRightLabel`, `rightDomain`, `formatRight` | `dual_axis` info every time with a hint to `index` or two synced charts; axes coloured by their series; legend says "(right axis)"; bar zeros aligned |
| Line style per series | `dashes` (line chart): series name to `solid`, `dashed`, `dotted` or `dashdot` | Fixed presets, no free-form `stroke-dasharray` (a spec never reaches the attribute as text); the legend swatch of a styled series is a short stroke in the same style, so the difference does not rest on colour alone; validation `bad_dash` per entry |
| Upside-down value axis | `yReverse`, `rightReverse` (line chart) | Larger values lower, ticks still read smallest first; refused with `yBreak` (a cut would be read the wrong way round); `rightReverse` without `yRight` is a `right_axis_unused` warning |
| Line width per series | `widths` (line chart): series name to px, 0.5 to 8 | Unlisted series keep the theme width; an out-of-range or non-number entry is a `bad_width` error naming `widths.<series>`; markers and hit areas are unchanged |
| Curve per series | `curves` (line chart): series name to `linear`, `smooth` or `step` | Unlisted series use `curve`; a name outside the three is a `bad_enum` error naming `curves.<series>`; the first reusable "map of name to enum" field kind (`enumMap`) |
| Cut a line at given x values | `splitAt` (line and area): a list of x values | The point at or after each value starts a new piece; nothing is drawn across the cut, markers, tooltips and the legend are unchanged; a value outside the data cuts nothing. Works with `gaps`: `connect` joins over missing values but not over a cut |
| Marks only | `bare` (every cartesian chart): boolean | No axes, labels, grid, title, subtitle, legend or source, and a 4 px margin: the plot fills its box, which may be as small as 24 x 16 px. `title` and `description` still name the chart; the tooltip still works. The range is the data's unless `yDomain` says otherwise |
| Broken axis | `yBreak` | Same pixels per unit on both sides, a zigzag across the axis and every crossed bar; `axis_break` info; `break_misleading` error when the break would hide the comparison; hidden values counted |
| Indexed series | transform step `index` | The safer alternative to a second axis: every series as a share of its value at a base row |
| Data transitions | web `transition` option, off by default | Reduced motion re-checked every frame, at most 1,000 ms, skipped above 5,000 marks; tooltips, aria, table and exports show the new data from the first frame |

Issues gained an `info` severity for these notes (drawn as asked; read this). The ports reproduce the new charts, fields, issues and the `index` step, checked by conformance and the differential fuzzer.

## Conventions copied from the sibling libs

| Convention | Where it came from | In Super Plot |
|---|---|---|
| npm workspaces, `packages/core` + `packages/bindings/*` | Super Chart | same layout |
| Lockstep versions, exact pins (ADR 0013) | all Super repos | `scripts/packages.mjs` `VERSION`, checked at build |
| `scripts/check-package.mjs` layering and banned deps | Super Chart | same, plus "runs in plain Node" |
| `examples/` never published, `npm run examples` | Super Chart PR 31 | gallery, React, `<super-plot>` |
| `--sc-*` style CSS tokens with fallbacks | Super Chart | `--sp-*`, with `alias` to reuse `--sc-*` |
| Capability-tagged tools (`read`) | Super Chat | `plotTools` |
| Default is TradingView-like but overridable | Super Chart 0.3 | same palette and neutrals |

## Security

- Colours from a spec pass `isSafeColor` (hex, rgb, hsl, named, `var(--x)`; no `url()`, `;`, quotes, or `expression`). Bad ones become a warning plus the default.
- Every text goes through `escapeXml`; tooltips are written with `textContent`. No `innerHTML` with data, no `eval`.
- Caps: 50,000 rows, string lengths, annotation count. Over-limit specs fail validation with a clear code.
- Tools are read-only and never fetch URLs.

## Performance

- Line series with many points are decimated to min and max per pixel column (a 730-point series keeps its shape, a 100k-point one stays cheap).
- Hover uses at most about 400 hit strips for line charts, not one per point.
- **SVG is comfortable to about 4,000 data marks; above that the web binding draws on canvas** (`renderer: 'auto'`, the default; force it with `renderer: 'svg' | 'canvas' | 'webgl'`, tune with `canvasAbove`). Same scene, same tooltips, hover highlight, legend toggle, keyboard access (the legend stays real buttons) and PNG export. If a 2D context is not available it falls back to SVG.
- **WebGL2** takes over dense dots (above `webglAbove`, default 20,000) and 3D maps when the device has a hardware GPU: instanced quads with a signed-distance edge for dots, a depth-buffered mesh for maps (see [MAPS.md](MAPS.md)). Text, axes and legend stay on 2D canvases above and below it. It is a lazily loaded chunk, one context per plot for its life, at most 8 per page; `renderer: 'webgl'` without WebGL, or a lost context, falls back to canvas. Measured on this container, which has no GPU (Chromium falls back to the SwiftShader software rasteriser): the JavaScript side of a 50,000-dot redraw is faster on WebGL (112 ms against 178 ms on canvas), but the first frame as a whole is much slower (about 2.5 s against 0.45 s) because software rasterises the GPU work. That is why `auto` never picks WebGL on a software rasteriser. Speed on a real GPU has not been measured here: run `npm run examples` and open `/canvas/` (WebGL button) or `scripts/bench.mjs` on a machine with one.
- **Density-adaptive dots**: past 2,000 points a scatter draws smaller dots without the surface ring, so the cloud stays readable and cheap.
- **Fast dot path (round 4)**: runs of 500 or more plain dots are stamped straight into pixels (one anti-aliased coverage pass, then one image draw) instead of building and filling 50,000 arcs. Measured on this container (headless Chromium, 4 vCPU, no GPU), 50,000-point scatter on canvas (`scripts/bench.mjs`, medians): mount 627 ms -> 207 ms, first frame 1,259 ms -> 445 ms, resize redraw 590 ms -> 178 ms; 10,000 points: first frame 230 ms -> 104 ms. What is left is mostly compiling the scene (about 100 ms in Node). Lines and histograms did not change (within noise; line canvas redraw at 10,000 rows measured 19 -> 39 ms in this run, under 50 ms either way). SVG at 50,000 dots is still slow (first frame 1.2 s): that is why `auto` switches to canvas above 4,000 marks. Hover looks up marks in a 32 px grid index, not by scanning.
- **Bundle size** (`npm run size`, `scripts/bench.mjs`, package-name imports, minified + gzip): everything, round 3 -> round 4: `validatePlot` 46.0 -> 52.1 KB, `renderToSvg` 49.6 -> 57.9 KB, the browser binding 71.4 -> 87.5 KB (single file with the WebGL chunk inlined). The new features cost 6 to 16 KB; the per-chart path more than pays it back (validating a bar chart: 16.1 KB). Correction: the round-3 report quoted 29.7 KB for the validator; that script imported by relative path, which made esbuild drop the chart registrations, so it undercounted. The bench now imports by package name, as an app does.
- **Bundle size, round 4 -> round 5** (`npm run size`: package-name imports, esbuild minified + gzip, the entry and what it imports statically; chunks loaded on demand left out; both trees measured with the same script, so the round-4 column differs by 0.1 KB from the figures quoted at the time). "round 5 as merged" is the round-5 tree before the web binding's opt-in parts were split off.

  | import | round 4 | round 5 as merged | round 5 |
  |---|---|---|---|
  | `/base` + bar, `validatePlot` | 16.2 KB | 21.9 KB | 21.9 KB |
  | `/base` + bar, `renderToSvg` | 23.1 KB | 32.8 KB | 32.8 KB |
  | everything, `validatePlot` | 52.2 KB | 93.5 KB | 93.5 KB |
  | everything, `renderToSvg` | 58.0 KB | 102.0 KB | 102.0 KB |
  | web `/base` + bar + line | 45.7 KB | 70.0 KB | 66.8 KB |
  | web, everything | 75.6 KB | 131.8 KB | 128.3 KB |

  A miss, measured and published: the opt-in web features of round 5 were static code, so every page paid for them. Now the navigator (8.3 KB minified), the toolbar (1.5 KB) and the map controls (4.5 KB) are chunks fetched on first use, like the WebGL layer; `plot.ready()` waits for them. That recovers 3.2 KB gzip of the 24.3 KB the browser path grew. What still grew, and why: core validation is paid by every user of a chart, and it carries the new transform steps (`bin`, `window`, `fold`: transform.ts 8.5 -> 14.5 KB minified), the new fields in the schema (+3 KB), the bar chart's new options (+3 KB), the localisable English UI strings (4.3 KB), date handling (+1.4 KB) and the colour-vision check (2.6 KB; it only runs when the spec sets `colors`, but core is synchronous, so its maths cannot be loaded later). "Everything" adds eleven chart types (violin, calendar, waterfall, bullet, bump, timeline, sunburst, parallel, funnel, waffle, beeswarm); use `/base` and register what you draw. The web binding's static code is still 23.6 KB minified larger than in round 4: plot.ts +11 KB (live-data announcements, drill-down, sync, touch, print, the data table, `tooltipFormat`), sonification 3.1 KB, sync 1.6 KB, canvas and zoom +3.3 KB, and the stylesheet doubled to 8.7 KB. Not split, with reasons: sonification (its bulk is the note plan, a public `/base` export: esbuild puts a file reached both statically and from a chunk into the static bundle, so splitting only the playback saved 0.8 KB and cost as much in plot.ts); drill-down (on by default for treemap and sunburst, about 1 KB, answers clicks synchronously); the canvas renderer (13.5 KB, the largest left: it is picked automatically above 4,000 marks, so a chunk would mean a blank or SVG first frame for big charts, a visible change left to the owner; split in the package split of 2026-11-20, see below) and the zoom and brush gestures (an estimated 7 KB, but `getZoom`, `setZoom` and the view used by every draw are synchronous API; they would have to be split from the gestures). Code a chunk imports from core (`makeView` for the map controls and WebGL) stays in the static bundle for the same esbuild reason (until the package split moved it to core `/view`).
- **Bundle size after the package split** (owner, 2026-11-20: three packages, modular inside; `npm run size`, measured on the built packages; budgets in `scripts/size.mjs`, checked by `npm run gate`). Chart groups (`/charts/basic` and six more), transform steps registered like charts (`/transforms`), the canvas renderer and the map/3D projections out of `/base` (core `/canvas` and `/view`; in the web binding the canvas renderer is a chunk), and a dist of one file per module. "Before" is the PR head before the split, measured on the sources (what the script then measured; see the correction below).

  | import (KB gzip) | before | after |
  |---|---|---|
  | core `/base`, `renderToSvg`, no chart | 25.1 | 19.9 |
  | core `/base` + bar, `validatePlot` | 28.9 | 23.9 |
  | core `/base` + bar, `renderToSvg` | 39.5 | 34.4 |
  | core `/base` + the nine basic charts | 59.0 | 54.2 |
  | core, everything | 123.5 | 124.9 |
  | web `/base`, no chart | 52.8 | 40.3 |
  | web `/base` + bar + line | 76.0 | 63.3 |
  | web `/base` + the nine basic charts | 88.2 | 75.8 |
  | web, everything | 150.5 | 147.8 |

  Correction, measured and published: `scripts/size.mjs` resolved the packages through the checkout's tsconfig `paths`, that is the sources, while the published `dist` was a bundle per entry with shared chunks. Inside a file it keeps, a bundler drops only the statements it can prove free of side effects, and the chart objects (built with object spreads and calls) are not, so an app importing the old `dist` got every chart that shared a chunk with `/base`, far more than the table said: core `/base` 72.9 KB instead of 25.1, web `/base` 99.1 instead of 52.8, web `/base` + bar + line 133.7 instead of 76.0. The build now writes one file per source module (what the sources looked like to the script), and `npm run size` measures the built packages. "Everything" grew 1.4 KB: the steps as objects, the group arrays and the registries. Still static in web `/base`, with reasons: sound (1.6 KB gzip: `sonify()` returns its notes at once), the zoom and brush gestures, the stylesheet, the colour-vision check (see wp9).
- The core canvas drawing (`drawScene`, `buildHitIndex`) takes any object shaped like a 2D context and has no DOM, so a worker with an `OffscreenCanvas` or a native canvas can use it.
- Exporting a 50,000-point scatter to SVG still makes a heavy file; core says so with a `many_marks` warning above 5,000 points. Aggregate or sample first.
- The row limit is 50,000 (a validation contract shared with the ports); WebGL could draw far more, but raising the cap is a separate decision. Line series are decimated to min and max per pixel column.

## Known limits (honest list)

- In core, text width is estimated; the web binding measures with canvas. Server SVG can differ from browser layout by a few pixels.
- With `/base`, a chart type or transform step that was not registered is an error (`unknown_type`, `transform_not_registered`), never skipped; the package roots register everything. The canvas renderer is a chunk: the first canvas chart on a page is drawn a moment after the constructor returns (`ready()`); until then the plot keeps what it showed.
- Time axes default to UTC; the `timeZone` render option moves ticks and labels to a local zone (DST-aware). Data are read as instants: an ISO string without an offset is UTC.
- A second value axis (`yRight`) and a broken axis (`yBreak`) exist since round 6, each with an `info` issue stating its risk every time (see INTEGRATION). Super Chat cards with right-axis series are still converted without them, with a note (`fromChatChartCard` was not changed).
- No expression language, no 3D bars, no pictorial bars: see [COMPETITIVE.md](COMPETITIVE.md) for each refusal and its reason. Gauge, word cloud, non-map 3D, dual and broken axes and data transitions exist since round 6, each with its risk stated (see INTEGRATION).
- 3D is drawn on canvas with painter's order (no depth buffer): tiles of a steep surface can overlap wrongly at some angles. WebGL draws only the scatter's points. Keyboard users step through every point before Tab leaves a 3D chart, as on other SVG charts.
- Network graphs, chord diagrams, Arrow input and drawing in a worker are open, not refused (OPEN-DECISIONS).
- Default palette: orange, yellow and cyan fall outside the lightness band the dataviz validator prefers. Kept to stay TradingView-aligned; values are in `PALETTE`. The `accessible` preset passes every validator check in light mode; three of its colours are under 3:1 contrast on white, so they lean on the legend and tooltips (identity is never colour alone).
- Zoom and brush work on cartesian charts without `facet`. A category axis can be brushed, not zoomed. A brush's `filters` use the transform's range rule (from inclusive, to exclusive), so a row exactly on the right edge is left out.
- `appendRows` coalesces to one draw per frame but recompiles the whole scene; there is no incremental layout.
- `dataTable` lists at most 1,000 rows (the caption says when more exist).
- Hexagon density merges series into one count (a warning says so).
- Maps: no boundaries ship, by design; no basemap tiles, labels or roads (this is a statistical map, not a slippy map). Static SVG/canvas maps recompile on every camera move, which gets slow for very detailed geographies: use WebGL (or simplify the file). On SVG, tall raised regions can overlap imperfectly at extreme tilts (painter's order per region); WebGL uses a depth buffer.
- The ports (Go, Python) do not draw, and format numbers in English only. A native renderer in another language is a separate project (see OPEN-DECISIONS).
- References: a line that draws more rows than matched is not outlined; its matched points are ringed only where the chart has hover columns (line, area), elsewhere the whole line is outlined. At most 2,000 marks are outlined. The outline of a text mark is its estimated box. `reveal` resets zoom rather than panning to the match, and puts a map back to its own view rather than flying to it.
- Visual regression is opt-in (`E2E_VISUAL=1`): baselines are PNGs from one Chromium build and fonts, so they are not part of the default gate.

## Testing

| Layer | What it proves | Run |
|---|---|---|
| Unit (vitest) | numbers, validation, every chart's scene, robustness against hostile specs, canvas drawing and hit index | `npm test` |
| Web (vitest + jsdom) | tooltip, hover, legend toggle and keyboard, resize, errors, export | `npm test` |
| Plugin (vitest + jsdom) | the chat plugin: the card against the protocol's 64 conformance cases, the handle's `ref`, every tool and its errors, remounts | `npm test` |
| Browser (Playwright, real Chromium) | references (links in the chat demo highlight and reveal on SVG and canvas, the outline on the bar it names, keyboard, Escape, forced colours, no animation, WebGL, reveal out of a zoom), the features page (brush linking two charts, Ctrl-wheel zoom and double-click reset on SVG and canvas, canvas keyboard steps with tooltip and spoken label, live data, data table), the gallery in light and dark, clicks and hover on every renderer, responsive widths, no console errors, 50k points on canvas and WebGL, WebGL maps against SVG pixels, GPU picking, drag, context-loss fallback, importing a boundary file | `npm run test:e2e` |
| Visual regression (opt-in) | pixels of the gallery against stored baselines | `E2E_VISUAL=1 npm run test:e2e` (`E2E_VISUAL=update` to rewrite) |
| Conformance | generated data is current; each port replays it | `npm run conformance`, `npm run test:ports` |
| Differential fuzz | ~64,000 random numbers and 5,000 random specs per seed (about 45% with a transform), plus timeUnit buckets: ports against TypeScript | `npm run fuzz:ports` |

`npm run gate` runs everything except the visual baselines and the fuzz.
