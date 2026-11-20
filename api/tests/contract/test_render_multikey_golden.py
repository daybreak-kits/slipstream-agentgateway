"""ADR-026/E18 golden: one upstream key expands into one independent AG upstream.

Shape pinned by E18 (cfg-E18-T1b-kn2-vm-faithful, docs/experiments/P0-RESULTS.md
§E18): per key a provider ``{upstream_id}#{seq}`` with its own key file, per
upstream-model × key one internal llm.models entry ``{model}#k{seq}``, and the
public model references every key entry as one same-priority target layer (P2C
概率分流，非均匀). Also pins the renderer's no-duplicate-name invariant: AG's
validate silently collapses same-name llm.models entries (E18 60:0), so the
control plane refuses them with ValueError instead.

E20 修正（P0-RESULTS §E20）：密钥维度的 target 展开只在 failover/weighted 成立；
conditional 模式不展开（AG first-match 首条独占，N-1 把密钥静默 0 流量），每个
target 只渲染第一把密钥的一条，无 when 兜底因此天然单条（AG 硬校验
``conditional fallback target must be last``）。
"""

from __future__ import annotations

import logging

from conftest import seed_channel
from l01_core.settings import reset_settings_cache
from l01_core.timeutil import now_ms
from l02_domain.ir import (
    ClientKeySpec,
    GatewayIR,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
)
from l03_adapters.agentgateway.render import render_config
from l03_adapters.mock import MockAdapter
from l04_repo.orm import ModelTargetORM, PublicModelORM, UpstreamKeyORM
from l05_service.rendering import build_render_plan, model_alias, provider_id


def _add_second_key(engine, factory) -> None:
    from l01_core.crypto import SecretBox

    with factory() as session:
        session.add(
            UpstreamKeyORM(
                id="upk_test_2",
                upstream_id="ups_test",
                label="备用账号",
                key_enc=SecretBox("test-secret").encrypt("raw-upstream-key-2"),
                key_suffix="ey-2",
                created_at_ms=now_ms() + 1,
            )
        )
        session.commit()


def test_two_keys_expand_into_two_provider_and_model_entries(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    _add_second_key(engine, factory)
    reset_settings_cache()
    adapter = MockAdapter()
    with factory() as session:
        ir, key_files = build_render_plan(session, revision="rev_multikey", adapter=adapter)
    engine.dispose()

    # providers: one per key, E18 names {upstream_id}#{seq}, own key file each
    assert [u.id for u in ir.upstreams] == [provider_id("ups_test", 1), provider_id("ups_test", 2)]
    assert [u.key_file[-len("ups_test#1.key"):] for u in ir.upstreams] == [
        "ups_test#1.key",
        "ups_test#2.key",
    ]
    assert len(key_files) == 2
    assert sorted(key_files.values()) == ["raw-upstream-key", "raw-upstream-key-2"]

    # models: {model}#k{seq} entries, each referencing its key-provider
    assert [(m.id, m.upstream_id) for m in ir.models] == [
        (model_alias("umdl_test", 1), provider_id("ups_test", 1)),
        (model_alias("umdl_test", 2), provider_id("ups_test", 2)),
    ]
    assert all(m.upstream_model_name == "glm-5.3" for m in ir.models)

    # the public model carries one same-priority target per key (平权层)
    flagship = ir.public_models[0]
    assert flagship.name == "flagship"
    assert [t.upstream_model_id for t in flagship.targets] == [
        model_alias("umdl_test", 1),
        model_alias("umdl_test", 2),
    ]
    assert [t.priority for t in flagship.targets] == [1, 1]
    assert [t.id for t in flagship.targets] == ["mt_test#k1", "mt_test#k2"]

    # rendered config mirrors the E18 faithful shape
    config = render_config(ir, llm_port=3600)
    assert [p["name"] for p in config["llm"]["providers"]] == ["ups_test#1", "ups_test#2"]
    assert config["llm"]["providers"][0]["params"]["baseUrl"] == "https://upstream.example/v1"
    assert config["llm"]["providers"][0]["params"]["apiKey"]["file"].endswith("ups_test#1.key")
    assert [m["name"] for m in config["llm"]["models"]] == ["umdl_test#k1", "umdl_test#k2"]
    assert all(m["visibility"] == "internal" for m in config["llm"]["models"])
    assert all(m["params"]["model"] == "glm-5.3" for m in config["llm"]["models"])
    targets = config["llm"]["virtualModels"][0]["routing"]["failover"]["targets"]
    assert targets == [
        {"model": "umdl_test#k1", "priority": 1},
        {"model": "umdl_test#k2", "priority": 1},
    ]


def test_conditional_public_model_renders_one_entry_per_target(engine_and_sessionmaker):
    """E20 裁决：conditional 公开模型不展开密钥维度。

    同 when × N 条 #kN 在 AG validate 合法但运行时 first-match 首条独占
    （E20 T2：40:0，无告警），因此每个 target 只渲染第一把密钥的一条；无 when
    兜底随之单条且末位，满足 AG 硬校验 conditional fallback target must be
    last。上游模型条目仍逐把密钥展开（internal，与路由模式无关）。
    """
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    _add_second_key(engine, factory)
    with factory() as session:
        public = session.get(PublicModelORM, "pmdl_test")
        public.routing_mode = "conditional"
        session.add(
            ModelTargetORM(
                id="mt_test_when",
                public_model_id="pmdl_test",
                upstream_model_id="umdl_test",
                priority=0,
                when_expr='request.headers["x-route"] == "a"',
                created_at_ms=now_ms() + 5,
            )
        )
        session.commit()
        ir, _ = build_render_plan(session, revision="rev_cond", adapter=MockAdapter())
    engine.dispose()

    # 上游模型条目仍逐把密钥展开（两个 provider 各自的 internal 条目）
    assert [m.id for m in ir.models] == [
        model_alias("umdl_test", 1),
        model_alias("umdl_test", 2),
    ]

    flagship = ir.public_models[0]
    assert flagship.routing_mode == "conditional"
    # 每个 target 恰好一条，全部引用第一把密钥的别名；无 when 兜底单条且末位
    assert [(t.id, t.upstream_model_id) for t in flagship.targets] == [
        ("mt_test_when#k1", model_alias("umdl_test", 1)),
        ("mt_test#k1", model_alias("umdl_test", 1)),
    ]
    assert flagship.targets[-1].when == ""

    config = render_config(ir, llm_port=3600)
    assert config["llm"]["virtualModels"][0]["routing"]["conditional"]["targets"] == [
        {"model": "umdl_test#k1", "when": 'request.headers["x-route"] == "a"'},
        {"model": "umdl_test#k1"},
    ]


def test_conditional_multikey_render_logs_key_parity_warning(
    engine_and_sessionmaker, caplog
):
    """E20：conditional × 多密钥渲染时打 warning 日志（可用但密钥平权失效）。"""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    _add_second_key(engine, factory)
    with factory() as session:
        session.get(PublicModelORM, "pmdl_test").routing_mode = "conditional"
        session.commit()
        with caplog.at_level(logging.WARNING, logger="l05_service.rendering"):
            ir, _ = build_render_plan(session, revision="rev_cond_warn", adapter=MockAdapter())
    engine.dispose()

    messages = [record.getMessage() for record in caplog.records]
    assert any(
        "密钥平权不生效" in message and "ups_test" in message and "failover/weighted" in message
        for message in messages
    ), messages
    assert [t.id for t in ir.public_models[0].targets] == ["mt_test#k1"]


def test_weighted_public_model_still_expands_keys(engine_and_sessionmaker):
    """E20 对照：weighted（与 failover，见上方 golden）仍按 ADR-026/E18 展开。"""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    _add_second_key(engine, factory)
    with factory() as session:
        session.get(PublicModelORM, "pmdl_test").routing_mode = "weighted"
        session.get(ModelTargetORM, "mt_test").weight = 1
        session.commit()
        ir, _ = build_render_plan(session, revision="rev_weighted", adapter=MockAdapter())
    engine.dispose()

    flagship = ir.public_models[0]
    assert [(t.id, t.upstream_model_id, t.weight) for t in flagship.targets] == [
        ("mt_test#k1", model_alias("umdl_test", 1), 1),
        ("mt_test#k2", model_alias("umdl_test", 2), 1),
    ]


def test_render_refuses_duplicate_llm_model_names():
    """E18 不变量：同名 llm.models 条目渲染层直接拒绝（validate 抓不住）。"""
    ir = GatewayIR(
        revision="rev_dup",
        upstreams=(
            UpstreamSpec(
                id="ups_a", base_url="https://a.example/v1", api_style="openai_chat",
                key_file="keys/ups_a.key",
            ),
        ),
        models=(
            UpstreamModelSpec("umdl_a", "ups_a", "glm-5.3", "chat"),
            UpstreamModelSpec("umdl_a", "ups_a", "glm-5.3", "chat"),
        ),
        public_models=(
            PublicModelSpec("flagship", (TargetSpec("mt_a", "umdl_a", 1),)),
        ),
        api_keys=(ClientKeySpec(id="key_a", key_hash="sha256:abc"),),
    )
    try:
        render_config(ir, llm_port=3600)
    except ValueError as exc:
        assert "llm.models" in str(exc) and "同名" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("duplicate llm.models name must raise ValueError")


def test_keyless_enabled_upstream_blocks_the_rollout(engine_and_sessionmaker):
    """A keyless enabled upstream cannot render: every provider needs its own
    credential file (E17), and ADR-026 keeps the keyless state illegal (⑥)."""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    with factory() as session:
        from sqlalchemy import delete

        session.execute(delete(UpstreamKeyORM).where(UpstreamKeyORM.upstream_id == "ups_test"))
        session.commit()
        try:
            build_render_plan(session, revision="rev_nokey", adapter=MockAdapter())
        except Exception as exc:
            assert "没有可用密钥行" in str(getattr(exc, "message", exc))
        else:  # pragma: no cover
            raise AssertionError("keyless upstream must block the rollout")
    engine.dispose()
