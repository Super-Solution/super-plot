"""Super Plot for Python: validate chart specs, describe them in words, and the shared statistics.

This is the language-neutral half of Super Plot. Drawing stays in the TypeScript packages; a Python service
validates what an agent wrote, repairs it from the issue list, and writes the chart's alt text.
Behaviour is pinned to the reference implementation by `conformance/plot.v1.json`.
"""
from __future__ import annotations

from .numeric import bin_counts, bin_edges, box_stats, linear_ticks, nice_domain, quantile
from .text import format_percent, format_value
from .validate import LIMITS, PlotSpecError, Validation, chart_types, describe_plot, fields_of, is_safe_color, require_valid, validate_plot

__all__ = [
    "LIMITS", "PlotSpecError", "Validation", "bin_counts", "bin_edges", "box_stats", "chart_types", "describe_plot",
    "fields_of", "format_percent", "format_value", "is_safe_color", "linear_ticks", "nice_domain", "quantile",
    "require_valid", "validate_plot",
]
__version__ = "0.1.0"
