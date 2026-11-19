/** A 2D context that records nothing and draws nothing: jsdom has none (real pixels: tests/e2e). */
export function stub2d(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = { globalAlpha: 1 }
  for (const k of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'fill', 'stroke', 'fillRect', 'clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'setTransform', 'scale', 'rect', 'clip', 'strokeRect', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse']) ctx[k] = () => {}
  ctx.measureText = (t: string) => ({ width: t.length * 6 })
  ctx.isPointInPath = () => false
  ctx.isPointInStroke = () => false
  return ctx as unknown as CanvasRenderingContext2D
}
