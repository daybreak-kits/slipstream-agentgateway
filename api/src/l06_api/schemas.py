"""Pydantic request/response models for the admin API (v2 contract).

Schemas mirror the domain, not the ORM: api keys carry no quota fields
(ADR-007/011 - balances are prepaid micro-currency on the user), upstream
models carry no price columns (versioned price books hold them), and money is
always integer micro units plus an explicit currency. Transforms arrive as the
§5 storage JSON dict and are parsed by the codec at the router boundary, so
invalid rules never reach storage.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from l05_service.rollout import RevisionStatus


class UpstreamCreate(BaseModel):
    # Honoured when present; otherwise generated server-side from the
    # connection address (ADR-023 #6 / ADR-030). alias is display-only.
    name: str | None = Field(default=None, max_length=255)
    alias: str = Field(default="", max_length=255)
    base_url: str = Field(min_length=1, max_length=512)
    api_style: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=1)
    transforms: dict | None = None
    max_buffer_bytes: int = Field(default=2_097_152, ge=1)


class UpstreamUpdate(BaseModel):
    base_url: str | None = Field(default=None, min_length=1, max_length=512)
    api_style: str | None = Field(default=None, min_length=1, max_length=64)
    api_key: str | None = Field(default=None, min_length=1)
    transforms: dict | None = None
    enabled: bool | None = None


class TargetDraft(BaseModel):
    """One member of a public model, as the console edits it (ticket 10)."""

    model_config = ConfigDict(extra="forbid")

    upstream_model_id: str = Field(min_length=1)
    # AG 1.7 failover: numeric SMALL first; weighted: relative weight.
    priority: int = Field(default=1, ge=0, le=100)
    weight: int = Field(default=0, ge=0, le=1000000)
    when: str = ""


class UpstreamModelCreate(BaseModel):
    upstream_id: str
    name: str = Field(min_length=1, max_length=255)
    model_type: str = "chat"
    # Ticket 10: old-console metadata (default/upstream/manual + capability block).
    model_type_source: str = Field(default="default", pattern=r"^(default|upstream|manual)$")
    parameters: dict | None = None
    enabled: bool = True
    # Ticket 05: optional cost book + markup at creation time.
    cost_input_per_1m: Decimal | None = None
    cost_output_per_1m: Decimal | None = None
    markup: Decimal | None = None


class UpstreamModelPatch(BaseModel):
    """Partial update; omitted fields stay untouched, explicit null clears where allowed."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    model_type: str | None = None
    model_type_source: str | None = None
    parameters: dict | None = None
    enabled: bool | None = None
    # 0 = no cooldown (解除); a future deadline = 冷却.
    cooldown_until_ms: int | None = Field(default=None, ge=0)
    cost_input_per_1m: Decimal | None = None
    cost_output_per_1m: Decimal | None = None
    markup: Decimal | None = None


#: Legacy name used by ticket 05 callers.
UpstreamModelPricePatch = UpstreamModelPatch


class PublicModelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    routing_mode: str = Field(default="failover", pattern=r"^(failover|weighted|conditional)$")
    note: str = ""
    enabled: bool = True
    # Ticket 10: the console creates a public model and its members in one call.
    targets: list[TargetDraft] = Field(default_factory=list)


class PublicModelPatch(BaseModel):
    """One save for the alias row and (optionally) its whole member list (ticket 12).

    targets rides the same PATCH so basic fields, routing_mode, enabled and the
    member re-declaration commit in ONE transaction and validate against the
    final state; omitting it leaves the members untouched.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    routing_mode: str | None = Field(default=None, pattern=r"^(failover|weighted|conditional)$")
    note: str | None = None
    enabled: bool | None = None
    cooldown_until_ms: int | None = Field(default=None, ge=0)
    targets: list[TargetDraft] | None = None


#: Legacy name used by earlier callers.
PublicModelUpdate = PublicModelPatch


class ModelTargetCreate(BaseModel):
    public_model_id: str
    upstream_model_id: str
    priority: int = Field(default=1, ge=0, le=100)
    weight: int = Field(default=0, ge=0, le=1000000)
    when: str = ""


class ModelTargetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    priority: int | None = Field(default=None, ge=0, le=100)
    weight: int | None = Field(default=None, ge=0, le=1000000)
    when: str | None = None
    enabled: bool | None = None


class ModelBulk(BaseModel):
    """Batch availability/delete.

    The model page has no schedule editor, so a `schedule` action is not accepted;
    periodic rules are created through /admin/availability-rules (ADR-004).
    """

    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(min_length=1, max_length=200)
    action: str = Field(pattern=r"^(enable|disable|delete|cooldown|release)$")
    cooldown_until_ms: int | None = Field(default=None, ge=0)


#: Per-entity aliases keep call sites readable; the payload shape is shared.
ModelTargetBulk = ModelBulk
UpstreamModelBulk = ModelBulk
PublicModelBulk = ModelBulk


class AvailabilityRuleCreate(BaseModel):
    kind: str = Field(pattern=r"^(ban|cooldown)$")
    scope: str = Field(pattern=r"^(upstream|upstream_model|public_model|model_target)$")
    scope_id: str
    recurrence: str | None = Field(default=None, pattern=r"^(once|daily|weekly|monthly)$")
    expires_at_ms: int | None = None
    schedule: dict | None = None
    note: str = ""


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # ADR-019: the immutable login name; derived from name when omitted.
    username: str | None = Field(default=None, min_length=1, max_length=128)
    # ADR-019: password is mandatory - provided here or generated server-side
    # (12 chars, upper/lower/digit/symbol), returned once as initial_password.
    password: str | None = Field(default=None, min_length=8, max_length=256)
    balance_micro: int = Field(default=0, ge=0)
    # Ticket 04 hierarchy: omit parent_user_id to hang the user under the
    # caller's node (分销商) or under root D (管理用户).
    parent_user_id: str | None = None
    role: str = Field(default="customer", min_length=1, max_length=32)
    status: str = Field(default="active", pattern=r"^(active|disabled)$")


class UserUpdate(BaseModel):
    """PATCH /admin/users/{id}: partial edit; parent_user_id comes from the body set.

    username is immutable (ADR-019): the router rejects it with 422.
    """

    name: str | None = Field(default=None, min_length=1, max_length=255)
    username: str | None = Field(default=None, min_length=1, max_length=128)
    parent_user_id: str | None = None
    role: str | None = Field(default=None, min_length=1, max_length=32)
    status: str | None = Field(default=None, pattern=r"^(active|disabled)$")


class UserPasswordReset(BaseModel):
    """Admin/agent password reset for another user (permission users:update)."""

    password: str = Field(min_length=8, max_length=256)


class SelfPasswordChange(BaseModel):
    """POST /admin/auth/change-password: verify the old password, then set a new one."""

    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class ApiKeyIssue(BaseModel):
    user_id: str
    length: int = Field(default=64, ge=1, le=128)
    prefix: str = "sk-"
    # ADR-023 display name; defaults to 密钥 N by per-user ordinal.
    name: str | None = Field(default=None, min_length=1, max_length=255)


class ApiKeyRename(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ApiKeyStatusPatch(BaseModel):
    status: str = Field(pattern=r"^(active|disabled)$")


class BalanceTopup(BaseModel):
    amount_micro: int = Field(gt=0)
    currency: str = Field(default="CNY", min_length=1, max_length=8)
    note: str = ""


class BalanceAdjust(BaseModel):
    delta_micro: int
    currency: str = Field(default="CNY", min_length=1, max_length=8)
    note: str = ""


class RefundCreate(BaseModel):
    user_id: str
    amount_micro: int = Field(gt=0)
    currency: str = Field(default="CNY", min_length=1, max_length=8)
    charge_entry_id: str | None = None
    note: str = ""


class UpstreamPriceCreate(BaseModel):
    """One cache price version: the scope key, the item and the price itself.

    ADR-030: the scope key is the upstream model row (upstream_model_id) and
    nothing else - the service rejects a missing key instead of guessing.
    """

    upstream_model_id: str = Field(min_length=1)
    item: str = Field(pattern=r"^(input|output|cache_read|cache_write|request)$")
    unit_price_micro: int = Field(ge=0)
    currency: str = Field(default="CNY", min_length=1, max_length=8)
    effective_from_ms: int | None = None


class FxPut(BaseModel):
    currency: str = Field(min_length=1, max_length=8)
    rate_micro: int = Field(gt=0)
    source: str = "manual"


class RecomputeIn(BaseModel):
    event_ids: list[str] = Field(default_factory=list)


class PriceImportRow(BaseModel):
    """One row of the ADR-020 price JSON import (same shape as an export row).

    id/name locate the existing upstream model (id wins; name only without id).
    Blank price fields (missing / null / "") mean "leave that field untouched"
    - the console batch editor sends blanks for columns it does not edit.
    model_type is accepted so a raw export round-trips, but import never writes
    it (price-only import; enabled/cooldown are rejected outright).
    """

    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    name: str | None = None
    model_type: str | None = None
    cost_input_per_1m: Decimal | None = None
    cost_output_per_1m: Decimal | None = None
    markup: Decimal | None = None

    @field_validator(
        "id", "name", "cost_input_per_1m", "cost_output_per_1m", "markup", mode="before"
    )
    @classmethod
    def _blank_is_untouched(cls, value: object) -> object:
        """The console's 留空 (empty input) travels as ""; treat it like an omitted field."""
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        return value


class PriceImportIn(BaseModel):
    """POST /admin/prices/import body: isomorphic to the GET /admin/prices/export file.

    The router validates through PriceImportIn.model_validate instead of a
    signature annotation on purpose: a request model referenced by FastAPI
    would enter components.schemas and make the committed
    web/src/generated/contract.ts stale. Switching to a typed body parameter is
    a one-line follow-up once web/ can be regenerated in the same change.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    exported_at_ms: int | None = None
    meta: dict | None = None
    upstream_models: list[PriceImportRow] = Field(min_length=1)

    @field_validator("schema_version")
    @classmethod
    def _only_v1(cls, value: int) -> int:
        if value != 1:
            raise ValueError("不支持的 schema_version，当前仅支持 1")
        return value


class RollbackIn(BaseModel):
    revision_id: str


class ApplyIn(BaseModel):
    reason: str = ""


ConfigApplyIn = ApplyIn  # legacy alias


class ConfigRevisionOut(BaseModel):
    """One archived rollout; status is the shared RevisionStatus vocabulary."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    artifact_hash: str
    adapter_id: str
    operator: str
    reason: str
    status: RevisionStatus
    previous_revision_id: str | None
    error_detail: str
    validation_note: str
    created_at_ms: int


class ConfigStatusOut(BaseModel):
    """Data-plane truth plus the active archived revision (ticket 08 / S5)."""

    config_hash: str | None
    process_version: str
    listening: bool
    detail: str
    active_revision: ConfigRevisionOut | None


class SettingOptionOut(BaseModel):
    value: str
    label: str


class SettingFieldOut(BaseModel):
    key: str
    label: str
    description: str
    kind: Literal["text", "number", "select"]
    default: str
    unit: str
    min: int | None
    max: int | None
    options: list[SettingOptionOut]


class SettingGroupOut(BaseModel):
    key: str
    title: str
    description: str
    fields: list[SettingFieldOut]


class SettingsSchemaOut(BaseModel):
    """Machine-readable settings schema; the UI renders itself from this."""

    groups: list[SettingGroupOut]


class RuleCreate(BaseModel):
    """Availability rule payload (ADR-004); validation lives in l05_service."""

    kind: str = Field(pattern=r"^(ban|cooldown)$")
    scope: str = Field(pattern=r"^(upstream|upstream_model|public_model|model_target)$")
    scope_id: str
    recurrence: str | None = Field(default=None, pattern=r"^(once|daily|weekly|monthly)$")
    expires_at_ms: int | None = None
    schedule_json: str | None = None
    note: str = ""


class RulePatch(BaseModel):
    """Partial rule update (ticket 10 added PATCH/DELETE to the rule API)."""

    model_config = ConfigDict(extra="forbid")

    kind: str | None = Field(default=None, pattern=r"^(ban|cooldown)$")
    scope: str | None = Field(
        default=None, pattern=r"^(upstream|upstream_model|public_model|model_target)$"
    )
    scope_id: str | None = None
    recurrence: str | None = Field(default=None, pattern=r"^(once|daily|weekly|monthly)$")
    expires_at_ms: int | None = None
    schedule_json: str | None = None
    note: str | None = None


class UpstreamPatch(BaseModel):
    """Partial upstream update. name (ADR-023 #6 改名路径): a non-blank value
    renames with uniqueness enforced; blank/absent leaves the name untouched.
    alias is display-only and free-form."""

    name: str | None = Field(default=None, max_length=255)
    alias: str | None = Field(default=None, max_length=255)
    base_url: str | None = Field(default=None, min_length=1, max_length=512)
    api_style: str | None = Field(default=None, min_length=1, max_length=64)
    transforms: dict | None = None
    max_buffer_bytes: int | None = Field(default=None, ge=1)
    enabled: bool | None = None


class UpstreamKeyCreate(BaseModel):
    """ADR-026: keys are equal peers - no primary flag to set."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(default="", max_length=64)
    api_key: str = Field(min_length=1)


class UpstreamKeyPatch(BaseModel):
    """ADR-026 ②: label only; is_primary is retired and rejected (extra=forbid)."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=64)


class UpstreamKeyBatchDelete(BaseModel):
    """POST /{id}/keys/batch-delete body: per-key report, last key refused (409 item)."""

    model_config = ConfigDict(extra="forbid")

    ids: list[str] = Field(min_length=1, max_length=20)


class UpstreamKeyTestIn(BaseModel):
    """POST /{id}/keys/test body: per-key probe; optional style override for this call."""

    model_config = ConfigDict(extra="forbid")

    api_style: str | None = Field(default=None, min_length=1, max_length=64)


class UpstreamBatch(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=200)
    action: str = Field(pattern=r"^(enable|disable|delete)$")


class UpstreamProbeIn(BaseModel):
    key_id: str | None = None
    # This probe only: "auto" re-runs ADR-023 detection; a concrete style
    # overrides the stored one without persisting. Absent means use the stored style.
    api_style: str | None = Field(default=None, min_length=1, max_length=64)


class UpstreamModelProbeIn(BaseModel):
    """POST /admin/upstreams/{id}/models/probe body (ticket 05).

    model_ids (stored model row ids) or the single model_id spelling; key_id
    picks one credential, absent means the first key row. extra="forbid" is the
    security boundary made explicit: the request can never supply base_url,
    api_style or an arbitrary credential - those come from stored rows only.
    """

    model_config = ConfigDict(extra="forbid")

    model_id: str | None = Field(default=None, min_length=1, max_length=64)
    model_ids: list[str] = Field(default_factory=list, max_length=200)
    key_id: str | None = Field(default=None, min_length=1, max_length=64)


class TransformSamplePhaseIn(BaseModel):
    """One pasted request/response sample: headers plus a JSON body (null = no body)."""

    model_config = ConfigDict(extra="forbid")

    headers: dict[str, str] = Field(default_factory=dict)
    body: Any = None


class TransformSampleIn(BaseModel):
    """POST /admin/upstreams/{id}/transforms/sample body (ticket 05).

    The rule document is the same §5 storage JSON the PUT/preview endpoints take;
    request/response are pasted samples only. This schema never names a URL, an
    api style or a credential, so the preview cannot reach the real upstream.
    """

    model_config = ConfigDict(extra="forbid")

    transforms: dict
    request: TransformSamplePhaseIn = Field(default_factory=TransformSamplePhaseIn)
    response: TransformSamplePhaseIn = Field(default_factory=TransformSamplePhaseIn)


class UpstreamImportModels(BaseModel):
    names: list[str] = Field(min_length=1, max_length=500)
    model_type: str = "chat"


class CorsPolicyOut(BaseModel):
    allow_origins: list[str]
    allow_credentials: bool
    expose_headers: list[str]
    env_override: str
    note: str


class KeyAuthOut(BaseModel):
    scheme: str
    storage: str
    reveal: str
    failure: str


class LocalRateLimitOut(BaseModel):
    key: str
    type: str
    tokensPerFill: int
    semantics: str


class TransformsDefaultsOut(BaseModel):
    response_header_deletes: list[str]
    response_body_guard: str
    protected_request_headers: list[str]
    forbidden_body_paths: list[str]
    body_paths_note: str
    mount: str


class RoutingOut(BaseModel):
    modes: list[str]
    failover: str
    weighted: str
    conditional: str


class PolicyCountsOut(BaseModel):
    upstreams: int
    public_models: int
    api_keys_active: int
    users: int


class LogQueryTokenOut(BaseModel):
    """One documented log query token (help catalog)."""

    token: str
    meaning: str
    example: str


class LogQuerySyntaxOut(BaseModel):
    """Canonical log query token catalog; the console never hardcodes a copy."""

    tokens: list[LogQueryTokenOut]


class LogAttemptOut(BaseModel):
    """One normalized upstream attempt for a request log (ADR-028)."""

    attempt: int
    upstream_id: str
    upstream_name: str = ""
    upstream_key_seq: int | None = None
    model: str = ""
    status_code: int | None = None
    error_type: str = ""
    error_message: str = ""
    duration_ms: int = 0
    outcome: str = ""
    started_at_ms: int = 0


class LogAttemptsOut(BaseModel):
    """The routing chain of one request log; empty when the adapter had no telemetry."""

    event_id: str
    correlation_key: str = ""
    attempts: list[LogAttemptOut] = Field(default_factory=list)


class CorsConfig(BaseModel):
    """Data-plane browser CORS; rendering is opt-in via enabled."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    allow_origins: list[str] = Field(default_factory=list)
    allow_credentials: bool = False
    expose_headers: list[str] = Field(default_factory=lambda: ["x-request-id"])
    allow_methods: list[str] = Field(default_factory=list)
    allow_headers: list[str] = Field(default_factory=list)
    max_age: int | None = None


class ApiKeyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    mode: Literal["strict"] = "strict"


class LocalRateLimitConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requests_per_minute: int | None = Field(default=None, ge=1)
    tokens_per_minute: int | None = Field(default=None, ge=1)


class TimeoutConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_timeout: str = ""
    backend_request_timeout: str = ""
    response_idle_timeout: str = ""


class TransformationsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_response_header_deletes: list[str] = Field(
        default_factory=lambda: ["server", "x-powered-by"]
    )
    protected_request_headers: list[str] = Field(default_factory=list)


#: agentgateway humantime subset shared with policies.timeout/health durations.
_DURATION_PATTERN = r"^[1-9][0-9]*(ms|s|m|h)$"


class RetryConfig(BaseModel):
    """ADR-024 route-level retry for the implicit LLM route (internal/llm:request).

    agentgateway 1.7 rejects retry inside llm.policies; the renderer emits it as
    a top-level policies[] entry. attempts counts retries after the first try
    (E16: attempts=2 => 3 total upstream attempts), and inter-group failover only
    materialises on the attempt AFTER the primary is marked unhealthy, so
    attempts >= 2 is required in practice.
    """

    model_config = ConfigDict(extra="forbid")

    attempts: int = Field(default=2, ge=1, le=10)
    codes: list[int] = Field(
        default_factory=lambda: [502, 503, 504], min_length=1, max_length=64
    )
    # 400-599 range is enforced by validate_gateway_ir (line-level details.errors);
    # a ValueError raised inside a pydantic validator is not JSON serialisable in
    # the RequestValidationError handler, so bounds stay in the domain layer.
    backoff: str = Field(default="200ms", pattern=_DURATION_PATTERN)
    precondition: str = ""
    condition: str = ""


class HealthConfig(BaseModel):
    """ADR-024 per-model health marks + eviction (llm.models[].health).

    E16/E17: the unhealthy expression alone leaves a 4xx primary in rotation;
    eviction.consecutive_failures is what lets the next priority layer take over.
    Validation pairs this block with 4xx retry codes.
    """

    model_config = ConfigDict(extra="forbid")

    unhealthy_expression: str = Field(min_length=1, max_length=512)
    consecutive_failures: int = Field(default=3, ge=1, le=100)
    duration: str = ""
    restore_health: int = Field(default=0, ge=0)


class PolicyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cors: CorsConfig = Field(default_factory=CorsConfig)
    api_key: ApiKeyConfig = Field(default_factory=ApiKeyConfig)
    local_rate_limit: LocalRateLimitConfig = Field(
        default_factory=LocalRateLimitConfig
    )
    timeout: TimeoutConfig = Field(default_factory=TimeoutConfig)
    transformations: TransformationsConfig = Field(
        default_factory=TransformationsConfig
    )
    retry: RetryConfig | None = None
    health: HealthConfig | None = None


class PolicyConfigIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: PolicyConfig


class RegexRuleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pattern: str = ""
    builtin: str = ""


class GuardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["regex", "webhook"] = "regex"
    action: str = "mask"
    rules: list[RegexRuleIn] = Field(default_factory=list)
    scope: list[str] = Field(default_factory=list)
    rejection_status: int = 0
    rejection_body: str = ""
    webhook_target: str = ""
    failure_mode: Literal["failClosed", "failOpen"] = "failClosed"


class GuardrailConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    streaming: Literal["Disabled", "Enabled"] = "Disabled"
    request: list[GuardIn] = Field(default_factory=list)
    response: list[GuardIn] = Field(default_factory=list)


class GuardrailConfigIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config: GuardrailConfig


class GuardrailItemOut(BaseModel):
    key: str
    supported: bool
    since_version: str
    note: str
    verified: bool


class McpServerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    transport: Literal["sse", "stdio", "http"] = "sse"
    host: str = ""
    url: str = ""
    port: int | None = Field(default=None, ge=1, le=65535)
    path: str = ""
    cmd: str = ""
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)


class McpConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    servers: list[McpServerIn] = Field(default_factory=list)
    port: int | None = Field(default=None, ge=1, le=65535)



# ---------------------------------------------------------------- W4-H models.dev


class AdoptModelsDevResult(BaseModel):
    """One upstream model's 兑入 outcome: per-key filled/skipped-manual/no-match."""

    id: str
    name: str
    matched: bool
    status: str
    provider: str = ""
    model: str = ""
    refreshed: bool = False
    results: dict[str, str] = Field(default_factory=dict)
    filled: list[str] = Field(default_factory=list)
    params_source: str = ""


class AdoptModelsDevBatchResult(BaseModel):
    """Batch (toolbar 同步) summary; `snapshot` carries refresh counts when the
    live fetch succeeded and {} when it degraded to the stored snapshot."""

    refreshed: bool
    snapshot: dict[str, int] = Field(default_factory=dict)
    total: int
    matched: int
    filled_models: int
    filled_keys: int
    no_match: int
    items: list[AdoptModelsDevResult]


class ModelsDevSnapshotStatus(BaseModel):
    """Stored models.dev snapshot summary (console「上次同步」)."""

    models: int
    providers: int
    fetched_at_ms: int


class MyModelParameters(BaseModel):
    """The canonical capability block (same shape as upstream models' parameters);
    no cost/markup key ever appears here (user-facing endpoint)."""

    max_input_tokens: int
    max_output_tokens: int
    reasoning_level: str
    # Ticket 18: declared reasoning levels + default level (空 = 未声明).
    reasoning_levels: list[str] = Field(default_factory=list)
    default_reasoning_level: str = ""
    input_types: list[str]
    output_types: list[str]
    tool_call: bool
    reasoning: bool
    attachment: bool
    structured_output: bool


class MyModelOut(BaseModel):
    """GET /admin/my/models item: one enabled public model's merged parameters."""

    name: str
    model_type: str
    parameters: MyModelParameters
    sources: list[str]

