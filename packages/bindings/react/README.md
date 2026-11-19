# @supersolutions/super-plot-react

```tsx
import { SuperPlot } from '@supersolutions/super-plot-react'
<SuperPlot spec={spec} theme="auto" onSelect={e => ...} onIssues={...} style={{ height: 320 }} />
```

A thin binding: one effect mounts the web `SuperPlot`, props update it, unmount disposes it. Pass `spec` as a stable
object (or `useMemo`); a new object re-renders. The ref is the underlying instance (`toSvg()`, `toPng()`, `getScene()`).
SSR-safe: the server renders an empty div; use `renderToSvg` from core for a static server chart.
