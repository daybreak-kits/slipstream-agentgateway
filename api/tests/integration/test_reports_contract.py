"""Report response models are the generated web contract (ticket 03).

Every v2 report route declares a *Out response_model in
l06_api/report_schemas.py; gen_ts.py turns those models into
web/src/generated/contract.ts, so both sides must agree on the wire shape.
Money keys are declared with a 0 default on purpose: the wire always carries
a number, and MoneyVisibilityMiddleware removes the key (never nulls it) when
the caller lacks billing:cost / billing:spend. That default makes the fields
optional in the generated TypeScript contract.
"""

from __future__ import annotations

REPORT_CONTRACTS = [
    (
        "/admin/reports/overview",
        "ReportsOverviewOut",
        (
            "requests",
            "error_count",
            "active_minutes",
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
            "charge_micro",
            "cost_micro",
            "margin_micro",
            "currency",
            "money_scope",
            "fx_missing",
            "latency_p50_ms",
            "latency_p95_ms",
            "ttft_p50_ms",
            "latency",
            "estimate_note",
        ),
    ),
    (
        "/admin/reports/latency",
        "LatencyReportOut",
        (
            "range",
            "from_ms",
            "to_ms",
            "timezone",
            "paired_samples",
            "min_samples",
            "ttft",
            "total",
            "all",
            "estimate_note",
        ),
    ),
    (
        "/admin/reports/timeseries",
        "TimeseriesReportOut",
        (
            "range",
            "bucket",
            "dimension",
            "metric",
            "metrics",
            "from_ms",
            "to_ms",
            "timezone",
            "currency",
            "points",
            "members",
            "totals",
            "metric_total",
            "folded_members",
            "fx_missing",
            "estimate_note",
        ),
    ),
    (
        "/admin/reports/heatmap",
        "HeatmapReportOut",
        (
            "range",
            "mode",
            "metric",
            "from_ms",
            "to_ms",
            "timezone",
            "currency",
            "columns",
            "rows",
            "max",
            "total",
            "fx_missing",
            "estimate_note",
        ),
    ),
    (
        "/admin/reports/flow",
        "FlowReportOut",
        (
            "metric",
            "nodes",
            "node_meta",
            "links",
            "stages",
            "totals",
            "currency",
            "fx_missing",
            "estimate_note",
            "range",
            "from_ms",
            "to_ms",
            "timezone",
        ),
    ),
]


def _schema_ref(spec: dict, path: str) -> str:
    operation = spec["paths"][path]["get"]
    return operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]


def test_report_routes_declare_response_models(client):
    spec = client.get("/openapi.json").json()
    for path, model, fields in REPORT_CONTRACTS:
        assert _schema_ref(spec, path) == f"#/components/schemas/{model}", path
        properties = spec["components"]["schemas"][model]["properties"]
        for field in fields:
            assert field in properties, f"{model}.{field}"
    # The legacy /admin/overview alias must expose the same payload contract.
    assert _schema_ref(spec, "/admin/overview") == "#/components/schemas/ReportsOverviewOut"


def test_report_money_fields_are_optional_in_contract(client):
    """Money defaults to 0 -> optional in TS, and the middleware never emits null."""
    spec = client.get("/openapi.json").json()
    schemas = spec["components"]["schemas"]
    cases = {
        "ReportsOverviewOut": ("charge_micro", "cost_micro", "margin_micro"),
        "ReportTotalsOut": ("cost_micro", "charge_micro"),
        "TimeseriesMemberOut": ("cost_micro", "charge_micro"),
        "FlowLinkOut": ("cost_micro", "charge_micro"),
        "FlowTotalsOut": ("cost_micro", "charge_micro"),
    }
    for model, money_fields in cases.items():
        schema = schemas[model]
        required = set(schema.get("required", []))
        for field in money_fields:
            assert field in schema["properties"], f"{model}.{field}"
            assert field not in required, f"{model}.{field} must stay optional"
            assert schema["properties"][field]["type"] == "integer", f"{model}.{field}"


def test_report_range_literals_cover_custom_and_all(client):
    spec = client.get("/openapi.json").json()
    schemas = spec["components"]["schemas"]

    def _enum(model: str, field: str) -> list[str]:
        return schemas[model]["properties"][field]["enum"]

    latency_range = _enum("LatencyReportOut", "range")
    assert {"today", "24h", "7d", "30d", "365d", "custom", "all"} == set(latency_range)
    assert "custom" in _enum("TimeseriesReportOut", "range")
    assert "custom" in _enum("HeatmapReportOut", "range")
    assert set(_enum("HeatmapReportOut", "metric")) == {"tokens", "cost_micro", "charge_micro"}
    assert set(_enum("TimeseriesReportOut", "metric")) >= {"requests", "cost_micro", "charge_micro"}
