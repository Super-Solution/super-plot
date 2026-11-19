# Integration

## Agents and MCP

```ts
import { plotTools, getPlotTool } from '@supersolutions/super-plot-core/tools'
const tool = getPlotTool('plot_validate')!
tool.run({ spec })        // { ok, issues: [{ code, path, message, hint, severity }] }
```

Tools: `plot_catalog` (which chart, which fields, an example), `plot_schema`, `plot_validate`, `plot_describe`, `plot_render_svg`.
All have `authority: 'read'`, `inputSchema` (JSON Schema) and `run(args)`, so they can be wrapped by any MCP server or
tool registry in a few lines. Suggested agent loop: `plot_catalog` -> write spec -> `plot_validate` -> fix by `code` and `hint` -> `plot_render_svg`.

## Super Chat

Today Super Chat has a built-in `chart` card. `fromChatChartCard(card)` converts it to a spec so the same data can be drawn by Super Plot:

```ts
import { fromChatChartCard } from '@supersolutions/super-plot-core/adapters'
const { ok, spec, notes } = fromChatChartCard(card)   // notes say what could not be carried over
```

Not carried over, and reported in `notes`: series on the right axis, mixed series types beyond the first, candlesticks (use Super Chart).

Proposal, not done: a `super-plot.chart` card kind in the Apache `super-protocol` (a card is `{ kind, spec }`), and a small chat-plugin
package, mirroring Super Chart's chat plugin. This needs the owner's go because it changes a shared contract.

## Super Chart

- Same palette, same neutrals, same token style (`--sp-*` next to `--sc-*`); see THEMING for `alias`.
- Split of work: price and indicator charts go to Super Chart; distributions, shares, comparisons and correlations go to Super Plot.
- A shared theme package would let both read one source of tokens.

## Other languages

Core is TypeScript. **Go and Python ports exist** in [`ports/`](../ports/README.md): `ValidatePlot` / `validate_plot`, `DescribePlot` / `describe_plot`, and the shared numbers and formats. A backend in either language can take a spec from an agent, return every problem with its `code`, `path` and `hint`, repair-loop it, and write the alt text; the browser or Node draws it.

```go
v := superplot.ValidatePlot(specJSON)   // v.OK, v.Issues, v.Spec (normalised)
alt, err := superplot.DescribePlot(specJSON)
```
```python
v = validate_plot(spec_json)            # v.ok, v.issues, v.spec
alt = describe_plot(spec_json)
```

They do not draw. To add another language (Rust, Java, ...):

1. Accept the same JSON spec; read the fields from `conformance/fields.v1.json` (generated; it is the one source of every chart's fields, ranges, enums and defaults, plus the English currency table), so validation needs no per-chart code.
2. Reproduce `conformance/plot.v1.json`: ticks, nice domains, quantiles, box statistics, histogram bins, number formats, validation codes and paths, normalised specs and descriptions. The contract for an issue is `(severity, code, path)`.
3. Port the few cross-field checks and the per-chart descriptions (each function in the Go and Python ports names the TypeScript one it mirrors), then add the language to `scripts/ports.mjs` and `ports/fuzz`.

Regenerate the data with `npm run conformance`; `npm run test:ports` and `npm run fuzz:ports` check the ports.

## Framework notes

- React: `<SuperPlot spec onSelect onIssues onHiddenChange />`.
- Vue, Svelte, Angular, plain HTML: `<super-plot>`; set `spec` as a property (object) or attribute (JSON string).
- Next.js and SSR: render `renderToSvg` on the server for a static chart, or mount `<SuperPlot>` on the client (the server renders an empty div).
