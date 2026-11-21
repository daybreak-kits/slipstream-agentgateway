"""Client key issuance: `sk-` + N chars from a charset chosen by length tier.

Lead decision round 2 + supplement: canonical lengths {1,2,4,8,16,32,64} (default
64) use uppercase A-Z0-9._-; other lengths keep A-Za-z0-9._-. Storage keeps ONLY
the unsalted sha256 hash in the data-plane form `sha256:<hex>` (E11: AG computes
plain sha256 of the presented key, so no salt may be mixed in) plus an AES-GCM
encrypted plaintext copy for the audited reveal endpoint (ADR-008). Quota fields
are gone (ADR-007/011): the prepaid balance lives on the user in micro-currency
and the data-plane bucket is a fast intercept, never the source of truth.
ADR-023: a user holds up to 50 named keys (no one-active-key limit any more).
"""

from __future__ import annotations

import secrets
import string
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.crypto import AesGcmBox, sha256_hex
from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l04_repo.orm import ApiKeyORM

DEFAULT_KEY_PREFIX = "sk-"
DEFAULT_KEY_LENGTH = 64
CANONICAL_LENGTHS = (1, 2, 4, 8, 16, 32, 64)
DEFAULT_CHARSET = string.ascii_letters + string.digits + "._-"
CANONICAL_CHARSET = string.ascii_uppercase + string.digits + "._-"
HASH_ALGORITHM = "sha256"
KEY_STATUSES = ("active", "disabled")
# ADR-023: one user may hold many keys; 50 is the hard per-user ceiling.
MAX_KEYS_PER_USER = 50


@dataclass(frozen=True, slots=True)
class IssuedKey:
    """Plaintext (shown exactly once on issue/rotate) plus the stored hash form."""

    key_id: str
    plaintext: str
    key_hash: str
    key_suffix: str


def hash_client_key(plaintext: str) -> str:
    """UNSALTED sha256 in the data-plane hash form `sha256:<hex>` (E11)."""
    return f"{HASH_ALGORITHM}:{sha256_hex(plaintext)}"


def mask_of(prefix: str, key_suffix: str) -> str:
    """List-view mask `sk-...abcd`: never exposes the full key or the hash."""
    return f"{prefix}...{key_suffix}"


def generate_key_text(length: int = DEFAULT_KEY_LENGTH, prefix: str = DEFAULT_KEY_PREFIX) -> str:
    """Random key text: canonical tiers uppercase, otherwise mixed case."""
    charset = CANONICAL_CHARSET if length in CANONICAL_LENGTHS else DEFAULT_CHARSET
    body = "".join(secrets.choice(charset) for _ in range(length))
    return prefix + body


def _user_keys(session: Session, user_id: str) -> list[ApiKeyORM]:
    """Every key row of a user, any status (the 50-cap counts all of them)."""
    return list(
        session.scalars(
            select(ApiKeyORM)
            .where(ApiKeyORM.user_id == user_id)
            .order_by(ApiKeyORM.created_at_ms, ApiKeyORM.id)
        ).all()
    )


def default_key_name(session: Session, user_id: str) -> str:
    """ADR-023 display name for a new key: 密钥 N by per-user ordinal."""
    return f"密钥 {len(_user_keys(session, user_id)) + 1}"


def issue_client_key(
    session: Session,
    *,
    user_id: str,
    box: AesGcmBox,
    length: int = DEFAULT_KEY_LENGTH,
    prefix: str = DEFAULT_KEY_PREFIX,
    name: str | None = None,
) -> IssuedKey:
    """Generate, store hash (+ AES-GCM plaintext copy), return the one-time text.

    ADR-023: a user may hold up to 50 keys (any status); the 51st is a CONFLICT.
    Deleting keys frees slots. last_used_at_ms is seeded with the issue time as
    a fallback; usage ingestion refreshes it from the data plane.
    """
    if len(_user_keys(session, user_id)) >= MAX_KEYS_PER_USER:
        raise AppError(
            ErrorCode.CONFLICT,
            f"每用户最多 {MAX_KEYS_PER_USER} 把连接密钥: {user_id}",
            details={"user_id": user_id, "max_keys": MAX_KEYS_PER_USER},
        )
    plaintext = generate_key_text(length=length, prefix=prefix)
    key_hash = hash_client_key(plaintext)
    key_orm = ApiKeyORM(
        id=new_id("key"),
        user_id=user_id,
        name=(name or "").strip() or default_key_name(session, user_id),
        prefix=prefix,
        key_hash=key_hash,
        key_enc=box.encrypt(plaintext),
        key_suffix=plaintext[-4:],
        status="active",
        last_used_at_ms=now_ms(),
        created_at_ms=now_ms(),
    )
    session.add(key_orm)
    session.flush()
    return IssuedKey(
        key_id=key_orm.id, plaintext=plaintext, key_hash=key_hash, key_suffix=key_orm.key_suffix
    )


def authenticate_client_key(session: Session, presented_key: str) -> ApiKeyORM:
    """Resolve a presented key by hash; disabled or unknown keys never match."""
    row = session.scalars(
        select(ApiKeyORM).where(ApiKeyORM.key_hash == hash_client_key(presented_key))
    ).first()
    if row is None or row.status != "active":
        raise AppError(ErrorCode.UNAUTHORIZED, "unknown or disabled client key")
    return row


def rotate_client_key(
    session: Session,
    key_id: str,
    box: AesGcmBox,
    *,
    length: int = DEFAULT_KEY_LENGTH,
    prefix: str = DEFAULT_KEY_PREFIX,
) -> IssuedKey:
    """Replace the credential material of an existing key (same row, same user).

    Rotation also refreshes last_used_at_ms (same fallback as issuance).
    """
    old = session.get(ApiKeyORM, key_id)
    if old is None:
        raise AppError(ErrorCode.NOT_FOUND, f"api key not found: {key_id}")
    plaintext = generate_key_text(length=length, prefix=prefix)
    old.key_hash = hash_client_key(plaintext)
    old.key_enc = box.encrypt(plaintext)
    old.key_suffix = plaintext[-4:]
    old.prefix = prefix
    old.last_used_at_ms = now_ms()
    session.flush()
    return IssuedKey(
        key_id=old.id, plaintext=plaintext, key_hash=old.key_hash, key_suffix=old.key_suffix
    )


def rename_client_key(session: Session, key_id: str, name: str) -> ApiKeyORM:
    """ADR-023: rename a key; the name is console metadata, never sent to AG."""
    cleaned = (name or "").strip()
    if not cleaned:
        raise AppError(ErrorCode.VALIDATION_ERROR, "密钥名称不能为空")
    if len(cleaned) > 255:
        raise AppError(ErrorCode.VALIDATION_ERROR, "密钥名称过长")
    row = session.get(ApiKeyORM, key_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"api key not found: {key_id}")
    row.name = cleaned
    session.flush()
    return row


def delete_client_key(session: Session, key_id: str) -> None:
    """Remove a key outright (ADR-023); no requirement to keep an active key.

    The row disappears rather than being disabled, so the hash stops matching
    at the next config apply and the per-user 50-key slot count drops.
    """
    row = session.get(ApiKeyORM, key_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"api key not found: {key_id}")
    session.delete(row)
    session.flush()


def reveal_client_key(session: Session, key_id: str, box: AesGcmBox) -> str:
    """Copy-key feature: decrypt the stored plaintext copy (caller checked by the API + audit)."""
    row = session.get(ApiKeyORM, key_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"api key not found: {key_id}")
    if not row.key_enc:
        raise AppError(ErrorCode.NOT_FOUND, "no stored plaintext copy for this key")
    return box.decrypt(row.key_enc)


def set_key_status(session: Session, key_id: str, status: str) -> ApiKeyORM:
    """Enable/disable a key; unknown status values are validation errors."""
    if status not in KEY_STATUSES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown key status: {status}",
            details={"status": status, "known": list(KEY_STATUSES)},
        )
    row = session.get(ApiKeyORM, key_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"api key not found: {key_id}")
    row.status = status
    session.flush()
    return row
