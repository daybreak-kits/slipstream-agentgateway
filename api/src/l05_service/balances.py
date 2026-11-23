"""Prepaid balance movements (ADR-007 + ADR-011): every change walks the ledger.

The ledger is the authority: users.balance_micro is the running total and each
movement row carries balance_after_micro. E10 lessons applied: the AG budget is
only a fast intercept (bills one request ahead, resets on restart), so nothing
here trusts the data plane. Balance may legitimately go negative by at most one
overshooting request; the precheck endpoint exists for stricter callers.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l04_repo.orm import AuditLogORM, LedgerEntryORM, UserORM

LEDGER_KINDS = ("charge", "topup", "refund", "adjust")


def _audit(session: Session, *, actor: str, action: str, user_id: str, detail: str) -> None:
    session.add(
        AuditLogORM(
            id=new_id("aud"),
            actor=actor or "system",
            action=action,
            entity_type="user",
            entity_id=user_id,
            detail_json=detail,
            created_at_ms=now_ms(),
        )
    )


def _apply_delta(
    session: Session,
    user: UserORM,
    *,
    kind: str,
    delta_micro: int,
    currency: str,
    ref_type: str = "",
    ref_id: str | None = None,
    note: str = "",
    created_by: str = "",
) -> LedgerEntryORM:
    """Insert one ledger row and move the user balance; single source of movement."""
    if kind not in LEDGER_KINDS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown ledger kind: {kind}",
            details={"kind": kind, "known": list(LEDGER_KINDS)},
        )
    user.balance_micro = user.balance_micro + delta_micro
    row = LedgerEntryORM(
        id=new_id("led"),
        user_id=user.id,
        kind=kind,
        delta_micro=delta_micro,
        balance_after_micro=user.balance_micro,
        currency=currency,
        ref_type=ref_type,
        ref_id=ref_id,
        note=note,
        created_by=created_by,
        created_at_ms=now_ms(),
    )
    session.add(row)
    session.flush()
    return row


def record_topup(
    session: Session,
    *,
    user_id: str,
    amount_micro: int,
    currency: str,
    created_by: str = "",
    note: str = "",
) -> LedgerEntryORM:
    """Prepaid top-up: strictly positive credit against the user balance."""
    user = session.get(UserORM, user_id)
    if user is None:
        raise AppError(ErrorCode.NOT_FOUND, f"user not found: {user_id}")
    if amount_micro <= 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "topup amount_micro must be positive")
    row = _apply_delta(
        session,
        user,
        kind="topup",
        delta_micro=amount_micro,
        currency=currency,
        ref_type="manual_topup",
        note=note,
        created_by=created_by,
    )
    _audit(session, actor=created_by, action="balance_topup", user_id=user_id, detail=note)
    return row


def record_refund(
    session: Session,
    *,
    user_id: str,
    amount_micro: int,
    currency: str,
    ref_type: str = "",
    ref_id: str | None = None,
    created_by: str = "",
    note: str = "",
) -> LedgerEntryORM:
    """Refund a previous charge: strictly positive credit referencing its entry."""
    user = session.get(UserORM, user_id)
    if user is None:
        raise AppError(ErrorCode.NOT_FOUND, f"user not found: {user_id}")
    if amount_micro <= 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "refund amount_micro must be positive")
    return _apply_delta(
        session,
        user,
        kind="refund",
        delta_micro=amount_micro,
        currency=currency,
        ref_type=ref_type,
        ref_id=ref_id,
        note=note,
        created_by=created_by,
    )


def record_adjust(
    session: Session,
    *,
    user_id: str,
    delta_micro: int,
    currency: str,
    created_by: str = "",
    note: str = "",
) -> LedgerEntryORM:
    """Manual correction with an explicit signed delta (audit-required in the UI)."""
    user = session.get(UserORM, user_id)
    if user is None:
        raise AppError(ErrorCode.NOT_FOUND, f"user not found: {user_id}")
    if delta_micro == 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "adjust delta_micro must be non-zero")
    return _apply_delta(
        session,
        user,
        kind="adjust",
        delta_micro=delta_micro,
        currency=currency,
        ref_type="manual_adjust",
        note=note,
        created_by=created_by,
    )


def deduct_for_charge(
    session: Session,
    *,
    user: UserORM,
    amount_micro: int,
    currency: str,
    charge_entry_id: str,
) -> LedgerEntryORM:
    """Ledger side of a priced charge entry (negative delta, may go negative)."""
    return _apply_delta(
        session,
        user,
        kind="charge",
        delta_micro=-amount_micro,
        currency=currency,
        ref_type="charge_entry",
        ref_id=charge_entry_id,
        created_by="billing",
    )


def reconcile_balances(session: Session) -> list[str]:
    """Recompute balance_micro from ledger sums; fix drift, return changed user ids.

    Idempotent: a clean book yields an empty list. Used by the periodic job and
    after imports; each fix writes an adjust entry so the ledger still explains
    the running balance.
    """
    sums: dict[str, int] = {}
    for row in session.scalars(select(LedgerEntryORM)).all():
        sums[row.user_id] = sums.get(row.user_id, 0) + row.delta_micro
    changed: list[str] = []
    for user in session.scalars(select(UserORM)).all():
        expected = sums.get(user.id, 0)
        if user.balance_micro != expected:
            drift = expected - user.balance_micro
            user.balance_micro = expected
            session.add(
                LedgerEntryORM(
                    id=new_id("led"),
                    user_id=user.id,
                    kind="adjust",
                    delta_micro=drift,
                    balance_after_micro=expected,
                    currency="USD",
                    ref_type="reconcile",
                    note="balance drift corrected from ledger sum",
                    created_by="reconcile-job",
                    created_at_ms=now_ms(),
                )
            )
            changed.append(user.id)
    session.flush()
    return changed
