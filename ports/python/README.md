# super-plot (Python)

The language-neutral half of Super Plot for Python services and agent tooling: **validate** a chart spec, **describe** it in words, and the shared **statistics**. Drawing stays in the TypeScript packages.

Python 3.10+, no dependencies. Not published; the licence and the name on PyPI are the owner's decision.

```python
from super_plot import validate_plot, describe_plot

spec = {"type": "bar", "x": "region", "y": "revenu", "data": [{"region": "APAC", "revenue": 120}]}

result = validate_plot(spec)          # also accepts a JSON string
result.ok                              # False
for issue in result.issues:            # every problem at once
    print(issue["code"], issue["path"], issue.get("hint"))
# no_such_column y Did you mean "revenue"? Available columns: region, revenue.

fixed = {**spec, "y": "revenue"}
describe_plot(fixed)                   # 'Bar chart. 1 category. Highest: APAC (120). Total: 120.'
validate_plot(fixed).spec              # normalised: defaults filled in, values cleaned
```

A spec's `transform` (steps `filter`, `timeUnit`, `aggregate`, `sort`, `top`, `bin`, `window`, `fold`, `index`) is checked and run, as the reference runs it: send raw rows and say "monthly total" in the spec.

```python
monthly = {
    "type": "bar", "x": "month", "y": "revenue",
    "transform": [
        {"timeUnit": {"field": "date", "unit": "month", "as": "month"}},
        {"aggregate": {"groupBy": ["month"], "fields": {"revenue": "sum"}}},
    ],
    "data": [{"date": "2026-01-05", "revenue": 120}, {"date": "2026-01-19", "revenue": 80}, {"date": "2026-02-02", "revenue": 60}],
}
validate_plot(monthly).spec["data"]    # [{'month': '2026-01-01', 'revenue': 200.0}, {'month': '2026-02-01', 'revenue': 60.0}]
describe_plot(monthly)                 # 'Bar chart. 2 categories. Highest: 2026-01-01 (200). Lowest: 2026-02-01 (60). Total: 260.'
```

| Function | What it does |
|---|---|
| `validate_plot(spec)` | `Validation(ok, issues, spec)`; `spec` is the normalised spec when `ok`, and its `data` the rows after `transform` |
| `require_valid(spec)` | the normalised spec, or `PlotSpecError` (carries `.issues`) |
| `describe_plot(spec)` | plain-language reading, identical to the TypeScript text |
| `register_geography(name, data, options)` | make region boundaries (GeoJSON or TopoJSON) available to map charts as `geo: "<name>"`; returns the warnings, raises `GeographyError`. Also `unregister_geography`, `get_geography`, `list_geographies`, `match_region`, `GEO_PRESETS` |
| `apply_transform(steps, rows, issues)` | run transform steps over rows on their own: the new rows, or `None` with the reason appended to `issues`. Also `time_bucket(ms, unit)`, `transform_bin_edges(values, maxbins, step)`, `TRANSFORM_OPS`, `TIME_UNITS`, `AGGREGATE_OPS`, `WINDOW_OPS`, `TRANSFORM_LIMIT` |
| `chart_types()`, `fields_of(type)` | what charts exist and which fields each takes |
| `linear_ticks`, `nice_domain`, `quantile`, `box_stats`, `bin_edges`, `bin_counts` | the shared numbers |
| `log_ticks`, `nice_log_domain` | ticks and round ends of a log axis |
| `kde(values, bandwidth=None)`, `silverman(values)`, `density_peaks(d)` | Gaussian kernel density, as the violin draws and describes it: `{"bandwidth", "grid", "density"}` |
| `loess(xs, ys, bandwidth, grid)` | the scatter's LOESS trend line |
| `waffle_cells(values, cells)` | cells per category of a waffle (largest remainder) |
| `cloud_layout(words, width, height, measure)` | where a word cloud puts each word: whole-pixel boxes on a spiral, or `None` for a word that did not fit. `measure(text, size)` is the host's text width |
| `format_value(v, "compact")`, `format_percent(0.25)`, `format_duration(ms)` | value formats and durations (English). `super_plot.text.format_exact(v)` is the full value, up to 10 decimals, that the 3D charts' descriptions print |
| `is_safe_color(value)` | the colour allow-list used for `colors` |

An issue is `{"severity", "code", "path", "message", "hint"?}`. `severity`, `code` and `path` are the stable contract; wording may change. `severity` is `error`, `warning` or `info`: an `info` issue (`dual_axis`, `axis_break`, `perspective_3d`) is a note for whoever reads the chart, and the spec is still valid.

Round 6 is covered: `gauge`, `wordcloud`, `scatter3d` and `surface` (with `projection` and the `camera` of a 3D view), a second value axis (`yRight`, `yRightLabel`, `rightDomain`, `formatRight`) and a broken one (`yBreak`) on bar, line and area, with their refusals and the sentences they add to a description, and the `index` transform step.

All 31 chart types are covered. Descriptions read dates in UTC (the reference's `timeZone` is a render option the ports do not take). The statistics agree with the reference to the last bit: `_fdlibm.py` computes `exp`, `log10`, `cbrt` and powers the way the reference's JavaScript engine does, which is not always what `math` returns.

## Develop

```bash
cd ports/python
PYTHONPATH=src python3 -m unittest discover -s tests    # replays conformance/plot.v1.json
```

From the repository root, `npm run test:ports` runs this and the Go port, and `npm run fuzz:ports` compares ~82,000 random cases per seed. See [`../README.md`](../README.md) for how the ports stay identical to the reference.

`src/super_plot/fields.v1.json` is generated; do not edit it (run `npm run conformance`).
