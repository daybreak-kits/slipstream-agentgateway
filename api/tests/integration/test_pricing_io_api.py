"""ADR-020 price JSON export/import API: /admin/prices/export + /admin/prices/import.

Model rows are the authority (ADR-020); the import is all-or-nothing (ADR-023
dry-run): any per-line error means nothing is written. Cache prices are out of
scope for v1 (meta.cache_prices = "not_included_v1").
"""

from __future__ import annotations

from decimal import Decimal

from tests.conftest import _app_client, make_admin, new_session_token, seed_channel

from l01_core.timeutil import now_ms
from l04_repo.orm import UpstreamModelORM
from l06_api.deps import SESSION_COOKIE

EXPORT_URL = "/admin/prices/export"
IMPORT_URL = "/admin/prices/import"


def _model_row(factory, model_id: str = "umdl_test") -> tuple:
    """(cost_in, cost_out, markup, enabled, model_type) read inside one session."""
    with factory() as session:
        row = session.get(UpstreamModelORM, model_id)
        assert row is not None, model_id
        return (
            row.cost_input_per_1m,
            row.cost_output_per_1m,
            row.markup,
            row.enabled,
            row.model_type,
        )


def _add_model(factory, model_id: str, name: str) -> None:
    """A second model row, e.g. to make a name ambiguous across upstreams."""
    with factory() as session:
        session.add(
            UpstreamModelORM(
                id=model_id,
                upstream_id="ups_test",
                name=name,
                model_type="chat",
                created_at_ms=now_ms(),
            )
        )
        session.commit()


def _as_user(factory, role: str = "user"):
    browser = _app_client(factory)
    admin_id = make_admin(factory, username="pricing-io-" + role, role=role)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return browser


def test_export_shape_and_seed_values(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    data = client.get(EXPORT_URL).json()
    assert data["schema_version"] == 1
    assert data["meta"] == {"cache_prices": "not_included_v1"}
    assert data["exported_at_ms"] > 0
    assert data["upstream_models"] == [
        {
            "id": "umdl_test",
            "name": "glm-5.3",
            "model_type": "chat",
            "cost_input_per_1m": None,  # seed model is unpriced
            "cost_output_per_1m": None,
            # ADR-020: a model row with no markup configured bills at 1.2.
            "markup": "1.2000",
        }
    ]

    # Priced rows export the same string form as the model list endpoint.
    patched = client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    assert patched.status_code == 200, patched.text
    row = client.get(EXPORT_URL).json()["upstream_models"][0]
    assert row["cost_input_per_1m"] == "2.500000"
    assert row["cost_output_per_1m"] == "10.000000"
    assert row["markup"] == "1.2000"


def test_import_updates_rows_and_keeps_non_price_fields(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )

    # Body isomorphic to the export file (meta/exported_at_ms tolerated, model_type ignored).
    resp = client.post(
        IMPORT_URL,
        json={
            "schema_version": 1,
            "exported_at_ms": 1731974400000,
            "meta": {"cache_prices": "not_included_v1"},
            "upstream_models": [
                {
                    "id": "umdl_test",
                    "name": "glm-5.3",
                    "model_type": "chat",
                    "cost_input_per_1m": "3.5",
                    "markup": "2",
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"changed": 1, "missing": [], "skipped": 0}
    cost_in, cost_out, markup, enabled, model_type = _model_row(factory)
    assert cost_in == Decimal("3.500000")
    assert cost_out == Decimal("10.000000")  # absent field = untouched
    assert markup == Decimal("2.0000")
    assert enabled is True
    assert model_type == "chat"

    # Re-importing the unedited export file is a stable no-op on values.
    exported = client.get(EXPORT_URL).json()
    again = client.post(IMPORT_URL, json=exported)
    assert again.status_code == 200, again.text
    assert again.json()["changed"] == 1
    assert _model_row(factory)[:3] == (
        Decimal("3.500000"),
        Decimal("10.000000"),
        Decimal("2.0000"),
    )


def test_import_by_name_and_blank_fields_are_untouched(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.patch("/admin/upstream-models/umdl_test", json={"markup": "1.2"})

    # name locator works when id is absent; only the provided field moves.
    resp = client.post(
        IMPORT_URL, json={"upstream_models": [{"name": "glm-5.3", "cost_input_per_1m": "4"}]}
    )
    assert resp.status_code == 200, resp.text
    cost_in, cost_out, markup, *_ = _model_row(factory)
    assert cost_in == Decimal("4.000000")
    assert cost_out is None
    assert markup == Decimal("1.2000")

    # Blank rows (locator only / null / "") change nothing and are counted as skipped.
    for blanks in (
        {"id": "umdl_test"},
        {"id": "umdl_test", "cost_input_per_1m": None, "markup": None},
        {"id": "umdl_test", "cost_input_per_1m": "", "markup": ""},
    ):
        resp = client.post(IMPORT_URL, json={"upstream_models": [blanks]})
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"changed": 0, "missing": [], "skipped": 1}
    assert _model_row(factory)[:3] == (
        Decimal("4.000000"),
        None,
        Decimal("1.2000"),
    )


def test_import_unknown_or_ambiguous_rows_fail_without_writes(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.patch("/admin/upstream-models/umdl_test", json={"markup": "1.2"})

    def _post(rows):
        return client.post(IMPORT_URL, json={"upstream_models": rows})

    # Unknown id does NOT fall back to the name of another row in the same file.
    resp = _post([{"id": "umdl_missing", "name": "glm-5.3", "markup": "3"}])
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert len(body["details"]["errors"]) == 1
    error = body["details"]["errors"][0]
    assert error["index"] == 0
    assert error["id"] == "umdl_missing"
    assert "未知上游模型 id" in error["message"]

    # Unknown name; locator-less row.
    assert "未知上游模型" in _post([{"name": "no-such-model"}]).json()["details"]["errors"][0][
        "message"
    ]
    assert "缺少 id 或 name" in _post([{"markup": "2"}]).json()["details"]["errors"][0]["message"]

    # Ambiguous name: two upstream models share the display name.
    _add_model(factory, "umdl_test2", "glm-5.3")
    resp = _post([{"name": "glm-5.3", "markup": "3"}])
    assert resp.status_code == 422
    assert "重名歧义" in resp.json()["details"]["errors"][0]["message"]

    # dry-run: a valid line next to a broken one must not land either.
    resp = _post(
        [
            {"id": "umdl_test", "cost_input_per_1m": "9"},
            {"id": "umdl_missing", "markup": "3"},
        ]
    )
    assert resp.status_code == 422
    assert _model_row(factory)[0] is None  # the good row was not written


def test_import_value_bounds_and_duplicates_fail(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)

    def _first_message(rows):
        resp = client.post(IMPORT_URL, json={"upstream_models": rows})
        assert resp.status_code == 422, resp.text
        return resp.json()["details"]["errors"][0]["message"]

    # Same bounds as the single-row editor (validate_cost / validate_markup).
    assert "大于 0" in _first_message([{"id": "umdl_test", "markup": "0"}])
    assert "不能超过 100" in _first_message([{"id": "umdl_test", "markup": "100.0001"}])
    assert "不能为负数" in _first_message([{"id": "umdl_test", "cost_input_per_1m": "-0.01"}])
    # Non-numeric garbage is caught by the pydantic envelope (loc names the row field).
    resp = client.post(
        IMPORT_URL, json={"upstream_models": [{"id": "umdl_test", "cost_input_per_1m": "abc"}]}
    )
    assert resp.status_code == 422
    assert resp.json()["details"]["errors"][0]["loc"] == [
        "upstream_models",
        0,
        "cost_input_per_1m",
    ]

    # Inclusive bounds pass: markup 100 and zero cost are legal.
    resp = client.post(
        IMPORT_URL,
        json={
            "upstream_models": [
                {"id": "umdl_test", "markup": "100", "cost_input_per_1m": "0"}
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    assert _model_row(factory)[:3] == (Decimal("0.000000"), None, Decimal("100.0000"))

    # Duplicate entries: same id twice, and id + name resolving to the same row.
    assert "重复条目" in _first_message(
        [
            {"id": "umdl_test", "markup": "2"},
            {"id": "umdl_test", "markup": "3"},
        ]
    )
    assert "重复条目" in _first_message(
        [
            {"id": "umdl_test", "markup": "2"},
            {"name": "glm-5.3", "markup": "3"},
        ]
    )
    assert _model_row(factory)[2] == Decimal("100.0000")  # rejected batch stayed dry


def test_import_rejects_bad_envelopes(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)

    assert client.post(IMPORT_URL, json={"schema_version": 2, "upstream_models": [
        {"id": "umdl_test", "markup": "2"}
    ]}).status_code == 422
    assert client.post(IMPORT_URL, json={"upstream_models": []}).status_code == 422
    assert client.post(IMPORT_URL, json={}).status_code == 422
    # Non-price mutation attempts (enabled/cooldown) are rejected outright.
    assert client.post(IMPORT_URL, json={"upstream_models": [
        {"id": "umdl_test", "markup": "2", "enabled": False}
    ]}).status_code == 422
    assert client.post(IMPORT_URL, json={"upstream_models": [
        {"id": "umdl_test", "cooldown_until_ms": 123}
    ]}).status_code == 422
    assert _model_row(factory)[3] is True  # enabled untouched
    assert client.post(IMPORT_URL).status_code == 422  # body required


def test_export_filters_cost_fields_without_billing_cost_and_import_denied(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    # 普通用户有 upstream_models:read 但没有 billing:cost：导出可读，成本键整体缺席（§0.5）。
    browser = _as_user(factory, "user")
    data = browser.get(EXPORT_URL).json()
    assert data["schema_version"] == 1
    row = data["upstream_models"][0]
    assert row["id"] == "umdl_test"
    assert row["name"] == "glm-5.3"
    assert "cost_input_per_1m" not in row
    assert "cost_output_per_1m" not in row
    assert "markup" not in row

    # Import needs upstream_models:write, which 普通用户 does not have.
    denied = browser.post(
        IMPORT_URL, json={"upstream_models": [{"id": "umdl_test", "markup": "2"}]}
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"
    assert _model_row(factory)[2] == Decimal("1.2000")
