"""Ticket 08: init_db adds new columns to an existing demo DB (no alembic yet)."""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from l04_repo.base import init_db


def test_init_db_adds_ticket_08_columns_to_existing_table(tmp_path) -> None:
    db_path = tmp_path / "old.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    old_ddl = (
        "CREATE TABLE config_revisions ("
        "id VARCHAR(64) PRIMARY KEY, artifact TEXT, artifact_hash VARCHAR(64), "
        "adapter_id VARCHAR(64), operator VARCHAR(128), reason TEXT, "
        "status VARCHAR(32), previous_revision_id VARCHAR(64), created_at_ms BIGINT)"
    )
    with engine.begin() as connection:
        connection.execute(text(old_ddl))
        connection.execute(
            text(
                "INSERT INTO config_revisions "
                "(id, artifact, artifact_hash, status, created_at_ms) "
                "VALUES ('rev_old', 'a: 1\n', 'hash_old', 'active', 1)"
            )
        )

    init_db(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("config_revisions")}
    assert {"error_detail", "validation_note"} <= columns
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT error_detail, validation_note FROM config_revisions WHERE id='rev_old'")
        ).one()
    assert tuple(row) == ("", "")
    engine.dispose()
