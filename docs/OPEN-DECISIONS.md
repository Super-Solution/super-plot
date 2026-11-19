# Decisions

## Settled

- **Name: Super Plot** (owner, 2026-11-19). Used everywhere (`@supersolutions/super-plot-*`, `--sp-*`, `<super-plot>`).
- **Palette.** The default stays the TradingView set. A colour-vision-safe preset is added next to it (`accessible`, `accessible-dark`), so nobody has to choose.
- **Shared theme package: not now.** "Alias" means each library keeps its own tokens (`--sp-*`, `--sc-*`) and Super Plot reads Super Chart's as a fallback (`createTheme('light', { alias: { text: ['--sc-text'] } })`), so a page that themes Super Chart already themes Super Plot. A shared `super-theme` package would replace the aliases with one source of tokens; build it when a third library needs the same tokens.
- **Canvas renderer, radar, treemap, sankey, browser tests, Go and Python ports**: built (see DESIGN and `ports/`).
- **WebGL and 3D maps** (owner, 2026-11-19: "一步到位 ... 做到 P3"): built inside the existing packages (no new package names), existing specs and APIs unchanged. **No default boundaries ship**: users import their own; presets are templates only; disputed areas are drawn like any other region unless the spec says `dashed` or `muted` (see MAPS.md).
- **Competitor features (owner, 2026-11-19: "也把你整理出來的特點也加入進來")**: built in 0.3.0, see DESIGN "Borrowed from competitors": transform, zoom/pan/brush with JSON selections, hover/render events and plugins, per-chart imports, patterns, data table, canvas keyboard steps, shadcn theme, small multiples, live append, hexagon density, lines over bars, the fast dot path. Still local only.
- **Tree-shakable chart registration**: built (`/base` + `/charts`); the package roots still register everything.
- **One new runtime dependency** in `super-plot-web`: `earcut` (ISC, about 3 KB, polygon triangulation for WebGL maps), loaded only with the WebGL chunk.

## Recommended, waiting for the owner

- **Super Chat card (long term).** The cleaner route is one generic card in `super-protocol`, `plot`, whose payload is `{ spec, alt }`: the spec is the contract, so a new chart type never changes the protocol, and the same card works for any renderer. Until it exists, `fromChatChartCard` converts today's built-in `chart` card. A per-chart card kind (`super-plot.chart`) would put a chart list into the protocol and is the less clean option. Adding the card changes a shared contract, so it needs the owner's go.

## Open

1. **Licence and publishing.** Packages are `private` with `UNLICENSED`; the Go module path and the Python distribution name are placeholders. Nothing is pushed or published.
2. **A native renderer in Go or Python?** The ports validate, describe and compute; they do not draw. Drawing in a second language means porting the layout of all 28 chart types (about 3,500 lines of TypeScript, plus text measurement, which differs per language) and keeping pixels close, not identical. Worth it only if a backend must produce SVG or PNG without Node. The scene is already a flat JSON structure, so the cheaper alternative is to run the TypeScript renderer where Node is available.
3. **Rust.** The Rust core is closed per strategy; a Rust port would be a separate decision and would check against the same conformance data.
4. **Chat plugin package** like Super Chart's (follows the card decision).
5. **More chart types.** Round 5 added 12 (waterfall, funnel, bullet, bump, violin, calendar, sunburst, parallel, waffle, beeswarm, timeline, stream graph via `stack: 'center'`). Still open: network graph, chord, arc, venn, marimekko (layout must be made deterministic; hard to read). Refused with reasons in COMPETITIVE.md: gauge, word cloud, pictorial bars, non-map 3D.
6. **Vue, Svelte, Angular bindings.** Settled for now: the element is documented and tested for all three (properties, events); native packages only if DX asks.
7. **Declared linking between charts.** The page-level part is built: `sync` (hover, zoom, brush across plots sharing a key). Still open: a selection named in one spec and used as a `transform` filter in another, without host code.
8. **Raise the 50,000-row cap?** WebGL can draw several hundred thousand dots, but the cap is part of the validation contract (ports, conformance). Keep or raise per chart type.
9. **Basemap tiles or labels** (place names, roads) are out of scope for a statistical map; add only on demand, and never from a proprietary provider by default.
10. **Docs home.** The Super Kit principles now live in `super-dev-docs` (PR #7, from another thread); a Super Plot page in its `10-architecture` follows once the library is pushed.
11. **Row cap for the data table** (1,000) and the hexagon threshold (10,000 points): proposals, easy to change.
12. **Drawing in a worker** (`OffscreenCanvas`, Chart.js): a host can already pass any 2D context to `drawScene`; building it into the binding needs the scene on both threads for hover and keyboard. Worth it only if a page measures main-thread jank on big charts.
13. **Arrow / columnar input** (deck.gl): would add a dependency or a second data shape; rows stay the contract unless a use case needs millions of rows.
14. **Hydration in React.** `renderToSvg(spec, { hydrate: true })` is adopted by the web binding; React's `<SuperPlot>` still renders an empty div on the server. Server components would need the React binding to render the SVG string itself.
15. **Round-5 choices to confirm** (each has its reason in `docs/design-notes-0.4.0/`): gauge left out; funnel drawn as centred bars (no trapezoid); waffle uses `label` like pie; `fold` drops the folded columns (Vega-Lite keeps them); window `rank` is competition rank (1, 2, 2, 4); loess without robustness passes; box `outliers` kept next to the new `points` (deprecate later?); the colour check warns only for user `colors` (the theme's "Other" grey is close to cyan in the default palette, 5.8); the toolbar's sound button only when listed; `announce` speaks only while the chart has focus or shows a table.
