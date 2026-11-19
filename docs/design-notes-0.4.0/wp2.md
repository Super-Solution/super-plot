# Round 5, work package 2: violin, calendar, sunburst, parallel coordinates, box points

Notes for the lead to fold into `docs/DESIGN.md` (the "Borrowed from competitors" table, the chart list, known limits).
Everything below is built, tested (`tests/core/charts-r5.test.ts`, one test in `tests/web/canvas.test.ts`) and in the
gallery (`examples/_shared/specs.ts`). The Go and Python ports do not know these charts or fields yet.

## Features

| Feature | Borrowed from | How it fits the principles | Limits and refusals |
|---|---|---|---|
| `violin` chart: `x` (groups, optional), `y`, `bandwidth`, `inner: box \| quartiles \| none` (default box), `points` (default none), `orientation`, `yDomain` | Plotly violin, Vega-Lite `density` transform, Observable Plot, Seaborn `violinplot` | A `ChartDef` with fields in the DSL, nothing else touched. The density maths is a pure exported function (`kde`, `silverman`, `densityPeaks`, `densityPoints` in core) with the formula in its doc comment, and a new `density` section in `conformance/plot.v1.json` pins bandwidth, grid and values so the ports can match. Same quantile (type 7) and Tukey statistics as box (`boxStats`). The description names the peaks ("Team: ... 2 peaks, near 8.63, 31.12"), which a reader of the picture would see. | Gaussian kernel only. The grid spans the observed range (Plotly `spanmode: 'hard'`, Seaborn `cut=0`, the Vega-Lite default extent): the shape never claims values outside the data. Each violin has the same maximum width (Plotly `scalemode: 'width'`); no `count`/`area` scaling. Grid size: 64 points, more when the bandwidth is narrow for the range (`clamp(ceil(2 * range / h) + 1, 64, 512)`) so a peak cannot fall between two points; a fixed 64 under-sampled data with a few far outliers (found by a test). All values equal: a bar across the violin (a point mass), not a fake curve. `few_values` warning under 5 values in a group. |
| `calendar` chart: `x` (ISO date or epoch ms), `value`, `weekStart: monday \| sunday` (default monday), `domain` | ECharts calendar, Nivo calendar, GitHub contribution graph | A `ChartDef`. The colour ramp and its legend were moved out of heatmap into `seqScale` / `seqLegend` (`charts/shared.ts`) and both charts call them, so heatmap's scene is unchanged and the two cannot drift. Days are UTC (`toTime`, the repo's time rules). Tooltip: full date, value, weekday; `datum` is `{ date: 'YYYY-MM-DD', value }`. | At most 5 years (`MAX_CALENDAR_YEARS`), the most recent, with a `too_many_years` warning in validation. One year shows the months that have data; several years show whole years so weeks line up across rows. Days without data are outlined cells in the surface colour (role `grid`, no tooltip), never the colour of zero; a "No data" swatch sits under the ramp. Codes `not_time` (error) / `some_not_time` (warning) follow the transform's `some_not_time`. `calendar_cramped` warning under 6 px per day. |
| `sunburst` chart: `path` (1 to 6 columns, outermost first), `value`, `labels` | ECharts sunburst, Plotly sunburst, Nivo, Highcharts | A `ChartDef`. `hierarchy(rows, levels, value)` is exported and pure. Treemap has no reusable hierarchy (it hard-codes one optional `group` level over `label`), so sunburst took the general form; treemap's field names (`label`/`group`) could not stretch to N levels, hence `path`. The legend is the first level, so legend toggle, `colors` and `patterns` work through the generic machinery: every arc carries its branch's `series`. Deeper rings mix toward the surface (`mix`, as treemap does). The pie's `arc` path helper moved to `charts/shared.ts` and both use it. | Rows that stop at an empty level count toward their parents and leave a gap outside them (Plotly's remainder behaviour). More than 30 children under one parent: the smallest merge into "Other" (`many_children` warning at compile time, since it depends on the aggregate). At most 1,500 arcs drawn, sub-pixel arcs left to their parent (`many_nodes`). Labels along the ring when the arc is long enough, along the radius when the ring is wide enough, otherwise none. **No drill-down in core**: zooming into a branch is viewer state, which belongs in the web binding (or the host: `onSelect` gets `datum.path`, and a `transform` filter draws the branch). Not built this round. |
| `parallel` chart: `dimensions` (2 to 12 numeric columns), `series` | ECharts parallel, Plotly `parcoords`, Highcharts parallel coordinates | A `ChartDef`. Each axis gets its own `niceLinear` domain and `tickFormatter` ticks. One path per row with `tip` (every value), `aria`, `datum` (the source row). Axes are drawn over the lines so the scales stay legible. The description reports ranges and the strongest correlation between neighbouring axes (Pearson, the existing `correlation`). | At most 2,000 lines (`MAX_LINES`): past that every k-th complete row, k = ceil(n / 2000), starting at the first (`sampleRows`, deterministic), with a `lines_sampled` warning that gives k; the axes still span every row. Rows missing a value in any dimension are skipped (`incomplete_rows`). No axis brushing or reordering (Plotly/ECharts have both): that is web-binding interaction, not done this round. One shared `format` for all axes. |
| `points: 'outliers' \| 'all' \| 'none'` on box (and violin) | Plotly `boxpoints` / violin `points` | A spec field. `all` jitters by the golden-ratio (Weyl) sequence `frac(i * 0.6180339887498949) - 0.5` on the row's index within its group: deterministic, evenly spread, no `Math.random` (a test spies on it). On box the dots sit over the box within 40% of its width; on violin within 80% of the violin's width at that value (a sina-style spread). Every dot has `tip`, `aria` and `datum`. | `many_marks` warning above 5,000 dots (same code as scatter). |

## Box compatibility

`box` keeps `outliers: boolean` (default true) exactly as before, and the new `points` field has **no default**, so the
normalised spec of every existing box spec is unchanged (checked: no existing conformance case changed). The rule:
`points` when set, else `outliers: false` means `none`, else `outliers`. `points` set together with `outliers: false`
draws what `points` says and warns `outliers_ignored`. Outlier circles are drawn exactly as before (same marks, same
order) and now also carry `datum: { group, value }`. Owner may want to deprecate `outliers` in a later version; it costs
nothing to keep.

## Field DSL change

`columns` fields may now be `role: 'any'` (sunburst `path`) and carry `min` / `max` item counts (sunburst 1..6,
parallel 2..12). Validation returns `too_few_columns` / `too_many_columns` (errors, path = the field); the JSON Schema
gets `minItems` / `maxItems`, and drops the single-string form when `min` is 2 or more; the SPEC type reads "list of 2
to 12 column names". `conformance/fields.v1.json` carries the new keys: **the ports must learn `role: 'any'`, `min`,
`max` on `columns`**, plus the cross-field checks (`checkPoints`, violin, calendar, sunburst and parallel `check`) and
the four `describe` functions. Each check and describe is written to be portable (no locale-dependent weekday names in
descriptions: English names, dates through `formatTime`).

## facet and patterns

| Chart | `facet` | `patterns` |
|---|---|---|
| violin | Works (generic small multiples, shared value axis; the facet y title uses `y` as for box). Tested. | Ignored with `patterns_unsupported`: groups are told apart by their position and label, not by colour (every violin has the same colour). |
| box | Unchanged (already worked). | Now warns `patterns_unsupported` instead of ignoring it silently (it never did anything on box). |
| calendar | Not a field (`unknown_field`), like heatmap: a calendar has no shared axes, and it already splits by year. | `patterns_unsupported`: one colour scale, no series. |
| sunburst | Not a field, like pie and treemap. | Supported: one texture per first-level branch, on every arc of it. Tested. |
| parallel | Not a field: its axes are its own and panels of 2,000 lines would be unreadable. | `patterns_unsupported`: lines have no fill. |

The brief asked for "refuse with a warning" where facet does not apply. On non-cartesian charts `facet` is not a field
at all, so it fails validation with `unknown_field` (an error with a hint), the same as for heatmap, pie and treemap
today. Making it a warning would mean adding `facet` to these charts only to ignore it; I kept the existing contract.
Revisit if the owner wants a uniform "accepted but ignored" behaviour.

## Other changes

- Web canvas hit testing (`packages/bindings/web/src/canvas.ts`): an unfilled path with a tooltip (a parallel line, a
  point-mass violin) is now hit along its stroke (`isPointInStroke`, at least 6 px wide) instead of inside the shape
  its points would enclose. Before, hovering anywhere inside a polyline's implied outline picked it. Test in
  `tests/web/canvas.test.ts`. The SVG renderer already hit strokes only (`fill="none"`).
- `formatWeekday(t, 'short' | 'long', locale)` added to `util/time.ts` (UTC, Intl, cached like the other formats).
- `defaultHeight`: calendar 0.34 x width (one year is a short strip), sunburst 0.75 like the maps.
- Conformance: `density` section; 21 new validation cases and 8 new description cases; existing cases unchanged.
- Visual-regression baselines (`E2E_VISUAL`) do not exist yet for the six new gallery figures (`box-points`, `violin`,
  `violin-quartiles`, `calendar`, `sunburst`, `parallel`); run `E2E_VISUAL=update` after merging if you keep them.

## For the owner to revisit

- Violin default `points: 'none'` (Plotly defaults to outliers). The inner box already shows the spread and the
  density shows tails, so outlier dots would repeat them; `points: 'outliers'` is one field away.
- Violin span = observed range, not Seaborn's default 2 bandwidths beyond. More honest, slightly blunter ends.
- Calendar: several years always show whole years (aligned weeks), even when the data covers a few months of each.
- Sunburst limits (30 children per parent, 1,500 arcs, 6 levels) and parallel limits (2,000 lines, 12 axes) are
  judgement calls, documented in the field descriptions and warnings.
