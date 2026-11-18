"""Process logging setup (stdlib logging only; level from SLIPSTREAM_LOG_LEVEL)."""

from __future__ import annotations

import logging

_FORMAT = "%(asctime)s %(levelname)-7s %(name)s %(message)s"


def setup_logging(level: str = "INFO") -> None:
    """Idempotent root-logger configuration for both uvicorn and job processes."""
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO), format=_FORMAT)
