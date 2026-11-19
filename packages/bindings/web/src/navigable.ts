import type { Scene } from '@supersolutions/super-plot-core/base'

// What the plot needs from the navigator before its code (a chunk loaded on demand) is here: how much room
// to keep for the strip, and whether a chart gets one at all.

/** Height of the overview strip below the chart, in px (the strip itself plus a little air). */
export const NAV_HEIGHT = 44

/** Charts that get a navigator: a continuous x that the viewer can zoom. */
export const NAV_TYPES = ['line', 'area', 'scatter']

/** Does this scene get a navigator? Zoom on a continuous x, one panel, a line, area or scatter chart. */
export function navigable(scene: Scene | null): boolean {
  const a = scene?.axes
  return !!a?.zoom && a.x.kind !== 'band' && !scene!.panels && !scene!.geo && NAV_TYPES.includes(scene!.type)
}
