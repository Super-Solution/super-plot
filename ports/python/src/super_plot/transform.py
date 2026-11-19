"""`transform`: a short list of data steps that run before the chart reads its columns.

Mirrors `packages/core/src/transform.ts`. Steps are plain JSON and run in order; the output of each step is the
input of the next, and each step is checked against the columns the step before it left:

    {"filter":    {"field": "region", "oneOf": ["APAC", "EMEA"]}}
    {"filter":    {"field": "date", "range": ["2026-01-01", "2026-07-01"]}}    from inclusive, to exclusive
    {"timeUnit":  {"field": "date", "unit": "month", "as": "month"}}
    {"aggregate": {"groupBy": ["month", "region"], "fields": {"revenue": "sum"}, "count": "orders"}}
    {"sort":      {"field": "revenue", "order": "descending"}}
    {"top":       {"n": 10, "by": "revenue"}}
    {"bin":       {"field": "price", "maxbins": 10, "as": ["from", "to"]}}        round edges, as the histogram
    {"window":    {"op": "sum", "field": "revenue", "as": "running", "groupBy": ["region"], "sortBy": "date"}}
    {"fold":      {"fields": ["Q1", "Q2", "Q3"], "as": ["quarter", "revenue"]}}  wide to long

There is deliberately no expression step (`calculate`).

The first invalid step stops the run (later steps cannot be checked without its output).
"""
from __future__ import annotations

from functools import cmp_to_key
from typing import Any, Callable

from ._js import is_finite_number, is_number, js_keys, js_string, json_key, to_number, ulen, utf16_key
from .isotime import MAX_TIME, MIN_TIME, time_bucket, to_time
from .numeric import bin_index, closest, transform_bin_edges

Row = dict[str, Any]
Issues = list[dict[str, Any]]

TRANSFORM_LIMIT = 10
TRANSFORM_OPS = ["filter", "timeUnit", "aggregate", "sort", "top", "bin", "window", "fold"]
WINDOW_OPS = ["sum", "mean", "count", "rank", "pctChange", "lag", "lead", "movingMean"]
BIN_LIMIT = 200
FOLD_LIMIT = 50
MAX_ROWS = 50000  # LIMITS.maxRows
TIME_UNITS = ["year", "quarter", "month", "week", "day", "hour"]
AGGREGATE_OPS = ["sum", "mean", "median", "min", "max", "count", "distinct"]
_FILTER_KEYS = ["field", "equal", "oneOf", "range", "gt", "gte", "lt", "lte", "valid"]
_KEYS = {"filter": _FILTER_KEYS, "timeUnit": ["field", "unit", "as"], "aggregate": ["groupBy", "fields", "count"], "sort": ["field", "order"], "top": ["n", "by"],
         "bin": ["field", "as", "step", "maxbins"], "window": ["op", "field", "as", "groupBy", "sortBy", "order", "frame"], "fold": ["fields", "as"]}


def _fmt(v: Any) -> str:
    s = json_key(v)
    return s if len(s) <= 60 else s[:57] + "…"


def ordinal(v: Any) -> float | None:
    """A row value or bound as a number: numbers first, then ISO dates (epoch ms). Mirrors `ordinal`."""
    n = to_number(v)
    return n if n is not None else to_time(v)


def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (str, bool)) or is_number(v)


def _is_bound(v: Any) -> bool:
    return is_finite_number(v) or (isinstance(v, str) and ordinal(v) is not None)


def _text(r: Row, key: str) -> str:
    """`String(r[key])`: a missing key reads "undefined"."""
    return js_string(r[key]) if key in r else "undefined"


def columns_of(rows: list[Row]) -> dict[str, None]:
    """The column names of the first 200 rows, in order of first appearance. Mirrors `columnsOf`."""
    out: dict[str, None] = {}
    for r in rows[:200]:
        if isinstance(r, dict):
            out.update(dict.fromkeys(r))
    return out


def apply_transform(value: Any, rows: list[Row], issues: Issues, path: str = "transform") -> list[Row] | None:
    """Check the steps against the columns they will see and run them. Mirrors `applyTransform`.

    Returns the transformed rows, or None when a step is invalid (the issues say why)."""

    def err(p: str, code: str, message: str, hint: str | None = None) -> None:
        issues.append({"severity": "error", "code": code, "path": p, "message": message, **({"hint": hint} if hint else {})})

    if not isinstance(value, list):
        return err(path, "bad_type", "transform must be an array of steps.", 'Example: [{"filter":{"field":"region","oneOf":["APAC"]}}]')
    if len(value) > TRANSFORM_LIMIT:
        return err(path, "too_many", f"At most {TRANSFORM_LIMIT} transform steps; got {len(value)}.")
    cur = rows
    columns = columns_of(rows)

    def no_column(p: str, name: str, listed: bool = True) -> None:
        near = closest(name, list(columns))
        hint = f'Did you mean "{near}"? ' if near else ""
        if listed:
            hint += f"Columns here: {', '.join(list(columns)[:20])}."
        err(p, "no_such_column", f'Column "{name}" does not exist at this step.', hint.strip() or None)

    for i, step in enumerate(value):
        p = f"{path}[{i}]"
        if not isinstance(step, dict):
            return err(p, "bad_type", f"{p} must be an object with one key: {', '.join(TRANSFORM_OPS)}.")
        keys = js_keys(step)
        if len(keys) != 1 or keys[0] not in TRANSFORM_OPS:
            near = closest(keys[0], TRANSFORM_OPS) if len(keys) == 1 else None
            return err(p, "bad_transform", f"{p} must have exactly one of {', '.join(TRANSFORM_OPS)}; got {', '.join(keys) if keys else 'nothing'}.", f'Did you mean "{near}"?' if near else None)
        op = keys[0]
        b = step[op]
        bp = f"{p}.{op}"
        if not isinstance(b, dict):
            return err(bp, "bad_type", f"{bp} must be an object.")
        for k in js_keys(b):
            if k not in _KEYS[op]:
                near = closest(k, _KEYS[op])
                return err(f"{bp}.{k}", "unknown_field", f'Unknown {op} field "{k}".', f'Did you mean "{near}"?' if near else f"Allowed: {', '.join(_KEYS[op])}.")

        def column(k: str) -> str | None:
            if k not in b:
                return err(f"{bp}.{k}", "missing_required", f'{bp} needs "{k}" (a column name).')
            v = b[k]
            if not isinstance(v, str):
                return err(f"{bp}.{k}", "bad_type", f"{bp}.{k} must be a column name, got {_fmt(v)}.")
            if v not in columns:
                return no_column(f"{bp}.{k}", v)
            return v

        if op == "filter":
            field = column("field")
            if field is None:
                return None
            if not any(k in b for k in _FILTER_KEYS if k != "field"):
                return err(bp, "missing_required", f"{bp} needs a test: equal, oneOf, range, gt, gte, lt, lte or valid.")
            if "equal" in b and not _is_scalar(b["equal"]):
                return err(f"{bp}.equal", "bad_type", f"{bp}.equal must be a string, number, boolean or null.")
            if "oneOf" in b and not (isinstance(b["oneOf"], list) and len(b["oneOf"]) <= 1000 and all(_is_scalar(v) for v in b["oneOf"])):
                return err(f"{bp}.oneOf", "bad_type", f"{bp}.oneOf must be an array of at most 1000 strings, numbers, booleans or nulls.")
            if "range" in b:
                r = b["range"]
                if not isinstance(r, list) or len(r) != 2 or not all(v is None or _is_bound(v) for v in r):
                    return err(f"{bp}.range", "bad_value", f"{bp}.range must be [from, to]: numbers, ISO dates or null (open); got {_fmt(r)}.")
                if r[0] is not None and r[1] is not None and ordinal(r[0]) > ordinal(r[1]):  # type: ignore[operator]
                    return err(f"{bp}.range", "bad_value", f"{bp}.range from must not be after to.")
            for k in ("gt", "gte", "lt", "lte"):
                if k in b and not _is_bound(b[k]):
                    return err(f"{bp}.{k}", "bad_value", f"{bp}.{k} must be a number or an ISO date, got {_fmt(b[k])}.")
            if "valid" in b and not isinstance(b["valid"], bool):
                return err(f"{bp}.valid", "bad_type", f"{bp}.valid must be true or false.")
            keep = filter_row(b)
            cur = [r for r in cur if keep(r)]
        elif op == "timeUnit":
            field = column("field")
            if field is None:
                return None
            unit = b.get("unit")
            if not isinstance(unit, str) or unit not in TIME_UNITS:
                near = closest(unit, TIME_UNITS) if isinstance(unit, str) else None
                return err(f"{bp}.unit", "bad_enum", f"{bp}.unit must be one of {', '.join(TIME_UNITS)}; got {_fmt(unit)}.", f'Did you mean "{near}"?' if near else None)
            if "as" in b and not _is_name(b["as"]):
                return err(f"{bp}.as", "bad_type", f"{bp}.as must be a column name of 1 to 64 characters.")
            target = b.get("as", field)
            bad = 0
            out: list[Row] = []
            for r in cur:
                t = to_time(r.get(field))
                if t is not None and not MIN_TIME <= t <= MAX_TIME:
                    t = None
                if t is None:
                    bad += 1
                out.append({**r, target: None if t is None else time_bucket(t, unit)})
            cur = out
            if cur and bad == len(cur):
                return err(f"{bp}.field", "not_time", f'Column "{field}" has no dates (ISO 8601 strings or epoch milliseconds, years 1 to 9999).')
            if bad:
                issues.append({"severity": "warning", "code": "some_not_time", "path": f"{bp}.field", "message": f'{bad} of {len(cur)} values in "{field}" are not dates (or fall outside years 1 to 9999); they become null.'})
            columns = {**columns, target: None}
        elif op == "aggregate":
            group_by = b.get("groupBy")
            if group_by is None:
                group_by = []
            if not isinstance(group_by, list) or len(group_by) > 4 or not all(isinstance(g, str) for g in group_by):
                return err(f"{bp}.groupBy", "bad_type", f"{bp}.groupBy must be an array of at most 4 column names.")
            for gi, g in enumerate(group_by):
                if g not in columns:
                    return no_column(f"{bp}.groupBy[{gi}]", g)
            fields = b.get("fields")
            if fields is None:
                fields = {}
            if not isinstance(fields, dict):
                return err(f"{bp}.fields", "bad_type", f'{bp}.fields must be an object of column to operation, e.g. {{"revenue":"sum"}}.')
            names = js_keys(fields)
            for col in names:
                o = fields[col]
                if col not in columns:
                    return no_column(f"{bp}.fields.{col}", col, listed=False)
                if not isinstance(o, str) or o not in AGGREGATE_OPS:
                    near = closest(o, AGGREGATE_OPS) if isinstance(o, str) else None
                    return err(f"{bp}.fields.{col}", "bad_enum", f"{bp}.fields.{col} must be one of {', '.join(AGGREGATE_OPS)}; got {_fmt(o)}.", f'Did you mean "{near}"?' if near else None)
            if "count" in b and not _is_name(b["count"]):
                return err(f"{bp}.count", "bad_type", f"{bp}.count must be a column name of 1 to 64 characters.")
            if not names and "count" not in b:
                return err(bp, "missing_required", f'{bp} needs "fields" (e.g. {{"revenue":"sum"}}) or "count" (a name for the row count).')
            cur = _aggregate(cur, group_by, [(col, fields[col]) for col in names], b.get("count"))
            columns = dict.fromkeys([*group_by, *names, *([b["count"]] if "count" in b else [])])
        elif op == "sort":
            field = column("field")
            if field is None:
                return None
            if "order" in b and b["order"] not in ("ascending", "descending"):
                return err(f"{bp}.order", "bad_enum", f'{bp}.order must be "ascending" or "descending".')
            cur = _sort_rows(cur, field, b.get("order") == "descending")
        elif op == "top":
            by = column("by")
            if by is None:
                return None
            n = b.get("n")
            if not is_finite_number(n) or not float(n).is_integer() or n < 1 or n > 1000:
                return err(f"{bp}.n", "bad_value", f"{bp}.n must be an integer from 1 to 1000, got {_fmt(n)}.")
            cur = _sort_rows(cur, by, True)[: int(n)]
        elif op == "bin":
            field = column("field")
            if field is None:
                return None
            names = b["as"] if "as" in b else [f"{field}_start", f"{field}_end"]
            if not _is_pair(names):
                return err(f"{bp}.as", "bad_type", f"{bp}.as must be two different column names of 1 to 64 characters: [start, end].", 'E.g. ["from", "to"].')
            if "maxbins" in b and not (_is_int(b["maxbins"]) and 1 <= b["maxbins"] <= BIN_LIMIT):
                return err(f"{bp}.maxbins", "bad_value", f"{bp}.maxbins must be an integer from 1 to {BIN_LIMIT}, got {_fmt(b['maxbins'])}.")
            if "step" in b and not (is_finite_number(b["step"]) and b["step"] > 0):
                return err(f"{bp}.step", "bad_value", f"{bp}.step must be a positive number (the bin width), got {_fmt(b['step'])}.")
            nums = [to_number(r.get(field)) for r in cur]
            vals = [v for v in nums if v is not None]
            present = sum(1 for r in cur if not _is_missing(r.get(field)))
            if not vals:
                return err(f"{bp}.field", "not_numeric", f'Column "{field}" has no numeric values to bin.', "Bin a numeric column, or convert the values to numbers first.")
            step = float(b["step"]) if "step" in b else None
            if step is not None and (max(vals) - min(vals)) / step > BIN_LIMIT:
                return err(f"{bp}.step", "too_many_bins", f"{bp}.step {_fmt(b['step'])} cuts the values into more than {BIN_LIMIT} bins.", "Use a wider step, or leave it out and set maxbins.")
            if len(vals) < present:
                issues.append({"severity": "warning", "code": "some_not_numeric", "path": f"{bp}.field", "message": f'{present - len(vals)} of {present} values in "{field}" are not numeric; their bin is null.'})
            edges = transform_bin_edges(vals, b.get("maxbins", 10), step)
            s0, s1 = names
            binned: list[Row] = []
            for r, v in zip(cur, nums):
                k = -1 if v is None else bin_index(v, edges)
                binned.append({**r, s0: None if k < 0 else edges[k], s1: None if k < 0 else edges[k + 1]})
            cur = binned
            columns = {**columns, s0: None, s1: None}
        elif op == "window":
            wop = b.get("op")
            if not isinstance(wop, str) or wop not in WINDOW_OPS:
                near = closest(wop, WINDOW_OPS) if isinstance(wop, str) else None
                return err(f"{bp}.op", "missing_required" if "op" not in b else "bad_enum", f"{bp}.op must be one of {', '.join(WINDOW_OPS)}; got {_fmt(wop)}.", f'Did you mean "{near}"?' if near else None)
            field = column("field")
            if field is None:
                return None
            if "as" not in b:
                return err(f"{bp}.as", "missing_required", f'{bp} needs "as" (a name for the new column).')
            if not _is_name(b["as"]):
                return err(f"{bp}.as", "bad_type", f"{bp}.as must be a column name of 1 to 64 characters.")
            group_by = b.get("groupBy")
            if group_by is None:
                group_by = []
            if not isinstance(group_by, list) or len(group_by) > 4 or not all(isinstance(g, str) for g in group_by):
                return err(f"{bp}.groupBy", "bad_type", f"{bp}.groupBy must be an array of at most 4 column names.")
            for gi, g in enumerate(group_by):
                if g not in columns:
                    return no_column(f"{bp}.groupBy[{gi}]", g)
            sort_by = None
            if "sortBy" in b:
                sort_by = column("sortBy")
                if sort_by is None:
                    return None
            if "order" in b and b["order"] not in ("asc", "desc"):
                return err(f"{bp}.order", "bad_enum", f'{bp}.order must be "asc" or "desc".')
            if "frame" in b:
                if not (_is_int(b["frame"]) and 1 <= b["frame"] <= 1000):
                    return err(f"{bp}.frame", "bad_value", f"{bp}.frame must be an integer from 1 to 1000 (rows in the moving window), got {_fmt(b['frame'])}.")
                if wop != "movingMean":
                    issues.append({"severity": "warning", "code": "frame_ignored", "path": f"{bp}.frame", "message": f"{bp}.frame only applies to movingMean; it is ignored for {wop}."})
            if "order" in b and sort_by is None and wop != "rank":
                issues.append({"severity": "warning", "code": "order_ignored", "path": f"{bp}.order", "message": f"{bp}.order needs sortBy; without it the rows keep their order."})
            if sort_by is None and wop == "rank":
                sort_by = field
            cur = _window_rows(cur, wop, field, b["as"], group_by, sort_by, b.get("order") == "desc", int(b.get("frame", 3)))
            columns = {**columns, b["as"]: None}
        else:  # fold
            if "fields" not in b:
                return err(f"{bp}.fields", "missing_required", f'{bp} needs "fields" (the columns to fold into rows).')
            fields = b["fields"]
            if not isinstance(fields, list) or not fields or len(fields) > FOLD_LIMIT or not all(isinstance(f, str) for f in fields):
                return err(f"{bp}.fields", "bad_type", f"{bp}.fields must be an array of 1 to {FOLD_LIMIT} column names.")
            for fi, f in enumerate(fields):
                if f not in columns:
                    return no_column(f"{bp}.fields[{fi}]", f)
                if fields.index(f) != fi:
                    return err(f"{bp}.fields[{fi}]", "duplicate", f'Column "{f}" is listed twice.')
            names = b["as"] if "as" in b else ["key", "value"]
            if not _is_pair(names):
                return err(f"{bp}.as", "bad_type", f"{bp}.as must be two different column names of 1 to 64 characters: [key, value].", 'E.g. ["quarter", "revenue"].')
            if len(cur) * len(fields) > MAX_ROWS:
                return err(bp, "too_many_rows", f"Folding {len(fields)} columns of {len(cur)} rows makes {len(cur) * len(fields)} rows; the limit is {MAX_ROWS}.", "Filter or aggregate first, or fold fewer columns.")
            k, v = names
            drop = set(fields)
            folded: list[Row] = []
            for r in cur:
                rest = {key: r[key] for key in js_keys(r) if key not in drop}
                for f in fields:
                    folded.append({**rest, k: f, v: r.get(f)})
            cur = folded
            columns = {**{c: None for c in columns if c not in drop}, k: None, v: None}
    return cur


def _is_name(v: Any) -> bool:
    return isinstance(v, str) and 1 <= ulen(v) <= 64


def _is_pair(v: Any) -> bool:
    """Two different column names."""
    return isinstance(v, list) and len(v) == 2 and all(_is_name(x) for x in v) and v[0] != v[1]


def _is_int(v: Any) -> bool:
    return is_finite_number(v) and float(v).is_integer()


def _is_missing(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v == "")


def filter_row(f: dict[str, Any]) -> Callable[[Row], bool]:
    """The predicate for one filter step (every test given must hold). Mirrors `filterRow`."""
    field = f["field"]
    rng = f.get("range")
    lo = ordinal(rng[0]) if rng is not None and rng[0] is not None else None
    hi = ordinal(rng[1]) if rng is not None and rng[1] is not None else None
    gt, gte, lt, lte = (ordinal(f[k]) if k in f else None for k in ("gt", "gte", "lt", "lte"))
    one = {js_string(v) for v in f["oneOf"]} if "oneOf" in f else None
    equal = js_string(f["equal"]) if "equal" in f else None
    valid = f.get("valid")
    numeric = "range" in f or gt is not None or gte is not None or lt is not None or lte is not None

    def keep(r: Row) -> bool:
        v = r.get(field)
        if valid is not None and valid == (v is None or (isinstance(v, str) and v == "") or (is_number(v) and not is_finite_number(v))):
            return False
        if equal is not None and _text(r, field) != equal:
            return False
        if one is not None and _text(r, field) not in one:
            return False
        if numeric:
            n = ordinal(v)
            if n is None:
                return False
            if lo is not None and n < lo:
                return False
            if hi is not None and n >= hi:
                return False
            if gt is not None and not n > gt:
                return False
            if gte is not None and not n >= gte:
                return False
            if lt is not None and not n < lt:
                return False
            if lte is not None and not n <= lte:
                return False
        return True

    return keep


def _aggregate(rows: list[Row], group_by: list[str], fields: list[tuple[str, str]], count: str | None) -> list[Row]:
    """One row per distinct combination of the `group_by` values, in order of first appearance. Mirrors `aggregate`."""
    groups: dict[str, list[Row]] = {}
    for r in rows:
        groups.setdefault(json_key([r.get(g) for g in group_by]), []).append(r)
    out: list[Row] = []
    for members in groups.values():
        row: Row = {k: members[0].get(k) for k in group_by}
        for col, op in fields:
            row[col] = _reduce(members, col, op)
        if count:
            row[count] = len(members)
        out.append(row)
    return out


def _reduce(rows: list[Row], col: str, op: str) -> float | int | None:
    """Mirrors `reduce`: count and distinct look at non-empty cells, the rest at numeric ones (null when none)."""
    if op in ("count", "distinct"):
        present = [r[col] for r in rows if r.get(col) is not None and not (isinstance(r[col], str) and r[col] == "")]
        return len(present) if op == "count" else len({js_string(v) for v in present})
    nums = [n for n in (to_number(r.get(col)) for r in rows) if n is not None]
    if not nums:
        return None
    if op in ("sum", "mean"):
        s = 0.0
        for n in nums:  # left to right, as Array.reduce adds (not math.fsum)
            s += n
        return s if op == "sum" else s / len(nums)
    if op == "min":
        return min(nums)
    if op == "max":
        return max(nums)
    s2 = sorted(nums)
    mid = len(s2) >> 1
    return s2[mid] if len(s2) % 2 else (s2[mid - 1] + s2[mid]) / 2


def _sort_rows(rows: list[Row], field: str, desc: bool) -> list[Row]:
    """Stable sort: numbers and dates by value, everything else as text; missing values last. Mirrors `sortRows`."""
    return [rows[i] for i in _sort_order([r.get(field) for r in rows], desc)]


def _sort_order(values: list[Any], desc: bool) -> list[int]:
    """The order (indices) that sorts `values` by the sort step's rule. Mirrors `sortOrder`."""
    keyed = []
    for i, v in enumerate(values):
        keyed.append((i, i, ordinal(v), None if v is None else utf16_key(js_string(v))))

    def compare(a: tuple, b: tuple) -> int:
        if a[3] is None or b[3] is None:
            return a[1] - b[1] if a[3] is b[3] else 1 if a[3] is None else -1
        if a[2] is not None and b[2] is not None:
            c = (a[2] > b[2]) - (a[2] < b[2])
        elif a[2] is not None:
            c = -1
        elif b[2] is not None:
            c = 1
        else:
            c = (a[3] > b[3]) - (a[3] < b[3])
        if desc:
            c = -c
        return c or a[1] - b[1]

    keyed.sort(key=cmp_to_key(compare))
    return [k[0] for k in keyed]


def _text_or_undefined(v: Any, present: bool) -> str:
    return js_string(v) if present else "undefined"


def _window_rows(rows: list[Row], op: str, field: str, target: str, group_by: list[str], sort_by: str | None, desc: bool, frame: int) -> list[Row]:
    """One window step: the op walks each group in `sort_by` order; rows keep their order. Mirrors `windowRows`."""
    groups: dict[str, list[int]] = {}
    for i, r in enumerate(rows):
        groups.setdefault(json_key([r.get(g) for g in group_by]), []).append(i)
    result: list[Any] = [None] * len(rows)
    for idx in groups.values():
        order = idx if sort_by is None else [idx[k] for k in _sort_order([rows[i].get(sort_by) for i in idx], desc)]
        nums = [to_number(rows[i].get(field)) for i in order]
        total = 0.0
        seen = present = 0
        for k, ri in enumerate(order):
            n = nums[k]
            if op == "sum":
                if n is not None:
                    total += n
                result[ri] = total
            elif op == "mean":
                if n is not None:
                    total += n
                    seen += 1
                result[ri] = total / seen if seen else None
            elif op == "count":
                if not _is_missing(rows[ri].get(field)):
                    present += 1
                result[ri] = present
            elif op == "rank":
                key = rows[ri].get(sort_by)  # type: ignore[arg-type]
                if key is None:
                    result[ri] = None
                else:
                    prev = order[k - 1] if k > 0 else None
                    result[ri] = result[prev] if prev is not None and _rank_tie(rows[prev], rows[ri], sort_by) else k + 1  # type: ignore[arg-type]
            elif op == "pctChange":
                prev_n = nums[k - 1] if k > 0 else None
                result[ri] = None if n is None or prev_n is None or prev_n == 0 else (n - prev_n) / abs(prev_n)
            elif op == "lag":
                result[ri] = rows[order[k - 1]].get(field) if k > 0 else None
            elif op == "lead":
                result[ri] = rows[order[k + 1]].get(field) if k < len(order) - 1 else None
            else:  # movingMean
                s = 0.0
                c = 0
                for j in range(max(0, k - frame + 1), k + 1):
                    if nums[j] is not None:
                        s += nums[j]  # type: ignore[operator]
                        c += 1
                result[ri] = s / c if c else None
    return [{**r, target: result[i]} for i, r in enumerate(rows)]


def _rank_tie(prev: Row, row: Row, key: str) -> bool:
    """`sameKey(key(prev), key(row))`, where a missing cell is `undefined` (its text is "undefined")."""
    a, b = prev.get(key), row.get(key)
    na, nb = ordinal(a), ordinal(b)
    if na is not None or nb is not None:
        return na == nb
    return _text_or_undefined(a, key in prev) == _text_or_undefined(b, key in row)
