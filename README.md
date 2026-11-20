# Super Plot

Statistical charts for people and agents: bar (and lollipop), line, area (and stream graph), scatter, pie, donut, waffle, histogram,
box plot, violin, beeswarm, heatmap, calendar, waterfall, bullet, bump, timeline, radar, treemap, sunburst, sankey, parallel coordinates,
funnel, gauge, word cloud, 3D scatter and surface, and maps (choropleth, bubbles, 3D columns, raised regions, flows; flat or on a globe, drawn with SVG, canvas or WebGL).
Super Plot is the sibling of Super Chart: Super Chart draws financial time series (candles, drawing tools),
Super Plot draws everything else you put in a report or a chat answer.

Status: **local version 0.4.0, not published.** 0.4.0 takes the strengths of 18 competing libraries, row by row, and says for each one
what was built, what was refused and why ([docs/COMPETITIVE.md](docs/COMPETITIVE.md), sources in
[docs/COMPETITORS-2026-11-19.md](docs/COMPETITORS-2026-11-19.md)): 12 more chart types, log scales, error bars and bands, point
annotations, loess trends, bin/window/fold transforms, synced charts, a navigator, drill-down, an export toolbar and CSV, custom
tooltips, sonification, server-rendered SVG that the browser adopts, a colour-blind check, time zones and translatable text.
Round 6 (same version) adds, at the owner's request and each safe by default with its risk documented: gauge, word cloud, 3D scatter and surface, a second value axis, broken axes, an `index` transform and opt-in animated data transitions; an expression language stays refused.
0.3.0 added transforms, zoom/brush, facets, live data and per-chart imports. Licensed under Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)), © SUPER SOLUTION LABS INC. Packages stay `private` (not
published to npm or PyPI) until the owner decides to publish (see [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md)).

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

| Package | What it is | Entry points |
|---|---|---|
| `@supersolutions/super-plot-core` | Spec validation, layout to a serializable scene, SVG string, themes, agent tools. No DOM. | `.` (everything registered), `/base` (nothing registered), chart groups `/charts/basic`, `/charts/business`, `/charts/stats`, `/charts/maps`, `/charts/hierarchy`, `/charts/3d`, `/charts/text` (and `/charts`, every chart), `/transforms`, `/canvas`, `/view`, `/tools`, `/adapters` |
| `@supersolutions/super-plot-web` | `SuperPlot` class (resize, tooltip, hover, legend toggle, zoom, pan, brush, live append, plugins, data table, PNG/SVG export; canvas and WebGL automatically for dense charts and 3D maps; map camera control) and the `<super-plot>` element. | `.`, `/base`, `/element`, `/global` (a `<script>` file) |
| `@supersolutions/super-plot-react` | `<SuperPlot>`: a thin binding over the web class. | `.`, `/base` |

Quick start and agents: the package roots (everything registered). For a page: `/base` plus the groups it draws,
`registerCharts(basicCharts)`; the browser binding with the nine basic charts is 75.8 KB gzip against 147.8 KB for
everything ([INTEGRATION](docs/INTEGRATION.md#import-only-what-you-use) has the table).

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

## Licence

Apache License 2.0. Copyright 2026 SUPER SOLUTION LABS INC. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
