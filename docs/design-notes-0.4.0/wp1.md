# Round 5, work package 1: waterfall, funnel, bullet, bump

Four chart types, each its own `ChartDef` under `packages/core/src/charts/`, exported from `charts.ts` and registered by the package
roots. Catalogue order: `... box, heatmap, waterfall, bullet, bump, radar, treemap, sankey, funnel, maps`.

| Feature | Borrowed from | How it fits the principles | Limits, refusals |
|---|---|---|---|
| `waterfall` (`x`, `y`, `total`, `start`, `labels`, `connectors`, `orientation`, `yDomain`) | ECharts (stacked-bar recipe), Highcharts `waterfall` (`isSum`), AG Charts, Plotly `measure`, ApexCharts | One chart type, fields only. Increase, decrease and total are three legend entries (`positive`, `negative`, `text-muted` tokens; `colors.increase/decrease/total` overrides), so identity is in the legend, the tooltip ("Increase", "Decrease", "Total") and `patterns`, never colour alone. Tooltip and `datum` carry the change and the running total. Dashed connectors carry the level between bars. | Totals: a total row shows the running total, or its own value (an opening or reported balance); `total_mismatch` warns when that differs from the sum before it. Highcharts' "intermediate sum since the last sum" is not offered: two subtotals are two total rows. Repeated labels are summed (`duplicate_steps`). |
| `funnel` (`stage`, `value`, `labels`, `connectors`, `facet`) | ECharts, Highcharts, AG Charts, Plotly `funnel`, ApexCharts, amCharts sliced funnel | Centred bars, width proportional to value; labels give the value and the share of the first stage, the tooltip and `datum` add the share of the stage before. `funnel_increases` warns (and still draws) when a stage is larger than the one before. | **Shape decision:** bars only, no `shape: 'trapezoid'`. A trapezoid encodes one value with two edges (top and bottom width), so the reader cannot tell which number a stage is; the faint drop-off band between bars (`connectors`) gives the funnel silhouette without touching the value encoding. At most 40 stages (`too_many_stages`, error). Not cartesian, like pie: `zoom`/`brush`/`annotations` are unknown fields (an error, as for pie and treemap, not a warning; consistent with the existing non-cartesian charts). `facet` is added explicitly and works (one funnel per segment, each against its own first stage; panels do not share a width scale, see below). |
| `bullet` (`x`, `value`, `target`, `ranges`, `orientation`, `scale`, `yDomain`) | Stephen Few's bullet graph spec, Nivo `Bullet`, Highcharts `bullet` | Ranges are one theme neutral (`text-muted`) at three opacities, darkest for the first (worst) range, so they follow every theme with no new token; value bar in series 1, target tick in `text`. Legend has the value and target columns (toggle either). A transparent `hit` rect per row gives every number on hover anywhere on the row; the value bar carries `aria`, `tip`, `datum` for keyboard and screen readers. | `scale: 'each'` (own range and ticks per measure, for mixed units) is horizontal only (`scale_each_horizontal` falls back to shared) and has no shared axis, so `zoom`, `brush`, `yDomain` and `annotations` warn and are ignored there. Range names are in the tooltip and description, not in the legend (the legend swatch cannot show an opacity band). |
| `bump` (`x`, `series`, `rank` or `y`, `rankBy`, `curve`, `labels`) | Nivo `Bump` | Rank from a `rank` column or by ranking `y` per x (ties keep the series order, so the output is deterministic). Rank 1 on top, d3 `curveBumpX`-style easing (`curve: 'smooth'`) or straight segments, a dot per point (tooltip: rank, value, movement since the step before), direct labels at line ends. A hidden series is not drawn but does not re-rank the others (ranks are facts of the data, and the plot does not jump). | At most `LIMITS.maxSeries` (8) lines: those with the best average rank, `too_many_series` warning; ranks still count every series. `patterns` is refused with `patterns_unsupported` (lines and dots have no fill). The legend stays on `auto` (shown for 2+ series) for toggling, even though the end labels already name the lines: see below. |

## Facet, zoom, brush, patterns

| | facet | zoom | brush | patterns |
|---|---|---|---|---|
| waterfall | yes, shared value range | refused, `zoom_unsupported` (category axis) | yes (steps, `oneOf`) | yes, one texture per kind |
| funnel | yes (own field, not cartesian) | unknown field (error, like pie) | unknown field (error, like pie) | yes (one series); drop-off bands are not textured |
| bullet | yes, shared value range (`scale: 'shared'`) | refused, `zoom_unsupported` | shared scale: yes; `each`: `brush_unsupported` | yes on the value bars; ranges are not series |
| bump | yes, ranks per panel | refused, `zoom_unsupported` (rank and step axes are categories) | yes (steps) | refused, `patterns_unsupported` |

## Shared changes outside the four files

- **New field kind `flag`** in `schema.ts` (validation, JSON Schema `oneOf`, `fieldType`, `isYes`, `flagged`): "a column of yes/no values, or a list of values". Yes means `true`, `1`, or `"true"`, `"yes"`, `"1"`, `"total"`, `"subtotal"` (case-insensitive, trimmed); anything else is no. Codes: `no_such_column` (with did-you-mean), `bad_type` (also `total[i]`), `too_many`. **The Go and Python ports must learn this kind** (they read `fields.v1.json`), plus the cross-field checks and descriptions of the four charts; conformance cases were added (`validationCases`, `describeCases` named `waterfall: ...`, `funnel: ...`, `bullet: ...`, `bump: ...`).
- **Facet fix** (`compile.ts`): small multiples of a *horizontal* chart now share the value range (`yDomain` is the value axis, which a horizontal chart draws along x). Before, horizontal bar, box and bullet facets each had their own range, which contradicted "sharing axes". Tested with bullet; applies to bar and box too.
- `table.ts` lists a `flag` column (not a label list) in `plotTable`; `validate.ts` skips a `flag` column name when the data is broken, as for other column fields.

## Deliberate refusal: gauge

Not built. A gauge shows one number with a target on a dial: the dial's angle is harder to read than a length, it spends a lot of area on one value, and it overlaps Super Chat's stat cards. One value is a stat tile; one value against a target and qualitative ranges is a one-row `bullet`, which is the chart Few designed to replace gauges. Revisit only if a host needs the dial itself.

## For the owner to revisit

- DESIGN.md still says "Twelve are registered" and lists "No funnel or gauge" under Known limits; both need the lead's merge (funnel exists now; gauge is refused for the reason above). OPEN-DECISIONS item 5 is updated.
- Funnel facets: each panel is scaled to its own largest stage (the funnel convention, shares of its own first stage). A shared width across panels would compare segment sizes; it would need a general "shared value range" for non-cartesian charts.
- Bump legend: kept on `auto` (consistent with every other chart, and the only way to toggle a series). With end labels it repeats the names; a host that wants the minimal Nivo look sets `legend: 'none'`.
- Bullet `scale` default is `shared`; Few's original sets every measure on its own scale. `shared` was chosen because it is the honest default for one unit and keeps zoom/brush/facet working; the catalog example uses `each`.
- Waterfall labels are English ("Increase", "Decrease", "Total", "Running total"), like the existing "Total" and "Other" in bar and pie; there is no label override field.
