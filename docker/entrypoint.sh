#!/bin/sh
set -eu

# Demo bootstrap: only seed when the database has no users yet. This keeps
# restarts idempotent while still giving a fresh clone a usable demo dataset.
if [ "${SLIPSTREAM_SEED_DEMO:-0}" = "1" ]; then
  if ! python - <<'PY'
from sqlalchemy import select
from l01_core.settings import get_settings
from l04_repo.base import init_db, make_engine, make_sessionmaker
from l04_repo.orm import UserORM

engine = make_engine(get_settings().database_url)
init_db(engine)
with make_sessionmaker(engine)() as session:
    raise SystemExit(0 if session.scalars(select(UserORM.id).limit(1)).first() else 1)
PY
  then
    echo "slipstream: empty database, seeding demo data"
    python scripts/seed_demo.py
  fi
fi

exec "$@"
