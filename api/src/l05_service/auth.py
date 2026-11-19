"""Console authentication primitives: password hashing, DB sessions, throttling.

Security choices (ticket 02, unified accounts per ADR-019):
- scrypt (stdlib hashlib) with a per-password 16-byte salt; only the derived
  32-byte digest is stored. Legacy pbkdf2 hashes stay verifiable so existing
  seeded accounts keep working.
- Login checks `users.username` + `users.password_hash` (ADR-019: one user
  table); sessions live in `admin_sessions` and are addressed by a random
  token; the database stores only sha256(token), so a DB dump cannot be
  replayed. Expiry is absolute and revocation is a column write (logout /
  password change). session.admin_id IS the users.id since ADR-019.
- Login throttling is in-process (single control-plane process): N failures per
  window per username+IP. The response never reveals whether the username exists.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import string
import threading
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l04_repo.orm import AdminSessionORM, UserORM
from l05_service import rbac, roles

GENERIC_LOGIN_ERROR = "用户名或密码错误"
THROTTLED_MESSAGE = "登录尝试过于频繁，请稍后再试"

_SCRYPT_N = 2**14  # ~16 MiB, ~40ms on a laptop; OWASP-acceptable interactive cost
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32
_SALT_BYTES = 16


def _scrypt_hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )


def hash_password(password: str) -> str:
    """One-way password hash: scrypt$N$r$p$salt_hex$digest_hex."""
    salt = secrets.token_bytes(_SALT_BYTES)
    digest = _scrypt_hash(password, salt)
    return "$".join(
        ("scrypt", str(_SCRYPT_N), str(_SCRYPT_R), str(_SCRYPT_P), salt.hex(), digest.hex())
    )


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification for scrypt (current) and pbkdf2 (legacy seed) rows."""
    if not stored:
        return False
    parts = stored.split("$")
    try:
        if parts[0] == "scrypt" and len(parts) == 6:
            n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
            salt = bytes.fromhex(parts[4])
            expected = bytes.fromhex(parts[5])
            actual = hashlib.scrypt(
                password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected)
            )
            return hmac.compare_digest(actual, expected)
        if parts[0] == "pbkdf2" and len(parts) == 3:
            expected = bytes.fromhex(parts[2])
            actual = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), parts[1].encode(), 120_000
            )
            return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False
    return False


# A fixed hash verified when the username is unknown, so a miss costs the same
# scrypt work as a wrong password (no account enumeration through timing).
_DUMMY_HASH = hash_password("slipstream-dummy-password")


def token_hash(token: str) -> str:
    """Store/query key for a session token; the plaintext never touches the DB."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class Principal:
    """The authenticated console identity attached to one request.

    admin_id IS the unified users.id (ADR-019); the parameter/column names keep
    their historical form because admin_sessions predates the unification.
    """

    admin_id: str
    username: str
    name: str
    role: str
    session_id: str
    expires_at_ms: int
    permissions: frozenset[str] = frozenset()


def create_session(
    session: Session,
    *,
    admin_id: str,
    ttl_seconds: int | None = None,
    user_agent: str = "",
    client_ip: str = "",
) -> tuple[str, AdminSessionORM]:
    """Mint a session row and return (plaintext token, row). Caller commits.

    admin_id is the users.id of the account (ADR-019).
    """
    settings = get_settings()
    ttl = settings.session_ttl_seconds if ttl_seconds is None else ttl_seconds
    now = now_ms()
    token = secrets.token_urlsafe(32)
    row = AdminSessionORM(
        id=new_id("ses"),
        admin_id=admin_id,
        token_hash=token_hash(token),
        created_at_ms=now,
        expires_at_ms=now + ttl * 1000,
        revoked_at_ms=None,
        last_seen_at_ms=now,
        user_agent=user_agent[:255],
        client_ip=client_ip[:64],
    )
    session.add(row)
    session.flush()
    return token, row


def resolve_session(session: Session, token: str | None) -> Principal | None:
    """Validate a cookie token; None for missing/forged/expired/revoked/disabled."""
    if not token:
        return None
    row = session.scalars(
        select(AdminSessionORM).where(AdminSessionORM.token_hash == token_hash(token))
    ).first()
    if row is None or row.revoked_at_ms is not None or row.expires_at_ms <= now_ms():
        return None
    user = session.get(UserORM, row.admin_id)
    if user is None or user.status != "active":
        return None
    return Principal(
        admin_id=user.id,
        username=user.username or user.name,
        name=user.name or user.username or "",
        role=user.role,
        session_id=row.id,
        expires_at_ms=row.expires_at_ms,
        permissions=roles.permissions_for(session, user.role),
    )


def revoke_session(session: Session, token: str | None) -> bool:
    """Revoke one session; returns True when an active row was found."""
    if not token:
        return False
    row = session.scalars(
        select(AdminSessionORM).where(AdminSessionORM.token_hash == token_hash(token))
    ).first()
    if row is None or row.revoked_at_ms is not None:
        return False
    row.revoked_at_ms = now_ms()
    session.flush()
    return True


def revoke_sessions_for_admin(session: Session, admin_id: str) -> int:
    """Revoke every live session for one account (password change / disable / delete).

    admin_id is the unified users.id (ADR-019); the historical name stays
    because routers_ops still calls it.
    """
    rows = session.scalars(
        select(AdminSessionORM).where(
            AdminSessionORM.admin_id == admin_id, AdminSessionORM.revoked_at_ms.is_(None)
        )
    ).all()
    stamp = now_ms()
    for row in rows:
        row.revoked_at_ms = stamp
    session.flush()
    return len(rows)


def revoke_other_sessions(session: Session, keep_session_id: str, admin_id: str) -> int:
    """Revoke every live session of one account except the caller's own (self change)."""
    rows = session.scalars(
        select(AdminSessionORM).where(
            AdminSessionORM.admin_id == admin_id,
            AdminSessionORM.revoked_at_ms.is_(None),
            AdminSessionORM.id != keep_session_id,
        )
    ).all()
    stamp = now_ms()
    for row in rows:
        row.revoked_at_ms = stamp
    session.flush()
    return len(rows)


class _LoginThrottle:
    """Bounded in-process failure log: at most N failures per (user, IP) per window."""

    def __init__(self) -> None:
        self._events: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def key(username: str, client_ip: str) -> str:
        return (username or "").strip().lower() + "|" + (client_ip or "")

    def _prune(self, key: str, window_seconds: int) -> list[float]:
        cutoff = time.monotonic() - window_seconds
        fresh = [stamp for stamp in self._events.get(key, []) if stamp > cutoff]
        if fresh:
            self._events[key] = fresh
        else:
            self._events.pop(key, None)
        return fresh

    def blocked(self, key: str, limit: int, window_seconds: int) -> bool:
        with self._lock:
            return len(self._prune(key, window_seconds)) >= limit

    def record(self, key: str, window_seconds: int) -> None:
        with self._lock:
            fresh = self._prune(key, window_seconds)
            fresh.append(time.monotonic())
            self._events[key] = fresh

    def clear(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


_throttle = _LoginThrottle()


def reset_login_limits() -> None:
    """Test hook and operator escape hatch: forget all failure counters."""
    _throttle.reset()


def authenticate(
    session: Session, *, username: str, password: str, client_ip: str = ""
) -> UserORM:
    """Verify credentials or raise the unified 401/429 errors; never says which failed."""
    settings = get_settings()
    key = _LoginThrottle.key(username, client_ip)
    window = settings.login_rate_limit_window_seconds
    if _throttle.blocked(key, settings.login_rate_limit_attempts, window):
        raise AppError(ErrorCode.RATE_LIMITED, THROTTLED_MESSAGE)
    row = session.scalars(
        select(UserORM).where(UserORM.username == username)
    ).first()
    # Verify against a dummy hash for unknown users so timing does not leak existence.
    password_ok = verify_password(password, row.password_hash if row is not None else _DUMMY_HASH)
    if row is None or not password_ok or row.status != "active":
        _throttle.record(key, window)
        raise AppError(ErrorCode.UNAUTHORIZED, GENERIC_LOGIN_ERROR)
    _throttle.clear(key)
    return row


def to_public(
    user: UserORM, permissions: frozenset[str] | None = None
) -> dict:
    """Shape returned by login and /admin/auth/me, with the live grant set."""
    granted = (
        permissions
        if permissions is not None
        else rbac.permissions_for_role_key(user.role)
    )
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name or user.username or "",
        "role": user.role,
        "status": user.status,
        "permissions": sorted(granted),
    }


# ADR-019: 12-char generated password, at least one of each class; the symbol
# set avoids the quote/backslash characters that break copy-paste in consoles.
GENERATED_PASSWORD_LENGTH = 12
_PASSWORD_UPPER = string.ascii_uppercase
_PASSWORD_LOWER = string.ascii_lowercase
_PASSWORD_DIGITS = string.digits
_PASSWORD_SYMBOLS = "!@#$%^&*-_=+"
_PASSWORD_ALL = _PASSWORD_UPPER + _PASSWORD_LOWER + _PASSWORD_DIGITS + _PASSWORD_SYMBOLS


def generate_password(length: int = GENERATED_PASSWORD_LENGTH) -> str:
    """Random password (default 12) guaranteed to contain upper/lower/digit/symbol."""
    if length < 4:
        raise AppError(ErrorCode.VALIDATION_ERROR, "密码长度至少 4 位")
    alphabet = [
        secrets.choice(_PASSWORD_UPPER),
        secrets.choice(_PASSWORD_LOWER),
        secrets.choice(_PASSWORD_DIGITS),
        secrets.choice(_PASSWORD_SYMBOLS),
    ]
    alphabet.extend(secrets.choice(_PASSWORD_ALL) for _ in range(length - 4))
    # Fisher-Yates with secrets: shuffle so the guaranteed classes are not in
    # predictable positions.
    for index in range(len(alphabet) - 1, 0, -1):
        swap = secrets.randbelow(index + 1)
        alphabet[index], alphabet[swap] = alphabet[swap], alphabet[index]
    return "".join(alphabet)


def ensure_bootstrap_admin(session: Session) -> bool:
    """ADR-019 .env bootstrap: seed the initial full-permission admin account.

    Fires ONLY while no admin-role user holds a password (i.e. nobody can log
    in as admin yet). The account is the tree root D itself — ADR-019 wants
    exactly one full-permission admin, not a second entity. Once a password
    exists, .env values never apply again.
    """
    from l05_service import user_tree

    admin_roles = (rbac.BUILTIN_ROLE_ADMIN, *rbac.LEGACY_ALIASES_BY_KEY[rbac.BUILTIN_ROLE_ADMIN])
    existing = session.scalars(
        select(UserORM).where(UserORM.role.in_(admin_roles), UserORM.password_hash != "")
    ).first()
    if existing is not None:
        return False
    settings = get_settings()
    username = settings.admin_username.strip()
    if not username:
        raise AppError(ErrorCode.VALIDATION_ERROR, "ADMIN_USERNAME 不能为空")
    if not settings.admin_password:
        raise AppError(ErrorCode.VALIDATION_ERROR, "ADMIN_PASSWORD 不能为空")
    taken = session.scalars(
        select(UserORM.username).where(UserORM.username == username)
    ).first()
    suffix = 2
    while taken is not None:
        username = f"{settings.admin_username.strip()}-{suffix}"
        taken = session.scalars(
            select(UserORM.username).where(UserORM.username == username)
        ).first()
        suffix += 1
    root = user_tree.ensure_root_user(session)
    root.username = username
    root.password_hash = hash_password(settings.admin_password)
    root.role = rbac.BUILTIN_ROLE_ADMIN
    root.updated_at_ms = now_ms()
    session.flush()
    return True
