# Super Plot: map for coding agents

Read `docs/DESIGN.md` first. Then:

| To do this | Change this | Also |
|---|---|---|
| Add a chart type | new `packages/core/src/charts/<name>.ts` exporting a `ChartDef`; export it from `packages/core/src/charts.ts` and add it to `allCharts` (the package root registers those) | add a gallery spec in `examples/_shared/specs.ts`; `npm run docs:spec && npm run conformance` |
| Add or change a field | the chart's `fields` (single field DSL in `schema.ts`) | validation, JSON Schema, docs and catalog follow automatically |
| Change colours or metrics | `packages/core/src/theme.ts` | keep `docs/THEMING.md` in step; colours are emitted as `var(--sp-*, fallback)` |
| Change hover, tooltip, legend | `packages/bindings/web/src/plot.ts` (SVG) and `packages/bindings/web/src/canvas.ts` (canvas) | jsdom tests in `tests/web`; real-browser tests in `tests/e2e` (`npm run test:e2e`) |
| Change maps (geography import, projections, camera) | `packages/core/src/geo/` and `packages/core/src/charts/maps.ts`; the viewer's camera controls in `packages/bindings/web/src/map-control.ts` | `docs/MAPS.md`; `tests/core/geo.test.ts`, `tests/core/maps.test.ts`; keep the GLSL in `packages/bindings/web/src/gl/map.ts` in step with `project()` in `geo/view.ts` |
| Change the WebGL renderer | `packages/bindings/web/src/gl/` | `tests/e2e/maps.e2e.ts` (real Chromium); jsdom has no WebGL |
| Change how a chart is drawn on canvas | `packages/core/src/canvas.ts` (`drawScene`, `buildHitIndex`, `drawHover`) | `tests/core/canvas.test.ts`; the e2e canvas page |
| Change validation, descriptions or number formats | the TypeScript source first, then `npm run build && npm run conformance` | port cross-field checks and descriptions to `ports/python/src/super_plot/charts.py` and `ports/go/superplot/charts.go`; `npm run test:ports`, `npm run fuzz:ports` |
| Change transforms | `packages/core/src/transform.ts` | port to both `ports/`; conformance cases in `scripts/export-conformance.mjs` |
| Change zoom, pan, brush | `packages/bindings/web/src/interact.ts` (pure helpers + `AxisControl`); `scene.axes` comes from `cartesian.ts` and `compile.ts` | `tests/web/interact.test.ts`, `tests/e2e/features.e2e.ts` |
| Change the fast dot path | `packages/bindings/web/src/stamp.ts` (called through `drawScene`'s `dots` hook) | `tests/web/interact.test.ts`; bench with `scripts/bench.mjs` |
| Change textures, data table, plugins | `packages/core/src/patterns.ts`, `table.ts`, `compile.ts` (`PlotPlugin`) | keep SVG (`svg.ts`) and canvas (`canvas.ts`) in step |
| Add maths the ports must match (densities, fits, layouts, apportionment) | a pure exported function with the exact algorithm in its doc comment (`kde`, `loess`, `dodge`, `waffleCells`, `logTicks`) | a conformance section in `scripts/export-conformance.mjs`; port it with the same operation order |
| Change sync, toolbar, navigator, drill-down, sound, CSV | `packages/bindings/web/src/sync.ts`, `plot.ts`, `sound.ts`, `toolbar.ts`, `navigator.ts` (what is needed before it loads: `navigable.ts`); CSV in core `table.ts` (`plotCsv`) | user-visible text goes through `strings` (`packages/core/src/strings.ts`), never a literal. `toolbar.ts`, `navigator.ts`, `map-control.ts` and `gl/` are chunks loaded on demand (`chunk()` in `plot.ts`): import only types from them statically, or they land in every bundle (`npm run size`); tests wait with `await plot.ready()` |
| Add user-visible text | a key in `DEFAULT_STRINGS` (`packages/core/src/strings.ts`), read with `c.t(key)` (core) or `this.t(key)` (web) | INTEGRATION.md lists the keys |
| Decide whether to copy a competitor feature | `docs/COMPETITIVE.md` (built / refused / open, with reasons) | sources in `docs/COMPETITORS-<date>.md`; method in super-dev-docs `docs/30-runbooks/competitive-review.md` |
| Add a framework binding | new `packages/bindings/<name>` that calls `SuperPlot` from web | add it to `scripts/packages.mjs`; no logic of its own |

Never edit `conformance/*.json`, `ports/*/**/fields.v1.json` or `docs/SPEC.md` by hand: they are generated (`npm run conformance`, `npm run docs:spec`).

Rules (enforced by `npm run build`, which runs `scripts/check-package.mjs`):

- `core` imports nothing and never touches the DOM. `web` imports only `core` and `earcut` (inside the lazily loaded WebGL chunk, `src/gl/`). `react` imports only `web` and `react`.
- Lockstep versions, exact pins. No charting dependencies.
- Never print or embed secrets. Colours from specs go through `isSafeColor`; text through `escapeXml`; tooltips use `textContent`.
- Do not add wrappers around `SuperPlot`: bindings pass props through.
- Bindings and web code import core through `@supersolutions/super-plot-core/base`, never the package root (that would pull every chart into `/base` users' bundles). Entry files that register charts are listed in each `package.json` `sideEffects`; `npm run size` shows the result.
- Follow the Super Kit principles (`super-dev-docs/docs/03-super-kit-principles.md`): general fields, events and hooks, never app-shaped options; a new feature updates DESIGN, the examples and the tests in the same change.
- Gate before saying done: `npm run gate`.
