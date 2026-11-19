# Round 6, worker B: 3D charts other than maps (`scatter3d`, `surface`)

Borrowed from Plotly (`scatter3d`, `surface`), ECharts GL (`scatter3D`, `surface`, `bar3D`) and Highcharts 3D.
COMPETITIVE.md had this row as refused; the owner asked for it with round 6's rule: safe by default, switchable,
the risk said plainly.

## What was built

| Item | How | Files |
|---|---|---|
| 3D camera and projection | `view3d.ts`: the data sit in a box scaled to [-1, 1] per axis; `pitch`, `bearing`, `zoom` mean what they mean on a map (`flatToScreen`'s rotation, y as north, z as height). The box's bounding sphere fits the plot area, so turning never resizes it. `project3d` documents its algorithm for ports. | `packages/core/src/view3d.ts` |
| `scatter3d` | x, y, z (numbers), `series` (colour and legend), `size` (area), `label`, `dropLines`, `xLabel`/`yLabel`/`zLabel`, `projection`, `camera`. Box with floor grid and two back walls (the ones facing away), ticks and titles on the edges nearest the viewer, drop lines drawn before every point, points in painter's order (far first, ties by row). | `packages/core/src/charts/plot3d.ts` |
| `surface` | One row per point of a regular grid; a tile per grid point (halfway to its neighbours), corner heights averaged from the cells around them, so holes stay holes. Heatmap's sequential scale, legend and `domain`; `mesh` (default on). | same |
| Validation | `no_points`, `incomplete_rows`, `negative_skipped` (size), `drop_lines_dense`, `grid_too_small`, `grid_too_large` (200 x 200), `missing_cells`, `duplicate_cells`; camera: `out_of_range` per field from the field DSL's new `keys`/`limits` on `kind: 'camera'`, and `lng`/`lat` refused with a hint. Severity `'info'` is new (`perspective_3d`). | `schema.ts` |
| Safety | Orthographic default. `info` issue `perspective_3d` on every 3D spec, naming the 2D chart that compares exactly (stronger wording when `perspective` is on). Exact x, y, z (up to 10 decimals) in tooltips and `aria`; the description gives the ranges and the highest and lowest point; the data table has every row (up to the table's usual 1,000). Never rotates by itself. | `plot3d.ts` |
| Keyboard and pointer | Drag turns and tilts; arrows (15 / 10 degrees), + / -, 0, and the map buttons. Tab steps through the points in x, then y order (`scene.view3d.order`) with their tooltip; Shift+Tab back; past the end, the legend. SVG points are a roving `tabindex="-1"`; on canvas the chart keeps focus, outlines the point and reads it out. `interactive: false` keeps Tab. | `map-control.ts`, `plot.ts`, `canvas.ts`, `svg.ts` |
| Docs and checks | INTEGRATION.md section, COMPETITIVE.md row (⛔ to ✅) and "not copied" paragraph, a line in MAPS.md, two gallery entries, 20 validation and 4 describe conformance cases, `camera3d` limits in `fields.v1.json`, 28 core tests, 7 jsdom tests, 3 real-browser tests. | |

## Principle fit

3D is the clearest case of a chart that looks informative and compares badly: depth hides points and one screen
position mixes three values. What makes it acceptable here is that nothing has to be read from the picture: every
value is exact in the tooltip, `aria`, description and table, the keyboard reaches every point in a fixed order,
and the issue list says which 2D chart to use for exact comparison. The picture is for shape (clusters, peaks,
saddles), which is what these charts are good at.

## Limits and refusals

- **No WebGL 3D program.** There is no depth buffer and no GPU camera. Core draws the box as 2D marks in painter's
  order; with `renderer: 'webgl'` the existing instanced dot layer draws the scatter's points (same order, so the
  same picture: checked against canvas in Chromium, under 1% of pixels differ), and the surface, box and drop lines
  stay on canvas. Every turn recompiles the scene (a rAF per frame). A real 3D GL program (depth test, camera
  uniform) is a separate piece of work; it would matter past tens of thousands of points.
- **Painter's order on steep surfaces**: tiles are sorted by their centre's depth, so on a very steep or folded
  surface a tile can overlap a nearer one at some angles. A depth buffer would fix it.
- **No `facet`** (refused as `unknown_field`): small multiples of independently turnable boxes would each need their
  own camera; a shared camera across facets is possible later.
- **No `bar3D`.** A 3D bar hides the ones behind it and its height reads against a slanted floor; a heatmap or
  grouped bars carry the same table exactly. Not built; say if wanted.
- Grid cap 200 x 200 (40,000 tiles); drop lines off above 2,000 points unless asked for.
- Ports (Go, Python) do not know the two charts, the `keys`/`limits` on camera fields or the `'info'` severity yet;
  the regenerated `fields.v1.json` and conformance cases carry them for whoever ports them.

## Decisions the owner may revisit

1. **Camera names**: `pitch`/`bearing` (the map's), not `yaw`/`elevation`. One vocabulary for gestures, events and
   docs; pitch 0 means "from above", as on a map.
2. **`onCameraChange` is typed `Camera | Camera3d`** and `getCamera<C = Camera>()` is generic. A TypeScript
   handler written as `c => use(c.lng)` without an annotation no longer compiles (two tests needed `(c: Camera)`);
   the JavaScript behaviour of maps is unchanged. The maps example's status line now checks `'lng' in c`.
3. **Tab inside the chart**: Tab steps through the data instead of leaving the chart, then moves on past the last
   point (Shift+Tab before the first returns to the chart root). Keyboard users cannot leave without walking the
   points; with many points that is long. An Escape-to-leave or a "skip" hint could be added.
4. **Default view**: pitch 60, bearing 35 (no two box edges overlap).
5. **Duplicate grid cells keep the first value** (warned), rather than averaging.
6. **`perspective_3d` is always emitted**, even in orthographic. It is `info`, so it never blocks or warns, but hosts
   that list every issue will show it.
7. A 3D `Tab` right after a turn that has not been drawn yet draws it first, so the focused point is not replaced
   (found in the real-browser test).
