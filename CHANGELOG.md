# Changelog

All four npm packages (`@supersolutions/super-plot-core`, `-web`, `-react`, `-chat-plugin`) share one version.

## Unreleased

### Added

- `dashes` on line charts: series name to `solid`, `dashed`, `dotted` or `dashdot`. The legend swatch follows the style. Validation, JSON Schema, the Python and Go ports and conformance cases are in step.
- `yReverse` and `rightReverse` on line charts: draw a value axis upside down. Refused together with `yBreak`.
- `widths` on line charts: series name to line width in px (0.5 to 8).

## 0.1.0

The first published version. The local milestones before it (numbered 0.1.0 to 0.4.0 at the time, never published)
are called rounds 1 to 6 in the docs; see the History table in the README.

### Added

- 31 chart types and maps from one JSON spec: validation with coded issues, a serializable scene, SVG, canvas and
  WebGL rendering, a plain-language description and a JSON Schema (`docs/SPEC.md`).
- Packages: `super-plot-core` (no DOM), `super-plot-web` (`SuperPlot` class and the `<super-plot>` element),
  `super-plot-react`, and `super-plot-chat-plugin` (the super-protocol `super.plot` card and six agent tools).
- Per-chart imports: `/base` plus chart groups (`/charts/basic`, `business`, `stats`, `maps`, `hierarchy`, `3d`,
  `text`) and registrable transform steps (`/transforms`); the canvas renderer loads on demand.
- Card references (`ref:<card>?x=...`), `resolveRef`, `plot.highlight()` / `plot.reveal()` and agent annotations.
- Default theme from the Super Solution design system (violet-led series palette, own dark steps, `accent` for
  assistant annotations); the TradingView look stays as the `tradingview` / `tradingview-dark` themes.

### Requirements

- Node >= 22. React binding: React 18 or 19 as a peer. The chat plugin pins `@supersolutions/super-protocol` 0.3.0.

### Licence

- Apache-2.0, © SUPER SOLUTION LABS INC.
