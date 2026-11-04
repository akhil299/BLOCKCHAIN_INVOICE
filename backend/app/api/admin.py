from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import _sync_role
from app.core.db import get_db
from app.core.security import norm_wallet, require_roles
from app.services import invoices as svc
from app.services.chain import chain, run

router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_roles("admin")


@router.get("/users")
async def users(_: dict = Depends(admin_only)):
    rows = await get_db().users.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for r in rows:
        r["created_at"] = r["created_at"].isoformat() + "Z"
    return {"users": rows}


@router.post("/users/{wallet}/approve")
async def approve(wallet: str, bg: BackgroundTasks, _: dict = Depends(admin_only)):
    w = norm_wallet(wallet)
    u = await get_db().users.find_one({"wallet": w})
    if not u:
        raise HTTPException(404, "User not found.")
    await get_db().users.update_one({"wallet": w}, {"$set": {"status": "active"}})
    if u["role"] in ("financier", "supplier"):
        bg.add_task(_sync_role, w, u["role"])
    return {"ok": True}


@router.post("/users/{wallet}/suspend")
async def suspend(wallet: str, admin: dict = Depends(admin_only)):
    w = norm_wallet(wallet)
    if w == admin["wallet"]:
        raise HTTPException(409, "You cannot suspend yourself.")
    r = await get_db().users.update_one({"wallet": w}, {"$set": {"status": "suspended"}})
    if not r.matched_count:
        raise HTTPException(404, "User not found.")
    return {"ok": True}


@router.get("/flagged")
async def flagged(_: dict = Depends(admin_only)):
    docs = await get_db().invoices.find({"$or": [{"status": "FLAGGED"}, {"analysis.risk.tier": "MEDIUM", "extra_verified": {"$ne": True}, "status": {"$in": ["VERIFIED", "PENDING_VERIFICATION", "CREATED"]}}]}, {"_id": 0}).to_list(500)
    return {"invoices": [svc.view(d) for d in docs]}


class ReviewReq(BaseModel):
    decision: str = Field(pattern="^(clear|hold)$")
    note: str = Field(min_length=3, max_length=500)


@router.post("/invoices/{invoice_id}/review")
async def review(invoice_id: str, req: ReviewReq, admin: dict = Depends(admin_only)):
    """Records the admin's manual-review decision. Clearing a flag on-chain is signed by the admin's own wallet (clearFlag)."""
    await svc.get_invoice_or_404(invoice_id)
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": {"admin_review": {"decision": req.decision, "note": req.note, "by": admin["wallet"], "at": datetime.utcnow().isoformat() + "Z"}}})
    return {"ok": True}


@router.post("/invoices/{invoice_id}/extra-verification")
async def extra_verification(invoice_id: str, admin: dict = Depends(admin_only)):
    """Medium-risk invoices need this on-chain confirmation (sent by the operator wallet) before financing can be requested."""
    doc = await svc.get_invoice_or_404(invoice_id)
    if doc.get("chain_id") is None or ((doc.get("analysis") or {}).get("risk") or {}).get("tier") != "MEDIUM" and doc.get("risk_tier_on_chain") != "MEDIUM":
        raise HTTPException(409, "Only registered medium-risk invoices need additional verification.")
    try:
        tx = await run(chain().op_confirm_extra, doc["chain_id"])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"On-chain confirmation failed: {e}")
    await svc.record_tx(tx["hash"], doc, "ExtraVerificationConfirmed", chain().operator.address, tx["block"])
    await svc.mirror_invoice(doc["chain_id"], doc=doc)
    return {"ok": True, "tx": tx}
