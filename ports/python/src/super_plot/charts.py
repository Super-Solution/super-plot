"""Per-chart rules the field definitions cannot express: cross-field checks and the plain-language description.

Every function here mirrors one in the reference implementation (`packages/core/src/charts/*.ts`).
The conformance data in `conformance/plot.v1.json` is what keeps them in step.
"""
from __future__ import annotations

from typing import Any, Callable

from ._js import clip, is_number, js_string, key_string, number_string, or_empty, to_fixed, to_number
from .data import detect_x_kind, distinct, matrix, observations
from .geo import Geography, js_trim, normalize_region
from .isotime import to_time
from .numeric import bin_counts, bin_edges, box_stats, closest, correlation, extent, mean, quantile, total
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


def _line_cols(spec: Spec) -> list[str]:
    """Combo chart: columns drawn as lines over vertical bars. Mirrors `lineCols`."""
    if "line" not in spec or spec.get("orientation") == "horizontal" or spec.get("stack") == "normalize":
        return []
    return spec["line"] if isinstance(spec["line"], list) else [spec["line"]]


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
    ls = [k for k in _line_cols(spec) if k not in keys]
    if ls:
        t += f" With {'a line' if len(ls) == 1 else 'lines'} for {_fmt_list(ls)} on the same axis."
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
    "choropleth": _describe_choropleth,
    "bubble-map": _describe_bubble_map,
    "column-map": _describe_column_map,
    "flow-map": _describe_flow_map,
}

