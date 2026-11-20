# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Checks and descriptions of the gauge, the word cloud and the 3D charts, and the word cloud's layout.

Every function here mirrors one in the reference implementation (`packages/core/src/charts/gauge.ts`,
`wordcloud.ts` and `plot3d.ts`). The conformance data in `conformance/plot.v1.json` keeps them in step.
"""
from __future__ import annotations

import math
from typing import Any, Callable, Sequence

from ._js import clip, js_string, key_string, number_string, or_empty, to_number
from .charts import Issues, Spec, _cols, _first_max, _first_min, _fmt_list, _formatter, _issue, _lead
from .data import distinct
from .geo import js_trim
from .numeric import extent, nice_domain
from .text import format_exact, format_percent

# -------------------------------------------------------------------------------------------- gauge

MAX_GAUGES = 6
_TONES = {2: ["negative", "positive"], 3: ["negative", "warning", "positive"]}


def gauge_items(spec: Spec, rows: list[dict]) -> tuple[list[dict], int, int, list[str]]:
    """One gauge per row, at most `MAX_GAUGES`; a repeated label keeps its first row. Mirrors `gaugeItems`.

    Returns the items, the rows left out beyond the limit, the repeated rows and the labels whose band thresholds
    do not increase in column order."""
    names = _cols(spec.get("bands"))
    tones = _TONES.get(len(names), [])
    order = list(reversed(tones)) if spec.get("bandOrder") == "best-first" else tones
    tone_of = {n: order[j] if j < len(order) else None for j, n in enumerate(names)}
    seen: set[str] = set()
    items: list[dict] = []
    unordered: list[str] = []
    duplicates = extra = 0
    label = spec.get("label")
    for i, r in enumerate(rows):
        # Without `label` (one row) the gauge is named by its value column.
        key = key_string(r.get(label)) if isinstance(label, str) else f"{js_string(spec['value'])} {i + 1}" if i else js_string(spec["value"])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        if len(items) >= MAX_GAUGES:
            extra += 1
            continue
        given = [(n, v) for n, v in ((n, to_number(r.get(n))) for n in names) if v is not None]
        if any(j and g[1] < given[j - 1][1] for j, g in enumerate(given)):
            unordered.append(key)
        bands: list[dict] = []
        prev = -math.inf
        for n, t in sorted(given, key=lambda g: g[1]):
            # Tones follow the column order (worst first), not the sorted order.
            bands.append({"name": n, "from": prev, "to": t, "tone": tone_of.get(n) or "warning"})
            prev = t
        items.append({"key": key, "value": to_number(r.get(spec["value"])), "target": to_number(r.get(spec["target"])) if isinstance(spec.get("target"), str) else None, "bands": bands})
    return items, extra, duplicates, unordered


def gauge_scale(spec: Spec, items: list[dict]) -> dict:
    """The value range of every gauge; without `max` it is rounded up from the largest value. Mirrors `gaugeScale`."""
    lo = float(spec["min"]) if _is_num(spec.get("min")) else 0.0
    largest: float | None = None
    for it in items:
        for v in [it["value"], it["target"], *(b["to"] for b in it["bands"])]:
            if v is not None and (largest is None or v > largest):
                largest = v
    if _is_num(spec.get("max")):
        return {"min": lo, "max": float(spec["max"]), "derived": False, "largest": largest, "ok": spec["max"] > lo}
    if largest is None or largest <= lo:
        return {"min": lo, "max": lo, "derived": True, "largest": largest, "ok": False}
    return {"min": lo, "max": nice_domain(lo, largest, 5)[1], "derived": True, "largest": largest, "ok": True}


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _band_of(it: dict, v: float) -> dict | None:
    return next((b for b in it["bands"] if v <= b["to"]), None)


def _share_of(v: float, sc: dict) -> float:
    """`Math.max(0, Math.min(1, (v - min) / (max - min)))`."""
    x = (v - sc["min"]) / (sc["max"] - sc["min"])
    x = 1.0 if x > 1 else x
    return 0.0 if x <= 0 else x


def _check_gauge(spec: Spec, rows: list[dict], issues: Issues) -> None:
    if len(rows) > 1 and not isinstance(spec.get("label"), str):
        return _issue(issues, "error", "missing_required", "label", f"There are {len(rows)} rows, so {len(rows)} gauges: give `label`, the column that names each one.", "Or filter to one row with `transform`.")
    lo = spec["min"] if _is_num(spec.get("min")) else 0
    if _is_num(spec.get("max")) and spec["max"] <= lo:
        return _issue(issues, "error", "bad_range", "max", f"max ({number_string(spec['max'])}) must be above min ({number_string(lo)}).", "Set `min` too when the whole range is negative.")
    items, extra, duplicates, unordered = gauge_items(spec, rows)
    sc = gauge_scale(spec, items)
    span = f"{number_string(sc['min'])} to {number_string(sc['max'])}"
    if not sc["ok"]:
        return _issue(issues, "error", "max_required", "max", f"Every value is at or below min ({number_string(sc['min'])}), so no range can be derived.", "Give `max`: the capacity or goal the arc stands for.")
    if sc["derived"]:
        _issue(issues, "warning", "max_derived", "max", f"No max was given; the arc ends at {number_string(sc['max'])}, rounded up from the largest value ({number_string(sc['largest'])}). The share of the arc then says nothing about capacity or a goal.",
               "Set `max` to what a full arc means (100%, the capacity, the plan).")
    if extra:
        _issue(issues, "warning", "too_many_gauges", "data", f"{extra + MAX_GAUGES} gauges; only the first {MAX_GAUGES} are drawn.", 'Use a bullet chart (`type: "bullet"`) to compare many measures, or filter with `transform`.')
    if duplicates:
        _issue(issues, "warning", "duplicate_measures", "label", f"{duplicates} row(s) repeat a gauge label; only the first row of each is drawn.")
    if unordered:
        listed = ", ".join(f'"{clip(k, 40)}"' for k in unordered[:3])
        _issue(issues, "warning", "bands_not_increasing", "bands", f"The thresholds of {listed} do not increase in column order; they were sorted (each band keeps its tone).", "List band columns in order along the arc, each threshold higher than the one before.")
    out = [it for it in items if it["value"] is not None and (it["value"] < sc["min"] or it["value"] > sc["max"])]
    if out:
        listed = _fmt_list([f'"{clip(it["key"], 30)}" ({number_string(it["value"])})' for it in out], 3)
        _issue(issues, "warning", "value_outside_range", "value", f"{listed} {'is' if len(out) == 1 else 'are'} outside {span}: the arc is clamped (full or empty) and the number shows the true value.", "Widen `min`/`max` if the range is wrong.")
    tout = [it for it in items if it["target"] is not None and (it["target"] < sc["min"] or it["target"] > sc["max"])]
    if tout:
        listed = _fmt_list([f'"{clip(it["key"], 30)}"' for it in tout], 3)
        _issue(issues, "warning", "target_outside_range", "target", f"The target of {listed} is outside {span}; its tick sits at the end of the arc.")


def _describe_gauge(spec: Spec) -> str:
    items, extra, _, _ = gauge_items(spec, spec["data"])
    sc = gauge_scale(spec, items)
    f = _formatter(spec)
    n = len(items)
    t = (f"{_lead(spec, 'Gauge')} {'One value' if n == 1 else f'{n} values'} on {'an arc' if n == 1 else 'arcs'} from {f(sc['min'])} to {f(sc['max'])}"
         f"{' (the maximum was rounded up from the data, not given)' if sc['derived'] else ''}; a filled arc's length is the value's share of that range.")
    for it in items:
        name = clip(it["key"], 30)
        v = it["value"]
        if v is None:
            t += f" {name}: no value."
            continue
        t += f" {name}: {f(v)}"
        if v > sc["max"]:
            t += f", above the maximum of {f(sc['max'])} (the arc is full)"
        elif v < sc["min"]:
            t += f", below the minimum of {f(sc['min'])} (the arc is empty)"
        else:
            t += f", {format_percent(_share_of(v, sc))} of the range"
        if it["bands"]:
            b = _band_of(it, v)
            if b:
                span = f"up to {f(b['to'])}" if b["from"] == -math.inf else f"{f(b['from'])} to {f(b['to'])}"
                t += f', in band "{clip(b["name"], 30)}" ({span})'
            else:
                t += ", above every band"
        if it["target"] is not None:
            t += f", target {f(it['target'])}"
        t += "."
    if extra:
        t += f" {extra} more {'row is' if extra == 1 else 'rows are'} not drawn."
    return t


# --------------------------------------------------------------------------------------- word cloud

CLOUD_LIMITS = {"maxWords": 150, "minFont": 10, "maxFont": 64}
# cos(5k degrees) x 10000, rounded, for k = 0..18: the spiral's only trigonometry.
CLOUD_COS = [10000, 9962, 9848, 9659, 9397, 9063, 8660, 8192, 7660, 7071, 6428, 5736, 5000, 4226, 3420, 2588, 1736, 872, 0]
CLOUD_SPACING = 4
_CELL = 32


def _cos5(k: int) -> int:
    """cos(5k degrees) x 10000 for any integer k, from the quarter table."""
    q = k % 72
    if q <= 18:
        return CLOUD_COS[q]
    if q <= 36:
        return -CLOUD_COS[36 - q]
    if q <= 54:
        return -CLOUD_COS[q - 36]
    return CLOUD_COS[72 - q]


def _div_round(n: int, d: int) -> int:
    """n / d rounded half away from zero, for integers with d > 0."""
    return -((-2 * n + d) // (2 * d)) if n < 0 else (2 * n + d) // (2 * d)


def cloud_layout(words: Sequence[dict], width: float, height: float, measure: Callable[[str, int], float]) -> list[dict | None]:
    """Place words (largest first) on an Archimedean spiral without overlap. Mirrors `cloudLayout`.

    Each word is `{"text", "size", "rotate"?}` with `size` in whole pixels; `measure(text, size)` is the text's
    width. The result has, per word, its box `{"x", "y", "w", "h", "rotate"}` in whole pixels from the top left
    of the area, or None when the word did not fit. Everything is integer arithmetic, so the boxes are the
    reference's exactly, given the same widths."""
    W, H = math.floor(width), math.floor(height)
    placed: list[dict] = []
    # A 32 px grid of placed boxes, only to find candidates faster; the result is the same as checking them all.
    grid: dict[tuple[int, int], list[int]] = {}

    def cells(b: dict) -> list[tuple[int, int]]:
        return [(gx, gy) for gx in range(b["x"] // _CELL, (b["x"] + b["w"] - 1) // _CELL + 1) for gy in range(b["y"] // _CELL, (b["y"] + b["h"] - 1) // _CELL + 1)]

    def hits(b: dict) -> bool:
        for key in cells(b):
            for i in grid.get(key, ()):
                o = placed[i]
                if b["x"] < o["x"] + o["w"] and o["x"] < b["x"] + b["w"] and b["y"] < o["y"] + o["h"] and o["y"] < b["y"] + b["h"]:
                    return True
        return False

    steps = (72 * H) // CLOUD_SPACING
    out: list[dict | None] = []
    for word in words:
        size = int(word["size"])
        tw = math.ceil(measure(word["text"], word["size"])) + 2
        th = size + (size + 4) // 5 + 2
        rotate = word.get("rotate") is True
        w, h = (th, tw) if rotate else (tw, th)
        box: dict | None = None
        if not (w > W or h > H or W <= 0 or H <= 0):
            for t in range(steps + 1):
                k = t % 72
                dx = _div_round(CLOUD_SPACING * t * _cos5(k) * W, 72 * 10000 * H)
                dy = _div_round(CLOUD_SPACING * t * _cos5(k - 18), 72 * 10000)
                b = {"x": W // 2 + dx - w // 2, "y": H // 2 + dy - h // 2, "w": w, "h": h, "rotate": rotate}
                if b["x"] < 0 or b["y"] < 0 or b["x"] + w > W or b["y"] + h > H or hits(b):
                    continue
                placed.append(b)
                for key in cells(b):
                    grid.setdefault(key, []).append(len(placed) - 1)
                box = b
                break
        out.append(box)
    return out


def cloud_font_size(value: float, largest: float, max_font: float, min_font: float = CLOUD_LIMITS["minFont"]) -> float:
    """`max(minFont, floor(maxFont * sqrt(value / largest)))`. Mirrors `cloudFontSize`."""
    return max(min_font, math.floor(max_font * math.sqrt(value / largest)))


def cloud_words(spec: Spec, rows: list[dict]) -> tuple[list[dict], int, int]:
    """The words of a cloud, largest first (ties in data order), at most 150; rows with the same text are summed.

    Returns the words, how many distinct words there were, and the rows left out for a value at or below zero.
    Mirrors `cloudWords`."""
    sums: dict[str, dict] = {}
    skipped = 0
    series = spec.get("series")
    for r in rows:
        raw = r.get(spec["text"])
        text = "" if raw is None else js_trim(js_string(raw))
        v = to_number(r.get(spec["value"]))
        if not text or v is None:
            continue
        if v <= 0:
            skipped += 1
            continue
        e = sums.get(text)
        if e:
            e["value"] += v
        else:
            sums[text] = {"text": text, "value": v, "series": or_empty(r.get(series)) if isinstance(series, str) else None}
    ranked = sorted((e for e in sums.values() if e["value"] > 0), key=lambda e: -e["value"])
    return ranked[: CLOUD_LIMITS["maxWords"]], len(ranked), skipped


def _check_wordcloud(spec: Spec, rows: list[dict], issues: Issues) -> None:
    words, total, skipped = cloud_words(spec, rows)
    most = CLOUD_LIMITS["maxWords"]
    if not words:
        return _issue(issues, "error", "no_positive_values", "value", "No word has a positive value; a word cloud sizes words by value.", "Check the value and text columns, or the transform that produced them.")
    if spec.get("patterns") is True:
        _issue(issues, "warning", "patterns_unsupported", "patterns", "A word cloud draws text, which has no fill to texture; patterns is ignored. Groups stay apart by the legend, the tooltip and the spoken label.")
    if skipped:
        _issue(issues, "warning", "nonpositive_values", "value", f"{skipped} row(s) with a value at or below zero are left out; a font size cannot show them.")
    if total > most:
        _issue(issues, "warning", "too_many_words", "text", f"{total} distinct words; only the {most} largest are drawn.", "Keep the top words with a `top` transform step, or use a sorted bar chart.")


def _describe_wordcloud(spec: Spec) -> str:
    words, total, _ = cloud_words(spec, spec["data"])
    f = _formatter(spec)
    v = clip(js_string(spec["value"]), 30)
    t = (f"{_lead(spec, 'Word cloud')} {total} {'word' if total == 1 else 'words'} sized by {v} (font size grows with the square root of the value, so a word's area roughly follows it;"
         " a long word looks bigger than a short one of the same value).")
    if total > len(words):
        t += f" Only the {len(words)} largest are drawn."
    top = words[:10]
    listed = ", ".join(f"{clip(w['text'], 30)} {f(w['value'])}" for w in top)
    t += f" The word: {listed}." if len(words) == 1 else f" {f'Top {len(top)}' if len(top) < len(words) else 'All words'}, largest first: {listed}."
    if isinstance(spec.get("series"), str):
        col = clip(spec["series"], 30)
        groups = distinct(w["series"] or "" for w in words)
        t += f" Coloured by {col}: {_fmt_list([clip(g, 30) if g else f'no {col}' for g in groups])}."
    return t


# ---------------------------------------------------------------------------------------- 3D charts

MAX_SURFACE_SIDE = 200


def _perspective_note(spec: Spec, issues: Issues, alternative: str) -> None:
    persp = spec.get("projection") == "perspective"
    _issue(issues, "info", "perspective_3d", "projection",
           "Perspective draws nearer things larger and farther ones smaller, so sizes and distances on screen do not compare across depth; points can also hide behind others." if persp
           else "A 3D chart hides points behind others, and a position on screen mixes all three values: read exact values from the tooltip, the data table or the description.",
           f"{'Keep the default orthographic projection unless depth matters more than comparison. ' if persp else ''}{alternative}")


def _points3d(spec: Spec, rows: list[dict]) -> list[dict]:
    """The rows with a numeric x, y and z (and a size at or above zero, when set). Mirrors `points3d`."""
    out: list[dict] = []
    size_col, series, label = spec.get("size"), spec.get("series"), spec.get("label")
    for r in rows:
        x, y, z = to_number(r.get(spec["x"])), to_number(r.get(spec["y"])), to_number(r.get(spec["z"]))
        if x is None or y is None or z is None:
            continue
        size = to_number(r.get(size_col)) if size_col else None
        if size_col and (size is None or size < 0):
            continue
        out.append({"x": x, "y": y, "z": z, "s": or_empty(r.get(series)) if series else js_string(spec["z"]), "name": or_empty(r.get(label)) if label else None})
    return out


def _check_scatter3d(spec: Spec, rows: list[dict], issues: Issues) -> None:
    _perspective_note(spec, issues, "For exact comparison show two of the measures in a scatter plot (colour or size for the third), or small multiples.")
    if spec.get("size"):
        neg = sum(1 for r in rows if (to_number(r.get(spec["size"])) or 0) < 0)
        if neg:
            _issue(issues, "warning", "negative_skipped", "size", f"{neg} rows have a negative size and are skipped: an area cannot be negative.")
    n = len(_points3d(spec, rows))
    if not n:
        _issue(issues, "error", "no_points", "data", "No row has a numeric x, y and z (and size, when set).")
    elif n < len(rows):
        _issue(issues, "warning", "incomplete_rows", "data", f"{len(rows) - n} of {len(rows)} rows lack a numeric x, y or z{' (or a size)' if spec.get('size') else ''} and are left out.")


def _describe_scatter3d(spec: Spec) -> str:
    pts = _points3d(spec, spec["data"])
    # `format` is for z, as on the axes and in the tooltips; x and y are given exactly.
    f, e = _formatter(spec), format_exact
    if not pts:
        return f"{_lead(spec, '3D scatter plot')} No points."
    xn, yn, zn = js_string(spec["x"]), js_string(spec["y"]), js_string(spec["z"])
    groups = distinct(p["s"] for p in pts) if spec.get("series") else []
    x, y, z = (extent(p[k] for p in pts) for k in ("x", "y", "z"))
    top = _first_max(pts, lambda p: p["z"])
    low = _first_min(pts, lambda p: p["z"])

    def at(p: dict) -> str:
        name = clip(p["name"], 40) + ", " if p["name"] else ""
        return f"{name}{xn} {e(p['x'])}, {yn} {e(p['y'])}"

    sized = ", sized by " + js_string(spec["size"]) if spec.get("size") else ""
    return (f"{_lead(spec, '3D scatter plot')} {len(pts)} points of {zn} against {xn} and {yn}{sized}"
            f"{f', in {len(groups)} groups ({_fmt_list(groups)})' if len(groups) > 1 else ''}. {xn} ranges from {e(x[0])} to {e(x[1])}, {yn} from {e(y[0])} to {e(y[1])} and {zn} from {f(z[0])} to {f(z[1])}."
            f" Highest {zn}: {f(top['z'])} ({at(top)}). Lowest: {f(low['z'])} ({at(low)}).")


def _grid_of(spec: Spec, rows: list[dict]) -> dict:
    """The grid of a surface: distinct x and y values (ascending), the first z of each cell, repeats and holes. Mirrors `gridOf`."""
    pts: list[tuple[float, float, float]] = []
    for r in rows:
        x, y, z = to_number(r.get(spec["x"])), to_number(r.get(spec["y"])), to_number(r.get(spec["z"]))
        if x is not None and y is not None and z is not None:
            pts.append((x + 0.0, y + 0.0, z))  # a Set keeps -0 as 0
    xs = sorted({p[0] for p in pts})
    ys = sorted({p[1] for p in pts})
    xi = {v: i for i, v in enumerate(xs)}
    yi = {v: i for i, v in enumerate(ys)}
    cells: dict[tuple[int, int], float] = {}
    repeats = 0
    for x, y, z in pts:
        k = (xi[x], yi[y])
        if k in cells:
            repeats += 1
        else:
            cells[k] = z
    missing: list[tuple[float, float]] = []
    if len(xs) <= MAX_SURFACE_SIDE and len(ys) <= MAX_SURFACE_SIDE:
        missing = [(xs[i], ys[j]) for i in range(len(xs)) for j in range(len(ys)) if (i, j) not in cells]
    return {"xs": xs, "ys": ys, "cells": cells, "repeats": repeats, "missing": missing}


def _check_surface(spec: Spec, rows: list[dict], issues: Issues) -> None:
    _perspective_note(spec, issues, "For exact reading, a heatmap of z over x and y shows the same grid without depth.")
    g = _grid_of(spec, rows)
    if not g["cells"]:
        return _issue(issues, "error", "no_points", "data", "No row has a numeric x, y and z.")
    side = MAX_SURFACE_SIDE
    bad = False
    for k, n in (("x", len(g["xs"])), ("y", len(g["ys"]))):
        name = js_string(spec[k])
        if n < 2:
            bad = True
            _issue(issues, "error", "grid_too_small", k, f'"{name}" has {n} distinct value{"" if n == 1 else "s"}; a surface needs at least 2 for x and 2 for y.', "For one row of values use a line chart.")
        elif n > side:
            bad = True
            _issue(issues, "error", "grid_too_large", k, f'"{name}" has {n} distinct values; a surface takes at most {side} (a {side} x {side} grid).', f"Round or bin {k} first (a bin step, then aggregate the mean of z per bin), or draw the rows as a scatter3d.")
    if bad:
        return
    if g["repeats"]:
        _issue(issues, "warning", "duplicate_cells", "data", f"{g['repeats']} rows repeat an (x, y) point already given; the first value is drawn.", "Aggregate first (for example the mean of z per x and y) if the repeats are measurements to combine.")
    if g["missing"]:
        total = len(g["xs"]) * len(g["ys"])
        sparse = len(g["cells"]) < total / 2
        eg = _fmt_list([f"({number_string(x)}, {number_string(y)})" for x, y in g["missing"][:3]], 3)
        _issue(issues, "warning", "missing_cells", "data", f"{len(g['missing'])} of {total} grid points ({len(g['xs'])} x by {len(g['ys'])} y) have no z value and are drawn as holes, e.g. {eg}.",
               "Most of the grid is empty: this looks like scattered points rather than a grid. Use scatter3d, or bin x and y." if sparse else "Give one row for every combination of the x and y values to close the holes.")


def _describe_surface(spec: Spec) -> str:
    g = _grid_of(spec, spec["data"])
    f, e = _formatter(spec), format_exact
    if not g["cells"]:
        return f"{_lead(spec, 'Surface')} No values."
    xs, ys, cells = g["xs"], g["ys"], g["cells"]
    xn, yn, zn = js_string(spec["x"]), js_string(spec["y"]), js_string(spec["z"])
    top: tuple[float, float, float] | None = None
    low: tuple[float, float, float] | None = None
    for i in range(len(xs)):
        for j in range(len(ys)):
            z = cells.get((i, j))
            if z is None:
                continue
            if top is None or z > top[2]:
                top = (xs[i], ys[j], z)
            if low is None or z < low[2]:
                low = (xs[i], ys[j], z)
    assert top is not None and low is not None
    total = len(xs) * len(ys)

    def at(p: tuple[float, float, float]) -> str:
        return f"{xn} {e(p[0])}, {yn} {e(p[1])}"

    return (f"{_lead(spec, 'Surface')} {zn} over a grid of {len(xs)} {xn} by {len(ys)} {yn} values{f' ({total - len(cells)} of {total} points missing)' if len(cells) < total else ''}, coloured by {zn}."
            f" {xn} ranges from {e(xs[0])} to {e(xs[-1])} and {yn} from {e(ys[0])} to {e(ys[-1])}. Highest {zn}: {f(top[2])} at {at(top)}. Lowest: {f(low[2])} at {at(low)}.")


CHECKS_MORE: dict[str, Callable[[Spec, list[dict], Issues], None]] = {
    "gauge": _check_gauge,
    "wordcloud": _check_wordcloud,
    "scatter3d": _check_scatter3d,
    "surface": _check_surface,
}

DESCRIBE_MORE: dict[str, Callable[[Spec], str]] = {
    "gauge": _describe_gauge,
    "wordcloud": _describe_wordcloud,
    "scatter3d": _describe_scatter3d,
    "surface": _describe_surface,
}
