"""SQLite engine helper: a fresh checkout has no .data_store/ yet."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import text

from l04_repo.base import make_engine


def test_sqlite_parent_dir_is_created(tmp_path: Path) -> None:
    db = tmp_path / "nested" / "store" / "slipstream.db"
    engine = make_engine("sqlite:///" + db.as_posix())
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
    finally:
        engine.dispose()
    assert db.parent.is_dir()
    assert db.exists()


def test_in_memory_sqlite_does_not_touch_the_filesystem() -> None:
    engine = make_engine("sqlite:///:memory:")
    try:
        with engine.connect() as conn:
            assert conn.execute(text("select 1")).scalar_one() == 1
    finally:
        engine.dispose()
