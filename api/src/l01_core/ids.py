"""Prefixed unique id helpers for every control-plane entity."""

from __future__ import annotations

import uuid


def new_id(prefix: str = "") -> str:
    """32-hex uuid4 id with an optional snake prefix, e.g. `rev_ab12...`."""
    raw = uuid.uuid4().hex
    return f"{prefix}{raw}" if prefix else raw
