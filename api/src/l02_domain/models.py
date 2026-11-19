"""Frozen domain models (docs/PLAN.md §8, terms per docs/GLOSSARY.md).

Storage shape lives in l04_repo; these dataclasses are the in-memory domain view.
No gateway-specific nouns (ADR-006): CEL compilation happens in l03_adapters.

Lead decisions round 2 + ADR-007/008/009/010/011: upstreams carry one encrypted
key each; client keys are hash+AES-GCM (no quota fields - balances are prepaid
micro-currency on the user); usage events mirror the AG request_logs columns (E6);
billing amounts are integer micro units with explicit currency and price version.
"""

from __future__ import annotations

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
    """One data-plane request (E6 request_logs shape); append-only, idempotent by id.

    started_at + id form the incremental cursor; public_model is what the client
    addressed, upstream_model is what actually served (gen_ai_response_model).
    """

    event_id: str
    started_at_ms: int
    completed_at_ms: int = 0
    duration_ms: int = 0
    time_to_first_token_ms: int = 0
    http_status: int = 0
    public_model: str = ""
    upstream_model: str = ""
    provider: str = ""
    api_key_id: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    raw_json: str = ""


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
