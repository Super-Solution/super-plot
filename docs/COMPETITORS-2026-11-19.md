# Competitor × capability matrix (sourced, 2026-11-19)

**Date:** 2026-11-19 · **Method:** `docs/30-runbooks/competitive-review.md` (super-dev-docs, `pr/7`) · **Scope:** what competitors do; what Super Plot does about each row is in [COMPETITIVE.md](COMPETITIVE.md).

## 1. Method and how to read a cell

- Every sourced cell comes from an official README, docs page or docs source file opened on 2026-11-19. The ref id in the cell (for example `[E2]`) points to the Sources list in section 5. 66 pages were opened; three more could not be opened and are listed there.
- This sandbox could reach only `raw.githubusercontent.com` directly, so most evidence is the **docs source in the vendor's own GitHub repository** (sidebars, tables of contents, READMEs, export lists, package manifests). Vendor web sites were read through a fetch tool that returns a summary of the page, so those refs (`S1`, `T2`, `RC2`, `PL3`, `A2`, `AM3`, `DW1`–`DW3`, `VI3`) carry summarised, not verbatim, evidence.
- `[FR]` means the fact is reused from the first review (`docs/60-reference/competitive-review-super-plot.md`, sources opened 2026-11-19 by that review) and was not re-opened here.
- Cell values:
  - `yes` — the opened page names the feature.
  - `partial` — exists with the stated limit, or must be assembled from lower-level parts.
  - `plugin` — an official add-on outside the core package.
  - `paid` — only in the commercial edition or behind a licence key.
  - `no` — the vendor says so on the opened page (the reason is given).
  - `no*` — **absence, not a vendor statement**: the feature is not in the index, sidebar or export list cited, which I read in full. A feature may still exist in a demo or community add-on that the index does not list.
  - `[unverified]` — not opened today. Where a value stands before it (`yes [unverified]`), the value is from memory and must be re-checked before it is quoted.
  - `—` — not applicable to that product.
- Vendor size and speed numbers appear only in the per-competitor notes, always as **self-reported**, and are not compared with ours.
- Limits of this pass: no competitor demo gallery was opened (they are rendered by JavaScript), so chart types that exist only as gallery examples are `no*` or `[unverified]`. Datawrapper's chart page names 7 groups out of "23" chart types, so most of its chart-type cells are `[unverified]`. Reduced-motion and forced-colors support could not be verified for any library except Highcharts' Windows High Contrast Mode.

## 2. The matrix

Columns, in order: ECharts, Chart.js, Recharts, Observable Plot, Vega-Lite (Altair is its Python face), visx, Plotly.js, Highcharts, uPlot, shadcn/ui charts (+ Tremor), Nivo, AG Charts, ApexCharts, amCharts 5, Bokeh, deck.gl (maps and large data only), Datawrapper (hosted tool), Victory.

### A. Chart types

| Capability | ECharts | Chart.js | Recharts | Obs. Plot | Vega-Lite / Altair | visx | Plotly.js | Highcharts | uPlot | shadcn / Tremor | Nivo | AG Charts | ApexCharts | amCharts 5 | Bokeh | deck.gl | Datawrapper | Victory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **bar / line / area / scatter / pie** | yes [E1] | yes [C1] | yes [RC2] | partial: no pie/arc mark [P1] | yes [V1] | partial: shapes you assemble [X1][X2] | yes [PL2] | yes [H1][H3] | partial: line, area, bars; no pie [U1] | yes, via Recharts [S1]; Tremor: area, bar, line, donut, combo [T2] | yes [N2] | yes [AG1] | yes [AP1] | yes [AM2] | yes [B3][B4] | partial: Scatterplot/Line/Column layers, no axes [D1] | yes [DW1] | yes [VI2] |
| **histogram** | no* series [E1]; ecStat add-on [unverified] | no* [C1] | no* [RC2] | yes: bin transform + rect [P1] | yes: bin [V1] | [unverified] | yes [PL2] | yes [H1] | no: no statistical processing [U1] | no* [T2] | no* [N2] | paid [AG1] | no* [AP1] | no* [AM2][AM3] | partial: quad glyphs from np.histogram [B7] | partial: spatial grid/hexagon aggregation only [D1] | [unverified] | yes [VI2] |
| **box plot** | yes [E1] | no* [C1] | no* [RC2] | yes [P1] | yes [V1] | [unverified] (no stats package in the v4 umbrella list [X2]) | yes [PL2] | yes [H1] | no* [U1] | no* [T2] | yes [N2] | paid [AG1] | yes [AP1] | no* [AM2] | partial: assembled from Whisker + vbar + scatter [B7] | no* [D1] | [unverified] | yes [VI2] |
| **violin** | no* [E1] | no* [C1] | no* [RC2] | no* [P1] | partial: density transform + area [V1] | [unverified] | yes [PL2] | no* [H1] | no [U1] | no* [T2] | no* (SwarmPlot only) [N2] | no* [AG1] | yes, opt-in import [AP1] | no* [AM2] | partial: KDE via varea, SinaPlot [B7] | no* [D1] | [unverified] | no* [VI2] |
| **heatmap** | yes [E1] | no* [C1] | no* [RC2] | yes: cell, raster [P1] | yes: rect [V1] | yes [X2] | yes [PL2] | yes [H1] | no* [U1] | no* [T2] | yes [N2] | paid [AG1] | yes [AP1] | partial: heat rules [AM3] | yes [unverified] | partial: geospatial HeatmapLayer [D1] | [unverified] | no* [VI2] |
| **calendar heatmap** | yes: calendar coordinate [E2] | no* [C1] | no* [RC2] | partial [unverified] | partial: rect + timeUnit [V1] | no* [X2] | no* [PL2] | no* [H1] | no [U1] | no* (Tremor Tracker is a status strip) [T2] | yes: Calendar, TimeRange [N2] | no* [AG1] | no* [AP1] | no* [AM2] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **treemap** | yes [E1] | no* [C1] | yes [RC2] | no* (tree mark only) [P1] | no* [V1] | yes: hierarchy [X2] | yes [PL2] | yes [H1] | no [U1] | via Recharts [RC2] | yes [N2] | paid [AG1] | yes [AP1] | yes [AM2] | [unverified] (hierarchical topic [B3]) | no* [D1] | [unverified] | no* [VI2] |
| **sunburst** | yes [E1] | no* [C1] | yes [RC2] | no* [P1] | no* [V1] | partial: hierarchy layouts [X2] | yes [PL2] | yes [H1] | no [U1] | via Recharts [RC2] | yes [N2] | paid [AG1] | yes, opt-in import [AP1] | yes [AM2] | [unverified] | no* [D1] | [unverified] | no* [VI2] |
| **sankey** | yes [E1] | no* [C1] | yes [RC2] | no* [P1] | no* [V1] | yes [X2] | yes [PL2] | yes [H1] | no [U1] | via Recharts [RC2] | yes [N2] | paid [AG1] | separate product (apexsankey) [AP1] | yes [AM2] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **funnel** | yes [E1] | no* [C1] | yes [RC2] | no* [P1] | no* [V1] | no* [X2] | yes [PL2] | yes [H1] | no [U1] | via Recharts [RC2] | yes [N2] | no* [AG1] | yes [AP1] | yes [AM2] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **waterfall** | partial: stacked-bar recipe [E3] | partial: floating bars [C1] | no* [RC2] | no* [P1] | partial: window transform + bar [V1] | no* [X2] | yes [PL2] | yes [H1] | no [U1] | no* [T2] | no* [N2] | paid [AG1] | yes, opt-in import [AP1] | [unverified] | no* [B3] | no* [D1] | yes [DW1] | no* [VI2] |
| **bullet** | no* [E1] | no* [C1] | no* [RC2] | no* [P1] | partial: layered marks [unverified] | no* [X2] | partial: indicator trace [PL2], bullet mode [unverified] | yes [H1] | no [U1] | no* [T2] | yes [N2] | no* [AG1] | [unverified] | [unverified] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **bump / rank** | no* [E1] | no* [C1] | no* [RC2] | partial: window/map transforms [P1] | partial: window rank transform [V1] | no* [X2] | no* [PL2] | no* [H1] | no [U1] | no* [T2] | yes: Bump, AreaBump [N2] | no* [AG1] | no* [AP1] | no* [AM2] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **parallel coordinates** | yes [E1] | no* [C1] | no* [RC2] | no* [P1] | partial: fold + line [V1] | no* [X2] | yes: parcoords, parcats [PL2] | yes [H1] | no [U1] | no* [T2] | yes [N2] | no* [AG1] | no* [AP1] | no* [AM2] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **radar** | yes [E1] | yes [C1] | yes [RC2] | no* [P1] | no* (polar position channels only) [V1] | [unverified] | yes: scatterpolar [PL2] | yes: polar chart [H1] | no [U1] | via Recharts [RC2] | yes [N2] | paid [AG1] | yes [AP1] | yes [AM2] | no* [B3] | no* [D1] | [unverified] | partial: polar axis [VI2] |
| **gauge** | yes [E1] | no* (doughnut only) [C1] | partial: RadialBarChart [RC2] | no* [P1] | no* [V1] | no* [X2] | yes: indicator [PL2] | yes: angular gauges [H1] | no [U1] | partial: Tremor Progress Circle [T2] | partial: RadialBar [N2] | [unverified] | yes: radial bar / gauge [AP1] | yes [AM2] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **candlestick** | yes [E1] | no* [C1] | no* [RC2] | partial: rule + bar; Bollinger mark [P1] | partial: rule + bar layers [V1] | no* [X2] | yes [PL2] | yes, in Highcharts Stock [H1] | yes: ohlc [U1] | no* [T2] | no* [N2] | paid [AG1] | yes [AP1] | yes [AM2] | [unverified] | no* [D1] | [unverified] | yes [VI2] |
| **network graph** | yes: graph [E1] | no* [C1] | no* [RC2] | partial: link/arrow/tree marks, no force layout [P1] | no* [V1] | yes [X2] | no* [PL2] | yes [H1] | no [U1] | no* [T2] | yes [N2] | no* (Chord is paid) [AG1] | no* [AP1] | yes: force-directed [AM2] | yes: graph topic [B3] | no* (arc/line layers, no layout) [D1] | [unverified] | no* [VI2] |
| **word cloud** | no: third-party extension only [E10] | no* [C1] | no* [RC2] | no* [P1] | no* [V1] | yes [X2] | no* [PL2] | yes [H1] | no [U1] | no* [T2] | no* [N2] | no* [AG1] | no* [AP1] | yes [AM2] | no* [B3] | no* [D1] | [unverified] | no* [VI2] |
| **3D charts** | plugin: echarts-gl [E9] | no* [C1] | no* [RC2] | no* [P1] | no* [V1] | no* [X2] | yes: gl3d traces [PL2][PL3] | yes: 3D column/pie/scatter, cylinder, 3D funnel [H1] | no [U1] | no* [T2] | no* [N2] | no* [AG1] | no* [AP1] | no* [AM2] | no* [B3] | yes: 3D layers and views, not axis charts [D1] | [unverified] | no* [VI2] |
| **choropleth / geo maps** | yes: map series, geo component [E1][E2] | no* [C1] | no* [RC2] | yes: geo mark, projections [P1] | yes: geoshape, projection [V1] | yes: geo [X2] | yes: choropleth, tile maps [PL2][PL3] | yes, separate product Highcharts Maps [H1] | no [U1] | no* [T2] | yes: Choropleth, GeoMap [N2] | paid [AG1] | no* [AP1] | yes [AM2] | yes: geo topic [B3] | yes [D1] | yes: maps [DW2]; choropleth by name [unverified] | no* [VI2] |
| **globe** | plugin: echarts-gl [E9] | no* [C1] | no* [RC2] | partial: projections [unverified] | partial: projection types [unverified] | partial: geo projections [unverified] | [unverified] | [unverified] | no [U1] | no* [T2] | no* [N2] | no* [AG1] | no* [AP1] | yes [AM1] | no* [B3] | yes: GlobeView [D1] | [unverified] | no* [VI2] |

### B. Scales and marks

| Capability | ECharts | Chart.js | Recharts | Obs. Plot | Vega-Lite / Altair | visx | Plotly.js | Highcharts | uPlot | shadcn / Tremor | Nivo | AG Charts | ApexCharts | amCharts 5 | Bokeh | deck.gl | Datawrapper | Victory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **log scale** | yes [unverified] | yes [C1] | yes [unverified] | yes [unverified] | yes [unverified] | yes [unverified] | yes: Log Plots [PL3] | yes [unverified] | yes [U1] | via Recharts [unverified] | [unverified] | [unverified] | [unverified] | yes [unverified] (not in docs nav [AM3]) | yes [unverified] | — | [unverified] | [unverified] |
| **dual y-axis** | yes [unverified] | yes: multi-axis sample [C1] | yes [unverified] | no [unverified] | yes: independent scale resolution in layers [V1] | yes: you place the axes [X2] | yes [unverified] | yes [unverified] | yes: multiple y-axes, scales, grids [U1] | via Recharts [unverified] | [unverified] | [unverified] (Combination series [AG1]) | [unverified] | yes [unverified] | yes [unverified] | — | yes: dual-axis chart [DW1] | [unverified] |
| **error bars / bands** | no* series [E1] | no* [C1] | yes: ErrorBar [RC2] | partial: rule/tick/area marks [P1] | yes: errorbar + errorband marks [V1] | partial: primitives, threshold [X2] | yes: error bars, continuous error bars [PL3] | yes: error-bar and range series [H1] | partial: high/low bands [U1] | via Recharts ErrorBar [RC2] | [unverified] | paid [AG1] | partial: range area [AP1] | [unverified] | yes: Whisker annotation [B7] | no* [D1] | partial: shaded ranges [DW1] | yes: errorbar [VI2] |
| **regression / loess trend** | no* core [E1][E2]; ecStat add-on [unverified] | no* [C1] | no* [RC2] | partial: linear regression mark; no loess [P1] | yes: regression + loess transforms [V1] | no* [X2] | no* [PL3] | partial: technical indicators (Stock) [H1] | no: explicit non-feature [U1] | no* [T2] | no* [N2] | no* [AG1] | no* [AP1] | [unverified] | no* [B7] | no* [D1] | [unverified] | no* [VI2] |
| **point annotations / callouts** | yes: markPoint/markLine/markArea, graphic [E2] | plugin [unverified] | yes: ReferenceDot/Line/Area, Label [RC2] | yes: text, tip, arrow, rule marks [P1] | partial: text/rule layers [V1] | yes: annotation package [X2] | yes: annotations [PL1] | yes: annotations module + GUI [H1] | no* (draw in hooks) [U1] | via Recharts [RC2] | [unverified] | paid (cross lines free) [AG1] | yes [AP1]; on-chart editing paid | partial: axis ranges, bullets, labels [AM3] | yes: annotations page [B4] | partial: Text/Icon layers [D1] | yes: text, highlights, shaded ranges [DW1] | partial: VictoryLabel [VI3] |
| **small multiples / facet** | partial: matrix coordinate system (v6) [E5] | no* [C1] | no* [RC2] | yes: facets [P1] | yes: facet, repeat, concat [V1] | no* [X2] | yes: subplots [PL3] | no* in core (Dashboards product) [H1] | no* [U1] | no* [T2] | no* [N2] | [unverified] | paid: trellis [AP1] | partial: containers/panels [AM3] | yes: layouts [B4] | partial: multiple views [D1] | yes: small multiples [DW2][DW3] | no* [VI2] |
| **combined / layered marks** | yes: series of different types [E1] | yes: mixed [C1] | yes: ComposedChart [RC2] | yes: layered marks [P5] | yes: layer [V1] | yes [X1] | yes: traces, mixed subplots [PL3] | yes: combining chart types [H1][H3] | yes: per-series path renderers [U1] | yes: Tremor Combo Chart [T2] | [unverified] | yes: Combination [AG1] | yes: mixed/combo [AP1] | yes [unverified] | yes: glyphs on one figure [B4] | yes: layer stack [D2] | partial: dual-axis chart only [DW1] | yes: VictoryChart/Group [VI3] |
| **missing-data gaps option** | yes: connectNulls [E8] | yes: spanGaps [C3] | yes [unverified] | [unverified] | yes: invalid-data mode, impute [V1] | [unverified] | yes [unverified] | yes [unverified] | yes: missing-data support [U1] | [unverified] | [unverified] | [unverified] | [unverified] | partial: gapless date axis [AM3] | [unverified] | — | [unverified] | [unverified] |

### C. Data

| Capability | ECharts | Chart.js | Recharts | Obs. Plot | Vega-Lite / Altair | visx | Plotly.js | Highcharts | uPlot | shadcn / Tremor | Nivo | AG Charts | ApexCharts | amCharts 5 | Bokeh | deck.gl | Datawrapper | Victory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **declarative transforms** | partial: dataset + transform component [E2][E3] | no* [C1] | no* [RC2] | yes: bin, group, filter, window, stack, map, select, sort… [P1] | yes: filter, aggregate, bin, window, fold, pivot, impute, lookup… [V1][A2] | no: unopinionated [X1] | no* [PL3] | partial: data module, data grouping (Stock), data sorting [H1] | no: explicit non-feature [U1] | no* [S1][T2] | no* [N2] | [unverified] | partial: stats feature for violin [AP1] | [unverified] | partial: data page [unverified] [B4] | partial: aggregation layers, DataFilterExtension [D1] | [unverified] | no* [VI2] |
| **expression / calculate language** | no* [E2] | no (scriptable options are JS functions) [C1] | no* [RC2] | no (JS functions) [P1] | yes: calculate transform, expr parameters [V1][A2] | no [X1] | no* [PL3] | partial: templating / format strings [H1] | no [U1] | no* [S1] | no* [N2] | [unverified] | no* [AP1] | partial: data placeholders, adapters [AM3] | partial: CustomJS callbacks [B5] | partial: JSON converter [unverified] [D1] | [unverified] | no* [VI2] |
| **streaming append** | yes: dynamic data how-to [E3] | partial: mutate + update() [C1] | partial: re-render; matchAppend helper [RC2] | no: replace the whole plot [P2] | yes: Vega View API changesets [V2] | no* [X1] | yes [unverified] | yes: live data [H1] | yes [U1] | no* [S1] | no* [N2] | [unverified] | yes: chart.streaming, rolling window [AP1] | [unverified] | yes: streaming datasets [B1] | [unverified] | [unverified] | no* [VI2] |
| **decimation (LTTB / min-max)** | yes: sampling incl. lttb [E8] | yes: decimation plugin (min-max, LTTB) + auto during draw [C3][FR] | no* [RC2] | no* [P1] | no* (sample transform is random) [V1] | no* [X2] | no* [PL3] | partial: data grouping (Stock) [H1] | no: no data processing [U1] | no* [T2] | no* [N2] | [unverified] | [unverified] | partial: data grouping [AM1] | no* [B2] | — (GPU) | — | no* [VI2] |
| **large-data GPU mode** | plugin: echarts-gl WebGL [E9] | no (canvas) [C3] | no (SVG) [RC1] | no (SVG) [P4] | no*; Altair has a Large Datasets page [A2] | no [X1] | yes: scattergl, splom, parcoords [PL2] | yes: Boost module, with feature limits [H1][FR] | no: points users to WebGL libraries [U1] | no [S1] | no (canvas variants) [N1] | no* (canvas) [AG1] | partial: canvas renderer for dense series, no WebGL [AP1] | no* (canvas) [AM1] | yes: webgl backend, "limited support", glyph subset [B8] | yes: WebGL2/WebGPU core [D2] | [unverified] | no (victory-canvas) [VI2] |

### D. Interaction

| Capability | ECharts | Chart.js | Recharts | Obs. Plot | Vega-Lite / Altair | visx | Plotly.js | Highcharts | uPlot | shadcn / Tremor | Nivo | AG Charts | ApexCharts | amCharts 5 | Bokeh | deck.gl | Datawrapper | Victory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **tooltip** | yes [E2] | yes [C1] | yes [RC2] | yes: tip mark + pointer [P2] | yes [V1] | yes [X2] | yes: hover [PL3] | yes [H1] | partial: cursor + live-value legend [U1] | yes [S1][T2] | [unverified] | yes [AG1] | yes [AP1] | yes [AM1][AM3] | yes [B5] | yes: picking, tooltip widgets [D1] | yes [DW1] | yes [VI2] |
| **custom tooltip formatter** | yes [unverified] | yes: HTML and content samples [C1] | yes: content components and hooks [RC2] | [unverified] | partial: tooltip channel, Vega Tooltip plugin [V1] | yes: you render it [X2] | yes [unverified] | yes: templating [H1] | via hooks [U1] | yes: ChartTooltipContent; Tremor customTooltip [S1][T2] | [unverified] | [unverified] | [unverified] | yes: HTML content, adapters [AM3] | [unverified] | [unverified] | [unverified] | [unverified] |
| **legend toggle** | yes [E4] | yes [unverified]; legend events sample [C1] | [unverified] | no* [P1][P2] | yes: legend binding [V1] | partial: legend package, own state [X2] | yes [unverified] | yes [unverified] | yes: series toggle [U1] | partial: Tremor legend click [T2] | [unverified] | [unverified] | yes: series toggles [AP1] | yes [unverified] | yes: interactive legends [B5] | — | partial: legend items highlight [DW3] | [unverified] |
| **zoom / pan** | yes: dataZoom inside [E2] | plugin [unverified] | partial: Brush only [RC2] | no: planned [P2] | yes: scale binding [V1][FR] | yes: zoom package [X2] | yes [PL3] | yes: zooming [H1] | partial: drag-zoom built in; wheel/pan left to plugins [U1] | no* [S1][T2] | [unverified] | paid [AG1] | yes: toolbar, pinch, inertia [AP1] | yes [AM1][AM3] | yes: tools [B5] | yes: controllers [D1] | partial: map zoom [DW3] | yes: zoom container [VI2] |
| **brush / interval selection** | yes: brush [E2] | no* [C1] | partial: Brush (range) [RC2] | no: under development [P2] | yes: interval selection [V1] | yes: brush package [X2] | yes: lasso selection [PL3] | [unverified] | partial: drag-select range [U1] | no* [S1][T2] | [unverified] | [unverified] | paid: crossfilter brush [AP1] | [unverified] | yes: linked brushing [B9] | yes: BrushingExtension [D1] | no* [DW1] | yes: brush container [VI2] |
| **point selection** | yes [unverified] | partial: programmatic events [C1] | [unverified] | no: under development [P2] | yes: point selection [V1] | own handlers [X1] | yes: click events [PL3] | yes: common events [H1] | partial: cursor index via hooks [U1] | no* [S1] | [unverified] | [unverified] | yes: selections kept in view state [AP1] | partial: events, element states [AM3] | yes: tools [B5] | yes: picking [D1][D2] | no* [DW1] | yes: selection container [VI2] |
| **cross-chart sync (cursor / zoom)** | yes: connect [E3] | no* [C1] | yes [unverified] | no* [P2] | yes inside one spec: selection resolve across views [V1][FR] | no* [X2] | partial: subplots, events [PL3] | partial: Dashboards sync [H1] | yes: cursor sync [U1] | [unverified] | no* [N2] | paid: synchronization [AG1] | yes: synchronized charts; crossfilter paid [AP1] | [unverified] | yes: shared ranges and sources [B9] | [unverified] | no* [DW1] | yes: shared events [VI2] |
| **data zoom slider / navigator** | yes: dataZoom slider, thumbnail [E2] | no* [C1] | yes: Brush [RC2] | no [P2] | partial: overview + detail via interval selection [V1] | partial: brush package [X2] | yes: range slider and selector [PL3] | yes: navigator, range selector, scrollbar (Stock) [H1] | no* [U1] | no* [T2] | no* [N2] | paid: navigator [AG1] | [unverified] | yes: scrollbars [AM3] | [unverified] | partial: timeline/scrollbar widgets [D1] | no* [DW1] | yes: brush container, brush line [VI2] |
| **animation (entrance / data transitions)** | yes: animation + data transition [E3] | yes [C1] | yes: animation API [RC2] | no: planned [P2] | no* [V1] | no: deliberate [X1] | yes [PL3] | yes [unverified] | no: deliberate [U1] | via Recharts; Tremor turns it off on series [T2] | yes: react-spring [N1] | paid [AG1] | yes: entrance, coherent data transitions, morph [AP1] | yes: Animated theme [AM2][AM3] | no* [B5] | yes: transitions, interpolators [D1] | [unverified] | [unverified] |
| **export toolbar (PNG / SVG / CSV)** | yes: toolbox [E2]; formats [unverified] | no* [C1] | no* [RC2] | no* [P1] | [unverified]; Altair "Saving Altair Charts" [A2] | no [X1] | yes [unverified] (config options [PL3]) | yes: PDF, PNG, JPG, SVG; CSV/XLS/HTML via export-data [H4] | no* [U1] | no* [S1] | no* [N2] | [unverified] | yes: SVG/PNG/CSV [AP1] | yes: PNG, JPG, SVG, PDF, CSV, XLSX, JSON, HTML, print [AM1] | partial: export page [B6] | partial: screenshot widget [D1] | partial: PNG export, "Get the data" link [DW1][DW2] | no* [VI2] |

### E. Accessibility

| Capability | ECharts | Chart.js | Recharts | Obs. Plot | Vega-Lite / Altair | visx | Plotly.js | Highcharts | uPlot | shadcn / Tremor | Nivo | AG Charts | ApexCharts | amCharts 5 | Bokeh | deck.gl | Datawrapper | Victory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **keyboard navigation** | no* [E6] | no: canvas, left to the page author [C2] | yes, default in v3 [FR] | no* [P3] | no* [V1] | no* [X2] | no* [PL3] | yes: accessibility module [H2] | no* [U1] | yes, opt-in accessibilityLayer [S1] | [unverified] | yes, "Accessibility" listed; detail [unverified] [AG1] | yes [AP1] | yes [AM1] | [unverified] | no* [D1] | yes: full keyboard + chart explorer [DW3] | partial: accessibility guide [VI3] |
| **screen-reader description** | yes, opt-in: generated from option [E6] | manual: aria-label / fallback content [C2] | yes, default in v3 [FR] | partial: ariaLabel/ariaDescription, mark labels auto; defaults null [P3] | yes: description channel, ARIA config [V1] | [unverified] | [unverified] | yes: info region + navigable points [H2] | no* [U1] | yes, opt-in [S1] | [unverified] | yes; detail [unverified] [AG1] | yes: ARIA [AP1] | yes [AM1] | [unverified] | no* [D1] | yes: alt text or generated summary [DW2] | partial: VictoryAccessibleGroup [VI3] |
| **data-table view** | [unverified] | no [C2] | no* [RC2] | no* [P3] | no* [V1] | no* [X2] | no* (table is a trace type) [PL2] | yes: view as data table [H2][H4] | no* [U1] | no* [S1] | no* [N2] | [unverified] | no* [AP1] | partial: HTML data export [AM1] | [unverified] | no* [D1] | partial: "Get the data" link [DW2] | no* [VI3] |
| **decal / pattern fills** | yes, opt-in: aria.decal [E6] | [unverified] | yes: patterns [RC2] | [unverified] | [unverified] | yes: pattern package [X2] | [unverified] | yes: pattern fills [H1][H2] | no* [U1] | [unverified] | yes: patterns guide [N1] | [unverified] | [unverified] | yes: patterns [AM3] | yes: hatch properties [B8] | yes: FillStyleExtension [D1] | [unverified] | no* [VI2] |
| **sonification** | no* [E6] | no* [C2] | no* [RC2] | no* [P3] | no* [V1] | no* [X2] | no* [PL3] | yes: audio charts [H1][H2] | no* [U1] | no* [S1] | no* [N1] | no* [AG1] | no* [AP1] | no* [AM3] | no* [B2] | no* [D1] | no* [DW2] | no* [VI3] |
| **high-contrast / forced-colors** | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | yes: Windows High Contrast Mode + contrast themes [H2] | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] (OS light/dark only [AP1]) | partial: colorblind-friendly theme [AM1] | [unverified] | [unverified] | not mentioned [DW2] | [unverified] |
| **reduced-motion** | [unverified] | [unverified] | [unverified] | — (no animation [P2]) | [unverified] | — (no animation [X1]) | [unverified] | [unverified] | — (no animation [U1]) | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | not mentioned [DW2] | [unverified] |

### F. Platform

| Capability | ECharts | Chart.js | Recharts | Obs. Plot | Vega-Lite / Altair | visx | Plotly.js | Highcharts | uPlot | shadcn / Tremor | Nivo | AG Charts | ApexCharts | amCharts 5 | Bokeh | deck.gl | Datawrapper | Victory |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **renderers (SVG / Canvas / WebGL)** | Canvas default, SVG optional [E7][FR]; WebGL via plugin [E9] | Canvas [C2] | SVG [RC1] | SVG [P4] | SVG or Canvas via Vega [FR] | SVG [FR] | SVG + WebGL [PL2][PL3] | SVG; WebGL in Boost [FR][H1] | Canvas 2D [U1] | SVG (Recharts) [S1] | SVG, HTML, Canvas variants [N1] | Canvas [AG1] | SVG; opt-in canvas series layer [AP1] | Canvas default, SVG optional [AM1] | Canvas; WebGL backend [B8] | WebGL2 / WebGPU [D2] | [unverified] | SVG [unverified]; victory-canvas package [VI2] |
| **server-side rendering (no DOM)** | yes: renderToSVGString, or node-canvas [E4] | partial: "Using from Node.js" page [C1] | [unverified] | partial: needs a document (JSDOM or framework virtual DOM) [P4] | [unverified] | [unverified] | no* [PL1] | partial: export server [H1][H4] | no* [U1] | [unverified] | yes: SSR + HTTP API [N1] | [unverified] | yes: renderToHTML / renderToString, Node 18+ [AP1] | partial: renderToSVG; wrappers load in browser only [AM1][AM2] | partial: Python emits JSON/HTML; image export needs a browser [B6][B8] | no* [D1] | — (hosted) | yes: SSR docs page [VI3] |
| **hydration** | yes: lightweight client runtime [E4] | no* [C1] | [unverified] | partial: via React/Vue SSR [P4] | no* [V1] | [unverified] | no* [PL1] | no* [H1] | no* [U1] | [unverified] | [unverified] | [unverified] | yes: hydrate / hydrateAll [AP1] | no* [AM2] | no* [B6] | no* [D1] | — | [unverified] |
| **worker / OffscreenCanvas** | [unverified] | yes; mouse interactions and resize are manual [C3] | no (SVG) [RC1] | no (SVG) [P4] | [unverified] | no (SVG) [X1] | [unverified] | [unverified] | [unverified] | no [S1] | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | [unverified] | — | [unverified] |
| **React / Vue / Svelte / Angular / web component** | vanilla; wrappers [unverified] | vanilla; community integrations [C4] | React only [RC1] | vanilla; React/Vue/Svelte recipes [P4] | vanilla; Python via Altair [A1] | React only [X1] | vanilla; React; Python and R [PL1][PL3] | vanilla; React; Angular/Vue wrappers; Flutter [H1] | vanilla; third-party React/Vue/Svelte [U1] | React, copy-paste [S1][T1] | React only [N1] | vanilla, React, Angular, Vue 3 [AG1] | vanilla; React, Vue, Angular, Blazor, Stencil official; Svelte community [AP1] | vanilla; React, Vue, Angular, Svelte, React Native; am5-chart element [AM2] | Python; BokehJS [B2] | vanilla, React, Python [D2] | hosted embed [unverified] | React; React Native (Victory Native XL) [VI1] |
| **theming via CSS variables** | no*: themes are JS; dynamic theme switch in v6 [E5] | no* [C1] | partial: theme provider, auto theme [RC2] | [unverified] | no*: config object [V1] | [unverified] | no* [PL3] | yes: styled mode (style by CSS) [H1] | [unverified] | yes: --chart-N, var(--color-KEY) [S1] | no*: theme object [N1] | [unverified] | yes: --apx-* custom properties, OS follow [AP1] | no*: theme classes [AM3] | [unverified] | partial: widget styling [D1] | partial: custom themes [DW3] | no*: VictoryTheme [VI3] |
| **plugin / hook API** | yes: use() registration, custom series [E7][E5] | yes: plugins [C1] | partial: Customized, hooks [RC2] | partial: render transforms [P2] | [unverified] | — (it is the bricks) [X1] | partial: custom bundles [PL1] | yes: extending Highcharts, modules [H1] | yes: hooks and plugins [U1] | — (you own the code) [S1] | [unverified] | [unverified] | yes: registerPlugin / SeriesType / Theme / Easing [AP1] | yes: adapters, plugins, themes [AM2][AM3] | yes: extend Bokeh [B2] | yes: custom layers, extensions, widgets [D1] | no (hosted) [DW1] | partial: create-container [VI2] |
| **tree-shaking / partial bundles** | yes: echarts/core + use() [E7] | yes: register what you use [C4] | [unverified] | [unverified] | [unverified] | yes: per-package installs [X1] | partial: fixed partial bundles + custom bundle tool [PL1][PL2] | yes: modules, custom packages [H1] | — (single ~50 KB file, self-reported) [U1] | yes: copy only what you use [S1] | yes: per-chart packages [N1] | [unverified] | yes: core + per-type / per-feature imports [AP1] | yes: per-module imports [AM2] | [unverified] | yes: scoped modules [D1] | — | yes: per-component packages [VI2] |
| **licence (note only)** | Apache-2.0 [unverified] [E11] | MIT [C5] | MIT [RC1] | open source [P5]; ISC [unverified] | BSD-3 [unverified] | MIT [X1] | MIT [PL1] | commercial [unverified] [FR] | MIT [U1] | MIT [unverified]; Tremor Apache-2.0 [T1] | MIT [unverified] [N1] | Community MIT; Enterprise commercial [AG1] | free under $2M revenue, commercial above; premium features need a key [AP1] | free with logo on charts; commercial removes it [AM2] | BSD-3 [B1] | MIT [unverified] | proprietary hosted service [unverified] [DW1] | MIT [unverified] |
| **machine-readable JSON spec / schema** | partial: option object, but callbacks; no schema seen [E7] | partial: config object with functions [unverified] | no (JSX) [RC1] | no (JS API) [P5] | yes: JSON spec with $schema [V3] | no [X1] | yes: JSON figure; "Figure Reference", with-meta bundle [PL1][PL2][PL3] | partial: options object [H1] | no* [U1] | no [S1] | partial: HTTP API [N1] | partial: options object [AG1] | partial: options object; view-state token [AP1] | yes: JSON config, parser, serializer; AGENTS.md + MCP server [AM1][AM2] | [unverified] | yes: @deck.gl/json converter [D1] | [unverified] | no [VI1] |

## 3. Per competitor: what it does well, and what it deliberately does not do

**ECharts**
- One registration model for everything: 23 series types and about 30 components are separate installable units (`echarts.use`), and the renderer itself is one of them, so an SVG-only build carries no canvas code [E1][E2][E7].
- Server rendering with a hydration path: `ssr: true` plus `renderToSVGString()` needs no DOM, initial animation is embedded as CSS, and a client runtime (under 4 KB, self-reported) re-attaches legend toggling and highlighting without loading the full library [E4].
- Accessibility is real but **off by default and not imported by default**: the generated description and decal patterns need `AriaComponent` and `aria.show: true` [E6].
- Does not ship: word cloud (the extension's README calls itself third-party) [E10]; 3D, globe and WebGL acceleration live in the separate `echarts-gl` pack [E9].

**Chart.js**
- A written performance checklist: decimation plugin, automatic decimation during draw, `spanGaps`, fixed axis ranges, animation off [C3].
- Runs inside a web worker when given an `OffscreenCanvas`; the docs state the price: DOM-based plugins and mouse interactions will likely not work, and resizing is manual [C3].
- Tree-shakeable by explicit registration of controllers, elements, scales and plugins [C4].
- Does not do accessibility for you: "the `canvas` content will not be accessible to screen readers"; the page author adds `aria-label` or fallback content [C2]. Nine chart types in the docs; no statistical types (box, histogram, heatmap) in the core index [C1].

**Recharts**
- Everything is a React component, including reference marks (`ReferenceLine/Dot/Area`), `ErrorBar` and `Brush`, and v3 exposes hooks for scales, ticks, tooltip state and plot area so custom content can sit inside a chart [RC2].
- Keyboard and screen-reader support are on by default in v3 [FR]; the API index also lists a theme provider with light/dark/auto themes and pattern fills [RC2].
- Deliberately narrow: "Native SVG support, lightweight with minimal dependencies", React only [RC1]. No canvas or WebGL path, no data transforms, no statistical chart types in the API index [RC2].

**Observable Plot**
- A small grammar: 30 marks and 15 transforms (bin, group, window, stack, dodge, hexbin…) compose into charts, with facets as a first-class feature [P1].
- Server rendering through a `document` option: JSDOM in Node, or React's and Vue's virtual DOM [P4].
- States its gaps plainly: selection/brushing "under development", zoom and pan "planned", declarative animation "planned", and no incremental re-rendering: "you can simply throw away an old plot and replace it with a new one" [P2].
- ARIA labels on marks are automatic, but chart-level `ariaLabel` and `ariaDescription` default to null [P3]. No pie/arc mark in the mark list [P1].

**Vega-Lite / Altair**
- The whole chart is a JSON document with a `$schema` property [V3]; transforms (aggregate, bin, calculate, density, fold, loess, regression, pivot, window, impute and more) are part of that document [V1].
- Interaction is declared, not coded: point and interval selections, bound to legends, scales (zoom) or input elements, and resolved across composed views [V1][FR].
- Statistical marks are built in: box plot, error bar and error band can aggregate raw data themselves [V1].
- Not in the docs table of contents: animation, treemap, sankey, network, word cloud, 3D [V1]. Runtime data updates go through the Vega View API, not the spec [V2]. Altair adds the Python face and its own pages for saving charts and large datasets [A1][A2].

**visx**
- Sells bricks: 36 packages (shape, scale, axis, brush, zoom, annotation, pattern, geo, hierarchy, network, sankey, wordcloud, xychart…) installed one by one; "use only the packages you need" [X1][X2].
- Deliberately no animation ("a conscious" choice: use any React animation library) and "largely unopinionated": no finished chart, no data layer [X1].

**Plotly.js**
- Breadth through traces: statistical, 3D, maps, finance and WebGL 2D traces (`scattergl`, `splom`, `parcoords`) in one figure model [PL2][PL3].
- Keeps that affordable with fixed partial bundles (basic, cartesian, geo, gl3d, gl2d, map, finance, strict) plus a custom-bundle tool; self-reported sizes run from 1.2 MB minified (basic) to 4.84 MB (full) [PL1][PL2].
- A figure is plain JSON (`data` + `layout`) with a published figure reference [PL1][PL3]. MathJax renders `$..$` in titles, labels and annotations [PL1].
- The index page lists no accessibility topic, no data transforms and no server-rendering topic [PL3].

**Highcharts**
- The most complete accessibility set seen: keyboard navigation, screen-reader information region, data-table view, pattern fills, Windows High Contrast Mode, voice input, tactile SVG export and sonification ("audio charts") [H2][H1].
- Wide series list (about 50 documented types, including box plot, histogram, bell curve, pareto, parallel coordinates, sankey, network graph, word cloud, venn, 3D variants) and a CSS "styled mode" [H1].
- Breadth is split across products (Stock, Maps, Gantt, Dashboards, Grid) [H1]; the Boost WebGL module trades features for speed [FR]. Commercial licence `[unverified]` [FR].

**uPlot**
- Speed by doing less: Canvas 2D, about 50 KB minified, self-reported 166,650 points in 25 ms from cold start [U1]. Cursor sync, streaming, time zones with DST, hooks and plugins are in the core [U1].
- Has a written "Non-Features" list: no data parsing, aggregation or statistics; no transitions or animations ("always pure distractions"); no tick-label collision avoidance; no built-in drag panning (left to plugins) [U1].

**shadcn/ui charts and Tremor**
- shadcn: "We do not wrap Recharts"; you compose Recharts and own the copied code. `ChartConfig` is "intentionally decoupled from chart data", colours are CSS variables (`--chart-1`…, read as `var(--color-KEY)`), and the chart component now uses Recharts v3 [S1].
- Accessibility is a prop the user turns on (`accessibilityLayer`) [S1].
- Tremor: 11 dashboard visualisations (area, bar, combo, line, donut, bar list, category bar, progress bar/circle, spark chart, tracker), copy-and-paste, Tailwind and Radix, Apache-2.0 [T1][T2]. Neither adds chart types or a data layer beyond Recharts.

**Nivo**
- 31 React components including the rarer ones: bump and area bump, calendar, time range, swarm plot, marimekko, waffle, parallel coordinates, chord, voronoi [N2].
- SVG, HTML and Canvas variants of charts, "Server Side Rendering and HTTP API", patterns and gradients guides, motion through react-spring [N1].
- React only; one package per chart, so combining chart types in one frame is not a listed feature [N1][N2].

**AG Charts**
- Canvas-based with "no third-party dependencies"; React, Angular and Vue 3 packages [AG1].
- The free/paid line is drawn through ordinary features: Community (MIT) has bar, line, area, scatter, bubble, pie, donut, combination, plus accessibility, localisation, tooltips, legend, cross lines. Enterprise (commercial) holds box plot, histogram, heatmap, candlestick, radar, treemap, sunburst, sankey, waterfall, maps, and also animation, zoom, navigator, synchronisation, crosshairs, annotations, error bars and the context menu [AG1].

**ApexCharts**
- Import-level bundles: `apexcharts/core` plus one import per chart type and per feature (legend, toolbar, exports, annotations, keyboard…); self-reported "30-60% smaller" [AP1].
- Server rendering with hydration (`renderToHTML` on the server, `hydrate` on the client), CSS custom properties (`--apx-*`) as theme tokens, and a plugin API (`registerPlugin`, `registerSeriesType`) [AP1].
- SVG first, with an opt-in canvas layer for dense series; no WebGL [AP1].
- Licence is revenue-based (free under $2M), and a set of features needs a key and shows a watermark without one: small multiples (trellis), crossfilter, undo/redo, shareable view state, on-chart annotation editing, measure ruler, context menu, unit and raincloud charts [AP1].

**amCharts 5**
- Charts from JSON: a config can build a chart through `JsonParser` or the `<am5-chart>` element, a running chart can be saved as one, and a config is "read as data" unless `trusted: true` is set [AM2].
- Ships for agents: `AGENTS.md`, a per-chart reference in the npm package, and a hosted MCP server [AM1].
- Export covers PNG, JPG, SVG, PDF, CSV, XLSX, JSON, HTML and print; 31 themes including colour-blind-friendly and responsive ones; packages for React, Vue, Angular, Svelte and React Native [AM1][AM2].
- Canvas by default with an SVG renderer option [AM1]. Free licence requires the amCharts logo on charts [AM2]. Statistical types (box, histogram, violin) are not in the chart list [AM2].

**Bokeh**
- Linking is a data-model property, not code: sharing range objects links pan and zoom, sharing a data source links brushing [B9]. Tools, widgets, and JavaScript or Python callbacks sit on top [B5].
- Statistical plots are **assembled from glyphs** (histogram from `quad`, box plot from `Whisker` + `vbar` + `scatter`, KDE from `varea`), not chart types [B7].
- WebGL is described as "limited support": a glyph subset, with dashed lines ignored for fixed-shape glyphs, falling back to canvas [B8]. Python-first; BokehJS is the advanced path [B2].

**deck.gl**
- GPU first: WebGL2/WebGPU layers for large data, with CPU and WebGL aggregators (grid, hexagon, contour, heatmap, screen grid) and extensions for brushing, data filtering, collision filtering and fill patterns [D1][D2].
- A JSON converter module (`@deck.gl/json`) and a globe view [D1].
- Not a charting library: the layer catalogue has no axes, legends or statistical chart types [D1].

**Datawrapper**
- Accessibility as a default of a hosted tool: without alt text a chart announces its type and summaries of axes, legend and annotations; with alt text the chart body is `aria-hidden` [DW2]. A "chart explorer" gives arrow-key access to every tooltip, with movement rules per chart type [DW3].
- Authoring-time checks: a colour-blind simulator and checker, automatic label contrast, text annotations that move below the chart on mobile, overlap detection "where possible" when browser font size grows [DW1][DW2][DW3].
- Not a library: no plugin API, export named on the charts page is PNG only, and the accessibility page cites no WCAG level and says nothing on forced-colors or reduced motion [DW1][DW2].

**Victory**
- Interaction is packaged as containers: zoom, brush, selection, cursor and voronoi containers, composable through `create-container`, with shared events across charts [VI2].
- Statistical basics as components: box plot, histogram, error bar, candlestick [VI2]. An accessibility guide and `VictoryAccessibleGroup` exist [VI3]; React Native has a separate rewrite (Victory Native XL) [VI1].
- 27 packages, no hierarchy, flow, geo or network charts [VI2].

## 4. Capabilities seen in competitors that are NOT in the row list

| Capability | Who has it | Source |
| --- | --- | --- |
| Drill-down (and breadcrumb navigation) | ECharts (how-to), Highcharts (drilldown, breadcrumbs, map drill-down), ApexCharts (opt-in feature), amCharts 5 (hierarchy and map drill-down, breadcrumbs) | [E3] [H1] [AP1] [AM3] |
| Rich text / templated labels | ECharts (rich text), Highcharts (labels, string formatting, templating), amCharts 5 (text styling, data placeholders), Plotly (MathJax in titles, labels, annotations) | [E3] [H1] [AM3] [PL1] |
| Label collision avoidance | ECharts 6 (axis label optimisation), Highcharts (series-label module), deck.gl (CollisionFilterExtension), Datawrapper (overlap detection "where possible"); uPlot states it has none | [E5] [H1] [D1] [DW3] [U1] |
| Responsive rules | Highcharts (responsive), Chart.js (responsive config), amCharts 5 (Responsive and ResponsiveMax themes), Recharts (ResponsiveContainer), visx (responsive package), Plotly (responsive layouts), ECharts (mobile guides), Datawrapper (annotations move below the chart on mobile) | [H1] [C1] [AM2] [RC2] [X2] [PL3] [E3] [DW1] |
| i18n / locales | Chart.js (locale), Vega-Lite (locale config), Highcharts (internationalisation, including accessibility strings), amCharts 5 (locales, right-to-left), AG Charts (localisation), Plotly (locale bundles), Datawrapper (translated footer link) | [C1] [V1] [H1][H2] [AM3] [AG1] [PL2] [DW2] |
| Time zones and DST | uPlot (IANA names, DST), Vega-Lite (UTC time), Altair (Times & Dates page) | [U1] [V1] [A2] |
| Broken axis | ECharts 6, Highcharts (broken-axis module) | [E5] [H1] |
| Scatter jitter / beeswarm / dodge | ECharts 6 (jittering, beeswarm), Observable Plot (dodge transform), Nivo (SwarmPlot), ApexCharts (beeswarm, paid) | [E5] [P1] [N2] [AP1] |
| Automatic mark choice | Observable Plot (auto mark) | [P1] |
| Input widgets bound to chart parameters | Vega-Lite (bind), Altair (bindings and widgets), Bokeh (widgets), Plotly (dropdown, button, slider), ECharts (timeline component), deck.gl (widgets) | [V1] [A2] [B5] [PL3] [E2] [D1] |
| Dashboards and crossfilter | Highcharts Dashboards (synchronised components), ApexCharts (crossfilter, paid), Bokeh (shared data sources, server), Vega-Lite (selections as filters) | [H1] [AP1] [B9][B2] [V1] |
| Undo / redo, shareable view state, measure ruler, context menu | ApexCharts (paid); context menu also in AG Charts (paid) and deck.gl (widget) | [AP1] [AG1] [D1] |
| On-chart annotation authoring / drawing tools | Highcharts (annotations GUI, freeform drawing, stock tools), amCharts 5 (annotator, stock drawing control), AG Charts (financial annotations), ApexCharts (ink layer, paid) | [H1] [AM3] [AG1] [AP1] |
| Scrollytelling tied to saved views | ApexCharts (storyboard, paid) | [AP1] |
| Technical indicators and stock tooling | Highcharts Stock, amCharts 5 Stock (over 30 indicators), AG Charts financial charts, Observable Plot (Bollinger mark) | [H1] [AM1] [AG1] [P1] |
| Gantt / timeline / range bars | Highcharts Gantt, amCharts 5 (Gantt, timeline), ApexCharts (range bar / timeline), Nivo (TimeRange) | [H1] [AM2] [AP1] [N2] |
| Pictorial, unit and waffle charts | ECharts (pictorial bar), Highcharts (item, pictorial), Nivo (waffle), Observable Plot (waffle mark), ApexCharts (unit, paid) | [E1] [H1] [N2] [P1] [AP1] |
| Stream graph, chord, arc, venn, marimekko | ECharts (theme river, chord), Highcharts (stream graph, dependency wheel, arc diagram, venn, variwide), Nivo (stream, chord, marimekko), amCharts 5 (chord, arc, venn), AG Charts (chord, paid) | [E1][E5] [H1] [N2] [AM2] [AG1] |
| Marker clustering on maps | Highcharts, amCharts 5 (clustered point series), deck.gl (carto cluster layer) | [H1] [AM3] [D1] |
| Special legends | Highcharts (bubble legend), amCharts 5 (heat legend), ECharts (visualMap), Tremor (legend slider), uPlot (legend with live values) | [H1] [AM3] [E2] [T2] [U1] |
| Voice input and tactile (embosser) export | Highcharts | [H2] |
| Colour-blind check at authoring time | Datawrapper | [DW2] |
| Dynamic font scaling with the reader's browser font size | Datawrapper (custom themes with relative units) | [DW3] |
| Announcing live data changes to screen readers | Highcharts (accessible dynamic data) | [H1][H2] |
| Theme sets and dark mode | amCharts 5 (31 themes), ECharts 6 (new default theme, dynamic switching, dark mode), ApexCharts (OS-following theme, registered themes), Recharts (light, dark, auto), Highcharts (themes) | [AM1] [E5] [AP1] [RC2] [H1] |
| Packaging for AI agents | amCharts 5 (AGENTS.md, per-chart reference, MCP server), Vega-Lite (JSON Schema), deck.gl (JSON converter) | [AM1] [V3] [D1] |
| Security posture for specs | amCharts 5 (config read as data unless `trusted: true`), ECharts (security guidelines), Highcharts (security page), Plotly (strict CSP bundle) | [AM2] [E3] [H1] [PL2] |
| Debugger mode / named errors | Highcharts (debugger mode), ApexCharts (console line naming the missing import), deck.gl (debugging and test utilities) | [H1] [AP1] [D1] |
| Coarse-pointer and touch handling | ECharts (intelligent pointer snapping), ApexCharts (pinch, two-finger pan, inertia), AG Charts (touch), Observable Plot (nearest-point pointer) | [E3] [AP1] [AG1] [P2] |
| Columnar data input (Arrow) | deck.gl | [D1] |
| Written performance guide | Chart.js, deck.gl | [C3] [D1] |
| Print | Highcharts, amCharts 5 | [H4] [AM1] |
| Lighting and post-process effects | deck.gl | [D1] |
| Test-framework guides | amCharts 5 (Jest, Cypress), deck.gl (test utils) | [AM3] [D1] |

## 5. Sources (all opened 2026-11-19)

Raw GitHub links are the docs source or README in the vendor's own repository.

**ECharts**
- [E1] https://raw.githubusercontent.com/apache/echarts/master/src/export/charts.ts (list of series types)
- [E2] https://raw.githubusercontent.com/apache/echarts/master/src/export/components.ts (list of components)
- [E3] https://raw.githubusercontent.com/apache/echarts-handbook/master/contents/en/posts.yml (handbook index)
- [E4] https://raw.githubusercontent.com/apache/echarts-handbook/master/contents/en/how-to/cross-platform/server.md
- [E5] https://raw.githubusercontent.com/apache/echarts-handbook/master/contents/en/basics/release-note/v6-feature.md
- [E6] https://raw.githubusercontent.com/apache/echarts-handbook/master/contents/en/best-practices/aria.md
- [E7] https://raw.githubusercontent.com/apache/echarts-handbook/master/contents/en/basics/import.md
- [E8] https://raw.githubusercontent.com/apache/echarts-doc/master/en/option/series/line.md
- [E9] https://raw.githubusercontent.com/ecomfe/echarts-gl/master/README.md
- [E10] https://raw.githubusercontent.com/ecomfe/echarts-wordcloud/master/README.md
- [E11] https://raw.githubusercontent.com/apache/echarts/master/README.md

**Chart.js**
- [C1] https://raw.githubusercontent.com/chartjs/Chart.js/master/docs/.vuepress/config.ts (docs and samples sidebar)
- [C2] https://raw.githubusercontent.com/chartjs/Chart.js/master/docs/general/accessibility.md
- [C3] https://raw.githubusercontent.com/chartjs/Chart.js/master/docs/general/performance.md
- [C4] https://raw.githubusercontent.com/chartjs/Chart.js/master/docs/getting-started/integration.md
- [C5] https://raw.githubusercontent.com/chartjs/Chart.js/master/README.md

**Recharts**
- [RC1] https://raw.githubusercontent.com/recharts/recharts/main/README.md
- [RC2] https://recharts.github.io/en-US/api (API index; summarised fetch)

**Observable Plot**
- [P1] https://raw.githubusercontent.com/observablehq/plot/main/docs/.vitepress/config.ts (docs sidebar)
- [P2] https://raw.githubusercontent.com/observablehq/plot/main/docs/features/interactions.md
- [P3] https://raw.githubusercontent.com/observablehq/plot/main/docs/features/accessibility.md
- [P4] https://raw.githubusercontent.com/observablehq/plot/main/docs/getting-started.md
- [P5] https://raw.githubusercontent.com/observablehq/plot/main/README.md

**Vega-Lite / Altair**
- [V1] https://raw.githubusercontent.com/vega/vega-lite/main/site/_includes/docs_toc.md (docs table of contents)
- [V2] https://raw.githubusercontent.com/vega/vega-lite/main/site/docs/data.md
- [V3] https://raw.githubusercontent.com/vega/vega-lite/main/site/docs/spec.md
- [V4] https://raw.githubusercontent.com/vega/vega-lite/main/README.md
- [A1] https://raw.githubusercontent.com/vega/altair/main/README.md
- [A2] https://altair-viz.github.io/user_guide/data.html (user-guide navigation; summarised fetch)

**visx**
- [X1] https://raw.githubusercontent.com/airbnb/visx/master/README.md
- [X2] https://raw.githubusercontent.com/airbnb/visx/master/packages/visx-visx/package.json (umbrella package: list of packages)

**Plotly.js**
- [PL1] https://raw.githubusercontent.com/plotly/plotly.js/master/README.md
- [PL2] https://raw.githubusercontent.com/plotly/plotly.js/master/dist/README.md (bundles and trace lists)
- [PL3] https://plotly.com/javascript/ (docs index; summarised fetch)

**Highcharts**
- [H1] https://raw.githubusercontent.com/highcharts/highcharts/master/docs/sidebars.js (full docs sidebar)
- [H2] https://raw.githubusercontent.com/highcharts/highcharts/master/docs/accessibility/accessibility-module-feature-overview.md
- [H3] https://raw.githubusercontent.com/highcharts/highcharts/master/docs/chart-and-series-types/chart-types.md
- [H4] https://raw.githubusercontent.com/highcharts/highcharts/master/docs/export-module/export-module-overview.md

**uPlot**
- [U1] https://raw.githubusercontent.com/leeoniya/uPlot/master/README.md

**shadcn/ui charts and Tremor**
- [S1] https://ui.shadcn.com/docs/components/chart (summarised fetch)
- [T1] https://raw.githubusercontent.com/tremorlabs/tremor/main/README.md
- [T2] https://www.tremor.so/docs/visualizations/area-chart (page and sidebar; summarised fetch)

**Nivo**
- [N1] https://raw.githubusercontent.com/plouc/nivo/master/README.md
- [N2] https://raw.githubusercontent.com/plouc/nivo/master/website/src/data/nav.ts (component list of the docs site)

**AG Charts**
- [AG1] https://raw.githubusercontent.com/ag-grid/ag-charts/latest/README.md (Community vs Enterprise tables)

**ApexCharts**
- [AP1] https://raw.githubusercontent.com/apexcharts/apexcharts.js/main/README.md

**amCharts 5**
- [AM1] https://raw.githubusercontent.com/amcharts/amcharts5/master/README.md
- [AM2] https://raw.githubusercontent.com/amcharts/amcharts5/master/packages/shared/README.md
- [AM3] https://docs.amcharts.com/v5/ (docs navigation; summarised fetch)

**Bokeh** (branch-3.9 docs source)
- [B1] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/README.md
- [B2] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide.rst
- [B3] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide/topics.rst
- [B4] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide/basic.rst
- [B5] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide/interaction.rst
- [B6] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide/output.rst
- [B7] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide/topics/stats.rst
- [B8] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide/output/webgl.rst
- [B9] https://raw.githubusercontent.com/bokeh/bokeh/branch-3.9/docs/bokeh/source/docs/user_guide/interaction/linking.rst

**deck.gl**
- [D1] https://raw.githubusercontent.com/visgl/deck.gl/master/docs/table-of-contents.json (full docs table of contents)
- [D2] https://raw.githubusercontent.com/visgl/deck.gl/master/README.md

**Datawrapper**
- [DW1] https://www.datawrapper.de/charts (summarised fetch)
- [DW2] https://www.datawrapper.de/academy/how-we-make-sure-our-charts-maps-and-tables-are-accessible (summarised fetch)
- [DW3] https://www.datawrapper.de/blog/keyboard-navigation-dynamic-font-scaling (summarised fetch)

**Victory**
- [VI1] https://raw.githubusercontent.com/FormidableLabs/victory/main/README.md
- [VI2] https://raw.githubusercontent.com/FormidableLabs/victory/main/packages/victory/package.json (umbrella package: list of packages)
- [VI3] https://nearform.com/open-source/victory/docs/introduction (docs navigation; summarised fetch)

**Reused, not re-opened**
- [FR] `git -C /home/user/super-dev-docs show pr/7:docs/60-reference/competitive-review-super-plot.md` (first review; its own sources were opened 2026-11-19). Used for: ECharts canvas/SVG default, Chart.js decimation algorithms, Recharts 3 accessibility defaults, Vega-Lite renderers and selection resolve, visx renderer, Highcharts Boost limits and licence.

**Tried and not readable (nothing taken from them)**
- https://visx.airbnb.tech/ (redirect target of https://airbnb.io/visx/docs; page body is rendered by JavaScript)
- https://raw.githubusercontent.com/highcharts/highcharts/master/README.md (not found)
- shadcn chart docs source on raw.githubusercontent.com (two guessed paths, not found; the published page [S1] was used)
- Direct requests to vendor sites from the sandbox (echarts.apache.org, chartjs.org, vega.github.io, highcharts.com, nivo.rocks, apexcharts.com, amcharts.com, docs.bokeh.org, deck.gl, observablehq.com, plotly.com) were refused by the network policy; the same content was read from the repositories above or through the fetch tool.
- One web search (Datawrapper accessibility) was used only to find the URLs of [DW2] and [DW3].
