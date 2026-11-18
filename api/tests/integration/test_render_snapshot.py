"""Render determinism (4.5), AG 1.7 array shapes, priority/Target mapping,
ADR-010 defaults and E5 internal visibility. Assertions read the emitted YAML
text (keys unquoted, string scalars quoted by yaml_dumps)."""

from __future__ import annotations

import pytest

from l01_core.settings import reset_settings_cache
from l02_domain.ir import (
    ClientKeySpec,
    GatewayIR,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
    UserBalanceSpec,
)
from l02_domain.transforms_codec import parse_transforms
from l03_adapters.agentgateway.render import render_artifact
from l03_adapters.mock import MockAdapter


def _ir(transforms_payload=None, users=True, routing_mode="failover", models=None) -> GatewayIR:
    transforms = parse_transforms(transforms_payload) if transforms_payload else None
    upstream = UpstreamSpec(
        id="ups_a",
        base_url="https://api.example.com/v1",
        api_style="openai_chat",
        key_file="./.data_store/ag-config/keys/ups_a.key",
        transforms=transforms,
        max_buffer_bytes=4_194_304,
    )
    return GatewayIR(
        revision="rev_test",
        upstreams=(upstream,),
        models=models or (UpstreamModelSpec("umdl_a", "ups_a", "internal-secret-name", "chat"),),
        public_models=(
            PublicModelSpec(
                "flagship",
                (TargetSpec("mt_a", "umdl_a", 1),),
                routing_mode=routing_mode,
            ),
        ),
        api_keys=(
            ClientKeySpec(id="key_a", key_hash="sha256:abc", user_id="usr_a", key_suffix="abcd"),
        ),
        users=(UserBalanceSpec(id="usr_a", balance_tokens=5_000),) if users else (),
    )


def test_render_is_byte_identical_twice():
    reset_settings_cache()
    artifact_one = render_artifact(_ir(), llm_port=3600)
    artifact_two = render_artifact(_ir(), llm_port=3600)
    assert artifact_one.content == artifact_two.content
    assert artifact_one.hash == artifact_two.hash


def test_list_item_keys_align_under_first_key():
    # Dependency-free YAML structural guard (venv has no pyyaml): keys of a
    # list-item dict must align exactly two columns past the dash.
    reset_settings_cache()
    content = render_artifact(_ir(), llm_port=3600).content
    lines = content.splitlines()
    dash = next(i for i, ln in enumerate(lines) if ln.lstrip().startswith("- name: flagship"))
    routing = next(i for i, ln in enumerate(lines) if ln.lstrip().startswith("routing:"))
    dash_indent = len(lines[dash]) - len(lines[dash].lstrip())
    routing_indent = len(lines[routing]) - len(lines[routing].lstrip())
    assert routing_indent == dash_indent + 2


def test_user_balance_is_not_faked_as_a_rate_limit_bucket():
    reset_settings_cache()
    content = render_artifact(_ir(), llm_port=3600).content
    # E12: one maxTokens per rule, so per-user prepaid balances cannot be a bucket.
    assert "buckets:" not in content
    assert "localRateLimit:" not in content
    assert "maxTokens: 5000" not in content
    assert "resets on restart" in content  # ledger-authority caveat in header


def test_keyhash_and_metadata_not_plaintext():
    reset_settings_cache()
    content = render_artifact(_ir(), llm_port=3600).content
    assert 'keyHash: "sha256:abc"' in content
    assert "user_id: usr_a" in content
    assert "sk-" not in content  # no client plaintext ever renders


def test_default_actions_only_two_header_deletes():
    reset_settings_cache()
    payload = {
        "response_headers": [{"op": "update", "name": "x-served-by", "value": "slip"}],
        "request_headers": [{"op": "update", "name": "x-trace", "value": "slip"}],
    }
    content = render_artifact(_ir(transforms_payload=payload), llm_port=3600).content
    assert '"x-powered-by"' in content  # ADR-010 #1: builtin header deletes only
    assert "server" in content
    # W1: no implicit response.code < 400 condition is injected into user rows.
    assert "response.code" not in content
    assert "responseHeaders:" in content


def test_upstream_response_body_raises_instead_of_being_dropped():
    reset_settings_cache()
    payload = {"response_body": [{"op": "update", "path": "done", "value": "true"}]}
    with pytest.raises(ValueError, match="response_body"):
        render_artifact(_ir(transforms_payload=payload), llm_port=3600)


def test_request_transforms_mount_on_the_model_and_stay_internal():
    reset_settings_cache()
    payload = {
        "request_headers": [{"op": "update", "name": "x-trace", "value": "slip"}],
        "request_body": [{"op": "update", "path": "temperature", "value": "0.2"}],
    }
    content = render_artifact(_ir(transforms_payload=payload), llm_port=3600).content
    assert "requestTransformation:" in content
    assert 'merge({\\"' in content  # CEL map literal (" escaped inside YAML)
    assert "maxBufferSize" not in content  # no AG 1.7 surface
    assert "visibility: internal" in content  # E5: upstream models are internal
    assert "- name: umdl_a" in content
    assert 'model: "internal-secret-name"' in content
    assert "priority: 1" in content  # failover mode carries priority


def test_weighted_routing_keeps_ir_order():
    reset_settings_cache()
    models = (
        UpstreamModelSpec("umdl_a", "ups_a", "internal-secret-name", "chat"),
        UpstreamModelSpec("umdl_b", "ups_a", "second-model", "chat"),
    )
    base = _ir(users=False, models=models)
    ir = GatewayIR(
        revision=base.revision,
        upstreams=base.upstreams,
        models=base.models,
        public_models=(
            PublicModelSpec(
                "flagship",
                (
                    TargetSpec("mt_w1", "umdl_a", 0, weight=1),
                    TargetSpec("mt_w2", "umdl_b", 0, weight=2),
                ),
                routing_mode="weighted",
            ),
        ),
        api_keys=(),
        users=(),
    )
    content = render_artifact(ir, llm_port=3600).content
    assert "weighted:" in content
    assert "weight: 2" in content
    # W4: weight is a relative integer ratio, not a sort key - IR order is kept.
    chain_pos = content.index("weighted:")
    assert content.index("umdl_a", chain_pos) < content.index("umdl_b", chain_pos)


def test_no_target_public_model_never_renders():
    ir = GatewayIR(
        revision="rev_empty",
        upstreams=(),
        models=(),
        public_models=(PublicModelSpec("ghost", ()),),
        api_keys=(),
        users=(),
    )
    reset_settings_cache()
    artifact = render_artifact(ir, llm_port=3600)
    assert "virtualModels: []" in artifact.content
    adapter = MockAdapter()
    assert adapter.render(ir).content.count("ghost") == 1
