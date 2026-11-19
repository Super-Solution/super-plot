"""Strict ISO 8601 parsing to epoch milliseconds (UTC). Mirrors `toTime` in the reference implementation."""
from __future__ import annotations

import re
from typing import Any

from ._js import is_number

_ISO = re.compile(r"(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?)?")


def _days_from_civil(y: int, m: int, d: int) -> int:
    y -= m <= 2
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def _days_in(year: int, month: int) -> int:
    if month == 2:
        return 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def to_time(v: Any) -> float | None:
    """A time as epoch ms from a number (taken as-is) or an ISO 8601 string; None for anything else."""
    if is_number(v):
        f = float(v)
        return f if f == f and f not in (float("inf"), float("-inf")) else None
    if not isinstance(v, str):
        return None
    m = _ISO.fullmatch(v.strip())
    if not m:
        return None
    year, month = int(m[1]), int(m[2])
    day = 1 if m[3] is None else int(m[3])
    if not 1 <= month <= 12 or not 1 <= day <= _days_in(year, month):
        return None
    h = 0 if m[4] is None else int(m[4])
    mi = 0 if m[5] is None else int(m[5])
    sec = 0 if m[6] is None else int(m[6])
    if h > 23 or mi > 59 or sec > 59:
        return None
    offset = 0
    if m[8] and m[8] != "Z":
        z = m[8].replace(":", "")
        oh, om = int(z[1:3]), int(z[3:5])
        if oh > 23 or om > 59:
            return None
        offset = (-1 if z[0] == "-" else 1) * (oh * 60 + om) * 60_000
    ms = int((m[7] or "0")[:3].ljust(3, "0"))
    return float(((_days_from_civil(year, month, day) * 24 + h) * 60 + mi) * 60_000 + sec * 1000 + ms - offset)


