# Card references and agent annotations (2026-11-20)

The brief: let a chat agent add its own annotations to a Super Plot card, and write text with links such as
`[March was highest](ref:sales?x=2026-03)` where hover or focus highlights that part of the plot and a click or
Enter reveals it. Users drawing on the chart was not wanted. Core and web expose generic calls only; everything
chat-shaped is in a new package, `@supersolutions/super-plot-chat-plugin`. Versions were not touched (0.1.0,
private, nothing published).

| Item | Done? | How | Notes for the owner |
|---|---|---|---|
| The reference shell | Yes, as a marked copy | `packages/core/src/ref.ts` (`parseCardRef`, `formatCardRef`, `CARD_REF_LIMITS`, every message) is the shell of super-protocol PR #6, copied exactly; `ports/python/src/super_plot/ref.py` and `ports/go/superplot/ref.go` port it. All three pass the protocol's own cases, vendored as `conformance/card-ref.v1.json` | Becomes an import once protocol 0.3.0 is published (OPEN-DECISIONS 17). One copy per language: the plugin uses core's |
| What a reference names | Yes | `resolveRef(spec, ref, { hidden })` in `packages/core/src/resolve.ts` works on the transformed rows: `key`, `x`, `y`, `series`; categories, inclusive ranges (`x=80..`, `..5`), ISO dates as whole UTC periods (`2026-03` is March), timeline spans, wide-form series. It answers rows, points, series, annotation keys and a label, or `ref_invalid`, `ref_param_unknown`, `ref_param_unsupported`, `ref_bad_value`, `ref_no_match`, `ref_hidden_series`, `ref_spec_invalid`. Which columns each chart reads is data: `ChartDef.ref` (`RefShape`), exported in `fields.v1.json` `charts[].ref` | Go and Python agree on 143 `refCases` and on `datePeriods`; the differential fuzzer writes about 9,000 random references per seed. The vocabulary and its edges are OPEN-DECISIONS 19 |
| Marks to rows and back | Yes | Every chart's marks carry `Mark.rows` (the rows each mark draws), and line focus entries carry theirs. `matchMarks(scene, rows, series)` finds the marks of a match in any renderer (with rings for line points, never twice for one point); `markRef(spec, scene, mark)` writes the reference of a mark | This is what makes SVG, canvas and WebGL behave the same: the overlay reads the scene, not the renderer |
| Spec fields | Yes | `key` (a row id column; `key_missing`, `key_duplicate`); `annotations[].key`, `note` (at most 2,048 characters) and `by` (`author` or `assistant`). An assistant's annotation shows a glyph, says so in its tooltip and in the description. `maxAnnotations` 50 -> 256 | SPEC.md and the conformance files are regenerated |
| `plot.highlight(ref \| null)` | Yes | Resolves against what is on screen (hidden series count), outlines every matched mark in an overlay `<svg class="sp-ref" aria-hidden>` over the plot (a veil dims the rest; the outline is a dark stroke over a light halo, so not by colour alone), shows the tooltip of the first mark. Idempotent; `null` and Escape clear it. Repainted after every draw, removed during a GPU map move | Above 200 marks the outline is 1 px with no halo; at most 2,000 are outlined. Forced colours: `Highlight` on `Canvas`. Reduced motion: nothing animates (the overlay never does) |
| `plot.reveal(ref)` | Yes | As `highlight`, and: unhides a hidden series it names, leaves a drill-down that hides it, resets the zoom (or a map's camera) when the match is off screen, moves keyboard focus to the first matched point (canvas: the canvas, focused on that point), scrolls the plot into view (`nearest`, smooth unless reduced motion) and announces "Showing ..." in the live region | Resets the zoom rather than panning to the match (OPEN-DECISIONS 19) |
| `onRefChange(ref \| null)` | Yes | Called when the viewer hovers or focuses a mark, with that mark's reference (deduplicated; not during a reveal). `refTarget` sets the target written into it (the card id) | The demo host uses it to light the words that name the hovered bar |
| Element and React | Yes | `<super-plot>` gains `highlight` and `reveal` (`not_mounted` before it is connected) and the `plot-ref` event; React passes `onRefChange` and `refTarget` through | No wrappers |
| The chat plugin | Yes | `packages/integrations/chat-plugin` (Apache-2.0, ESM, `sideEffects: false`, private 0.1.0). `src/card.ts` is protocol PR #5's `super.plot` card, copied exactly and passing its 64 vendored cases. `createPlotChatPlugin(options)` returns a protocol `ChatPlugin` (validated with `validateChatPlugin`); `mounts['super.plot']` returns a handle with `update`, `destroy` and `ref(ref, 'enter' \| 'leave' \| 'activate')` answering `{ ok: true, label }` or `{ ok: false, code, reason }` | Depends on protocol `0.2.0` exactly (OPEN-DECISIONS 21). `ref` on the handle is the 0.3.0 contract (super-chat PR #32), added here ahead of it |
| Agent tools | Yes | `plot_state`, `plot_data` (at most 500 rows), `plot_resolve` (read); `plot_highlight`, `plot_annotate` (draft); `plot_clear_annotations` (act). Each takes an optional `card`; the newest card by default; an unknown id fails with the cards on screen | `plot_annotate` answers `applied` and `rejected` with codes (`key_missing`, `bad_type`, `key_reserved`, `too_many`, the plot's own validation codes, `string_truncated`); a rejected replacement keeps the old annotation; `by: "assistant"` is forced |
| Agent annotations survive a remount | Yes | Kept per card id (or spec source) for the last 64 cards; reset when the card's spec changes | |
| Demo | Yes | `examples/chat/`: a stand-in host, labelled as one on the page, with three cards (bar on SVG, line with zoom, 6,000 dots on canvas), links in the messages, the reverse direction and buttons for each tool | Built with `node scripts/examples.mjs --build` |
| Tests | Yes | `tests/core/refs.test.ts`, the ports' conformance and fuzzing, `tests/web/refs.test.tsx` (13), `tests/plugin/plugin.test.ts` (22, every tool and error path) and the vendored card cases, `tests/e2e/refs.e2e.ts` (9, real Chromium: geometry of the outline over the bar, keyboard, forced colours and reduced motion, canvas, WebGL, zoom reset) | |

## Size

KB gzip, measured by `scripts/size.mjs` on the built packages; budgets raised to the measured sizes.

| Case | Before | After |
|---|---|---|
| core `/base`, no chart | 19.9 | 21.4 |
| core `/base` + bar, validate | 23.9 | 25.2 |
| core `/base` + bar, renderToSvg | 34.4 | 36.2 |
| core `/base` + bar, resolveRef | | 28.5 |
| core `/base` + basic | 54.2 | 56.6 |
| core everything | 124.9 | 127.8 |
| web `/base`, no chart | 40.3 | 48.1 |
| web `/base` + bar + line | 63.3 | 71.5 |
| web `/base` + basic | 75.8 | 84.4 |
| web everything | 147.8 | 157.0 |
| chat plugin (with web and every chart) | | 162.3 |

Web `/base` grew 7.8 KB, 6.3 of it references: the resolver, the shell and the overlay are static because the protocol's `ref()` answer is
synchronous (OPEN-DECISIONS 20).

## Found on the way

- **Rings counted twice.** A line with `points: true` drew a dot and a ring for the same point, so a highlight of
  three months reported six marks; `matchMarks` drops a ring when the dot of that row and series is outlined. Rings
  also matched every series of a long-form line until focus entries carried their rows.
- **A zoomed line claimed every row.** The line's path draws all its rows, so "is the match on screen?" was always
  yes; a match is off screen when no outlined mark has all its rows matched and no ring is drawn.
- **The host's `leave` cleared a reveal.** Focus moving from the link into the plot makes a host send `leave`; the
  plugin now keeps what a click revealed until the viewer moves onto the plot, presses Escape or the host clears.
- **Dense outlines made a blob** on the 6,000-dot scatter; hence the thin outline above 200 marks.

## Left out

- Panning to a match instead of resetting the zoom.
- A separate entry for references (would take 6 KB out of web `/base` at the cost of a call that fails until it is
  imported).
- Chart linkage (a reference into a Super Chart card, or one card lighting another): Super Chart's side
  (OPEN-DECISIONS 18).
- Users drawing on the chart, as asked.
