from collections import Counter
from typing import Any, Dict

from fastapi import APIRouter, Depends

from app.core.db import get_db
from app.core.security import current_user, require_roles

router = APIRouter(tags=["dashboard"])


def _sum(docs, key="amount"):
    return round(sum(float(d.get(key) or 0) for d in docs), 2)


@router.get("/dashboard")
async def dashboard(user: dict = Depends(current_user)):
    db, role, w = get_db(), user["role"], user["wallet"]
    out: Dict[str, Any] = {"role": role}
    if role == "supplier":
        docs = await db.invoices.find({"supplier_wallet": w}, {"_id": 0}).to_list(2000)
        fin = [d for d in docs if d["status"] in ("FINANCED", "REPAID", "CLOSED")]
        alerts = [d for d in docs if ((d.get("analysis") or {}).get("risk") or {}).get("tier") in ("MEDIUM", "HIGH") and d["status"] not in ("REJECTED", "CANCELLED", "CLOSED")]
        out.update(total=len(docs), pending_verification=len([d for d in docs if d["status"] == "PENDING_VERIFICATION"]),
                   financed=len(fin), rejected=len([d for d in docs if d["status"] == "REJECTED"]),
                   financing_received=_sum(fin, "financed_amount"), draft=len([d for d in docs if d["status"] == "DRAFT"]),
                   awaiting_funding=len([d for d in docs if d["status"] == "FINANCING_REQUESTED"]),
                   risk_alerts=[{"id": d["id"], "invoice_number": d.get("invoice_number"), "tier": d["analysis"]["risk"]["tier"],
                                 "score": d["analysis"]["risk"]["score"], "status": d["status"]} for d in alerts][:8],
                   by_status=dict(Counter(d["status"] for d in docs)))
    elif role == "buyer":
        docs = await db.invoices.find({"buyer_wallet": w, "status": {"$ne": "DRAFT"}}, {"_id": 0}).to_list(2000)
        out.update(total=len(docs), pending=len([d for d in docs if d["status"] == "PENDING_VERIFICATION"]),
                   verified=len([d for d in docs if d["status"] in ("VERIFIED", "FINANCING_REQUESTED", "FINANCED", "REPAID", "CLOSED")]),
                   rejected=len([d for d in docs if d["status"] == "REJECTED"]),
                   to_repay=len([d for d in docs if d["status"] == "FINANCED"]), amount_to_repay=_sum([d for d in docs if d["status"] == "FINANCED"], "repay_amount"),
                   by_status=dict(Counter(d["status"] for d in docs)))
    elif role == "financier":
        avail = await db.invoices.find({"status": "FINANCING_REQUESTED"}, {"_id": 0}).to_list(500)
        mine = await db.invoices.find({"financier_wallet": w}, {"_id": 0}).to_list(2000)
        active = [d for d in mine if d["status"] in ("FINANCED", "REPAID")]
        repaid = [d for d in mine if d["status"] in ("REPAID", "CLOSED")]
        earned = sum(float(d.get("repay_amount") or 0) - float(d.get("financed_amount") or 0) for d in repaid)
        out.update(available=len(avail), approved=len(mine), funds_deployed=_sum(mine, "financed_amount"), active=len(active),
                   repaid=len(repaid), returns_earned=round(earned, 2), by_status=dict(Counter(d["status"] for d in mine)))
    else:
        invs = await db.invoices.find({}, {"_id": 0}).to_list(5000)
        users = await db.users.find({}, {"_id": 0}).to_list(5000)
        fin = [d for d in invs if d["status"] in ("FINANCED", "REPAID", "CLOSED")]
        out.update(users=len(users), users_by_role=dict(Counter(u["role"] for u in users)), pending_approvals=len([u for u in users if u["status"] == "pending"]),
                   total=len(invs), flagged=len([d for d in invs if d["status"] == "FLAGGED"]), financed=len(fin), volume_financed=_sum(fin, "financed_amount"),
                   transactions=await db.chain_txs.count_documents({}), by_status=dict(Counter(d["status"] for d in invs)),
                   tiers=dict(Counter(((d.get("analysis") or {}).get("risk") or {}).get("tier", "UNASSESSED") for d in invs)))
    return out
