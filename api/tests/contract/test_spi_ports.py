"""W6 ticket 01: the SPI port contract and the fake driver's structural fit.

These tests are the executable half of docs/SYSTEM-BOUNDARY.md / ADR-029: every
bundled driver must expose the same standard ports, and the fake driver must be
usable without a real data plane. They intentionally test the public port
surface, not the private helpers behind it.
"""

from __future__ import annotations

import shutil
import sqlite3
from collections.abc import Sequence
from pathlib import Path
from uuid import uuid4

import pytest

from l02_domain.ir import TransformsSpec
from l02_domain.models import AttemptSink as DomainAttemptSink
from l02_domain.models import RequestAttempt
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.fake import FakeAdapter
from l03_adapters.mock import MockAdapter
from l03_adapters.registry import create
from l03_adapters.spi import (
    AttemptSink,
    ClientContract,
    CredentialFile,
    DataPlaneAdapter,
    LogPayload,
    MaterializationResult,
    TelemetryHandle,
    TransformPreview,
)

#: The six business ports added in W6 ticket 01, plus the two lifecycle methods.
PORT_METHODS = (
    "read_log_payload",
    "prune_logs",
    "preview_transforms",
    "materialize_credentials",
    "client_contract",
    "capability_note",
    "start_telemetry",
    "stop_telemetry",
)

_API_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def workdir():
    """Repo-local scratch dir (the host sandbox denies mkdtemp outside the repo)."""
    path = _API_ROOT / (".tmp-spi-" + uuid4().hex[:8])
    path.mkdir()
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def test_spi_declares_the_six_ports_and_telemetry_lifecycle() -> None:
    for name in PORT_METHODS:
        assert name in DataPlaneAdapter.__dict__, f"SPI is missing the {name} port"


def test_attempt_sink_is_part_of_the_spi_contract() -> None:
    # The domain owns the value type; the SPI is the stable import surface upper
    # layers and adapters share (ADR-028 + ADR-029).
    assert AttemptSink is DomainAttemptSink


@pytest.mark.parametrize("driver_name", ["fake", "mock", "agentgateway"])
def test_bundled_drivers_satisfy_the_structural_protocol(
    driver_name: str, workdir, monkeypatch
) -> None:
    monkeypatch.setenv("SLIPSTREAM_AG_BINARY", "")
    if driver_name == "agentgateway":
        from l01_core.settings import reset_settings_cache

        reset_settings_cache()
        adapter = AgentgatewayAdapter(config_dir=str(workdir), ag_binary="")
    else:
        adapter = create(driver_name, config_dir=str(workdir))
    assert isinstance(adapter, DataPlaneAdapter)
    for name in PORT_METHODS:
        assert callable(getattr(adapter, name))


def test_fake_driver_is_registered_but_not_a_ui_choice() -> None:
    adapter = create("fake")
    assert isinstance(adapter, FakeAdapter)
    # "Not a UI choice": the registry can build it for tests, while the console
    # keeps seeing only the configured adapter id (settings/data plane), not a
    # picker populated from the registry.
    assert isinstance(adapter.describe().adapter_id, str)


def test_fake_driver_serves_every_business_port() -> None:
    adapter = FakeAdapter()

    assert adapter.health().healthy is True
    assert adapter.status().config_hash is None
    assert adapter.read_log_payload("evt_missing") is None
    adapter.seed_payload("evt_1", request_prompt_json='{"prompt": "hello"}')
    assert adapter.read_log_payload("evt_1") == LogPayload(
        event_id="evt_1", request_prompt_json='{"prompt": "hello"}'
    )

    preview = adapter.preview_transforms(TransformsSpec())
    assert isinstance(preview, TransformPreview)
    assert isinstance(preview.after, dict)

    contract = adapter.client_contract()
    assert isinstance(contract, ClientContract)
    assert contract.endpoints
    assert all(endpoint.path.startswith("/") for endpoint in contract.endpoints)

    assert adapter.capability_note("observe.request_log")
    assert adapter.capability_note("no.such.capability") == ""

    first = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret-a")]
    )
    assert isinstance(first, MaterializationResult)
    assert first.written == ("ups_a#1",)
    second = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#2", plaintext="secret-b")]
    )
    assert second.written == ("ups_a#2",)
    assert second.stale == ("ups_a#1",)
    assert second.deleted == ("ups_a#1",)
    assert second.dry_run is False

    adapter.seed_payload("evt_old", request_prompt_json="{}")
    counts = adapter.prune_logs(30)
    # Two seeded payloads: evt_1 from the port test above and evt_old here.
    assert counts["request_log_payloads"] == 2
    assert adapter.read_log_payload("evt_old") is None
    assert adapter.pruned_retention_days == [30]


def test_fake_driver_runs_the_telemetry_lifecycle() -> None:
    from fastapi import FastAPI

    adapter = FakeAdapter()
    app = FastAPI()
    captured: list[RequestAttempt] = []

    def sink(attempts: Sequence[RequestAttempt]) -> int:
        captured.extend(attempts)
        return len(attempts)

    handle = adapter.start_telemetry(app, sink)
    assert isinstance(handle, TelemetryHandle)
    assert adapter.telemetry_sink is sink
    adapter.stop_telemetry(handle)
    assert adapter.telemetry_sink is None


def test_agentgateway_driver_ports_keep_the_existing_contract(workdir) -> None:
    from l01_core.settings import reset_settings_cache

    reset_settings_cache()
    db_path = workdir / "ag-data.db"
    adapter = AgentgatewayAdapter(
        config_dir=str(workdir), ag_db_path=str(db_path), ag_binary=""
    )

    contract = adapter.client_contract()
    paths = {endpoint.path for endpoint in contract.endpoints}
    assert contract.default_port == 3600
    assert {"/v1/chat/completions", "/v1/models", "/v1/embeddings"} <= paths
    assert adapter.capability_note("observe.request_attempts")

    preview = adapter.preview_transforms(TransformsSpec())
    assert isinstance(preview, TransformPreview)
    assert isinstance(preview.after, dict)

    assert adapter.prune_logs(30) == {"request_logs": 0, "request_log_payloads": 0}

    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "CREATE TABLE request_log_payloads (log_id TEXT PRIMARY KEY, "
            "request_prompt_json TEXT, response_completion_json TEXT)"
        )
        connection.execute(
            "INSERT INTO request_log_payloads VALUES ('evt_1', '{\"p\": 1}', '{\"c\": 2}')"
        )
        connection.commit()
    finally:
        connection.close()
    assert adapter.read_log_payload("evt_1") == LogPayload(
        event_id="evt_1",
        request_prompt_json='{"p": 1}',
        response_completion_json='{"c": 2}',
    )

    key_path = workdir / "keys" / "ups_a#1.key"
    written = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret-a", path=str(key_path))]
    )
    assert written.written == (str(key_path),)
    assert key_path.read_text(encoding="utf-8") == "secret-a"
    stale_path = key_path.with_name("ups_a#0.key")
    stale_path.write_text("old", encoding="utf-8")
    pruned = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret-a", path=str(key_path))]
    )
    assert str(stale_path) in pruned.stale
    assert not stale_path.exists()


def test_mock_driver_ports_are_inert_but_usable() -> None:
    adapter = MockAdapter()
    assert adapter.read_log_payload("evt_missing") is None
    assert adapter.preview_transforms(TransformsSpec()).after == {}
    assert adapter.client_contract().endpoints == ()
    assert adapter.prune_logs(30) == {"request_logs": 0, "request_log_payloads": 0}
    assert adapter.materialize_credentials([]).written == ()
    assert adapter.capability_note("routing.priority_failover") == ""
    assert adapter.start_telemetry(None, lambda attempts: 0) is None
    adapter.stop_telemetry(None)


#: Ticket 02: the payload/retention contract is one assertion set run on the
#: fake driver and the real one (docs/SYSTEM-BOUNDARY.md section 8).
LOG_CONTRACT_DRIVERS = ("fake", "agentgateway")

#: Far inside the retention window, so the real driver's day-granular prune
#: removes every seeded row the same way the fake clears its store.
_EXPIRED_STARTED_AT = "2020-01-01T00:00:00+00:00"


@pytest.fixture(params=LOG_CONTRACT_DRIVERS, ids=("fake", "agentgateway"))
def log_contract(request, workdir):
    """(adapter, seed) pairs: seed stores one payload through the driver's own
    write seam, everything after that is shared port-level assertions."""
    if request.param == "fake":
        adapter = FakeAdapter()

        def seed(event_id: str, prompt: str, completion: str) -> None:
            adapter.seed_payload(
                event_id,
                request_prompt_json=prompt,
                response_completion_json=completion,
            )

        return adapter, seed

    db_path = workdir / "ag-data.db"
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            "CREATE TABLE request_logs (id TEXT PRIMARY KEY, started_at TEXT);"
            "CREATE TABLE request_log_payloads (log_id TEXT PRIMARY KEY,"
            " request_prompt_json TEXT, response_completion_json TEXT);"
        )
        connection.commit()
    finally:
        connection.close()

    def ag_seed(event_id: str, prompt: str, completion: str) -> None:
        connection = sqlite3.connect(db_path)
        try:
            connection.execute(
                "INSERT INTO request_logs (id, started_at) VALUES (?, ?)",
                (event_id, _EXPIRED_STARTED_AT),
            )
            connection.execute(
                "INSERT INTO request_log_payloads VALUES (?, ?, ?)",
                (event_id, prompt, completion),
            )
            connection.commit()
        finally:
            connection.close()

    return (
        AgentgatewayAdapter(config_dir=str(workdir), ag_db_path=str(db_path), ag_binary=""),
        ag_seed,
    )


def test_log_payload_and_retention_ports_share_one_contract(log_contract) -> None:
    """The same port assertions hold for the fake and the real driver.

    Read: unknown events are None, stored bodies round-trip as LogPayload with
    the exact wire fields. Retention: a fresh store is a zero-count no-op, a
    prune removes the stored bodies and reports per-table int counts.
    """
    adapter, seed = log_contract

    assert adapter.prune_logs(30) == {"request_logs": 0, "request_log_payloads": 0}
    assert adapter.read_log_payload("evt_missing") is None

    seed("evt_p1", '{"prompt": "你好"}', '{"completion": true}')
    seed("evt_expired", "{}", "")
    assert adapter.read_log_payload("evt_p1") == LogPayload(
        event_id="evt_p1",
        request_prompt_json='{"prompt": "你好"}',
        response_completion_json='{"completion": true}',
    )
    assert adapter.read_log_payload("evt_expired") == LogPayload(
        event_id="evt_expired",
        request_prompt_json="{}",
        response_completion_json="",
    )

    counts = adapter.prune_logs(30)
    assert counts["request_log_payloads"] == 2
    assert isinstance(counts["request_logs"], int)
    assert counts["request_logs"] >= 0
    assert adapter.read_log_payload("evt_p1") is None
    assert adapter.read_log_payload("evt_expired") is None
