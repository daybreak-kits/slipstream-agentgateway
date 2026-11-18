"""Demo seed for the Slipstream control plane (task-170, ticket 19).

Creates a realistic 7-day dataset so every frontend page has something to show:
3 vendors, 6 upstreams, 20 upstream models (cost + 1.2x markup where priced),
8 public models (failover + weighted, AG 1.7 小优先 priority), 6 consumers
(root user D + two-level tree), 5 client keys (sk- + 64 upper case chars),
price books (upstream + charge + fx), ~250 gateway usage events with
cost/charge/ledger/daily aggregates, 3 unpriced rows, 2 availability rules
(ban + cooldown; no scheduled windows), 2 config revisions, editable
policy / guardrail / MCP sample documents and the audit trail produced by the
service calls.

Repeatable and idempotent: by default the script DROPs and re-creates every
table, then seeds from scratch — running it twice yields the same dataset.
--keep refuses to run when the schema already has data (it is only for an empty
schema created by an older seed). Stop the API server first (it holds
.data_store/slipstream.db open on Windows).

Run from the api directory so the default sqlite url
(sqlite:///./.data_store/slipstream.db) matches the server:

    cd slipstream/api
    PYTHONPATH=src python scripts/seed_demo.py            # reset + seed + print client keys
    PYTHONPATH=src python scripts/seed_demo.py --keep     # only on an empty schema

Old databases (三期外部数据) — flip legacy "bigger wins" priorities to v2 once:

    cd slipstream/api
    PYTHONPATH=src python scripts/migrate_priority_v2.py          # dry-run 预演
    PYTHONPATH=src python scripts/migrate_priority_v2.py --apply  # 写入 + v2 标记

Console login (ticket 02 / ADR-019) — every seeded account shares one demo
password. The seed writes the three console accounts straight onto the unified
users rows (username + password + role), so no migration pass is involved:

    default password: admin12345
    override:         SLIPSTREAM_DEMO_ADMIN_PASSWORD=... python scripts/seed_demo.py
    accounts:         admin(管理用户, 内部平台) / lisi(代理用户, 数据分析组) /
                      wangwu(普通用户, 试用-临时)

Change the password after the first login (用户管理 or PUT /admin/users/{id}/password).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from sqlalchemy import select  # noqa: E402

from l01_core.crypto import AesGcmBox, SecretBox, sha256_hex  # noqa: E402
from l01_core.ids import new_id  # noqa: E402
from l01_core.settings import get_settings  # noqa: E402
from l01_core.timeutil import now_ms  # noqa: E402
from l04_repo.base import init_db, make_engine, make_sessionmaker  # noqa: E402
from l04_repo.orm import (  # noqa: E402
    AuditLogORM,
    Base,
    ChargeEntryORM,
    ConfigRevisionORM,
    CostDailyORM,
    CostEntryORM,
    GatewayUsageEventORM,
    UserDailyORM,
    UserORM,
)
from l04_repo.repository import put_setting  # noqa: E402
from l05_service import (  # noqa: E402
    auth,
    balances,
    client_keys,
    crud,
    policy_store,
    prices,
    roles,
    usage_ingest,
    user_tree,
)
from l05_service.priority_migration import (  # noqa: E402
    SEMANTICS_KEY,
    SEMANTICS_V2,
)

DAY_MS = 86_400_000
CNY = "CNY"
USD = "USD"

# (display name, slug, note)
VENDORS = [
    ("智谱 AI", "zai", "智谱开放平台，旗舰 GLM 系列"),
    ("青岚云", "nebula", "云厂商大模型服务，合规通道"),
    ("本地推理", "local", "自建 GPU 集群，vLLM 部署"),
]

# (vendor slug, base_url, api_style, fake upstream key)
UPSTREAMS = [
    ("zai", "https://open.bigmodel.cn/api/paas/v4", "openai_chat", "sk-zai-demo-primary"),
    ("zai", "https://open.bigmodel.cn/api/paas/v4", "openai_chat", "sk-zai-demo-backup"),
    ("zai", "https://open.bigmodel.cn/api/paas/v4", "openai_chat", "sk-zai-demo-cheap"),
    ("nebula", "https://api.nebula.example/v1", "anthropic_messages", "sk-nebula-demo-01"),
    ("local", "http://127.0.0.1:8000/v1", "openai_chat", "sk-local-demo-01"),
    ("local", "http://127.0.0.1:8001/v1", "openai_chat", "sk-local-demo-02"),
]

# upstream index -> [(model name, model type, priced?)]
UPSTREAM_MODELS = {
    0: [("glm-5.3", "chat", True), ("glm-5.3-flash", "chat", True),
        ("glm-4.6", "chat", True), ("embedding-4", "embedding", True)],
    1: [("glm-5.3", "chat", True), ("glm-4.6", "chat", True),
        ("glm-4.5-air", "chat", False)],
    2: [("glm-5.3-air", "chat", True), ("glm-5.3-flash", "chat", True),
        ("glm-4.6", "chat", True)],
    3: [("nebula-chat-1", "chat", True), ("nebula-chat-2", "chat", True),
        ("nebula-embed-1", "embedding", True)],
    4: [("llama-3.3-70b", "chat", True), ("qwen2.5-72b", "chat", True),
        ("deepseek-v3", "chat", True), ("bge-m3", "embedding", True)],
    5: [("llama-3.3-70b", "chat", True), ("qwen2.5-32b", "chat", True),
        ("mistral-large", "chat", True)],
}

# (public name, routing mode, note, [(upstream index, model name, priority, weight)])
PUBLIC_MODELS = [
    ("glm-5.3", "failover", "旗舰对话模型，三层降级", [
        (0, "glm-5.3", 1, 0), (1, "glm-5.3", 2, 0), (4, "deepseek-v3", 3, 0)]),
    ("glm-flash", "failover", "低成本快模型，跨厂商互备", [
        (0, "glm-5.3-flash", 1, 0), (2, "glm-5.3-air", 2, 0)]),
    ("gpt-4o", "failover", "对外别名，指向合规通道", [
        (3, "nebula-chat-1", 1, 0), (0, "glm-4.6", 2, 0)]),
    ("claude-3-7-sonnet", "failover", "长上下文合规通道", [
        (3, "nebula-chat-2", 1, 0)]),
    ("deepseek-v3", "failover", "自建集群优先，云端兜底", [
        (4, "deepseek-v3", 1, 0), (1, "glm-4.6", 2, 0)]),
    ("qwen-max", "weighted", "两张本地卡按权重分流", [
        (4, "qwen2.5-72b", 0, 60), (5, "qwen2.5-32b", 0, 40)]),
    ("llama-70b", "weighted", "双实例等权灰度", [
        (4, "llama-3.3-70b", 0, 50), (5, "llama-3.3-70b", 0, 50)]),
    ("embed-v4", "failover", "向量化模型，云端加本地兜底", [
        (0, "embedding-4", 1, 0), (4, "bge-m3", 2, 0)]),
]

# (name, initial micro, topup history micro, parent name, role)
# 根用户 D 由 user_tree.ensure_root_user 创建；其余账号演示两层代理结构。
USERS = [
    ("内部平台", 200_000_000, [150_000_000, 50_000_000], "D", "admin"),
    ("数据分析组", 120_000_000, [80_000_000, 40_000_000], "D", "agent"),
    ("试用-临时", 30_000_000, [30_000_000], "数据分析组", "user"),
    ("财务对账", 80_000_000, [80_000_000], "内部平台", "user"),
    ("压测环境", 50_000_000, [50_000_000], "D", "user"),
]

# per-model upstream prices in micro CNY per 1M tokens: (input, output)
UPSTREAM_PRICES = {
    "glm-5.3": (2_000_000, 8_000_000),
    "glm-5.3-flash": (300_000, 1_200_000),
    "glm-4.6": (1_000_000, 4_000_000),
    "embedding-4": (100_000, 0),
    "glm-5.3-air": (500_000, 2_000_000),
    "nebula-chat-1": (2_500_000, 10_000_000),
    "nebula-chat-2": (4_000_000, 16_000_000),
    "nebula-embed-1": (120_000, 0),
    "llama-3.3-70b": (200_000, 600_000),
    "qwen2.5-72b": (600_000, 2_400_000),
    "qwen2.5-32b": (300_000, 1_200_000),
    "deepseek-v3": (800_000, 3_200_000),
    "bge-m3": (80_000, 0),
    "mistral-large": (2_200_000, 8_800_000),
}

# popularity weights for the generated traffic
TRAFFIC = {
    "glm-5.3": 30, "glm-flash": 20, "gpt-4o": 12, "claude-3-7-sonnet": 8,
    "deepseek-v3": 12, "qwen-max": 10, "llama-70b": 5, "embed-v4": 3,
}


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).strftime("%Y-%m-%d %H:%M:%S")



def _day_of_ms(at_ms: int) -> str:
    return datetime.fromtimestamp(at_ms / 1000, tz=UTC).strftime("%Y-%m-%d")


def _rebuild_daily(session, days: set[str], currency: str) -> None:
    """Seed-side daily rollup (temporary).

    l05_service.refresh_cost_daily currently selects cost entries by
    created_at_ms (always "today") and groups buckets by currency while the
    table PK is (day, vendor, model), so process_billing trips the UNIQUE
    constraint. We neutralise those two functions while billing runs and
    rebuild the read models here from the event's started_at day, merging all
    currencies into the reporting currency.
    """
    for day in days:
        for old in session.scalars(
            select(CostDailyORM).where(CostDailyORM.day == day)
        ).all():
            session.delete(old)
        for old in session.scalars(
            select(UserDailyORM).where(UserDailyORM.day == day)
        ).all():
            session.delete(old)
    session.flush()
    events = {e.event_id: e for e in session.scalars(select(GatewayUsageEventORM)).all()}
    cost_buckets: dict[tuple[str, str, str], dict[str, int]] = {}
    for entry in session.scalars(select(CostEntryORM)).all():
        event = events.get(entry.gateway_event_id)
        if event is None:
            continue
        day = _day_of_ms(event.started_at_ms or 0)
        if day not in days:
            continue
        key = (day, entry.vendor_id or "?", entry.upstream_model_id or "?")
        bucket = cost_buckets.setdefault(
            key, {"requests": 0, "input": 0, "output": 0, "amount": 0}
        )
        bucket["requests"] += 1
        bucket["input"] += entry.input_tokens
        bucket["output"] += entry.output_tokens
        bucket["amount"] += entry.amount_micro or 0
    for (day, vendor_id, model_id), bucket in cost_buckets.items():
        session.add(
            CostDailyORM(
                day=day,
                vendor_id=vendor_id,
                upstream_model=model_id,
                requests=bucket["requests"],
                input_tokens=bucket["input"],
                output_tokens=bucket["output"],
                amount_micro=bucket["amount"],
                currency=currency,
                estimate_note="cache tokens folded into input",
            )
        )
    user_buckets: dict[tuple[str, str], dict[str, int]] = {}
    for entry in session.scalars(select(ChargeEntryORM)).all():
        event = events.get(entry.gateway_event_id)
        if event is None or entry.status not in ("ok", "free"):
            continue
        day = _day_of_ms(event.started_at_ms or 0)
        if day not in days:
            continue
        key = (day, entry.user_id or "?")
        bucket = user_buckets.setdefault(
            key, {"requests": 0, "input": 0, "output": 0, "amount": 0}
        )
        bucket["requests"] += 1
        bucket["input"] += entry.input_tokens
        bucket["output"] += entry.output_tokens
        bucket["amount"] += entry.amount_micro or 0
    for (day, user_id), bucket in user_buckets.items():
        session.add(
            UserDailyORM(
                day=day,
                user_id=user_id,
                requests=bucket["requests"],
                input_tokens=bucket["input"],
                output_tokens=bucket["output"],
                amount_micro=bucket["amount"],
                currency=currency,
                estimate_note="cache tokens folded into input",
            )
        )
    session.flush()

def seed(session, rng: random.Random) -> dict[str, object]:
    """Fill one clean database; returns a summary with ids and client key texts."""
    secret_key = get_settings().secret_key
    secret_box = SecretBox(secret_key)
    aes_box = AesGcmBox(secret_key)
    now = now_ms()

    vendors: dict[str, object] = {}
    for name, slug, note in VENDORS:
        vendors[slug] = crud.create_vendor(session, name=name, slug=slug, note=note, actor="seed")

    upstreams: dict[str, object] = {}
    upstream_vendor: dict[str, str] = {}
    for vendor_slug, base_url, api_style, api_key in UPSTREAMS:
        upstream = crud.create_upstream(
            session,
            vendor_id=vendors[vendor_slug].id,
            base_url=base_url,
            api_style=api_style,
            api_key=api_key,
            secret_box=secret_box,
            actor="seed",
        )
        upstreams[upstream.name] = upstream  # names are slug-01 .. slug-NN
        upstream_vendor[upstream.name] = vendor_slug

    upstream_models: dict[tuple[str, str], object] = {}
    index_to_upstream = {i: up for i, up in enumerate(upstreams.values())}
    for index, models in UPSTREAM_MODELS.items():
        upstream = index_to_upstream[index]
        for name, model_type, _priced in models:
            model = crud.create_upstream_model(
                session, upstream_id=upstream.id, name=name, model_type=model_type,
                actor="seed",
            )
            if name in UPSTREAM_PRICES:
                # ticket 05：模型级成本（CNY/1M 词元）+ 倍率；花费 = 成本 × markup
                input_micro, output_micro = UPSTREAM_PRICES[name]
                model.cost_input_per_1m = Decimal(input_micro) / Decimal(1_000_000)
                model.cost_output_per_1m = Decimal(output_micro) / Decimal(1_000_000)
                model.markup = Decimal("1.2000")
            upstream_models[(upstream.name, name)] = model

    public_models: dict[str, object] = {}
    targets: dict[tuple[str, str], object] = {}
    for public_name, mode, note, rows in PUBLIC_MODELS:
        public = crud.create_public_model(
            session, name=public_name, note=note, routing_mode=mode, actor="seed"
        )
        public_models[public_name] = public
        for index, model_name, priority, weight in rows:
            upstream_name = index_to_upstream[index].name
            target = crud.create_model_target(
                session,
                public_model_id=public.id,
                upstream_model_id=upstream_models[(upstream_name, model_name)].id,
                priority=priority,
                weight=weight,
                actor="seed",
            )
            targets[(public_name, upstream_name, model_name)] = target

    users: dict[str, object] = {}
    keys: dict[str, object] = {}
    key_texts: dict[str, str] = {}
    root = user_tree.ensure_root_user(session)
    users[root.name] = root
    for name, initial_micro, topups, parent_name, role in USERS:
        user = crud.create_user(
            session,
            name=name,
            parent_user_id=users[parent_name].id,
            role=role,
            actor="seed",
        )
        users[name] = user
        issued = client_keys.issue_client_key(
            session, user_id=user.id, box=aes_box, length=64
        )
        keys[name] = issued
        key_texts[name] = issued.plaintext
        # Initial credit is booked as topups so the ledger explains the balance.
        first = topups[0]
        balances.record_topup(
            session, user_id=user.id, amount_micro=first, currency=CNY,
            created_by="owner", note="开户充值",
        )
        if len(topups) > 1:
            balances.record_topup(
                session, user_id=user.id, amount_micro=initial_micro - first,
                currency=CNY, created_by="owner", note="追加充值",
            )
        else:
            assert first == initial_micro

    # ---------------- price books ----------------
    effective = now - 30 * DAY_MS
    for index, models in UPSTREAM_MODELS.items():
        upstream = index_to_upstream[index]
        vendor = vendors[upstream_vendor[upstream.name]]
        for model_name, _model_type, priced in models:
            if not priced:
                continue
            input_micro, output_micro = UPSTREAM_PRICES[model_name]
            for item, unit in (("input", input_micro), ("output", output_micro)):
                prices.create_upstream_price(
                    session, vendor_id=vendor.id, upstream_model=model_name,
                    item=item, unit_price_micro=unit, currency=CNY,
                    effective_from_ms=effective,
                )

    for public_name, _mode, _note, _rows in PUBLIC_MODELS:
        prices.create_charge_price(
            session,
            public_model_id=public_models[public_name].id,
            item="request",
            mode="markup",
            value=12_000,  # 1.2x over cost
            currency=CNY,
            effective_from_ms=effective,
        )
    prices.put_fx_snapshot(session, currency=USD, rate_micro=7_250_000, source="seed")

    # ---------------- 7 days of usage ----------------
    public_names = list(TRAFFIC)
    weights = [TRAFFIC[name] for name in public_names]
    up_name_by_index = {i: up.name for i, up in index_to_upstream.items()}
    target_rows_by_public: dict[str, list[tuple[int, str]]] = {}
    for public_name, _mode, _note, rows in PUBLIC_MODELS:
        target_rows_by_public[public_name] = [
            (index, model_name) for index, model_name, _p, _w in rows
        ]

    event_count = 0
    unpriced_planned = 0
    start_day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    for day_offset in range(6, -1, -1):
        day_start = start_day - timedelta(days=day_offset)
        per_day = rng.randint(30, 40)
        for i in range(per_day):
            public_name = rng.choices(public_names, weights=weights, k=1)[0]
            user_names = [name for name in users if name in keys]
            user_name = rng.choice(user_names)
            created = day_start + timedelta(
                hours=rng.randint(8, 23), minutes=rng.randint(0, 59),
                seconds=rng.randint(0, 59),
            )
            started_at = int(created.timestamp() * 1000)

            if unpriced_planned < 3 and rng.random() < 0.03:
                # Deliberately unpriced: the upstream model has no price row.
                unpriced_planned += 1
                upstream_name = up_name_by_index[1]
                upstream_model = "glm-4.5-air"
            else:
                index, upstream_model = rng.choice(target_rows_by_public[public_name])
                upstream_name = up_name_by_index[index]

            is_embedding = "embed" in public_name or upstream_model.startswith(("embed", "bge"))
            input_tokens = rng.randint(120, 900) if is_embedding else rng.randint(200, 3200)
            output_tokens = 0 if is_embedding else rng.randint(40, 1400)
            cache_read = 0 if is_embedding else rng.randint(0, input_tokens // 3)
            status = 200
            roll = rng.random()
            if roll < 0.025:
                status = 500
            elif roll < 0.04:
                status = 429
            duration = rng.randint(280, 900) if is_embedding else rng.randint(900, 5200)
            ttft = 0 if is_embedding else rng.randint(120, 1400)
            session.add(
                GatewayUsageEventORM(
                    event_id=f"seed_evt_{day_offset}_{i:03d}",
                    started_at_ms=started_at,
                    completed_at_ms=started_at + duration,
                    duration_ms=duration,
                    time_to_first_token_ms=ttft,
                    http_status=status,
                    public_model=public_name,
                    upstream_model=upstream_model,
                    provider=upstreams[upstream_name].id,
                    api_key_id=keys[user_name].key_id,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_tokens=input_tokens + output_tokens,
                    cache_read_tokens=cache_read,
                    cache_write_tokens=0,
                    raw_json=json.dumps(
                        {"seed": True, "model": public_name, "status": status},
                        ensure_ascii=False,
                    ),
                    ingested_at_ms=now,
                )
            )
            event_count += 1
    session.flush()
    saved_cost_refresh = usage_ingest.refresh_cost_daily
    saved_user_refresh = usage_ingest.refresh_user_daily
    usage_ingest.refresh_cost_daily = lambda session, day=None: day or ""
    usage_ingest.refresh_user_daily = lambda session, day=None: day or ""
    try:
        billing = usage_ingest.process_billing(session)
    finally:
        usage_ingest.refresh_cost_daily = saved_cost_refresh
        usage_ingest.refresh_user_daily = saved_user_refresh
    session.flush()
    event_days = {
        _day_of_ms(row.started_at_ms or 0)
        for row in session.scalars(select(GatewayUsageEventORM)).all()
    }
    _rebuild_daily(session, event_days, CNY)
    billing["daily_days"] = len(event_days)

    # ---------------- availability rules ----------------
    crud.create_availability_rule(
        session,
        kind="ban",
        scope="model_target",
        scope_id=targets[("qwen-max", "local-02", "qwen2.5-32b")].id,
        note="连续超时，人工封禁待查",
        actor="owner",
    )
    crud.create_availability_rule(
        session,
        kind="cooldown",
        scope="model_target",
        scope_id=targets[("glm-flash", "zai-03", "glm-5.3-air")].id,
        recurrence="once",
        expires_at_ms=now + 2 * 3_600_000,
        note="429 限流自动冷却 2 小时",
        actor="system",
    )
    # ---------------- config revisions ----------------
    revision_one = ConfigRevisionORM(
        id=new_id("rev"),
        artifact=yaml_placeholder("seed-revision-1"),
        artifact_hash=sha256_hex("seed-revision-1"),
        adapter_id="agentgateway",
        operator="张三",
        reason="首次上线：3 厂商 / 6 上游 / 8 对外模型",
        status="superseded",
        previous_revision_id=None,
        created_at_ms=now - 3 * DAY_MS,
    )
    revision_two = ConfigRevisionORM(
        id=new_id("rev"),
        artifact=yaml_placeholder("seed-revision-2"),
        artifact_hash=sha256_hex("seed-revision-2"),
        adapter_id="agentgateway",
        operator="李四",
        reason="新增 qwen-max 权重路由与冷却规则",
        status="active",
        previous_revision_id=revision_one.id,
        created_at_ms=now - 12 * 3_600_000,
    )
    session.add_all([revision_one, revision_two])
    session.flush()
    put_setting(session, "active_revision", json.dumps({"id": revision_two.id}), now)
    put_setting(session, "report_currency", json.dumps(CNY), now)
    for key, value in (
        ("base_currency", CNY),
        ("timezone", "Asia/Shanghai"),
        ("log_retention_days", 30),
        ("audit_retention_days", 180),
        ("default_tokens_per_minute", 60_000),
        ("default_concurrency", 8),
    ):
        put_setting(session, key, json.dumps(value), now)

    # 种子数据已经使用 AG 1.7 语义（数值小优先），打上 v2 标记后
    # migrate_priority_v2.py 再跑就是 no-op，不会把数据翻回去（ticket 08/19）。
    put_setting(
        session,
        SEMANTICS_KEY,
        json.dumps({"semantics": SEMANTICS_V2, "migrated_at_ms": now}),
        now,
    )

    # 策略 / 护栏 / MCP 样例（ticket 11/19）：形态与 AG 1.7 validate-only
    # 集成测试覆盖的一致，页面打开就能看到可编辑的真实文档。
    policy_config = json.loads(json.dumps(policy_store.DEFAULT_POLICY_CONFIG))
    policy_config["cors"].update(
        {"enabled": True, "allow_origins": ["https://console.example.com"]}
    )
    policy_config["local_rate_limit"] = {
        "requests_per_minute": 600,
        "tokens_per_minute": 120_000,
    }
    policy_config["timeout"] = {
        "request_timeout": "60s",
        "backend_request_timeout": "55s",
        "response_idle_timeout": "30s",
    }
    policy_store.save_policy_config(session, policy_config)
    policy_store.save_guardrail_config(
        session,
        {
            "streaming": "Disabled",
            "request": [
                {
                    "kind": "regex",
                    "action": "mask",
                    "scope": ["messages"],
                    "rules": [{"builtin": "ssn"}],
                }
            ],
            "response": [
                {
                    "kind": "webhook",
                    "action": "reject",
                    "webhook_target": "https://audit.example",
                    "failure_mode": "failOpen",
                }
            ],
        },
    )
    policy_store.save_mcp_config(
        session,
        {
            "servers": [
                {
                    "name": "files",
                    "transport": "stdio",
                    "host": "",
                    "url": "",
                    "port": None,
                    "path": "",
                    "cmd": "npx",
                    "args": ["server-fs"],
                    "env": {},
                },
                {
                    "name": "remote",
                    "transport": "sse",
                    "host": "https://mcp.example",
                    "url": "",
                    "port": None,
                    "path": "",
                    "cmd": "",
                    "args": [],
                    "env": {},
                },
            ],
            "port": None,
        },
    )

    # ---------------- 管理员（RBAC 三角色；默认密码仅用于演示，首次登录后修改） ----------------
    # ADR-019：控制台账号直接写在统一的 users 行上（username 不可改，控制台
    # 访问 = 有角色且有密码）；代理用户只能看自己的子树（ticket 04）。
    demo_password = os.environ.get("SLIPSTREAM_DEMO_ADMIN_PASSWORD", "admin12345")
    console_accounts = (
        ("admin", "admin", "内部平台"),
        ("lisi", "agent", "数据分析组"),
        ("wangwu", "user", "试用-临时"),
    )
    for username, role, consumer_name in console_accounts:
        row = users[consumer_name]
        row.username = username
        row.password_hash = auth.hash_password(demo_password)
        row.role = role
        row.updated_at_ms = now - 24 * 3_600_000
    session.add(
        AuditLogORM(
            id=new_id("aud"), actor="李四", action="apply_config",
            entity_type="config_revision", entity_id=revision_two.id,
            detail_json=json.dumps({"reason": "新增 qwen-max 权重路由与冷却规则"}),
            created_at_ms=now - 12 * 3_600_000,
        )
    )
    session.commit()
    return {
        "vendors": len(vendors),
        "upstreams": len(upstreams),
        "upstream_models": len(upstream_models),
        "public_models": len(public_models),
        "targets": len(targets),
        "users": len(users),
        "keys": key_texts,
        "events": event_count,
        "unpriced_events": unpriced_planned,
        "billing": billing,
        "revisions": [revision_one.id, revision_two.id],
        "active_revision": revision_two.id,
    }


def yaml_placeholder(tag: str) -> str:
    """Small human-readable artifact stand-in for the archived render output."""
    return (
        "# Slipstream rendered agentgateway config (seed artifact)\n"
        "config:\n  database:\n    url: sqlite:///ag-data.db\n"
        "llm:\n  port: 3600\n  providers:\n    - name: " + tag + "\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the Slipstream demo database")
    parser.add_argument("--keep", action="store_true", help="do not drop existing tables")
    parser.add_argument("--seed", type=int, default=42, help="random seed (default 42)")
    args = parser.parse_args()

    settings = get_settings()
    engine = make_engine(settings.database_url)
    if not args.keep:
        Base.metadata.drop_all(engine)
    init_db(engine)
    session_factory = make_sessionmaker(engine)

    summary: dict[str, object]
    with session_factory() as session:
        if args.keep and session.scalars(select(UserORM).limit(1)).first() is not None:
            raise SystemExit(
                "数据库中已有数据：--keep 只用于空 schema。\n"
                "要重建演示数据，请直接运行（默认会 DROP 全部表并重新 seed）：\n"
                "  PYTHONPATH=src python scripts/seed_demo.py"
            )
        roles.ensure_builtin_roles(session)
        summary = seed(session, random.Random(args.seed))

    print("数据库:", settings.database_url)
    print(
        "写入: "
        f"厂商 {summary['vendors']} / 上游 {summary['upstreams']} / "
        f"上游模型 {summary['upstream_models']} / 对外模型 {summary['public_models']} / "
        f"目标 {summary['targets']} / 用户 {summary['users']} / "
        f"用量事件 {summary['events']}（其中未定价 {summary['unpriced_events']}）"
    )
    print("计费:", json.dumps(summary["billing"], ensure_ascii=False))
    print("配置版本:", " / ".join(summary["revisions"]), "（active:",
          summary["active_revision"], "）")
    print()
    print("客户端密钥（演示用，明文只在此处出现；库里只存 hash + 密文）:")
    for user_name, key in summary["keys"].items():
        print(f"  {user_name}: {key}")
    print()
    if os.environ.get("SLIPSTREAM_DEMO_ADMIN_PASSWORD"):
        print("登录账号: admin / (来自 SLIPSTREAM_DEMO_ADMIN_PASSWORD；其余账号同密码)")
    else:
        print("登录账号: admin / admin12345  ← 默认演示密码，首次登录后请立即修改")
    print("角色演示: lisi(代理用户) / wangwu(普通用户)，共用同一密码")
    print()
    print("现在可以: cd slipstream/api && uvicorn l06_api.app:create_app --factory --port 3700")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
