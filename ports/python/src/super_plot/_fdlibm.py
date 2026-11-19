# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""The elementary functions as the reference's JavaScript engine computes them.

V8 does not call the C library for `Math.exp`, `Math.log`, `Math.log10`, `Math.cbrt` and `**`: it carries its own
port of fdlibm, whose results differ from a platform libm in the last bit for a share of inputs (about one
`log10` in 200, half of all `cbrt`). A last bit decides which of two equal-looking densities is "the peak", or
whether a range spans "at most three decades", so the ports compute these the same way, operation by operation.
Each function names the fdlibm file it follows. Arguments outside the range a chart can produce (negative bases,
NaN, infinities) fall back to `math`.
"""
from __future__ import annotations

import math
import struct

_PACK = struct.Struct("<d")
_WORDS = struct.Struct("<II")


def _words(x: float) -> tuple[int, int]:
    """High and low 32-bit words of a double, unsigned."""
    lo, hi = _WORDS.unpack(_PACK.pack(x))
    return hi, lo


def _double(hi: int, lo: int) -> float:
    return _PACK.unpack(_WORDS.pack(lo & 0xFFFFFFFF, hi & 0xFFFFFFFF))[0]


def _low0(x: float) -> float:
    """`SET_LOW_WORD(x, 0)`."""
    return _double(_words(x)[0], 0)


_LN2_HI = 6.93147180369123816490e-01
_LN2_LO = 1.90821492927058770002e-10
_INVLN2 = 1.44269504088896338700e00
_P1 = 1.66666666666666019037e-01
_P2 = -2.77777777770155933842e-03
_P3 = 6.61375632143793436117e-05
_P4 = -1.65339022054652515390e-06
_P5 = 4.13813679705723846039e-08
_TWOM1000 = 9.33263618503218878990e-302


def exp(x: float) -> float:
    """`Math.exp` (fdlibm e_exp.c)."""
    if x != x or x in (math.inf, -math.inf):
        return math.exp(x) if x != -math.inf else 0.0
    hx, _ = _words(x)
    xsb = hx >> 31
    hx &= 0x7FFFFFFF
    if hx >= 0x40862E42:
        if x > 7.09782712893383973096e02:
            return math.inf
        if x < -7.45133219101941108420e02:
            return 0.0
    hi = lo = 0.0
    k = 0
    if hx > 0x3FD62E42:
        if hx < 0x3FF0A2B2:
            if x == 1.0:
                return 2.718281828459045
            hi = x - (-_LN2_HI if xsb else _LN2_HI)
            lo = -_LN2_LO if xsb else _LN2_LO
            k = 1 - xsb - xsb
        else:
            k = int(_INVLN2 * x + (-0.5 if xsb else 0.5))
            t = float(k)
            hi = x - t * _LN2_HI
            lo = t * _LN2_LO
        x = hi - lo
    elif hx < 0x3E300000:
        return 1.0 + x
    t = x * x
    twopk = _double(0x3FF00000 + (k << 20), 0) if k >= -1021 else _double(0x3FF00000 + ((k + 1000) << 20), 0)
    c = x - t * (_P1 + t * (_P2 + t * (_P3 + t * (_P4 + t * _P5))))
    if k == 0:
        return 1.0 - ((x * c) / (c - 2.0) - x)
    y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi)
    if k >= -1021:
        if k == 1024:
            return y * 2.0 * 8.98846567431158e307
        return y * twopk
    return y * twopk * _TWOM1000


_LG1 = 6.666666666666735130e-01
_LG2 = 3.999999999940941908e-01
_LG3 = 2.857142874366239149e-01
_LG4 = 2.222219843214978396e-01
_LG5 = 1.818357216161805012e-01
_LG6 = 1.531383769920937332e-01
_LG7 = 1.479819860511658591e-01
_TWO54 = 1.80143985094819840000e16


def log(x: float) -> float:
    """`Math.log` (fdlibm e_log.c)."""
    if not (x > 0) or x == math.inf:
        return -math.inf if x == 0 else (x if x == math.inf else math.nan)
    hx, lx = _words(x)
    k = 0
    if hx < 0x00100000:
        k -= 54
        x *= _TWO54
        hx, lx = _words(x)
    k += (hx >> 20) - 1023
    hx &= 0x000FFFFF
    i = (hx + 0x95F64) & 0x100000
    x = _double(hx | (i ^ 0x3FF00000), lx)
    k += i >> 20
    f = x - 1.0
    dk = float(k)
    if (0x000FFFFF & (2 + hx)) < 3:
        if f == 0:
            return 0.0 if k == 0 else dk * _LN2_HI + dk * _LN2_LO
        r = f * f * (0.5 - 0.33333333333333333 * f)
        return f - r if k == 0 else dk * _LN2_HI - ((r - dk * _LN2_LO) - f)
    s = f / (2.0 + f)
    z = s * s
    i = hx - 0x6147A
    w = z * z
    j = 0x6B851 - hx
    t1 = w * (_LG2 + w * (_LG4 + w * _LG6))
    t2 = z * (_LG1 + w * (_LG3 + w * (_LG5 + w * _LG7)))
    r = t2 + t1
    if (i | j) > 0:  # both differences are small signed integers here
        hfsq = 0.5 * f * f
        if k == 0:
            return f - (hfsq - s * (hfsq + r))
        return dk * _LN2_HI - ((hfsq - (s * (hfsq + r) + dk * _LN2_LO)) - f)
    if k == 0:
        return f - s * (f - r)
    return dk * _LN2_HI - ((s * (f - r) - dk * _LN2_LO) - f)


_IVLN10 = 4.34294481903251816668e-01
_LOG10_2HI = 3.01029995663611771306e-01
_LOG10_2LO = 3.69423907715893078616e-13


def log10(x: float) -> float:
    """`Math.log10` (fdlibm e_log10.c)."""
    if not (x > 0) or x == math.inf:
        return -math.inf if x == 0 else (x if x == math.inf else math.nan)
    hx, lx = _words(x)
    k = 0
    if hx < 0x00100000:
        k -= 54
        x *= _TWO54
        hx, lx = _words(x)
    k += (hx >> 20) - 1023
    i = 1 if k < 0 else 0
    hx = (hx & 0x000FFFFF) | ((0x3FF - i) << 20)
    y = float(k + i)
    x = _double(hx, lx)
    z = y * _LOG10_2LO + _IVLN10 * log(x)
    return z + y * _LOG10_2HI


def cbrt(x: float) -> float:
    """`Math.cbrt` (FreeBSD s_cbrt.c)."""
    if x != x or x in (math.inf, -math.inf) or x == 0:
        return x
    hx, low = _words(x)
    sign = hx & 0x80000000
    hx ^= sign
    if hx < 0x00100000:
        t = _double(0x43500000, 0) * x
        high = _words(t)[0]
        t = _double(sign | ((high & 0x7FFFFFFF) // 3 + 696219795), 0)
    else:
        t = _double(sign | (hx // 3 + 715094163), 0)
    r = (t * t) * (t / x)
    t = t * ((1.87595182427177009643 + r * (-1.88497979543377169875 + r * 1.621429720105354466140)) + ((r * r) * r) * (-0.758397934778766047437 + r * 0.145996192886612446982))
    bits = struct.unpack("<Q", _PACK.pack(t))[0]
    bits = (bits + 0x80000000) & 0xFFFFFFFFC0000000
    t = struct.unpack("<d", struct.pack("<Q", bits))[0]
    s = t * t
    r = x / s
    w = t + t
    r = (r - t) / (w + r)
    return t + t * r


_L1 = 5.99999999999994648725e-01
_L2 = 4.28571428578550184252e-01
_L3 = 3.33333329818377432918e-01
_L4 = 2.72728123808534006489e-01
_L5 = 2.30660745775561754067e-01
_L6 = 2.06975017800338417784e-01
_PLG2 = 6.93147180559945286227e-01
_PLG2_H = 6.93147182464599609375e-01
_PLG2_L = -1.90465429995776804525e-09
_OVT = 8.0085662595372944372e-17
_CP = 9.61796693925975554329e-01
_CP_H = 9.61796700954437255859e-01
_CP_L = -7.02846165095275826516e-09
_IVLN2 = 1.44269504088896338700e00
_IVLN2_H = 1.44269502162933349609e00
_IVLN2_L = 1.92596299112661746302e-08
_BP = (1.0, 1.5)
_DP_H = (0.0, 5.84962487220764160156e-01)
_DP_L = (0.0, 1.35003920212974897128e-08)


def _signed(w: int) -> int:
    return w - 0x100000000 if w & 0x80000000 else w


def pow(x: float, y: float) -> float:  # noqa: A001  (the name the reference uses)
    """`x ** y` for a finite x above zero and a finite y (V8's copy of fdlibm e_pow.c, which differs in one line)."""
    if not (x > 0) or x == math.inf or y != y or y in (math.inf, -math.inf):
        return math.pow(x, y)
    hx, lx = _words(x)
    hyu, ly = _words(y)
    hy = _signed(hyu)
    ix = hx
    iy = hyu & 0x7FFFFFFF
    if (iy | ly) == 0:
        return 1.0
    if ly == 0:
        if iy == 0x3FF00000:
            return 1.0 / x if hy < 0 else x
        if hy == 0x40000000:
            return x * x
        if hy == 0x3FE00000:
            return math.sqrt(x)
    ax = x
    if lx == 0 and ix == 0x3FF00000:
        return 1.0
    if iy > 0x41E00000:
        if iy > 0x43F00000:
            if ix <= 0x3FEFFFFF:
                return math.inf if hy < 0 else 0.0
            return math.inf if hy > 0 else 0.0
        if ix < 0x3FEFFFFF:
            return math.inf if hy < 0 else 0.0
        if ix > 0x3FF00000:
            return math.inf if hy > 0 else 0.0
        t = ax - 1.0
        w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25))
        u = _IVLN2_H * t
        v = t * _IVLN2_L - w * _IVLN2
        t1 = _low0(u + v)
        t2 = v - (t1 - u)
    else:
        n = 0
        if ix < 0x00100000:
            ax *= 9007199254740992.0
            n -= 53
            ix = _words(ax)[0]
        n += (ix >> 20) - 0x3FF
        j = ix & 0x000FFFFF
        ix = j | 0x3FF00000
        if j <= 0x3988E:
            k = 0
        elif j < 0xBB67A:
            k = 1
        else:
            k = 0
            n += 1
            ix -= 0x00100000
        ax = _double(ix, _words(ax)[1])
        u = ax - _BP[k]
        v = 1.0 / (ax + _BP[k])
        ss = u * v
        s_h = _low0(ss)
        t_h = _double(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0)
        t_l = ax - (t_h - _BP[k])
        s_l = v * ((u - s_h * t_h) - s_h * t_l)
        s2 = ss * ss
        r = s2 * s2 * (_L1 + s2 * (_L2 + s2 * (_L3 + s2 * (_L4 + s2 * (_L5 + s2 * _L6)))))
        r += s_l * (s_h + ss)
        s2 = s_h * s_h
        t_h = _low0(3.0 + s2 + r)
        t_l = r - ((t_h - 3.0) - s2)
        u = s_h * t_h
        v = s_l * t_h + t_l * ss
        p_h = _low0(u + v)
        p_l = v - (p_h - u)
        z_h = _CP_H * p_h
        z_l = _CP_L * p_h + p_l * _CP + _DP_L[k]
        t = float(n)
        t1 = _low0(((z_h + z_l) + _DP_H[k]) + t)
        t2 = z_l - (((t1 - t) - _DP_H[k]) - z_h)
    y1 = _low0(y)
    p_l = (y - y1) * t1 + y * t2
    p_h = y1 * t1
    z = p_l + p_h
    ju, i = _words(z)
    j = _signed(ju)
    if j >= 0x40900000:
        if ((j - 0x40900000) | i) != 0 or p_l + _OVT > z - p_h:
            return math.inf
    elif (j & 0x7FFFFFFF) >= 0x4090CC00:
        if ((ju - 0xC090CC00) | i) != 0 or p_l <= z - p_h:
            return 0.0
    i = j & 0x7FFFFFFF
    k = (i >> 20) - 0x3FF
    n = 0
    if i > 0x3FE00000:
        n = j + (0x00100000 >> (k + 1))
        k = ((n & 0x7FFFFFFF) >> 20) - 0x3FF
        t = _double(n & ~(0x000FFFFF >> k), 0)
        n = ((n & 0x000FFFFF) | 0x00100000) >> (20 - k)
        if j < 0:
            n = -n
        p_h -= t
    t = _low0(p_l + p_h)
    u = t * _PLG2_H
    v = (p_l - (t - p_h)) * _PLG2 + t * _PLG2_L
    z = u + v
    w = v - (z - u)
    t = z * z
    t1 = z - t * (_P1 + t * (_P2 + t * (_P3 + t * (_P4 + t * _P5))))
    r = (z * t1) / ((t1 - 2.0) - (w + z * w))  # as V8 has it; fdlibm subtracts (w + z * w) after dividing
    z = 1.0 - (r - z)
    zh, zl = _words(z)
    j = _signed(zh) + (n << 20)
    if (j >> 20) <= 0:
        return math.ldexp(z, n)
    return _double(j, zl)
