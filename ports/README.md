# Ports

Super Plot's reference implementation is TypeScript (`packages/`). These are the other languages.

| Port | Path | Needs |
|---|---|---|
| Python | [`python/`](python/) | Python 3.10+, no dependencies |
| Go | [`go/`](go/) | Go 1.22+, standard library only |

## What a port is (and is not)

A port is **the half of Super Plot a backend needs**:

- `validate_plot` / `ValidatePlot`: check a spec and get every problem at once, each with a stable `code`, a `path` and a `hint`. This is how an agent's chart gets repaired in one round trip.
- `transform`: the data steps of a spec (`filter`, `timeUnit`, `aggregate`, `sort`, `top`, `bin`, `window`, `fold`, `index`) are checked and **run**, exactly as the reference runs them. Column fields are checked against the output, the normalized spec's `data` holds the transformed rows, and the description is written from them.
- `describe_plot` / `DescribePlot`: the plain-language reading of a chart (also its alt text), identical to the TypeScript text.
- The shared numbers: ticks (linear and log), nice domains, quantiles, box statistics, histogram bins, kernel density (Silverman bandwidth, the curve, its peaks), LOESS, waffle cells, the word cloud's layout, value formats (`compact`, `percent`, `currency:USD`...) and durations.

All 31 chart types are covered, with every field of the spec: a second value axis (`yRight`) and a broken one (`yBreak`), the camera and projection of the 3D charts, log axes, intervals (`yLower` / `yUpper`), reference lines and labelled points in `annotations`, `flag` fields (a yes/no column or a list of marked values), `focus` paths on treemap and sunburst, and the per-chart checks and descriptions.

**A port does not draw.** Drawing (the scene, SVG, canvas, hover) stays in the TypeScript packages. A Go or Python service validates and describes; the browser, or Node, draws. A native renderer in a second language is a separate, much larger piece of work: see `docs/OPEN-DECISIONS.md`.

English is the only formatting locale in the ports; other locales fall back to it. Dates in a description are read in UTC: the reference's `describePlot(spec, { timeZone })` is a render option, not part of the spec, and the ports do not take it.

## How they stay identical

Three layers, all run by `npm run gate`:

1. **One source for fields.** `conformance/fields.v1.json` (generated from the TypeScript chart definitions) holds every chart's fields, their kinds, ranges, enums and defaults, plus the English currency table. Both ports embed a copy; validation is data-driven, so adding a field or a chart type does not mean rewriting validation by hand. `npm run conformance` regenerates it and `--check` fails the gate when a copy is stale.
2. **Conformance data.** `conformance/plot.v1.json` holds about 2,000 cases made by the TypeScript implementation: ticks (linear and log), quantiles, box stats, bins, kernel densities, LOESS fits, bin steps, waffle cells, 1,370 number and percent formats (every English currency included), every chart's example, 272 validation cases, 166 transform pipelines (81 that run, with the rows they leave, and 85 that are refused, one for every way a step can be wrong), 87 extra descriptions, and 46 geographies to read (GeoJSON and TopoJSON, sound and broken). Each port has a test that replays them (`python3 -m unittest`, `go test`).
3. **Differential fuzzing.** `npm run fuzz:ports` generates ~76,000 random numbers (6,000 `timeUnit` buckets, 2,000 log axes, 250 kernel densities, 400 LOESS fits, 3,000 durations, 5,500 exact number formats and 300 word cloud layouts among them) and 6,200 random specs of every chart type per seed (messy data included: nulls, numeric strings, dates, unicode, impossible values), asks TypeScript what it says, and compares both ports. Nearly half of the specs carry a `transform`, tidy or wrong on purpose; for those that stay valid the transformed rows are compared too. It has already paid for itself: it found that `10 ** -4` in V8 is `0.00009999999999999999`, which made the reference's tick step off by one ulp on narrow ranges. The reference now uses an exact power of ten.

The contract for issues is the set of `(severity, code, path)`; a severity is `error`, `warning` or `info` (a note that leaves the spec valid). Message and hint wording, and the order of issues, are not part of it.

## Transform

`transform` is a list of at most 10 steps that run before the chart reads its columns. Each step is checked against the columns the step before it left, and the first step that is wrong stops the run with one issue (`bad_transform`, `unknown_field`, `no_such_column`, `missing_required`, `bad_type`, `bad_enum`, `bad_value`, `not_time`, `not_numeric`, `too_many`, `too_many_bins`, `too_many_rows`, `duplicate`); a pipeline that leaves no rows is `empty_after_transform`, and `some_not_time`, `some_not_numeric`, `frame_ignored` and `order_ignored` are warnings. There is no expression step: `calculate` is refused like any unknown step. The details that have to match the reference, and do:

- **Filter.** `range` is `[from, to)`: from inclusive, to exclusive. Bounds and cells are read as numbers first, then as ISO dates. `equal` and `oneOf` compare as text, the way `String()` prints a value.
- **timeUnit.** Buckets are UTC and written as ISO dates (`2026-03-01`; hours as `2026-03-01T10:00:00Z`); weeks start on Monday. Only times from 0001-01-01 to the end of 9999 (`MIN_TIME` / `MinTime` to `MAX_TIME` / `MaxTime`) are bucketed; anything outside counts as not a date. Also on its own as `time_bucket` / `TimeBucket`.
- **Aggregate.** `sum`, `mean`, `median`, `min`, `max`, `count`, `distinct`, plus `count: "<name>"` for the rows per group. Groups keep the type of their value (`1` and `"1"` are two groups; `1` and `1.0` are one), in order of first appearance. Sums add left to right, so the last digit matches too.
- **Sort and top.** Stable; numbers and dates by value before text, text by UTF-16 code unit as JavaScript compares strings, missing values last.
- **Bin.** Adds two columns, the edges of the bin a value falls in (`<field>_start` and `<field>_end` unless `as` names them). The edges are the histogram's round ones: `step` when given, otherwise the round step for `maxbins`, made coarser (1, 2, 5 times a power of ten) until there are at most `maxbins` bins. Also on its own as `transform_bin_edges` / `TransformBinEdges`.
- **Window.** `sum`, `mean`, `count`, `rank`, `pctChange`, `lag`, `lead`, `movingMean` over each `groupBy` group in `sortBy` order (the sort step's order); the rows keep their place. Ranks are competition ranks (1, 2, 2, 4).
- **Index.** Rebases a column to a common start: each value times `base` (100 unless given) over the value of its group's base row, which is the first row in `sortBy` order or the row whose `sortBy` cell equals `at`. A group whose base is missing, zero or not a number is dropped, with a warning (`index_group_dropped`).
- **Fold.** Wide to long: one row per folded column, with its name and its value in two new columns (`key` and `value` unless `as` names them); at most 50 columns and 50,000 rows.

Two things to know:

- **Go and the order of keys.** When two keys of one step are wrong, the reference names the first one written. A decoded Go map has no order, so pass JSON text (a string or bytes) to get the same one; for a `map[string]any` it is the first in sorted order. Everything else is the same either way. In the same way, `aggregate` in Go tells apart cells that are objects by their content, not by the order of their keys. And Go's JSON decoder turns half of a surrogate pair standing alone into U+FFFD, so such text sorts where U+FFFD does.
- **Ranges as dates.** `xDomain`, `yDomain` and `domain` accept ISO date strings and come back in the normalized spec as epoch milliseconds, as in the reference.

## The numbers behind a description

A violin's description names where each group is densest, a log axis decides its ticks by whether a range spans a decade, and a LOESS curve weighs points by `(1 - u^3)^3`. All of these go through `exp`, `log10`, `cbrt` and `**`, and a JavaScript engine does not use the C library for them: V8 carries its own port of fdlibm, whose results differ from glibc's and from Go's `math` in the last bit for a share of inputs (about one `log10` in 200 against glibc, half of all `cbrt`). A last bit is enough to move a peak to the neighbouring grid point. So each port has those five functions written out as V8 computes them (`_fdlibm.py`, `fdlibm.go`), and the fuzzer compares densities, peaks, fits and log ticks for equality, not closeness. V8's `pow` is fdlibm's `e_pow.c` with one line changed, and the ports follow V8.

In Go, every product in that file is rounded on its own (`mul`), because the compiler may otherwise fuse a multiply and an add into one instruction on arm64, ppc64 and s390x, which rounds once instead of twice.

## Maps

Map charts (`choropleth`, `bubble-map`, `column-map`, `flow-map`) join data to a geography: `geo` is an inline GeoJSON FeatureCollection or TopoJSON Topology, or the name of one the host registered with `register_geography` / `RegisterGeography` (the same options as the reference: `object`, `key`, `name`, `disputed`, `aliases`, `attribution`, and the presets). A port reads boundaries the way the reference does, with the same issue codes and limits, but keeps only what validation needs: each region's key, name and disputed flag. Rings are checked and counted, not stored; there are no centroids or bounding boxes.

Three things to know:

- **The registry is per process.** A name registered in the browser is unknown to a Go or Python service until it registers the same data there (`unknown_geography`).
- **Go and the first TopoJSON object.** The reference reads the first object of a Topology unless told otherwise. A decoded Go map has no order, so pass JSON text (a string or bytes) to keep the document's order; for a `map[string]any` the first object is the first in sorted order. Set `Object` to choose.
- **Field names that are also JavaScript object members.** The reference accepts `camera` fields such as `constructor` or `toString` (it looks the name up on a plain object); the ports report `unknown_field`.

## Adding a chart type or a field

1. Change the chart in `packages/core` (its `fields` drive validation).
2. `npm run build && npm run conformance` regenerates the field file and the cases, and copies the fields into both ports.
3. If the chart has a cross-field `check` or a `describe`, port it: `python/src/super_plot/charts.py` and `go/superplot/charts.go` / `charts_more.go` (each function names the TypeScript function it mirrors), and give `ports/fuzz/generate.mjs` a case for the new type so the fuzzer writes specs that are mostly valid. A new field *kind* (as `transform` was) also needs its case in `validate.py` / `validate.go`; `transform.py` / `transform.go` mirror `packages/core/src/transform.ts`.
4. `npm run test:ports` (and `npm run fuzz:ports`) must pass.

## Why the ports have `_js.py` / `js.go`

The reference runs on JavaScript semantics, so a few things are reproduced on purpose: `String(1e21)`, `Number(" 0x10 ")`, `toFixed` rounding half up on the exact binary value, UTF-16 string length for truncation, `Intl` rounding the shortest decimal (1.005 with two decimals is 1.01), and for `transform` the order of `Object.keys`, string comparison by UTF-16 code unit, and what `JSON.stringify` makes of a group's values. They live in one file per port, with the reason next to each. Two more of the same kind: `Math.round` rounds halves up (not to even), and `Intl` prints minus zero as `-0` (so `0 / -27` reads "-0%" in a bullet chart's description, in every language).

One difference remains in Python: `json.loads("-0")` is the integer 0, so a minus zero written without a decimal point loses its sign when a spec arrives as JSON text (`-0.0` keeps it).
