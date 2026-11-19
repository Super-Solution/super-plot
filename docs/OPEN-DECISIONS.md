# Decisions

## Settled

- **Name: Super Plot** (owner, 2026-11-19). Used everywhere (`@supersolutions/super-plot-*`, `--sp-*`, `<super-plot>`).
- **Palette.** The default stays the TradingView set. A colour-vision-safe preset is added next to it (`accessible`, `accessible-dark`), so nobody has to choose.
- **Shared theme package: not now.** "Alias" means each library keeps its own tokens (`--sp-*`, `--sc-*`) and Super Plot reads Super Chart's as a fallback (`createTheme('light', { alias: { text: ['--sc-text'] } })`), so a page that themes Super Chart already themes Super Plot. A shared `super-theme` package would replace the aliases with one source of tokens; build it when a third library needs the same tokens.
- **Canvas renderer, radar, treemap, sankey, browser tests, Go and Python ports**: built (see DESIGN and `ports/`).

## Recommended, waiting for the owner

- **Super Chat card (long term).** The cleaner route is one generic card in `super-protocol`, `plot`, whose payload is `{ spec, alt }`: the spec is the contract, so a new chart type never changes the protocol, and the same card works for any renderer. Until it exists, `fromChatChartCard` converts today's built-in `chart` card. A per-chart card kind (`super-plot.chart`) would put a chart list into the protocol and is the less clean option. Adding the card changes a shared contract, so it needs the owner's go.

## Open

1. **Licence and publishing.** Packages are `private` with `UNLICENSED`; the Go module path and the Python distribution name are placeholders. Nothing is pushed or published.
2. **A native renderer in Go or Python?** The ports validate, describe and compute; they do not draw. Drawing in a second language means porting the layout of all twelve charts (about 3,500 lines of TypeScript, plus text measurement, which differs per language) and keeping pixels close, not identical. Worth it only if a backend must produce SVG or PNG without Node. The scene is already a flat JSON structure, so the cheaper alternative is to run the TypeScript renderer where Node is available.
3. **Rust.** The Rust core is closed per strategy; a Rust port would be a separate decision and would check against the same conformance data.
4. **Chat plugin package** like Super Chart's (follows the card decision).
5. **More chart types.** Funnel and gauge overlap with Super Chat cards; add only if a use case asks.
6. **Vue and Svelte bindings.** The web component already covers them; add native ones only if DX asks for it.
7. **Tree-shakable chart registration** (import only the charts you use).
8. **Docs home.** A page and an ADR for Super Plot in `super-dev-docs` (not in this session's scope).
