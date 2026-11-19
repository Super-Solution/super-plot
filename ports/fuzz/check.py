# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Compare the Python port with the reference on generated cases: python3 check.py <cases.json> (see generate.mjs)."""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python" / "src"))
from super_plot import (  # noqa: E402
    bin_counts, bin_edges, box_stats, cloud_layout, density_peaks, describe_plot, format_value, kde, linear_ticks, loess, log_ticks, nice_domain,
    nice_log_domain, silverman, time_bucket, transform_bin_edges, validate_plot, waffle_cells,
)
from super_plot.text import format_duration, format_exact  # noqa: E402

d = json.load(open(sys.argv[1], encoding="utf-8"))
bad = 0


def report(*a):
    global bad
    bad += 1
    if bad <= 10:
        print(*a)


for f, v, want in d["out"]:
    got = format_value(v, f)
    if got != want:
        report("FORMAT", f, repr(v), repr(got), repr(want))
for a, b, n, t, nd in d["ticks"]:
    if linear_ticks(a, b, n) != t or list(nice_domain(a, b, n)) != nd:
        report("TICKS", a, b, n)
for vs, b, e, c, bx in d["bins"]:
    ge = bin_edges(vs, b)
    if ge != e or bin_counts(vs, ge) != c:
        report("BINS", len(vs), b)
    gb = box_stats(vs)
    for k in bx:
        if gb[k] != bx[k] and not (isinstance(bx[k], float) and math.isclose(gb[k], bx[k], rel_tol=1e-12)):
            report("BOX", k, gb[k], bx[k])
for t, unit, want in d["buckets"]:
    if time_bucket(t, unit) != want:
        report("BUCKET", repr(t), unit, time_bucket(t, unit), want)
# Round 5 statistics. Equal means equal: the ports compute these with the reference's own elementary functions.
for a, b, n, t, nd in d["logs"]:
    if log_ticks(a, b, n) != t or list(nice_log_domain(a, b)) != nd:
        report("LOG", a, b, n, log_ticks(a, b, n), t, nice_log_domain(a, b), nd)
for vs, bw, sil, used, grid, dens, peaks in d["densities"]:
    k = kde(vs, bw)
    if silverman(vs) != sil or k["bandwidth"] != used or k["grid"] != grid or k["density"] != dens or density_peaks(k) != peaks:
        report("DENSITY", len(vs), bw, silverman(vs), sil, density_peaks(k), peaks)
for xs, ys, bw, grid, want in d["fits"]:
    if loess(xs, ys, bw, grid) != want:
        report("LOESS", len(xs), bw, grid)
for vs, maxbins, step, want in d["binSteps"]:
    if transform_bin_edges(vs, maxbins, step) != want:
        report("BINSTEP", len(vs), maxbins, step, transform_bin_edges(vs, maxbins, step), want)
for vs, cells, want in d["waffles"]:
    if waffle_cells(vs, cells) != want:
        report("WAFFLE", vs, cells, waffle_cells(vs, cells), want)
for ms, want in d["durations"]:
    if format_duration(ms) != want:
        report("DURATION", repr(ms), format_duration(ms), want)
# Round 6: the 3D charts' exact number format, and word cloud layouts (whole pixels, so equal means equal).
for v, want in d["exacts"]:
    if format_exact(v) != want:
        report("EXACT", repr(v), format_exact(v), want)
for words, widths, width, height, want in d["clouds"]:
    by_text = {w["text"]: widths[j] for j, w in enumerate(words)}
    got = cloud_layout(words, width, height, lambda text, size: by_text[text])
    if got != want:
        report("CLOUD", len(words), width, height, got, want)
for i, c in enumerate(d["specs"]):
    v = validate_plot(c["spec"])
    got = sorted((x["severity"], x["code"], x["path"]) for x in v.issues)
    want = sorted(tuple(x) for x in c["issues"])
    problems = []
    if v.ok != c["ok"]:
        problems.append("ok")
    if got != want:
        problems.append(f"issues {got} != {want}")
    if v.ok and c["ok"]:
        if {k: x for k, x in v.spec.items() if k != "data"} != c["normalized"]:
            problems.append("normalized")
        if "rows" in c and v.spec["data"] != c["rows"]:  # what the chart reads after `transform`
            problems.append(f"rows {v.spec['data']!r} != {c['rows']!r}")
        if describe_plot(c["spec"]) != c["describe"]:
            problems.append(f"describe {describe_plot(c['spec'])!r} != {c['describe']!r}")
    if problems:
        report("SPEC", i, c["spec"]["type"], problems)
print(f"python: {sum(len(d[k]) for k in d if k != 'specs')} numeric cases, {len(d['specs'])} specs, {bad} mismatches")
sys.exit(1 if bad else 0)
