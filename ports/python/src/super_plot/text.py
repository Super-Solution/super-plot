# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Number and date text, English only.

The reference implementation formats with `Intl`; here the same text is produced from first principles.
`Intl` rounds the shortest decimal that round-trips the number (so 1.005 with two decimals is 1.01) and rounds
half away from zero; both are reproduced. Only the English locale is supported: other locales fall back to it.
"""
from __future__ import annotations

import math

import json
import re
import unicodedata
from decimal import ROUND_HALF_UP, Context, Decimal
from importlib import resources
from typing import Callable

from ._js import is_finite_number

_CTX = Context(prec=500)
_NBSP = " "
_FORMAT_RE = re.compile(r"(auto|compact|integer|percent|fixed:\d{1,2}|currency:[A-Za-z]{3})")
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_SUFFIX = ["", "K", "M", "B", "T"]


def _tables() -> dict:
    with resources.files(__package__).joinpath("fields.v1.json").open("r", encoding="utf-8") as f:
        return json.load(f)


_CURRENCIES: dict[str, dict] = _tables()["currencies"]


def is_value_format(v: object) -> bool:
    return isinstance(v, str) and _FORMAT_RE.fullmatch(v) is not None


def _shortest(v: float) -> Decimal:
    return Decimal(repr(abs(float(v))))


def _group(digits: str) -> str:
    out = []
    while len(digits) > 3:
        out.append(digits[-3:])
        digits = digits[:-3]
    out.append(digits)
    return ",".join(reversed(out))


def _plain(d: Decimal, min_frac: int, max_frac: int, grouping: bool = True) -> str:
    """Round `d` (non-negative) to at most `max_frac` places and show at least `min_frac`."""
    r = d.quantize(Decimal(1).scaleb(-max_frac), rounding=ROUND_HALF_UP, context=_CTX)
    text = format(r, "f")
    whole, _, frac = text.partition(".")
    frac = frac.rstrip("0")
    frac = frac.ljust(min_frac, "0")
    if grouping:
        whole = _group(whole)
    return whole + ("." + frac if frac else "")


def _signed(v: float, body: str) -> str:
    # Intl keeps the sign of a negative number that rounds to zero ("-0"), and of minus zero itself.
    return ("-" if v < 0 or (v == 0 and math.copysign(1.0, v) < 0) else "") + body


def _compact(v: float) -> str:
    d = _shortest(v)
    if d == 0:
        return "0"
    idx = max(0, min(d.adjusted() // 3, 4))
    while True:
        r = d.scaleb(-3 * idx).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP, context=_CTX)
        if r >= 1000 and idx < 4:
            idx += 1
            continue
        break
    whole, _, frac = format(r, "f").partition(".")
    frac = frac.rstrip("0")
    if len(whole) >= 5:  # compact notation groups only from five digits
        whole = _group(whole)
    return whole + ("." + frac if frac else "") + _SUFFIX[idx]


def _percent(v: float, max_frac: int) -> str:
    return _plain(_shortest(v).scaleb(2, context=_CTX), 0, max_frac) + "%"


def _currency(v: float, code: str, max_frac: int) -> str:
    info = _CURRENCIES.get(code.upper(), {"symbol": code.upper(), "digits": 2})
    symbol = info["symbol"]
    body = _plain(_shortest(v), min(info["digits"], max_frac), max_frac)
    # CLDR currency spacing: a symbol ending in a letter or punctuation ("CHF", "Cg.") is separated from the number,
    # one ending in a symbol character ("$", "CN¥") is not.
    sep = _NBSP if symbol and unicodedata.category(symbol[-1])[0] not in "SZ" else ""
    return f"{symbol}{sep}{body}"


def value_formatter(fmt: str | None = None) -> Callable[[float], str]:
    """Formatter for a single value. Grammar: auto | compact | integer | percent | fixed:N | currency:CODE."""
    f = fmt or "auto"
    if f == "compact":
        return lambda v: _signed(v, _compact(v))
    if f == "integer":
        return lambda v: _signed(v, _plain(_shortest(v), 0, 0))
    if f == "percent":
        return lambda v: _signed(v, _percent(v, 2 if abs(v) < 0.1 else 1))
    if f.startswith("fixed:"):
        n = int(f[6:])
        return lambda v: _signed(v, _plain(_shortest(v), n, n))
    if f.startswith("currency:"):
        code = f[9:]
        return lambda v: _signed(v, _currency(v, code, 0 if abs(v) >= 1000 else 2))

    def auto(v: float) -> str:
        a = abs(v)
        digits = 0 if float(v).is_integer() else 4 if a < 1 else 2 if a < 100 else 1
        return _signed(v, _plain(_shortest(v), 0, digits))

    return auto


def format_value(value: float, fmt: str | None = None) -> str:
    """One value in a Super Plot format string."""
    return value_formatter(fmt)(value)


def format_percent(ratio: float, digits: int = 1) -> str:
    """A ratio (0.25) as text ("25%"), with up to `digits` decimals."""
    return _signed(ratio, _percent(ratio, digits))


def _civil(days: int) -> tuple[int, int, int]:
    """Year, month, day of a day count since 1970-01-01 (proleptic Gregorian)."""
    z = days + 719468
    era = z // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + 3 if mp < 10 else mp - 9
    return (y + (1 if m <= 2 else 0), m, d)


def format_date(ms: float) -> str:
    """`Aug 31, 2026` (UTC)."""
    y, m, d = _civil(int(ms // 86_400_000))
    return f"{_MONTHS[m - 1]} {d}, {y if y > 0 else 1 - y}"  # Intl prints the year of the era: year 0 is "1" (BC)


def format_datetime(ms: float) -> str:
    """`Aug 31, 2026, 09:30` (UTC, 24-hour clock)."""
    minute = int(ms // 60_000) % 1440
    return f"{format_date(ms)}, {minute // 60:02d}:{minute % 60:02d}"


def _round(x: float) -> float:
    """`Math.round`."""
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f


_DURATION_UNITS = [(86_400_000, "d"), (3_600_000, "h"), (60_000, "min"), (1000, "s")]


def format_duration(ms: float) -> str:
    """An elapsed time in ms as at most two units, largest first: "3 d 4 h", "2 h 15 min", "45 s", "0.25 s".
    Mirrors `formatDuration` in util/time.ts (a day is 24 hours)."""
    sign = "-" if ms < 0 else ""
    a = abs(ms)

    def nf(n: float, digits: int = 0) -> str:
        return _plain(_shortest(n), 0, digits)

    if _round(a / 1000) < 60:
        return f"{sign}{nf(a / 1000, 2 if a < 10_000 else 0)} s"

    def rounded(v: float) -> tuple[int, float]:
        i = next((k for k, (u, _) in enumerate(_DURATION_UNITS) if v >= u), -1)
        u2 = _DURATION_UNITS[min(i + 1, 3)][0]
        return i, _round(v / u2) * u2

    first, rest = rounded(a)
    again = rounded(rest)
    if again[0] < first:
        first, rest = again
    out: list[str] = []
    for u, w in _DURATION_UNITS[first:]:
        if len(out) == 2:
            break
        n = math.floor(rest / u)
        rest -= n * u
        if n or not out:
            out.append(f"{nf(n)} {w}")
        elif len(out) == 1:
            break
    return sign + " ".join(out)


__all__ = ["format_value", "format_percent", "format_date", "value_formatter", "is_value_format", "is_finite_number"]
