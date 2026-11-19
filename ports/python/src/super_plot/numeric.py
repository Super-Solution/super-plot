"""Numeric helpers: ticks, quantiles, box statistics, histogram bins. Pure, no dependencies."""
from __future__ import annotations

import math
from typing import Iterable, Sequence

from ._js import pow10, to_fixed

_E10 = math.sqrt(50)
_E5 = math.sqrt(10)
_E2 = math.sqrt(2)


def tick_step(start: float, stop: float, count: float) -> float:
    """A "nice" step (1, 2 or 5 times a power of ten) giving about `count` intervals."""
    step0 = abs(stop - start) / max(1, count)
    if not (step0 > 0) or not math.isfinite(step0):
        return 1.0
    step1 = pow10(math.floor(math.log10(step0)))
    err = step0 / step1
    if err >= _E10:
        step1 *= 10
    elif err >= _E5:
        step1 *= 5
    elif err >= _E2:
        step1 *= 2
    return step1


def _decimals(step: float) -> int:
    return max(0, -math.floor(math.log10(step) + 1e-9))


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
            fd = (2 * iqr) / math.cbrt(len(s)) if iqr > 0 else 0
            n = math.ceil((hi_v - lo_v) / fd) if fd > 0 else math.ceil(math.log2(len(s))) + 1
            n = min(40, max(5, n))
        else:
            n = bins
        step = tick_step(lo_v, hi_v, n)
    dec = max(0, -math.floor(math.log10(step) + 1e-9)) + 1
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
