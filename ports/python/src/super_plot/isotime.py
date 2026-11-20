# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Strict ISO 8601 parsing to epoch milliseconds (UTC). Mirrors `toTime` in the reference implementation."""
from __future__ import annotations

import re
from typing import Any

from ._js import is_number

_ISO = re.compile(r"(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?)?", re.ASCII)


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
        try:
            f = float(v)
        except OverflowError:
            return None
        # A JavaScript Date holds at most 8.64e15 ms either side of 1970; beyond that it is not a time.
        return f if abs(f) <= 8.64e15 else None
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




def _civil_from_days(z: int) -> tuple[int, int, int]:
    z += 719468
    era = z // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + 3 if mp < 10 else mp - 9
    return yoe + era * 400 + (m <= 2), m, d


# `timeUnit` buckets times from 0001-01-01 to the end of 9999, so every bucket is a four-digit ISO date `to_time` reads back.
MIN_TIME = -62135596800000
MAX_TIME = 253402300799999


def time_bucket(t: float, unit: str) -> str:
    """The start of the bucket holding `t` (UTC, between MIN_TIME and MAX_TIME), as an ISO date (hours: date and
    time). Weeks start on Monday. Mirrors `bucket` in transform.ts."""
    ms = int(t)  # new Date(t) drops the fraction, towards zero
    days = ms // 86_400_000
    y, m, d = _civil_from_days(days)

    def day(yy: int, mm: int, dd: int) -> str:
        a, b, c = _civil_from_days(_days_from_civil(yy, mm, 1) + dd - 1)
        return f"{a:04d}-{b:02d}-{c:02d}"

    if unit == "year":
        return f"{y:04d}-01-01"
    if unit == "quarter":
        return day(y, m - (m - 1) % 3, 1)
    if unit == "month":
        return day(y, m, 1)
    if unit == "week":
        return day(y, m, d - (days + 3) % 7)  # 1970-01-01 was a Thursday
    if unit == "day":
        return day(y, m, d)
    return f"{day(y, m, d)}T{(ms - days * 86_400_000) // 3_600_000:02d}:00:00Z"
