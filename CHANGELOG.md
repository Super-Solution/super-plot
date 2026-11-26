# Changelog

All four npm packages (`@supersolutions/super-plot-core`, `-web`, `-react`, `-chat-plugin`) share one version.

## 0.8.0 (2026-11-25)

### Added

- Chart `chord` (in `/charts/hierarchy`): flows between groups as arcs and ribbons on a circle, `{ type: 'chord', from, to, value }`. The layout is deterministic by construction, with no force simulation and no random numbers: arcs follow the order the groups first appear in the data, and ribbons sit inside each arc ordered by the group at their other end. `chordLayout(flows)` (core `/base`) is the exact algorithm; it is ported to Go and Python and its numbers are in `conformance/plot.v1.json`. Validation (`flows_skipped`, `no_flows`, `too_many_nodes` over 24, `too_many_links` over 300) and the description are in step in both ports. `docs/COMPETITIVE.md` moves chord from open to built.
- Scatter `jitter` (0 to 20 px) and `jitterAxis` (`x`, `y`, `both`): a deterministic nudge so points on the same spot show. The offset is `jitterUnit(index, axis)` of the row's position in the data (the murmur3 finaliser; exported from core, ported to Go and Python, numbers in `conformance/plot.v1.json`), so the same data draws the same bytes and hiding a series moves nothing. Only the drawing moves; the datum, tooltip, description and table keep the true values, and the description says the dots are nudged. Warnings `jitter_ignored` (with `density: "hex"` or `order`) and `jitter_axis_ignored`. New gallery spec `scatter-jitter`.
- `plot_suggest` and `suggestPlots({ rows | columns, intent?, max?, includeData? })` (`core/base`): which charts fit a table, as validated specs with a stable rule `code`, a score, why it fits and what to check. Twelve fixed, versioned rules (`SUGGEST_RULES`, `SUGGEST_VERSION`, listed in INTEGRATION.md) over a column profile (`profileColumns`): deterministic, no model, no DOM. A suggestion that would not validate against the rows is dropped (`suggestion_invalid`), identifier and free-text columns are skipped with an info issue. `chartCatalog()` entries gain `suggestedBy`; the chat plugin gains a read tool `plot_suggest` that reads a card's rows.
- Transform `window` op `ema`: the exponential moving average, `alpha = 2 / (frame + 1)` (`frame` is the span, default 3), starting from the first number; a missing cell yields `null` and the average carries on. Go, Python, conformance and `docs/SPEC.md` in step. `frame_ignored` now says it applies to movingMean and ema.
- Narrow-width rules, applied by the layout from the chart's width (no option): a title that does not fit takes a second line (Chinese and Japanese break between characters); wide category labels wrap over two lines before they are shortened (a horizontal bar chart's too, when its rows are tall enough); under 420 px one to four labelled annotations become numbers with a key under the plot; and a calendar whose days would get under 8 px is cut into rows of weeks (two on a phone) with its colour scale in a row beneath. `defaultHeight(type, width, spec)` takes the spec, and `ChartDef.height` lets a chart ask for a taller default box.
- `renderToSvg(spec, { onInvalid: 'placeholder' })`: an invalid spec (no data, an unknown column) comes back as an SVG that names the first error, its path and code, with every error in `<desc>`, instead of a `PlotSpecError`. The default is still to throw. New UI string `chartUnavailable`.
- Pie and donut validation warnings with stable codes: `pie_no_positive` (nothing positive to draw; the chart now says "No positive values to show", string `noPositive`, and its description says nothing is drawn), `zero_slices` (a slice with a total of 0 has no angle and sits in the legend only) and `negative_slices`, which now comes from `validatePlot` (so `plot_validate` and the Go and Python ports report it) instead of only from drawing. Go, Python and conformance cases in step.

### Changed

- Dev tooling: vitest 3.2 to 5.1.2 (with vite pinned to ^7.3.8, which vitest 5 accepts but npm would otherwise resolve to vite 8, whose esbuild peer conflicts with the build's). `npm audit` goes from 3 advisories (1 moderate, 2 critical, all in vitest, `@vitest/mocker` and `tinypool`) to 0. Nothing shipped changes. The size tables in README and INTEGRATION.md are measured again with `npm run size` (they had fallen behind); the budgets in `scripts/size.mjs` are raised to match what this release measures.
- A bar category with no number (null, `NaN`, text) is described as missing (`Missing: b (no value, so not counted above)`) and left out of the highest, lowest and total; it was counted as 0 ("Lowest: b (0)"). Ports and conformance in step.
- `renderToSvg` (and `renderSvg`) no longer write the same element ids for every chart. The default id prefix is `sp` plus a hash of the drawing, so two charts on one page do not share `sp-t` / `sp-d` (an `aria-labelledby` that points at another chart's title reads the wrong chart). The same spec still writes the same bytes; `idPrefix` still names the ids yourself, and `hydrate: true` output is unchanged.

## 0.7.0 (2026-11-22)

### Added

- The chat plugin's card fits where the host shows it (super-protocol 0.4 placements): it fills a side panel (`panel`, at least 320 px, ignoring `height`), and in a document (`document`) it is drawn without the entrance animation. The manifest declares a `panel` capability for `super.plot`. Moving between places keeps the plot. Hosts without placements see no change.

## 0.6.0 (2026-11-22)

### Added

- Scatter `order`: a column that joins each series' points by a line, from the lowest value to the highest (a connected scatter, such as a cycle over time). A row without a value stays a dot off the line; `density: "hex"` ignores it with a warning.
- Region annotations: `{xFrom, xTo, yFrom, yTo, label, tone}` shades a rectangle between two values on each axis, and a side left out runs to the edge of the plot, so one corner makes a quadrant. Numeric and time axes; skipped with a warning on a category axis or when wholly outside the plot. Described as "Shaded: ...".
- Number formats: a `prefix^` before any format (`NT$^integer`, `£^fixed:2`), printed before the digits and after a minus sign, at most 8 characters. Pairs with the existing `~suffix`. Validation, JSON Schema, the Python and Go ports and conformance cases are in step.

## 0.5.0 (2026-11-21)

### Added

- Number formats: `currency:CODE:compact` ($1.2B), `:narrow` for the narrow currency symbol ("$", not "US$" in Chinese), `percent:N` (exactly N decimals) and a `~suffix` after any format (`integer~ days` shows 92 days). Validation, JSON Schema, the Python and Go ports (and the currency table, which now carries narrow symbols) and conformance cases are in step.

## 0.4.0 (2026-11-21)

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
