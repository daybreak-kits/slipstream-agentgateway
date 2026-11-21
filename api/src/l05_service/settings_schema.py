"""Single-source declaration for editable app settings (architecture review #6).

The backend owns every machine-readable fact about a setting: key, group,
label, description, widget kind, default, bounded range, options and the
validation rule that PUT applies. The frontend fetches GET
/admin/settings/schema and only keeps presentation choices (section layout,
copy tone); it never carries its own field table again.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

from l01_core.errors import AppError, ErrorCode

WidgetKind = Literal["text", "number", "select"]
ValueType = Literal["text", "int", "currency", "url"]


@dataclass(frozen=True, slots=True)
class SettingOption:
    value: str
    label: str


@dataclass(frozen=True, slots=True)
class SettingField:
    key: str
    label: str
    description: str
    kind: WidgetKind
    value_type: ValueType
    default: str
    unit: str = ""
    min: int | None = None
    max: int | None = None
    options: tuple[SettingOption, ...] = ()


@dataclass(frozen=True, slots=True)
class SettingGroup:
    key: str
    title: str
    description: str
    fields: tuple[SettingField, ...]


_CURRENCY_OPTIONS = (
    SettingOption("CNY", "CNY 人民币"),
    SettingOption("USD", "USD 美元"),
)
_TIMEZONE_OPTIONS = (
    SettingOption("Asia/Shanghai", "Asia/Shanghai（UTC+8）"),
    SettingOption("Asia/Singapore", "Asia/Singapore（UTC+8）"),
    SettingOption("Asia/Tokyo", "Asia/Tokyo（UTC+9）"),
    SettingOption("UTC", "UTC"),
)

SETTING_GROUPS: tuple[SettingGroup, ...] = (
    SettingGroup(
        key="money",
        title="计量与货币",
        description="账本与用量一律按整数 micro 记账；本币种只影响报表与账单展示。",
        fields=(
            SettingField(
                key="base_currency",
                label="基准币",
                description="报表与账单的展示币种。USD 仅用于展示，请求级强制仍按账本 micro 记账。",
                kind="select",
                value_type="currency",
                default="CNY",
                options=_CURRENCY_OPTIONS,
            ),
        ),
    ),
    SettingGroup(
        key="time",
        title="时区与时间",
        description="入库时间统一毫秒 epoch；这里只决定界面与报表的渲染时区。",
        fields=(
            SettingField(
                key="timezone",
                label="展示时区",
                description="影响报表日期切分与时间展示，不改变入库时间戳。",
                kind="select",
                value_type="text",
                default="Asia/Shanghai",
                options=_TIMEZONE_OPTIONS,
            ),
        ),
    ),
    SettingGroup(
        key="logs",
        title="日志与留存",
        description="请求日志、审计与账本的保留周期；超期数据按天滚动清理。",
        fields=(
            SettingField(
                key="log_retention_days",
                label="请求日志保留",
                description="usage_events / 请求日志的保留天数。",
                kind="number",
                value_type="int",
                default="30",
                unit="天",
                min=1,
                max=365,
            ),
            SettingField(
                key="audit_retention_days",
                label="审计日志保留",
                description="审计与账本属于合规数据，默认保留更久。",
                kind="number",
                value_type="int",
                default="180",
                unit="天",
                min=7,
                max=3650,
            ),
            SettingField(
                key="ag_access_log_llm",
                label="请求正文记录",
                description=(
                    "ADR-021：数据面请求日志是否保存 prompt/补全正文。metadata 只存元数据"
                    "（默认，隐私与磁盘的保守选择）；full 额外存正文，随保留周期一并清理，"
                    "开启时注意存储与敏感信息风险。"
                ),
                kind="select",
                value_type="text",
                default="metadata",
                options=(
                    SettingOption("metadata", "metadata（仅元数据，不存正文）"),
                    SettingOption("full", "full（连同正文一起存）"),
                ),
            ),
        ),
    ),
    SettingGroup(
        key="limits",
        title="默认限流参数",
        description="新建客户端密钥 / 用户时的默认限流；单个密钥可在客户端密钥页覆盖。",
        fields=(
            SettingField(
                key="default_tokens_per_minute",
                label="默认 Token 限速（每密钥）",
                description="新建密钥默认的 token 每分钟配额；0 表示不限制。",
                kind="number",
                value_type="int",
                default="60000",
                unit="token / min",
                min=0,
                max=1_000_000,
            ),
            SettingField(
                key="default_concurrency",
                label="默认并发上限（每密钥）",
                description="新建密钥默认的并发请求上限；0 表示不限制。",
                kind="number",
                value_type="int",
                default="8",
                unit="并发",
                min=0,
                max=1_000,
            ),
        ),
    ),
    SettingGroup(
        key="connection",
        title="连接地址",
        description="所有控制台用户共用的接入地址；留空跟随浏览器当前 host + 3600 端口。",
        fields=(
            SettingField(
                key="gateway_base_url",
                label="公网连接地址",
                description=(
                    "留空 = 自动取浏览器当前 host + 3600；必须 http(s) 且带主机名，"
                    "不能含账号密码/查询参数/锚点。"
                ),
                kind="text",
                value_type="url",
                default="",
            ),
        ),
    ),
)

SETTING_FIELDS: dict[str, SettingField] = {
    field.key: field for group in SETTING_GROUPS for field in group.fields
}


def default_text(key: str) -> str:
    """Display fallback for a key that has no row in app_settings."""
    return SETTING_FIELDS[key].default


def wire_groups() -> list[dict[str, Any]]:
    """The machine-readable schema shape served by GET /admin/settings/schema."""
    return [
        {
            "key": group.key,
            "title": group.title,
            "description": group.description,
            "fields": [
                {
                    "key": field.key,
                    "label": field.label,
                    "description": field.description,
                    "kind": field.kind,
                    "default": field.default,
                    "unit": field.unit,
                    "min": field.min,
                    "max": field.max,
                    "options": [
                        {"value": option.value, "label": option.label}
                        for option in field.options
                    ],
                }
                for field in group.fields
            ],
        }
        for group in SETTING_GROUPS
    ]


def _validate_base_url(key: str, text: str) -> str:
    """Public Base URL: http(s) + hostname, no credentials/query/fragment; empty = auto."""
    stripped = text.strip()
    if not stripped:
        return ""
    if any(ch.isspace() for ch in stripped):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"{key} must be an absolute http(s) URL with a hostname",
            details={"key": key, "value": text},
        )
    try:
        parsed = urlsplit(stripped)
        port = parsed.port
    except ValueError:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"{key} must be an absolute http(s) URL with a hostname",
            details={"key": key, "value": text},
        ) from None
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"{key} must be an absolute http(s) URL with a hostname",
            details={"key": key, "value": text},
        )
    if port is not None and not 1 <= port <= 65535:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"{key} has an invalid port",
            details={"key": key, "value": text},
        )
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"{key} must not contain credentials, query or fragment",
            details={"key": key, "value": text},
        )
    return stripped.rstrip("/")


def coerce_setting(key: str, value: Any) -> str:
    """Validate one incoming value; returns the string stored in app_settings.

    This is the only authority for setting validation: the HTTP layer just
    forwards to it, and the schema test drives every field through it.
    """
    field = SETTING_FIELDS.get(key)
    if field is None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown setting key: {key}",
            details={"key": key},
        )
    if field.value_type != "int" and not isinstance(value, str):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"{key} must be a string",
            details={"key": key, "value": value},
        )
    text = value if isinstance(value, str) else str(value)
    if field.value_type == "int":
        try:
            number = int(text.strip())
        except (TypeError, ValueError):
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"{key} must be an integer",
                details={"key": key, "value": value},
            ) from None
        if field.min is not None and number < field.min:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"{key} must be >= {field.min}",
                details={"key": key, "value": value},
            )
        if field.max is not None and number > field.max:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"{key} must be <= {field.max}",
                details={"key": key, "value": value},
            )
        return str(number)
    if field.value_type == "currency":
        upper = text.strip().upper()
        allowed = tuple(option.value for option in field.options)
        if upper not in allowed:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"{key} must be one of {allowed}",
                details={"key": key, "value": value},
            )
        return upper
    if field.value_type == "url":
        return _validate_base_url(key, text)
    stripped = text.strip()
    if field.kind == "select":
        allowed = tuple(option.value for option in field.options)
        if stripped not in allowed:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"{key} must be one of {allowed}",
                details={"key": key, "value": value},
            )
        return stripped
    if not stripped:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"{key} must not be empty",
            details={"key": key, "value": value},
        )
    return stripped
