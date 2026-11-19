"""ADR-026/E18 golden: one upstream key expands into one independent AG upstream.

Shape pinned by E18 (cfg-E18-T1b-kn2-vm-faithful, docs/experiments/P0-RESULTS.md
§E18): per key a provider ``{upstream_id}#{seq}`` with its own key file, per
upstream-model × key one internal llm.models entry ``{model}#k{seq}``, and the
public model references every key entry as one same-priority target layer (P2C
概率分流，非均匀). Also pins the renderer's no-duplicate-name invariant: AG's
validate silently collapses same-name llm.models entries (E18 60:0), so the
control plane refuses them with ValueError instead.
"""

from __future__ import annotations

from l01_core.settings import reset_settings_cache
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
from l04_repo.orm import UpstreamKeyORM
from l05_service.rendering import build_render_plan, model_alias, provider_id
from l01_core.timeutil import now_ms

from conftest import seed_channel


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
