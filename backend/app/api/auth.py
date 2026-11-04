import logging
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import (create_token, current_wallet, current_user, issue_nonce, norm_wallet, verify_login)
from app.services.chain import chain, run

log = logging.getLogger("invochain.auth")
router = APIRouter(prefix="/auth", tags=["auth"])


class NonceReq(BaseModel):
    address: str


class LoginReq(BaseModel):
    address: str
    signature: str


class RegisterReq(BaseModel):
    role: str = Field(pattern="^(supplier|buyer|financier)$")
    name: str = Field(min_length=2, max_length=80)
    company: str = Field(min_length=2, max_length=120)
    email: Optional[str] = Field(default=None, max_length=120)


class ProfileReq(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    company: Optional[str] = Field(default=None, min_length=2, max_length=120)
    email: Optional[str] = Field(default=None, max_length=120)


async def _sync_role(wallet: str, role: str) -> None:
    """Mirror an approved app role to the contract (operator wallet). Best effort; retry via /auth/me/sync-role."""
    chain_role = {"supplier": "SUPPLIER_ROLE", "financier": "FINANCIER_ROLE"}.get(role)
    if not chain_role:
        return
    try:
        tx = await run(chain().op_grant_role, chain_role, wallet)
        await get_db().users.update_one({"wallet": wallet}, {"$set": {"chain_role_synced": True, "chain_role_error": None}})
        if tx:
            from app.services.invoices import record_tx
            await record_tx(tx["hash"], None, f"Grant{chain_role}", chain().operator.address, tx["block"])
    except Exception as e:  # noqa: BLE001
        log.warning("role sync failed for %s: %s", wallet, e)
        await get_db().users.update_one({"wallet": wallet}, {"$set": {"chain_role_synced": False, "chain_role_error": str(e)[:200]}})


def public_user(u: dict) -> dict:
    return {k: v for k, v in u.items() if k != "_id"}


@router.post("/nonce")
async def nonce(req: NonceReq):
    return await issue_nonce(norm_wallet(req.address))


@router.post("/login")
async def login(req: LoginReq):
    wallet = norm_wallet(req.address)
    await verify_login(wallet, req.signature)
    db = get_db()
    user = await db.users.find_one({"wallet": wallet}, {"_id": 0})
    if not user and wallet in get_settings().admin_wallet_list:
        user = {"wallet": wallet, "role": "admin", "name": "Administrator", "company": "InvoChain", "email": None,
                "status": "active", "created_at": datetime.utcnow(), "chain_role_synced": True}
        await db.users.insert_one(dict(user))
    return {"token": create_token(wallet), "user": public_user(user) if user else None, "wallet": wallet}


@router.post("/register")
async def register(req: RegisterReq, bg: BackgroundTasks, wallet: str = Depends(current_wallet)):
    db = get_db()
    if await db.users.find_one({"wallet": wallet}):
        raise HTTPException(409, "This wallet is already registered.")
    if req.email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", req.email):
        raise HTTPException(422, "Enter a valid email address.")
    user = {"wallet": wallet, "role": req.role, "name": req.name.strip(), "company": req.company.strip(), "email": req.email,
            "status": "pending" if req.role == "financier" else "active", "created_at": datetime.utcnow(),
            "chain_role_synced": req.role == "buyer"}
    await db.users.insert_one(dict(user))
    if req.role == "supplier":
        bg.add_task(_sync_role, wallet, "supplier")
    return {"user": public_user(user)}


@router.get("/me")
async def me(wallet: str = Depends(current_wallet)):
    user = await get_db().users.find_one({"wallet": wallet}, {"_id": 0})
    return {"wallet": wallet, "user": user}


@router.patch("/me")
async def update_me(req: ProfileReq, user: dict = Depends(current_user)):
    upd = {k: v for k, v in req.model_dump().items() if v is not None}
    if upd:
        await get_db().users.update_one({"wallet": user["wallet"]}, {"$set": upd})
    return {"user": await get_db().users.find_one({"wallet": user["wallet"]}, {"_id": 0})}


@router.post("/me/sync-role")
async def sync_role(bg: BackgroundTasks, user: dict = Depends(current_user)):
    if user["role"] == "financier" and user["status"] != "active":
        raise HTTPException(403, "Your financier account must be approved first.")
    await _sync_role(user["wallet"], user["role"])
    return {"user": await get_db().users.find_one({"wallet": user["wallet"]}, {"_id": 0})}
