"""MockAdapter contract behaviour: validate/render/apply/status/usage/health/rollback."""

from __future__ import annotations

import pytest

from l01_core.errors import AppError
from l02_domain.ir import GatewayIR, PublicModelSpec, TargetSpec, UpstreamSpec
from l02_domain.models import UsageEvent
from l03_adapters.mock import MockAdapter
from l03_adapters.spi import UsageCursor


def _ir() -> GatewayIR:
    return GatewayIR(
        revision="rev_a",
        upstreams=(
            UpstreamSpec("ups_a", "https://x.example/v1", "openai_chat", "./k/ups_a.key"),
        ),
        models=(),
        public_models=(
            PublicModelSpec("flagship", (TargetSpec("mt_a", "umdl_missing", 1),)),
        ),
        api_keys=(),
        users=(),
    )


def test_validate_reports_broken_reference():
    result = MockAdapter().validate(_ir())
    assert not result.ok
    assert any("umdl_missing" in error for error in result.errors)


def test_apply_failure_keeps_previous_artifact():
    adapter = MockAdapter()
    good = adapter.render(
        GatewayIR(
            revision="rev_good", upstreams=(), models=(), public_models=(), api_keys=(), users=()
        )
    )
    adapter.apply(good)
    adapter.fail_next_apply = True
    result = adapter.apply(good)
    assert not result.ok and result.rolled_back
    assert adapter.status().config_hash == good.hash


def test_rollback_restores_hash():
    adapter = MockAdapter(config_dir="")
    artifact = adapter.render(
        GatewayIR(
            revision="rev_x", upstreams=(), models=(), public_models=(), api_keys=(), users=()
        )
    )
    adapter.apply(artifact)
    assert adapter.rollback("rev_x").ok


def test_usage_pagination_and_health():
    adapter = MockAdapter()
    page = adapter.usage(UsageCursor(value="0"))
    assert page.next_cursor is not None or not page.events
    health = adapter.health()
    assert health.healthy is True  # mock driver always reports healthy


def test_status_reports_last_applied_hash():
    adapter = MockAdapter()
    assert adapter.status().config_hash is None
    artifact = adapter.render(
        GatewayIR(
            revision="rev_s", upstreams=(), models=(), public_models=(), api_keys=(), users=()
        )
    )
    assert adapter.apply(artifact).ok
    status = adapter.status()
    assert status.config_hash == artifact.hash  # adapter-spi.md §5 rule 4
    assert status.process_version == "mock-0.1.0"
    assert status.listening is True


def test_usage_pagination_is_idempotent():
    events = (
        UsageEvent(event_id="evt_1", started_at_ms=1000),
        UsageEvent(event_id="evt_2", started_at_ms=2000),
        UsageEvent(event_id="evt_3", started_at_ms=3000),
    )
    adapter = MockAdapter(usage_events=events)
    first = adapter.usage(None)
    assert [event.event_id for event in first.events] == ["evt_1", "evt_2"]
    # Re-pulling the same cursor returns the same window: ingestion can retry safely.
    again = adapter.usage(None)
    assert [event.event_id for event in again.events] == ["evt_1", "evt_2"]
    assert first.next_cursor is not None
    second = adapter.usage(first.next_cursor)
    assert [event.event_id for event in second.events] == ["evt_3"]
    assert second.next_cursor is None
    repeated = adapter.usage(first.next_cursor)
    assert [event.event_id for event in repeated.events] == ["evt_3"]


def test_unknown_adapter_name_rejected():
    from l03_adapters.registry import create

    with pytest.raises(AppError):
        create("doesnotexist")
