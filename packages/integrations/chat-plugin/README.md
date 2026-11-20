# @supersolutions/super-plot-chat-plugin

A chat plugin for Super Plot. It shows `super.plot` cards in any chat host that speaks the Super Protocol chat-plugin
contract, answers card references in the conversation, and gives an agent tools to read a plot, point at part of it
and add its own annotations.

```ts
import { createPlotChatPlugin } from '@supersolutions/super-plot-chat-plugin'
const plugin = createPlotChatPlugin({ plot: { toolbar: true } })
// host.register(plugin): plugin.cardKinds, plugin.mounts['super.plot'], plugin.tools
```

**The card** (`super.plot`): `{ kind: "super.plot", id?, title?, height?, spec, alt }`. `spec` is a Super Plot spec,
`alt` one or two sentences saying what it shows. The kind, its fields, `PLOT_LIMITS` and the validator's messages are
a copy of super-protocol 0.3.0's; they become an import once 0.3.0 is published.

**References.** Text such as `[March was highest](ref:sales?x=2026-03)` points into the card whose `id` is `sales`.
The handle's `ref(ref, event)` answers the host: `enter` (hover or focus on the link) highlights the match, `leave`
or `ref(null, "leave")` clears it, `activate` (click, Enter, tap) reveals it: the chart scrolls into view, unhides,
zooms out or leaves a drill-down as needed and moves keyboard focus to the first point. What a click revealed
stays highlighted (the `leave` a host sends as focus moves into the plot does not clear it) until the viewer moves
onto the plot, presses Escape, or the host sends `ref(null, "leave")`. The answer is `{ ok: true, label }` or
`{ ok: false, code, reason }`. What a reference can name is in Super Plot's
INTEGRATION.md ("References and agent annotations").

**Tools** (each takes an optional `card`, the card id; the newest plot on screen by default; an unknown id fails with
the list of cards on screen):

| Tool | Authority | Does |
|---|---|---|
| `plot_state` | read | chart type, description, columns, rows, hidden series, zoom, issues, annotations, highlight |
| `plot_data` | read | the rows drawn, with their index; narrowed by `ref`; at most 500 per call |
| `plot_resolve` | read | what a reference names (rows, series, keys, label) or a code and reason |
| `plot_highlight` | draft | outline what a reference names until the viewer moves; `ref: null` clears |
| `plot_annotate` | draft | add or replace the agent's own annotations by key; `applied` and `rejected` with codes |
| `plot_clear_annotations` | act | remove the agent's annotations (some keys, or all) |

The agent's annotations are always `by: "assistant"` (drawn with a mark and said in the description), sit after the
plot's own, cannot use the key of one of them, and come back when the host remounts the same card. At most 256
annotations per plot, notes of at most 2,048 characters (a longer note is rejected, not cut).

**Options**: `plot` (any `SuperPlotOptions` for every card except `theme`, `locale` and `refTarget`, which the plugin
sets from the host and the card id) and `onChange(card, annotations)` after a tool changed the agent's annotations.
The entrance animation plays once per card; later changes redraw in place. Colours and the font follow the host
theme (`hostTheme`), safe values only.

Apache-2.0.
