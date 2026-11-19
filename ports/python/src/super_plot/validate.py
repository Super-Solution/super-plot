"""Check a plot spec without drawing it.

Every problem comes back at once, each with a stable `code`, a `path` and a `hint` that says how to fix it, so an
agent can repair the spec in one round trip. The contract is the set of (severity, code, path); wording may differ
between languages. Field definitions are read from `fields.v1.json`, generated from the reference implementation.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from importlib import resources
from typing import Any

from ._js import clip as _clip  # noqa: F401  (re-exported for symmetry with the reference)
from ._js import is_finite_number, is_number, to_number, ulen, uslice
from .charts import CHECKS, DESCRIBE
from .numeric import closest
from .text import is_value_format

with resources.files(__package__).joinpath("fields.v1.json").open("r", encoding="utf-8") as _f:
    _DEFS: dict[str, Any] = json.load(_f)

LIMITS: dict[str, int] = _DEFS["limits"]
_CHARTS: dict[str, dict[str, dict[str, Any]]] = {c["type"]: {f["name"]: f for f in c["fields"]} for c in _DEFS["charts"]}
_ANNOTATION_KEYS = ["axis", "value", "to", "label", "tone"]
_TONES = ["neutral", "positive", "negative", "warning", "info"]
_HEX = re.compile(r"#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})", re.I)
_FUNC = re.compile(r"(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/-]+\)", re.I)
_NAMED = re.compile(r"[a-z]{3,24}", re.I)
_VAR = re.compile(r"var\(\s*--[a-z0-9_-]+\s*(?:,\s*(?:#[0-9a-f]{3,8}|[a-z]{3,24})\s*)?\)", re.I)


def chart_types() -> list[str]:
    """Every chart type, in registration order."""
    return list(_CHARTS)


def fields_of(chart_type: str) -> dict[str, dict[str, Any]]:
    """The field definitions of one chart type: name -> {kind, desc, required, default, ...}."""
    return _CHARTS[chart_type]


def is_safe_color(value: Any) -> bool:
    """Only plain colour syntax: no `url()`, no `;`, no quotes, nothing that could break out of an attribute."""
    if not isinstance(value, str) or ulen(value) > 64:
        return False
    v = value.strip()
    return bool(_HEX.fullmatch(v) or _FUNC.fullmatch(v) or _VAR.fullmatch(v) or _NAMED.fullmatch(v))


@dataclass
class Validation:
    """Result of `validate_plot`. `spec` has defaults filled in and values normalised; it is set only when `ok`."""

    ok: bool
    issues: list[dict[str, Any]] = field(default_factory=list)
    spec: dict[str, Any] | None = None

    @property
    def errors(self) -> list[dict[str, Any]]:
        return [i for i in self.issues if i["severity"] == "error"]


class PlotSpecError(ValueError):
    """Raised by `require_valid`; carries the issues."""

    def __init__(self, issues: list[dict[str, Any]]):
        errors = [i for i in issues if i["severity"] == "error"]
        super().__init__("\n".join(f"{i['path'] or 'spec'}: {i['message']}{' ' + i['hint'] if i.get('hint') else ''}" for i in errors) or "Invalid plot spec")
        self.issues = issues


def _add(issues: list, severity: str, code: str, path: str, message: str, hint: str | None = None) -> None:
    issues.append({"severity": severity, "code": code, "path": path, "message": message, **({"hint": hint} if hint else {})})


def _show(v: Any) -> str:
    try:
        s = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        s = str(v)
    return s if len(s) <= 60 else s[:57] + "…"


def _validate_field(name: str, d: dict[str, Any], value: Any, issues: list, columns: dict[str, None], rows: list[dict]) -> Any:
    def bad(code: str, message: str, hint: str | None = None) -> None:
        _add(issues, "error", code, name, message, hint)

    kind = d["kind"]
    if kind == "version":
        if is_number(value) and value == 1:
            return 1
        return bad("bad_value", f"version must be 1, got {_show(value)}.")
    if kind == "data":
        return value
    if kind == "string":
        if not isinstance(value, str):
            return bad("bad_type", f"{name} must be a string, got {_show(value)}.")
        limit = d.get("max", LIMITS["maxString"])
        if ulen(value) > limit:
            _add(issues, "warning", "string_truncated", name, f"{name} is {ulen(value)} characters; it will be cut to {limit}.")
            return uslice(value, limit)
        return value
    if kind == "boolean":
        return value if isinstance(value, bool) else bad("bad_type", f"{name} must be true or false, got {_show(value)}.")
    if kind == "number":
        if not is_finite_number(value):
            return bad("bad_type", f"{name} must be a number, got {_show(value)}.")
        if d.get("integer") and not float(value).is_integer():
            return bad("bad_value", f"{name} must be an integer, got {value}.")
        if "min" in d and value < d["min"]:
            return bad("out_of_range", f"{name} must be at least {d['min']}, got {value}.")
        if "max" in d and value > d["max"]:
            return bad("out_of_range", f"{name} must be at most {d['max']}, got {value}.")
        return value
    if kind == "enum":
        if isinstance(value, str) and value in d["values"]:
            return value
        near = closest(value, d["values"]) if isinstance(value, str) else None
        return bad("bad_enum", f"{name} must be one of {', '.join(d['values'])}; got {_show(value)}.", f'Did you mean "{near}"?' if near else None)
    if kind == "format":
        return value if is_value_format(value) else bad("bad_format", f"format {_show(value)} is not recognised.", "Use auto, compact, integer, percent, fixed:N (N is 0-20) or currency:USD.")
    if kind == "bins":
        if value == "auto" and isinstance(value, str):
            return value
        if is_number(value) and float(value).is_integer() and 1 <= value <= 200:
            return value
        return bad("bad_value", f'bins must be "auto" or an integer from 1 to 200, got {_show(value)}.')
    if kind == "domain":
        if not isinstance(value, list) or len(value) != 2 or not all(v is None or is_finite_number(v) for v in value):
            return bad("bad_value", f'{name} must be [min, max] with numbers or null for "automatic", got {_show(value)}.')
        if value[0] is not None and value[1] is not None and value[0] >= value[1]:
            return bad("bad_value", f"{name} min must be below max.")
        return value
    if kind == "colors":
        if not isinstance(value, dict):
            return bad("bad_type", "colors must be an object of name to colour.")
        out: dict[str, str] = {}
        for k, v in value.items():
            if is_safe_color(v):
                out[k] = v.strip()
            else:
                _add(issues, "error", "bad_color", f"colors.{k}", f"colors.{k} is not a plain CSS colour: {_show(v)}.", "Use #RRGGBB, rgb(), hsl(), a colour name or var(--token). url() and other syntax are refused.")
        return out
    if kind == "annotations":
        return _annotations(name, value, issues)
    # column / columns
    names = (value if isinstance(value, list) else [value]) if kind == "columns" else [value]
    if kind == "column" and not isinstance(value, str):
        return bad("bad_type", f"{name} must be the name of a data column (a string), got {_show(value)}.")
    if (kind == "columns" and not all(isinstance(v, str) for v in names)) or len(names) == 0:
        return bad("bad_type", f"{name} must be a column name or a non-empty array of column names.")
    ok = True
    for i, c in enumerate(names):
        path = f"{name}[{i}]" if isinstance(value, list) else name
        if c not in columns:
            ok = False
            near = closest(c, list(columns))
            _add(issues, "error", "no_such_column", path, f'Column "{c}" does not exist in data.', f"{f'Did you mean {chr(34)}{near}{chr(34)}? ' if near else ''}Available columns: {', '.join(list(columns)[:20])}.")
        elif d.get("role") == "number":
            non_num = seen = 0
            for r in rows:
                v = r.get(c)
                if v is None or v == "":
                    continue
                seen += 1
                if to_number(v) is None:
                    non_num += 1
            if seen > 0 and non_num == seen:
                ok = False
                _add(issues, "error", "not_numeric", path, f'Column "{c}" has no numeric values.', "Convert the values to numbers, or pick another column.")
            elif non_num > 0:
                _add(issues, "warning", "some_not_numeric", path, f'{non_num} of {seen} values in "{c}" are not numeric and will be skipped.')
    if not ok:
        return None
    if kind == "columns":
        return names[0] if len(names) == 1 and not isinstance(value, list) else names
    return names[0]


def _annotations(name: str, value: Any, issues: list) -> Any:
    if not isinstance(value, list):
        return _add(issues, "error", "bad_type", name, "annotations must be an array.")
    if len(value) > LIMITS["maxAnnotations"]:
        return _add(issues, "error", "too_many", name, f"At most {LIMITS['maxAnnotations']} annotations.")
    out: list[dict[str, Any]] = []
    for i, a in enumerate(value):
        p = f"annotations[{i}]"
        if not isinstance(a, dict):
            _add(issues, "error", "bad_type", p, f"{p} must be an object.")
            continue
        for k in a:
            if k not in _ANNOTATION_KEYS:
                _add(issues, "error", "unknown_field", f"{p}.{k}", f'Unknown annotation field "{k}".', f"Allowed: {', '.join(_ANNOTATION_KEYS)}.")
        if a.get("axis") not in ("x", "y"):
            _add(issues, "error", "bad_enum", f"{p}.axis", f'{p}.axis must be "x" or "y".')
        elif not (isinstance(a.get("value"), str) or is_number(a.get("value"))):
            _add(issues, "error", "bad_type", f"{p}.value", f"{p}.value must be a number or a string.")
        elif "to" in a and a["to"] is not None and not (isinstance(a["to"], str) or is_number(a["to"])):
            _add(issues, "error", "bad_type", f"{p}.to", f"{p}.to must be a number or a string.")
        elif "tone" in a and a["tone"] is not None and a["tone"] not in _TONES:
            _add(issues, "error", "bad_enum", f"{p}.tone", f"{p}.tone must be one of {', '.join(_TONES)}.")
        elif "label" in a and a["label"] is not None and not isinstance(a["label"], str):
            _add(issues, "error", "bad_type", f"{p}.label", f"{p}.label must be a string.")
        else:
            out.append({**a, **({"label": uslice(a["label"], 80)} if isinstance(a.get("label"), str) else {})})
    return out


def _default(d: dict[str, Any]) -> Any:
    return d.get("default")


def validate_plot(spec: Any) -> Validation:
    """Check a spec (a dict, or a JSON string) without drawing it."""
    issues: list[dict[str, Any]] = []

    def fail(code: str, path: str, message: str, hint: str | None = None) -> Validation:
        _add(issues, "error", code, path, message, hint)
        return Validation(False, issues)

    raw = spec
    if isinstance(spec, str):
        def refuse(_: str) -> Any:
            raise ValueError("NaN and Infinity are not JSON")

        try:
            raw = json.loads(spec, parse_constant=refuse)
        except ValueError as e:
            return fail("invalid_json", "", f"Spec is not valid JSON: {e}.")
    if not isinstance(raw, dict):
        return fail("bad_type", "", "Spec must be an object.")
    obj: dict[str, Any] = raw

    types = chart_types()
    if not isinstance(obj.get("type"), str):
        return fail("missing_required", "type", 'Missing "type".', f"Choose one of: {', '.join(types)}.")
    if obj["type"] not in _CHARTS:
        near = closest(obj["type"], types)
        return fail("unknown_type", "type", f'Unknown chart type "{obj["type"]}".', f"{f'Did you mean {chr(34)}{near}{chr(34)}? ' if near else ''}Available: {', '.join(types)}.")

    chart = obj["type"]
    defs = _CHARTS[chart]
    rows = obj.get("data")
    if not isinstance(rows, list) or len(rows) == 0:
        _add(issues, "error", "missing_required" if "data" not in obj else "empty_data", "data", 'Missing "data".' if "data" not in obj else "data must be a non-empty array of row objects.", 'Example: [{"region":"APAC","revenue":120}, ...]')
    elif len(rows) > LIMITS["maxRows"]:
        _add(issues, "error", "too_many_rows", "data", f"data has {len(rows)} rows; the limit is {LIMITS['maxRows']}.", "Aggregate or sample before plotting; a chart cannot show that many marks.")
    elif not all(isinstance(r, dict) for r in rows):
        _add(issues, "error", "bad_type", "data", "Every row of data must be an object.")
    data_ok = not any(i["path"] == "data" and i["severity"] == "error" for i in issues)
    columns: dict[str, None] = {}  # insertion-ordered, like the keys of the first rows in JavaScript
    if data_ok:
        for r in rows[:200]:
            columns.update(dict.fromkeys(r))
    valid_rows: list[dict] = rows if data_ok else []

    out: dict[str, Any] = {"type": chart}
    for key, value in obj.items():
        if key in ("type", "data"):
            continue
        d = defs.get(key)
        if d is None:
            near = closest(key, list(defs))
            _add(issues, "error", "unknown_field", key, f'Unknown field "{key}" for a {chart} chart.', f'Did you mean "{near}"?' if near else f"Allowed: {', '.join(defs)}.")
            continue
        if d["kind"] in ("column", "columns") and not data_ok:
            continue
        v = _validate_field(key, d, value, issues, columns, valid_rows)
        if v is not None:
            out[key] = v
    for key, d in defs.items():
        if key in out or key in ("type", "data"):
            continue
        if d.get("required") and key not in obj:
            _add(issues, "error", "missing_required", key, f'Missing required field "{key}": {d["desc"]}', f'See the "{chart}" example in the catalog.')
        elif _default(d) is not None:
            out[key] = _default(d)
    if data_ok:
        out["data"] = rows
    if not any(i["severity"] == "error" for i in issues) and chart in CHECKS:
        CHECKS[chart](out, valid_rows, issues)

    ok = not any(i["severity"] == "error" for i in issues)
    return Validation(ok, issues, out if ok else None)


def require_valid(spec: Any) -> dict[str, Any]:
    """The normalised spec, or `PlotSpecError` with every issue."""
    v = validate_plot(spec)
    if not v.ok or v.spec is None:
        raise PlotSpecError(v.issues)
    return v.spec


def describe_plot(spec: Any) -> str:
    """Plain-language reading of a chart: what it shows and its headline numbers (also its alt text).

    Raises `PlotSpecError` when the spec is invalid."""
    s = require_valid(spec)
    d = s.get("description")
    return d if isinstance(d, str) and d else DESCRIBE[s["type"]](s)
