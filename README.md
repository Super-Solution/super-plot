# Super Plot

Statistical charts for people and agents: bar (and lollipop), line, area (and stream graph), scatter, pie, donut, waffle, histogram,
box plot, violin, beeswarm, heatmap, calendar, waterfall, bullet, bump, timeline, radar, treemap, sunburst, sankey, parallel coordinates,
funnel, gauge, word cloud, 3D scatter and surface, and maps (choropleth, bubbles, 3D columns, raised regions, flows; flat or on a globe, drawn with SVG, canvas or WebGL).
Super Plot is the sibling of Super Chart: Super Chart draws financial time series (candles, drawing tools),
Super Plot draws everything else you put in a report or a chat answer.

Status: **version 0.2.0 (0.1.0 was the first published version).** The four npm packages are `@supersolutions/super-plot-core`,
`-web`, `-react` and `-chat-plugin`; the Python and Go ports are not published (see
[docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md)). Licensed under Apache-2.0 (see
[LICENSE](LICENSE) and [NOTICE](NOTICE)), © SUPER SOLUTION LABS INC.

Before 0.1.0, the library was built locally in six rounds, numbered 0.1.0 to 0.4.0 at the time and never published; the docs
refer to them as rounds 1 to 6 (see [History](#history)). The latest rounds took the strengths of 18 competing libraries, row by row,
and say for each one what was built, what was refused and why ([docs/COMPETITIVE.md](docs/COMPETITIVE.md), sources in
[docs/COMPETITORS-2026-11-19.md](docs/COMPETITORS-2026-11-19.md)). Round 6 added, at the owner's request and each safe by default
with its risk documented: gauge, word cloud, 3D scatter and surface, a second value axis, broken axes, an `index` transform and
opt-in animated data transitions; an expression language stays refused.

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
| `@supersolutions/super-plot-chat-plugin` | A chat plugin: `super.plot` cards in a chat, links in the text that point into them (`ref:sales?x=2026-03`), and agent tools to read, highlight and annotate a plot. | `.` |

Quick start and agents: the package roots (everything registered). For a page: `/base` plus the groups it draws,
`registerCharts(basicCharts)`; the browser binding with the nine basic charts is 84.4 KB gzip against 157.0 KB for
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

## History

The version numbers below were local milestones only; nothing was published under them. The first published version will be 0.1.0.

| Round | Local number then | What it added |
|---|---|---|
| 1–2 | 0.1.0 | The first chart types (bar through sankey), the field DSL, validation, description, agent tools, the canvas renderer, browser tests, Go and Python ports |
| 3 | 0.2.0 | Maps and the WebGL renderer |
| 4 | 0.3.0 | Transforms, zoom and brush, facets, live data, plugins, per-chart imports |
| 5 | 0.4.0 | The competitor review: 12 more chart types, log scales, intervals, sync, toolbar, i18n and more |
| 6 | 0.4.0 | Gauge, word cloud, 3D, dual and broken axes, `index`, data transitions |
| 7 | 0.1.0 | Card references (`resolveRef`, `highlight`, `reveal`), agent annotations, the chat plugin |

## Licence

Apache License 2.0. Copyright 2026 SUPER SOLUTION LABS INC. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
