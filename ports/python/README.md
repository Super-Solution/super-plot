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

| Function | What it does |
|---|---|
| `validate_plot(spec)` | `Validation(ok, issues, spec)`; `spec` is the normalised spec when `ok` |
| `require_valid(spec)` | the normalised spec, or `PlotSpecError` (carries `.issues`) |
| `describe_plot(spec)` | plain-language reading, identical to the TypeScript text |
| `chart_types()`, `fields_of(type)` | what charts exist and which fields each takes |
| `linear_ticks`, `nice_domain`, `quantile`, `box_stats`, `bin_edges`, `bin_counts` | the shared numbers |
| `format_value(v, "compact")`, `format_percent(0.25)` | value formats (English) |
| `is_safe_color(value)` | the colour allow-list used for `colors` |

An issue is `{"severity", "code", "path", "message", "hint"?}`. `severity`, `code` and `path` are the stable contract; wording may change.

## Develop

```bash
cd ports/python
PYTHONPATH=src python3 -m unittest discover -s tests    # replays conformance/plot.v1.json
```

From the repository root, `npm run test:ports` runs this and the Go port, and `npm run fuzz:ports` compares ~60,000 random cases per seed. See [`../README.md`](../README.md) for how the ports stay identical to the reference.

`src/super_plot/fields.v1.json` is generated; do not edit it (run `npm run conformance`).
