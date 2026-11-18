"""Migrate legacy model-target priorities to v2 semantics (ticket 08).

Dry-run by default: prints the planned flips. Pass --apply to write them and to
record the priority_semantics=v2 marker, after which the command is a no-op.

    cd slipstream/api
    python scripts/migrate_priority_v2.py --database-url sqlite:///./demo.db
    python scripts/migrate_priority_v2.py --database-url sqlite:///./demo.db --apply
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from l01_core.settings import get_settings  # noqa: E402
from l04_repo.base import make_engine, make_sessionmaker  # noqa: E402
from l05_service.priority_migration import (  # noqa: E402
    SEMANTICS_LEGACY,
    SEMANTICS_V2,
    apply_priority_migration,
    plan_priority_migration,
    stored_semantics,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=None, help="defaults to SLIPSTREAM_DATABASE_URL")
    parser.add_argument(
        "--apply", action="store_true", help="write the changes (default: dry-run)"
    )
    parser.add_argument(
        "--semantics",
        choices=[SEMANTICS_LEGACY, SEMANTICS_V2],
        default=SEMANTICS_LEGACY,
        help="semantics of the CURRENT data (default: legacy)",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    url = args.database_url or get_settings().database_url
    engine = make_engine(url)
    factory = make_sessionmaker(engine)
    try:
        with factory() as session:
            plan = plan_priority_migration(session, semantics=args.semantics)
            if args.apply:
                apply_priority_migration(session, plan)
                session.commit()
            payload = {
                "database_url": url,
                "applied": bool(args.apply),
                "stored_semantics": stored_semantics(session),
                "already_v2": plan.already_v2,
                "changes": [
                    {
                        "target_id": change.target_id,
                        "public_model_id": change.public_model_id,
                        "old_priority": change.old_priority,
                        "new_priority": change.new_priority,
                    }
                    for change in plan.changes
                ],
            }
    finally:
        engine.dispose()

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        verb = "applied" if args.apply else "planned"
        print(f"{verb} {len(payload['changes'])} priority change(s); {url}")
        for change in payload["changes"]:
            print(
                f"  {change['public_model_id']}/{change['target_id']}: "
                f"{change['old_priority']} -> {change['new_priority']}"
            )
        if payload["already_v2"]:
            print("already migrated (priority_semantics=v2); nothing to do")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
