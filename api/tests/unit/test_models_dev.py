"""W4-H: models.dev snapshot parse / match / adopt semantics (offline fixture).

The fixture (tests/fixtures/models_dev_api.json) is a trimmed slice of the real
models.dev api.json: two vendor providers (anthropic, zhipuai) plus one
aggregator mirror (aihubmix) of the same exact model id, so the merge order and
fill-blank rules are exercised against real payload shapes without network.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from l01_core.timeutil import now_ms
from l04_repo.base import init_db
from l04_repo.orm import FxSnapshotORM, UpstreamModelORM, UpstreamORM, VendorORM
from l05_service import models_dev

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "models_dev_api.json"
USD_RATE_MICRO = 7_200_000  # micro-CNY per 1 USD used across the assertions


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    init_db(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False, future=True)
    with factory() as session:
        session.add(VendorORM(id="v1", name="V", slug="v", created_at_ms=now_ms()))
        session.add(
            UpstreamORM(
                id="u1", vendor_id="v1", name="up", base_url="https://x", created_at_ms=now_ms()
            )
        )
        session.add(
            FxSnapshotORM(
                currency="USD", as_of_ms=now_ms(), rate_micro=USD_RATE_MICRO, created_at_ms=now_ms()
            )
        )
        session.commit()
    yield factory


def _fixture_payload() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _seed_model(factory, *, name: str, parameters_json: str = "", **costs) -> str:
    with factory() as session:
        row = UpstreamModelORM(
            id="m-" + name.replace("/", "-").replace(".", "-"),
            upstream_id="u1",
            name=name,
            model_type="chat",
            parameters_json=parameters_json,
            created_at_ms=now_ms(),
            **costs,
        )
        session.add(row)
        session.commit()
        return row.id


# --------------------------------------------------------------------- fetch


def test_fetch_parses_and_enforces_size_cap(monkeypatch):
    monkeypatch.setattr(models_dev, "FETCH_BACKOFF_SECONDS", 0)
    payload = {"provider": {"models": {}}}
    ok = httpx.MockTransport(
        lambda request: httpx.Response(200, content=json.dumps(payload).encode())
    )
    assert models_dev.fetch_snapshot(transport=ok) == payload

    oversize = httpx.MockTransport(
        lambda request: httpx.Response(
            200, headers={"content-length": str(models_dev.MAX_RESPONSE_BYTES + 1)}
        )
    )
    with pytest.raises(models_dev.ModelsDevError):
        models_dev.fetch_snapshot(transport=oversize)

    bad_json = httpx.MockTransport(lambda request: httpx.Response(200, content=b"{nope"))
    with pytest.raises(models_dev.ModelsDevError):
        models_dev.fetch_snapshot(transport=bad_json)

    server_error = httpx.MockTransport(lambda request: httpx.Response(503))
    with pytest.raises(models_dev.ModelsDevError):
        models_dev.fetch_snapshot(transport=server_error)


# ------------------------------------------------------------------- refresh


def test_refresh_snapshot_replaces_and_counts(session_factory):
    with session_factory() as session:
        counts = models_dev.refresh_snapshot(session, _fixture_payload(), fetched_at_ms=123)
        session.commit()
        assert counts == {"providers": 3, "models": 5, "fetched_at_ms": 123}
        rows = list(session.scalars(select(models_dev.ModelDevSnapshotORM)))
        zhipu = next(row for row in rows if row.provider == "zhipuai" and row.model == "glm-4.6")
        params = json.loads(zhipu.params_json)
        assert params["limit"] == {"context": 204800, "output": 131072}
        assert "cost" not in params  # cost lives in pricing_json
        assert json.loads(zhipu.pricing_json)["input"] == 0.6

        # Snapshot semantics: a second, smaller fetch fully replaces the table.
        models_dev.refresh_snapshot(session, {"a": {"models": {"x": {}}}}, fetched_at_ms=456)
        session.commit()
        assert len(list(session.scalars(select(models_dev.ModelDevSnapshotORM)))) == 1


# -------------------------------------------------------------------- match


def test_match_exact_first_then_unique_case_insensitive(session_factory):
    with session_factory() as session:
        models_dev.refresh_snapshot(session, _fixture_payload(), fetched_at_ms=1)
        session.commit()

        matched, rows = models_dev.match_snapshots(session, "glm-4.6")
        assert matched
        # Exact dupes merge richest-first: the vendor row outruns the mirror.
        assert rows[0].provider == "zhipuai"

        matched, _rows = models_dev.match_snapshots(session, "GLM-4.6")
        assert not matched  # case-insensitive hit is AMBIGUOUS (two mirrors): no guessing

        matched, rows = models_dev.match_snapshots(session, "Claude-Sonnet-4-5")
        assert matched and rows[0].provider == "anthropic"  # unique case-insensitive hit

        matched, _rows = models_dev.match_snapshots(session, "glm-4.6-v")  # substring: never fuzzy
        assert not matched


# -------------------------------------------------------------------- adopt


def test_adopt_fills_only_blank_keys(session_factory):
    model_id = _seed_model(factory=session_factory, name="glm-4.6")
    with session_factory() as session:
        row = session.get(UpstreamModelORM, model_id)
        result = models_dev.adopt_model(session, row, fetch=_fixture_payload)
        session.commit()
        assert result["matched"] and result["status"] == models_dev.FILLED
        assert set(result["filled"]) == {
            "parameters.max_input_tokens",
            "parameters.max_output_tokens",
            "parameters.tool_call",
            "parameters.reasoning",
            "parameters.input_types",
            "parameters.output_types",
            "cost_input_per_1m",
            "cost_output_per_1m",
        }
        assert result["results"]["parameters.structured_output"] == models_dev.SKIPPED_MANUAL
        params = json.loads(row.parameters_json)
        assert params["max_input_tokens"] == 204_800
        assert params["max_output_tokens"] == 131_072
        assert params["tool_call"] is True
        assert params["input_types"] == ["text"]
        # USD 0.6 x 7.2 = CNY 4.32 per 1M
        assert row.cost_input_per_1m == Decimal("4.32")
        assert row.cost_output_per_1m == Decimal("15.84")
        assert row.params_source == "models.dev"


def test_adopt_never_overwrites_manual_values(session_factory):
    manual = (
        '{"max_input_tokens":131072,"max_output_tokens":4096,"input_types":["text","image"],'
        '"output_types":["text","audio"],"tool_call":false,"reasoning":false,'
        '"attachment":false,"structured_output":false}'
    )
    model_id = _seed_model(
        factory=session_factory,
        name="glm-4.6",
        parameters_json=manual,
        cost_input_per_1m=Decimal("12.5"),
    )
    with session_factory() as session:
        row = session.get(UpstreamModelORM, model_id)
        result = models_dev.adopt_model(session, row, fetch=_fixture_payload)
        session.commit()
        params = json.loads(row.parameters_json)
        assert params["max_input_tokens"] == 131_072  # manual stays
        assert params["max_output_tokens"] == 4096  # manual stays
        assert params["input_types"] == ["text", "image"]  # manual stays
        assert params["output_types"] == ["text", "audio"]  # manual stays
        assert row.cost_input_per_1m == Decimal("12.5")  # priced by hand: stays
        # Blank keys still fill; booleans are never downgraded to False.
        assert result["results"]["parameters.max_input_tokens"] == models_dev.SKIPPED_MANUAL
        assert result["results"]["cost_input_per_1m"] == models_dev.SKIPPED_MANUAL
        assert result["results"]["cost_output_per_1m"] == models_dev.FILLED
        assert row.cost_output_per_1m == Decimal("15.84")
        # Nothing became models.dev that the user had typed; at least one param
        # filled flips the badge, so it IS models.dev here but limits stayed.
        assert row.params_source == "models.dev"


def test_adopt_skips_cost_without_fx_rate(session_factory):
    model_id = _seed_model(factory=session_factory, name="claude-sonnet-4-5")
    engine_session = session_factory()
    with engine_session as session:
        session.query(FxSnapshotORM).delete()
        session.commit()
        row = session.get(UpstreamModelORM, model_id)
        result = models_dev.adopt_model(session, row, fetch=_fixture_payload)
        session.commit()
        assert result["results"]["cost_input_per_1m"] == models_dev.SKIPPED_NO_FX
        assert result["results"]["cost_output_per_1m"] == models_dev.SKIPPED_NO_FX
        assert row.cost_input_per_1m is None  # unpriced stays unpriced, never 0
        assert json.loads(row.parameters_json)["max_input_tokens"] == 200_000
        assert row.params_source == "models.dev"


def test_adopt_no_match_writes_nothing(session_factory):
    model_id = _seed_model(factory=session_factory, name="no-such-model")
    with session_factory() as session:
        row = session.get(UpstreamModelORM, model_id)
        result = models_dev.adopt_model(session, row, fetch=_fixture_payload)
        session.commit()
        assert result["matched"] is False and result["status"] == models_dev.NO_MATCH
        assert row.parameters_json == "" and row.params_source == "manual"
        assert row.cost_input_per_1m is None


def test_adopt_degrades_to_stored_snapshot_when_offline(session_factory):
    model_id = _seed_model(factory=session_factory, name="glm-4.6")

    def _broken_fetch() -> dict:
        raise models_dev.ModelsDevError("网络不可用")

    with session_factory() as session:
        # First run seeds the snapshot from the fixture (simulating a previous success).
        row = session.get(UpstreamModelORM, model_id)
        models_dev.adopt_model(session, row, fetch=_fixture_payload)
        session.commit()

    with session_factory() as session:
        row = session.get(UpstreamModelORM, model_id)
        row.parameters_json = ""  # blank again, snapshot already stored
        session.commit()
        result = models_dev.adopt_model(session, row, fetch=_broken_fetch)
        session.commit()
        assert result["refreshed"] is False  # degraded, but still adopted
        assert result["matched"] and result["status"] == models_dev.FILLED
        assert json.loads(row.parameters_json)["max_input_tokens"] == 204_800


def test_adopt_all_reports_summary(session_factory):
    _seed_model(factory=session_factory, name="glm-4.6")
    _seed_model(factory=session_factory, name="no-such-model")
    with session_factory() as session:
        summary = models_dev.adopt_all(session, fetch=_fixture_payload)
        session.commit()
    assert summary["refreshed"] is True
    assert summary["total"] == 2
    assert summary["matched"] == 1
    assert summary["no_match"] == 1
    assert summary["filled_models"] == 1
    assert summary["filled_keys"] == 8
