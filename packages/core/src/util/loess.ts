/** LOESS smoothing for scatter trend lines. Pure, no DOM; the Go and Python ports reproduce it step by step. */

/** Points on the evaluation grid. */
export const LOESS_GRID = 50

/**
 * Locally weighted linear regression (LOESS, degree 1, no robustness iterations), evaluated on a fixed grid.
 *
 * 1. Keep the pairs where both x and y are finite numbers. Fewer than 3 pairs: return []. Sort the pairs by x
 *    ascending; equal x keep their input order (a stable sort).
 * 2. n is the number of pairs; q = clamp(floor(bandwidth * n), 2, n) is how many neighbours each fit uses.
 * 3. The grid is `grid` points from the smallest to the largest x: g_k = x_min + (x_max - x_min) * k / (grid - 1),
 *    k = 0 .. grid-1 (the last point is x_max exactly). If x_min = x_max the grid is that one x.
 * 4. For each grid point g, the neighbours are the q consecutive sorted pairs [l, l+q-1] nearest to g: start at
 *    l = 0 and move the window right while l+q < n and g - x[l] > x[l+q] - g (strictly greater, so a tie keeps
 *    the left window). d = max(g - x[l], x[l+q-1] - g).
 * 5. Tricube weights: w_i = (1 - (|x_i - g| / d)^3)^3, or 1 for every neighbour when d = 0.
 * 6. Weighted means mx = sum(w x) / sum(w), my = sum(w y) / sum(w); then sxx = sum(w (x - mx)^2) and
 *    sxy = sum(w (x - mx)(y - my)), every sum taken over the window in sorted order. The fitted value is
 *    my + (sxy / sxx) (g - mx), or my when sxx <= 1e-12 * sum(w) * (spread of x in the window)^2 (or the
 *    spread is 0). If sum(w) = 0 (only possible with q = 2 points at equal distance) the value is the mean of the
 *    window's y.
 *
 * Returns the grid as [x, fitted y] pairs.
 */
export function loess(xs: readonly number[], ys: readonly number[], bandwidth = 0.3, grid = LOESS_GRID): [number, number][] {
  const pts: [number, number][] = []
  const n0 = Math.min(xs.length, ys.length)
  for (let i = 0; i < n0; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push([xs[i], ys[i]])
  if (pts.length < 3) return []
  pts.sort((a, b) => a[0] - b[0])
  const n = pts.length
  const q = Math.min(n, Math.max(2, Math.floor(bandwidth * n)))
  const x = pts.map(p => p[0])
  const y = pts.map(p => p[1])
  const lo = x[0]
  const hi = x[n - 1]
  const count = lo === hi ? 1 : Math.max(2, Math.floor(grid))
  const out: [number, number][] = []
  let l = 0
  for (let k = 0; k < count; k++) {
    const g = k === count - 1 ? hi : lo + ((hi - lo) * k) / (count - 1)
    while (l + q < n && g - x[l] > x[l + q] - g) l++
    const r = l + q - 1
    const d = Math.max(g - x[l], x[r] - g)
    let sw = 0
    let swx = 0
    let swy = 0
    const w: number[] = []
    for (let i = l; i <= r; i++) {
      let wi = 1
      if (d > 0) {
        const u = Math.abs(x[i] - g) / d
        wi = u >= 1 ? 0 : (1 - u * u * u) ** 3
      }
      w.push(wi)
      sw += wi
      swx += wi * x[i]
      swy += wi * y[i]
    }
    if (!(sw > 0)) {
      let s = 0
      for (let i = l; i <= r; i++) s += y[i]
      out.push([g, s / (r - l + 1)])
      continue
    }
    const mx = swx / sw
    const my = swy / sw
    let sxx = 0
    let sxy = 0
    for (let i = l; i <= r; i++) {
      const dx = x[i] - mx
      sxx += w[i - l] * dx * dx
      sxy += w[i - l] * dx * (y[i] - my)
    }
    const spread = x[r] - x[l]
    out.push([g, spread === 0 || sxx <= 1e-12 * sw * spread * spread ? my : my + (sxy / sxx) * (g - mx)])
  }
  return out
}
