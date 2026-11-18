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

DEFAULT_PARAMETERS: dict[str, Any] = {
    "max_input_tokens": 0,
    "max_output_tokens": 0,
    "reasoning_level": "",
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
