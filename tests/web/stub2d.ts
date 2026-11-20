/** A 2D context that records nothing and draws nothing: jsdom has none (real pixels: tests/e2e). */
export function stub2d(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = { globalAlpha: 1 }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform', 'scale', 'rect', 'clip', 'strokeRect', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse']) ctx[k] = () => {}
  ctx.measureText = (t: string) => ({ width: t.length * 6 })
  ctx.isPointInPath = () => false
  ctx.isPointInStroke = () => false
  return ctx as unknown as CanvasRenderingContext2D
}

/**
 * Load the canvas renderer, which the plot fetches on demand (its own chunk): canvas plots in the tests that
 * follow then draw at once. The waiting itself is tested in canvas.test.ts.
 */
export async function loadCanvasChunk(): Promise<void> {
  const { SuperPlot } = await import('@supersolutions/super-plot-web')
  // No 2D context during the warm-up (jsdom has none and would log): the chunk loads all the same.
  const had = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
  try {
    const p = new SuperPlot(document.createElement('div'), { type: 'bar', x: 'k', y: 'v', data: [{ k: 'a', v: 1 }] }, { width: 100, height: 100, renderer: 'canvas' })
    await p.ready()
    p.dispose()
  } finally {
    HTMLCanvasElement.prototype.getContext = had
  }
}
