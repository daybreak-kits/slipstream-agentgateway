"""Naming, counters, one-key-per-user, key text/hash forms through the services."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from l01_core.crypto import AesGcmBox, SecretBox, sha256_hex
from l04_repo.base import init_db
from l04_repo.orm import UserORM
from l05_service.client_keys import (
    CANONICAL_CHARSET,
    CANONICAL_LENGTHS,
    DEFAULT_CHARSET,
    generate_key_text,
    hash_client_key,
    issue_client_key,
    mask_of,
)
from l05_service.crud import create_upstream


@pytest.fixture()
def session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    init_db(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with factory() as db:
        yield db


def test_upstream_names_dedupe_on_base_url(session):
    """ADR-030: the default name derives from the base_url; duplicates dedupe -2/-3."""
    one = create_upstream(
        session, base_url="https://a", api_style="openai_chat",
        api_key="k1", secret_box=SecretBox("s"),
    )
    two = create_upstream(
        session, base_url="https://a", api_style="openai_chat",
        api_key="k2", secret_box=SecretBox("s"),
    )
    three = create_upstream(
        session, base_url="https://a", api_style="openai_chat",
        api_key="k3", secret_box=SecretBox("s"),
    )
    assert [one.name, two.name, three.name] == ["a", "a-2", "a-3"]


def test_create_upstream_stores_transforms(session):
    payload = {"request_headers": [{"op": "update", "name": "x-trace", "value": "t"}]}
    upstream = create_upstream(
        session, base_url="https://b", api_style="openai_chat",
        api_key="k", secret_box=SecretBox("s"), transforms=payload, max_buffer_bytes=4096,
    )
    assert '"x-trace"' in upstream.transforms_json
    assert upstream.max_buffer_bytes == 4096


def test_multiple_keys_per_user_are_allowed(session):
    """ADR-023: 一用户多把密钥；上限 50 的守卫在服务层。"""
    user = UserORM(id="usr_1", name="a")
    session.add(user)
    session.flush()
    box = AesGcmBox("s")
    first = issue_client_key(session, user_id="usr_1", box=box)
    second = issue_client_key(session, user_id="usr_1", box=box)
    assert first.key_id != second.key_id
    assert first.plaintext != second.plaintext


def test_key_text_tiers():
    canonical = generate_key_text(64)
    assert canonical.startswith("sk-") and len(canonical) == 64 + 3
    assert all(ch in CANONICAL_CHARSET for ch in canonical[3:])
    odd = generate_key_text(3)
    assert all(ch in DEFAULT_CHARSET for ch in odd[3:])
    assert 64 in CANONICAL_LENGTHS and 3 not in CANONICAL_LENGTHS
    # non-canonical tiers allow mixed case: DEFAULT adds the lowercase set
    assert set(DEFAULT_CHARSET) - set(CANONICAL_CHARSET)


def test_hash_is_unsalted_sha256_form():
    # E11: AG computes plain sha256 of the presented key; the stored form must
    # be exactly "sha256:<hex>" with no salt so both sides agree byte for byte.
    assert hash_client_key("k") == "sha256:" + sha256_hex("k")


def test_mask_format_never_carries_secret():
    assert mask_of("sk-", "abcd") == "sk-...abcd"
