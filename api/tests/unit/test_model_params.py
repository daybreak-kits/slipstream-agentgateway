"""W9: reasoning-level vocabulary — models.dev effort values include minimal.

models.dev reasoning_options of type "effort" publish values like
none/minimal/low/medium/high/xhigh/max. The control plane used to omit
"minimal"; these tests pin the extended canonical order and the existing
validation (unknown levels still rejected, default must be declared).
"""

from __future__ import annotations

import json

import pytest

from l01_core.errors import AppError
from l05_service import model_params


def test_reasoning_levels_include_minimal_in_canonical_order():
    assert model_params.REASONING_LEVELS == (
        "default",
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    )


def test_canonical_parameters_accepts_minimal():
    raw = model_params.canonical_parameters(
        {
            "reasoning_levels": ["default", "minimal", "high"],
            "default_reasoning_level": "minimal",
        }
    )
    decoded = json.loads(raw)
    assert decoded["reasoning_levels"] == ["default", "minimal", "high"]
    assert decoded["default_reasoning_level"] == "minimal"


def test_canonical_parameters_still_rejects_unknown_levels():
    with pytest.raises(AppError):
        model_params.canonical_parameters({"reasoning_levels": ["minimal", "ultra"]})


def test_canonical_parameters_still_requires_default_inside_declared():
    with pytest.raises(AppError):
        model_params.canonical_parameters(
            {
                "reasoning_levels": ["minimal", "high"],
                "default_reasoning_level": "max",
            }
        )
