"""Architecture review #6: one settings declaration, two renderers.

Seam: HTTP GET /admin/settings/schema + PUT /admin/settings. The schema must
cover exactly the keys GET returns, and every declared field's default must be
accepted by PUT while out-of-range values are rejected. The UI no longer keeps
its own field table, so this is the cross-seam contract.
"""

from __future__ import annotations

from l05_service import settings_schema


def test_schema_covers_every_served_setting(client):
    schema = client.get("/admin/settings/schema")
    assert schema.status_code == 200, schema.text
    groups = schema.json()["groups"]
    schema_keys = {field["key"] for group in groups for field in group["fields"]}
    served_keys = {item["key"] for item in client.get("/admin/settings").json()["items"]}
    assert schema_keys == served_keys == set(settings_schema.SETTING_FIELDS)
    assert len(groups) >= 4
    for group in groups:
        assert group["title"] and group["description"]
        for field in group["fields"]:
            assert field["label"] and field["description"]
            assert field["kind"] in {"text", "number", "select"}
            assert isinstance(field["default"], str)
            if field["kind"] == "select":
                assert field["options"], field["key"]


def test_every_default_is_accepted_by_put(client):
    for field in settings_schema.SETTING_FIELDS.values():
        response = client.put(
            "/admin/settings", json={"values": {field.key: field.default}}
        )
        assert response.status_code == 200, (field.key, response.text)
        assert response.json()["values"][field.key] == field.default.strip()


def test_out_of_range_values_are_rejected_without_overwriting(client):
    for field in settings_schema.SETTING_FIELDS.values():
        bad: str | None = None
        if field.value_type == "int":
            if field.min and field.min > 0:
                bad = str(field.min - 1)
            else:
                bad = str((field.max or 0) + 1)
        elif field.value_type == "currency":
            bad = "XXX"
        elif field.value_type == "url":
            bad = "ftp://x.example"
        elif field.value_type == "text" and field.default:
            bad = "  "
        if bad is None:
            continue
        response = client.put("/admin/settings", json={"values": {field.key: bad}})
        assert response.status_code == 422, (field.key, bad, response.text)
        served = client.get("/admin/settings").json()["items"]
        current = {item["key"]: item["value"] for item in served}
        assert current[field.key] == field.default, field.key


def test_validation_edges_are_422_and_do_not_overwrite(client):
    cases = [
        ("gateway_base_url", "http://[::1"),
        ("gateway_base_url", "http://exa mple.com/path"),
        ("gateway_base_url", "http://example.com:99999"),
        ("timezone", "Not/AZone"),
        ("timezone", {"tz": "UTC"}),
    ]
    for key, bad in cases:
        response = client.put("/admin/settings", json={"values": {key: bad}})
        assert response.status_code == 422, (key, bad, response.text)
    served = {item["key"]: item["value"] for item in client.get("/admin/settings").json()["items"]}
    assert served["gateway_base_url"] == ""
    assert served["timezone"] == "Asia/Shanghai"
    assert served["base_currency"] == "CNY"


def test_unknown_key_still_rejected_and_errors_name_known_set(client):
    response = client.put("/admin/settings", json={"values": {"default_rate_limit_rpm": "60"}})
    assert response.status_code == 422
    detail = response.json()["details"]
    assert detail["unknown"] == ["default_rate_limit_rpm"]
    assert "default_tokens_per_minute" in detail["known"]


def test_schema_requires_authentication(anon_client):
    assert anon_client.get("/admin/settings/schema").status_code == 401
