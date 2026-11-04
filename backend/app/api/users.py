from typing import Optional

from fastapi import APIRouter, Depends

from app.core.db import get_db
from app.core.security import current_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/buyers")
async def buyers(q: Optional[str] = None, _: dict = Depends(current_user)):
    rows = await get_db().users.find({"role": "buyer", "status": "active"}, {"_id": 0, "wallet": 1, "name": 1, "company": 1}).to_list(500)
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r["company"].lower() or ql in r["name"].lower() or ql in r["wallet"]]
    return {"buyers": rows}
