# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""What a card reference points at in a plot: a port of `resolveRef` (packages/core/src/resolve.ts).

The rules are in that function's doc comment; `conformance/plot.v1.json` (`refCases`, `datePeriods`) pins the
whole answer, label and reason text included. Which columns `x`, `y` and `series` read comes from each chart's
`ref` entry in `fields.v1.json`.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Iterable

from ._js import clip, key_string, to_number
from .data import detect_x_kind
from .isotime import to_time
from .ref import CARD_REF_LIMITS, format_card_ref, parse_card_ref
from .validate import _DEFS, validate_plot

REF_PARAMS = ("key", "x", "y", "series")
_SHAPES: dict[str, dict[str, Any]] = {c["type"]: c.get("ref", {}) for c in _DEFS["charts"]}
_DECIMAL = re.compile(r"-?[0-9]+(?:\.[0-9]+)?")
_PREFIX = re.compile(r"([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?Z?)?)?)?")
_DAY = 86_400_000
_INF = float("inf")


def _leap(y: int) -> bool:
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


def _days_in(y: int, m: int) -> int:
    return (29 if _leap(y) else 28) if m == 2 else 30 if m in (4, 6, 9, 11) else 31


def date_period(value: str) -> list[float] | None:
    """A date written as a prefix of ISO 8601, as the closed interval of the whole period it names; None when it is not one."""
    m = _PREFIX.fullmatch(value)
    if not m:
        t = to_time(value)
        return None if t is None else [t, t]
    y = int(m[1])
    start = to_time(f"{m[1]}-01" if m[2] is None else value)
    if start is None:
        return None
    if m[2] is None:
        span = (366 if _leap(y) else 365) * _DAY
    elif m[3] is None:
        span = _days_in(y, int(m[2])) * _DAY
    elif m[4] is None:
        span = _DAY
    elif m[6] is None:
        span = 60_000
    else:
        span = 1000
    return [start, start + span - 1]


def _fail(code: str, reason: str, series: list[str] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"ok": False, "code": code, "reason": reason}
    if series is not None:
        out["series"] = series
    return out


def _list(spec: dict, field: str) -> list[str]:
    v = spec.get(field)
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return [c for c in v if isinstance(c, str)]
    return []


def _present(spec: dict, fields: Iterable[str] | None) -> list[str]:
    return [c for f in (fields or []) for c in _list(spec, f)]


def _empty(v: Any) -> bool:
    return v is None or v == ""


def _want(value: str, kind: str) -> dict | str:
    dots = value.find("..")
    if kind == "category":
        return {"text": value} if dots < 0 else {"from": value[:dots], "to": value[dots + 2 :]}

    def one(v: str, end: int) -> float | None:
        if v == "":
            return -_INF if end == 0 else _INF
        if kind == "time":
            p = date_period(v)
            return None if p is None else p[end]
        return float(v) if _DECIMAL.fullmatch(v) else None

    what = "a date such as 2026, 2026-03 or 2026-03-01, or a range of them (2026-01..2026-03)" if kind == "time" else "a number or a range such as 10..20"
    a = one(value if dots < 0 else value[:dots], 0)
    b = one(value if dots < 0 else value[dots + 2 :], 1)
    if a is None or b is None or (dots < 0 and value == ""):
        return f'"{clip(value, 40)}" is not {what}.'
    if a > b:
        return f'"{clip(value, 40)}" starts after it ends.'
    return {"lo": a, "hi": b}


def _hit(cell: Any, wants: list[dict], kind: str, order: Callable[[], list[str]]) -> bool:
    if _empty(cell):
        return False
    text = key_string(cell)
    n = to_time(cell) if kind == "time" else None if kind == "category" else to_number(cell)
    for w in wants:
        if "text" in w:
            if text == w["text"]:
                return True
        elif "from" in w:
            if text == f"{w['from']}..{w['to']}":
                return True
            o = order()
            a = o.index(w["from"]) if w["from"] in o else -1
            b = o.index(w["to"]) if w["to"] in o else -1
            i = o.index(text) if text in o else -1
            if a >= 0 and b >= 0 and min(a, b) <= i <= max(a, b):
                return True
        elif n is not None and w["lo"] <= n <= w["hi"]:
            return True
    return False


def resolve_ref(spec: Any, ref: Any, hidden: Iterable[str] | None = None) -> dict[str, Any]:
    """What a reference (a `ref:` text or a CardRef dict) points at in a plot spec. See resolveRef in core."""
    text = ref if isinstance(ref, str) else format_card_ref(ref)
    if text is None:
        return _fail("ref_invalid", f"Not a valid reference: a target of letters, digits, dot, underscore, colon or dash, and up to {CARD_REF_LIMITS['names']} params of up to {CARD_REF_LIMITS['values']} non-empty values each.")
    parsed = parse_card_ref(text)
    if not parsed["ok"]:
        return _fail("ref_invalid", parsed["error"])
    params: dict[str, list[str]] = parsed["ref"]["params"]
    v = validate_plot(spec)
    if not v.ok or v.spec is None:
        return _fail("ref_spec_invalid", "The plot spec does not validate; validatePlot lists its issues.")
    s = v.spec
    chart = s["type"]
    shape = _SHAPES.get(chart, {})
    rows: list[dict] = s["data"]
    names = sorted(params)
    x_cols = _present(s, shape.get("x"))
    sp = shape.get("span")
    span = (_list(s, sp[0])[0], _list(s, sp[1])[0]) if sp and _list(s, sp[0]) and _list(s, sp[1]) else None
    y_field = next((f for f in shape.get("y", []) if _list(s, f)), None)
    y_cols = _list(s, y_field) if y_field is not None else []
    y_row = bool(shape.get("yRow"))
    extra = [] if y_row else [c for c in _present(s, shape.get("extra")) if c not in y_cols]
    series_col = _list(s, shape["series"])[0] if shape.get("series") and _list(s, shape["series"]) else None
    legend_col = series_col if series_col is not None else (_list(s, shape["legend"])[0] if shape.get("legend") and _list(s, shape["legend"]) else None)
    wide = not y_row and len(y_cols) + len(extra) > 1
    can = {"key": True, "x": bool(x_cols) or span is not None, "y": bool(y_cols), "series": legend_col is not None or wide}

    for name in names:
        if name not in REF_PARAMS:
            return _fail("ref_param_unknown", f'"{clip(name, 32)}" is not something a plot reference names; use {", ".join(REF_PARAMS)}.')
        if not can[name]:
            ok = [n for n in REF_PARAMS if can[n]]
            return _fail("ref_param_unsupported", f'This {chart} chart has nothing "{name}" can name; it takes {", ".join(ok)}.')

    kinds: dict[str, str] = {}

    def kind_of(col: str) -> str:
        if col not in kinds:
            kinds[col] = detect_x_kind(None, [r.get(col) for r in rows])
        return kinds[col]

    orders: dict[str, list[str]] = {}

    def order_of(col: str) -> Callable[[], list[str]]:
        def get() -> list[str]:
            if col not in orders:
                orders[col] = list(dict.fromkeys(key_string(r.get(col)) for r in rows if not _empty(r.get(col))))
            return orders[col]
        return get

    def wants(name: str, kind: str) -> list[dict] | str:
        out: list[dict] = []
        for value in params[name]:
            w = _want(value, kind)
            if isinstance(w, str):
                return f"{name}: {w}"
            out.append(w)
        return out

    def row_filter(name: str, cols: list[str], kind_for: Callable[[str], str]) -> Callable[[dict], bool] | str:
        per: list[tuple[str, list[dict], str]] = []
        why = ""
        for c in cols:
            k = kind_for(c)
            w = wants(name, k)
            if isinstance(w, str):
                why = why or w
            else:
                per.append((c, w, k))
        if not per:
            return why
        return lambda r: any(_hit(r.get(c), w, k, order_of(c)) for c, w, k in per)

    filters: list[Callable[[dict], bool]] = []
    key_set = set(params["key"]) if "key" in params else None
    if key_set is not None:
        col = s.get("key") if isinstance(s.get("key"), str) else None
        filters.append(lambda r: col is not None and key_string(r.get(col)) in key_set and not _empty(r.get(col)))
    if "x" in params:
        if span is not None:
            k = "time" if kind_of(span[0]) == "time" or kind_of(span[1]) == "time" else "number"
            w = wants("x", k)
            if isinstance(w, str):
                return _fail("ref_bad_value", w)

            def at(c: Any) -> float | None:
                return to_time(c) if k == "time" else to_number(c)

            def overlaps(r: dict, w: list[dict] = w) -> bool:
                a = at(r.get(span[0]))
                b = at(r.get(span[1]))
                if a is None or b is None:
                    return False
                return any(min(a, b) <= q["hi"] and max(a, b) >= q["lo"] for q in w)
            filters.append(overlaps)
        else:
            f = row_filter("x", x_cols, kind_of)
            if isinstance(f, str):
                return _fail("ref_bad_value", f)
            filters.append(f)
    y_point: list[dict] | None = None
    if "y" in params:
        if y_row:
            f = row_filter("y", y_cols, kind_of)
            if isinstance(f, str):
                return _fail("ref_bad_value", f)
            filters.append(f)
        else:
            w = wants("y", "number")
            if isinstance(w, str):
                return _fail("ref_bad_value", w)
            y_point = w
    series_set = set(params["series"]) if "series" in params else None
    hidden_set = set(hidden or [])

    points: list[dict[str, Any]] = []
    value_cols = [] if y_row else [*y_cols, *extra]
    for i, r in enumerate(rows):
        if not all(f(r) for f in filters):
            continue
        legend = key_string(r.get(legend_col)) if legend_col is not None else None
        if not value_cols:
            if series_set is not None and (legend is None or legend not in series_set):
                continue
            points.append({"row": i, "s": legend})
            continue
        for j, col in enumerate(value_cols):
            ser = col if j >= len(y_cols) or len(y_cols) > 1 or legend is None else legend
            if series_set is not None and ser not in series_set:
                continue
            if y_point is not None and not _hit(r.get(col), y_point, "number", lambda: []):
                continue
            p: dict[str, Any] = {"row": i, "s": ser, "col": col}
            if wide:
                p["series"] = ser
            points.append(p)

    annotations = s.get("annotations") or []
    keys = [a["key"] for a in annotations if isinstance(a.get("key"), str) and a["key"] in key_set] if key_set is not None else []
    if any(n != "key" for n in names):
        keys = []
    shown = [p for p in points if p["s"] is None or p["s"] not in hidden_set]
    if not shown and not keys:
        gone = list(dict.fromkeys(p["s"] for p in points if p["s"] is not None))
        if points:
            return _fail("ref_hidden_series", f"What this names is in hidden series only: {', '.join(chr(34) + clip(g, 40) + chr(34) for g in gone)}. Show the series to see it.", gone)
        if names:
            said = " and ".join(f"{n}=" + " or ".join(clip(x, 40) for x in params[n]) for n in names)
            return _fail("ref_no_match", f"Nothing in this plot matches {said}.")
        return _fail("ref_no_match", "This plot has no data to point at.")
    row_list = sorted(set(p["row"] for p in shown))
    series = list(dict.fromkeys(p["s"] for p in shown if p["s"] is not None))
    return {
        "ok": True,
        "rows": row_list,
        "points": [{"row": p["row"], **({"series": p["series"]} if "series" in p else {})} for p in shown],
        "series": series,
        "keys": keys,
        "label": _label(s, rows, shown, keys, x_cols, span, y_cols[0] if y_row and y_cols else None, None if wide else series_col, s.get("key") if isinstance(s.get("key"), str) else None),
    }


def _label(s: dict, rows: list[dict], pts: list[dict], keys: list[str], x_cols: list[str], span: tuple[str, str] | None, lane: str | None, series_col: str | None, key_col: str | None) -> str:
    parts: list[str] = []

    def one(col: str, v: Any) -> str:
        return f"{clip(col, 40)} {clip(key_string(v), 40)}"

    if len(pts) == 1:
        p = pts[0]
        r = rows[p["row"]]
        bits: list[str] = []
        if span is not None:
            bits += [one(span[0], r.get(span[0])), one(span[1], r.get(span[1]))]
        elif x_cols:
            bits.append(one(x_cols[0], r.get(x_cols[0])))
        if lane is not None:
            bits.append(one(lane, r.get(lane)))
        if series_col is not None:
            bits.append(one(series_col, r.get(series_col)))
        if p.get("col") is not None:
            bits.append(one(p["col"], r.get(p["col"])))
        if not bits and key_col is not None:
            bits.append(one(key_col, r.get(key_col)))
        parts.append(", ".join(bits) if bits else f"row {p['row'] + 1}")
    elif len(pts) > 1:
        n = len(set(p["s"] for p in pts))
        parts.append(f"{len(pts)} points" + (f" in {n} series" if n > 1 else ""))
    if len(keys) == 1:
        a = next((x for x in (s.get("annotations") or []) if x.get("key") == keys[0]), None)
        parts.append(f'annotation "{clip((a or {}).get("label") or keys[0], 40)}"')
    elif len(keys) > 1:
        parts.append(f"{len(keys)} annotations")
    return clip("; ".join(parts), 200)
