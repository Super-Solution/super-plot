# super-plot (Go)

The language-neutral half of Super Plot for Go services and agent tooling: **validate** a chart spec, **describe** it in words, and the shared **statistics**. Drawing stays in the TypeScript packages.

Go 1.22+, standard library only. Not published; the module path and the licence are the owner's decision (the path below is a placeholder).

```go
import sp "github.com/super-solution/super-plot/ports/go/superplot"

v := sp.ValidatePlot(`{"type":"bar","x":"region","y":"revenu","data":[{"region":"APAC","revenue":120}]}`)
// v.OK == false
for _, i := range v.Issues { // every problem at once
	fmt.Println(i.Code, i.Path, i.Hint)
}
// no_such_column y Did you mean "revenue"? Available columns: region, revenue.

text, err := sp.DescribePlot(spec) // 'Bar chart. 1 category. Highest: APAC (120). Total: 120.'
```

`ValidatePlot` and `DescribePlot` take a JSON string, `[]byte`, a `map[string]any`, or any value `encoding/json` can marshal.

A spec's `transform` (steps `filter`, `timeUnit`, `aggregate`, `sort`, `top`, `bin`, `window`, `fold`) is checked and run, as the reference runs it: send raw rows and say "monthly total" in the spec.

```go
v = sp.ValidatePlot(`{"type":"bar","x":"month","y":"revenue",
  "transform":[{"timeUnit":{"field":"date","unit":"month","as":"month"}},
               {"aggregate":{"groupBy":["month"],"fields":{"revenue":"sum"}}}],
  "data":[{"date":"2026-01-05","revenue":120},{"date":"2026-01-19","revenue":80},{"date":"2026-02-02","revenue":60}]}`)
// v.Spec["data"]: [{month: 2026-01-01, revenue: 200}, {month: 2026-02-01, revenue: 60}]
```

Pass JSON text when you can: when two keys of one transform step are wrong, the reference names the first one written, and a decoded map has forgotten the order (see [`../README.md`](../README.md)).

| Function | What it does |
|---|---|
| `ValidatePlot(spec)` | `Validation{OK, Issues, Spec}`; `Spec` is the normalised spec when `OK`, and its `data` the rows after `transform` |
| `RequireValid(spec)` | the normalised spec, or a `*SpecError` (carries `.Issues`) |
| `DescribePlot(spec)` | plain-language reading, identical to the TypeScript text |
| `RegisterGeography(name, data, opts)` | make region boundaries (GeoJSON or TopoJSON) available to map charts as `"geo": "<name>"`; returns the warnings, or a `*GeographyError`. Also `UnregisterGeography`, `Geographies`, `GeoPresets`, `GeoProperty` |
| `ApplyTransform(steps, rows)` | run transform steps over rows on their own: the new rows, the issues, and whether every step was valid. Also `TimeBucket(ms, unit)`, `TransformBinEdges(values, maxbins, step)`, `TransformOps`, `TimeUnits`, `AggregateOps`, `WindowOps`, `TransformLimit` |
| `ChartTypes()` | the chart types |
| `LinearTicks`, `NiceDomain`, `Quantile`, `ComputeBoxStats`, `BinEdges`, `BinCounts` | the shared numbers |
| `LogTicks`, `NiceLogDomain` | ticks and round ends of a log axis |
| `KDE(values, bandwidth, points)`, `Silverman(values)`, `Density.Peaks()` | Gaussian kernel density, as the violin draws and describes it (bandwidth 0: Silverman's rule; points 0: the default grid) |
| `Loess(xs, ys, bandwidth, grid)` | the scatter's LOESS trend line |
| `WaffleCells(values, cells)` | cells per category of a waffle (largest remainder) |
| `FormatValue(v, "compact")`, `FormatPercent(0.25, 1)`, `ValueFormatter(f)`, `FormatDuration(ms)` | value formats and durations (English) |
| `IsSafeColor(v)` | the colour allow-list used for `colors` |

An `Issue` is `{Severity, Code, Path, Message, Hint}`. `Severity`, `Code` and `Path` are the stable contract; wording may change.

All 27 chart types are covered. Descriptions read dates in UTC (the reference's `timeZone` is a render option the ports do not take). The statistics agree with the reference to the last bit: `fdlibm.go` computes `exp`, `log10`, `cbrt` and powers the way the reference's JavaScript engine does, which is not always what `math` returns.

## Develop

```bash
cd ports/go
go test ./...        # replays conformance/plot.v1.json
go vet ./...
```

From the repository root, `npm run test:ports` runs this and the Python port, and `npm run fuzz:ports` compares ~75,000 random cases per seed (`cmd/fuzzcheck`). See [`../README.md`](../README.md) for how the ports stay identical to the reference.

`superplot/fields.v1.json` is generated; do not edit it (run `npm run conformance`).
