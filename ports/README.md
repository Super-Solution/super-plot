# Ports

Super Plot's reference implementation is TypeScript (`packages/`). These are the other languages.

| Port | Path | Needs |
|---|---|---|
| Python | [`python/`](python/) | Python 3.10+, no dependencies |
| Go | [`go/`](go/) | Go 1.22+, standard library only |

## What a port is (and is not)

A port is **the half of Super Plot a backend needs**:

- `validate_plot` / `ValidatePlot`: check a spec and get every problem at once, each with a stable `code`, a `path` and a `hint`. This is how an agent's chart gets repaired in one round trip.
- `describe_plot` / `DescribePlot`: the plain-language reading of a chart (also its alt text), identical to the TypeScript text.
- The shared numbers: ticks, nice domains, quantiles, box statistics, histogram bins, value formats (`compact`, `percent`, `currency:USD`...).

**A port does not draw.** Drawing (the scene, SVG, canvas, hover) stays in the TypeScript packages. A Go or Python service validates and describes; the browser, or Node, draws. A native renderer in a second language is a separate, much larger piece of work: see `docs/OPEN-DECISIONS.md`.

English is the only formatting locale in the ports; other locales fall back to it.

## How they stay identical

Three layers, all run by `npm run gate`:

1. **One source for fields.** `conformance/fields.v1.json` (generated from the TypeScript chart definitions) holds every chart's fields, their kinds, ranges, enums and defaults, plus the English currency table. Both ports embed a copy; validation is data-driven, so adding a field or a chart type does not mean rewriting validation by hand. `npm run conformance` regenerates it and `--check` fails the gate when a copy is stale.
2. **Conformance data.** `conformance/plot.v1.json` holds about 1,500 cases made by the TypeScript implementation: ticks, quantiles, box stats, bins, 1,370 number and percent formats (every English currency included), every chart's example, 132 validation cases, 45 extra descriptions, and 46 geographies to read (GeoJSON and TopoJSON, sound and broken). Each port has a test that replays them (`python3 -m unittest`, `go test`).
3. **Differential fuzzing.** `npm run fuzz:ports` generates ~58,000 random numbers and 4,000 random specs of every chart type per seed (messy data included: nulls, numeric strings, dates, unicode, impossible values), asks TypeScript what it says, and compares both ports. It has already paid for itself: it found that `10 ** -4` in V8 is `0.00009999999999999999`, which made the reference's tick step off by one ulp on narrow ranges. The reference now uses an exact power of ten.

The contract for issues is the set of `(severity, code, path)`. Message and hint wording, and the order of issues, are not part of it.

## Maps

Map charts (`choropleth`, `bubble-map`, `column-map`, `flow-map`) join data to a geography: `geo` is an inline GeoJSON FeatureCollection or TopoJSON Topology, or the name of one the host registered with `register_geography` / `RegisterGeography` (the same options as the reference: `object`, `key`, `name`, `disputed`, `aliases`, `attribution`, and the presets). A port reads boundaries the way the reference does, with the same issue codes and limits, but keeps only what validation needs: each region's key, name and disputed flag. Rings are checked and counted, not stored; there are no centroids or bounding boxes.

Three things to know:

- **The registry is per process.** A name registered in the browser is unknown to a Go or Python service until it registers the same data there (`unknown_geography`).
- **Go and the first TopoJSON object.** The reference reads the first object of a Topology unless told otherwise. A decoded Go map has no order, so pass JSON text (a string or bytes) to keep the document's order; for a `map[string]any` the first object is the first in sorted order. Set `Object` to choose.
- **Field names that are also JavaScript object members.** The reference accepts `camera` fields such as `constructor` or `toString` (it looks the name up on a plain object); the ports report `unknown_field`.

## Adding a chart type or a field

1. Change the chart in `packages/core` (its `fields` drive validation).
2. `npm run build && npm run conformance` regenerates the field file and the cases, and copies the fields into both ports.
3. If the chart has a cross-field `check` or a `describe`, port it: `python/src/super_plot/charts.py` and `go/superplot/charts.go` (each function names the TypeScript function it mirrors).
4. `npm run test:ports` (and `npm run fuzz:ports`) must pass.

## Why the ports have `_js.py` / `js.go`

The reference runs on JavaScript semantics, so a few things are reproduced on purpose: `String(1e21)`, `Number(" 0x10 ")`, `toFixed` rounding half up on the exact binary value, UTF-16 string length for truncation, `Intl` rounding the shortest decimal (1.005 with two decimals is 1.01). They live in one file per port, with the reason next to each.
