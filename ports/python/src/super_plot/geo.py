# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Geographies: the region boundaries a map joins data to. Mirrors `packages/core/src/geo/geography.ts`.

Super Plot ships no boundaries. The host imports the dataset it has chosen with `register_geography`, or a spec
carries a small one inline. Input is GeoJSON (a FeatureCollection) or TopoJSON (a Topology), longitude and latitude
in degrees. Only Polygon and MultiPolygon features become regions.

A port validates and describes; it does not draw. So the rings are checked (and counted against the limits) but not
kept: a region here is its key, its name and whether the source data marks it as disputed.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from importlib import resources
from typing import Any, Callable, Union

from ._js import is_number, number_string, or_empty, uslice
from .numeric import closest

with resources.files(__package__).joinpath("fields.v1.json").open("r", encoding="utf-8") as _f:
    _DEFS: dict[str, Any] = json.load(_f)

GEO_LIMITS: dict[str, int] = _DEFS["geoLimits"]
CAMERA_RANGE: dict[str, list[float]] = _DEFS["camera"]

Issues = list[dict[str, Any]]
Pick = Union[str, Callable[[dict[str, Any], Any], Any]]

# What JavaScript's `String.prototype.trim` and `\s` treat as white space (Python's `str.strip` differs).
_WS = "\t\n\x0b\x0c\r \xa0  -     　﻿"
_TRIM = re.compile(f"^[{_WS}]+|[{_WS}]+$")
_RUNS = re.compile(f"[{_WS}]+")
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
_INDEX = re.compile(r"0|[1-9][0-9]{0,9}")


def js_trim(s: str) -> str:
    return _TRIM.sub("", s)


def normalize_region(v: Any) -> str:
    """The join form of a region value: trimmed, lower case, inner white space collapsed."""
    return _RUNS.sub(" ", js_trim(or_empty(v))).lower()


def _js_keys(d: dict[str, Any]) -> list[str]:
    """`Object.keys`: array-index keys first, in ascending order, then the rest in insertion order."""
    idx = [k for k in d if _INDEX.fullmatch(k) and int(k) < 4294967295]
    if not idx:
        return list(d)
    taken = set(idx)
    return sorted(idx, key=int) + [k for k in d if k not in taken]


def _truthy(v: Any) -> bool:
    """JavaScript truthiness of a JSON value (empty arrays and objects are truthy)."""
    if isinstance(v, (list, dict)):
        return True
    if isinstance(v, float) and v != v:
        return False
    return bool(v)


def _or(*values: Any) -> Any:
    """`a || b || c`."""
    for v in values[:-1]:
        if _truthy(v):
            return v
    return values[-1]


def _nn(*values: Any) -> Any:
    """`a ?? b ?? c`."""
    for v in values:
        if v is not None:
            return v
    return None


@dataclass
class Geography:
    """A set of regions that data can be joined to."""

    name: str
    regions: list[dict[str, Any]]  # {"key", "name", "disputed"}, in file order
    lookup: dict[str, str]  # normalised key, name or alias -> region key
    vertices: int = 0
    attribution: str | None = None
    by_key: dict[str, dict[str, Any]] = field(default_factory=dict)


# Where common open boundary datasets keep their join key and name. Templates only: download the file yourself
# (check its licence and its stance on disputed areas), then `register_geography(name, data, preset)`.
GEO_PRESETS: dict[str, dict[str, Any]] = {
    "natural-earth-admin0": {
        "description": 'Natural Earth admin-0 countries (public domain). Ships "point of view" editions that draw disputed areas as a given country sees them; pick the edition you need.',
        "url": "https://www.naturalearthdata.com/downloads/",
        "key": lambda p, _id: p.get("ISO_A3") if isinstance(p.get("ISO_A3"), str) and p.get("ISO_A3") != "-99" else p.get("ADM0_A3"),
        "name": lambda p, _id: _nn(p.get("NAME"), p.get("ADMIN")),
        "disputed": lambda p, _id: isinstance(p.get("TYPE"), str) and bool(re.search(r"disputed|indeterminate", p["TYPE"], re.I)),
    },
    "natural-earth-admin1": {
        "description": "Natural Earth admin-1 states and provinces (public domain).",
        "url": "https://www.naturalearthdata.com/downloads/",
        "key": lambda p, _id: _nn(p.get("iso_3166_2"), p.get("adm1_code")),
        "name": lambda p, _id: p.get("name"),
    },
    "world-atlas": {
        "description": "The world-atlas TopoJSON files (derived from Natural Earth); ids are ISO 3166-1 numeric codes.",
        "url": "https://github.com/topojson/world-atlas",
        "object": "countries",
        "key": lambda _p, id_: id_,
        "name": lambda p, _id: p.get("name"),
    },
    "geoboundaries": {
        "description": "geoBoundaries (CC BY 4.0, cite it). The CGAZ composite resolves disputed areas by its own documented rule.",
        "url": "https://www.geoboundaries.org/",
        "key": lambda p, _id: _or(p.get("shapeISO"), p.get("shapeGroup"), p.get("shapeID")),
        "name": lambda p, _id: p.get("shapeName"),
        "attribution": "geoBoundaries",
    },
}

_registry: dict[str, Geography] = {}


class GeographyError(ValueError):
    """Raised by `register_geography` when the boundaries are unusable; carries the issues."""

    def __init__(self, issues: Issues):
        errors = [i for i in issues if i["severity"] == "error"]
        super().__init__("\n".join(f"{i['path']}: {i['message']}{' ' + i['hint'] if i.get('hint') else ''}" for i in errors) or "Invalid geography")
        self.issues = issues


def _issue(severity: str, code: str, path: str, message: str, hint: str | None = None) -> dict[str, Any]:
    return {"severity": severity, "code": code, "path": path, "message": message, **({"hint": hint} if hint else {})}


def register_geography(name: str, data: Any, options: dict[str, Any] | str | None = None) -> Issues:
    """Make a geography available to specs by name (`geo: "<name>"`).

    `data` is GeoJSON or TopoJSON (a dict, or a JSON string). `options` may be a preset name, or a dict with any of
    `object` (TopoJSON: which object to read), `key`, `name`, `disputed` (a property name, or a function of
    `(properties, id)`), `aliases` (alias -> key) and `attribution`. Raises `GeographyError` when the data is
    unusable; returns the warnings (skipped features, duplicate keys) otherwise."""
    if not isinstance(name, str) or not _NAME.fullmatch(name):
        raise GeographyError([_issue("error", "bad_value", "name", f'Geography name must be 1-64 letters, digits, ".", "_" or "-", got {json.dumps(name, default=str)}.')])
    opts = GEO_PRESETS.get(options) if isinstance(options, str) else ({} if options is None else options)
    if not isinstance(opts, dict):
        raise GeographyError([_issue("error", "bad_enum", "options", f'Unknown preset "{options}".', f"Presets: {', '.join(GEO_PRESETS)}.")])
    issues: Issues = []
    source = data
    if isinstance(data, str):
        def refuse(_: str) -> Any:
            raise ValueError("NaN and Infinity are not JSON")

        try:
            source = json.loads(data, parse_constant=refuse)
        except ValueError as e:
            raise GeographyError([_issue("error", "invalid_json", "data", f"Geography is not valid JSON: {e}.")]) from None
    geo = read_geography(source, opts, issues, "data", name)
    if geo is None or any(i["severity"] == "error" for i in issues):
        raise GeographyError(issues)
    _registry[name] = geo
    return issues


def unregister_geography(name: str) -> bool:
    return _registry.pop(name, None) is not None


def get_geography(name: str) -> Geography | None:
    return _registry.get(name)


def list_geographies() -> list[dict[str, Any]]:
    """The registered names, their size and a sample of region keys."""
    return [
        {"name": g.name, "regions": len(g.regions), "sample": [{"key": r["key"], "name": r["name"]} for r in g.regions[:12]],
         **({"attribution": g.attribution} if g.attribution else {})}
        for g in _registry.values()
    ]


# ------------------------------------------------------------------------------------------- reading


class _Reader:
    def __init__(self, issues: Issues, path: str):
        self.issues = issues
        self.errors = 0
        self.path = path

    def report(self, severity: str, code: str, path: str, message: str, hint: str | None = None) -> None:
        # Once the error limit is reached nothing more is recorded, warnings included.
        if self.errors >= GEO_LIMITS["maxIssues"]:
            return
        if severity == "error":
            self.errors += 1
        self.issues.append(_issue(severity, code, path, message, hint))


def _finite(v: Any) -> float | None:
    """`typeof v === 'number' && Number.isFinite(v)`, as a float."""
    if not is_number(v):
        return None
    try:
        f = float(v)
    except OverflowError:  # an integer literal beyond a double is Infinity in JavaScript
        return None
    return f if math.isfinite(f) else None


def _pick(p: Pick, props: dict[str, Any], id_: Any) -> Any:
    return p(props, id_) if callable(p) else props.get(p)


def _as_label(v: Any) -> str | None:
    if isinstance(v, str):
        t = js_trim(v)
        return uslice(t, GEO_LIMITS["maxNameLength"]) if t else None
    f = _finite(v)
    return number_string(f) if f is not None else None


def read_geography(source: Any, options: dict[str, Any], issues: Issues, path: str, name: str = "inline") -> Geography | None:
    """Validate and read GeoJSON or TopoJSON. Problems are appended to `issues` with paths under `path`
    (e.g. `geo.features[3].geometry`). Returns None when nothing usable remains."""
    rd = _Reader(issues, path)
    if not isinstance(source, dict):
        rd.report("error", "bad_type", path, f"{path} must be a GeoJSON FeatureCollection or a TopoJSON Topology object.", "Register boundaries with register_geography(name, data) and use the name here.")
        return None
    kind = source.get("type")
    raw: list[dict[str, Any]] | None
    vertices = 0
    if isinstance(kind, str) and kind == "FeatureCollection":
        raw = _read_feature_collection(source, rd)
        if raw is not None:
            vertices = sum(f["vertices"] for f in raw)
    elif isinstance(kind, str) and kind == "Topology":
        t = _read_topology(source, options.get("object"), rd)
        raw, vertices = (None, 0) if t is None else t
    else:
        rd.report("error", "bad_geo", f"{path}.type", f'{path}.type must be "FeatureCollection" (GeoJSON) or "Topology" (TopoJSON).',
                  'Wrap it: {"type":"FeatureCollection","features":[...]}.' if isinstance(kind, str) and kind in ("Feature", "Polygon", "MultiPolygon") else None)
        return None
    if raw is None:
        return None
    if vertices > GEO_LIMITS["maxVertices"]:
        rd.report("error", "too_many_vertices", path, f"The boundaries have {vertices} points; the limit is {GEO_LIMITS['maxVertices']}.", "Simplify them first (for example mapshaper -simplify 10%), or use a coarser edition such as 1:50m or 1:110m.")
        return None
    if len(raw) > GEO_LIMITS["maxRegions"]:
        rd.report("error", "too_many_regions", path, f"{len(raw)} regions; the limit is {GEO_LIMITS['maxRegions']}.", "Split the boundaries into several geographies, or dissolve small regions.")
        return None

    has_key, has_name, has_disputed = options.get("key") is not None, options.get("name") is not None, options.get("disputed") is not None
    regions: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    for f in raw:
        props, fid = f["properties"], f["id"]
        key = _as_label(_pick(options["key"], props, fid) if has_key else _nn(fid, props.get("id"), props.get("name")))
        if key is None:
            rd.report("warning", "geo_no_key", f["path"], f"Feature has no {'value for the key property' if has_key else 'id, properties.id or properties.name'}; it is skipped.", "Give every feature an id, or pass options.key to register_geography.")
            continue
        if key in by_key:
            rd.report("warning", "duplicate_region", f["path"], f'Region key "{key}" appears more than once; the parts are merged.')
            continue
        if not f["polygons"]:  # nothing to draw: the reference drops a region without polygons
            continue
        label = _as_label(_pick(options["name"], props, fid) if has_name else props.get("name"))
        disputed = (_pick(options["disputed"], props, fid) if has_disputed else props.get("disputed")) is True
        region = {"key": key, "name": key if label is None else label, "disputed": disputed}
        regions.append(region)
        by_key[key] = region
    if rd.errors:
        return None
    if not regions:
        rd.report("error", "geo_empty", path, "No usable Polygon or MultiPolygon features.", "A map needs region polygons with longitude/latitude coordinates.")
        return None
    lookup: dict[str, str] = {}
    for r in regions:
        lookup[normalize_region(r["key"])] = r["key"]
        lookup.setdefault(normalize_region(r["name"]), r["key"])
    aliases = options.get("aliases")
    if isinstance(aliases, dict):
        for alias in _js_keys(aliases):
            key = aliases[alias]
            if isinstance(key, str) and key in by_key:
                lookup[normalize_region(alias)] = key
            else:
                rd.report("warning", "bad_alias", f"{path}.aliases.{alias}", f'Alias "{alias}" points at "{key}", which is not a region key.')
    return Geography(name, regions, lookup, vertices, options.get("attribution") or None, by_key)


def _read_feature_collection(fc: dict[str, Any], rd: _Reader) -> list[dict[str, Any]] | None:
    features = fc.get("features")
    if not isinstance(features, list):
        rd.report("error", "bad_geo", f"{rd.path}.features", 'A FeatureCollection needs a "features" array.')
        return None
    out: list[dict[str, Any]] = []
    for i, f in enumerate(features):
        p = f"{rd.path}.features[{i}]"
        if not isinstance(f, dict) or not isinstance(f.get("type"), str) or f["type"] != "Feature":
            rd.report("error", "bad_geo", p, f'{p} must be a {{"type":"Feature"}} object.')
            continue
        props = f["properties"] if isinstance(f.get("properties"), dict) else {}
        g = f.get("geometry")
        if g is None:
            rd.report("warning", "geo_feature_skipped", p, "Feature has no geometry; it is skipped.")
            continue
        if not isinstance(g, dict):
            rd.report("error", "bad_geo", f"{p}.geometry", "geometry must be an object.")
            continue
        kind = g.get("type") if isinstance(g.get("type"), str) else None
        if kind == "Polygon":
            polys: Any = [g.get("coordinates")]
        elif kind == "MultiPolygon":
            polys = g.get("coordinates")
        else:
            rd.report("warning", "geo_feature_skipped", f"{p}.geometry", "This geometry is not a region; it is skipped.", "Maps join data to Polygon and MultiPolygon features. Plot point data with lat/lng columns instead.")
            continue
        read = _read_polys(polys, rd, f"{p}.geometry.coordinates", kind == "Polygon")
        if read is not None:
            out.append({"id": f.get("id"), "properties": props, "polygons": read[0], "vertices": read[1], "path": p})
    return out


def _read_polys(value: Any, rd: _Reader, path: str, single: bool) -> tuple[int, int] | None:
    """(polygons with at least one ring, positions) of a coordinates array; None after an error."""
    if not isinstance(value, list):
        rd.report("error", "bad_geo", path, "coordinates must be nested arrays of [longitude, latitude] positions.")
        return None
    polygons = vertices = 0
    for pi, poly in enumerate(value):
        pp = path if single else f"{path}[{pi}]"
        if not isinstance(poly, list):
            rd.report("error", "bad_geo", pp, "A polygon must be an array of rings.")
            return None
        rings = 0
        for ri, ring in enumerate(poly):
            n = _read_ring(ring, rd, f"{pp}[{ri}]")
            if n is None:
                return None
            # Without its outer ring a polygon's holes mean nothing: skip the polygon.
            if not n and ri == 0:
                break
            if n:
                rings += 1
                vertices += n
        if rings:
            polygons += 1
    return polygons, vertices


def _read_ring(ring: Any, rd: _Reader, path: str) -> int | None:
    """The length of the ring once closed, 0 for a degenerate ring (skipped with a warning); None after an error."""
    if not isinstance(ring, list):
        rd.report("error", "bad_geo", path, "A ring must be an array of [longitude, latitude] positions.")
        return None
    first = last = None
    for k, pos in enumerate(ring):
        lng = _finite(pos[0]) if isinstance(pos, list) and len(pos) >= 2 else None
        lat = _finite(pos[1]) if lng is not None else None
        if lng is None or lat is None:
            rd.report("error", "bad_geo", f"{path}[{k}]", "A position must be [longitude, latitude] with two finite numbers.")
            return None
        if not _check_position(lng, lat, rd, f"{path}[{k}]"):
            return None
        last = (lng, lat)
        if first is None:
            first = last
    return _close_ring(len(ring), first, last, rd, path)


def _check_position(lng: float, lat: float, rd: _Reader, path: str) -> bool:
    if abs(lng) <= 360 and abs(lat) <= 90:
        return True
    projected = abs(lng) > 1000 or abs(lat) > 1000
    rd.report("error", "geo_out_of_range", path, f"Position [{number_string(lng)}, {number_string(lat)}] is not a longitude/latitude in degrees.",
              "This looks like projected coordinates (metres). Re-export the boundaries in WGS 84 (EPSG:4326)." if projected else "Longitude must be within -360..360 and latitude within -90..90; check for swapped values.")
    return False


def _close_ring(n: int, first: Any, last: Any, rd: _Reader, path: str) -> int:
    if n and first != last:
        n += 1
    if n < 4:
        # A sliver left over from simplification: drop it rather than reject a whole file for it.
        rd.report("warning", "geo_bad_ring", path, f"A ring needs at least 4 positions (a closed triangle), got {n}; it is skipped.")
        return 0
    return n


def _to_int32(f: float) -> int:
    n = int(f) & 0xFFFFFFFF
    return n - 0x100000000 if n >= 0x80000000 else n


def _read_topology(t: dict[str, Any], obj_name: Any, rd: _Reader) -> tuple[list[dict[str, Any]], int] | None:
    path = rd.path
    objects = t.get("objects")
    if not isinstance(objects, dict) or not objects:
        rd.report("error", "bad_geo", f"{path}.objects", 'A Topology needs a non-empty "objects" map.')
        return None
    arcs_in = t.get("arcs")
    if not isinstance(arcs_in, list):
        rd.report("error", "bad_geo", f"{path}.arcs", 'A Topology needs an "arcs" array.')
        return None
    names = _js_keys(objects)
    if obj_name is None:
        obj_name = names[0]
    obj = objects.get(obj_name) if isinstance(obj_name, str) else None
    if not isinstance(obj, dict):
        near = closest(obj_name, names) if isinstance(obj_name, str) else None
        rd.report("error", "bad_geo", f"{path}.objects", f'Topology has no object "{obj_name}".', f"{f'Did you mean {chr(34)}{near}{chr(34)}? ' if near else ''}Objects: {', '.join(names)}.")
        return None
    sx = sy = 1.0
    tx = ty = 0.0
    quantized = False
    if "transform" in t:
        tr = t["transform"]
        nums = None
        if isinstance(tr, dict) and isinstance(tr.get("scale"), list) and isinstance(tr.get("translate"), list) and len(tr["scale"]) == 2 and len(tr["translate"]) == 2:
            nums = [_finite(v) for v in tr["scale"] + tr["translate"]]
        if nums is None or any(v is None for v in nums):
            rd.report("error", "bad_geo", f"{path}.transform", 'transform must be {"scale":[sx,sy],"translate":[tx,ty]} with numbers.')
            return None
        sx, sy, tx, ty = nums
        quantized = True
    # Decode every arc once (delta-encoded when quantized).
    arcs: list[list[tuple[float, float]]] = []
    vertices = 0
    for i, a in enumerate(arcs_in):
        p = f"{path}.arcs[{i}]"
        if not isinstance(a, list):
            rd.report("error", "bad_geo", p, "An arc must be an array of positions.")
            return None
        vertices += len(a)
        if vertices > GEO_LIMITS["maxVertices"]:
            return [], vertices
        x = y = 0.0
        out: list[tuple[float, float]] = []
        for k, pos in enumerate(a):
            px = _finite(pos[0]) if isinstance(pos, list) and len(pos) >= 2 else None
            py = _finite(pos[1]) if px is not None else None
            if px is None or py is None:
                rd.report("error", "bad_geo", f"{p}[{k}]", "An arc position must be two finite numbers.")
                return None
            if quantized:
                x += px
                y += py
            else:
                x, y = px, py
            lng = x * sx + tx
            lat = y * sy + ty
            if not _check_position(lng, lat, rd, f"{p}[{k}]"):
                return None
            out.append((lng, lat))
        arcs.append(out)

    def ring_of(ids: Any, p: str) -> int | None:
        """The length of the ring, 0 for a degenerate one; None after an error."""
        if not isinstance(ids, list) or not ids:
            rd.report("error", "bad_geo", p, "A ring must be a non-empty array of arc indexes.")
            return None
        n = 0
        first = last = None
        for k, ref in enumerate(ids):
            f = _finite(ref)
            idx = -1.0
            if f is not None and f.is_integer():
                idx = float(~_to_int32(f)) if f < 0 else f
            if idx < 0 or idx >= len(arcs):
                rd.report("error", "bad_geo", f"{p}[{k}]", f"Arc index {json.dumps(ref)} does not exist (there are {len(arcs)} arcs).")
                return None
            arc = arcs[int(idx)]
            if f < 0:  # type: ignore[operator]
                arc = arc[::-1]
            part = arc[1:] if n else arc
            if part:
                if first is None:
                    first = part[0]
                last = part[-1]
                n += len(part)
        return _close_ring(n, first, last, rd, p)

    def poly_of(rings: Any, p: str) -> int | None:
        """Number of rings kept (0: no polygon); None after an error."""
        if not isinstance(rings, list):
            rd.report("error", "bad_geo", p, "A polygon must be an array of rings.")
            return None
        kept = 0
        for k, r in enumerate(rings):
            n = ring_of(r, f"{p}[{k}]")
            if n is None:
                return None
            if not n and k == 0:
                break
            if n:
                kept += 1
        return kept

    collection = isinstance(obj.get("type"), str) and obj["type"] == "GeometryCollection"
    geoms = obj.get("geometries") if collection else [obj]
    obj_path = f"{path}.objects.{obj_name}"
    if not isinstance(geoms, list):
        rd.report("error", "bad_geo", f"{obj_path}.geometries", 'A GeometryCollection needs a "geometries" array.')
        return None
    features: list[dict[str, Any]] = []
    for i, g in enumerate(geoms):
        p = f"{obj_path}.geometries[{i}]" if collection else obj_path
        if not isinstance(g, dict):
            rd.report("error", "bad_geo", p, "A geometry must be an object.")
            continue
        props = g["properties"] if isinstance(g.get("properties"), dict) else {}
        kind = g.get("type")
        polygons: int | None = None
        if isinstance(kind, str) and kind == "Polygon":
            n = poly_of(g.get("arcs"), f"{p}.arcs")
            polygons = None if n is None else (1 if n else 0)
        elif isinstance(kind, str) and kind == "MultiPolygon":
            if not isinstance(g.get("arcs"), list):
                rd.report("error", "bad_geo", f"{p}.arcs", "A MultiPolygon needs an array of polygons.")
                continue
            polygons = 0
            for k, part in enumerate(g["arcs"]):
                n = poly_of(part, f"{p}.arcs[{k}]")
                if n is None:
                    polygons = None
                    break
                polygons += 1 if n else 0
        elif kind is None:
            rd.report("warning", "geo_feature_skipped", p, "Geometry has no type; it is skipped.")
            continue
        else:
            rd.report("warning", "geo_feature_skipped", p, "This geometry is not a region; it is skipped.")
            continue
        if polygons is not None:
            features.append({"id": g.get("id"), "properties": props, "polygons": polygons, "vertices": 0, "path": p})
    return features, vertices


def resolve_geo(value: Any, issues: Issues, path: str = "geo") -> Geography | None:
    """Resolve a spec's `geo` value: a registered name or an inline object."""
    if isinstance(value, str):
        g = _registry.get(value)
        if g:
            return g
        names = list(_registry)
        near = closest(value, names)
        issues.append(_issue(
            "error", "unknown_geography", path, f'No geography named "{value}" is registered.',
            f"{f'Did you mean {chr(34)}{near}{chr(34)}? ' if near else ''}Registered: {', '.join(names[:20])}." if names
            else "Super Plot ships no boundaries. Import the dataset you have chosen with register_geography(name, geojson_or_topojson, preset), or put a small FeatureCollection inline."))
        return None
    return read_geography(value, {}, issues, path)


def match_region(geo: Geography, value: Any) -> str | None:
    """Match a data value to a region key (key, name or alias; case and spacing ignored)."""
    return geo.lookup.get(normalize_region(value))
