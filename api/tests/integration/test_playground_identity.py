"""First Playground request must not create a duplicate invisible user."""

from __future__ import annotations

from l04_repo.orm import ApiKeyORM, UserORM
from l04_repo.repository import get_setting
from l05_service.playground_identity import SETTING_KEY, ensure_playground_identity


def test_existing_system_user_without_setting_is_reused(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        session.add(
            UserORM(
                id="user_existing_playground",
                name="playground",
                created_at_ms=1,
            )
        )
        session.flush()
        first, created_first = ensure_playground_identity(session, commit=True)
        second, created_second = ensure_playground_identity(session, commit=True)
        assert created_first is True
        assert created_second is False
        assert first.id == second.id
        assert first.user_id == "user_existing_playground"
        assert session.get(ApiKeyORM, first.id) is not None
        assert session.query(UserORM).filter_by(name="playground").count() == 1
        assert get_setting(session, SETTING_KEY) is not None
