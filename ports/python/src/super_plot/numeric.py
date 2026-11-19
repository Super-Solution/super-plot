"""Numeric helpers: ticks, quantiles, box statistics, histogram bins. Pure, no dependencies."""
from __future__ import annotations

import math
from typing import Iterable, Sequence

from . import _fdlibm
from ._js import pow10, to_fixed

_E10 = math.sqrt(50)
_E5 = math.sqrt(10)
_E2 = math.sqrt(2)


def tick_step(start: float, stop: float, count: float) -> float:
    """A "nice" step (1, 2 or 5 times a power of ten) giving about `count` intervals."""
    step0 = abs(stop - start) / max(1, count)
    if not (step0 > 0) or not math.isfinite(step0):
        return 1.0
    step1 = pow10(math.floor(_fdlibm.log10(step0)))
    err = step0 / step1
    if err >= _E10:
        step1 *= 10
    elif err >= _E5:
        step1 *= 5
    elif err >= _E2:
        step1 *= 2
    return step1


def _decimals(step: float) -> int:
    return max(0, -math.floor(_fdlibm.log10(step) + 1e-9))


def linear_ticks(a: float, b: float, count: float) -> list[float]:
    """Round-number tick values inside [a, b]."""
    if a == b:
        return [a]
    lo, hi = min(a, b), max(a, b)
    step = tick_step(lo, hi, count)
    dec = _decimals(step)
    first = math.ceil(lo / step - 1e-9)
    last = math.floor(hi / step + 1e-9)
    return [float(to_fixed(i * step, dec)) for i in range(first, last + 1)]


def nice_domain(a: float, b: float, count: float) -> tuple[float, float]:
    """Expand [a, b] outwards to tick boundaries."""
    if a == b:
        if a == 0:
            return (0.0, 1.0)
        pad = abs(a) * 0.1
        return (a - pad, b + pad)
    lo, hi = min(a, b), max(a, b)
    for _ in range(2):
        step = tick_step(lo, hi, count)
        nlo = math.floor(lo / step + 1e-9) * step
        nhi = math.ceil(hi / step - 1e-9) * step
        if nlo == lo and nhi == hi:
            break
        lo, hi = nlo, nhi
    dec = _decimals(tick_step(lo, hi, count)) + 1
    return (float(to_fixed(lo, dec)), float(to_fixed(hi, dec)))


def extent(values: Iterable[float]) -> tuple[float, float] | None:
    lo, hi = math.inf, -math.inf
    for v in values:
        if v < lo:
            lo = v
        if v > hi:
            hi = v
    return (lo, hi) if lo <= hi else None


def total(values: Sequence[float]) -> float:
    """Left-to-right sum. Not `sum()`: Python 3.12 sums floats with compensation, JavaScript does not."""
    s = 0.0
    for v in values:
        s += v
    return s


def mean(values: Sequence[float]) -> float:
    return total(values) / len(values) if len(values) else math.nan


def quantile(sorted_values: Sequence[float], p: float) -> float:
    """Quantile of an ascending array, linear interpolation (type 7: the R / NumPy default)."""
    n = len(sorted_values)
    if n == 0:
        return math.nan
    if n == 1:
        return sorted_values[0]
    h = (n - 1) * p
    lo = math.floor(h)
    hi = min(n - 1, lo + 1)
    return sorted_values[lo] + (h - lo) * (sorted_values[hi] - sorted_values[lo])


def correlation(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Pearson correlation; None when undefined (fewer than 2 points or zero variance)."""
    n = min(len(xs), len(ys))
    if n < 2:
        return None
    mx = mean(xs[:n])
    my = mean(ys[:n])
    sxy = sxx = syy = 0.0
    for i in range(n):
        dx = xs[i] - mx
        dy = ys[i] - my
        sxy += dx * dy
        sxx += dx * dx
        syy += dy * dy
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    m, n = len(a), len(b)
    if not m:
        return n
    if not n:
        return m
    prev = list(range(n + 1))
    for i in range(1, m + 1):
        cur = [i]
        for j in range(1, n + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1)))
        prev = cur
    return prev[n]


def closest(word: str, candidates: Sequence[str]) -> str | None:
    """Closest candidate by edit distance, for "did you mean"."""
    best: str | None = None
    best_d = math.inf
    w = word.lower()
    for c in candidates:
        d = levenshtein(w, c.lower())
        if d < best_d:
            best_d, best = d, c
    limit = max(2, len(word) // 3)
    return best if best is not None and best_d <= limit else None


def box_stats(values: Sequence[float]) -> dict | None:
    """Tukey box statistics: whiskers reach the furthest value within 1.5 x IQR of the box."""
    if not len(values):
        return None
    v = sorted(values)
    q1 = quantile(v, 0.25)
    q3 = quantile(v, 0.75)
    iqr = q3 - q1
    lf = q1 - 1.5 * iqr
    hf = q3 + 1.5 * iqr
    inside = [x for x in v if lf <= x <= hf]
    return {
        "n": len(v), "min": v[0], "q1": q1, "median": quantile(v, 0.5), "q3": q3, "max": v[-1], "mean": mean(v),
        "lowWhisker": inside[0], "highWhisker": inside[-1], "outliers": [x for x in v if x < lf or x > hf],
    }


def bin_edges(values: Sequence[float], bins: float | str = "auto", bin_width: float | None = None) -> list[float]:
    """Bin edges that cover [min, max] with round numbers."""
    e = extent(values)
    if not e:
        return [0.0, 1.0]
    lo_v, hi_v = e
    if lo_v == hi_v:
        return [lo_v - 0.5, hi_v + 0.5]
    if bin_width and bin_width > 0:
        step = bin_width
    else:
        if bins == "auto":
            s = sorted(values)
            iqr = quantile(s, 0.75) - quantile(s, 0.25)
            fd = (2 * iqr) / _fdlibm.cbrt(len(s)) if iqr > 0 else 0
            n = math.ceil((hi_v - lo_v) / fd) if fd > 0 else math.ceil(math.log2(len(s))) + 1
            n = min(40, max(5, n))
        else:
            n = bins
        step = tick_step(lo_v, hi_v, n)
    dec = max(0, -math.floor(_fdlibm.log10(step) + 1e-9)) + 1
    lo = math.floor(lo_v / step + 1e-9) * step
    out: list[float] = []
    i = 0
    while lo + i * step < hi_v + step * 1e-9 and len(out) < 400:
        out.append(float(to_fixed(lo + i * step, dec)))
        i += 1
    if out[-1] <= hi_v:
        out.append(float(to_fixed(out[-1] + step, dec)))
    return out


def bin_counts(values: Sequence[float], edges: Sequence[float]) -> list[int]:
    """Count values into [edge_i, edge_i+1); the last bin also includes its upper edge."""
    counts = [0] * (len(edges) - 1)
    for v in values:
        if v < edges[0] or v > edges[-1]:
            continue
        lo, hi = 0, len(edges) - 1
        while hi - lo > 1:
            mid = (lo + hi) >> 1
            if v >= edges[mid]:
                lo = mid
            else:
                hi = mid
        counts[min(lo, len(counts) - 1)] += 1
    return counts


def bin_index(v: float, edges: Sequence[float]) -> int:
    """Index of the bin holding `v` ([edge_i, edge_i+1), the last bin closed), or -1 outside the edges."""
    if not (v >= edges[0]) or not (v <= edges[-1]):
        return -1
    lo, hi = 0, len(edges) - 1
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if v >= edges[mid]:
            lo = mid
        else:
            hi = mid
    return min(lo, len(edges) - 2)


def next_nice_step(step: float) -> float:
    """The next round step after `step`: 1, 2, 5, 10, 20, 50, ... times a power of ten."""
    p = pow10(math.floor(_fdlibm.log10(step) + 1e-9))
    m = step / p
    return (2 if m < 1.5 else 5 if m < 3.5 else 10) * p


def transform_bin_edges(values: Sequence[float], maxbins: float = 10, step: float | None = None) -> list[float]:
    """Edges for the `bin` transform step: `step` when given, otherwise the histogram's round step for `maxbins`,
    made coarser (1, 2, 5 times a power of ten) until there are at most `maxbins` bins."""
    if step is not None:
        return bin_edges(values, maxbins, step)
    edges = bin_edges(values, maxbins)
    guard = 0
    while len(edges) - 1 > maxbins and guard < 60:
        edges = bin_edges(values, maxbins, next_nice_step(edges[1] - edges[0]))
        guard += 1
    return edges


def js_round(x: float) -> float:
    """`Math.round`: to the nearest integer, halves towards plus infinity."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


def r2(v: float) -> float:
    """Two decimals (`r2`): 0 for a non-finite value."""
    return js_round(v * 100) / 100 if math.isfinite(v) else 0.0


# --------------------------------------------------------------------------------------------- log axes


def nice_log_domain(lo: float, hi: float) -> tuple[float, float]:
    """[lo, hi] (both > 0) widened to powers of ten; a single value gets one decade each side."""
    if not (lo > 0) or not (hi > 0):
        return (1.0, 10.0)
    a, b = min(lo, hi), max(lo, hi)
    k0 = math.floor(_fdlibm.log10(a) + 1e-12)
    k1 = math.ceil(_fdlibm.log10(b) - 1e-12)
    if k0 == k1:
        k0 -= 1
        k1 += 1
    return (pow10(k0), pow10(k1))


def log_ticks(a: float, b: float, count: float) -> list[float]:
    """Ticks for a log axis on [a, b] (both > 0): powers of ten, with 2 and 5 times each when the range is short."""
    lo, hi = min(a, b), max(a, b)
    if not (lo > 0) or not math.isfinite(hi):
        return []
    k0 = math.ceil(_fdlibm.log10(lo) - 1e-9)
    k1 = math.floor(_fdlibm.log10(hi) + 1e-9)
    decades = _fdlibm.log10(hi / lo)
    out: list[float] = []
    if decades <= max(1, count / 3):
        for k in range(math.floor(_fdlibm.log10(lo)), math.ceil(_fdlibm.log10(hi)) + 1):
            for m in (1, 2, 5):
                v = float(f"{m}e{k}")
                if lo * (1 - 1e-9) <= v <= hi * (1 + 1e-9):
                    out.append(v)
    else:
        stride = max(1, math.ceil((k1 - k0 + 1) / max(1, count)))
        out = [pow10(k) for k in range(k0, k1 + 1) if (k - k0) % stride == 0]
    if len(out) < 2:
        out = [v for v in linear_ticks(lo, hi, max(2, count)) if v > 0]
    return out


# ---------------------------------------------------------------------------------------------- density

DENSITY_POINTS = 64
MAX_DENSITY_POINTS = 512


def density_points(span: float, h: float) -> int:
    """The grid size `kde` uses by default: clamp(ceil(2 * (max - min) / h) + 1, 64, 512)."""
    return min(MAX_DENSITY_POINTS, max(DENSITY_POINTS, math.ceil((2 * span) / h) + 1)) if h > 0 else DENSITY_POINTS


def silverman(values: Sequence[float]) -> float:
    """Silverman's rule of thumb for a Gaussian kernel: 0.9 * min(sd, IQR / 1.34) * n^(-1/5)."""
    n = len(values)
    if n < 2:
        return 0.0
    v = sorted(values)
    m = 0.0
    for x in v:
        m += x
    m /= n
    ss = 0.0
    for x in v:
        ss += (x - m) * (x - m)
    sd = math.sqrt(ss / (n - 1))
    iqr = (quantile(v, 0.75) - quantile(v, 0.25)) / 1.34
    a = min(sd, iqr) if min(sd, iqr) > 0 else max(sd, iqr)
    return 0.9 * a * _fdlibm.pow(float(n), -0.2)


def kde(values: Sequence[float], bandwidth: float | None = None, points: float | None = None) -> dict | None:
    """Gaussian kernel density estimate on an even grid from the smallest to the largest value.

    Returns {"bandwidth", "grid", "density"}; one grid value with density [1] when all values are equal; None for
    no values. Mirrors `kde` in charts/violin.ts."""
    n = len(values)
    if not n:
        return None
    lo, hi = math.inf, -math.inf
    for x in values:
        if x < lo:
            lo = x
        if x > hi:
            hi = x
    h = bandwidth if bandwidth is not None and bandwidth > 0 else silverman(values)
    if hi == lo or not (h > 0):
        return {"bandwidth": h if h > 0 else 0.0, "grid": [lo], "density": [1.0]}
    k = max(2, math.floor(points if points is not None else density_points(hi - lo, h)))
    norm = 1 / (n * h * math.sqrt(2 * math.pi))
    grid: list[float] = []
    density: list[float] = []
    for i in range(k):
        t = lo + ((hi - lo) * i) / (k - 1)
        s = 0.0
        for x in values:
            u = (t - x) / h
            s += _fdlibm.exp(-0.5 * u * u)
        grid.append(t)
        density.append(s * norm)
    return {"bandwidth": h, "grid": grid, "density": density}


def density_peaks(d: dict) -> list[float]:
    """Grid values where the density has a local maximum of at least a quarter of its highest value."""
    grid, y = d["grid"], d["density"]
    if len(grid) == 1:
        return [grid[0]]
    top = max(y)
    out = []
    for i in range(len(y)):
        left = -math.inf if i == 0 else y[i - 1]
        right = -math.inf if i == len(y) - 1 else y[i + 1]
        if y[i] > left and y[i] >= right and y[i] >= top * 0.25:
            out.append(grid[i])
    return out if out else [grid[y.index(top)]]


# ------------------------------------------------------------------------------------------------ loess

LOESS_GRID = 50


def loess(xs: Sequence[float], ys: Sequence[float], bandwidth: float = 0.3, grid: float = LOESS_GRID) -> list[list[float]]:
    """Locally weighted linear regression (degree 1, tricube weights, no robustness iterations) on an even grid.

    Mirrors `loess` in util/loess.ts step by step; returns [x, fitted y] pairs, [] for fewer than 3 points."""
    pts = [(float(xs[i]), float(ys[i])) for i in range(min(len(xs), len(ys))) if math.isfinite(xs[i]) and math.isfinite(ys[i])]
    if len(pts) < 3:
        return []
    pts.sort(key=lambda p: p[0])
    n = len(pts)
    q = min(n, max(2, math.floor(bandwidth * n)))
    x = [p[0] for p in pts]
    y = [p[1] for p in pts]
    lo, hi = x[0], x[-1]
    count = 1 if lo == hi else max(2, math.floor(grid))
    out: list[list[float]] = []
    l = 0
    for k in range(count):
        g = hi if k == count - 1 else lo + ((hi - lo) * k) / (count - 1)
        while l + q < n and g - x[l] > x[l + q] - g:
            l += 1
        r = l + q - 1
        d = max(g - x[l], x[r] - g)
        sw = swx = swy = 0.0
        w: list[float] = []
        for i in range(l, r + 1):
            wi = 1.0
            if d > 0:
                u = abs(x[i] - g) / d
                wi = 0.0 if u >= 1 else _fdlibm.pow(1 - u * u * u, 3.0)
            w.append(wi)
            sw += wi
            swx += wi * x[i]
            swy += wi * y[i]
        if not (sw > 0):
            s = 0.0
            for i in range(l, r + 1):
                s += y[i]
            out.append([g, s / (r - l + 1)])
            continue
        mx = swx / sw
        my = swy / sw
        sxx = sxy = 0.0
        for i in range(l, r + 1):
            dx = x[i] - mx
            sxx += w[i - l] * dx * dx
            sxy += w[i - l] * dx * (y[i] - my)
        spread = x[r] - x[l]
        out.append([g, my if spread == 0 or sxx <= 1e-12 * sw * spread * spread else my + (sxy / sxx) * (g - mx)])
    return out


# ----------------------------------------------------------------------------------------------- waffle


def waffle_cells(values: Sequence[float], cells: int) -> list[int]:
    """Share `cells` among the positive values by largest remainder; ties go to the earlier value."""
    tot = 0.0
    for v in values:
        tot += v if v > 0 else 0
    if not (tot > 0):
        return [0 for _ in values]
    exact = [(v / tot) * cells if v > 0 else 0.0 for v in values]
    out = [math.floor(e) for e in exact]
    left = cells - sum(out)
    for i in sorted(range(len(exact)), key=lambda i: -(exact[i] - math.floor(exact[i]))):
        if left <= 0:
            break
        out[i] += 1
        left -= 1
    return out


def waffle_grid(cells: float) -> tuple[float, float]:
    """Columns and rows of a waffle: 10 wide up to 100 cells, then 10 tall."""
    cols = max(10, cells / 10)
    return (cols, cells / cols)
