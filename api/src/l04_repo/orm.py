"""SQLAlchemy 2.0 ORM models; snake_case tables per docs/PLAN.md §8 + billing.md.

Lead decisions round 2 + ADR-007/008/009/010/011:
- upstream_keys holds up to 20 encrypted credentials per upstream (ticket 09);
  the primary row mirrors into upstreams.api_key_enc because the data-plane
  renderer still consumes exactly one credential per upstream.
- api_keys: AES-GCM ciphertext copy + sha256 hash for the data plane
  (hash form "sha256:<hex>", E11); lists show the mask only.
- users: prepaid balance in integer micro-currency (ADR-011), no float anywhere.
- billing: two independent price books (upstream_prices / charge_prices) and two
  independent result books (cost_entries / charge_entries); ledger_entries only
  records balance deltas (charge/topup/refund/adjust) with balance_after_micro.
  Amounts are INTEGER micro units; price changes create new versions and never
  rewrite history (billing.md §5). Unpriced rows keep amount_micro NULL.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base for every Slipstream control-plane table."""


class VendorORM(Base):
    __tablename__ = "vendors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    note: Mapped[str] = mapped_column(Text, default="")
    upstream_seq: Mapped[int] = mapped_column(Integer, default=0)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class UpstreamORM(Base):
    __tablename__ = "upstreams"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # ADR-023 #6: 厂商可选 — an upstream may exist without a vendor row; the
    # name then derives from the connection address instead of the vendor slug.
    vendor_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("vendors.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), unique=True)
    base_url: Mapped[str] = mapped_column(String(512))
    api_style: Mapped[str] = mapped_column(String(64), default="openai_chat")
    api_key_enc: Mapped[str] = mapped_column(Text, default="")
    transforms_json: Mapped[str] = mapped_column(Text, default="")
    max_buffer_bytes: Mapped[int] = mapped_column(Integer, default=2097152)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class UpstreamKeyORM(Base):
    """One credential of an upstream; at most 20 rows per upstream (ticket 09).

    ADR-026 多密钥平权: every row IS an independent data-plane credential - the
    renderer expands each row into its own AG provider/key file, so there is no
    primary row and no mirror into ``upstreams.api_key_enc`` (the legacy column
    is kept one version for the migration, never written anymore). Keys are
    equal peers: label/suffix for display, last_test_* for the per-key probe
    result (upstream_ops.test_keys). Ticket 16 also retired the dead
    is_primary column: init_db drops it from pre-existing databases.
    """

    __tablename__ = "upstream_keys"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    upstream_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("upstreams.id"), index=True
    )
    label: Mapped[str] = mapped_column(String(128), default="")
    key_enc: Mapped[str] = mapped_column(Text, default="")
    key_suffix: Mapped[str] = mapped_column(String(16), default="")
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0, index=True)
    # Per-key connectivity test (ADR-026 ③): the last POST keys/test outcome for
    # THIS row as a JSON array fragment payload; empty means "never tested".
    last_test_json: Mapped[str] = mapped_column(Text, default="")
    last_test_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class UpstreamProbeORM(Base):
    """Append-only connectivity / discovery result (ticket 09).

    status: ok | error | timeout. kind: connection | discover. models_json holds
    the discovered model ids so the console can show what the last probe saw.
    """

    __tablename__ = "upstream_probes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    upstream_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="connection")
    status: Mapped[str] = mapped_column(String(16), default="unknown")
    http_status: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="")
    model_count: Mapped[int] = mapped_column(Integer, default=0)
    models_json: Mapped[str] = mapped_column(Text, default="[]")
    tested_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class UpstreamModelORM(Base):
    """Model-level cost book (ticket 05): CNY per 1M tokens plus ONE markup per model.

    The value of this table is that availability, routing and price live on the same
    row, so "what does this model cost us / sell for" has exactly one answer. The
    legacy versioned upstream_prices/charge_prices books stay readable for history,
    but new pricing is configured here. NULL cost = unpriced (never a silent 0).
    """

    __tablename__ = "upstream_models"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    upstream_id: Mapped[str] = mapped_column(String(64), ForeignKey("upstreams.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    model_type: Mapped[str] = mapped_column(String(64), default="chat")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    cost_input_per_1m: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    cost_output_per_1m: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    # ADR-020: spend = cost x markup, so the markup IS the price. A row created
    # without one bills at the 1.2 house rate, not at cost (no margin).
    markup: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("1.2000"))
    # Ticket 10: the old channel-model metadata the console edits (类型来源 + 参数)
    # plus row-level availability. cooldown_until_ms == 0 means "no cooldown"; a
    # non-zero deadline self-heals on read, mirroring the old banned_until column.
    # enabled == False is a manual, long-term 关闭.
    model_type_source: Mapped[str] = mapped_column(String(16), default="default")
    parameters_json: Mapped[str] = mapped_column(Text, default="")
    # W4-H: where the current parameters came from ("manual" = human entry in
    # the console, "models.dev" = the last adopt-modelsdev pass filled >= 1
    # blank key). A later manual PATCH that actually changes the block flips it
    # back to manual; adopt never overwrites a value the user typed, so the
    # badge only ever claims what the console really last wrote.
    params_source: Mapped[str] = mapped_column(String(16), default="manual")
    cooldown_until_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class PublicModelORM(Base):
    """Alias layer only: upstream model names are never auto-exposed (lead decision 5)."""

    __tablename__ = "public_models"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    routing_mode: Mapped[str] = mapped_column(String(16), default="failover")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str] = mapped_column(Text, default="")
    # Ticket 10: a public model cools down as a whole (all members skipped), the
    # same deadline semantics as its upstream models.
    cooldown_until_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class ModelTargetORM(Base):
    __tablename__ = "model_targets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    public_model_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("public_models.id"), index=True
    )
    upstream_model_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("upstream_models.id"), index=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=1)
    weight: Mapped[int] = mapped_column(Integer, default=0)
    when_expr: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class UserORM(Base):
    """The ONE user row (ADR-019): consumer + console account in a single line.

    balance_micro is the ADR-011 authoritative prepaid value; username (unique)
    plus password_hash make the same row a console login. Console access ==
    has a role and a password; the retired admin_users table and this row's
    legacy admin_user_id column are no longer read or written by services.

    The data-plane localRateLimit bucket receives a token-equivalent estimate
    derived at render time (AG buckets count tokens, not currency); the ledger
    stays the source of truth (E10: the AG budget bills then blocks and resets
    on restart).
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    # Login name, unique and immutable once set (ADR-019); NULL for rows that
    # predate the unification and were never given a console account.
    username: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True, index=True
    )
    # One-way scrypt hash (l05_service.auth); empty string = cannot log in yet.
    password_hash: Mapped[str] = mapped_column(String(256), default="")
    balance_micro: Mapped[int] = mapped_column(BigInteger, default=0)
    role: Mapped[str] = mapped_column(String(16), default="")
    parent_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="active")
    # RETIRED (ADR-019): the old admin_users linkage. Kept as a column so old
    # databases survive the additive migration; the one-shot unification script
    # (scripts/migrate_unify_users.py) is its only remaining writer, no service
    # reads it any more - the login IS this row (session.admin_id == users.id).
    admin_user_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class ApiKeyORM(Base):
    """ADR-008: AES-GCM ciphertext copy + sha256 hash for AG; lists show the mask only.

    ADR-023: one user may hold up to 50 keys, each with a display name and a
    last_used_at_ms observation (written by usage ingestion; issuance/rotation
    seed it with the current time as a fallback).
    """

    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    prefix: Mapped[str] = mapped_column(String(32))
    key_hash: Mapped[str] = mapped_column(String(128), unique=True)
    key_enc: Mapped[str] = mapped_column(Text, default="")
    key_suffix: Mapped[str] = mapped_column(String(8), default="")
    status: Mapped[str] = mapped_column(String(16), default="active")
    last_used_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class AvailabilityRuleORM(Base):
    __tablename__ = "availability_rules"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    scope: Mapped[str] = mapped_column(String(32), default="model_target")
    scope_id: Mapped[str] = mapped_column(String(64), index=True)
    recurrence: Mapped[str | None] = mapped_column(String(16), nullable=True)
    expires_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    schedule_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # GLOSSARY §3 一次性窗口例外：窗口期内人工「启用」= 仅跳过当前窗口。skip_until_ms
    # 锚定该规则当前窗口的 deadline（rule_deadline_ms），过期即惰性失效，规则保留；
    # skip_set_at_ms 记录例外创建时刻，供 rules_changed_since 把这次状态变化推给 job。
    skip_until_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    skip_set_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class GatewayUsageEventORM(Base):
    """Append-only ingestion of AG request_logs rows; idempotent by event_id (E6).

    Column mapping (request_logs 26 cols): id -> event_id, started_at ->
    started_at_ms, gen_ai_request_model -> public_model, gen_ai_response_model ->
    upstream_model, gen_ai_provider_name -> provider, agentgateway_user (= the
    key metadata.name we render) -> api_key_id, trace_id -> trace_id (M5-a join
    key to trace_spans). Cache columns are stored raw but billing folds them into
    input per the lead's conservative rule (billing.md §6, stage B re-checks);
    reports must label token amounts as estimates.
    """

    __tablename__ = "gateway_usage_events"

    event_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    started_at_ms: Mapped[int] = mapped_column(BigInteger, default=0, index=True)
    completed_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    time_to_first_token_ms: Mapped[int] = mapped_column(Integer, default=0)
    http_status: Mapped[int] = mapped_column(Integer, default=0)
    public_model: Mapped[str] = mapped_column(String(255), default="")
    upstream_model: Mapped[str] = mapped_column(String(255), default="")
    provider: Mapped[str] = mapped_column(String(255), default="")
    api_key_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    raw_json: Mapped[str] = mapped_column(Text, default="")
    # M5-a: AG fills request_logs.trace_id when frontendPolicies.tracing is on;
    # this is the join key to the span tree (span_id is not duplicated here).
    trace_id: Mapped[str] = mapped_column(String(64), default="")
    ingested_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class RequestAttemptORM(Base):
    """One upstream attempt of a client request (ADR-028, W5-W1.7).

    The control plane owns the fact shape, not the collection mechanism: adapters
    normalize their telemetry into :class:`RequestAttempt` and write it here.
    `correlation_key` is the request-log join key (AG: request_logs.trace_id);
    `attempt_no` is 1-based execution order. Composite primary key makes an
    exporter retry idempotent without assuming the adapater can provide a span id.
    No trace/span/parent/attributes columns exist on purpose.
    """

    __tablename__ = "request_attempts"
    __table_args__ = (
        Index("ix_request_attempts_correlation_start", "correlation_key", "started_at_ms"),
    )

    correlation_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempt_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    upstream_ref: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_type: Mapped[str] = mapped_column(String(64), default="")
    error_message: Mapped[str] = mapped_column(Text, default="")
    started_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[str] = mapped_column(String(16), default="")
    adapter_id: Mapped[str] = mapped_column(String(32), default="")
    recorded_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class UpstreamPriceORM(Base):
    """Vendor cost book, versioned: new row per price change, history never rewritten."""

    __tablename__ = "upstream_prices"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    vendor_id: Mapped[str] = mapped_column(String(64), index=True)
    upstream_model: Mapped[str] = mapped_column(String(255))
    item: Mapped[str] = mapped_column(String(16))  # input|output|cache_read|cache_write|request
    unit_price_micro: Mapped[int] = mapped_column(BigInteger)  # per 1M tokens, or per request
    currency: Mapped[str] = mapped_column(String(8), default="CNY")
    effective_from_ms: Mapped[int] = mapped_column(BigInteger, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class ChargePriceORM(Base):
    """Downstream price book: markup (basis points of ten-thousandths, 12000 = 1.2x)
    over cost, or a fixed unit price; versioned like upstream_prices (ADR-011)."""

    __tablename__ = "charge_prices"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    public_model_id: Mapped[str] = mapped_column(String(64), index=True)
    item: Mapped[str] = mapped_column(String(16))  # input|output|cache_read|cache_write|request
    mode: Mapped[str] = mapped_column(String(8))  # markup|fixed
    # markup: ratio in ten-thousandths; fixed: micro unit
    value: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(8), default="CNY")
    effective_from_ms: Mapped[int] = mapped_column(BigInteger, index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class CostEntryORM(Base):
    """What WE pay the vendor for one gateway event; amount stays NULL when unpriced."""

    __tablename__ = "cost_entries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    gateway_event_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    vendor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    upstream_model_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    amount_micro: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="")
    price_version_id: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="ok")  # ok|unpriced
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class ChargeEntryORM(Base):
    """What the USER pays us for one gateway event; NULL amount when unpriced (never 0)."""

    __tablename__ = "charge_entries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    gateway_event_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    api_key_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    public_model_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    amount_micro: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="")
    price_version_id: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="ok")  # ok|unpriced|free
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class LedgerEntryORM(Base):
    """Balance deltas only (charge|topup|refund|adjust); balance_after_micro mandatory.

    Token amounts live on cost/charge entries; the ledger is money-only (ADR-011).
    """

    __tablename__ = "ledger_entries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # charge|topup|refund|adjust
    delta_micro: Mapped[int] = mapped_column(BigInteger)
    balance_after_micro: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(8), default="CNY")
    ref_type: Mapped[str] = mapped_column(String(32), default="")
    ref_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(128), default="")
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class CostDailyORM(Base):
    """Per vendor/model/day cost aggregate; token totals are estimates (cache folded)."""

    __tablename__ = "cost_daily"

    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    vendor_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    upstream_model: Mapped[str] = mapped_column(String(255), primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    amount_micro: Mapped[int] = mapped_column(BigInteger, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="")
    estimate_note: Mapped[str] = mapped_column(Text, default="cache tokens folded into input")


class UserDailyORM(Base):
    """Per user/day charge aggregate backing the revenue dashboard."""

    __tablename__ = "user_daily"

    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    amount_micro: Mapped[int] = mapped_column(BigInteger, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="")
    estimate_note: Mapped[str] = mapped_column(Text, default="cache tokens folded into input")


class FxSnapshotORM(Base):
    """Manual currency conversion table for reports (billing.md §5.3); no live rates."""

    __tablename__ = "fx_snapshots"

    currency: Mapped[str] = mapped_column(String(8), primary_key=True)
    as_of_ms: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rate_micro: Mapped[int] = mapped_column(BigInteger)  # micro units of CNY per 1 currency unit
    source: Mapped[str] = mapped_column(String(128), default="manual")
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class ConfigRevisionORM(Base):
    """One archived configuration rollout: artifact, hash, operator, status, lineage.

    status: active | superseded | failed (failed rows record rejected rollouts,
    E8: a bad apply must leave the previous revision serving).
    """

    __tablename__ = "config_revisions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    artifact: Mapped[str] = mapped_column(Text)
    artifact_hash: Mapped[str] = mapped_column(String(64))
    adapter_id: Mapped[str] = mapped_column(String(64), default="")
    operator: Mapped[str] = mapped_column(String(128), default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    previous_revision_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Ticket 08: displayable failure reason and the recorded gate note (a
    # skipped --validate-only is auditable instead of silent).
    error_detail: Mapped[str] = mapped_column(Text, default="")
    validation_note: Mapped[str] = mapped_column(Text, default="")
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class AdminRoleORM(Base):
    """Role definition: key, display name and a registry-validated permission list.

    Built-in rows are seeded on startup and can never be deleted; the admin
    built-in sets all_permissions so newly registered permissions are granted
    automatically instead of going stale in a JSON snapshot.
    """

    __tablename__ = "admin_roles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(255), default="")
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    all_permissions: Mapped[bool] = mapped_column(Boolean, default=False)
    permissions_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class AdminSessionORM(Base):
    """Server-side console session (DB-backed so it can be revoked, not a signed cookie).

    admin_id references the unified users row since ADR-019 (formerly
    admin_users.id). Only the sha256 of the cookie token is stored: a database
    leak cannot be replayed as a live cookie. expires_at_ms is enforced on
    every request.
    """

    __tablename__ = "admin_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    admin_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    expires_at_ms: Mapped[int] = mapped_column(BigInteger, default=0, index=True)
    revoked_at_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_seen_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    client_ip: Mapped[str] = mapped_column(String(64), default="")


class ModelDevSnapshotORM(Base):
    """W4-H: local cache of one models.dev provider/model row (snapshot, not history).

    params_json / pricing_json keep the models.dev payload AS RECEIVED (limit,
    modalities, capability flags; cost input/output per 1M USD) so a later
    re-adopt can recompute conversions without refetching. The composite PK
    (provider, model) is the upstream models.dev identity; adoption matches an
    upstream_models row by its name against the model key (exact first, then
    case-insensitive, never fuzzy).
    """

    __tablename__ = "model_dev_snapshots"

    provider: Mapped[str] = mapped_column(String(128), primary_key=True)
    model: Mapped[str] = mapped_column(String(255), primary_key=True)
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    pricing_json: Mapped[str] = mapped_column(Text, default="{}")
    fetched_at_ms: Mapped[int] = mapped_column(BigInteger, default=0, index=True)


class AppSettingORM(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)


class AuditLogORM(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    actor: Mapped[str] = mapped_column(String(128), default="")
    action: Mapped[str] = mapped_column(String(64), default="")
    entity_type: Mapped[str] = mapped_column(String(64), default="")
    entity_id: Mapped[str] = mapped_column(String(128), default="")
    detail_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at_ms: Mapped[int] = mapped_column(BigInteger, default=0)
