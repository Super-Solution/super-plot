# Round 5, work package 9: what the web binding costs a page (P25: measure and publish misses)

Measured with `npm run size` on master `cb1b021` (0.4.0 as merged), after this change, and on the 0.3.0 tree
(`39c86b3`, same script). The table is in DESIGN.md, Performance.

| Item | Done? | How | Saving (static bundle, `web /base + bar + line`) | Notes for the owner |
|---|---|---|---|---|
| Navigator (`navigator: true`) | Yes | `navigator.ts` is a chunk (`chunk()` in `plot.ts`, the pattern of `loadGl`); `NAV_HEIGHT`, `NAV_TYPES` and `navigable()` moved to the tiny static `navigable.ts` | 8.3 KB minified | The plot puts an empty `.sp-nav` of the same height in place at the first draw and swaps in the real strip when the chunk is here: no layout shift (checked in Chromium on the built dist: host 404 px before and after). |
| Toolbar (`toolbar`) | Yes | `toolbar.ts` (a `Toolbar` class: buttons, labels, states; `download`) is a chunk. Which buttons a chart gets and what they do stay in `plot.ts` | 1.5 KB | `data-toolbar` is set at once, so the map buttons take their place below the toolbar from the first draw instead of moving. The buttons float over the chart. |
| Map controls (drag, pinch, wheel, keys, zoom buttons) | Yes (not on the list: found with the metafile) | `map-control.ts` (`MapControl`) is a chunk fetched with the first map; the camera state, `setCamera`, `getCamera`, `resetCamera` and `onCameraChange` stay in `plot.ts`, synchronous | 4.3 KB | Before the chunk is here (a few ms) the map is drawn but not yet focusable or draggable. `makeView` and friends stay in the static bundle anyway: see the esbuild note below. |
| `plot.ready()` | Yes, public | Settles when every chunk the plot needs for what it shows now is loaded and drawn (navigator, toolbar, map controls, WebGL); never rejects | | Documented in INTEGRATION.md ("Loaded on demand"). Tests that read the toolbar, the strip or the map buttons right after construction now `await plot.ready()`. Reachable from React through the ref and from `<super-plot>` through `instance`. |
| `load_failed` warning | Yes | A chunk that cannot be fetched is reported once through `onIssues`; the next draw tries again | | New web issue code (warning). |
| Sonification (`sonify()`, toolbar 'sound') | Built, measured, reverted | | none | Its bulk is the note plan, which is the public `sonifyNotes` export of `/base`. esbuild assigns files to chunks before tree shaking: a file reached both statically (the re-export) and from a dynamic import goes into a shared chunk that the main bundle imports, so with the export in place the whole of `sound.ts` stayed static (measured: 191.3 KB minified with the split against 190.2 KB without). Splitting only `playNotes` (0.8 KB minified) needs a pending controller and an AudioContext started inside the click, which cost the same 0.8 KB in `plot.ts`. So `sonify()` is unchanged and fully synchronous. To really drop it the export would have to leave `/base` (a breaking change): owner's call. |
| Drill-down UI | Not split | | about 1 KB | On by default for multi-level treemaps and sunbursts (not opt-in), and it answers clicks and Escape synchronously; a chunk would need preloading on every such chart for little gain. |
| Colour-vision check in core (`util/cvd.ts`, 2.6 KB minified) | Not moved | | | It already runs only when the spec sets `colors`, but core is synchronous and has no loader, so its maths has to be static. A registration hook (like charts) would work but is new API for a 1 KB gzip saving. |
| Canvas renderer (`canvas.ts` + `stamp.ts`, 13.5 KB minified) | Not split: largest remaining candidate | | would be ~4.5 KB gzip | `auto` picks canvas above 4,000 marks, so a chunk means the first frame of a big chart is blank or SVG until it loads, `getRenderer()` and `afterDraw` plugins see SVG first. That is a visible behaviour change; left to the owner. Core's `drawScene` would stay static (a public export). |
| Zoom and brush gestures (`interact.ts`, 11.6 KB minified) | Not split | | an estimated 7 KB of it is gesture code | `getZoom`/`setZoom`/`getBrush`/`setBrush` and the view every draw uses are synchronous; splitting needs the state half of `AxisControl` separated from its pointer and key handlers. Doable, but a refactor of the most tested interaction code, not an easy win. |
| Stylesheet (8.7 KB minified, doubled since 0.3.0) | Not split | | about 2.5 KB of feature rules | Per-chunk style injection would mean several `<style>` tags and splitting the print, forced-colors and coarse-pointer blocks: micro-golf. |

**esbuild note.** A chunk that imports from core (`makeView` in the map controls and the WebGL layer) does not
take that code with it: core's `/base` re-exports it, so it is reachable statically and lands in the static
bundle. That is why `geo/view.ts` (3.7 KB minified) is still in `web /base + bar + line` (it already was in
0.3.0, through the WebGL chunk). Moving it would mean core entry points that do not re-export the geo maths.

**What still grew (inherent):** new transform steps, schema fields, bar options, the English UI strings table,
date handling, the colour-vision check, and eleven chart types under "everything". Numbers in DESIGN.md.

**Checked in a real browser** (Chromium on the built `dist`, import map for core): the navigator, toolbar and
map-control chunks are fetched only by pages that use them, the strip keeps its height, dragging a navigator
handle zooms, the CSV button downloads, dragging, the zoom button and arrow keys move a map (three camera
events). `super-plot.global.js` inlines every chunk.
