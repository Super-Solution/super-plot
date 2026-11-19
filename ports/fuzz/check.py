"""Compare the Python port with the reference on generated cases: python3 check.py <cases.json> (see generate.mjs)."""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python" / "src"))
from super_plot import bin_counts, bin_edges, box_stats, describe_plot, format_value, linear_ticks, nice_domain, time_bucket, validate_plot  # noqa: E402

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
print(f"python: {len(d['out']) + len(d['ticks']) + len(d['bins']) + len(d['buckets'])} numeric cases, {len(d['specs'])} specs, {bad} mismatches")
sys.exit(1 if bad else 0)
