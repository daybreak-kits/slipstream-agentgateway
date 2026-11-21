"""Engine / session factory helpers for the control-plane database."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.orm import Session, sessionmaker

from l04_repo.orm import Base


def make_engine(database_url: str) -> Engine:
    """Create an Engine; SQLite gets check_same_thread=False for tooling convenience."""
    _ensure_sqlite_parent(database_url)
    kwargs: dict[str, object] = {}
    if database_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(database_url, future=True, **kwargs)  # type: ignore[arg-type]


def _ensure_sqlite_parent(database_url: str) -> None:
    """Create the parent directory of a SQLite file URL (skip memory/URI databases).

    A fresh checkout has no api/.data_store/ yet; SQLite creates the file but
    never its parent directory, so the first connect would otherwise fail.
    """
    try:
        url = make_url(database_url)
    except ArgumentError:
        return
    if url.get_backend_name() != "sqlite" or not url.database:
        return
    database = url.database
    if database == ":memory:" or database.startswith("file:"):
        return
    Path(database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


def make_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    """Session factory tuned for request scoping (no autoflush surprises)."""
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False, future=True)


def init_db(engine: Engine) -> None:
    """Create every table, then add columns introduced after a DB was created.

    The project has no alembic yet; this additive fallback keeps an existing
    demo DB usable (ticket 08 adds config_revisions.error_detail and
    config_revisions.validation_note). It never alters a column; ticket 16 also
    drops columns the ORM retired after a database was created. Ticket 05 moves
    the usage join key from its wire-era column name into the neutral
    correlation_key (values copied, legacy column kept until retirement).
    """
    Base.metadata.create_all(engine)
    _ensure_additive_columns(engine)
    _backfill_usage_correlation_key(engine)
    _drop_retired_columns(engine)
    _ensure_username_index(engine)
    _ensure_model_markup_default(engine)


#: Ticket 16: columns that left the ORM mapping (ADR-026 retired the key-level
#: primary flag) but still sit in old SQLite files. Dropping them keeps the
#: mapping honest: no dead column, no accidental read/write of a retired field.
_RETIRED_COLUMNS: tuple[tuple[str, str], ...] = (("upstream_keys", "is_primary"),)


def _drop_retired_columns(engine: Engine) -> None:
    """Drop ORM columns that were retired after an existing DB was created.

    ALTER TABLE ... DROP COLUMN needs SQLite >= 3.35 (the project's supported
    Python 3.12 runtime bundles a newer one); non-SQLite backends support it too.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    for table_name, column_name in _RETIRED_COLUMNS:
        if not inspector.has_table(table_name):
            continue
        existing = {column["name"] for column in inspector.get_columns(table_name)}
        if column_name not in existing:
            continue
        with engine.begin() as connection:
            connection.execute(
                text(f"ALTER TABLE {table_name} DROP COLUMN {column_name}")
            )


def _backfill_usage_correlation_key(engine: Engine) -> None:
    """Ticket 05: copy the wire-era usage join column into correlation_key.

    Pure value move (no reinterpretation): old rows keep their chain, new code
    reads only the neutral name. The legacy column stays in place until the
    vocabulary gate retires it; a DB without the legacy column skips the pass.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if not inspector.has_table("gateway_usage_events"):
        return
    existing = {column["name"] for column in inspector.get_columns("gateway_usage_events")}
    if "trace_id" not in existing or "correlation_key" not in existing:
        return
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE gateway_usage_events SET correlation_key = trace_id "
                "WHERE correlation_key = '' AND trace_id != ''"
            )
        )


def _ensure_model_markup_default(engine: Engine) -> None:
    """ADR-020: a model row with no markup configured bills at the 1.2 house rate.

    The column is NOT NULL, so a row that predates the markup default landed on
    1.0 (spend = cost, no margin). Existing databases keep their rows; the ones
    still sitting on the old default move to 1.2 once, in place.
    """
    from sqlalchemy import inspect, text

    if not inspect(engine).has_table("upstream_models"):
        return
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE upstream_models SET markup = 1.2 WHERE markup = 1.0")
        )


def _ensure_username_index(engine: Engine) -> None:
    """ADR-019: users.username is unique, but ADD COLUMN cannot attach an index.

    Fresh databases get ix_users_username from create_all; databases that only
    received the column via the additive path get it created here. SQLite
    treats NULLs as distinct, so rows without a login name coexist fine.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if not inspector.has_table("users"):
        return
    existing = {
        index["name"]
        for index in inspector.get_indexes("users")
        if "username" in index.get("column_names", ())
    }
    if "ix_users_username" in existing:
        return
    with engine.begin() as connection:
        connection.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)")
        )


def _ensure_additive_columns(engine: Engine) -> None:
    """SQLite-safe ADD COLUMN for missing ORM columns with a scalar default."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    dialect = engine.dialect
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        existing = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing or column.primary_key:
                continue
            default_clause = ""
            if column.default is None:
                # Ticket 04 adds nullable user-tree columns (parent_user_id,
                # admin_user_id); SQLite can add those as plain nullable columns.
                if not column.nullable:
                    continue
            else:
                if callable(column.default.arg):
                    continue
                literal = column.default.arg
                # Ticket 05 adds Numeric defaults (markup 1.0000); Decimal renders
                # as a plain numeric literal, so an existing demo DB gets it too.
                if not isinstance(literal, (str, int, float, Decimal)):
                    continue
                rendered = f"'{literal}'" if isinstance(literal, str) else str(literal)
                default_clause = f" DEFAULT {rendered}"
            ddl = (
                f"ALTER TABLE {table.name} ADD COLUMN {column.name} "
                f"{column.type.compile(dialect=dialect)}{default_clause}"
            )
            with engine.begin() as connection:
                connection.execute(text(ddl))
