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
from l04_repo.orm import FxSnapshotORM, UpstreamModelORM, UpstreamORM
from l05_service import models_dev

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "models_dev_api.json"
#: Seeded so the tests can prove W9 cost adoption ignores fx and stores USD.
USD_RATE_MICRO = 7_200_000  # micro-CNY per 1 USD, deliberately NOT applied


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
        session.add(
            UpstreamORM(
                id="u1", name="up", base_url="https://x", created_at_ms=now_ms()
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


def test_fetch_is_one_request_with_60s_timeout_and_no_retries():
    """W9: one GET, hard 60 s timeout, ZERO automatic retries (user clicks again)."""
    assert models_dev.FETCH_TIMEOUT_SECONDS == 60.0
    assert not hasattr(models_dev, "FETCH_RETRIES")
    assert not hasattr(models_dev, "FETCH_BACKOFF_SECONDS")

    payload = {"provider": {"models": {}}}
    calls = {"n": 0}

    def _ok(request):
        calls["n"] += 1
        return httpx.Response(200, content=json.dumps(payload).encode())

    assert models_dev.fetch_snapshot(transport=httpx.MockTransport(_ok)) == payload
    assert calls["n"] == 1  # exactly one HTTP request for a success

    failures = {"n": 0}

    def _fail(request):
        failures["n"] += 1
        return httpx.Response(503)

    with pytest.raises(models_dev.ModelsDevError):
        models_dev.fetch_snapshot(transport=httpx.MockTransport(_fail))
    assert failures["n"] == 1  # a failure is surfaced immediately, never retried

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


def test_match_vendor_prefixed_name_against_bare_models_dev_id(session_factory):
    """W9: upstream names may be vendor-prefixed; compare the BASENAME.

    minimaxai/minimax-m3.1-flash must match models.dev's bare
    minimax-m3.1-flash, and the vendor prefix is also a provider clue that
    prefers the minimax row over the nvidia mirror.
    """
    payload = {
        "nvidia": {
            "models": {
                "minimax-m3.1-flash": {
                    "limit": {"context": 800_000, "output": 64_000},
                    "cost": {"input": 0.25, "output": 0.9},
                }
            }
        },
        "minimax": {
            "models": {
                "minimax-m3.1-flash": {
                    "limit": {"context": 1_000_000, "output": 131_072},
                    "modalities": {"input": ["text", "image"], "output": ["text"]},
                    "cost": {"input": 0.15, "output": 0.6},
                    "tool_call": True,
                }
            }
        },
    }
    model_id = _seed_model(
        factory=session_factory, name="minimaxai/minimax-m3.1-flash"
    )
    with session_factory() as session:
        models_dev.refresh_snapshot(session, payload, fetched_at_ms=1)
        session.commit()

        matched, rows = models_dev.match_snapshots(
            session, "minimaxai/minimax-m3.1-flash"
        )
        assert matched
        assert {row.provider for row in rows} == {"minimax", "nvidia"}

        row = session.get(UpstreamModelORM, model_id)
        result = models_dev.adopt_model(session, row, fetch=lambda: payload)
        session.commit()
        assert result["matched"] is True
        assert result["provider"] == "minimax"  # provider clue from the prefix
        params = json.loads(row.parameters_json)
        assert params["max_input_tokens"] == 1_000_000  # max of the duplicate group
        assert params["max_output_tokens"] == 131_072
        # The matching provider's own quote wins over the pricier mirror.
        assert row.cost_input_per_1m == Decimal("0.15")
        assert row.cost_output_per_1m == Decimal("0.6")


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
        # W9: USD costs are stored AS USD (no fx_snapshots conversion); the
        # fixture row also carries a USD fx rate, which must be ignored.
        assert row.cost_input_per_1m == Decimal("0.6")
        assert row.cost_output_per_1m == Decimal("2.2")
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
        assert row.cost_output_per_1m == Decimal("2.2")  # USD, unconverted
        # Nothing became models.dev that the user had typed; at least one param
        # filled flips the badge, so it IS models.dev here but limits stayed.
        assert row.params_source == "models.dev"


def test_adopt_stores_usd_cost_without_fx_conversion(session_factory):
    """W9: the cost book is USD, so models.dev prices are stored as-is.

    No fx_snapshots rate is needed (and none may be applied): the old CNY
    conversion would have produced 3 x 7.2 = 21.6 here.
    """
    model_id = _seed_model(factory=session_factory, name="claude-sonnet-4-5")
    with session_factory() as session:
        session.query(FxSnapshotORM).delete()
        session.commit()
        row = session.get(UpstreamModelORM, model_id)
        result = models_dev.adopt_model(session, row, fetch=_fixture_payload)
        session.commit()
        assert result["results"]["cost_input_per_1m"] == models_dev.FILLED
        assert result["results"]["cost_output_per_1m"] == models_dev.FILLED
        assert row.cost_input_per_1m == Decimal("3")  # USD, unconverted
        assert row.cost_output_per_1m == Decimal("15")
        assert models_dev.SKIPPED_NO_FX not in result["results"].values()
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


# ------------------------------------------------------- duplicate model rows


def test_duplicate_group_merges_limits_modalities_and_reasoning(session_factory):
    """W9: many providers publish the same model id; merge the whole group.

    Limits take the group maximum (including the flat max_* spelling some
    mirrors use), modalities and effort levels take the union, capability flags
    OR. reasoning_options entries of type toggle/budget_tokens name no discrete
    level and must not fabricate one.
    """
    payload = {
        "aaa-provider": {
            "models": {
                "merged-model": {
                    "limit": {"context": 100_000, "output": 8_000},
                    "modalities": {
                        "input": ["text", "image"],
                        "output": ["text"],
                    },
                    "reasoning": True,
                    "reasoning_options": [
                        {"type": "effort", "values": ["low", "medium"]},
                        {"type": "toggle"},
                    ],
                    "tool_call": True,
                    "cost": {"input": 1.0, "output": 2.0},
                }
            }
        },
        "zzz-provider": {
            "models": {
                "merged-model": {
                    "limit": {"context": 200_000, "output": 4_000},
                    "max_input_tokens": 300_000,  # flat mirror spelling
                    "modalities": {
                        "input": ["text", "audio"],
                        "output": ["text", "embedding"],
                    },
                    "reasoning": False,
                    "reasoning_options": [
                        {"type": "effort", "values": ["minimal", "high"]},
                        {"type": "budget_tokens"},
                    ],
                    "attachment": True,
                    "cost": {"input": 0.5, "output": 3.0},
                }
            }
        },
    }
    model_id = _seed_model(factory=session_factory, name="merged-model")
    with session_factory() as session:
        row = session.get(UpstreamModelORM, model_id)
        result = models_dev.adopt_model(session, row, fetch=lambda: payload)
        session.commit()
        assert result["matched"] is True
        params = json.loads(row.parameters_json)
        assert params["max_input_tokens"] == 300_000  # max, not first/last
        assert params["max_output_tokens"] == 8_000  # max(8000, 4000)
        assert set(params["input_types"]) == {"text", "image", "audio"}
        assert set(params["output_types"]) == {"text", "embedding"}
        assert params["tool_call"] is True and params["attachment"] is True
        assert params["reasoning"] is True  # OR of the flags
        assert params["reasoning_levels"] == [
            "default",
            "minimal",
            "low",
            "medium",
            "high",
        ]
        assert params["default_reasoning_level"] == "default"
        assert (
            result["results"]["parameters.reasoning_levels"] == models_dev.FILLED
        )
        # No provider clue matches -> conservative max USD fallback, no average.
        assert row.cost_input_per_1m == Decimal("1.0")
        assert row.cost_output_per_1m == Decimal("3.0")


def test_duplicate_group_prefers_provider_price_then_max_fallback(session_factory):
    """W9: duplicate prices -> provider-matching row wins; else group maximum.

    An upstream named nvidia must take models.dev's nvidia quote (0.8) instead
    of the pricier openrouter mirror (3.0); an upstream with no provider match
    falls back to the conservative group maximum, never an average.
    """
    preferred_payload = {
        "openrouter": {
            "models": {
                "preferred-model": {
                    "limit": {"context": 100_000, "output": 8_000},
                    "cost": {"input": 3.0, "output": 9.0},
                }
            }
        },
        "nvidia": {
            "models": {
                "preferred-model": {
                    "limit": {"context": 200_000, "output": 16_000},
                    "cost": {"input": 0.8, "output": 4.0},
                }
            }
        },
    }
    fallback_payload = {
        "openrouter": {
            "models": {
                "fallback-model": {
                    "limit": {"context": 100_000},
                    "cost": {"input": 1.0, "output": 9.0},
                }
            }
        },
        "nvidia": {
            "models": {
                "fallback-model": {
                    "limit": {"context": 200_000},
                    "cost": {"input": 2.0, "output": 3.0},
                }
            }
        },
    }
    preferred_id = _seed_model(factory=session_factory, name="preferred-model")
    fallback_id = _seed_model(factory=session_factory, name="fallback-model")
    with session_factory() as session:
        upstream = session.get(UpstreamORM, "u1")
        upstream.name = "nvidia"
        session.commit()

        preferred = session.get(UpstreamModelORM, preferred_id)
        preferred_result = models_dev.adopt_model(
            session, preferred, fetch=lambda: preferred_payload
        )
        session.commit()
        assert preferred_result["provider"] == "nvidia"
        assert preferred.cost_input_per_1m == Decimal("0.8")
        assert preferred.cost_output_per_1m == Decimal("4.0")
        # Parameter merge is independent of the provider preference.
        assert json.loads(preferred.parameters_json)["max_input_tokens"] == 200_000

        upstream.name = "acme-proxy"  # no models.dev provider matches this
        session.commit()
        fallback = session.get(UpstreamModelORM, fallback_id)
        fallback_result = models_dev.adopt_model(
            session, fallback, fetch=lambda: fallback_payload
        )
        session.commit()
        assert fallback_result["matched"] is True
        assert fallback.cost_input_per_1m == Decimal("2.0")  # max(1.0, 2.0)
        assert fallback.cost_output_per_1m == Decimal("9.0")  # max(9.0, 3.0)
