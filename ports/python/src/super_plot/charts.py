# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Per-chart rules the field definitions cannot express: cross-field checks and the plain-language description.

Every function here mirrors one in the reference implementation (`packages/core/src/charts/*.ts`).
The conformance data in `conformance/plot.v1.json` is what keeps them in step.
"""
from __future__ import annotations

from typing import Any, Callable

from ._js import clip, is_finite_number, is_number, js_string, key_string, number_string, or_empty, to_fixed, to_number
from .data import detect_x_kind, distinct, matrix, observations
from .geo import Geography, js_trim, normalize_region
from .isotime import _civil_from_days, to_time
from .numeric import bin_counts, bin_edges, box_stats, closest, correlation, density_peaks, extent, js_round, kde, mean, quantile, r2, total, waffle_cells, waffle_grid
from .text import format_date, format_datetime, format_duration, format_percent, value_formatter

Spec = dict[str, Any]
Issues = list[dict[str, Any]]
MAX_AXES = 16
MAX_NODES = 40
MAX_LINKS = 300
MAX_SERIES = 8  # LIMITS.maxSeries
MAX_CATEGORIES = 500  # LIMITS.maxCategories
MAX_STAGES = 40
MAX_CALENDAR_YEARS = 5
MAX_CHILDREN = 30
MAX_LINES = 2000
_DAY = 86_400_000
_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def _issue(issues: Issues, severity: str, code: str, path: str, message: str, hint: str | None = None) -> None:
    issues.append({"severity": severity, "code": code, "path": path, "message": message, **({"hint": hint} if hint else {})})


def _lead(spec: Spec, kind: str) -> str:
    return f'{kind} "{clip(spec["title"], 120)}".' if spec.get("title") else f"{kind}."


def _fmt_list(items: list[str], most: int = 5) -> str:
    return ", ".join(items) if len(items) <= most else f"{', '.join(items[:most])} and {len(items) - most} more"


def _formatter(spec: Spec) -> Callable[[float], str]:
    return value_formatter(spec.get("format"))


def _first_max(items: list[Any], key: Callable[[Any], float]) -> Any:
    """`reduce((a, b) => b > a ? b : a)`: the first of equal maxima."""
    best = items[0]
    for it in items[1:]:
        if key(it) > key(best):
            best = it
    return best


def _first_min(items: list[Any], key: Callable[[Any], float]) -> Any:
    best = items[0]
    for it in items[1:]:
        if key(it) < key(best):
            best = it
    return best


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def _stable_desc(items: list[Any], key: Callable[[Any], float]) -> list[Any]:
    """`[...items].sort((a, b) => key(b) - key(a))`: largest first, ties in their order."""
    return sorted(items, key=lambda it: -key(it))


def point_notes(spec: Spec) -> str:
    """The labelled points ("Marked: ...") and the lines and bands an assistant added, for the description. Mirrors `pointNotes`."""
    every = spec.get("annotations") or []
    pts = [a for a in every if "axis" not in a and ("x" in a or "y" in a) and isinstance(a.get("label"), str)]
    regions = [a for a in every if "axis" not in a and "x" not in a and "y" not in a and any(k in a for k in ("xFrom", "xTo", "yFrom", "yTo")) and isinstance(a.get("label"), str)]

    def more(n: int) -> str:
        return f" and {n - 5} more" if n > 5 else ""

    out = ""
    if pts:
        items = [f'"{clip(a["label"], 40)}" at {clip(js_string(a.get("x")), 30)}, {clip(js_string(a.get("y")), 30)}{" (added by the assistant)" if a.get("by") == "assistant" else ""}' for a in pts[:5]]
        out += f" Marked: {'; '.join(items)}{more(len(pts))}."
    if regions:

        def span(a: dict, k: str) -> str:
            lo, hi = a.get(f"{k}From"), a.get(f"{k}To")
            if lo is None and hi is None:
                return ""
            return f"{k} {'lowest' if lo is None else clip(js_string(lo), 30)} to {'highest' if hi is None else clip(js_string(hi), 30)}"

        items = [f'"{clip(a["label"], 40)}" ({", ".join(t for t in (span(a, "x"), span(a, "y")) if t)}){" (added by the assistant)" if a.get("by") == "assistant" else ""}' for a in regions[:5]]
        out += f" Shaded: {'; '.join(items)}{more(len(regions))}."
    lines = [a for a in every if "axis" in a and a.get("by") == "assistant"]
    if lines:
        items = []
        for a in lines[:5]:
            lab = a.get("label")
            head = f'"{clip(lab, 40)}" at ' if isinstance(lab, str) and lab else ""
            tail = f" to {clip(js_string(a['to']), 30)}" if "to" in a else ""
            items.append(f"{head}{js_string(a.get('axis'))} {clip(js_string(a.get('value')), 30)}{tail}")
        out += f" The assistant marked {'; '.join(items)}{more(len(lines))}."
    return out


# ------------------------------------------------------------------------------- log scales, intervals
# Mirrors `packages/core/src/charts/extras.ts`.


def _refuse_log(spec: Spec, issues: Issues, field: str) -> None:
    if spec.get(field) == "log":
        _issue(issues, "error", "log_scale_refused", field, f'{field} "log" is refused here.', "Use a line or a scatter for values spanning several orders of magnitude.")


def _log_non_positive(rows: list[dict], cols: list[str], path: str, issues: Issues) -> None:
    """Values at or below zero in the columns behind a log axis: one issue with the count."""
    bad = seen = 0
    for r in rows:
        for c in cols:
            n = to_number(r.get(c))
            if n is None:
                continue
            seen += 1
            if n <= 0:
                bad += 1
    if not bad:
        return
    if bad == seen:
        _issue(issues, "error", "log_nonpositive", path, "Every value is zero or negative; a log axis cannot show any of them.", "Use the linear scale, or plot a positive quantity.")
    else:
        _issue(issues, "warning", "log_nonpositive", path, f"{bad} of {seen} values are zero or negative; a log axis cannot place them, so they are left out.", "Filter them with `transform`, or use the linear scale.")


def _log_domain(spec: Spec, issues: Issues, scale_field: str, domain_field: str) -> None:
    d = spec.get(domain_field)
    if spec.get(scale_field) != "log" or not d:
        return
    if (d[0] is not None and d[0] <= 0) or (d[1] is not None and d[1] <= 0):
        _issue(issues, "error", "log_bad_domain", domain_field, f"{domain_field} must be above zero on a log axis.", "Use a positive lower bound such as 1 or 0.1, or null for automatic.")


def _interval_check(spec: Spec, rows: list[dict], issues: Issues, axis: str) -> bool:
    """`xLower` without `xUpper` (or the other way round), and intervals whose ends are swapped."""
    lo, hi = spec.get(f"{axis}Lower"), spec.get(f"{axis}Upper")
    if lo is None and hi is None:
        return False
    if lo is None or hi is None:
        missing = f"{axis}Lower" if lo is None else f"{axis}Upper"
        _issue(issues, "error", "interval_incomplete", missing, f"An interval needs both {axis}Lower and {axis}Upper; {missing} is missing.", f"Give {missing} too.")
        return False
    swapped = 0
    for r in rows:
        a, b = to_number(r.get(lo)), to_number(r.get(hi))
        if a is not None and b is not None and a > b:
            swapped += 1
    if swapped:
        _issue(issues, "warning", "interval_reversed", f"{axis}Lower", f"In {swapped} {_plural(swapped, 'row', 'rows')} {axis}Lower is above {axis}Upper; the interval is drawn between the two anyway.")
    return True


# ------------------------------------------------------------------------- two value axes, broken axis
# Mirrors `packages/core/src/charts/valueaxes.ts`.

_RIGHT_ONLY = ["yRightLabel", "rightDomain", "formatRight", "rightReverse"]


def _right_cols(spec: Spec) -> list[str]:
    """The columns of `yRight`, as a list."""
    if "yRight" not in spec:
        return []
    return spec["yRight"] if isinstance(spec["yRight"], list) else [spec["yRight"]]


def _dual_check(spec: Spec, issues: Issues, left: list[str], refused: str | None = None, ignored: str | None = None) -> None:
    """Checks for `yRight`: `refused` says why a right axis cannot be drawn here (an error), `ignored` why it is left out."""
    right = _right_cols(spec)
    if not right:
        for k in _RIGHT_ONLY:
            if k in spec:
                _issue(issues, "warning", "right_axis_unused", k, f"{k} is ignored: there is no right axis without `yRight`.", "Add yRight with the column(s) for the right axis, or drop this field.")
        return
    if refused:
        _issue(issues, "error", "dual_axis_refused", "yRight", f"A right axis is refused here: {refused}", "Index the series to a common base (an `index` transform step) and use one axis, or draw two charts with `sync`.")
        return
    if ignored:
        _issue(issues, "warning", "dual_axis_ignored", "yRight", f"yRight is ignored {ignored}", "Use vertical bars (or a line chart) for a right axis.")
        return
    bad = False
    for i, c in enumerate(right):
        if c in left:
            bad = True
            _issue(issues, "error", "dual_axis_overlap", f"yRight[{i}]" if isinstance(spec["yRight"], list) else "yRight", f'Column "{c}" is on both axes.', "Give each column one axis: remove it from y (or line), or from yRight.")
    if bad:
        return
    names = _fmt_list([f'"{clip(c, 40)}"' for c in right])
    _issue(issues, "info", "dual_axis", "yRight",
           f"{names} {'is' if len(right) == 1 else 'are'} drawn against a second value axis on the right. Two independent scales on one plot can suggest a relationship (where lines cross, how far apart they are, whether they move together) that is only the choice of the two ranges.",
           'To compare growth, index every series to a common base (transform step {"index":{"field":...,"groupBy":[...]}}) and use one axis; to compare levels, draw two charts with `sync`. Keep the right axis only when the two measures are related and the reader needs both on one time line.')


def _break_plan(values: list[float], brk: list[float], bars: bool) -> tuple[list[float], bool]:
    """Values on a broken axis: those inside the cut, and whether any lies beyond it. Mirrors `breakPlan`."""
    lo, hi = brk
    inside = [v for v in values if lo < v < hi]
    above = any(v >= hi for v in values)
    below = any(v <= lo for v in values)
    # Bars start at zero, outside the cut: the far side is the one away from zero.
    beyond = (above if lo > 0 else below) if bars else above and below
    return inside, beyond


def _say(v: float) -> str:
    return number_string(js_round(v * 1e6) / 1e6)


def _break_check(spec: Spec, issues: Issues, values: list[float], bars: bool, refused: str | None = None) -> bool:
    """Checks for `yBreak`; a break with no value beyond it is removed from the normalised spec. Mirrors `breakCheck`."""
    if "yBreak" not in spec:
        return False
    b = spec["yBreak"]
    if b[0] is None or b[1] is None:
        _issue(issues, "error", "bad_value", "yBreak", "yBreak needs two numbers, [from, to]: the span to cut out of the axis.", "E.g. [50, 900] to cut out everything between 50 and 900.")
        return False
    if refused:
        _issue(issues, "error", "break_refused", "yBreak", f"A broken axis is refused here: {refused}", "Use facets or (on a line) a log scale to show values of very different size.")
        return False
    span = f"[{_say(b[0])}, {_say(b[1])}]"
    if bars and b[0] <= 0 and b[1] >= 0:
        _issue(issues, "error", "break_misleading", "yBreak", f"yBreak {span} cuts out zero, where every bar starts: the bars that do not cross the break would lose their baseline and their lengths would mean nothing.",
               "Move the break to a span that every bar either crosses or stays below (both ends above zero, or both below), or drop it and use facets.")
        return False
    inside, beyond = _break_plan(values, b, bars)
    if not beyond:
        _issue(issues, "warning", "break_outside", "yBreak", f"No value lies beyond yBreak {span}{'' if bars else ' on both sides'}, so there is nothing to bring closer: the break is not drawn.", "Set the break between the small and the large values, or drop it.")
        # The normalised spec says what is drawn.
        del spec["yBreak"]
        return False
    if inside:
        n = len(inside)
        _issue(issues, "warning", "break_hides_values", "yBreak",
               f"{n} {'value lies' if n == 1 else 'values lie'} inside the cut-out span ({', '.join(_say(v) for v in inside[:5])}{', ...' if n > 5 else ''}); {'it is' if n == 1 else 'they are'} drawn at the edge of the break, marked with a dashed outline, and tooltips say so.",
               "A break should remove a span no value falls in. Narrow it so no value lies inside, or drop it.")
    how = "Bars that cross the cut are drawn shorter than their value, so large and small bars look closer than they are" if bars else "Changes across the cut look smaller than they are"
    _issue(issues, "info", "axis_break", "yBreak", f"The value axis is cut from {_say(b[0])} to {_say(b[1])}: a span of {_say(b[1] - b[0])} is not drawn. {how}; a zigzag gap marks the cut, and tooltips and the description give the real values.",
           "To show values of very different size without hiding part of the scale, use facets, or a log scale on a line chart.")
    return True


def _range_text(values: list[float], fmt: str | None) -> str:
    """Lowest and highest of some numbers, as text in a format. Mirrors `rangeText`."""
    if not values:
        return "no values"
    f = value_formatter(fmt)
    lo, hi = float("inf"), float("-inf")
    for v in values:
        if v < lo:
            lo = v
        if v > hi:
            hi = v
    return f(lo) if lo == hi else f"{f(lo)} to {f(hi)}"


def _dual_note(spec: Spec, left_keys: list[str], left_values: list[float], right_keys: list[str], right_values: list[float]) -> str:
    """The description's sentence on two value axes. Mirrors `dualNote`."""
    def axis(side: str, label: Any) -> str:
        return f"the {side} axis{f' ({clip(label, 60)})' if isinstance(label, str) and label else ''}"

    right_format = spec["formatRight"] if spec.get("formatRight") is not None else spec.get("format")
    return (f" Two value axes with independent scales: {axis('left', spec.get('yLabel'))} shows {_fmt_list([clip(k, 40) for k in left_keys])} ({_range_text(left_values, spec.get('format'))});"
            f" {axis('right', spec.get('yRightLabel'))} shows {_fmt_list([clip(k, 40) for k in right_keys])} ({_range_text(right_values, right_format)})."
            " Where the lines meet or how steep they look depends on the two chosen ranges, not on the data.")


def _break_note(spec: Spec, values: list[float], bars: bool) -> str:
    """The description's sentence on a broken axis. Mirrors `breakNote`."""
    brk = spec.get("yBreak")
    if not brk or brk[0] is None or brk[1] is None:
        return ""
    f = value_formatter(spec.get("format"))
    inside = len(_break_plan(values, brk, bars)[0])
    how = "bars that cross it are drawn shorter than their value" if bars else "changes across it look smaller than they are"
    more = f" {inside} {'value lies' if inside == 1 else 'values lie'} inside the cut and {'is' if inside == 1 else 'are'} drawn at its edge." if inside else ""
    return f" The value axis is broken: the span from {f(brk[0])} to {f(brk[1])} is cut out, so {how}; the values given here are the real ones.{more}"


# ---------------------------------------------------------------------------------------------- bar


def _bar_model(spec: Spec) -> tuple[list[str], list[str], dict[str, dict[str, float]]]:
    obs = observations(spec["data"], spec.get("x"), spec["y"], spec.get("series"))
    m = matrix(obs)
    cats = distinct(key_string(o["x"]) for o in obs)
    keys = distinct(o["s"] for o in obs)
    sort = spec.get("sort")
    if sort and sort != "none":
        def tot(k: str) -> float:
            return total(list(m.get(k, {}).values()))
        cats = sorted(cats, key=tot, reverse=sort == "desc")
    return cats, keys, m


def _line_cols(spec: Spec) -> list[str]:
    """Combo chart: columns drawn as lines over vertical bars. Mirrors `lineCols`."""
    if "line" not in spec or spec.get("orientation") == "horizontal" or spec.get("stack") == "normalize":
        return []
    return spec["line"] if isinstance(spec["line"], list) else [spec["line"]]


def _right_line_cols(spec: Spec) -> list[str]:
    """Lines on a second value axis (`yRight`): vertical bars that are not 100% stacked only. Mirrors `rightLineCols`."""
    if spec.get("orientation") == "horizontal" or spec.get("stack") == "normalize":
        return []
    return _right_cols(spec)


def _col_sums(spec: Spec, col: str) -> dict[str, float]:
    """Per category, the sum of a column (duplicates summed, like bars). Mirrors `colSums`."""
    mm: dict[str, float] = {}
    for r in spec["data"]:
        v = to_number(r.get(col))
        if v is None:
            continue
        cat = key_string(r.get(spec["x"]))
        mm[cat] = mm.get(cat, 0.0) + v
    return mm


def _bar_axis_values(spec: Spec) -> list[float]:
    """The numbers drawn on the left value axis: bars, lines and whisker ends. Mirrors `axisValues`."""
    _, keys, m = _bar_model(spec)
    out: list[float] = []
    for row in m.values():
        for k in keys:
            if k in row:
                out.append(row[k])
    for k in _line_cols(spec):
        if k not in keys:
            out.extend(_col_sums(spec, k).values())
    if spec.get("yLower") and spec.get("yUpper") and spec.get("stack", "none") == "none":
        for r in spec["data"]:
            for col in (spec["yLower"], spec["yUpper"]):
                n = to_number(r.get(col))
                if n is not None:
                    out.append(n)
    return out


def _series_ignored(spec: Spec, issues: Issues) -> None:
    if isinstance(spec.get("y"), list) and len(spec["y"]) > 1 and spec.get("series"):
        _issue(issues, "warning", "series_ignored", "series", "`series` is ignored when `y` lists several columns.")


def _check_bar(spec: Spec, rows: list[dict], issues: Issues) -> None:
    _series_ignored(spec, issues)
    if spec.get("stack") in ("stack", "normalize"):
        ys = spec["y"] if isinstance(spec["y"], list) else [spec["y"]]
        neg = any(is_number(r.get(c)) and r[c] < 0 for r in rows for c in ys)
        if neg:
            _issue(issues, "warning", "negative_in_stack", "y", "Negative values in a stacked bar are stacked below the axis; check that is what you want.")
    if "line" in spec and (spec.get("orientation") == "horizontal" or spec.get("stack") == "normalize"):
        _issue(issues, "warning", "line_ignored", "line", f"`line` is ignored on {'horizontal' if spec.get('orientation') == 'horizontal' else '100% stacked'} bars.")
    ys = spec["y"] if isinstance(spec["y"], list) else [spec["y"]]
    line_list = [] if "line" not in spec else spec["line"] if isinstance(spec["line"], list) else [spec["line"]]
    _dual_check(spec, issues, [*ys, *line_list],
                ignored="on horizontal bars: their value axis runs along x." if spec.get("orientation") == "horizontal" else "on 100% stacked bars: their axis is a share, not a quantity." if spec.get("stack") == "normalize" else None)
    _break_check(spec, issues, _bar_axis_values(spec), True,
                 "a stack adds its segments end to end, so a cut would fall inside segments and hide which ones." if spec.get("stack") in ("stack", "normalize")
                 else "bars refuse a log axis." if spec.get("yScale") == "log"
                 else "with a right axis, a break on the left one would make the two scales even harder to compare." if _right_line_cols(spec) else None)
    _refuse_log(spec, issues, "yScale")
    stacked = spec.get("stack") in ("stack", "normalize")
    if spec.get("mark") == "lollipop" and stacked:
        _issue(issues, "warning", "lollipop_stacked", "mark", "Lollipops cannot stack; stacked bars are drawn instead.", 'Set stack to "none" for side-by-side lollipops.')
    if _interval_check(spec, rows, issues, "y") and stacked:
        _issue(issues, "warning", "interval_ignored_stacked", "yLower", "Whiskers cannot be shown on stacked bars; they are left out.", 'Set stack to "none" for grouped bars with whiskers.')
    if detect_x_kind("auto", [r.get(spec["x"]) for r in rows]) == "time" and len(rows) > 60:
        _issue(issues, "warning", "prefer_line", "type", "Many bars over time: a line or area chart reads better.")


def _describe_bar(spec: Spec) -> str:
    cats, keys, m = _bar_model(spec)
    f = _formatter(spec)
    # A category with no number at all is missing, not 0: named at the end, and left out of the extremes and the total.
    totals = [{"c": c, "v": total(list(m[c].values()))} for c in cats if c in m]
    missing = [clip(c, 30) for c in cats if c not in m]
    unstacked = spec.get("stack", "none") == "none"
    t = f"{_lead(spec, 'Lollipop chart' if spec.get('mark') == 'lollipop' and unstacked else 'Bar chart')} {len(cats)} {_plural(len(cats), 'category', 'categories')}"
    if len(keys) > 1:
        stack = spec.get("stack")
        t += f", {len(keys)} series ({_fmt_list(keys)}{', stacked' if stack == 'stack' else ', stacked to 100%' if stack == 'normalize' else ''})."
    else:
        t += "."
    if totals:
        hi = _first_max(totals, lambda x: x["v"])
        lo = _first_min(totals, lambda x: x["v"])
        t += f" Highest: {clip(hi['c'], 40)} ({f(hi['v'])})."
        if len(totals) > 1:
            t += f" Lowest: {clip(lo['c'], 40)} ({f(lo['v'])})."
        t += f" Total: {f(total([x['v'] for x in totals]))}."
    if missing:
        t += f" Missing: {_fmt_list(missing)} (no value, so not counted above)."
    ls = [k for k in _line_cols(spec) if k not in keys]
    if ls:
        t += f" With {'a line' if len(ls) == 1 else 'lines'} for {_fmt_list(ls)} on the same axis."
    rs = [k for k in _right_line_cols(spec) if k not in keys and k not in ls]
    if rs:
        fr = value_formatter(spec["formatRight"] if spec.get("formatRight") is not None else spec.get("format"))
        for k in rs[:2]:
            vals = list(_col_sums(spec, k).items())
            if not vals:
                continue
            top = _first_max(vals, lambda x: x[1])
            low = _first_min(vals, lambda x: x[1])
            t += (f" {clip(k, 40)} (right axis, a line): from {fr(vals[0][1])} at {clip(vals[0][0], 40)} to {fr(vals[-1][1])} at {clip(vals[-1][0], 40)};"
                  f" peak {fr(top[1])} at {clip(top[0], 40)}, low {fr(low[1])} at {clip(low[0], 40)}.")
        left_vals = [v for row in m.values() for v in row.values()]
        for k in ls:
            left_vals.extend(_col_sums(spec, k).values())
        t += _dual_note(spec, [*keys, *ls], left_vals, rs, [v for k in rs for v in _col_sums(spec, k).values()]).replace("Where the lines meet", "Where a line meets the bars", 1)
    if spec.get("yBreak") and unstacked and not rs:
        t += _break_note(spec, _bar_axis_values(spec), True)
    if spec.get("yLower") and spec.get("yUpper") and unstacked:
        t += f" Whiskers show {clip(spec['yLower'], 40)} to {clip(spec['yUpper'], 40)}."
    return t


# ---------------------------------------------------------------------------------------- line / area


def _describe_series(spec: Spec, name: str) -> str:
    obs = observations(spec["data"], spec.get("x"), spec["y"], spec.get("series"))
    kind = detect_x_kind(spec.get("xType"), [o["x"] for o in obs])
    keys = distinct(o["s"] for o in obs)
    f = _formatter(spec)

    def xk(r: Any) -> Any:
        return key_string(r) if kind == "category" else to_time(r) if kind == "time" else to_number(r)

    def label(x: Any) -> str:
        return format_date(x) if kind == "time" else (x if isinstance(x, str) else number_string(x))

    rights = _right_cols(spec) if spec.get("stack", "none") == "none" and spec.get("yScale") != "log" else []
    obs_r = observations(spec["data"], spec.get("x"), rights) if rights else []
    keys_r = [k for k in distinct(o["s"] for o in obs_r) if k not in keys]
    every = [*keys, *keys_r]
    t = f"{_lead(spec, name)} {len(every)} series{f' ({_fmt_list(every)})' if len(every) > 1 else ''} over {'categories' if kind == 'category' else 'time' if kind == 'time' else 'a numeric x axis'}."
    f_left = f
    f_right = value_formatter(spec["formatRight"] if spec.get("formatRight") is not None else spec.get("format"))
    for k, right in [*((k, False) for k in keys[:4]), *((k, True) for k in keys_r[:2])]:
        f = f_right if right else f_left
        pts = [{"x": xk(o["x"]), "y": o["y"]} for o in (obs_r if right else obs) if o["s"] == k and o["y"] is not None and xk(o["x"]) is not None
               and (spec.get("yScale") != "log" or o["y"] > 0) and (spec.get("xScale") != "log" or kind != "linear" or xk(o["x"]) > 0)]
        if kind != "category":
            pts.sort(key=lambda p: p["x"])
        if not pts:
            continue
        first, last = pts[0], pts[-1]
        hi = _first_max(pts, lambda p: p["y"])
        lo = _first_min(pts, lambda p: p["y"])
        change = f" ({to_fixed(((last['y'] - first['y']) / abs(first['y'])) * 100, 1)}%)" if first["y"] != 0 else ""
        t += (f" {clip(k, 40)}{' (right axis)' if right else ''}: from {f(first['y'])} at {label(first['x'])} to {f(last['y'])} at {label(last['x'])}{change if len(pts) > 1 else ''};"
              f" peak {f(hi['y'])} at {label(hi['x'])}, low {f(lo['y'])} at {label(lo['x'])}.")
    if keys_r:
        def vals(o: list[dict]) -> list[float]:
            return [p["y"] for p in o if p["y"] is not None and xk(p["x"]) is not None]

        t += _dual_note(spec, keys, vals(obs), keys_r, vals(obs_r))
    if spec["type"] == "line" and spec.get("yBreak") and spec.get("yScale") != "log" and not keys_r:
        t += _break_note(spec, _line_values(spec), False)
    return t + _series_notes(spec)


def _line_values(spec: Spec) -> list[float]:
    """The numbers a line chart draws on its value axis: the y columns and the interval ends. Mirrors `lineValues`."""
    cols = [*(spec["y"] if isinstance(spec["y"], list) else [spec["y"]]), *([spec["yLower"], spec["yUpper"]] if spec.get("yLower") and spec.get("yUpper") else [])]
    out: list[float] = []
    for r in spec["data"]:
        for col in cols:
            n = to_number(r.get(col))
            if n is not None:
                out.append(n)
    return out


def _has_band(spec: Spec) -> bool:
    """Shaded intervals behind lines: only with one `y` column, and not on stacked areas."""
    return bool(spec.get("yLower")) and bool(spec.get("yUpper")) and not (isinstance(spec["y"], list) and len(spec["y"]) > 1) and spec.get("stack", "none") == "none"


def _series_notes(spec: Spec) -> str:
    """One sentence on log axes and bands, for the description. Mirrors `seriesNotes`."""
    t = ""
    axes = [a for a in ("y", "x") if spec.get(f"{a}Scale") == "log" and spec["type"] == "line"]
    if axes:
        t += f" The {' and '.join(axes)} axis {'are' if len(axes) > 1 else 'is'} logarithmic."
    if _has_band(spec):
        t += f" A shaded band shows {clip(spec['yLower'], 40)} to {clip(spec['yUpper'], 40)}."
    return t


def _check_series(spec: Spec, rows: list[dict], issues: Issues, area: bool) -> None:
    """Mirrors `seriesCheck`."""
    multi = isinstance(spec["y"], list) and len(spec["y"]) > 1
    left = spec["y"] if isinstance(spec["y"], list) else [spec["y"]]
    stacked = spec.get("stack", "none") != "none"
    _dual_check(spec, issues, left,
                refused="a stacked area adds its series together, and a series on another scale cannot be part of that sum." if area and stacked
                else "the left axis is logarithmic; a log and a linear axis on one plot cannot be compared at all." if not area and spec.get("yScale") == "log" else None)
    if not area:
        _break_check(spec, issues, _line_values(spec), False,
                     "the left axis is drawn upside down; a cut in it would be read the wrong way round." if spec.get("yReverse")
                     else "a log axis already compresses large values; cutting a span out of it as well would hide by how much." if spec.get("yScale") == "log"
                     else "with a right axis, a break on the left one would make the two scales even harder to compare." if _right_cols(spec) else None)
    if multi and spec.get("series"):
        _issue(issues, "warning", "series_ignored", "series", "`series` is ignored when `y` lists several columns.")
    if _interval_check(spec, rows, issues, "y"):
        if multi:
            _issue(issues, "warning", "interval_needs_one_y", "yLower", "yLower and yUpper describe one column; with several `y` columns no band is drawn.", "Fold the columns into long form (a `fold` step) and use `series`.")
        elif spec.get("stack") in ("stack", "normalize", "center"):
            _issue(issues, "warning", "interval_ignored_stacked", "yLower", "An interval cannot be shown on a stacked area; no band is drawn.", 'Set stack to "none", or use a line chart.')
    if area:
        _refuse_log(spec, issues, "yScale")
        return
    ys = spec["y"] if isinstance(spec["y"], list) else [spec["y"]]
    if spec.get("yScale") == "log":
        _log_non_positive(rows, ys, "y", issues)
        _log_domain(spec, issues, "yScale", "yDomain")
        if spec.get("gaps") == "zero":
            _issue(issues, "warning", "gaps_zero_log", "gaps", "A log axis has no zero, so missing values break the line instead.")
    if spec.get("xScale") == "log":
        if detect_x_kind(spec.get("xType"), [r.get(spec["x"]) for r in rows]) != "linear":
            _refuse_log(spec, issues, "xScale")
        else:
            _log_non_positive(rows, [spec["x"]], "x", issues)
            _log_domain(spec, issues, "xScale", "xDomain")


# ------------------------------------------------------------------------------------------ scatter


def _scatter_kind(spec: Spec, rows: list[dict]) -> str:
    if spec.get("xType") in ("time", "linear"):
        return spec["xType"]
    return "time" if any(isinstance(r.get(spec["x"]), str) and to_number(r.get(spec["x"])) is None for r in rows) else "linear"


def _scatter_points(spec: Spec, rows: list[dict]) -> list[dict]:
    kind = _scatter_kind(spec, rows)
    log_x = spec.get("xScale") == "log" and kind == "linear"
    log_y = spec.get("yScale") == "log"
    pts = []
    for r in rows:
        x = to_time(r.get(spec["x"])) if kind == "time" else to_number(r.get(spec["x"]))
        y = to_number(r.get(spec["y"]))
        if x is None or y is None or (log_x and not x > 0) or (log_y and not y > 0):
            continue
        pts.append({"x": x, "y": y, "s": or_empty(r.get(spec["series"])) if spec.get("series") else str(spec["y"])})
    return pts


def _check_scatter(spec: Spec, rows: list[dict], issues: Issues) -> None:
    kind = _scatter_kind(spec, rows)
    if spec.get("xScale") == "log" and kind == "time":
        _refuse_log(spec, issues, "xScale")
    for a in ("x", "y"):
        if spec.get(f"{a}Scale") != "log" or (a == "x" and kind == "time"):
            continue
        _log_non_positive(rows, [spec[a]], a, issues)
        _log_domain(spec, issues, f"{a}Scale", f"{a}Domain")
    _interval_check(spec, rows, issues, "y")
    _interval_check(spec, rows, issues, "x")
    if spec.get("order") and spec.get("density") == "hex":
        _issue(issues, "warning", "order_ignored_density", "order", "Hexagons count points, so no line joins them; `order` is ignored while hexagons are drawn.", 'Use `density: "points"` (or leave it out) for a connected scatter.')
    jit = spec.get("jitter")
    if is_number(jit) and jit > 0 and not _jittered(spec):
        if spec.get("order"):
            _issue(issues, "warning", "jitter_ignored", "jitter", "A line joins the points of a connected scatter, so jitter would pull them off it; `jitter` is ignored.", "Drop `order` to jitter the dots, or drop `jitter`.")
        else:
            _issue(issues, "warning", "jitter_ignored", "jitter", "Hexagons count points, so there are no dots to nudge; `jitter` is ignored while hexagons are drawn.", 'Use `density: "points"` (or leave it out) to jitter the dots.')
    if "jitterAxis" in spec and not (is_number(jit) and jit > 0):
        _issue(issues, "warning", "jitter_axis_ignored", "jitterAxis", "jitterAxis only applies when `jitter` is above 0; it is ignored.")
    if "trendBandwidth" in spec and spec.get("trend") != "loess":
        _issue(issues, "warning", "trend_bandwidth_ignored", "trendBandwidth", 'trendBandwidth only applies to `trend: "loess"`; it is ignored.')
    if _has_error(issues):
        return
    if not _scatter_points(spec, rows):
        _issue(issues, "error", "no_points", "data", "No row has both a numeric x and y.")


def _describe_scatter(spec: Spec) -> str:
    pts = _scatter_points(spec, spec["data"])
    f = _formatter(spec)
    keys = distinct(p["s"] for p in pts)
    groups = f", in {len(keys)} groups ({', '.join(keys[:5])})" if len(keys) > 1 else ""
    t = f"{_lead(spec, 'Scatter plot')} {len(pts)} points of {spec['y']} against {spec['x']}{groups}."
    r = correlation([p["x"] for p in pts], [p["y"] for p in pts])
    if r is not None:
        strength = "strong" if abs(r) >= 0.7 else "moderate" if abs(r) >= 0.4 else "weak"
        t += f" Correlation {to_fixed(r, 2)} ({strength} {'positive' if r >= 0 else 'negative'})."
    ey = extent(p["y"] for p in pts)
    if ey:
        t += f" {spec['y']} ranges from {f(ey[0])} to {f(ey[1])}."
    logs = (["x"] if spec.get("xScale") == "log" and _scatter_kind(spec, spec["data"]) == "linear" else []) + (["y"] if spec.get("yScale") == "log" else [])
    if logs:
        t += f" The {' and '.join(logs)} axis {'are' if len(logs) > 1 else 'is'} logarithmic."
    bars = (["vertical"] if spec.get("yLower") and spec.get("yUpper") else []) + (["horizontal"] if spec.get("xLower") and spec.get("xUpper") else [])
    if bars:
        t += f" Points carry {' and '.join(bars)} error bars."
    if spec.get("order") and spec.get("density") != "hex":
        t += f" Points are joined by a line in the order of {spec['order']}."
    if _jittered(spec):
        axis = spec.get("jitterAxis")
        t += f" Points are nudged slightly{' sideways' if axis == 'x' else ' up and down' if axis == 'y' else ''} so that overlapping points show; their drawn positions are approximate, the values exact."
    if spec.get("trend") == "loess":
        t += " A LOESS curve shows the local trend."
    return t


def _jittered(spec: dict) -> bool:
    """Whether `jitter` moves points: set, above 0, and not a chart that draws hexagons or joins points by a line."""
    j = spec.get("jitter")
    return is_number(j) and j > 0 and spec.get("density") != "hex" and not spec.get("order")


# --------------------------------------------------------------------------------------- pie / donut


def _pie_slices(spec: Spec) -> list[dict]:
    sums: dict[str, float] = {}
    for r in spec["data"]:
        v = to_number(r.get(spec["value"]))
        k = or_empty(r.get(spec["label"]))
        if v is None or v < 0:
            continue
        sums[k] = sums.get(k, 0.0) + v
    order = [k for k in distinct(or_empty(r.get(spec["label"])) for r in spec["data"]) if k in sums]
    allv = [{"key": k, "value": sums[k]} for k in order]
    sort = spec.get("sort")
    if sort and sort != "none":
        allv = sorted(allv, key=lambda s: s["value"], reverse=sort != "asc")
    limit = spec.get("maxSlices", 8)
    if len(allv) > limit:
        keep = {s["key"] for s in sorted(allv, key=lambda s: s["value"], reverse=True)[: limit - 1]}
        rest = [s for s in allv if s["key"] not in keep]
        allv = [s for s in allv if s["key"] in keep] + [{"key": "Other", "value": total([s["value"] for s in rest])}]
    return allv


def _check_pie(spec: Spec, rows: list[dict], issues: Issues) -> None:
    """negative_slices, pie_no_positive and zero_slices, on what the chart draws. Mirrors `checkPie`."""
    sums: dict[str, float] = {}
    negative = 0
    for r in rows:
        v = to_number(r.get(spec["value"]))
        if v is None:
            continue
        if v < 0:
            negative += 1
            continue
        k = or_empty(r.get(spec["label"]))
        sums[k] = sums.get(k, 0.0) + v
    if negative:
        _issue(issues, "warning", "negative_slices", "data", f"{negative} negative value(s) were skipped; a pie cannot show negatives.", "Use a bar chart for values that can be negative, or remove those rows with `transform`.")
    if not any(v > 0 for v in sums.values()):
        _issue(issues, "warning", "pie_no_positive", "value", f"No slice has a positive value, so the {spec['type']} has nothing to draw.",
               f'A {spec["type"]} shows shares of a positive total: check the "{spec["value"]}" column, or use a bar chart for values that are zero or negative.')
        return
    zero = sum(1 for v in sums.values() if v == 0)
    if zero:
        _issue(issues, "warning", "zero_slices", "value", f"{zero} slice(s) add up to 0: they get no angle and appear in the legend only.", "Remove those rows with `transform` to drop them from the legend too.")


def _describe_pie(spec: Spec, name: str) -> str:
    allv = _pie_slices(spec)
    tot = total([a["value"] for a in allv])
    f = _formatter(spec)
    t = f"{_lead(spec, name)} {len(allv)} {_plural(len(allv), 'slice', 'slices')} totalling {f(tot)}."
    if tot > 0:
        srt = sorted(allv, key=lambda s: s["value"], reverse=True)
        t += f" Largest: {clip(srt[0]['key'], 40)} ({format_percent(srt[0]['value'] / tot)})."
        if len(srt) > 2:
            top = srt[:3]
            t += f" The top {min(3, len(srt))} ({_fmt_list([clip(x['key'], 30) for x in top], 3)}) make up {format_percent(total([x['value'] for x in top]) / tot)}."
    else:
        t += " No slice has a positive value, so nothing is drawn."
    return t


# ---------------------------------------------------------------------------------------- histogram


def _groups(spec: Spec, value_key: str, group_key: str | None) -> dict[str, list[float]]:
    g: dict[str, list[float]] = {}
    for r in spec["data"]:
        v = to_number(r.get(spec[value_key]))
        if v is None:
            continue
        k = or_empty(r.get(spec[group_key])) if group_key and spec.get(group_key) else str(spec[value_key])
        g.setdefault(k, []).append(v)
    return g


def _describe_histogram(spec: Spec) -> str:
    g = _groups(spec, "value", "series")
    allv = [v for vs in g.values() for v in vs]
    f = value_formatter("auto")
    if not allv:
        return f"{_lead(spec, 'Histogram')} No numeric values."
    edges = bin_edges(allv, spec.get("bins", "auto"), spec.get("binWidth"))
    counts = bin_counts(allv, edges)
    peak = counts.index(max(counts))
    srt = sorted(allv)
    t = (f"{_lead(spec, 'Histogram')} {len(allv)} values of {spec['value']} in {len(counts)} bins of width {f(edges[1] - edges[0])}."
         f" Mean {f(mean(allv))}, median {f(quantile(srt, 0.5))}, range {f(srt[0])} to {f(srt[-1])}."
         f" Most common bin: {f(edges[peak])} to {f(edges[peak + 1])} ({counts[peak]} values).")
    keys = list(g.keys())
    if len(keys) > 1:
        t += f" Groups: {_fmt_list(keys)}."
    return t


# -------------------------------------------------------------------------------------------- box


def _box_groups(spec: Spec, rows: list[dict]) -> dict[str, list[float]]:
    """Values per group, in order of first appearance (box and violin). Mirrors `groups` in box.ts."""
    g: dict[str, list[float]] = {}
    for r in rows:
        v = to_number(r.get(spec["y"]))
        if v is None:
            continue
        k = or_empty(r.get(spec["x"])) if spec.get("x") else str(spec["y"])
        g.setdefault(k, []).append(v)
    return g


def _check_points(spec: Spec, rows: list[dict], issues: Issues) -> None:
    """Cross-field checks shared by box and violin. Mirrors `checkPoints`."""
    if "points" in spec and spec.get("outliers") is False and spec["points"] != "none":
        _issue(issues, "warning", "outliers_ignored", "outliers", "`outliers: false` is ignored because `points` is set.", 'Use points: "none" to hide every dot, and drop `outliers`.')
    if spec.get("points") == "all" and len(spec.get("data") or []) > 5000:
        _issue(issues, "warning", "many_marks", "points", f'points: "all" draws {len(spec["data"])} dots.', 'Use points: "outliers", or sample with `transform`.')
    if spec.get("patterns") is True:
        _issue(issues, "warning", "patterns_unsupported", "patterns", f"A {spec['type']} chart has no series to tell apart, so patterns is ignored.")


def _describe_box(spec: Spec) -> str:
    g = _box_groups(spec, spec["data"])
    f = _formatter(spec)
    keys = list(g.keys())
    t = f"{_lead(spec, 'Box plot')} Distribution of {spec['y']}{f' for {len(keys)} groups ({_fmt_list(keys)})' if spec.get('x') else ''}."
    for k in keys[:6]:
        st = box_stats(g[k])
        if st:
            n = len(st["outliers"])
            t += (f" {clip(k, 30)}: median {f(st['median'])}, middle half {f(st['q1'])} to {f(st['q3'])}, range {f(st['min'])} to {f(st['max'])}"
                  f"{f', {n} outlier' + ('s' if n > 1 else '') if n else ''}.")
    return t


# ---------------------------------------------------------------------------------------- heatmap


def _describe_heatmap(spec: Spec) -> str:
    sums: dict[str, float] = {}
    rows = spec["data"]
    for r in rows:
        v = to_number(r.get(spec["value"]))
        if v is None:
            continue
        key = f"{or_empty(r.get(spec['x']))}\u0000{or_empty(r.get(spec['y']))}"
        sums[key] = sums.get(key, 0.0) + v
    cells = []
    for k, v in sums.items():
        parts = k.split("\u0000")
        cells.append({"x": parts[0], "y": parts[1] if len(parts) > 1 else "", "v": v})
    xs = distinct(or_empty(r.get(spec["x"])) for r in rows)
    ys = distinct(or_empty(r.get(spec["y"])) for r in rows)
    f = _formatter(spec)
    if not cells:
        return f"{_lead(spec, 'Heatmap')} No numeric cells."
    hi = _first_max(cells, lambda c: c["v"])
    lo = _first_min(cells, lambda c: c["v"])
    return (f"{_lead(spec, 'Heatmap')} {len(cells)} cells, {len(xs)} columns by {len(ys)} rows, coloured by {spec['value']}."
            f" Highest: {clip(hi['x'], 30)} / {clip(hi['y'], 30)} ({f(hi['v'])}). Lowest: {clip(lo['x'], 30)} / {clip(lo['y'], 30)} ({f(lo['v'])}).")


# ----------------------------------------------------------------------------------------- radar


def _radar_model(spec: Spec) -> tuple[list[str], list[str], dict[str, dict[str, float]]]:
    obs = observations(spec["data"], spec.get("x"), spec["y"], spec.get("series"))
    return distinct(key_string(o["x"]) for o in obs), distinct(o["s"] for o in obs), matrix(obs)


def _check_radar(spec: Spec, rows: list[dict], issues: Issues) -> None:
    axes = distinct(key_string(r.get(spec["x"])) for r in rows)
    if len(axes) < 3:
        _issue(issues, "error", "too_few_axes", "x", f'A radar chart needs at least 3 spokes; "{spec["x"]}" has {len(axes)} distinct value(s).', "Use a bar chart for fewer measures.")
    if len(axes) > MAX_AXES:
        _issue(issues, "error", "too_many_axes", "x", f'A radar chart can show at most {MAX_AXES} spokes; "{spec["x"]}" has {len(axes)}.', "Group measures, or use a heatmap or bar chart.")
    if detect_x_kind("auto", [r.get(spec["x"]) for r in rows]) == "time":
        _issue(issues, "warning", "prefer_line", "type", "Spokes look like dates: a line chart shows change over time better.")


def _describe_radar(spec: Spec) -> str:
    axes, keys, m = _radar_model(spec)
    f = _formatter(spec)
    t = f"{_lead(spec, 'Radar chart')} {len(axes)} spokes ({_fmt_list(axes, 6)}), {len(keys)} {_plural(len(keys), 'shape', 'shapes')} ({_fmt_list(keys)})."
    for k in keys[:3]:
        pairs = [{"a": a, "v": m.get(a, {}).get(k, 0.0)} for a in axes]
        hi = _first_max(pairs, lambda p: p["v"])
        lo = _first_min(pairs, lambda p: p["v"])
        t += f" {clip(k, 30)}: highest {clip(hi['a'], 30)} ({f(hi['v'])}), lowest {clip(lo['a'], 30)} ({f(lo['v'])})."
    return t


# --------------------------------------------------------------------------------------- treemap


def _tiles(spec: Spec) -> list[dict]:
    sums: dict[str, dict] = {}
    for r in spec["data"]:
        v = to_number(r.get(spec["value"]))
        if v is None or v <= 0:
            continue
        group = or_empty(r.get(spec["group"])) if spec.get("group") else ""
        label = or_empty(r.get(spec["label"]))
        k = f"{group}\u0000{label}"
        if k in sums:
            sums[k]["value"] += v
        else:
            sums[k] = {"label": label, "group": group, "value": v}
    return list(sums.values())


def _check_treemap(spec: Spec, rows: list[dict], issues: Issues) -> None:
    neg = sum(1 for r in rows if is_number(r.get(spec["value"])) and r[spec["value"]] <= 0)
    if neg:
        _issue(issues, "warning", "negative_slices", "value", f"{neg} zero or negative value(s) will be skipped; area cannot be negative.")
    if spec.get("group") and spec["group"] == spec["label"]:
        _issue(issues, "warning", "redundant_group", "group", "`group` is the same column as `label`.")
    if spec.get("focus"):
        if not spec.get("group"):
            _issue(issues, "warning", "focus_not_found", "focus", "focus needs `group`: without it the treemap has one level and nothing to drill into; the whole treemap is drawn.", "Set `group` to the column the tiles are grouped by, or remove focus.")
        else:
            _check_focus(_tile_tree(_tiles({**spec, "data": rows})), spec["focus"], issues)


def _tile_tree(ts: list[dict]) -> dict:
    """The tiles as a two-level tree (group > label), for `focus`. Mirrors `treeOf`."""
    root: dict = {"name": "", "path": [], "value": 0.0, "children": []}
    groups: dict[str, dict] = {}
    for t in ts:
        root["value"] += t["value"]
        g = groups.get(t["group"])
        if g is None:
            g = groups[t["group"]] = {"name": t["group"], "path": [t["group"]], "value": 0.0, "children": []}
            root["children"].append(g)
        g["value"] += t["value"]
        g["children"].append({"name": t["label"], "path": [t["group"], t["label"]], "value": t["value"], "children": []})
    return root


def _focus_node(root: dict, focus: Any) -> dict | None:
    """The node a `focus` path names: None without a path, or when it does not lead to a node with children."""
    if not isinstance(focus, list) or not focus:
        return None
    node = root
    for name in focus:
        node = next((c for c in node["children"] if c["name"] == js_string(name)), None)
        if node is None:
            return None
    return node if node["children"] else None


def _check_focus(root: dict, focus: list, issues: Issues) -> None:
    """A warning for a name that is not under its parent, or a path that ends on a leaf. Mirrors `checkFocus`."""
    node = root
    for i, raw in enumerate(focus):
        name = js_string(raw)
        nxt = next((c for c in node["children"] if c["name"] == name), None)
        if nxt is None:
            names = [c["name"] for c in node["children"]]
            near = closest(name, names)
            hint = f"{f'Did you mean {chr(34)}{near}{chr(34)}? ' if near else ''}The groups there: {', '.join(clip(n, 30) for n in names[:12])}." if names else None
            return _issue(issues, "warning", "focus_not_found", f"focus[{i}]", f'There is no group "{clip(name, 60)}" at that level; the whole tree is drawn.', hint)
        node = nxt
    if not node["children"]:
        _issue(issues, "warning", "focus_leaf", f"focus[{len(focus) - 1}]", f'"{clip(" > ".join(node["path"]), 80)}" has no groups under it, so there is nothing to drill into; the whole tree is drawn.', "Drop the last value to focus on its parent.")


def _describe_treemap(spec: Spec) -> str:
    ts = _tiles(spec)
    f = _formatter(spec)
    tot = total([t["value"] for t in ts])
    if not ts:
        return f"{_lead(spec, 'Treemap')} No positive values."
    groups = distinct(t["group"] for t in ts) if spec.get("group") else []
    t = f"{_lead(spec, 'Treemap')} {len(ts)} tiles totalling {f(tot)}{f' in {len(groups)} groups ({_fmt_list(groups)})' if groups else ''}."
    srt = sorted(ts, key=lambda x: x["value"], reverse=True)
    t += f" Largest: {clip(srt[0]['label'], 40)} ({format_percent(srt[0]['value'] / tot)})."
    if groups:
        gs = sorted(({"g": g, "v": total([x["value"] for x in ts if x["group"] == g])} for g in groups), key=lambda x: x["v"], reverse=True)
        t += f" Largest group: {clip(gs[0]['g'], 40)} ({format_percent(gs[0]['v'] / tot)})."
        fn = _focus_node(_tile_tree(ts), spec.get("focus"))
        if fn:
            kids = fn["children"]
            big = _stable_desc(kids, lambda c: c["value"])[0]
            t += (f" Showing only {clip(fn['name'], 40)}: {len(kids)} tile{'s' if len(kids) > 1 else ''} totalling {f(fn['value'])} ({format_percent(fn['value'] / tot)} of the total),"
                  f" largest {clip(big['name'], 40)} ({format_percent(big['value'] / fn['value'])}).")
    return t


# ---------------------------------------------------------------------------------------- sankey


def _links(spec: Spec) -> list[dict]:
    sums: dict[str, dict] = {}
    for r in spec["data"]:
        v = to_number(r.get(spec["value"]))
        if v is None or v <= 0:
            continue
        source, target = or_empty(r.get(spec["from"])), or_empty(r.get(spec["to"]))
        if source == target:
            continue
        k = f"{source}\u0000{target}"
        if k in sums:
            sums[k]["value"] += v
        else:
            sums[k] = {"source": source, "target": target, "value": v}
    return list(sums.values())


def _cycle_of(links: list[dict]) -> list[str] | None:
    """The names on a cycle, or None when the flows only go forward (iterative depth-first search)."""
    out: dict[str, list[str]] = {}
    for l in links:
        out.setdefault(l["source"], []).append(l["target"])
    state: dict[str, int] = {}
    for start in list(out):
        if start in state:
            continue
        path = [start]
        state[start] = 1
        stack = [iter(out.get(start, []))]
        while stack:
            nxt = next(stack[-1], None)
            if nxt is None:
                state[path.pop()] = 2
                stack.pop()
                continue
            if state.get(nxt) == 1:
                return path[path.index(nxt):] + [nxt]
            if nxt not in state:
                state[nxt] = 1
                path.append(nxt)
                stack.append(iter(out.get(nxt, [])))
    return None


def _check_sankey(spec: Spec, rows: list[dict], issues: Issues) -> None:
    flows = []
    for r in rows:
        v = r.get(spec["value"])
        if is_number(v) and not v > 0:
            continue
        s, t = or_empty(r.get(spec["from"])), or_empty(r.get(spec["to"]))
        if s != t:
            flows.append({"source": s, "target": t})
    nodes = {n for l in flows for n in (l["source"], l["target"])}
    if len(flows) != len(rows):
        _issue(issues, "warning", "flows_skipped", "value", "Flows with zero or negative value, or that start and end at the same node, are skipped.")
    if len(nodes) > MAX_NODES:
        _issue(issues, "error", "too_many_nodes", "from", f"A sankey diagram can show at most {MAX_NODES} nodes; this has {len(nodes)}.", 'Merge small nodes into "Other".')
    if len({f"{l['source']}\u0000{l['target']}" for l in flows}) > MAX_LINKS:
        _issue(issues, "error", "too_many_links", "data", f"A sankey diagram can show at most {MAX_LINKS} flows.")
    loop = _cycle_of(flows)
    if loop:
        _issue(issues, "error", "cyclic_flow", "to", f"Flows form a loop: {' → '.join(loop[:6])}.", "A sankey diagram needs flows that only go forward. Break the loop.")


def _describe_sankey(spec: Spec) -> str:
    ls = _links(spec)
    f = _formatter(spec)
    if not ls:
        return f"{_lead(spec, 'Sankey diagram')} No positive flows."
    nodes: dict[str, dict[str, float]] = {}
    for l in ls:
        nodes.setdefault(l["source"], {"in": 0.0, "out": 0.0})["out"] += l["value"]
        nodes.setdefault(l["target"], {"in": 0.0, "out": 0.0})["in"] += l["value"]
    sources = [k for k, n in nodes.items() if n["in"] == 0]
    sinks = [k for k, n in nodes.items() if n["out"] == 0]
    tot = total([l["value"] for l in ls if l["source"] in sources])
    big = _first_max(ls, lambda l: l["value"])
    t = f"{_lead(spec, 'Sankey diagram')} {len(nodes)} nodes, {len(ls)} flows; {f(tot)} enters from {_fmt_list(sources, 4)} and ends in {_fmt_list(sinks, 4)}."
    t += f" Largest flow: {clip(big['source'], 30)} to {clip(big['target'], 30)} ({f(big['value'])})."
    return t


# ------------------------------------------------------------------------------------------- maps
# Mirrors `packages/core/src/charts/maps.ts`. The descriptions read the data's own spelling of a region, so they
# need no geography; only the checks do.


def _blank(v: Any) -> bool:
    """`v === null || v === undefined || v === ''`."""
    return v is None or (isinstance(v, str) and v == "")


def _check_regions(spec: Spec, rows: list[dict], issues: Issues, geo: Geography | None, fields: list[str]) -> None:
    """Warn about data values that name no region; error when none match at all."""
    if geo is None:
        return
    names = [r["name"] for r in geo.regions]
    for name in fields:
        col = spec.get(name)
        if not col:
            continue
        seen: dict[str, str] = {}
        for r in rows:
            v = r.get(col)
            if _blank(v):
                continue
            seen.setdefault(normalize_region(v), js_trim(js_string(v)))
        unmatched = [raw for k, raw in seen.items() if k not in geo.lookup]
        if not unmatched:
            continue
        where = f'geography "{spec["geo"]}"' if isinstance(spec.get("geo"), str) else "the inline geography"
        if len(unmatched) == len(seen):
            _issue(issues, "error", "no_regions_matched", name, f'None of the {len(seen)} values in "{col}" match a region of {where}.',
                   f"Regions are matched by key, name or alias (case ignored). Some keys: {_fmt_list([r['key'] for r in geo.regions[:8]], 8)}.")
            continue
        near = [(u, m) for u, m in ((u, closest(u, names)) for u in unmatched[:5]) if m]
        hint = (f"Did you mean {', '.join(f'{chr(34)}{m}{chr(34)} for {chr(34)}{clip(u, 40)}{chr(34)}' for u, m in near)}? Or add aliases when registering the geography."
                if near else "Add aliases when registering the geography, or fix the names in the data.")
        _issue(issues, "warning", "unmatched_regions", name,
               f'{len(unmatched)} of {len(seen)} values in "{col}" match no region of {where} and are left out: {_fmt_list([clip(u, 40) for u in unmatched], 8)}.', hint)


def _check_places(spec: Spec, issues: Issues, lat: str, lng: str, region: str | None) -> bool:
    if spec.get(lat) and not spec.get(lng):
        _issue(issues, "error", "missing_required", lng, f'"{lat}" is set, so "{lng}" is needed too.')
        return False
    if spec.get(lng) and not spec.get(lat):
        _issue(issues, "error", "missing_required", lat, f'"{lng}" is set, so "{lat}" is needed too.')
        return False
    if spec.get(lat) and spec.get(lng):
        return True
    if region and spec.get(region):
        if "geo" not in spec:
            _issue(issues, "error", "missing_required", "geo", f'"{region}" places rows at regions, which needs a geography.', "Set geo to a registered geography, or give lat and lng columns instead.")
            return False
        return True
    _issue(issues, "error", "missing_required", lat, f'Give "{lat}" and "{lng}" columns{f", or {chr(34)}{region}{chr(34)} with a geography" if region else ""}.', "Longitude and latitude in degrees (WGS 84).")
    return False


def _has_error(issues: Issues) -> bool:
    return any(i["severity"] == "error" for i in issues)


def _on_map(spec: Spec, r: dict, lat: str, lng: str, region: str) -> bool:
    """A row has a usable place: valid latitude and longitude, or (without them) a region value."""
    if spec.get(lat) and spec.get(lng):
        la, lo = to_number(r.get(spec[lat])), to_number(r.get(spec[lng]))
        return la is not None and lo is not None and abs(la) <= 90 and abs(lo) <= 180
    return bool(spec.get(region)) and not _blank(r.get(spec[region]))


def _raw_values(spec: Spec, rows: list[dict]) -> list[dict]:
    """Region values grouped by the data's own spelling (`rawValues`)."""
    sums: dict[str, dict] = {}
    for r in rows:
        v = to_number(r.get(spec["value"]))
        raw = r.get(spec["region"])
        if v is None or _blank(raw):
            continue
        key = js_trim(js_string(raw))
        if key in sums:
            sums[key]["value"] += v
        else:
            sums[key] = {"label": key, "value": v}
    return list(sums.values())


def _check_choropleth(spec: Spec, rows: list[dict], issues: Issues, geo: Geography | None) -> None:
    _check_regions(spec, rows, issues, geo, ["region"])
    if not _has_error(issues) and not _raw_values(spec, rows):
        _issue(issues, "error", "no_values", "value", "No row has both a region and a numeric value.")


def _describe_choropleth(spec: Spec) -> str:
    vals = _raw_values(spec, spec["data"])
    f = _formatter(spec)
    on = f' of "{clip(spec["geo"], 64)}"' if isinstance(spec.get("geo"), str) else ""
    if not vals:
        return f"{_lead(spec, 'Choropleth map')} No values."
    hi = _first_max(vals, lambda x: x["value"])
    lo = _first_min(vals, lambda x: x["value"])
    return (f"{_lead(spec, 'Choropleth map')} {len(vals)} regions{on} coloured by {spec['value']}{' and raised by it' if spec.get('extrude') else ''}."
            f" Highest: {clip(hi['label'], 40)} ({f(hi['value'])}). Lowest: {clip(lo['label'], 40)} ({f(lo['value'])}).")


def _place_name(spec: Spec, r: dict) -> str:
    if spec.get("label"):
        return or_empty(r.get(spec["label"]))
    return js_trim(or_empty(r.get(spec["region"]))) if spec.get("region") else ""


def _raw_places(spec: Spec, rows: list[dict]) -> list[dict]:
    """Places for the description and the checks: no geography needed (`rawPlaces`)."""
    out = []
    for r in rows:
        if not _on_map(spec, r, "lat", "lng", "region"):
            continue
        size = to_number(r.get(spec["size"])) if spec.get("size") else None
        if spec.get("size") and (size is None or size < 0):
            continue
        out.append({"name": _place_name(spec, r), "size": size, "s": or_empty(r.get(spec["series"])) if spec.get("series") else ""})
    return out


def _check_bubble_map(spec: Spec, rows: list[dict], issues: Issues, geo: Geography | None) -> None:
    if not _check_places(spec, issues, "lat", "lng", "region"):
        return
    if not spec.get("lat"):
        _check_regions(spec, rows, issues, geo, ["region"])
    if not _has_error(issues) and not _raw_places(spec, rows):
        _issue(issues, "error", "no_points", "data", "No row has a usable place (and size, when set).")


def _describe_bubble_map(spec: Spec) -> str:
    ps = _raw_places(spec, spec["data"])
    f = _formatter(spec)
    groups = distinct(p["s"] for p in ps) if spec.get("series") else []
    t = (f"{_lead(spec, 'Bubble map')} {len(ps)} places{' sized by ' + str(spec['size']) if spec.get('size') else ''}"
         f"{f', in {len(groups)} groups ({_fmt_list(groups)})' if len(groups) > 1 else ''}.")
    sized = [p for p in ps if p["size"] is not None]
    if sized:
        big = _first_max(sized, lambda p: p["size"])
        t += f" Largest: {clip(big['name'] or 'unnamed', 40)} ({f(big['size'])})."
    return t


def _check_column_map(spec: Spec, rows: list[dict], issues: Issues, geo: Geography | None) -> None:
    if not _check_places(spec, issues, "lat", "lng", "region"):
        return
    if not spec.get("lat"):
        _check_regions(spec, rows, issues, geo, ["region"])
    neg = 0
    for r in rows:
        v = to_number(r.get(spec["value"]))
        if v is not None and v < 0:
            neg += 1
    if neg:
        _issue(issues, "warning", "negative_skipped", "value", f"{neg} negative values are skipped: a column cannot be lower than the ground.", 'Use a choropleth with scale "diverging" for values above and below zero.')


def _describe_column_map(spec: Spec) -> str:
    f = _formatter(spec)
    cols = []
    for r in spec["data"]:
        v = to_number(r.get(spec["value"]))
        if v is None or v < 0 or not _on_map(spec, r, "lat", "lng", "region"):
            continue
        cols.append({"name": _place_name(spec, r), "v": v, "s": or_empty(r.get(spec["series"])) if spec.get("series") else ""})
    if not cols:
        return f"{_lead(spec, '3D column map')} No values."
    top = _first_max(cols, lambda x: x["v"])
    tot = total([x["v"] for x in cols])
    groups = distinct(x["s"] for x in cols) if spec.get("series") else []
    return (f"{_lead(spec, '3D column map')} {len(cols)} columns of {spec['value']} on a {'tilted map' if spec.get('view') == 'flat' else 'globe'}"
            f"{f', in {len(groups)} groups ({_fmt_list(groups)})' if len(groups) > 1 else ''}, totalling {f(tot)}."
            f" Tallest: {clip(top['name'] or 'unnamed', 40)} ({f(top['v'])}).")


_FLOW_LL = ["fromLat", "fromLng", "toLat", "toLng"]


def _raw_flows(spec: Spec, rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        if not _on_map(spec, r, "fromLat", "fromLng", "from") or not _on_map(spec, r, "toLat", "toLng", "to"):
            continue
        v = to_number(r.get(spec["value"])) if spec.get("value") else None
        if spec.get("value") and (v is None or v < 0):
            continue
        out.append({"from": js_trim(or_empty(r.get(spec["from"]))) if spec.get("from") else "", "to": js_trim(or_empty(r.get(spec["to"]))) if spec.get("to") else "",
                    "v": v, "s": or_empty(r.get(spec["series"])) if spec.get("series") else ""})
    return out


def _check_flow_map(spec: Spec, rows: list[dict], issues: Issues, geo: Geography | None) -> None:
    given = [k for k in _FLOW_LL if spec.get(k)]
    if given and len(given) < 4:
        _issue(issues, "error", "missing_required", next(k for k in _FLOW_LL if not spec.get(k)), "Give all four of fromLat, fromLng, toLat and toLng, or none of them.")
        return
    if not given:
        if not spec.get("from") or not spec.get("to"):
            _issue(issues, "error", "missing_required", "to" if spec.get("from") else "from", "Give from and to region columns (with geo), or fromLat/fromLng/toLat/toLng columns.")
            return
        if "geo" not in spec:
            _issue(issues, "error", "missing_required", "geo", "from and to name regions, which needs a geography.", "Set geo to a registered geography, or give fromLat/fromLng/toLat/toLng columns.")
            return
        _check_regions(spec, rows, issues, geo, ["from", "to"])
    if not _has_error(issues) and not _raw_flows(spec, rows):
        _issue(issues, "error", "no_points", "data", "No row has a usable origin and destination (and value, when set).")


def _describe_flow_map(spec: Spec) -> str:
    fs = _raw_flows(spec, spec["data"])
    f = _formatter(spec)
    t = f"{_lead(spec, 'Flow map')} {len(fs)} flows{' weighted by ' + str(spec['value']) if spec.get('value') else ''}."
    weighted = [x for x in fs if x["v"] is not None]
    if weighted:
        big = _first_max(weighted, lambda x: x["v"])
        t += f" Total {f(total([x['v'] for x in weighted]))}. Largest: {clip(big['from'] or 'origin', 30)} to {clip(big['to'] or 'destination', 30)} ({f(big['v'])})."
    return t


# ---------------------------------------------------------------------------------------- violin


def _check_violin(spec: Spec, rows: list[dict], issues: Issues) -> None:
    _check_points(spec, rows, issues)
    if spec.get("bandwidth") == 0 and "bandwidth" in spec:
        _issue(issues, "error", "out_of_range", "bandwidth", "bandwidth must be above 0.", "Leave it out for Silverman's rule, or give a positive width in the units of y.")
    few = [k for k, v in _box_groups(spec, rows).items() if len(v) < 5]
    if few:
        _issue(issues, "warning", "few_values", "y", f"{len(few)} group(s) have fewer than 5 values ({_fmt_list([clip(k, 30) for k in few], 3)}); their violin shape is mostly smoothing.", 'Use a box plot or points: "all" for small groups.')


def _describe_violin(spec: Spec) -> str:
    g = _box_groups(spec, spec["data"])
    f = _formatter(spec)
    keys = list(g.keys())
    bw = spec.get("bandwidth")
    silverman_note = " (bandwidth by Silverman's rule)"
    t = (f"{_lead(spec, 'Violin plot')} Distribution of {spec['y']}{f' for {len(keys)} groups ({_fmt_list(keys)})' if spec.get('x') else ''}, as a Gaussian kernel density"
         f"{f' with bandwidth {f(bw)}' if bw else silverman_note}.")
    for k in keys[:6]:
        st = box_stats(g[k])
        d = kde(g[k], bw)
        if not st or not d:
            continue
        pk = density_peaks(d)
        peaks = f"{len(pk)} peaks, near {_fmt_list([f(x) for x in pk], 4)}" if len(pk) > 1 else f"densest near {f(pk[0])}"
        t += f" {clip(k, 30)}: median {f(st['median'])}, middle half {f(st['q1'])} to {f(st['q3'])}, range {f(st['min'])} to {f(st['max'])}, {peaks}."
    return t


# -------------------------------------------------------------------------------------- calendar


def _year_of(day: int) -> int:
    return _civil_from_days(day)[0]


def _calendar_days(rows: list[dict], x: str, value: str) -> dict[int, float]:
    """Sum of `value` per UTC calendar day (epoch day number). Mirrors `calendarDays`."""
    out: dict[int, float] = {}
    for r in rows:
        t = to_time(r.get(x))
        v = to_number(r.get(value))
        if t is None or v is None:
            continue
        d = int(t // _DAY)
        out[d] = out.get(d, 0.0) + v
    return out


def _calendar_years(days: dict[int, float]) -> tuple[list[int], list[int]]:
    every = sorted({_year_of(d) for d in days})
    return every, every[-MAX_CALENDAR_YEARS:]


def _check_calendar(spec: Spec, rows: list[dict], issues: Issues) -> None:
    x = spec["x"]
    seen = bad = 0
    for r in rows:
        v = r.get(x)
        if _blank(v):
            continue
        seen += 1
        if to_time(v) is None:
            bad += 1
    if seen and bad == seen:
        _issue(issues, "error", "not_time", "x", f'Column "{x}" has no dates.', 'Use ISO dates such as "2026-03-14" or epoch milliseconds.')
    elif bad:
        _issue(issues, "warning", "some_not_time", "x", f'{bad} of {seen} values in "{x}" are not dates and will be skipped.')
    days = _calendar_days(rows, x, spec["value"])
    if seen and bad < seen and not days:
        _issue(issues, "error", "no_values", "value", "No row has both a date and a numeric value.")
    every, shown = _calendar_years(days)
    if len(every) > MAX_CALENDAR_YEARS:
        _issue(issues, "warning", "too_many_years", "x", f"The data spans {len(every)} years; only the last {MAX_CALENDAR_YEARS} ({shown[0]} to {shown[-1]}) are drawn.", "Filter with `transform`, or aggregate to weeks or months and use a line or bar chart.")
    if spec.get("patterns") is True:
        _issue(issues, "warning", "patterns_unsupported", "patterns", "A calendar has one colour scale and no series, so patterns is ignored.")


def _describe_calendar(spec: Spec) -> str:
    f = _formatter(spec)
    days = _calendar_days(spec["data"], spec["x"], spec["value"])
    every, shown = _calendar_years(days)
    kept = sorted(((d, v) for d, v in days.items() if _year_of(d) in shown), key=lambda dv: dv[0])
    if not kept:
        return f"{_lead(spec, 'Calendar heatmap')} No days with data."

    def date(d: int) -> str:
        return format_date(d * _DAY)

    first, last = kept[0][0], kept[-1][0]
    span = last - first + 1
    hi = _first_max(kept, lambda dv: dv[1])
    lo = _first_min(kept, lambda dv: dv[1])
    t = f"{_lead(spec, 'Calendar heatmap')} {len(kept)} days with data from {date(first)} to {date(last)}, coloured by {spec['value']}, totalling {f(total([v for _, v in kept]))}."
    if span > len(kept):
        t += f" {span - len(kept)} days in that span have no data."
    t += f" Highest: {date(hi[0])} ({f(hi[1])}). Lowest: {date(lo[0])} ({f(lo[1])})."
    sums = [0.0] * 7
    counts = [0] * 7
    for d, v in kept:
        w = (d + 4) % 7  # 1970-01-01 was a Thursday
        sums[w] += v
        counts[w] += 1
    ranked = _stable_desc([(sums[i] / counts[i], i) for i in range(7) if counts[i]], lambda a: a[0])
    if len(ranked) > 1:
        t += f" On average {_WEEKDAYS[ranked[0][1]]} is highest ({f(ranked[0][0])}) and {_WEEKDAYS[ranked[-1][1]]} lowest ({f(ranked[-1][0])})."
    if len(every) > len(shown):
        t += f" Only the last {len(shown)} of {len(every)} years are drawn."
    return t


# -------------------------------------------------------------------------------------- sunburst


def _list_of(v: Any) -> list[str]:
    return v if isinstance(v, list) else [v]


def hierarchy(rows: list[dict], levels: list[str], value: str) -> dict:
    """Sum `value` over a hierarchy given by `levels` (outermost first). Mirrors `hierarchy` in sunburst.ts:
    a row stops at its first empty level; children are ordered largest first, the smallest past 30 merged into
    "Other". Returns the root node {"name", "path", "value", "children"}."""
    root: dict = {"name": "", "path": [], "value": 0.0, "children": [], "index": {}}
    for r in rows:
        v = to_number(r.get(value))
        if v is None or v <= 0:
            continue
        root["value"] += v
        node = root
        for col in levels:
            raw = r.get(col)
            if _blank(raw):
                break
            name = js_string(raw)
            child = node["index"].get(name)
            if child is None:
                child = {"name": name, "path": [*node["path"], name], "value": 0.0, "children": [], "index": {}}
                node["index"][name] = child
                node["children"].append(child)
            child["value"] += v
            node = child

    def tidy(n: dict) -> None:
        n["children"] = _stable_desc(n["children"], lambda c: c["value"])
        if len(n["children"]) > MAX_CHILDREN:
            rest = n["children"][MAX_CHILDREN - 1:]
            del n["children"][MAX_CHILDREN - 1:]
            n["children"].append({"name": "Other", "path": [*n["path"], "Other"], "value": total([c["value"] for c in rest]), "children": [], "index": {}})
        for c in n["children"]:
            tidy(c)

    tidy(root)
    return root


def _check_sunburst(spec: Spec, rows: list[dict], issues: Issues) -> None:
    levels = _list_of(spec["path"])
    seen: set[str] = set()
    for i, l in enumerate(levels):
        if l in seen:
            _issue(issues, "error", "duplicate_column", f"path[{i}]", f'"{l}" appears twice in path.', "Each level of the hierarchy needs its own column.")
        seen.add(l)
    if spec["value"] in levels:
        _issue(issues, "warning", "value_in_path", "value", f'"{spec["value"]}" is both a level and the value.')
    neg = 0
    for r in rows:
        v = to_number(r.get(spec["value"]))
        if v is not None and v <= 0:
            neg += 1
    if neg:
        _issue(issues, "warning", "negative_slices", "value", f"{neg} zero or negative value(s) will be skipped; a share cannot be negative.")
    focus = spec.get("focus")
    if focus:
        if len(focus) >= len(levels):
            _issue(issues, "warning", "focus_leaf", f"focus[{len(focus) - 1}]", f"focus names {len(focus)} level(s) and path has {len(levels)}: the last level has nothing under it to drill into; the whole tree is drawn.", f"Give at most {len(levels) - 1} value(s).")
        else:
            _check_focus(hierarchy(rows, levels, spec["value"]), focus, issues)


def _describe_sunburst(spec: Spec) -> str:
    levels = _list_of(spec["path"])
    root = hierarchy(spec["data"], levels, spec["value"])
    f = _formatter(spec)

    def pct(v: float) -> str:
        return format_percent(v / root["value"] if root["value"] else 0)

    if not root["children"]:
        return f"{_lead(spec, 'Sunburst')} No positive values."
    leaves = 0
    biggest: dict | None = None
    stack = list(reversed(root["children"]))
    while stack:  # depth first, in the order the reference walks
        n = stack.pop()
        if not n["children"]:
            leaves += 1
            if biggest is None or n["value"] > biggest["value"]:
                biggest = n
        stack.extend(reversed(n["children"]))
    top = [f"{clip(n['name'], 30)} ({pct(n['value'])})" for n in root["children"][:3]]
    t = (f"{_lead(spec, 'Sunburst')} {len(levels)} level{'s' if len(levels) > 1 else ''} ({' > '.join(levels)}), {leaves} leaves totalling {f(root['value'])}."
         f" First level: {len(root['children'])} groups, largest {_fmt_list(top, 3)}.")
    if biggest is not None and len(biggest["path"]) > 1:
        t += f" Largest leaf: {clip(' > '.join(biggest['path']), 80)} ({f(biggest['value'])}, {pct(biggest['value'])})."
    fn = _focus_node(root, spec.get("focus"))
    if fn:
        kids = [f"{clip(n['name'], 30)} ({format_percent(n['value'] / fn['value'] if fn['value'] else 0)})" for n in fn["children"][:3]]
        t += (f" Showing only {clip(' > '.join(fn['path']), 80)}: {f(fn['value'])}, {pct(fn['value'])} of the total,"
              f" in {len(fn['children'])} group{'s' if len(fn['children']) > 1 else ''}, largest {_fmt_list(kids, 3)}.")
    return t


# -------------------------------------------------------------------------------------- parallel


def _complete(rows: list[dict], dims: list[str]) -> list[tuple[dict, list[float]]]:
    """Rows with a number in every dimension, each with its values in dimension order."""
    out = []
    for r in rows:
        values = []
        for d in dims:
            v = to_number(r.get(d))
            if v is None:
                break
            values.append(v)
        if len(values) == len(dims):
            out.append((r, values))
    return out


def _sample(n: int) -> tuple[int, int]:
    """(lines drawn, step): every row up to MAX_LINES, else every k-th. Mirrors `sampleRows`."""
    if n <= MAX_LINES:
        return n, 1
    step = -(-n // MAX_LINES)
    return -(-n // step), step


def _check_parallel(spec: Spec, rows: list[dict], issues: Issues) -> None:
    dims = _list_of(spec["dimensions"])
    seen: set[str] = set()
    for i, d in enumerate(dims):
        if d in seen:
            _issue(issues, "error", "duplicate_column", f"dimensions[{i}]", f'"{d}" appears twice in dimensions.', "Each axis needs its own column.")
        seen.add(d)
    every = _complete(rows, dims)
    skipped = len(rows) - len(every)
    if not every:
        _issue(issues, "error", "no_values", "dimensions", "No row has a number in every dimension.", "Fill or filter out rows with missing values.")
    elif skipped:
        _issue(issues, "warning", "incomplete_rows", "dimensions", f"{skipped} row(s) lack a number in some dimension and are not drawn.")
    drawn, step = _sample(len(every))
    if step > 1:
        _issue(issues, "warning", "lines_sampled", "data", f"One row in every {step} is drawn ({drawn} lines). The axes still span every row.", "Filter or aggregate with `transform`.")
    if spec.get("patterns") is True:
        _issue(issues, "warning", "patterns_unsupported", "patterns", "Parallel coordinates draw lines, which have no fill to texture; patterns is ignored.")


def _describe_parallel(spec: Spec) -> str:
    dims = _list_of(spec["dimensions"])
    every = _complete(spec["data"], dims)
    f = _formatter(spec)
    if not every:
        return f"{_lead(spec, 'Parallel coordinates')} No complete rows."
    groups = distinct(key_string(r.get(spec["series"])) for r, _ in every) if isinstance(spec.get("series"), str) else []
    by = spec.get("series")
    t = (f"{_lead(spec, 'Parallel coordinates')} {len(every)} rows across {len(dims)} measures ({_fmt_list(dims, 6)})"
         f"{f', in {len(groups)} groups by {by} ({_fmt_list(groups)})' if groups else ''}.")
    ranges = []
    for i, d in enumerate(dims[:6]):
        v = [vals[i] for _, vals in every]
        ranges.append(f"{clip(d, 30)} {f(min(v))} to {f(max(v))}")
    t += f" Ranges: {'; '.join(ranges)}."
    best: tuple[str, str, float] | None = None
    for i in range(len(dims) - 1):
        r = correlation([vals[i] for _, vals in every], [vals[i + 1] for _, vals in every])
        if r is not None and (best is None or abs(r) > abs(best[2])):
            best = (dims[i], dims[i + 1], r)
    if best:
        t += f" Strongest link between neighbouring axes: {clip(best[0], 30)} and {clip(best[1], 30)} (r = {to_fixed(best[2], 2)})."
    drawn, step = _sample(len(every))
    if step > 1:
        t += f" One row in every {step} is drawn ({drawn} lines)."
    return t


# ------------------------------------------------------------------------------------- waterfall

_YES = {"true", "yes", "1", "total", "subtotal"}


def is_yes(v: Any) -> bool:
    """A yes/no cell of a `flag` column: true, 1, or "true", "yes", "1", "total", "subtotal" (any case, trimmed)."""
    if isinstance(v, bool):
        return v
    if is_number(v):
        return v == 1
    return isinstance(v, str) and js_trim(v).lower() in _YES


def flagged(flag: Any, r: dict, key_column: str | None) -> bool:
    """Is this row marked by a `flag` field? A column name reads the row's yes/no cell; a list matches the row's
    value in `key_column` (as a string). Mirrors `flagged` in schema.ts."""
    if isinstance(flag, str):
        return is_yes(r.get(flag))
    if isinstance(flag, list) and key_column is not None:
        v = r.get(key_column)
        return v is not None and js_string(v) in flag
    return False


def _waterfall_model(spec: Spec, rows: list[dict]) -> dict:
    """Steps in data order (duplicate labels summed). Mirrors `waterfallModel`."""
    sums: dict[str, float | None] = {}
    is_total: set[str] = set()
    duplicates = 0
    for r in rows:
        k = key_string(r.get(spec["x"]))
        v = to_number(r.get(spec["y"]))
        if k not in sums:
            sums[k] = v
        else:
            duplicates += 1
            prev = sums[k]
            sums[k] = prev if v is None else (prev or 0.0) + v
        if flagged(spec.get("total"), r, spec["x"]):
            is_total.add(k)
    start = float(spec["start"]) if is_number(spec.get("start")) else 0.0
    running = start
    steps: list[dict] = []
    mismatches: list[str] = []
    for i, (key, v) in enumerate(sums.items()):
        if key in is_total:
            value = running if v is None else v
            checked = i > 0 or "start" in spec
            if v is not None and checked and abs(v - running) > 1e-9 * max(1, abs(running)):
                mismatches.append(key)
            steps.append({"key": key, "kind": "total", "change": 0.0, "running": value})
            running = value
            continue
        if v is None:
            continue
        steps.append({"key": key, "kind": "increase" if v >= 0 else "decrease", "change": v, "running": running + v})
        running += v
    return {"steps": steps, "start": start, "end": running, "mismatches": mismatches, "duplicates": duplicates}


def _check_waterfall(spec: Spec, rows: list[dict], issues: Issues) -> None:
    keys = distinct(key_string(r.get(spec["x"])) for r in rows)
    tot = spec.get("total")
    if isinstance(tot, list):
        for i, t in enumerate(tot):
            if t in keys:
                continue
            near = closest(t, keys)
            _issue(issues, "warning", "no_such_step", f"total[{i}]", f'No step is labelled "{clip(t, 60)}"; it was ignored.', f'Did you mean "{near}"?' if near else None)
    elif isinstance(tot, str) and not any(flagged(tot, r, None) for r in rows):
        _issue(issues, "warning", "no_totals", "total", f'No row of "{tot}" says yes, so no step is drawn as a total.', 'Use true, 1, "yes" or "total" for the total rows.')
    m = _waterfall_model(spec, rows)
    if m["duplicates"]:
        _issue(issues, "warning", "duplicate_steps", "x", f"{m['duplicates']} row(s) repeat a step label; their changes were summed into one bar.")
    if m["mismatches"]:
        _issue(issues, "warning", "total_mismatch", "total", "The value given for a total differs from the sum of the steps before it; the given value is drawn.", "Leave y empty on a total row to draw the computed running total.")
    if not m["steps"]:
        _issue(issues, "error", "empty_data", "y", "No step has a numeric change and no row is a total.", "Give each step a signed number in y.")


def _describe_waterfall(spec: Spec) -> str:
    m = _waterfall_model(spec, spec["data"])
    steps, end = m["steps"], m["end"]
    f = _formatter(spec)

    def sg(v: float) -> str:
        return f"+{f(v)}" if v > 0 else f(v)

    changes = [s for s in steps if s["kind"] != "total"]
    totals = [s for s in steps if s["kind"] == "total"]
    opening = steps[0]["running"] if steps and steps[0]["kind"] == "total" else m["start"]
    total_word = _plural(len(totals), "total", "totals")
    t = (f"{_lead(spec, 'Waterfall chart')} {len(changes)} {_plural(len(changes), 'change', 'changes')}"
         f"{f' and {len(totals)} {total_word}' if totals else ''}, from {f(opening)} to {f(end)} (net {sg(end - opening)}).")
    ups = [s for s in changes if s["change"] > 0]
    downs = [s for s in changes if s["change"] < 0]
    if ups:
        u = _first_max(ups, lambda s: s["change"])
        t += f" Largest increase: {clip(u['key'], 40)} ({sg(u['change'])})."
    if downs:
        d = _first_min(downs, lambda s: s["change"])
        t += f" Largest decrease: {clip(d['key'], 40)} ({sg(d['change'])})."
    if totals:
        listed = ", ".join(f"{clip(s['key'], 30)} {f(s['running'])}" for s in totals[:5])
        t += f" Totals: {listed}{f' and {len(totals) - 5} more' if len(totals) > 5 else ''}."
    return t


# ---------------------------------------------------------------------------------------- funnel


def _funnel_stages(spec: Spec, rows: list[dict]) -> tuple[list[dict], int, int]:
    """Stages in data order, duplicates summed; rows without a number and negative values are left out."""
    sums: dict[str, float] = {}
    negative = duplicates = 0
    for r in rows:
        v = to_number(r.get(spec["value"]))
        if v is None:
            continue
        if v < 0:
            negative += 1
            continue
        k = key_string(r.get(spec["stage"]))
        if k in sums:
            duplicates += 1
        sums[k] = sums.get(k, 0.0) + v
    order = list(sums)
    first = sums[order[0]] if order else 0.0
    stages = []
    for i, key in enumerate(order):
        value = sums[key]
        prev = sums[order[i - 1]] if i else 0.0
        stages.append({"key": key, "value": value, "ofFirst": value / first if first > 0 else None, "ofPrevious": value / prev if i and prev > 0 else None})
    return stages, negative, duplicates


def _check_funnel(spec: Spec, rows: list[dict], issues: Issues) -> None:
    stages, negative, duplicates = _funnel_stages(spec, rows)
    if len(stages) > MAX_STAGES:
        _issue(issues, "error", "too_many_stages", "stage", f"{len(stages)} stages; a funnel takes at most {MAX_STAGES}.", "Group stages, or use a bar chart.")
    if not stages:
        _issue(issues, "error", "empty_data", "value", "No stage has a value of 0 or more.")
    if negative:
        _issue(issues, "warning", "negative_values", "value", f"{negative} negative value(s) were skipped; a funnel cannot show them.")
    if duplicates:
        _issue(issues, "warning", "duplicate_stages", "stage", f"{duplicates} row(s) repeat a stage name; their values were summed.")
    if any(i > 0 and st["value"] > stages[i - 1]["value"] for i, st in enumerate(stages)):
        _issue(issues, "warning", "funnel_increases", "value", "A stage is larger than the one before it; a funnel reads as narrowing, so it misleads here. Drawn anyway.", "Check the stage order, or use a bar chart for stages that are not subsets of each other.")


def _describe_funnel(spec: Spec) -> str:
    stages, _, _ = _funnel_stages(spec, spec["data"])
    f = _formatter(spec)
    if not stages:
        return f"{_lead(spec, 'Funnel chart')} No stages."
    first, last = stages[0], stages[-1]
    if len(stages) == 1:
        return f"{_lead(spec, 'Funnel chart')} 1 stage: {clip(first['key'], 40)}, {f(first['value'])}."
    t = (f"{_lead(spec, 'Funnel chart')} {len(stages)} stages ({_fmt_list([clip(st['key'], 30) for st in stages])}),"
         f" from {f(first['value'])} at {clip(first['key'], 40)} to {f(last['value'])} at {clip(last['key'], 40)}")
    t += "; the first stage is 0, so there are no shares of it." if last["ofFirst"] is None else f": {format_percent(last['ofFirst'])} of the first stage reach the last."
    worst = None
    worst_i = 0
    for i, st in enumerate(stages):
        if i and st["ofPrevious"] is not None and (worst is None or st["ofPrevious"] < worst["ofPrevious"]):
            worst, worst_i = st, i
    if worst is not None and worst["ofPrevious"] < 1:
        t += f" Largest drop: {clip(stages[worst_i - 1]['key'], 40)} to {clip(worst['key'], 40)}, {format_percent(worst['ofPrevious'])} continue."
    if any(i and st["value"] > stages[i - 1]["value"] for i, st in enumerate(stages)):
        t += " The value rises between some stages."
    return t


# ---------------------------------------------------------------------------------------- bullet


def _cols(v: Any) -> list[str]:
    return v if isinstance(v, list) else [v] if isinstance(v, str) else []


def _bullet_rows(spec: Spec, rows: list[dict]) -> tuple[list[dict], int, list[str]]:
    """One row per measure (the first row of a repeated name wins). Mirrors `bulletRows`."""
    seen: set[str] = set()
    out: list[dict] = []
    unordered: list[str] = []
    duplicates = 0
    names = _cols(spec.get("ranges"))
    for r in rows:
        key = key_string(r.get(spec["x"]))
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        given = [(n, v) for n, v in ((n, to_number(r.get(n))) for n in names) if v is not None]
        if any(i and g[1] < given[i - 1][1] for i, g in enumerate(given)):
            unordered.append(key)
        out.append({"key": key, "value": to_number(r.get(spec["value"])), "target": to_number(r.get(spec["target"])) if spec.get("target") else None,
                    "ranges": sorted(given, key=lambda g: g[1])})
    return out, duplicates, unordered


def _check_bullet(spec: Spec, rows: list[dict], issues: Issues) -> None:
    if not spec.get("target") and not spec.get("ranges"):
        _issue(issues, "warning", "prefer_bar", "type", "Without a target or ranges a bullet chart is a bar chart.", 'Add `target` and `ranges`, or use `type: "bar"`.')
    _, duplicates, unordered = _bullet_rows(spec, rows)
    if duplicates:
        _issue(issues, "warning", "duplicate_measures", "x", f"{duplicates} row(s) repeat a measure name; only the first row of each is drawn.")
    if unordered:
        _issue(issues, "warning", "ranges_not_increasing", "ranges", "Some thresholds do not increase in column order; they were sorted.", "List range columns worst first, each threshold higher than the one before.")


def _describe_bullet(spec: Spec) -> str:
    rows, _, _ = _bullet_rows(spec, spec["data"])
    f = _formatter(spec)
    names = _cols(spec.get("ranges"))
    t = (f"{_lead(spec, 'Bullet chart')} {len(rows)} {_plural(len(rows), 'measure', 'measures')} ({_fmt_list([clip(r['key'], 30) for r in rows])})"
         f"{' against targets' if spec.get('target') else ''}{f', with ranges {_fmt_list(names)}' if names else ''}{', each on its own scale' if spec.get('scale') == 'each' else ''}.")
    for r in rows[:6]:
        if r["value"] is None:
            t += f" {clip(r['key'], 30)}: no value."
            continue
        t += f" {clip(r['key'], 30)}: {f(r['value'])}"
        if r["target"] is not None:
            share = f" ({format_percent(r['value'] / r['target'])} of target)" if r["target"] != 0 else ""
            t += f" against {f(r['target'])}{share}"
        if r["ranges"]:
            g = next((n for n, limit in r["ranges"] if r["value"] <= limit), None)
            t += f", in {g}" if g else ", above every range"
        t += "."
    if len(rows) > 6:
        t += f" And {len(rows) - 6} more."
    return t


# ------------------------------------------------------------------------------------------ bump


def _bump_model(spec: Spec, rows: list[dict]) -> dict:
    """Ranks per x, from a `rank` column or by ranking `y` among the series present at that x. Mirrors `bumpModel`."""
    kind = detect_x_kind("auto", [r.get(spec["x"]) for r in rows])
    xs = distinct(key_string(v) for v in (r.get(spec["x"]) for r in rows) if not _blank(v))
    if kind != "category":
        def num(k: str) -> float:
            n = to_time(k) if kind == "time" else to_number(k)
            return 0.0 if n is None else n
        xs = sorted(xs, key=num)
    ranks: dict[str, dict[str, float]] = {}
    duplicates = bad_ranks = 0
    if spec.get("rank"):
        every = distinct(key_string(r.get(spec.get("series"))) for r in rows)
        for r in rows:
            x = r.get(spec["x"])
            if _blank(x):
                continue
            v = to_number(r.get(spec["rank"]))
            if v is None:
                continue
            if v < 1:
                bad_ranks += 1
                continue
            m = ranks.setdefault(key_string(r.get(spec.get("series"))), {})
            if key_string(x) in m:
                duplicates += 1
            else:
                m[key_string(x)] = v
    else:
        obs = observations(rows, spec["x"], spec["y"], spec.get("series"))
        every = distinct(o["s"] for o in obs)
        values: dict[str, dict[str, float]] = {}
        for o in obs:
            if o["y"] is None or _blank(o["x"]):
                continue
            m = values.setdefault(o["s"], {})
            k = key_string(o["x"])
            if k in m:
                duplicates += 1
            m[k] = m.get(k, 0.0) + o["y"]
        desc = spec.get("rankBy") != "asc"
        for x in xs:
            present = [s for s in every if x in values.get(s, {})]
            present.sort(key=lambda s: -values[s][x] if desc else values[s][x])
            for i, s in enumerate(present):
                ranks.setdefault(s, {})[x] = i + 1
    every = [s for s in every if ranks.get(s)]
    keys = every
    if len(every) > MAX_SERIES:
        def mean_rank(s: str) -> float:
            return total(list(ranks[s].values())) / len(ranks[s])
        best = set(sorted(every, key=mean_rank)[:MAX_SERIES])
        keys = [s for s in every if s in best]
    return {"xs": xs, "all": every, "keys": keys, "ranks": ranks, "duplicates": duplicates, "badRanks": bad_ranks}


def _check_bump(spec: Spec, rows: list[dict], issues: Issues) -> None:
    if not spec.get("rank") and not spec.get("y"):
        return _issue(issues, "error", "missing_required", "y", "A bump chart needs `rank` (a column of ranks) or `y` (values to rank per x).", 'E.g. "y": "points", "series": "team".')
    if spec.get("rank") and not spec.get("series"):
        return _issue(issues, "error", "missing_required", "series", "`rank` needs `series`: the column naming whose rank each row is.")
    if spec.get("rank") and spec.get("y"):
        _issue(issues, "warning", "y_ignored", "y", "`y` is ignored when `rank` is given.")
    if not spec.get("rank") and isinstance(spec.get("y"), list) and len(spec["y"]) > 1 and spec.get("series"):
        _issue(issues, "warning", "series_ignored", "series", "`series` is ignored when `y` lists several columns.")
    if "rankBy" in spec and spec["rankBy"] != "desc" and spec.get("rank"):
        _issue(issues, "warning", "rank_by_ignored", "rankBy", "`rankBy` only applies when ranks come from `y`.")
    if spec.get("patterns") is True:
        _issue(issues, "warning", "patterns_unsupported", "patterns", "A bump chart has lines and dots, no filled areas, so patterns do not apply.")
    m = _bump_model(spec, rows)
    if m["badRanks"]:
        _issue(issues, "warning", "bad_rank", "rank", f"{m['badRanks']} rank(s) below 1 were skipped; rank 1 is the best.")
    if m["duplicates"]:
        _issue(issues, "warning", "duplicate_points", "rank" if spec.get("rank") else "y", f"{m['duplicates']} row(s) repeat a series at the same x.")
    if len(m["all"]) > MAX_SERIES:
        _issue(issues, "warning", "too_many_series", "series", f"{len(m['all'])} series; only the {MAX_SERIES} with the best average rank are drawn.", "Filter first, e.g. a `top` step in `transform`.")
    elif len(m["all"]) == 1:
        _issue(issues, "warning", "single_series", "series", "A bump chart compares ranks; with one series it is always first.", "Add `series`, or use a line chart.")
    if len(m["xs"]) < 2:
        _issue(issues, "warning", "single_step", "x", "Only one x value: there is no change of rank to show.")


def _describe_bump(spec: Spec) -> str:
    m = _bump_model(spec, spec["data"])
    xs, keys, ranks = m["xs"], m["keys"], m["ranks"]
    first = xs[0] if xs else ""
    last = xs[-1] if xs else None
    n = number_string
    t = f"{_lead(spec, 'Bump chart')} Ranks of {len(keys)} series ({_fmt_list([clip(k, 30) for k in keys])}) over {len(xs)} steps from {clip(first, 30)} to {clip(last or '', 30)}"
    t += "." if spec.get("rank") else f", ranked by {'value' if isinstance(spec['y'], list) else clip(spec['y'], 40)}, {'lowest' if spec.get('rankBy') == 'asc' else 'highest'} first."
    end = sorted((k for k in keys if last in ranks[k]), key=lambda k: ranks[k][last]) if last is not None else []
    if end:
        t += f" At {clip(last, 30)}: {', '.join(f'{n(r2(ranks[k][last]))}. {clip(k, 30)}' for k in end[:5])}."
    up = down = None
    for k in keys:
        rk = ranks[k]
        seen = [x for x in xs if x in rk]
        if len(seen) < 2:
            continue
        a, b = rk[seen[0]], rk[seen[-1]]
        if b < a and (up is None or a - b > up[1] - up[2]):
            up = (k, a, b)
        if b > a and (down is None or b - a > down[2] - down[1]):
            down = (k, a, b)
    if up:
        t += f" Biggest climb: {clip(up[0], 30)}, from {n(r2(up[1]))} to {n(r2(up[2]))}."
    if down:
        t += f" Biggest fall: {clip(down[0], 30)}, from {n(r2(down[1]))} to {n(r2(down[2]))}."
    return t


# ---------------------------------------------------------------------------------------- waffle


def _waffle_parts(spec: Spec, rows: list[dict]) -> list[dict]:
    """Categories with their summed value; past eight the smallest merge into "Other". Mirrors `parts`."""
    sums: dict[str, float] = {}
    for r in rows:
        n = to_number(r.get(spec["value"]))
        if n is None or n < 0:
            continue
        k = or_empty(r.get(spec["label"]))
        sums[k] = sums.get(k, 0.0) + n
    order = [k for k in distinct(or_empty(r.get(spec["label"])) for r in rows) if k in sums]
    parts = [{"key": k, "value": sums[k]} for k in order]
    sort = spec.get("sort")
    if sort and sort != "none":
        parts = sorted(parts, key=lambda p: p["value"] if sort == "asc" else -p["value"])
    if len(parts) > MAX_SERIES:
        keep = {p["key"] for p in _stable_desc(parts, lambda p: p["value"])[: MAX_SERIES - 1]}
        rest = [p for p in parts if p["key"] not in keep]
        parts = [p for p in parts if p["key"] in keep] + [{"key": "Other", "value": total([p["value"] for p in rest])}]
    return parts


def _check_waffle(spec: Spec, rows: list[dict], issues: Issues) -> None:
    cells = spec.get("cells")
    if cells is not None and cells % 10 != 0:
        _issue(issues, "error", "bad_value", "cells", f"cells must be a multiple of 10 so the grid is a full rectangle; got {number_string(cells)}.")
    if not any(p["value"] > 0 for p in _waffle_parts(spec, rows)):
        _issue(issues, "error", "no_positive_values", "value", "No category has a positive value; a waffle needs a whole to share out.", "Check the value column, or the transform that produced it.")


def _describe_waffle(spec: Spec) -> str:
    parts = _waffle_parts(spec, spec["data"])
    cells = spec.get("cells", 100)
    tot = total([p["value"] for p in parts])
    f = _formatter(spec)
    cols, rows = waffle_grid(cells)
    n = number_string
    t = (f"{_lead(spec, 'Waffle chart')} {len(parts)} {_plural(len(parts), 'category', 'categories')} totalling {f(tot)},"
         f" as {n(cells)} cells ({n(cols)} by {n(rows)}; one cell is {format_percent(1 / cells, 2)}).")
    if tot > 0:
        counts = waffle_cells([p["value"] for p in parts], int(cells))
        ranked = _stable_desc([{**p, "n": counts[i]} for i, p in enumerate(parts)], lambda p: p["value"])
        listed = ", ".join(f"{clip(p['key'], 30)} {format_percent(p['value'] / tot)} ({p['n']} {_plural(p['n'], 'cell', 'cells')})" for p in ranked[:5])
        t += f" {listed}{f' and {len(ranked) - 5} more' if len(ranked) > 5 else ''}."
    return t


# -------------------------------------------------------------------------------------- beeswarm


def _swarm_points(spec: Spec, rows: list[dict]) -> list[tuple[float, str]]:
    out = []
    for r in rows:
        x = to_number(r.get(spec["x"]))
        if x is not None:
            out.append((x, or_empty(r.get(spec["y"])) if spec.get("y") else ""))
    return out


def _check_beeswarm(spec: Spec, rows: list[dict], issues: Issues) -> None:
    if not _swarm_points(spec, rows):
        _issue(issues, "error", "no_points", "x", "No row has a numeric x.", "Pick a numeric column for x.")


def _describe_beeswarm(spec: Spec) -> str:
    pts = _swarm_points(spec, spec["data"])
    f = _formatter(spec)
    lanes = distinct(g for _, g in pts)

    def stat(xs: list[float]) -> str:
        v = sorted(xs)
        return f"median {f(quantile(v, 0.5))}, range {f(v[0])} to {f(v[-1])}"

    t = f"{_lead(spec, 'Beeswarm plot')} {len(pts)} {_plural(len(pts), 'value', 'values')} of {spec['x']}, one dot each"
    if spec.get("y"):
        t += f", in {len(lanes)} {_plural(len(lanes), 'group', 'groups')} by {spec['y']} ({_fmt_list([clip(l, 30) for l in lanes])})"
    t += "."
    if pts:
        t += f" Overall {stat([x for x, _ in pts])}."
    if spec.get("y") and len(lanes) > 1:
        for l in lanes[:6]:
            xs = [x for x, g in pts if g == l]
            t += f" {clip(l, 30)}: {len(xs)} {_plural(len(xs), 'value', 'values')}, {stat(xs)}."
    return t


# -------------------------------------------------------------------------------------- timeline


def _timeline_items(spec: Spec, rows: list[dict]) -> dict:
    """The ranges of a timeline: one item per row with a start and an end in the same units. Mirrors `timelineItems`."""
    start, end = spec["start"], spec["end"]
    kind = detect_x_kind(spec.get("xType"), [v for r in rows for v in (r.get(start), r.get(end))])
    items: list[dict] = []
    skipped = reversed_ = 0
    if kind != "category":
        read = to_time if kind == "time" else to_number
        for r in rows:
            a, b = read(r.get(start)), read(r.get(end))
            if a is None or b is None:
                skipped += 1
                continue
            if b < a:
                reversed_ += 1
            items.append({"lane": key_string(r.get(spec["y"])), "start": min(a, b), "end": max(a, b),
                          "series": key_string(r.get(spec["series"])) if spec.get("series") else str(spec["y"]),
                          "label": clip(key_string(r.get(spec["label"])), 60) if spec.get("label") else None})
    lanes = distinct(i["lane"] for i in items)
    by_lane: dict[str, list[dict]] = {}
    for it in items:
        by_lane.setdefault(it["lane"], []).append(it)
    overlapping = []
    for lane, group in by_lane.items():
        reach = float("-inf")
        for it in sorted(group, key=lambda i: (i["start"], i["end"])):
            if it["start"] < reach:
                overlapping.append(lane)
                break
            reach = max(reach, it["end"])
    return {"items": items, "kind": kind, "lanes": lanes, "skipped": skipped, "reversed": reversed_, "overlapping": overlapping}


def _check_timeline(spec: Spec, rows: list[dict], issues: Issues) -> None:
    d = _timeline_items(spec, rows)
    if d["kind"] == "category":
        return _issue(issues, "error", "not_time_or_number", "start", f'"{spec["start"]}" and "{spec["end"]}" are not both dates or both numbers.', "Use ISO dates, timestamps, or plain numbers in both columns; set xType to say which.")
    if not d["items"]:
        return _issue(issues, "error", "no_ranges", "end", "No row has both a start and an end.", f'Fill "{spec["start"]}" and "{spec["end"]}" in the same units.')
    if d["skipped"]:
        _issue(issues, "warning", "missing_range", "end", f"{d['skipped']} row(s) have no usable start or end and are skipped.", "Give both ends; for a point in time (a milestone) use the same value twice.")
    if d["reversed"]:
        _issue(issues, "warning", "range_reversed", "end", f"In {d['reversed']} row(s) the end is before the start; they were swapped.", "Check the column order: `start` is the earlier one.")
    if len(d["lanes"]) > MAX_CATEGORIES:
        _issue(issues, "warning", "too_many_lanes", "y", f"{len(d['lanes'])} lanes; only the first {MAX_CATEGORIES} are drawn.", "Filter with `transform`, group lanes, or split the chart with `facet`.")
    if d["overlapping"]:
        quoted = [f'"{clip(l, 30)}"' for l in d["overlapping"]]
        _issue(issues, "warning", "overlapping_ranges", "y", f"Bars overlap in {len(d['overlapping'])} {_plural(len(d['overlapping']), 'lane', 'lanes')} ({_fmt_list(quoted, 3)}); a later bar covers part of an earlier one.", "Give overlapping items their own lane, e.g. one lane per task instead of per resource.")


def _describe_timeline(spec: Spec) -> str:
    """Dates read in UTC: the reference's `timeZone` is a render option, not part of the spec."""
    d = _timeline_items(spec, spec["data"])
    items, lanes = d["items"], d["lanes"]
    if not items:
        return f"{_lead(spec, 'Timeline')} No ranges."
    time = d["kind"] == "time"
    f = _formatter(spec)
    intraday = time and any(v % _DAY != 0 for i in items for v in (i["start"], i["end"]))

    def when(v: float) -> str:
        return (format_datetime(v) if intraday else format_date(v)) if time else f(v)

    def long(it: dict) -> str:
        return format_duration(it["end"] - it["start"]) if time else f(it["end"] - it["start"])

    def name(it: dict) -> str:
        return clip(it["label"] if it["label"] is not None else it["lane"], 40)

    first = _first_min(items, lambda i: i["start"])
    last = _first_max(items, lambda i: i["end"])
    longest = _first_max(items, lambda i: i["end"] - i["start"])
    keys = distinct(i["series"] for i in items) if spec.get("series") else []
    coloured = f", coloured by {spec['series']} ({_fmt_list([clip(k, 30) for k in keys])})" if keys else ""
    t = (f"{_lead(spec, 'Timeline')} {len(items)} {_plural(len(items), 'range', 'ranges')} in {len(lanes)} {_plural(len(lanes), 'lane', 'lanes')}"
         f" ({_fmt_list([clip(l, 30) for l in lanes])}){coloured}, from {when(first['start'])} to {when(last['end'])}.")
    t += f" First: {name(first)} at {when(first['start'])}. Last to end: {name(last)} at {when(last['end'])}. Longest: {name(longest)} ({long(longest)})."
    if d["overlapping"]:
        t += f" Ranges overlap in {len(d['overlapping'])} {_plural(len(d['overlapping']), 'lane', 'lanes')}."
    if len(lanes) > MAX_CATEGORIES:
        t += f" Only the first {MAX_CATEGORIES} lanes are drawn."
    return t


def _describe_area(spec: Spec) -> str:
    stack = spec.get("stack")
    name = "Stacked area chart (100%)" if stack == "normalize" else "Stacked area chart" if stack == "stack" else "Stream graph" if stack == "center" else "Area chart"
    note = " The layers are stacked around a centre line, so the vertical axis has no zero; the thickness of each layer is its value." if stack == "center" else ""
    return _describe_series(spec, name) + note


# ----------------------------------------------------------------------------------------- tables

CHECKS: dict[str, Callable[[Spec, list[dict], Issues], None]] = {
    "bar": _check_bar,
    "pie": _check_pie,
    "donut": _check_pie,
    "line": lambda s, r, i: _check_series(s, r, i, False),
    "area": lambda s, r, i: _check_series(s, r, i, True),
    "scatter": _check_scatter,
    "histogram": lambda s, r, i: _refuse_log(s, i, "yScale"),
    "box": _check_points,
    "violin": _check_violin,
    "calendar": _check_calendar,
    "waterfall": _check_waterfall,
    "bullet": _check_bullet,
    "bump": _check_bump,
    "sunburst": _check_sunburst,
    "parallel": _check_parallel,
    "funnel": _check_funnel,
    "waffle": _check_waffle,
    "beeswarm": _check_beeswarm,
    "timeline": _check_timeline,
    "radar": _check_radar,
    "treemap": _check_treemap,
    "sankey": _check_sankey,
}

# Map charts: the check also gets the geography that `geo` resolved to (None when the spec has no `geo`).
MAP_CHECKS: dict[str, Callable[[Spec, list[dict], Issues, "Geography | None"], None]] = {
    "choropleth": _check_choropleth,
    "bubble-map": _check_bubble_map,
    "column-map": _check_column_map,
    "flow-map": _check_flow_map,
}

DESCRIBE: dict[str, Callable[[Spec], str]] = {
    "bar": _describe_bar,
    "line": lambda s: _describe_series(s, "Line chart"),
    "area": _describe_area,
    "timeline": _describe_timeline,
    "scatter": _describe_scatter,
    "pie": lambda s: _describe_pie(s, "Pie chart"),
    "donut": lambda s: _describe_pie(s, "Donut chart"),
    "histogram": _describe_histogram,
    "box": _describe_box,
    "violin": _describe_violin,
    "calendar": _describe_calendar,
    "waterfall": _describe_waterfall,
    "bullet": _describe_bullet,
    "bump": _describe_bump,
    "sunburst": _describe_sunburst,
    "parallel": _describe_parallel,
    "funnel": _describe_funnel,
    "waffle": _describe_waffle,
    "beeswarm": _describe_beeswarm,
    "heatmap": _describe_heatmap,
    "radar": _describe_radar,
    "treemap": _describe_treemap,
    "sankey": _describe_sankey,
    "choropleth": _describe_choropleth,
    "bubble-map": _describe_bubble_map,
    "column-map": _describe_column_map,
    "flow-map": _describe_flow_map,
}

