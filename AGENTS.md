# Super Plot: map for coding agents

Read `docs/DESIGN.md` first. Then:

| To do this | Change this | Also |
|---|---|---|
| Add a chart type | new `packages/core/src/charts/<name>.ts` exporting a `ChartDef`, register it in `packages/core/src/index.ts` | add a gallery spec in `examples/_shared/specs.ts`; `npm run docs:spec && npm run conformance` |
| Add or change a field | the chart's `fields` (single field DSL in `schema.ts`) | validation, JSON Schema, docs and catalog follow automatically |
| Change colours or metrics | `packages/core/src/theme.ts` | keep `docs/THEMING.md` in step; colours are emitted as `var(--sp-*, fallback)` |
| Change hover, tooltip, legend | `packages/bindings/web/src/plot.ts` (SVG) and `packages/bindings/web/src/canvas.ts` (canvas) | jsdom tests in `tests/web`; real-browser tests in `tests/e2e` (`npm run test:e2e`) |
| Change maps (geography import, projections, camera) | `packages/core/src/geo/` and `packages/core/src/charts/maps.ts` | `docs/MAPS.md`; `tests/core/geo.test.ts`, `tests/core/maps.test.ts`; keep the GLSL in `packages/bindings/web/src/gl/map.ts` in step with `project()` in `geo/view.ts` |
| Change the WebGL renderer | `packages/bindings/web/src/gl/` | `tests/e2e/maps.e2e.ts` (real Chromium); jsdom has no WebGL |
| Change how a chart is drawn on canvas | `packages/core/src/canvas.ts` (`drawScene`, `buildHitIndex`, `drawHover`) | `tests/core/canvas.test.ts`; the e2e canvas page |
| Change validation, descriptions or number formats | the TypeScript source first, then `npm run build && npm run conformance` | port cross-field checks and descriptions to `ports/python/src/super_plot/charts.py` and `ports/go/superplot/charts.go`; `npm run test:ports`, `npm run fuzz:ports` |
| Add a framework binding | new `packages/bindings/<name>` that calls `SuperPlot` from web | add it to `scripts/packages.mjs`; no logic of its own |

Never edit `conformance/*.json`, `ports/*/**/fields.v1.json` or `docs/SPEC.md` by hand: they are generated (`npm run conformance`, `npm run docs:spec`).

Rules (enforced by `npm run build`, which runs `scripts/check-package.mjs`):

- `core` imports nothing and never touches the DOM. `web` imports only `core` and `earcut` (inside the lazily loaded WebGL chunk, `src/gl/`). `react` imports only `web` and `react`.
- Lockstep versions, exact pins. No charting dependencies.
- Never print or embed secrets. Colours from specs go through `isSafeColor`; text through `escapeXml`; tooltips use `textContent`.
- Do not add wrappers around `SuperPlot`: bindings pass props through.
- Gate before saying done: `npm run gate`.
