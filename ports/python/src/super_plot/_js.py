"""JavaScript semantics that the reference implementation relies on.

Super Plot's reference implementation is TypeScript, and the conformance data was produced by it. A port is only
interchangeable when it reproduces the same edge cases, so the few places where Python differs from JavaScript
(number to string, string to number, rounding, UTF-16 string length) live here and nowhere else.
"""
from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

_DEC = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
_RADIX = re.compile(r"0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+")


def is_number(v: Any) -> bool:
    """`typeof v === 'number'` for a JSON value (booleans are not numbers)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_finite_number(v: Any) -> bool:
    try:
        return is_number(v) and math.isfinite(float(v))
    except OverflowError:  # an integer literal beyond a double is Infinity in JavaScript
        return False


def to_number(v: Any) -> float | None:
    """A finite number from a number or a plain numeric string; None for anything else (empty strings included)."""
    if is_number(v):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, str):
        t = v.strip()
        if t == "":
            return None
        try:
            if _RADIX.fullmatch(t):
                f = float(int(t[2:], {"x": 16, "b": 2, "o": 8}[t[1].lower()]))
            elif _DEC.fullmatch(t):
                f = float(t)
            else:
                return None
        except (ValueError, OverflowError):
            return None
        return f if math.isfinite(f) else None
    return None


def number_string(v: float) -> str:
    """`String(number)`: shortest round-trip digits, no trailing `.0`, exponent form outside 1e-6 .. 1e21."""
    if v != v:
        return "NaN"
    if v in (math.inf, -math.inf):
        return "Infinity" if v > 0 else "-Infinity"
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    t = Decimal(repr(abs(float(v)))).as_tuple()
    digits = "".join(map(str, t.digits)).rstrip("0") or "0"
    k = len(digits)
    n = len("".join(map(str, t.digits))) + t.exponent  # position of the decimal point
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    mantissa = digits[0] + ("." + digits[1:] if k > 1 else "")
    return f"{sign}{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"


def js_string(v: Any) -> str:
    """`String(v)` for a JSON value."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if is_number(v):
        return number_string(float(v))
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if x is None else js_string(x) for x in v)
    return "[object Object]"


def key_string(v: Any) -> str:
    """The category key of an x value: '' for null."""
    return "" if v is None else js_string(v)


def or_empty(v: Any) -> str:
    """`String(v ?? '')`."""
    return "" if v is None else js_string(v)


def ulen(s: str) -> int:
    """JavaScript `.length`: UTF-16 code units."""
    return len(s) + sum(1 for ch in s if ord(ch) > 0xFFFF)


def uslice(s: str, end: int) -> str:
    """JavaScript `s.slice(0, end)`; a cut through a surrogate pair keeps the lone surrogate's half out."""
    if ulen(s) <= end:
        return s
    out: list[str] = []
    used = 0
    for ch in s:
        w = 2 if ord(ch) > 0xFFFF else 1
        if used + w > end:
            break
        out.append(ch)
        used += w
    return "".join(out)


def clip(s: Any, limit: int = 160) -> str:
    """Cap a spec-supplied string at `limit` UTF-16 units, ending in an ellipsis when it was cut."""
    t = s if isinstance(s, str) else ("" if s is None else js_string(s))
    return uslice(t, limit - 1) + "…" if ulen(t) > limit else t


def to_fixed(x: float, digits: int) -> str:
    """`Number.prototype.toFixed`: the exact binary value, rounded half up."""
    if not math.isfinite(x):
        return number_string(x)
    q = Decimal(1).scaleb(-digits)
    r = Decimal(abs(x)).quantize(q, rounding=ROUND_HALF_UP)
    neg = x < 0 or (x == 0 and math.copysign(1, x) < 0)
    # toFixed keeps the sign of a negative number that rounds to zero ("-0.00"), but not of negative zero itself.
    if x == 0:
        neg = False
    return ("-" if neg else "") + format(r, "f")


def pow10(k: int) -> float:
    """10 ** k, correctly rounded."""
    return float(f"1e{k}")
