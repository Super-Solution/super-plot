# Maps

Four chart types, all in `@supersolutions/super-plot-core`, drawn by the same renderers as every other chart:

| Type | What it draws | Places come from |
|---|---|---|
| `choropleth` | Regions coloured by a value; `extrude: true` raises them by it (3D) | `region` column joined to `geo` |
| `bubble-map` | A circle per row, sized by `size` | `lat`/`lng` columns, or `region` + `geo` |
| `column-map` | A 3D column per row, height by `value` | `lat`/`lng` columns, or `region` + `geo` |
| `flow-map` | An arc per row from origin to destination, width by `value` | `fromLat`/`fromLng`/`toLat`/`toLng`, or `from`/`to` + `geo` |

Every map takes `view` (`flat` or `globe`), `projection` (`equal-earth`, `mercator`, `equirectangular`; flat only),
`camera` (`{lng, lat, zoom, pitch, bearing}`), `disputed` and `graticule`. Field reference: [SPEC.md](SPEC.md).

## Boundaries: bring your own

**Super Plot ships no boundaries and no default world map.** Which line is drawn where is a political choice, and
datasets disagree; a chart library should not pick a side for every user. You import the boundaries that fit your
audience and your legal position, and Super Plot draws exactly those.

```ts
import { registerGeography, GEO_PRESETS } from '@supersolutions/super-plot-core'

// GeoJSON FeatureCollection or TopoJSON Topology, longitude/latitude in degrees (WGS 84).
const countries = await (await fetch('/data/ne_110m_admin_0_countries.geojson')).json()
const warnings = registerGeography('countries', countries, 'natural-earth-admin0')   // throws GeographyError if unusable

const spec = { type: 'choropleth', geo: 'countries', region: 'iso3', value: 'rate', data: rows }
```

- `geo` is the registered name, or a small GeoJSON/TopoJSON object inline (handy for a one-off or an agent).
- Without options, a region's key is the feature `id`, else `properties.id`, else `properties.name`; its name is
  `properties.name`. Options can name other properties or pass functions: `{ key: 'ISO_A3', name: 'NAME' }`,
  `aliases: { 'Republic of Korea': 'KOR' }`, `object` (which TopoJSON object), `attribution`.
- Rows join by key, name or alias, ignoring case and spacing. Rows that match no region are reported (`region` path), not dropped silently.
- Problems come back with stable codes and paths (`geo_out_of_range` with a hint when the file is in metres,
  `geo_bad_ring`, `duplicate_region`, `geo_feature_skipped`, `geo_no_key`, `too_many_regions`, ...). Slivers and
  points are skipped with a warning; coordinates that are not degrees are an error.
- Limits: 5,000 regions and 1,000,000 vertices per geography. Simplify big files first (for example with mapshaper).
- Longitudes are unwrapped, so a region across the antimeridian is drawn as one shape, not a band across the world.

### Templates (presets)

Templates only tell Super Plot where a common dataset keeps its key, name and disputed flag. They contain no data.

| Preset | Dataset | Key | Notes |
|---|---|---|---|
| `natural-earth-admin0` | Natural Earth countries (public domain) | `ISO_A3`, else `ADM0_A3` | Natural Earth publishes "point of view" editions that draw disputed areas as a given country sees them: pick the one you need. `TYPE` containing "disputed" or "indeterminate" sets the disputed flag. |
| `natural-earth-admin1` | Natural Earth states and provinces | `iso_3166_2`, else `adm1_code` | |
| `world-atlas` | world-atlas TopoJSON (from Natural Earth) | ISO 3166-1 numeric id | object `countries` |
| `geoboundaries` | geoBoundaries (CC BY 4.0) | `shapeISO`, else `shapeGroup`, `shapeID` | Credit it. Its CGAZ composite resolves disputed areas by its own documented rule. |

Check each dataset's licence and its stance on disputed areas before you ship it.

### Disputed areas

The library never decides what is disputed. A region is disputed only when **your data** says so
(`properties.disputed === true` by default, or the preset's rule, or your own `disputed` option). The spec chooses how
to draw those regions:

- `same` (default): exactly like every other region. No judgement is drawn.
- `dashed`: dashed outline.
- `muted`: muted fill and dashed outline.

## Views and the camera

- `flat`: a world projection fitted to the data. `camera.pitch` (0-70) tilts it with perspective so heights read as
  3D; `bearing` turns it. With `extrude: true` the flat view tilts to 40 degrees unless the camera says otherwise.
- `globe`: an orthographic sphere centred on `camera.lng/lat`. The far side is hidden; zoom 1 fits the data.

In the browser the viewer can move the camera (`interactive: true`, the default for maps):

| Gesture | Effect |
|---|---|
| Drag | Pan the flat map, turn the globe |
| Shift + drag | Rotate (bearing) and tilt (pitch, flat view) |
| Ctrl/⌘ + scroll, trackpad pinch, two-finger pinch | Zoom. Plain scrolling still scrolls the page. |
| Arrow keys, Shift + arrows, `+` `-` `0` | Pan, turn/tilt, zoom, reset (the map root is focusable) |
| Buttons (top right) | Zoom in, zoom out, reset |

`plot.getCamera()`, `plot.setCamera({ zoom: 2 })`, `plot.resetCamera()`, the `camera` option and
`onCameraChange(camera)` give the host control. `onCameraChange` fires once per viewer gesture, never for
`setCamera`/`resetCamera`, so two maps can follow each other without a loop. New data on the same map keeps the
viewer's view; a different chart type or geography starts from its own. `<super-plot>` fires `plot-camera`.

On a touch screen an interactive map takes one-finger drags (the page scrolls when the finger starts outside it).
For a map in a long scrolling article, consider `interactive: false`.

## Renderers

The same scene drives SVG, canvas and WebGL:

- **SVG / canvas** project every point in core (`project`) and draw paths: back walls of raised regions are culled,
  columns and raised regions are sorted back to front, everything is clipped to the map. Moving the camera
  recompiles the scene (fine for small and medium geographies).
- **WebGL2** (`renderer: 'webgl'`, or `auto` on a hardware GPU for 3D maps: globe, tilt, columns, arcs, raised
  regions) projects longitude/latitude in the vertex shader with the same numbers (`ViewParams`), with a depth
  buffer, real 3D columns and ribbons for arcs. Moving the camera is a uniform update: nothing is triangulated or
  uploaded again, and the scene is recompiled once when the gesture ends (so tooltips, exports and the accessible
  description match the view). Hover and click pick on the GPU. Triangulation (earcut) is cached per geography.
- The WebGL layer is a separate chunk loaded on first use; a page holds at most 8 WebGL plots (browsers drop the
  oldest context beyond roughly 8-16), the rest stay on canvas. A lost context falls back to canvas. `auto` does
  not pick WebGL on a software rasteriser (SwiftShader, llvmpipe), where canvas is as fast for flat marks.

## Accessibility

Maps keep the same guarantees as other charts: a title and a generated description (`describePlot`), tooltips, legend
buttons, and keyboard camera control. On SVG every data region is a focusable element; on canvas and WebGL the canvas
carries the description and the legend stays real buttons. A map is rarely the best way to rank values: give a sorted
bar chart or a table next to it when exact comparison matters.
