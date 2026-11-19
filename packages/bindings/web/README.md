# @supersolutions/super-plot-web

Mounts a Super Plot spec in the browser: resizes with its host, hover dimming, tooltip, crosshair on line charts,
legend toggle (mouse and keyboard), entrance animation (off under reduced motion), `toSvg()` and `toPng()`.

```ts
import { SuperPlot } from '@supersolutions/super-plot-web'
const plot = new SuperPlot(host, spec, { theme: 'auto', onSelect, onIssues, onHiddenChange })
plot.setSpec(next); plot.setOptions({ theme: 'dark' }); plot.dispose()
```

Dense charts switch to canvas by themselves (`renderer: 'auto'`, above `canvasAbove` data marks, default 4,000); force one with `renderer: 'svg' | 'canvas'`. Hover, tooltip, legend toggle, keyboard access and `toPng()` work the same on both; `toSvg()` always exports SVG. `plot.getRenderer()` says which one is showing.

An invalid spec shows a readable error panel (path, code, hint) instead of an empty box and calls `onIssues`.

## Web component and no-bundler use

```html
<script src="super-plot.global.js"></script>
<super-plot theme="auto" spec='{"type":"donut","label":"source","value":"n","data":[...]}'></super-plot>
```

Events: `plot-select` (detail: datum, series, tip) and `plot-issues` (detail: issues). Works in Vue, Svelte and Angular as is.
Browser only: the constructor touches the DOM. On the server use `renderToSvg` from core.
