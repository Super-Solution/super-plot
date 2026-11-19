# Super Plot

Statistical charts for people and agents: bar, line, area, scatter, pie, donut, histogram, box plot, heatmap, radar, treemap and sankey.
Super Plot is the sibling of Super Chart: Super Chart draws financial time series (candles, drawing tools),
Super Plot draws everything else you put in a report or a chat answer.

Status: **local first version, 0.1.0, not published.** Packages are `private` until the owner decides name and licence
(see [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md)).

```
npm install
npm run gate        # typecheck, tests, build, package check, conformance and spec up to date, ports, real-browser tests
npm run examples    # gallery on http://localhost:5173/  (also /react/ and /element/)
```

## One spec, every surface

```ts
import { renderToSvg } from '@supersolutions/super-plot-core'           // server, no DOM
import { SuperPlot } from '@supersolutions/super-plot-web'              // browser
import { SuperPlot as Plot } from '@supersolutions/super-plot-react'    // React

const spec = {
  type: 'bar', title: 'Revenue by region',
  data: [{ region: 'APAC', Q1: 120, Q2: 138 }, { region: 'EMEA', Q1: 98, Q2: 104 }],
  x: 'region', y: ['Q1', 'Q2']
}
const svg = renderToSvg(spec, { width: 640, height: 360, theme: 'light' })
new SuperPlot(document.getElementById('chart')!, spec, { theme: 'auto', onSelect: e => console.log(e.datum) })
// <Plot spec={spec} theme="dark" onSelect={...} />
// <super-plot spec='{"type":"bar", ...}'></super-plot>   (Vue, Svelte, Angular, plain HTML)
```

| Package | What it is |
|---|---|
| `@supersolutions/super-plot-core` | Spec validation, layout to a serializable scene, SVG string, themes, agent tools. No DOM. |
| `@supersolutions/super-plot-web` | `SuperPlot` class (resize, tooltip, hover, legend toggle, PNG/SVG export; canvas automatically for dense charts) and the `<super-plot>` element. |
| `@supersolutions/super-plot-react` | `<SuperPlot>`: a thin binding over the web class. |

Other languages ([`ports/`](ports/README.md)): **Go and Python** validate a spec, write its plain-language description and compute the shared numbers, identical to TypeScript (they do not draw).

```python
from super_plot import validate_plot, describe_plot
validate_plot(spec).issues   # every problem at once: code, path, hint
describe_plot(spec)          # 'Bar chart. 4 categories, 3 series ...'
```

## Where to read next

- [docs/DESIGN.md](docs/DESIGN.md): how each design principle is met, architecture, known limits.
- [docs/SPEC.md](docs/SPEC.md): every chart type and field (generated from the code).
- [docs/THEMING.md](docs/THEMING.md): restyle with CSS variables, a theme object or the spec.
- [docs/INTEGRATION.md](docs/INTEGRATION.md): agents/MCP, Super Chat, Super Chart, other languages.
- [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md): what the owner still has to decide.
- [AGENTS.md](AGENTS.md): where to change things (for coding agents).
