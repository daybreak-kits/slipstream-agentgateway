"""CRUD-only repositories (docs/PLAN.md §7: repositories do CRUD, nothing else)."""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from l04_repo.orm import (
    ApiKeyORM,
    AppSettingORM,
    AuditLogORM,
    AvailabilityRuleORM,
    Base,
    ChargeEntryORM,
    ChargePriceORM,
    ConfigRevisionORM,
    CostDailyORM,
    CostEntryORM,
    FxSnapshotORM,
    GatewayUsageEventORM,
    LedgerEntryORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamKeyORM,
    UpstreamModelORM,
    UpstreamORM,
    UpstreamPriceORM,
    UpstreamProbeORM,
    UserDailyORM,
    UserORM,
    VendorORM,
)

T = TypeVar("T", bound=Base)


class CrudRepository(Generic[T]):
    """Thin create/read/update/delete wrapper over one ORM class."""

    def __init__(self, orm_class: type[T]) -> None:
        self._orm_class = orm_class

    def get(self, session: Session, entity_id: str) -> T | None:
        return session.get(self._orm_class, entity_id)

    def list_all(self, session: Session, *, limit: int = 200, offset: int = 0) -> list[T]:
        stmt = select(self._orm_class).limit(limit).offset(offset)
        return list(session.scalars(stmt).all())

    def add(self, session: Session, obj: T) -> T:
        session.add(obj)
        session.flush()
        return obj

    def delete(self, session: Session, obj: T) -> None:
        session.delete(obj)
        session.flush()

    def set_fields(self, obj: T, fields: dict[str, Any]) -> T:
        """Apply a whitelist-checked field dict; callers own validation."""
        for key, value in fields.items():
            setattr(obj, key, value)
        return obj

    def count(self, session: Session) -> int:
        return len(list(session.scalars(select(self._orm_class)).all()))


def get_setting(session: Session, key: str) -> str | None:
    row = session.get(AppSettingORM, key)
    return row.value_json if row else None


def put_setting(session: Session, key: str, value_json: str, updated_at_ms: int) -> None:
    row = session.get(AppSettingORM, key)
    if row is None:
        session.add(AppSettingORM(key=key, value_json=value_json, updated_at_ms=updated_at_ms))
    else:
        row.value_json = value_json
        row.updated_at_ms = updated_at_ms
    session.flush()


VENDOR_REPO: CrudRepository[VendorORM] = CrudRepository(VendorORM)
UPSTREAM_REPO: CrudRepository[UpstreamORM] = CrudRepository(UpstreamORM)
UPSTREAM_KEY_REPO: CrudRepository[UpstreamKeyORM] = CrudRepository(UpstreamKeyORM)
UPSTREAM_PROBE_REPO: CrudRepository[UpstreamProbeORM] = CrudRepository(UpstreamProbeORM)
UPSTREAM_MODEL_REPO: CrudRepository[UpstreamModelORM] = CrudRepository(UpstreamModelORM)
PUBLIC_MODEL_REPO: CrudRepository[PublicModelORM] = CrudRepository(PublicModelORM)
MODEL_TARGET_REPO: CrudRepository[ModelTargetORM] = CrudRepository(ModelTargetORM)
USER_REPO: CrudRepository[UserORM] = CrudRepository(UserORM)
API_KEY_REPO: CrudRepository[ApiKeyORM] = CrudRepository(ApiKeyORM)
AVAILABILITY_REPO: CrudRepository[AvailabilityRuleORM] = CrudRepository(AvailabilityRuleORM)
USAGE_EVENT_REPO: CrudRepository[GatewayUsageEventORM] = CrudRepository(GatewayUsageEventORM)
UPSTREAM_PRICE_REPO: CrudRepository[UpstreamPriceORM] = CrudRepository(UpstreamPriceORM)
CHARGE_PRICE_REPO: CrudRepository[ChargePriceORM] = CrudRepository(ChargePriceORM)
COST_ENTRY_REPO: CrudRepository[CostEntryORM] = CrudRepository(CostEntryORM)
CHARGE_ENTRY_REPO: CrudRepository[ChargeEntryORM] = CrudRepository(ChargeEntryORM)
LEDGER_REPO: CrudRepository[LedgerEntryORM] = CrudRepository(LedgerEntryORM)
COST_DAILY_REPO: CrudRepository[CostDailyORM] = CrudRepository(CostDailyORM)
USER_DAILY_REPO: CrudRepository[UserDailyORM] = CrudRepository(UserDailyORM)
FX_REPO: CrudRepository[FxSnapshotORM] = CrudRepository(FxSnapshotORM)
REVISION_REPO: CrudRepository[ConfigRevisionORM] = CrudRepository(ConfigRevisionORM)
AUDIT_REPO: CrudRepository[AuditLogORM] = CrudRepository(AuditLogORM)
