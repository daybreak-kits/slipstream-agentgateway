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


def test_init_db_drops_the_retired_vendor_dimension(tmp_path) -> None:
    """W7 t03 / ADR-030: the vendor domain leaves the schema on old files.

    ``vendors`` and the vendor-keyed ``cost_daily`` are dropped whole (the
    latter is a derived read model that refresh_cost_daily rebuilds under the
    model-keyed shape); the vendor columns on upstreams / upstream_prices /
    cost_entries are dropped in place and surviving rows keep every
    non-vendor field. No migration script exists on purpose: the mock DB is
    reset by seed, this pass only keeps an un-reset file honest.
    """
    db_path = tmp_path / "old-vendor.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE vendors ("
                "id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), slug VARCHAR(64), "
                "note TEXT, upstream_seq INTEGER, created_at_ms BIGINT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE upstreams ("
                "id VARCHAR(64) PRIMARY KEY, vendor_id VARCHAR(64), name VARCHAR(255), "
                "base_url VARCHAR(512), api_style VARCHAR(64), api_key_enc TEXT, "
                "transforms_json TEXT, max_buffer_bytes INTEGER, enabled BOOLEAN, "
                "created_at_ms BIGINT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE upstream_prices ("
                "id VARCHAR(64) PRIMARY KEY, vendor_id VARCHAR(64), "
                "upstream_model VARCHAR(255), upstream_model_id VARCHAR(64), "
                "item VARCHAR(64), unit_price_micro BIGINT, currency VARCHAR(8), "
                "effective_from_ms BIGINT, version INTEGER, created_at_ms BIGINT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE cost_entries ("
                "id VARCHAR(64) PRIMARY KEY, gateway_event_id VARCHAR(128), "
                "vendor_id VARCHAR(64), upstream_model_id VARCHAR(64), "
                "input_tokens INTEGER, output_tokens INTEGER, "
                "cache_read_tokens INTEGER, cache_write_tokens INTEGER, "
                "amount_micro BIGINT, currency VARCHAR(8), "
                "price_version_id VARCHAR(64), status VARCHAR(32), created_at_ms BIGINT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE cost_daily ("
                "day VARCHAR(10), vendor_id VARCHAR(64), upstream_model VARCHAR(255), "
                "requests INTEGER, input_tokens INTEGER, output_tokens INTEGER, "
                "amount_micro BIGINT, currency VARCHAR(8), "
                "PRIMARY KEY (day, vendor_id, upstream_model))"
            )
        )
        connection.execute(
            text(
                "INSERT INTO vendors (id, name, slug, note, upstream_seq, created_at_ms) "
                "VALUES ('vend_old', '旧厂商', 'old', '', 2, 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO upstreams (id, vendor_id, name, base_url, api_style, created_at_ms) "
                "VALUES ('ups_old', 'vend_old', 'old-01', 'https://old.example/v1', "
                "'openai_chat', 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO upstream_prices (id, vendor_id, upstream_model, item, "
                "unit_price_micro, currency, effective_from_ms, version, created_at_ms) "
                "VALUES ('upr_old', 'vend_old', 'glm-5.3', 'cache_read', 1000, 'CNY', 0, 1, 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO cost_entries (id, gateway_event_id, vendor_id, input_tokens, "
                "output_tokens, amount_micro, currency, status, created_at_ms) "
                "VALUES ('cost_old', 'evt_old', 'vend_old', 10, 5, 800, 'CNY', 'ok', 1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO cost_daily (day, vendor_id, upstream_model, requests, "
                "input_tokens, output_tokens, amount_micro, currency) "
                "VALUES ('2026-01-01', 'vend_old', 'glm-5.3', 1, 10, 5, 800, 'CNY')"
            )
        )

    init_db(engine)
    # Startup runs init_db again on the already-migrated shape; both passes are
    # guarded and must not fail or resurrect the retired dimension.
    init_db(engine)

    inspector = inspect(engine)
    assert "vendors" not in inspector.get_table_names()
    assert "vendor_id" not in {c["name"] for c in inspector.get_columns("upstreams")}
    price_columns = {c["name"] for c in inspector.get_columns("upstream_prices")}
    assert "vendor_id" not in price_columns
    assert "upstream_model" not in price_columns
    assert "vendor_id" not in {c["name"] for c in inspector.get_columns("cost_entries")}
    # cost_daily is rebuilt under the new model-keyed shape (vendor_id leaves the PK).
    daily_columns = {c["name"] for c in inspector.get_columns("cost_daily")}
    assert "vendor_id" not in daily_columns
    assert "upstream_model" in daily_columns
    # Surviving rows keep every non-vendor field.
    with engine.connect() as connection:
        upstream = connection.execute(
            text("SELECT id, name, base_url FROM upstreams WHERE id='ups_old'")
        ).one()
        price = connection.execute(
            text(
                "SELECT id, item, unit_price_micro, currency FROM upstream_prices "
                "WHERE id='upr_old'"
            )
        ).one()
        cost = connection.execute(
            text("SELECT id, amount_micro, currency, status FROM cost_entries WHERE id='cost_old'")
        ).one()
    assert tuple(upstream) == ("ups_old", "old-01", "https://old.example/v1")
    assert tuple(price) == ("upr_old", "cache_read", 1000, "CNY")
    assert tuple(cost) == ("cost_old", 800, "CNY", "ok")
    engine.dispose()


def test_fresh_db_never_grows_a_vendors_table_or_vendor_column(tmp_path) -> None:
    """W7 t03 / ADR-030: the fresh shape has no vendor dimension at all."""
    db_path = tmp_path / "fresh-vendor-free.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    init_db(engine)

    inspector = inspect(engine)
    assert "vendors" not in inspector.get_table_names()
    for table in ("upstreams", "upstream_prices", "cost_entries", "cost_daily"):
        assert "vendor_id" not in {c["name"] for c in inspector.get_columns(table)}
    engine.dispose()


def test_init_db_tolerates_legacy_fk_on_retired_vendor_column(tmp_path) -> None:
    """A pre-ADR-030 SQLite file may have upstreams.vendor_id named by a FK.

    SQLite refuses ALTER TABLE ... DROP COLUMN while a table-level foreign key
    still references the column; the retired column is inert after the ORM
    stopped mapping it, so startup must keep the file readable instead of
    failing with "unknown column vendor_id in foreign key definition".
    """
    db_path = tmp_path / "old-fk-vendor.db"
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE vendors (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255))")
        )
        connection.execute(
            text(
                "CREATE TABLE upstreams ("
                "id VARCHAR(64) PRIMARY KEY, vendor_id VARCHAR(64) REFERENCES vendors(id), "
                "name VARCHAR(255), base_url VARCHAR(512), api_style VARCHAR(64), "
                "created_at_ms BIGINT)"
            )
        )
        connection.execute(
            text("INSERT INTO vendors (id, name) VALUES ('vend_old', '旧厂商')")
        )
        connection.execute(
            text(
                "INSERT INTO upstreams (id, vendor_id, name, base_url, api_style, created_at_ms) "
                "VALUES ('ups_old', 'vend_old', 'old-01', 'https://old.example/v1', "
                "'openai_chat', 1)"
            )
        )

    init_db(engine)
    init_db(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("upstreams")}
    assert "vendor_id" in columns
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT id, name, base_url FROM upstreams WHERE id='ups_old'")
        ).one()
    assert tuple(row) == ("ups_old", "old-01", "https://old.example/v1")
    engine.dispose()
