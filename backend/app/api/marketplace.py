from datetime import date, datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends

from app.core.db import get_db
from app.core.security import require_roles

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


def card(d: Dict[str, Any]) -> Dict[str, Any]:
    risk = (d.get("analysis") or {}).get("risk") or {}
    amount = float(d.get("amount") or 0)
    advance = float(d.get("advance_amount") or d.get("financed_amount") or 0)
    profit = amount - advance if advance else None
    days = (date.fromisoformat(d["due_date"]) - datetime.utcnow().date()).days if d.get("due_date") else None
    return {
        "id": d["id"], "chain_id": d.get("chain_id"), "invoice_number": d.get("invoice_number"), "supplier_name": d.get("supplier_name"),
        "buyer_name": d.get("buyer_name"), "amount": amount, "currency": "tUSD", "due_date": d.get("due_date"), "days_to_due": days,
        "advance_bps": d.get("advance_bps"), "advance_amount": advance or None, "repay_amount": amount, "profit": profit,
        "yield_pct": round(profit / advance * 100, 2) if profit and advance else None,
        "annualised_pct": round(profit / advance * 100 * 365 / days, 1) if profit and advance and days and days > 0 else None,
        "risk": {"score": risk.get("score"), "tier": risk.get("tier"), "disclaimer": risk.get("disclaimer"),
                 "factors": [f for f in risk.get("factors", []) if f.get("points", 0) > 0][:5]},
        "buyer_verified": True, "extra_verified": d.get("extra_verified"), "token_id": d.get("token_id"),
        "status": d["status"], "summary": (d.get("analysis") or {}).get("summary"),
        "supplier_wallet": d["supplier_wallet"], "buyer_wallet": d.get("buyer_wallet"), "financier_wallet": d.get("financier_wallet"),
        "repaid_amount": d.get("repaid_amount"), "financed_at": d["financed_at"].isoformat() + "Z" if d.get("financed_at") else None,
    }


@router.get("")
async def listings(user: dict = Depends(require_roles("financier", "admin"))):
    docs = await get_db().invoices.find({"status": "FINANCING_REQUESTED"}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return {"listings": [card(d) for d in docs]}


@router.get("/portfolio")
async def portfolio(user: dict = Depends(require_roles("financier"))):
    docs = await get_db().invoices.find({"financier_wallet": user["wallet"]}, {"_id": 0}).sort("financed_at", -1).to_list(500)
    return {"funded": [card(d) for d in docs]}
