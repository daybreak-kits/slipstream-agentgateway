"""CORS origin resolution for the control-plane admin API.

Lives in l01 so both the app factory (l06) and the IR policy block (l05) can use
the same list without a service-to-API dependency.
"""

from __future__ import annotations

import os

DEFAULT_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


def cors_origins() -> list[str]:
    """Browser origins allowed to call the admin API (dev Vite + env additions)."""

    origins = list(DEFAULT_ORIGINS)
    for item in os.environ.get("SLIPSTREAM_CORS_ORIGINS", "").split(","):
        item = item.strip()
        if item and item not in origins:
            origins.append(item)
    # "*" opens everything (dev convenience); credentials stay off, so it is safe.
    return ["*"] if "*" in origins else origins
