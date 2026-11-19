/** A run of same-style dots, in scene pixels (what core's `drawScene` hands the `dots` hook). */
export interface DotRun {
  cx: Float64Array
  cy: Float64Array
  r: Float64Array
}

/** Pixels for a run of dots: a box on the device canvas and its RGBA bytes. */
export interface DotImage {
  x: number
  y: number
  w: number
  h: number
  data: Uint8ClampedArray<ArrayBuffer>
}

/** Above this many device pixels in the dots' bounding box, path drawing is used instead. */
export const MAX_STAMP_PIXELS = 16_000_000

/**
 * Rasterise dots straight into bytes: for each dot, only the pixels it covers, with a one-pixel edge ramp
 * for anti-aliasing. Overlaps keep the larger coverage, which is what filling all the dots as one path does,
 * so the result looks the same as path drawing at a fraction of the cost (no path is built or rasterised).
 * `scale` is device pixels per scene pixel; `width` and `height` are the device canvas size. Null when the
 * dots cover too large an area to stamp (draw them as paths instead); an empty image when none is on canvas.
 */
export function rasterDots(run: DotRun, scale: number, rgb: [number, number, number], width: number, height: number): DotImage | null {
  const n = run.cx.length
  const none: DotImage = { x: 0, y: 0, w: 0, h: 0, data: new Uint8ClampedArray(0) }
  if (!n) return none
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < n; i++) {
    const r = run.r[i] * scale + 1
    const x = run.cx[i] * scale, y = run.cy[i] * scale
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) continue
    if (x - r < x0) x0 = x - r
    if (y - r < y0) y0 = y - r
    if (x + r > x1) x1 = x + r
    if (y + r > y1) y1 = y + r
  }
  const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0))
  const bw = Math.min(width, Math.ceil(x1)) - bx, bh = Math.min(height, Math.ceil(y1)) - by
  if (!(bw > 0 && bh > 0)) return none
  if (bw * bh > MAX_STAMP_PIXELS) return null
  const data = new Uint8ClampedArray(bw * bh * 4)
  const alpha = new Uint8Array(bw * bh)
  for (let i = 0; i < n; i++) {
    const rr = run.r[i] * scale
    const cx = run.cx[i] * scale - bx, cy = run.cy[i] * scale - by
    if (!(rr > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) continue
    const reach = rr + 0.5
    const ya = Math.max(0, Math.floor(cy - reach)), yb = Math.min(bh - 1, Math.ceil(cy + reach))
    for (let py = ya; py <= yb; py++) {
      const dy = py + 0.5 - cy
      const span = reach * reach - dy * dy
      if (span <= 0) continue
      const half = Math.sqrt(span)
      const xa = Math.max(0, Math.floor(cx - half)), xb = Math.min(bw - 1, Math.ceil(cx + half))
      const row = py * bw
      for (let px = xa; px <= xb; px++) {
        const dx = px + 0.5 - cx
        const cov = rr + 0.5 - Math.sqrt(dx * dx + dy * dy)
        if (cov <= 0) continue
        const a = cov >= 1 ? 255 : (cov * 255) | 0
        if (a > alpha[row + px]) alpha[row + px] = a
      }
    }
  }
  const [r, g, b] = rgb
  for (let p = 0, q = 0; p < alpha.length; p++, q += 4) {
    const a = alpha[p]
    if (!a) continue
    data[q] = r
    data[q + 1] = g
    data[q + 2] = b
    data[q + 3] = a
  }
  return { x: bx, y: by, w: bw, h: bh, data }
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()` (what a canvas reports back for any colour) to bytes and alpha. */
export function parseRgb(css: string): { rgb: [number, number, number]; alpha: number } | null {
  const s = css.trim()
  if (s[0] === '#') {
    const h = s.slice(1)
    const full = h.length === 3 || h.length === 4 ? [...h].map(c => c + c).join('') : h
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return null
    const v = (i: number): number => parseInt(full.slice(i, i + 2), 16)
    return { rgb: [v(0), v(2), v(4)], alpha: full.length === 8 ? v(6) / 255 : 1 }
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s)
  if (!m) return null
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return { rgb: [+m[1], +m[2], +m[3]].map(x => Math.max(0, Math.min(255, Math.round(x)))) as [number, number, number], alpha: Math.max(0, Math.min(1, a)) }
}
