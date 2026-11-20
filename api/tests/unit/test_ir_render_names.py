"""Ticket 16: render names must stay safe as provider names AND key file names.

ADR-026 expands one key into provider `{upstream_id}#{seq}` with key file
`keys/{upstream_id}#{seq}.key`, and one model into `{model_id}#k{seq}`.
Validation must (a) keep accepting those `#`-suffixed names, and (b) reject base
ids that would break the managed key path on either OS (path separators, Windows
reserved characters, control chars) or that make the `#` protocol ambiguous
(a `#` may only be the key-sequence suffix).
"""

from __future__ import annotations

import pytest

from l02_domain.ir import (
    GatewayIR,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
)
from l02_domain.validation import validate_gateway_ir


def _ir(*, upstream_id="ups#1", model_id="m#k1", key_file="keys/ups#1.key") -> GatewayIR:
    return GatewayIR(
        revision="r1",
        upstreams=(
            UpstreamSpec(
                id=upstream_id,
                base_url="https://example.com",
                api_style="openai_chat",
                key_file=key_file,
            ),
        ),
        models=(
            UpstreamModelSpec(
                id=model_id,
                upstream_id=upstream_id,
                upstream_model_name="glm-5.3",
                model_type="chat",
            ),
        ),
        public_models=(
            PublicModelSpec(
                name="pub",
                targets=(TargetSpec(id="t1", upstream_model_id=model_id, priority=0),),
            ),
        ),
        api_keys=(),
    )


def test_expanded_hash_names_stay_valid():
    """Golden regression: E18 names with '#' are the normal render output."""
    result = validate_gateway_ir(_ir())
    assert result.ok, result.errors


@pytest.mark.parametrize(
    "upstream_id", ["ups/a", "ups\\\\a", "ups:a", "ups|a", "ups*?a"]
)
def test_path_separators_and_reserved_chars_in_provider_id_are_rejected(upstream_id):
    result = validate_gateway_ir(_ir(upstream_id=upstream_id, key_file="keys/x.key"))
    assert not result.ok
    assert any("跨平台" in error for error in result.errors), result.errors


def test_control_chars_in_provider_id_are_rejected():
    result = validate_gateway_ir(_ir(upstream_id="ups\x00a", key_file="keys/x.key"))
    assert not result.ok
    assert any("跨平台" in error for error in result.errors), result.errors


@pytest.mark.parametrize("model_id", ["m/k1", "m:k1", "m?k1", "m*k1"])
def test_unsafe_model_alias_is_rejected(model_id):
    result = validate_gateway_ir(_ir(model_id=model_id))
    assert not result.ok
    assert any("跨平台" in error for error in result.errors), result.errors


@pytest.mark.parametrize("upstream_id", ["ups#key", "ups#1#2", "#1"])
def test_hash_must_be_the_key_sequence_suffix(upstream_id):
    result = validate_gateway_ir(_ir(upstream_id=upstream_id, key_file="keys/x.key"))
    assert not result.ok
    assert any("密钥序号" in error for error in result.errors), result.errors


def test_model_hash_must_be_the_model_alias_suffix():
    result = validate_gateway_ir(_ir(model_id="m#1"))
    assert not result.ok
    assert any("密钥序号" in error for error in result.errors), result.errors


def test_key_file_cannot_escape_the_managed_directory():
    result = validate_gateway_ir(_ir(key_file="keys/../outside.key"))
    assert not result.ok
    assert any(".." in error for error in result.errors), result.errors


def test_plain_ids_without_hash_stay_valid():
    result = validate_gateway_ir(_ir(upstream_id="ups", model_id="m1", key_file="keys/ups.key"))
    assert result.ok, result.errors
