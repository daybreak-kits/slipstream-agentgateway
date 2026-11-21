"""Gateway-agnostic IR: the ONLY contract shared with the adapter layer.

Shape documented in docs/contracts/ir-and-rendering.md. v2 aligns with
agentgateway 1.7: upstream models are rendered as llm.models[] (internal by
default), public models as llm.virtualModels[] routing targets, policies carry
only what the data plane can actually express, and MCP targets are top-level.
No gateway nouns: CEL compilation happens in l03_adapters.
"""

from __future__ import annotations

from dataclasses import dataclass, field

IR_VERSION = "v2"

HEADER_SEGMENTS = ("request_headers", "response_headers")
BODY_SEGMENTS = ("request_body", "response_body")
SEGMENTS = HEADER_SEGMENTS + BODY_SEGMENTS
# ADR-009: one verb set shared by all four segments (set/add/remove/rename are gone).
UNIFIED_OPS = (
    "create",
    "update",
    "delete",
    "copy",
    "prepend",
    "append",
    "regex_replace",
    "to_upper",
    "to_lower",
)
BODY_OPS = UNIFIED_OPS
HEADER_OPS = UNIFIED_OPS
CONDITION_MODES = ("full", "regex", "gt", "gte", "lt", "lte")
# ADR-014: exactly one routing mode per public model; the modes are mutually
# exclusive in the IR and in the rendered config.
ROUTING_MODES = ("failover", "weighted", "conditional")
VISIBILITIES = ("public", "internal")
GUARD_ACTIONS = ("mask", "reject", "audit")
GUARD_SCOPES = ("systemPrompt", "messages", "toolOutput", "toolInput")
BUILTIN_GUARD_RULES = ("ssn", "creditCard", "phoneNumber", "email", "caSin")
GUARD_STREAMING = ("Disabled", "Enabled")
MCP_TRANSPORTS = ("sse", "stdio", "http")
GUARD_KINDS = ("regex", "webhook")
WEBHOOK_GUARD_ACTIONS = ("reject", "audit")
WEBHOOK_FAILURE_MODES = ("failClosed", "failOpen")
API_KEY_MODES = ("strict",)
MCP_PREFIX_MODES = ("conditional", "always", "never")
PROTECTED_HEADERS = (
    "authorization",
    "api-key",
    "x-api-key",
    "cookie",
    "set-cookie",
    "content-type",
    "content-length",
    "host",
    "x-request-id",
)


@dataclass(frozen=True, slots=True)
class RewriteCondition:
    """One predicate line: field compared per mode; modes AND together."""

    field: str
    mode: str
    value: str


@dataclass(frozen=True, slots=True)
class HeaderRule:
    """One rewrite row for request_headers/response_headers (verbs per ADR-009).

    copy: source_name -> target_name; string ops read/rewrite the header value.
    """

    op: str
    name: str
    value: str = ""
    source_name: str = ""
    target_name: str = ""
    regex: str = ""
    replacement: str = ""
    conditions: tuple[RewriteCondition, ...] = ()


@dataclass(frozen=True, slots=True)
class BodyRule:
    """One rewrite row for request_body/response_body; path uses dot notation a.b.0.c."""

    op: str
    path: str = ""
    value: str = ""
    source_path: str = ""
    target_path: str = ""
    regex: str = ""
    replacement: str = ""
    conditions: tuple[RewriteCondition, ...] = ()


@dataclass(frozen=True, slots=True)
class TransformsSpec:
    """Structured rewrite rules per segment (transforms-compiler.md v2 §5)."""

    request_headers: tuple[HeaderRule, ...] = ()
    request_body: tuple[BodyRule, ...] = ()
    response_headers: tuple[HeaderRule, ...] = ()
    response_body: tuple[BodyRule, ...] = ()


@dataclass(frozen=True, slots=True)
class UpstreamSpec:
    """One callable access point; key lives in a file, never inline (invariant 6).

    max_buffer_bytes has no agentgateway 1.7 config surface; the adapter warns
    when a non-default value cannot be rendered instead of silently dropping it.
    """

    id: str
    base_url: str
    api_style: str
    key_file: str
    transforms: TransformsSpec | None = None
    max_buffer_bytes: int = 2097152
    extra_headers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class PromptCachingSpec:
    """agentgateway PromptCaching fields (enabled is not a field)."""

    cache_system: bool = False
    cache_messages: bool = False
    cache_tools: bool = False
    min_tokens: int = 0
    cache_message_offset: int = 0


@dataclass(frozen=True, slots=True)
class RegexRuleSpec:
    """agentgateway RegexRules rule: a literal pattern XOR a builtin detector."""

    pattern: str = ""
    builtin: str = ""


@dataclass(frozen=True, slots=True)
class GuardSpec:
    """One request/response guard block (regex or webhook backend).

    agentgateway 1.7 webhook guards reject scope (they always inspect
    systemPrompt + messages), only allow reject/audit and take a host target
    without a path.
    """

    action: str = "mask"
    rules: tuple[RegexRuleSpec, ...] = ()
    scope: tuple[str, ...] = ()
    rejection_status: int = 0
    rejection_body: str = ""
    kind: str = "regex"
    webhook_target: str = ""
    failure_mode: str = "failClosed"


@dataclass(frozen=True, slots=True)
class PromptGuardSpec:
    """PromptGuard: streaming toggle plus request/response guard lists."""

    streaming: str = "Disabled"
    request: tuple[GuardSpec, ...] = ()
    response: tuple[GuardSpec, ...] = ()


@dataclass(frozen=True, slots=True)
class UpstreamModelSpec:
    """One llm.models[] entry; visibility defaults to internal (E4/E5)."""

    id: str
    upstream_id: str
    upstream_model_name: str
    model_type: str
    display_name: str = ""
    visibility: str = "internal"
    guardrails: PromptGuardSpec | None = None
    prompt_caching: PromptCachingSpec | None = None
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class TargetSpec:
    """A binding inside one public model (ADR-014 routing modes).

    failover: priority >= 0, numeric SMALL wins (agentgateway official
    semantics); equal values form one group, groups are tried in ascending
    order. weighted: weight >= 1 (priority ignored, validator warns).
    conditional: when = CEL predicate, empty only allowed on the last target.
    """

    id: str
    upstream_model_id: str
    priority: int
    display_name: str = ""
    weight: int = 0
    when: str = ""


@dataclass(frozen=True, slots=True)
class PublicModelSpec:
    """The only name clients may address; routing_mode picks the target semantics."""

    name: str
    targets: tuple[TargetSpec, ...]
    routing_mode: str = "failover"


@dataclass(frozen=True, slots=True)
class ClientKeySpec:
    """Client credential reference: hash only in the data plane (ADR-008 item 4)."""

    id: str
    key_hash: str
    user_id: str = ""
    enabled: bool = True
    key_suffix: str = ""


@dataclass(frozen=True, slots=True)
class UserBalanceSpec:
    """Prepaid token balance per user (ADR-007); the control-plane value is authoritative.

    agentgateway 1.7 cannot vary maxTokens per API key (E12), so this value is
    NEVER rendered as a localRateLimit bucket; the ledger enforces it.
    """

    id: str
    balance_tokens: int = 0


@dataclass(frozen=True, slots=True)
class LimitsSpec:
    """Global rate limits rendered as llm.policies.localRateLimit[] rules."""

    requests_per_minute: int | None = None
    tokens_per_minute: int | None = None
    budget_usd: float | None = None


@dataclass(frozen=True, slots=True)
class CorsPolicySpec:
    """Browser CORS. The admin API uses control-plane CORS; the data plane only
    renders this when PoliciesSpec.data_plane_cors is explicitly set."""

    allow_origins: tuple[str, ...] = ()
    allow_credentials: bool = False
    expose_headers: tuple[str, ...] = ("x-request-id",)
    allow_methods: tuple[str, ...] = ()
    allow_headers: tuple[str, ...] = ()
    max_age: int | None = None


@dataclass(frozen=True, slots=True)
class ApiKeyPolicySpec:
    """Client credential contract enforced at the data plane (E4/E11).

    enabled=False is a deliberate operator toggle (anonymous access); the
    renderer then omits llm.policies.apiKey instead of dropping the keys.
    """

    scheme: str = "Authorization: Bearer sk-..."
    hash_scheme: str = "sha256"
    reveal: str = "plaintext only through the audited reveal endpoint"
    failure: str = "plain-text 401 authentication failed (E4)"
    mode: str = "strict"
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class LocalRateLimitPolicySpec:
    """Rate-limit documentation block; rendered limits come from LimitsSpec."""

    key: str = "apiKey.metadata.user_id"
    type: str = "tokens"
    tokens_per_fill: int = 0
    semantics: str = "global request/token limits only; resets on restart (E12)"


@dataclass(frozen=True, slots=True)
class TimeoutPolicySpec:
    """llm.policies.timeout (agentgateway humantime strings, e.g. 60s)."""

    request_timeout: str = ""
    backend_request_timeout: str = ""
    response_idle_timeout: str = ""


@dataclass(frozen=True, slots=True)
class RetryPolicySpec:
    """Request retry (ADR-024).

    agentgateway 1.7 rejects retry inside llm.policies, but accepts it as a
    ROUTE-level policy: the renderer emits a top-level policies[] entry
    targeting the implicit LLM route (namespace internal, name llm:request).
    E16/E17 evidence: retries stay on the same backend until the upstream is
    marked unhealthy; the cross-layer failover happens on the following
    attempt, so attempts >= 2 is required for inter-group failover.
    """

    attempts: int = 1
    backoff: str = ""
    codes: tuple[int, ...] = (502, 503, 504)
    precondition: str = ""
    condition: str = ""


@dataclass(frozen=True, slots=True)
class HealthPolicySpec:
    """Upstream health marks + eviction for every rendered model (ADR-024).

    Rendered as llm.models[].health. E16/E17: an unhealthyExpression alone is
    NOT enough - eviction.consecutiveFailures must be paired, otherwise a 4xx
    never removes the primary from rotation and the next priority layer is
    never reached. The renderer refuses to emit an expression without eviction
    and validation rejects retry.codes containing 4xx without this block.
    """

    unhealthy_expression: str = ""
    consecutive_failures: int = 1
    duration: str = ""
    restore_health: float = 0.0


@dataclass(frozen=True, slots=True)
class RemoteRateLimitPolicySpec:
    """Remote rate-limit deservice; no safe 1.7 config surface, adapters must error."""

    domain: str = ""
    host: str = ""
    failure_mode: str = ""


@dataclass(frozen=True, slots=True)
class TransformsPolicySpec:
    """Default transforms composed at render time (ADR-010 #1 only: W1/W2)."""

    default_response_header_deletes: tuple[str, ...] = ("server", "x-powered-by")
    protected_request_headers: tuple[str, ...] = PROTECTED_HEADERS
    body_editable_paths: str = "any path, model/stream included (operator owns the risk)"
    default_response_body_condition: str = ""


@dataclass(frozen=True, slots=True)
class AccessLogSpec:
    """ADR-021 request/payload logging switch, resolved from app settings.

    llm is `metadata` (default, no prompt/completion bodies) or `full`. None
    means "not configured" and nothing is rendered. database_url is an
    adapter-owned rendering hint (ADR-029 ticket 04): the system leaves it
    empty and the adapter renders its own deployment default log DB location.
    """

    database_url: str = ""
    llm: str = "metadata"


@dataclass(frozen=True, slots=True)
class McpTargetSpec:
    """One top-level mcp.targets[] entry.

    agentgateway 1.7 accepts sse ({host}) and stdio ({cmd,args,env,clear_env});
    the http variant is rejected by the pinned binary, so the adapter refuses it
    explicitly. url is kept for older IR producers and rejected by validation.
    """

    name: str
    transport: str = "sse"
    url: str = ""
    host: str = ""
    port: int = 0
    path: str = ""
    cmd: str = ""
    args: tuple[str, ...] = ()
    env: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class McpPolicySpec:
    """Subset of mcp.policies that is safe to render (CORS only for now)."""

    cors: CorsPolicySpec | None = None


@dataclass(frozen=True, slots=True)
class ModelAliasSpec:
    """Legacy model alias. agentgateway 1.7 has no modelAliases surface; the
    adapter rejects any non-empty list instead of dropping it."""

    alias: str
    target_model_id: str


@dataclass(frozen=True, slots=True)
class PoliciesSpec:
    """Everything the control plane enforces besides routing (M4 block 1)."""

    cors: CorsPolicySpec = field(default_factory=CorsPolicySpec)
    api_key: ApiKeyPolicySpec = field(default_factory=ApiKeyPolicySpec)
    local_rate_limit: LocalRateLimitPolicySpec = field(
        default_factory=LocalRateLimitPolicySpec
    )
    transforms_defaults: TransformsPolicySpec = field(default_factory=TransformsPolicySpec)
    routing_modes: tuple[str, ...] = ROUTING_MODES
    # v2 data-plane policies; None means "not configured" and is never rendered.
    data_plane_cors: CorsPolicySpec | None = None
    global_transformations: TransformsSpec | None = None
    guardrails: PromptGuardSpec | None = None
    timeout: TimeoutPolicySpec | None = None
    retry: RetryPolicySpec | None = None
    # ADR-024: per-model health marks + eviction; required when retry codes
    # contain a 4xx (validation enforces the pairing).
    health: HealthPolicySpec | None = None
    remote_rate_limit: RemoteRateLimitPolicySpec | None = None
    # ADR-021: global access-log/payload switch (metadata | full).
    access_log: AccessLogSpec | None = None


@dataclass(frozen=True, slots=True)
class GuardrailItemSpec:
    """One adapter capability row: supported/verified are independent facts."""

    key: str
    supported: bool
    since_version: str = ""
    note: str = ""
    verified: bool = False


@dataclass(frozen=True, slots=True)
class GuardrailsSpec:
    """Adapter capability matrix (M4 block 2); empty when no driver is supplied."""

    adapter: str = ""
    items: tuple[GuardrailItemSpec, ...] = ()


@dataclass(frozen=True, slots=True)
class McpSpec:
    """MCP surface: top-level mcp.targets[] + mcp.policies (never inside llm).

    supported is false unless the adapter declares and validates the surface;
    rendering targets while unsupported is an explicit error, never silent.
    """

    servers: tuple[str, ...] = ()
    supported: bool = False
    note: str = ""
    targets: tuple[McpTargetSpec, ...] = ()
    policies: McpPolicySpec | None = None
    port: int | None = None


@dataclass(frozen=True, slots=True)
class GatewayIR:
    """Full desired state for one configuration revision."""

    revision: str
    upstreams: tuple[UpstreamSpec, ...]
    models: tuple[UpstreamModelSpec, ...]
    public_models: tuple[PublicModelSpec, ...]
    api_keys: tuple[ClientKeySpec, ...]
    users: tuple[UserBalanceSpec, ...] = ()
    limits: LimitsSpec | None = None
    # M4: policy/guardrail/MCP blocks travel with the IR so readers (admin API)
    # and the render path describe the same state.
    policies: PoliciesSpec = field(default_factory=PoliciesSpec)
    guardrails: GuardrailsSpec = field(default_factory=GuardrailsSpec)
    mcp: McpSpec = field(default_factory=McpSpec)
    model_aliases: tuple[ModelAliasSpec, ...] = ()


def sort_targets(targets: tuple[TargetSpec, ...]) -> tuple[TargetSpec, ...]:
    """Priority-ascending (smaller first) and stable inside one priority group."""
    return tuple(sorted(targets, key=lambda t: t.priority))


def legacy_priority_to_v2(priority: int, max_priority: int) -> int:
    """Migrate the old control plane's "bigger = better" priority to AG's
    numeric small-first semantics: old N -> maxPriority - N."""
    return max_priority - priority
