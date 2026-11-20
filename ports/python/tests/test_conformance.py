# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Runs the shared conformance data (conformance/plot.v1.json) against this implementation."""
from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from super_plot import (
    bin_counts, bin_edges, box_stats, chart_types, describe_plot, format_percent, format_value, linear_ticks,
    nice_domain, quantile, require_valid, validate_plot, PlotSpecError,
    density_peaks, kde, loess, log_ticks, nice_log_domain, silverman, transform_bin_edges, waffle_cells,
    GeographyError, get_geography, match_region, register_geography, unregister_geography,
    apply_transform, time_bucket, cloud_layout,
    parse_card_ref, format_card_ref, resolve_ref, date_period,
)

DATA = json.loads((Path(__file__).resolve().parents[3] / "conformance" / "plot.v1.json").read_text(encoding="utf-8"))
# A copy of super-protocol's own card reference cases (`{"undefined": true}` stands for JavaScript undefined).
CARD_REF = json.loads((Path(__file__).resolve().parents[3] / "conformance" / "card-ref.v1.json").read_text(encoding="utf-8"))


def undefined(v):
    return None if isinstance(v, dict) and v == {"undefined": True} else v


def same(a, b, path="") -> None:
    """Deep equality; numbers within 1e-9."""
    if isinstance(b, bool) or isinstance(a, bool) or a is None or b is None or isinstance(a, str) or isinstance(b, str):
        assert a == b, f"{path}: {a!r} != {b!r}"
    elif isinstance(b, (int, float)):
        assert isinstance(a, (int, float)) and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9), f"{path}: {a!r} != {b!r}"
    elif isinstance(b, list):
        assert isinstance(a, list) and len(a) == len(b), f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            same(x, y, f"{path}[{i}]")
    else:
        assert isinstance(a, dict) and set(a) == set(b), f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in b:
            same(a[k], b[k], f"{path}.{k}")


def keyed(issues):
    return sorted((i["severity"], i["code"], i["path"]) for i in issues)


def setUpModule():
    # The validation and description cases name these geographies.
    for g in DATA["geographies"]:
        register_geography(g["name"], g["data"], g["options"])


def tearDownModule():
    for g in DATA["geographies"]:
        unregister_geography(g["name"])


class Conformance(unittest.TestCase):
    def test_version(self):
        self.assertEqual(DATA["version"], 1)

    def test_ticks(self):
        for c in DATA["linearTicks"]:
            same(linear_ticks(*c["in"]), c["out"], str(c["in"]))

    def test_nice_domain(self):
        for c in DATA["niceDomain"]:
            same(list(nice_domain(*c["in"])), c["out"], str(c["in"]))

    def test_quantile(self):
        for c in DATA["quantile"]:
            same(quantile(c["in"]["sorted"], c["in"]["p"]), c["out"], str(c["in"]["p"]))

    def test_box_stats(self):
        for c in DATA["boxStats"]:
            same(box_stats(c["in"]), c["out"], str(c["in"]))

    def test_histogram_bins(self):
        for c in DATA["histogramBins"]:
            edges = bin_edges(c["in"]["values"], c["in"]["bins"])
            same({"edges": edges, "counts": bin_counts(c["in"]["values"], edges)}, c["out"], str(c["in"]))

    def test_density(self):
        self.assertTrue(DATA["density"])
        for c in DATA["density"]:
            d = kde(c["in"]["values"], c["in"].get("bandwidth"))
            same({"silverman": silverman(c["in"]["values"]), **d, "peaks": density_peaks(d)}, c["out"], str(c["in"]))

    def test_log_ticks(self):
        self.assertTrue(DATA["logTicks"])
        for c in DATA["logTicks"]:
            same(log_ticks(*c["in"]), c["out"], str(c["in"]))

    def test_log_nice_domain(self):
        self.assertTrue(DATA["logNiceDomain"])
        for c in DATA["logNiceDomain"]:
            same(list(nice_log_domain(*c["in"])), c["out"], str(c["in"]))

    def test_loess(self):
        self.assertTrue(DATA["loess"])
        for c in DATA["loess"]:
            i = c["in"]
            same([list(p) for p in loess(i["xs"], i["ys"], i["bandwidth"], i["grid"])], c["out"], str(i))

    def test_transform_bin_edges(self):
        self.assertTrue(DATA["binStep"])
        for c in DATA["binStep"]:
            i = c["in"]
            same(transform_bin_edges(i["values"], i["maxbins"], i.get("step")), c["out"], str(i))

    def test_waffle_cells(self):
        self.assertTrue(DATA["waffleCells"])
        for c in DATA["waffleCells"]:
            self.assertEqual(waffle_cells(c["in"]["values"], c["in"]["cells"]), c["out"], str(c["in"]))

    def test_cloud_layout(self):
        self.assertTrue(DATA["cloudLayout"])
        for c in DATA["cloudLayout"]:
            i = c["in"]
            widths = {(w["size"], w["text"]): i["widths"][k] for k, w in enumerate(i["words"])}
            self.assertEqual(cloud_layout(i["words"], i["width"], i["height"], lambda text, size: widths[(size, text)]), c["out"], str(i["words"][0]))

    def test_formats(self):
        for c in DATA["formats"]:
            self.assertEqual(format_value(c["in"]["value"], c["in"]["format"]), c["out"], str(c["in"]))
        for c in DATA["percents"]:
            self.assertEqual(format_percent(c["in"]["ratio"], c["in"]["digits"]), c["out"], str(c["in"]))

    def test_chart_types(self):
        self.assertEqual(chart_types(), [c["type"] for c in DATA["chartExamples"]])

    def test_chart_examples(self):
        for c in DATA["chartExamples"]:
            v = validate_plot(c["spec"])
            self.assertEqual(v.ok, c["valid"], c["type"])
            self.assertEqual([i["code"] for i in v.issues], c["issueCodes"], c["type"])
            normalized = {k: x for k, x in v.spec.items() if k != "data"}
            same(normalized, c["normalized"], c["type"])
            self.assertEqual(describe_plot(c["spec"]), c["describe"], c["type"])

    def test_broken_specs(self):
        for c in DATA["brokenSpecs"]:
            v = validate_plot(c["spec"])
            self.assertEqual(v.ok, c["ok"], c["name"])
            self.assertEqual(keyed(v.issues), keyed([{**i, "severity": i["severity"]} for i in c["issues"]]), c["name"])

    def test_validation_cases(self):
        for c in DATA["validationCases"]:
            v = validate_plot(c["spec"])
            self.assertEqual(v.ok, c["ok"], c["name"])
            self.assertEqual(keyed(v.issues), keyed(c["issues"]), c["name"])
            if c["ok"]:
                same({k: x for k, x in v.spec.items() if k != "data"}, c["normalized"], c["name"])
            else:
                self.assertIsNone(v.spec, c["name"])

    def test_transform_cases(self):
        self.assertTrue(DATA["transformCases"])
        for c in DATA["transformCases"]:
            v = validate_plot(c["spec"])
            self.assertEqual(v.ok, c["ok"], c["name"])
            self.assertEqual(keyed(v.issues), keyed(c["issues"]), c["name"])
            if not c["ok"]:
                self.assertIsNone(v.spec, c["name"])
                with self.assertRaises(PlotSpecError):
                    describe_plot(c["spec"])
                continue
            same({k: x for k, x in v.spec.items() if k != "data"}, c["normalized"], c["name"])
            # The rows the chart reads after the steps have run.
            same(v.spec["data"], c["rows"], c["name"] + " rows")
            self.assertEqual(describe_plot(c["spec"]), c["describe"], c["name"])

    def test_transform_leaves_the_input_alone(self):
        rows = [{"d": "2026-03-09", "v": 2}, {"d": "soon", "v": 3}]
        spec = {"type": "bar", "x": "d", "y": "v", "data": rows, "transform": [{"timeUnit": {"field": "d", "unit": "month"}}, {"sort": {"field": "v", "order": "descending"}}]}
        v = validate_plot(spec)
        self.assertEqual(v.spec["data"], [{"d": None, "v": 3}, {"d": "2026-03-01", "v": 2}])
        self.assertEqual(rows, [{"d": "2026-03-09", "v": 2}, {"d": "soon", "v": 3}])
        self.assertEqual(keyed(v.issues), [("warning", "some_not_time", "transform[0].timeUnit.field")])

    def test_transform_groups_like_javascript(self):
        # JSON does not tell 1 from 1.0 and Python does; a group is what JSON.stringify makes of its values.
        rows = [{"k": 1, "v": 1}, {"k": 1.0, "v": 2}, {"k": "1", "v": 4}, {"k": True, "v": 8}, {"k": -0.0, "v": 16}, {"k": 0, "v": 32}, {"v": 64}, {"k": None, "v": 128}]
        issues: list = []
        out = apply_transform([{"aggregate": {"groupBy": ["k"], "fields": {"v": "sum"}}}], rows, issues)
        self.assertEqual(issues, [])
        self.assertEqual([r["v"] for r in out], [3, 4, 8, 48, 192])
        self.assertEqual(time_bucket(1767225600000, "week"), "2025-12-29")

    def test_describe_cases(self):
        for c in DATA["describeCases"]:
            if c["describe"] is None:
                with self.assertRaises(PlotSpecError):
                    describe_plot(c["spec"])
            else:
                self.assertEqual(describe_plot(c["spec"]), c["describe"], c["name"])
                self.assertEqual(sorted(i["code"] for i in validate_plot(c["spec"]).issues), sorted(c["issueCodes"]), c["name"])

    def test_geography_cases(self):
        for c in DATA["geographyCases"]:
            options = c["preset"] if "preset" in c else c["options"]
            try:
                issues = register_geography(c["as"], c["data"], options)
            except GeographyError as e:
                self.assertFalse(c["ok"], c["name"])
                self.assertEqual(keyed(e.issues), keyed(c["issues"]), c["name"])
                self.assertIsNone(get_geography(c["as"]), c["name"])
                continue
            geo = get_geography(c["as"])
            self.assertTrue(unregister_geography(c["as"]), c["name"])
            self.assertTrue(c["ok"], c["name"])
            self.assertEqual(keyed(issues), keyed(c["issues"]), c["name"])
            self.assertEqual([{k: r[k] for k in ("key", "name", "disputed")} for r in geo.regions], c["regions"], c["name"])
            self.assertEqual([[p, match_region(geo, p)] for p, _ in c["matches"]], c["matches"], c["name"])

    def test_geography_presets_and_functions(self):
        with self.assertRaises(GeographyError) as cm:
            register_geography("x", {}, "no-such-preset")
        self.assertEqual(keyed(cm.exception.issues), [("error", "bad_enum", "options")])
        fc = DATA["geographies"][0]["data"]
        register_geography("conf-fn", fc, {"key": lambda p, i: f"{i}-{p['name']}".lower(), "name": lambda p, i: None})
        self.assertEqual([r["key"] for r in get_geography("conf-fn").regions], ["n-north", "s-south", "e-east isle"])
        self.assertTrue(unregister_geography("conf-fn"))
        self.assertFalse(unregister_geography("conf-fn"))

    def test_require_valid_reports_every_issue(self):
        with self.assertRaises(PlotSpecError) as cm:
            require_valid({"type": "bar", "x": "nope", "y": "v", "stak": 1, "data": [{"a": 1, "v": 1}]})
        self.assertGreaterEqual(len(cm.exception.issues), 2)

    def test_card_ref_parse(self):
        self.assertTrue(CARD_REF["card_ref_parse"])
        for c in CARD_REF["card_ref_parse"]:
            same(parse_card_ref(undefined(c["value"])), c["expect"], repr(c["value"]))

    def test_card_ref_format(self):
        self.assertTrue(CARD_REF["card_ref_format"])
        for c in CARD_REF["card_ref_format"]:
            same(format_card_ref(undefined(c["value"])), c["expect"], repr(c["value"]))

    def test_date_periods(self):
        for c in DATA["datePeriods"]:
            same(date_period(c["in"]), c["out"], c["in"])

    def test_ref_cases(self):
        self.assertTrue(DATA["refCases"])
        for c in DATA["refCases"]:
            same(resolve_ref(c["spec"], c["ref"], c.get("hidden")), c["out"], c["name"])


if __name__ == "__main__":
    unittest.main()
