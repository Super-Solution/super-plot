"""Per-chart rules the field definitions cannot express: cross-field checks and the plain-language description.

Every function here mirrors one in the reference implementation (`packages/core/src/charts/*.ts`).
The conformance data in `conformance/plot.v1.json` is what keeps them in step.
"""
from __future__ import annotations

from typing import Any, Callable

from ._js import clip, is_number, key_string, number_string, or_empty, to_fixed, to_number
from .data import detect_x_kind, distinct, matrix, observations
from .isotime import to_time
from .numeric import bin_counts, bin_edges, box_stats, correlation, extent, mean, quantile, total
from .text import format_date, format_percent, value_formatter

Spec = dict[str, Any]
Issues = list[dict[str, Any]]
MAX_AXES = 16
MAX_NODES = 40
MAX_LINKS = 300


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
    if detect_x_kind("auto", [r.get(spec["x"]) for r in rows]) == "time" and len(rows) > 60:
        _issue(issues, "warning", "prefer_line", "type", "Many bars over time: a line or area chart reads better.")


def _describe_bar(spec: Spec) -> str:
    cats, keys, m = _bar_model(spec)
    f = _formatter(spec)
    totals = [{"c": c, "v": total(list(m.get(c, {}).values()))} for c in cats]
    t = f"{_lead(spec, 'Bar chart')} {len(cats)} {_plural(len(cats), 'category', 'categories')}"
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

    t = f"{_lead(spec, name)} {len(keys)} series{f' ({_fmt_list(keys)})' if len(keys) > 1 else ''} over {'categories' if kind == 'category' else 'time' if kind == 'time' else 'a numeric x axis'}."
    for k in keys[:4]:
        pts = [{"x": xk(o["x"]), "y": o["y"]} for o in obs if o["s"] == k and o["y"] is not None and xk(o["x"]) is not None]
        if kind != "category":
            pts.sort(key=lambda p: p["x"])
        if not pts:
            continue
        first, last = pts[0], pts[-1]
        hi = _first_max(pts, lambda p: p["y"])
        lo = _first_min(pts, lambda p: p["y"])
        change = f" ({to_fixed(((last['y'] - first['y']) / abs(first['y'])) * 100, 1)}%)" if first["y"] != 0 else ""
        t += (f" {clip(k, 40)}: from {f(first['y'])} at {label(first['x'])} to {f(last['y'])} at {label(last['x'])}{change if len(pts) > 1 else ''};"
              f" peak {f(hi['y'])} at {label(hi['x'])}, low {f(lo['y'])} at {label(lo['x'])}.")
    return t


# ------------------------------------------------------------------------------------------ scatter


def _scatter_points(spec: Spec, rows: list[dict]) -> list[dict]:
    kind = "time" if spec.get("xType") == "time" else "linear" if spec.get("xType") == "linear" else (
        "time" if any(isinstance(r.get(spec["x"]), str) and to_number(r.get(spec["x"])) is None for r in rows) else "linear")
    pts = []
    for r in rows:
        x = to_time(r.get(spec["x"])) if kind == "time" else to_number(r.get(spec["x"]))
        y = to_number(r.get(spec["y"]))
        if x is None or y is None:
            continue
        pts.append({"x": x, "y": y, "s": or_empty(r.get(spec["series"])) if spec.get("series") else str(spec["y"])})
    return pts


def _check_scatter(spec: Spec, rows: list[dict], issues: Issues) -> None:
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
    return t


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


def _describe_box(spec: Spec) -> str:
    g: dict[str, list[float]] = {}
    for r in spec["data"]:
        v = to_number(r.get(spec["y"]))
        if v is None:
            continue
        k = or_empty(r.get(spec["x"])) if spec.get("x") else str(spec["y"])
        g.setdefault(k, []).append(v)
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


# ----------------------------------------------------------------------------------------- tables

CHECKS: dict[str, Callable[[Spec, list[dict], Issues], None]] = {
    "bar": _check_bar,
    "line": lambda s, r, i: _series_ignored(s, i),
    "area": lambda s, r, i: _series_ignored(s, i),
    "scatter": _check_scatter,
    "radar": _check_radar,
    "treemap": _check_treemap,
    "sankey": _check_sankey,
}

DESCRIBE: dict[str, Callable[[Spec], str]] = {
    "bar": _describe_bar,
    "line": lambda s: _describe_series(s, "Line chart"),
    "area": lambda s: _describe_series(s, "Stacked area chart (100%)" if s.get("stack") == "normalize" else "Stacked area chart" if s.get("stack") == "stack" else "Area chart"),
    "scatter": _describe_scatter,
    "pie": lambda s: _describe_pie(s, "Pie chart"),
    "donut": lambda s: _describe_pie(s, "Donut chart"),
    "histogram": _describe_histogram,
    "box": _describe_box,
    "heatmap": _describe_heatmap,
    "radar": _describe_radar,
    "treemap": _describe_treemap,
    "sankey": _describe_sankey,
}

