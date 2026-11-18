"""User-level bills (ticket 17): 我的花费, own node or visible subtree.

The route stays thin: scope math and aggregation live in `l05_service.bills`,
and the finished payload is field-filtered so cost/margin keys are absent (not
null) for callers without `billing:cost`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from l05_service import auth, bills
from l06_api.deps import require, session_of

router = APIRouter(tags=["bills"])


@router.get("/admin/bills/my-spend")
def my_spend(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("billing:spend")),
    range: str = "30d",
    scope: str = "self",
    user_id: str = "",
    tz: str = "",
) -> dict:
    """Spend by time range for the caller or its subtree.

    `scope=subtree` requires `billing:subtree` (管理用户 + 代理用户 hold it;
    普通用户 is rejected with 403). Passing `user_id` narrows the window to one
    visible node, which is how the page switches between subtree branches.
    """
    payload = bills.my_spend(
        session,
        principal,
        range_key=range,
        scope=scope,
        user_id=user_id,
        tz_name=tz or None,
    )
    return payload
