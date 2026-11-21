"""Frozen domain models (docs/PLAN.md §8, terms per docs/GLOSSARY.md).

Storage shape lives in l04_repo; these dataclasses are the in-memory domain view.
No gateway-specific nouns (ADR-006): CEL compilation happens in l03_adapters.

Lead decisions round 2 + ADR-007/008/009/010/011: upstreams carry one encrypted
key each; client keys are hash+AES-GCM (no quota fields - balances are prepaid
micro-currency on the user); usage events mirror the AG request_logs columns (E6);
billing amounts are integer micro units with explicit currency and price version.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum


class ApiStyle(StrEnum):
    """Known upstream interface styles (docs/GLOSSARY.md §4); open set, new ones may appear.

    AUTO is input-only (ADR-023 #6): accepted on create/update requests and
    resolved to a concrete style by probing before anything is stored; the
    database never holds "auto" and renderers keep mapping concrete styles only.
    """

    OPENAI_CHAT = "openai_chat"
    OPENAI_RESPONSES = "openai_responses"
    ANTHROPIC_MESSAGES = "anthropic_messages"
    GEMINI = "gemini"
    AUTO = "auto"


class ModelType(StrEnum):
    """Model type is our classification, not upstream metadata (docs/GLOSSARY.md §4)."""

    CHAT = "chat"
    EMBEDDING = "embedding"
    RERANK = "rerank"
    IMAGE_GENERATION = "image_generation"
    AUDIO_TTS = "audio_tts"
    AUDIO_TRANSCRIPTION = "audio_transcription"
    VIDEO = "video"
    SYSTEMONE = "systemone"  # AG built-in protocol interface (ADR-023 #9, E14b)
    CUSTOM = "custom"  # operator-supplied path passthrough


class AvailabilityKind(StrEnum):
    """Only two measures exist (ADR-004): permanent ban vs. auto-expiring cooldown."""

    BAN = "ban"
    COOLDOWN = "cooldown"


class Recurrence(StrEnum):
    """Cooldown shape: a single deadline or a recurring window (still a cooldown)."""

    ONCE = "once"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


@dataclass(frozen=True, slots=True)
class Vendor:
    id: str
    name: str
    slug: str = ""
    note: str = ""
    upstream_seq: int = 0
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class Upstream:
    id: str
    vendor_id: str
    name: str
    base_url: str
    api_style: str
    api_key_ciphertext: str = ""
    transforms_json: str = ""
    max_buffer_bytes: int = 2097152
    enabled: bool = True
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class UpstreamModel:
    """Prices live in the versioned upstream_prices book (ADR-011), not here."""

    id: str
    upstream_id: str
    name: str
    model_type: str
    enabled: bool = True
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class PublicModel:
    """Alias layer only: never auto-exposed from upstream model names."""

    id: str
    name: str
    enabled: bool = True
    note: str = ""
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class ModelTarget:
    id: str
    public_model_id: str
    upstream_model_id: str
    priority: int
    enabled: bool = True
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class User:
    id: str
    name: str
    balance_micro: int = 0
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class ClientApiKey:
    """Hash-only for the data plane (ADR-008); status is active|disabled."""

    id: str
    user_id: str
    prefix: str
    key_hash: str
    key_enc: str = ""
    key_suffix: str = ""
    status: str = "active"
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class AvailabilityRule:
    """One unavailability measure over a scope (ADR-004: single table, two kinds)."""

    id: str
    kind: str
    scope: str
    scope_id: str
    recurrence: str | None = None
    expires_at_ms: int | None = None
    schedule_json: str | None = None
    note: str = ""
    created_at_ms: int = 0


@dataclass(frozen=True, slots=True)
class UsageEvent:
    """One normalized request fact (ADR-029); append-only, idempotent by id.

    started_at + id form the incremental cursor; requested_model is the model
    the client asked for, public_model/upstream_model are the ledger's recorded
    routing facts. Everything wire-specific (attributes, column names, stream
    flags) is decoded by the adapter before it hands this object over; the
    system layer never re-parses data-plane attributes. raw_json rides along as
    an already-collected diagnostic attachment only.
    """

    event_id: str
    started_at_ms: int
    completed_at_ms: int = 0
    duration_ms: int = 0
    time_to_first_token_ms: int = 0
    http_status: int = 0
    requested_model: str = ""
    public_model: str = ""
    upstream_model: str = ""
    provider: str = ""
    api_key_id: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    error: str = ""
    has_payload: bool = False
    raw_json: str = ""
    # Adapter-verdicted streaming: True/False when a wire flag decided, None when
    # no explicit signal exists (the system then falls back to its TTFT rule).
    is_stream: bool | None = None
    # Cross-log/attempt-chain join key, normalized by the adapter (ADR-028).
    correlation_key: str = ""


@dataclass(frozen=True, slots=True)
class RequestAttempt:
    """One upstream attempt of a client request, normalized by an adapter (ADR-028).

    This is the product fact the console needs for a routing chain: which upstream
    was tried, with which model, what came back, how long it took, and whether the
    attempt failed. It deliberately contains no transport/observability concepts
    (no trace/span/parent/attributes): OTLP is an agentgateway implementation
    detail, not part of the system contract.

    correlation_key joins to the request log (AG fills request_logs.trace_id);
    attempt_no is 1-based in execution order; upstream_ref is an adapter-stable
    reference the control plane resolves to a display name when possible.
    """

    correlation_key: str
    attempt_no: int
    upstream_ref: str = ""
    model: str = ""
    status_code: int | None = None
    error_type: str = ""
    error_message: str = ""
    started_at_ms: int = 0
    duration_ms: int = 0
    outcome: str = ""
    adapter_id: str = ""


#: Adapter -> control-plane hand-off for normalized attempts. Returns rows stored.
AttemptSink = Callable[[Sequence[RequestAttempt]], int]


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    """One balance delta (charge|topup|refund|adjust) with the post-entry balance."""

    id: str
    user_id: str
    kind: str
    delta_micro: int
    balance_after_micro: int
    currency: str = "CNY"
    ref_type: str = ""
    ref_id: str | None = None
    note: str = ""
    created_by: str = ""
    created_at_ms: int = 0
