# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 SUPER SOLUTION LABS INC
"""Card references: `ref:<target>?<name>=<value>&...`, the link a chat message uses to point into a card.

COPY of the card reference shell of super-protocol (PR #6, `implementations/python/src/super_protocol/ref.py`,
protocol 0.3.0, not published yet). Replace this module with an import from `super_protocol` once 0.3.0 is on PyPI.
Keep it identical until then: the names, limits and every message are the protocol's, and
`conformance/card-ref.v1.json` holds the protocol's own cases, which this copy and the TypeScript and Go copies
must pass. Only the envelope is copied: what the params mean for a plot is Super Plot's own (`resolve.py`).
"""
from __future__ import annotations

import re
from typing import Any, TypedDict

from ._js import ulen

CARD_REF_SCHEME = "ref"
CARD_REF_LIMITS = {"length": 512, "target": 128, "names": 16, "values": 32, "name": 32, "value": 256}

_TARGET = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
_NAME = re.compile(r"[a-z][A-Za-z0-9_-]{0,31}")
_RAW_VALUE = re.compile(r"(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+")
_UNRESERVED = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-")


class CardRef(TypedDict):
    target: str
    params: dict[str, list[str]]


def _is_object(v: Any) -> bool:
    return isinstance(v, dict)


def _fail(error: str) -> dict[str, Any]:
    return {"ok": False, "error": error}


def _decode(raw: str) -> str | None:
    out = bytearray()
    i = 0
    while i < len(raw):
        if raw[i] == "%":
            out.append(int(raw[i + 1 : i + 3], 16))
            i += 3
        else:
            out.append(ord(raw[i]))
            i += 1
    try:
        return out.decode("utf-8")
    except UnicodeDecodeError:
        return None


_LONE = re.compile("[\ud800-\udfff]")


def _encode(value: str) -> str:
    # A lone surrogate is written as U+FFFD, as JavaScript's TextEncoder does.
    return "".join(chr(b) if b in _UNRESERVED else f"%{b:02X}" for b in _LONE.sub("\ufffd", value).encode("utf-8"))


def parse_card_ref(href: Any) -> dict[str, Any]:
    """Reads a `ref:` link: `{"ok": True, "ref": {...}}` or `{"ok": False, "error": ...}`."""
    if not isinstance(href, str):
        return _fail("a ref must be a string.")
    if ulen(href) > CARD_REF_LIMITS["length"]:
        return _fail(f"a ref is at most {CARD_REF_LIMITS['length']} characters.")
    if not href.startswith(f"{CARD_REF_SCHEME}:"):
        return _fail(f'a ref starts with "{CARD_REF_SCHEME}:".')
    rest = href[len(CARD_REF_SCHEME) + 1 :]
    if "#" in rest:
        return _fail("a ref has no fragment.")
    target, has_query, query = rest.partition("?")
    if _TARGET.fullmatch(target) is None:
        return _fail("a ref target is 1 to 128 letters, digits, dot, underscore, colon or dash, starting with a letter or digit.")
    params: dict[str, list[str]] = {}
    if has_query:
        if query == "":
            return _fail("a ref query is empty.")
        for part in query.split("&"):
            name, has_eq, raw = part.partition("=")
            if not has_eq:
                return _fail("each ref param is name=value.")
            if _NAME.fullmatch(name) is None:
                return _fail("a ref param name is 1 to 32 letters, digits, dash or underscore, starting with a lowercase letter.")
            if _RAW_VALUE.fullmatch(raw) is None:
                return _fail("a ref param value is not empty and uses letters, digits, dot, dash, underscore, tilde or %XX only.")
            value = _decode(raw)
            if value is None:
                return _fail("a ref param value must be valid UTF-8.")
            if ulen(value) > CARD_REF_LIMITS["value"]:
                return _fail(f"a ref param value is at most {CARD_REF_LIMITS['value']} characters.")
            if name not in params:
                if len(params) >= CARD_REF_LIMITS["names"]:
                    return _fail(f"a ref has at most {CARD_REF_LIMITS['names']} param names.")
                params[name] = []
            if len(params[name]) >= CARD_REF_LIMITS["values"]:
                return _fail(f"a ref param has at most {CARD_REF_LIMITS['values']} values.")
            params[name].append(value)
    return {"ok": True, "ref": {"target": target, "params": params}}


def format_card_ref(ref: Any) -> str | None:
    """Writes a reference as a `ref:` link, names in alphabetical order, or None when it breaks a limit."""
    if not _is_object(ref):
        return None
    target = ref.get("target")
    if not isinstance(target, str) or _TARGET.fullmatch(target) is None:
        return None
    params = ref.get("params")
    if not _is_object(params) or len(params) > CARD_REF_LIMITS["names"]:
        return None
    parts: list[str] = []
    for name in sorted(params, key=lambda n: n.encode("utf-16-be", "surrogatepass")):
        values = params[name]
        if _NAME.fullmatch(name) is None or not isinstance(values, list):
            return None
        if len(values) == 0 or len(values) > CARD_REF_LIMITS["values"]:
            return None
        for value in values:
            if not isinstance(value, str) or value == "" or ulen(value) > CARD_REF_LIMITS["value"]:
                return None
            parts.append(f"{name}={_encode(value)}")
    href = f"{CARD_REF_SCHEME}:{target}" + (f"?{'&'.join(parts)}" if parts else "")
    return None if ulen(href) > CARD_REF_LIMITS["length"] else href
