# Changelog

All four npm packages (`@supersolutions/super-plot-core`, `-web`, `-react`, `-chat-plugin`) share one version.

## 0.4.0 (2026-11-20)

### Added

- `notes` on line and area charts: series name to the name of a text column. That row's text is added to the series' tooltip line at its x, or stands in for the value where it is missing (a reason a figure is not given).

## 0.3.0 (2026-11-20)

### Added

- `splits` on line and area charts: series name to a list of x values at which only that series is cut (a series break), alongside `splitAt` which cuts every series.

## 0.2.0 (2026-11-20)

### Added

- `dashes` on line charts: series name to `solid`, `dashed`, `dotted` or `dashdot`. The legend swatch follows the style. Validation, JSON Schema, the Python and Go ports and conformance cases are in step.
- `yReverse` and `rightReverse` on line charts: draw a value axis upside down. Refused together with `yBreak`.
- `widths` on line charts: series name to line width in px (0.5 to 8).
- `curves` on line charts: series name to `linear`, `smooth` or `step`, overriding `curve` for that series.
- `splitAt` on line and area charts: x values at which lines are cut, so nothing is drawn across a change of definition.
- `bare` on cartesian charts: marks only, no axes, labels, title or legend, so a chart can be a small trend in a table cell (a sparkline). A bare chart may be as small as 24 x 16 px.

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
