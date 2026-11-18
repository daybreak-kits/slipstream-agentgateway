"""CORS origin resolution (kept out of app.py to avoid router circular imports)."""

from __future__ import annotations

import os


def cors_origins() -> list[str]:
    """Browser origins allowed to call the admin API (dev Vite + env additions)."""

    origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
    for item in os.environ.get("SLIPSTREAM_CORS_ORIGINS", "").split(","):
        item = item.strip()
        if item and item not in origins:
            origins.append(item)
    # "*" opens everything (dev convenience); credentials stay off, so it is safe.
    return ["*"] if "*" in origins else origins
