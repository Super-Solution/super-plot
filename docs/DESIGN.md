# Super Plot design

Super Plot draws general statistical charts. Super Chart keeps financial time series (candles, drawing tools, indicators).
Both follow the Super Lib Kit habits: a language-neutral core, thin framework bindings, one theme vocabulary.

## Pipeline

```
spec (JSON) -> validatePlot -> chart.compile(ctx) -> Scene (flat marks, pixel space) -> renderer
                                                              |-> renderSvg (core, string)
                                                              |-> web mount (DOM, events): SVG, or canvas for dense charts
                                                              |-> drawScene (core, any 2D context) / your native renderer
```

- The **spec** is plain JSON: `{ type, data: rows, x, y, series, ... }`. Rows are objects (wide or long form).
- The **field DSL** (`packages/core/src/schema.ts`) is the only place a field is declared. Validation, JSON Schema,
  `docs/SPEC.md`, the agent catalog, tests and the gallery all read it, so they cannot disagree.
- A **chart** is a `ChartDef` (`type, name, summary, useWhen, fields, example, compile, describe`). Twelve are registered: bar, line, area, scatter, pie, donut, histogram, box, heatmap, radar, treemap, sankey.
- The **scene** is a serializable list of marks (rect, path, circle, line, text) with roles and tooltips. Renderers do not know about charts.

## The eight principles, and where they live

| # | Principle | How it is met |
|---|---|---|
| 1 | Agent friendly | `validatePlot` returns every problem at once, each with a stable `code`, a `path` and a `hint` (including "did you mean"). `describePlot` writes plain-language alt text (also the SVG `<desc>`). `chartCatalog()` says when to use each chart and gives a working example. `plotJsonSchema()` is generated. Five read-only tools in `core/tools` (`plot_catalog`, `plot_schema`, `plot_validate`, `plot_describe`, `plot_render_svg`) match Super Chat's `read` authority. |
| 2 | Multi-framework, multi-language | Core has no DOM. Web is a class plus a `<super-plot>` element (works in Vue, Svelte, Angular, plain HTML; one `global.js` for no bundler). React is a thin binding. The spec is JSON, with a JSON Schema (`schemas/`) and conformance data (`conformance/plot.v1.json`). **Go and Python ports exist** (`ports/`): they validate specs, write the plain-language description and compute the shared numbers, and are held identical to TypeScript by the conformance data and by differential fuzzing. Drawing stays in TypeScript, so a Go or Python service validates and describes and a browser (or Node) draws. A Rust port would be checked against the same data. |
| 3 | Clean, pluggable, low coupling | `registerChart(def)` adds a chart without touching the pipeline. Shared pieces (frame, cartesian layout, scales, ticks, formatters) are reused by charts, not inherited. Layering is enforced by `scripts/check-package.mjs`: core imports nothing, web imports core, react imports web. |
| 4 | Easy integration, good DX | One call per surface (`renderToSvg`, `new SuperPlot`, `<SuperPlot>`, `<super-plot>`). Wide and long data both work; dates and numbers are detected. Bad specs show an on-screen panel with the fix, not a blank box. Defaults are sensible (size follows the host, theme `auto`). |
| 5 | Rich features | Bar (grouped, stacked, normalized, horizontal, value labels), line and area (dates, stacking, smoothing, reference lines and bands, dense-data decimation), scatter (groups, bubbles, trend line), pie and donut (small slices merged into Other), histogram (auto bins, grouped overlay, mean line), box plot (outliers), heatmap, radar (several shapes on one scale), treemap (squarified, optional one-level groups), sankey (flows between stages, loops refused with the path of the loop). Tooltips, hover dimming, crosshair, legend toggle, keyboard access, annotations, PNG and SVG export, `prefers-reduced-motion`. |
| 6 | Beautiful default, easy to change | TradingView-aligned palette and neutrals, flat and quiet (thin grid, 4 px rounded bar ends, 2 px surface gaps). Three override levels, none needs a fork: CSS variables, a theme object, per-series `colors` in the spec. A colour-vision-safe preset ships too (`theme: 'accessible'` / `'accessible-dark'`: Okabe-Ito hues, blue and vermillion instead of green and red for up and down). See [THEMING.md](THEMING.md). |
| 7 | No useless wrappers | The React binding has no logic of its own. There is no `Chart` factory layer, no per-type component (`<BarChart>`): `type` is data. Public names are short (`SuperPlot`, `renderToSvg`, `validatePlot`). |
| 8 | Easy with Super Kit | Super Chat's `chart` card converts with `fromChatChartCard` (core/adapters); candlesticks are refused to Super Chart. Tools use the same shape as the other Super tool lists. Theme tokens can alias Super Chart's. See [INTEGRATION.md](INTEGRATION.md). |

### Integration method

- **Parallel abstraction**: a new chart type plugs in behind `ChartDef`; no existing chart changes.
- **Vertical composability**: the scene is the seam. Anything that produces or consumes a `Scene` (a dashboard, an exporter, an annotation layer) composes with every chart.
- **No wrapper on wrapper**: bindings call the web class directly; the web class calls core directly.
- **Docs, performance, security**: `docs/SPEC.md` is generated; see limits below; see Security.

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
- **SVG is comfortable to about 4,000 data marks; above that the web binding draws on canvas** (`renderer: 'auto'`, the default; force it with `renderer: 'svg' | 'canvas'`, tune with `canvasAbove`). Same scene, same tooltips, hover highlight, legend toggle, keyboard access (the legend stays real buttons) and PNG export. If a 2D context is not available it falls back to SVG.
- Measured in Chromium and Node on this container: a 50,000-point scatter compiles in about 90 ms and draws in a few milliseconds (points are batched into one path per colour); hover looks up marks in a 32 px grid index, not by scanning.
- The core canvas drawing (`drawScene`, `buildHitIndex`) takes any object shaped like a 2D context and has no DOM, so a worker with an `OffscreenCanvas` or a native canvas can use it.
- Exporting a 50,000-point scatter to SVG still makes a heavy file; core says so with a `many_marks` warning above 5,000 points. Aggregate or sample first.
- The row limit is 50,000; line series are decimated to min and max per pixel column.

## Known limits (honest list)

- In core, text width is estimated; the web binding measures with canvas. Server SVG can differ from browser layout by a few pixels.
- Time axes use UTC. No time zone option yet.
- One value axis. There is no dual-axis chart on purpose; Super Chat cards with right-axis series are converted without them and say so.
- No funnel or gauge: they overlap with Super Chat cards.
- Default palette: orange, yellow and cyan fall outside the lightness band the dataviz validator prefers. Kept to stay TradingView-aligned; values are in `PALETTE`. The `accessible` preset passes every validator check in light mode; three of its colours are under 3:1 contrast on white, so they lean on the legend and tooltips (identity is never colour alone).
- Registering all twelve charts happens on import of core (`sideEffects`), so there is no tree shaking per chart yet.
- The ports (Go, Python) do not draw, and format numbers in English only. A native renderer in another language is a separate project (see OPEN-DECISIONS).
- Visual regression is opt-in (`E2E_VISUAL=1`): baselines are PNGs from one Chromium build and fonts, so they are not part of the default gate.

## Testing

| Layer | What it proves | Run |
|---|---|---|
| Unit (vitest) | numbers, validation, every chart's scene, robustness against hostile specs, canvas drawing and hit index | `npm test` |
| Web (vitest + jsdom) | tooltip, hover, legend toggle and keyboard, resize, errors, export | `npm test` |
| Browser (Playwright, real Chromium) | the gallery in light and dark, clicks and hover on both renderers, responsive widths, no console errors, 50k-point canvas | `npm run test:e2e` |
| Visual regression (opt-in) | pixels of the gallery against stored baselines | `E2E_VISUAL=1 npm run test:e2e` (`E2E_VISUAL=update` to rewrite) |
| Conformance | generated data is current; each port replays it | `npm run conformance`, `npm run test:ports` |
| Differential fuzz | ~58,000 random numbers and 4,000 random specs per seed: ports against TypeScript | `npm run fuzz:ports` |

`npm run gate` runs everything except the visual baselines and the fuzz.
