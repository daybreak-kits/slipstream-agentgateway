"""Upstream-model metadata from the old console: capability block + type source.

The old channel-model editor declared what a model can do (max input/output
tokens, reasoning level, modalities, capability flags) next to its costs. The new
control plane keeps exactly that as control-plane metadata: AG 1.7 has no
per-model params slot in our IR, so nothing here is rendered into the data plane.
`0` means "未声明" (old semantics); modality lists always keep at least one entry.
"""

from __future__ import annotations

import json
from typing import Any

from l01_core.errors import AppError, ErrorCode

#: Values the old console stored; "auto" was a command, never a stored value.
TYPE_SOURCES = ("default", "upstream", "manual")
INPUT_TYPES = ("text", "image", "audio", "video", "file")
OUTPUT_TYPES = ("text", "image", "audio", "embedding")
MAX_TOKEN_LIMIT = 100_000_000

#: Full reasoning effort level set (ticket 18, extended W9 with "minimal" to
#: mirror models.dev effort values); "default" means 不传 — the playground relay
#: drops it instead of forwarding (routers_ops.py). Keep this tuple in the
#: canonical low->high order: models.dev reasoning_options are normalized to it.
REASONING_LEVELS = (
    "default",
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
)

DEFAULT_PARAMETERS: dict[str, Any] = {
    "max_input_tokens": 0,
    "max_output_tokens": 0,
    "reasoning_level": "",
    "reasoning_levels": [],
    "default_reasoning_level": "",
    "input_types": ["text"],
    "output_types": ["text"],
    "tool_call": False,
    "reasoning": False,
    "attachment": False,
    "structured_output": False,
}

FIELDS = tuple(DEFAULT_PARAMETERS)
BOOL_FIELDS = ("tool_call", "reasoning", "attachment", "structured_output")


def validate_type_source(value: str) -> str:
    if value not in TYPE_SOURCES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"未知的模型类型来源: {value}",
            details={"known": list(TYPE_SOURCES)},
        )
    return value


def decode_parameters(raw: str | None) -> dict[str, Any]:
    """Stored JSON -> complete dict; missing/unknown keys fall back to defaults."""
    result: dict[str, Any] = {
        key: (list(value) if isinstance(value, list) else value)
        for key, value in DEFAULT_PARAMETERS.items()
    }
    if not raw:
        return result
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return result
    if not isinstance(parsed, dict):
        return result
    for key in FIELDS:
        if key in parsed:
            result[key] = parsed[key]
    return result


def canonical_parameters(payload: dict | None) -> str:
    """Validate one parameters block and return canonical storage JSON."""
    data = decode_parameters(None)
    if payload:
        unknown = sorted(set(payload) - set(FIELDS))
        if unknown:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"未知的模型参数: {', '.join(unknown)}",
                details={"known": list(FIELDS)},
            )
        data.update({key: payload[key] for key in FIELDS if key in payload})
    data["max_input_tokens"] = _token_limit(data["max_input_tokens"], "max_input_tokens")
    data["max_output_tokens"] = _token_limit(data["max_output_tokens"], "max_output_tokens")
    data["reasoning_level"] = _reasoning_level(data["reasoning_level"])
    data["reasoning_levels"] = _reasoning_levels(data["reasoning_levels"])
    data["default_reasoning_level"] = _default_reasoning_level(
        data["default_reasoning_level"], data["reasoning_levels"]
    )
    data["input_types"] = _modalities(data["input_types"], "input_types", INPUT_TYPES)
    data["output_types"] = _modalities(data["output_types"], "output_types", OUTPUT_TYPES)
    for flag in BOOL_FIELDS:
        if not isinstance(data[flag], bool):
            raise AppError(ErrorCode.VALIDATION_ERROR, f"{flag} 必须是布尔值")
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _token_limit(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise AppError(ErrorCode.VALIDATION_ERROR, f"{field} 必须是整数（0 = 未声明）")
    if value < 0 or value > MAX_TOKEN_LIMIT:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"{field} 必须在 0..{MAX_TOKEN_LIMIT} 之间"
        )
    return value


def _reasoning_level(value: object) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > 32:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, "reasoning_level 必须是不超过 32 字符的字符串"
        )
    return value


def _reasoning_levels(value: object) -> list[str]:
    """声明的思考档位集合；空 = 未声明，选择器回退全部档位。"""
    if value is None:
        return []
    if not isinstance(value, list):
        raise AppError(ErrorCode.VALIDATION_ERROR, "reasoning_levels 必须是字符串列表")
    ordered: list[str] = []
    for item in value:
        if item not in REASONING_LEVELS:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"reasoning_levels 含未知档位: {item!r}",
                details={"known": list(REASONING_LEVELS)},
            )
        if item not in ordered:
            ordered.append(item)
    return ordered


def _default_reasoning_level(value: object, declared: list[str]) -> str:
    """默认档；非空时必须是已知档位，且落在声明的档位集合内。"""
    if value is None or value == "":
        return ""
    if not isinstance(value, str) or value not in REASONING_LEVELS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"default_reasoning_level 含未知档位: {value!r}",
            details={"known": list(REASONING_LEVELS)},
        )
    if declared and value not in declared:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "default_reasoning_level 必须在 reasoning_levels 内",
            details={"declared": declared},
        )
    return value


def _modalities(value: object, field: str, allowed: tuple[str, ...]) -> list[str]:
    if value is None:
        return [allowed[0]]
    if not isinstance(value, list) or not value:
        raise AppError(ErrorCode.VALIDATION_ERROR, f"{field} 至少需要 1 个取值")
    ordered: list[str] = []
    for item in value:
        if item not in allowed:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"{field} 含未知取值: {item!r}",
                details={"known": list(allowed)},
            )
        if item not in ordered:
            ordered.append(item)
    if not ordered:
        raise AppError(ErrorCode.VALIDATION_ERROR, f"{field} 至少需要 1 个取值")
    return ordered
