"""Super Plot for Python: validate chart specs, describe them in words, and the shared statistics.

This is the language-neutral half of Super Plot. Drawing stays in the TypeScript packages; a Python service
validates what an agent wrote, repairs it from the issue list, and writes the chart's alt text.
Behaviour is pinned to the reference implementation by `conformance/plot.v1.json`.
"""
from __future__ import annotations

from .geo import GEO_LIMITS, GEO_PRESETS, Geography, GeographyError, get_geography, list_geographies, match_region, normalize_region, register_geography, unregister_geography
from .isotime import MAX_TIME, MIN_TIME, time_bucket
from .numeric import bin_counts, bin_edges, box_stats, linear_ticks, nice_domain, quantile
from .text import format_percent, format_value
from .transform import AGGREGATE_OPS, TIME_UNITS, TRANSFORM_LIMIT, TRANSFORM_OPS, apply_transform
from .validate import LIMITS, PlotSpecError, Validation, chart_types, describe_plot, fields_of, is_safe_color, require_valid, validate_plot

__all__ = [
    "AGGREGATE_OPS", "GEO_LIMITS", "GEO_PRESETS", "Geography", "GeographyError", "LIMITS", "MAX_TIME", "MIN_TIME", "PlotSpecError", "TIME_UNITS",
    "TRANSFORM_LIMIT", "TRANSFORM_OPS", "Validation", "apply_transform", "bin_counts", "bin_edges", "box_stats",
    "chart_types", "describe_plot", "fields_of", "format_percent", "format_value", "get_geography", "is_safe_color",
    "linear_ticks", "list_geographies", "match_region", "nice_domain", "normalize_region", "quantile",
    "register_geography", "require_valid", "time_bucket", "unregister_geography", "validate_plot",
]
__version__ = "0.3.0"
