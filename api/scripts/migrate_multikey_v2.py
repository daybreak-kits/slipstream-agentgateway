"""Migrate upstreams to ADR-026 multi-key semantics (w4-d).

Dry-run by default: prints the planned changes. Pass --apply to write them and
to record the ``multikey_semantics=v2`` marker, after which the command is a
no-op. Per upstream the migration does two things, in this order:

1. materialize a legacy inline credential: an ``upstreams.api_key_enc`` value
   with NO ``upstream_keys`` rows becomes the upstream's first key row (the
   credential must not be orphaned when the mirror column is cleared);
2. clear ``upstreams.api_key_enc`` - ADR-026 retires the mirror; every key row
   is an independent AG provider and the renderer reads ``upstream_keys`` only.

The script is self-sufficient on old databases: it runs init_db first, which
adds the new ``upstream_keys`` columns (last_test_json / last_test_at_ms) via
the additive path.

    cd slipstream/api
    python scripts/migrate_multikey_v2.py --database-url sqlite:///./demo.db
    python scripts/migrate_multikey_v2.py --database-url sqlite:///./demo.db --apply
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from l01_core.crypto import SecretBox  # noqa: E402
from l01_core.ids import new_id  # noqa: E402
from l01_core.settings import get_settings  # noqa: E402
from l01_core.timeutil import now_ms  # noqa: E402
from l04_repo.base import init_db, make_engine, make_sessionmaker  # noqa: E402
from l04_repo.orm import UpstreamKeyORM, UpstreamORM  # noqa: E402
from l04_repo.repository import get_setting, put_setting  # noqa: E402

MARKER_KEY = "multikey_semantics"
MARKER_VALUE = "v2"


@dataclass(frozen=True, slots=True)
class MigrationPlan:
    """What the migration would change; dry-run prints, --apply executes."""

    materialize: tuple[dict, ...] = field(default_factory=tuple)  # legacy inline keys
    clear_mirror: tuple[str, ...] = field(default_factory=tuple)  # upstream ids

    @property
    def change_count(self) -> int:
        return len(self.materialize) + len(self.clear_mirror)


def stored_semantics(session: Session) -> str:
    """The recorded marker value, or "" when the database predates the marker."""
    raw = get_setting(session, MARKER_KEY)
    if raw is None:
        return ""
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return str(raw)
    return str(value) if isinstance(value, str) else ""


def _key_suffix(secret_box: SecretBox, ciphertext: str) -> str:
    """Tail-4 of the decrypted legacy key; a corrupt value stays empty (no raise)."""
    if not ciphertext:
        return ""
    try:
        plaintext = secret_box.decrypt(ciphertext)
    except Exception:  # noqa: BLE001 - a corrupt mirror must not block the migration
        return ""
    return plaintext[-4:] if len(plaintext) > 4 else plaintext


def plan_multikey_migration(session: Session) -> MigrationPlan:
    """Read-only: which upstreams need a materialized row / a cleared mirror."""
    secret_box = SecretBox(get_settings().secret_key)
    materialize: list[dict] = []
    clear_mirror: list[str] = []
    for upstream in session.scalars(select(UpstreamORM)).all():
        has_rows = session.scalar(
            select(UpstreamKeyORM.id).where(UpstreamKeyORM.upstream_id == upstream.id).limit(1)
        ) is not None
        if upstream.api_key_enc and not has_rows:
            materialize.append(
                {
                    "upstream_id": upstream.id,
                    "name": upstream.name,
                    "suffix": _key_suffix(secret_box, upstream.api_key_enc),
                }
            )
        if upstream.api_key_enc:
            clear_mirror.append(upstream.id)
    return MigrationPlan(materialize=tuple(materialize), clear_mirror=tuple(clear_mirror))


def apply_multikey_migration(session: Session, plan: MigrationPlan) -> None:
    """Write the planned rows, clear the mirror, record the v2 marker."""
    for entry in plan.materialize:
        upstream = session.get(UpstreamORM, entry["upstream_id"])
        if upstream is None:  # pragma: no cover - plan and apply share the session
            continue
        session.add(
            UpstreamKeyORM(
                id=new_id("upk"),
                upstream_id=upstream.id,
                label="默认密钥",
                key_enc=upstream.api_key_enc,
                key_suffix=entry["suffix"],
                created_at_ms=upstream.created_at_ms or now_ms(),
            )
        )
    for upstream_id in plan.clear_mirror:
        upstream = session.get(UpstreamORM, upstream_id)
        if upstream is not None:  # pragma: no cover - same session, same rows
            upstream.api_key_enc = ""
    session.flush()
    put_setting(session, MARKER_KEY, json.dumps(MARKER_VALUE), now_ms())
    session.flush()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=None, help="defaults to SLIPSTREAM_DATABASE_URL")
    parser.add_argument(
        "--apply", action="store_true", help="write the changes (default: dry-run)"
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    url = args.database_url or get_settings().database_url
    engine = make_engine(url)
    # Self-sufficient on old databases: the additive path adds the new columns.
    init_db(engine)
    factory = make_sessionmaker(engine)
    try:
        with factory() as session:
            already_v2 = stored_semantics(session) == MARKER_VALUE
            plan = MigrationPlan() if already_v2 else plan_multikey_migration(session)
            if args.apply:
                apply_multikey_migration(session, plan)
                session.commit()
            payload = {
                "database_url": url,
                "applied": bool(args.apply),
                "stored_semantics": stored_semantics(session),
                "already_v2": already_v2,
                "materialize": list(plan.materialize),
                "clear_mirror": list(plan.clear_mirror),
            }
    finally:
        engine.dispose()

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        verb = "applied" if args.apply else "planned"
        changes = len(plan.materialize) + len(plan.clear_mirror)
        print(f"{verb} {changes} change(s); {url}")
        for entry in plan.materialize:
            print(f"  materialize {entry['name']} ({entry['upstream_id']}) key …{entry['suffix']}")
        for upstream_id in plan.clear_mirror:
            print(f"  clear api_key_enc {upstream_id}")
        if payload["already_v2"]:
            print("already migrated (multikey_semantics=v2); nothing to do")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
