"""Bootstrap the internal Playground identity before the data plane is rendered.

The Playground relays with a server-side client key. That key has to exist in
the rendered AG configuration, so its creation cannot be lazy: the first apply
on a fresh installation must already include it. This module owns the
idempotent create-or-read step for both the apply path and the Playground
endpoint.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.crypto import AesGcmBox
from l01_core.ids import new_id
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l04_repo.orm import ApiKeyORM, UserORM
from l04_repo.repository import get_setting, put_setting
from l05_service import client_keys

SETTING_KEY = "playground_user_id"
TEST_KEY_SETTING = "model_test_key_id"
TEST_KEY_NAME = "测试专用"


def ensure_playground_identity(
    session: Session, *, commit: bool = False
) -> tuple[ApiKeyORM, bool]:
    """Return the active Playground key and whether this call created it.

    commit=False is used by Rollout.apply: the identity joins the same
    transaction as the revision and the caller commits once. The router uses
    commit=True because it may be the first write in its own request.
    """
    stored = get_setting(session, SETTING_KEY)
    if stored:
        try:
            meta = json.loads(stored)
        except json.JSONDecodeError:
            meta = {}
        key = session.get(ApiKeyORM, meta.get("key_id", ""))
        user = session.get(UserORM, meta.get("id", ""))
        if key is not None and user is not None and key.status == "active":
            return key, False

    settings = get_settings()
    # Older databases may have bootstrapped this account without persisting the
    # setting. Reuse it instead of creating another invisible playground user on
    # every first request.
    user = session.scalars(
        select(UserORM)
        .where(UserORM.name == "playground", UserORM.username.is_(None))
        .order_by(UserORM.created_at_ms)
    ).first()
    if user is None:
        user = UserORM(id=new_id("user"), name="playground", created_at_ms=now_ms())
        session.add(user)
        session.flush()
    key_id = session.scalars(
        select(ApiKeyORM.id)
        .where(ApiKeyORM.user_id == user.id, ApiKeyORM.status == "active")
        .order_by(ApiKeyORM.created_at_ms)
    ).first()
    if key_id is None:
        issued = client_keys.issue_client_key(
            session, user_id=user.id, box=AesGcmBox(settings.secret_key)
        )
        key_id = issued.key_id
    put_setting(
        session,
        SETTING_KEY,
        json.dumps({"id": user.id, "key_id": key_id}),
        now_ms(),
    )
    if commit:
        session.commit()
    key = session.get(ApiKeyORM, key_id)
    if key is None:  # pragma: no cover - flush/commit guarantees the row
        raise RuntimeError("playground identity key was not persisted")
    return key, True


def ensure_test_identity(session: Session, *, commit: bool = False) -> ApiKeyORM:
    """Return the internal "测试专用" key used only by server-side model tests.

    It belongs to the hidden Playground user, is never listed by the user/key
    APIs (that user is filtered out) and its plaintext is only decrypted inside
    the control plane. The AG config includes it because every active ApiKey is
    rendered, so a model test can go through the data plane like a real call.
    """
    stored = get_setting(session, TEST_KEY_SETTING)
    if stored:
        key = session.get(ApiKeyORM, stored)
        if key is not None and key.status == "active":
            return key
    _playground_key, _created = ensure_playground_identity(session, commit=False)
    settings = get_settings()
    user = session.scalars(
        select(UserORM)
        .where(UserORM.name == "playground", UserORM.username.is_(None))
        .order_by(UserORM.created_at_ms)
    ).first()
    if user is None:  # pragma: no cover - ensure_playground_identity created it
        raise RuntimeError("playground user missing")
    existing = session.scalars(
        select(ApiKeyORM)
        .where(
            ApiKeyORM.user_id == user.id,
            ApiKeyORM.name == TEST_KEY_NAME,
            ApiKeyORM.status == "active",
        )
        .order_by(ApiKeyORM.created_at_ms)
    ).first()
    if existing is None:
        issued = client_keys.issue_client_key(
            session,
            user_id=user.id,
            box=AesGcmBox(settings.secret_key),
            name=TEST_KEY_NAME,
        )
        key_id = issued.key_id
    else:
        key_id = existing.id
    put_setting(session, TEST_KEY_SETTING, key_id, now_ms())
    if commit:
        session.commit()
    key = session.get(ApiKeyORM, key_id)
    if key is None:  # pragma: no cover
        raise RuntimeError("test identity key was not persisted")
    return key
