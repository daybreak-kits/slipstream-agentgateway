"""Ticket 08: init_db adds new columns to an existing demo DB (no alembic yet)."""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from l04_repo.base import init_db
from l04_repo.orm import UpstreamKeyORM


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


def test_init_db_adds_trace_id_and_creates_request_attempts_on_an_old_db(tmp_path) -> None:
    """ADR-028 additive path: old usage rows keep working and gain the neutral facts."""
    db_path = tmp_path / "old-usage.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE gateway_usage_events ("
                "event_id VARCHAR(128) PRIMARY KEY, started_at_ms BIGINT)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO gateway_usage_events (event_id, started_at_ms) "
                "VALUES ('evt_old', 1)"
            )
        )

    init_db(engine)

    inspector = inspect(engine)
    assert inspector.has_table("request_attempts")
    columns = {column["name"] for column in inspector.get_columns("gateway_usage_events")}
    # The neutral join column exists; the wire-named one is never re-created on
    # databases that did not already carry it (ORM mapping retired, ticket 05).
    assert "correlation_key" in columns
    with engine.connect() as connection:
        value = connection.execute(
            text("SELECT correlation_key FROM gateway_usage_events WHERE event_id='evt_old'")
        ).scalar()
    assert value == ""
    engine.dispose()


def test_init_db_adds_neutral_usage_columns_and_backfills_correlation_key(tmp_path) -> None:
    """Ticket 05: old trace_id values move into the neutral correlation_key column.

    The rename is evaluated additively: the neutral column is added, the join-key
    values are copied over (pure value move, no reinterpretation), and the legacy
    wire-named column stays in place until the vocabulary gate retires it.
    """
    db_path = tmp_path / "old-usage-trace.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE gateway_usage_events ("
                "event_id VARCHAR(128) PRIMARY KEY, started_at_ms BIGINT, "
                "trace_id VARCHAR(64) DEFAULT '')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO gateway_usage_events (event_id, started_at_ms, trace_id) "
                "VALUES ('evt_keyed', 1, '8f2a1b'), ('evt_blank', 2, '')"
            )
        )

    init_db(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("gateway_usage_events")}
    assert {"correlation_key", "requested_model", "is_stream", "error", "has_payload"} <= columns
    with engine.connect() as connection:
        keyed, blank = [
            row[0]
            for row in connection.execute(
                text(
                    "SELECT correlation_key FROM gateway_usage_events "
                    "WHERE event_id IN ('evt_keyed', 'evt_blank') ORDER BY started_at_ms"
                )
            ).all()
        ]
    assert keyed == "8f2a1b"
    assert blank == ""
    engine.dispose()


def test_init_db_backfill_is_absent_safe_when_trace_id_never_existed(tmp_path) -> None:
    """A fresh DB (or one already on the neutral shape) needs no backfill pass."""
    db_path = tmp_path / "fresh-usage.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    init_db(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("gateway_usage_events")}
    assert "correlation_key" in columns
    assert "trace_id" not in columns
    engine.dispose()


def test_init_db_drops_the_retired_upstream_keys_is_primary_column(tmp_path) -> None:
    """Ticket 16: ADR-026 retired the key-level primary flag; old DBs drop it."""
    db_path = tmp_path / "old-keys.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE upstream_keys ("
                "id VARCHAR(64) PRIMARY KEY, upstream_id VARCHAR(64), "
                "label VARCHAR(128), key_enc TEXT, key_suffix VARCHAR(16), "
                "is_primary BOOLEAN NOT NULL DEFAULT 0, created_at_ms BIGINT)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO upstream_keys "
                "(id, upstream_id, label, key_enc, key_suffix, is_primary, created_at_ms) "
                "VALUES ('upk_old', 'ups_old', '旧密钥', 'enc', '-old', 1, 1)"
            )
        )

    init_db(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("upstream_keys")}
    assert "is_primary" not in columns
    # Existing rows survive the drop; the additive columns still land.
    assert {"last_test_json", "last_test_at_ms"} <= columns
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT id, label, key_enc FROM upstream_keys WHERE id='upk_old'")
        ).one()
    assert tuple(row) == ("upk_old", "旧密钥", "enc")
    engine.dispose()


def test_init_db_drops_the_retired_usage_trace_id_column(tmp_path) -> None:
    """Ticket 06: ticket 05 backfilled the wire-era join key; the column retires.

    The value move must stay zero-loss: correlation_key keeps every copied value,
    and the legacy wire-named column is gone from both the schema and the mapping.
    """
    db_path = tmp_path / "old-usage-retired.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE gateway_usage_events ("
                "event_id VARCHAR(128) PRIMARY KEY, started_at_ms BIGINT, "
                "trace_id VARCHAR(64) DEFAULT '')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO gateway_usage_events (event_id, started_at_ms, trace_id) "
                "VALUES ('evt_keyed', 1, '8f2a1b'), ('evt_blank', 2, '')"
            )
        )

    init_db(engine)
    # Startup runs init_db again on the already-migrated shape; both passes are
    # guarded and must not fail or resurrect the retired column.
    init_db(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("gateway_usage_events")}
    assert "trace_id" not in columns
    assert "correlation_key" in columns
    with engine.connect() as connection:
        keyed, blank = [
            row[0]
            for row in connection.execute(
                text(
                    "SELECT correlation_key FROM gateway_usage_events "
                    "WHERE event_id IN ('evt_keyed', 'evt_blank') ORDER BY started_at_ms"
                )
            ).all()
        ]
    assert keyed == "8f2a1b"
    assert blank == ""
    engine.dispose()


def test_fresh_db_has_no_is_primary_column_and_accepts_key_rows(tmp_path) -> None:
    """Ticket 16: the ORM mapping must not carry the retired column at all."""
    db_path = tmp_path / "fresh-keys.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    init_db(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("upstream_keys")}
    assert "is_primary" not in columns
    with Session(engine) as session:
        session.add(
            UpstreamKeyORM(
                id="upk_new",
                upstream_id="ups_new",
                label="新密钥",
                key_enc="enc2",
                key_suffix="-new",
                created_at_ms=1,
            )
        )
        session.commit()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM upstream_keys")).scalar() == 1
    engine.dispose()

