"""Ticket 03: the same credential/preview port contract on every bundled driver.

Seam: `materialize_credentials` and `preview_transforms` (the W6 ports the
system talks to). The assertion bodies below run unchanged against the fake
in-memory driver and the real agentgateway driver; only the per-driver table
differs (how it names a managed entry, and what its preview compiles to).
Disk-level whitelist details live in tests/unit/test_key_file_prune.py.
"""

from __future__ import annotations

import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import pytest

from l02_domain.ir import HeaderRule, TransformsSpec
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.fake import FakeAdapter
from l03_adapters.spi import CredentialFile, TransformPreview

_API_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class DriverContract:
    """One driver under test: a factory plus its port-level value literals."""

    name: str
    make: Callable[[str], object]
    #: The identifier the driver's MaterializationResult reports for one ref.
    managed_id: Callable[[str, str], str]
    #: The worked example its preview must compile the sample spec into.
    preview_after: dict


def _fake_driver(workdir: str) -> FakeAdapter:
    return FakeAdapter(config_dir=workdir)


def _agentgateway_driver(workdir: str) -> AgentgatewayAdapter:
    return AgentgatewayAdapter(config_dir=workdir, ag_binary="")


DRIVERS = (
    DriverContract(
        name="fake",
        make=_fake_driver,
        managed_id=lambda _workdir, ref: ref,
        preview_after={"fake": True, "rules": 0},
    ),
    DriverContract(
        name="agentgateway",
        make=_agentgateway_driver,
        managed_id=lambda workdir, ref: str(Path(workdir) / "keys" / f"{ref}.key"),
        preview_after={"request": {"set": {"x-trace": '"slip"'}}},
    ),
)


@pytest.fixture(params=[driver.name for driver in DRIVERS])
def driver(request, workdir):
    contract = next(item for item in DRIVERS if item.name == request.param)
    adapter = contract.make(str(workdir))
    workdir_str = str(workdir)

    def managed_id(ref: str) -> str:
        """The identifier this driver reports for one credential ref."""
        return contract.managed_id(workdir_str, ref)

    return contract, adapter, managed_id


@pytest.fixture()
def workdir():
    """Repo-local scratch dir (the host sandbox denies mkdtemp outside the repo)."""
    path = _API_ROOT / (".tmp-ports-" + uuid4().hex[:8])
    path.mkdir()
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _two_credentials() -> list[CredentialFile]:
    return [
        CredentialFile(ref="ups_a#1", plaintext="secret-a"),
        CredentialFile(ref="ups_a#2", plaintext="secret-b"),
    ]


def test_materialize_writes_the_requested_credentials(driver):
    _contract, adapter, managed_id = driver

    result = adapter.materialize_credentials(_two_credentials())

    assert result.dry_run is False
    assert result.written == (managed_id("ups_a#1"), managed_id("ups_a#2"))
    assert result.stale == () and result.deleted == () and result.failed == ()


def test_dry_run_reports_a_plan_and_writes_nothing(driver):
    _contract, adapter, managed_id = driver

    plan = adapter.materialize_credentials(_two_credentials(), dry_run=True)

    assert plan.dry_run is True
    assert plan.written == () and plan.deleted == ()
    # Nothing was written: the follow-up real pass starts from an empty store.
    followup = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret-a")]
    )
    assert followup.written == (managed_id("ups_a#1"),)
    assert followup.stale == (), "the dry-run pass must not have left credentials"


def test_cleanup_pass_prunes_everything_outside_the_whitelist(driver):
    _contract, adapter, managed_id = driver
    adapter.materialize_credentials(_two_credentials())

    result = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#2", plaintext="secret-b")]
    )

    assert result.stale == (managed_id("ups_a#1"),)
    assert result.deleted == (managed_id("ups_a#1"),)
    # The pruned credential is really gone from the managed surface.
    audit = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#2", plaintext="secret-b")], dry_run=True
    )
    assert audit.stale == ()


def test_write_phase_keeps_managed_refs_until_the_cleanup_pass(driver):
    """Rollout order contract: prune=False writes only; the later full pass prunes."""
    _contract, adapter, managed_id = driver
    adapter.materialize_credentials([CredentialFile(ref="ups_a#1", plaintext="secret-a")])

    written_only = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#2", plaintext="secret-b")], prune=False
    )

    assert written_only.written == (managed_id("ups_a#2"),)
    assert written_only.stale == () and written_only.deleted == ()
    audit = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#2", plaintext="secret-b")], dry_run=True
    )
    assert audit.stale == (managed_id("ups_a#1"),), "写阶段不得顺手清理"

    cleanup = adapter.materialize_credentials(
        [CredentialFile(ref="ups_a#2", plaintext="secret-b")]
    )
    assert cleanup.deleted == (managed_id("ups_a#1"),)


def test_preview_compiles_inside_the_driver_behind_the_port(driver):
    contract, adapter, _managed_id = driver

    preview = adapter.preview_transforms(
        TransformsSpec(request_headers=(HeaderRule(op="update", name="x-trace", value="slip"),))
    )

    assert isinstance(preview, TransformPreview)
    assert preview.after == contract.preview_after
    assert isinstance(preview.notes, tuple)
    assert preview.skipped == ()
