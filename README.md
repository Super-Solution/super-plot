# Super Plot

Statistical charts for people and agents: bar, line, area, scatter, pie, donut, histogram, box plot, heatmap, radar, treemap, sankey,
and maps (choropleth, bubbles, 3D columns, raised regions, flows; flat or on a globe, drawn with SVG, canvas or WebGL).
Super Plot is the sibling of Super Chart: Super Chart draws financial time series (candles, drawing tools),
Super Plot draws everything else you put in a report or a chat answer.

Status: **local version 0.3.0, not published.** 0.3.0 adds data transforms, zoom, pan and brush with linked charts, small multiples,
lines over bars, hexagon density, textures, a data table, canvas keyboard access, hover and render events, plugins, live data,
a shadcn theme, per-chart imports and a 3 to 4 times faster 50,000-point scatter on canvas (see [DESIGN](docs/DESIGN.md#borrowed-from-competitors-p27)). Packages are `private` until the owner decides name and licence
(see [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md)).

```
npm install
npm run gate        # typecheck, tests, build, package check, conformance and spec up to date, ports, real-browser tests
npm run examples    # http://localhost:5173/: gallery, features (zoom, brush, live data ...), maps, React, <super-plot>
npm run size        # bundle size per import path
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
| `@supersolutions/super-plot-web` | `SuperPlot` class (resize, tooltip, hover, legend toggle, zoom, pan, brush, live append, plugins, data table, PNG/SVG export; canvas and WebGL automatically for dense charts and 3D maps; map camera control) and the `<super-plot>` element. |
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
- [docs/MAPS.md](docs/MAPS.md): maps, importing your own boundaries (none ship), presets, disputed areas, camera, WebGL.
- [docs/THEMING.md](docs/THEMING.md): restyle with CSS variables, a theme object or the spec.
- [docs/INTEGRATION.md](docs/INTEGRATION.md): importing only what you use, events, zoom and brush, linked charts, live data, plugins, agents/MCP, Super Chat, Super Chart, other languages.
- [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md): what the owner still has to decide.
- [AGENTS.md](AGENTS.md): where to change things (for coding agents).
