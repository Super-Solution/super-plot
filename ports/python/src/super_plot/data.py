"""Tabular helpers shared by the chart descriptions: long-form observations, x-axis kind, distinct values."""
from __future__ import annotations

from typing import Any, Iterable

from ._js import is_number, key_string, or_empty, to_number
from .isotime import to_time

Row = dict[str, Any]


def distinct(values: Iterable[Any]) -> list[Any]:
    """Distinct values in order of first appearance."""
    return list(dict.fromkeys(values))


def observations(rows: list[Row], x: str | None, y: str | list[str], series: str | None = None) -> list[dict]:
    """Normalise `y` (one column, many columns, or a series column) into long-form observations."""
    ys = y if isinstance(y, list) else [y]
    out: list[dict] = []
    for row in rows:
        for col in ys:
            s = col if len(ys) > 1 or not series else or_empty(row.get(series))
            out.append({"x": len(out) if x is None else row.get(x), "y": to_number(row.get(col)), "s": s})
    return out


def detect_x_kind(requested: str | None, values: Iterable[Any]) -> str:
    if requested in ("category", "linear", "time"):
        return requested  # type: ignore[return-value]
    all_num = all_time = True
    n = 0
    for v in values:
        if v is None or v == "":
            continue
        n += 1
        if not is_number(v) or v != v or v in (float("inf"), float("-inf")):
            all_num = False
        if is_number(v) or to_time(v) is None:
            all_time = False
        if not all_num and not all_time:
            break
    if n == 0:
        return "category"
    if all_num:
        return "linear"
    if all_time:
        return "time"
    return "category"


def matrix(obs: list[dict]) -> dict[str, dict[str, float]]:
    """Sum duplicates: category x series -> value. Missing stays absent."""
    m: dict[str, dict[str, float]] = {}
    for o in obs:
        if o["y"] is None:
            continue
        row = m.setdefault(key_string(o["x"]), {})
        row[o["s"]] = row.get(o["s"], 0.0) + o["y"]
    return m
