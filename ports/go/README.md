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

| Function | What it does |
|---|---|
| `ValidatePlot(spec)` | `Validation{OK, Issues, Spec}`; `Spec` is the normalised spec when `OK` |
| `RequireValid(spec)` | the normalised spec, or a `*SpecError` (carries `.Issues`) |
| `DescribePlot(spec)` | plain-language reading, identical to the TypeScript text |
| `RegisterGeography(name, data, opts)` | make region boundaries (GeoJSON or TopoJSON) available to map charts as `"geo": "<name>"`; returns the warnings, or a `*GeographyError`. Also `UnregisterGeography`, `Geographies`, `GeoPresets`, `GeoProperty` |
| `ChartTypes()` | the chart types |
| `LinearTicks`, `NiceDomain`, `Quantile`, `ComputeBoxStats`, `BinEdges`, `BinCounts` | the shared numbers |
| `FormatValue(v, "compact")`, `FormatPercent(0.25, 1)`, `ValueFormatter(f)` | value formats (English) |
| `IsSafeColor(v)` | the colour allow-list used for `colors` |

An `Issue` is `{Severity, Code, Path, Message, Hint}`. `Severity`, `Code` and `Path` are the stable contract; wording may change.

## Develop

```bash
cd ports/go
go test ./...        # replays conformance/plot.v1.json
go vet ./...
```

From the repository root, `npm run test:ports` runs this and the Python port, and `npm run fuzz:ports` compares ~60,000 random cases per seed (`cmd/fuzzcheck`). See [`../README.md`](../README.md) for how the ports stay identical to the reference.

`superplot/fields.v1.json` is generated; do not edit it (run `npm run conformance`).
