"""D. Financing Eligibility Agent - evaluates configured conditions and RECOMMENDS. It never approves financing."""
from datetime import date, datetime
from typing import Any, Dict, List

from app.agents.state import AnalysisState
from app.core.config import get_settings
from app.core.db import get_db

ADVANCE_BY_TIER = {"LOW": 9000, "MEDIUM": 8000, "HIGH": 0}
FINANCED_STATES = {"FINANCED", "REPAID", "CLOSED"}


def _check(name: str, passed: bool, detail: str, blocking: bool = True) -> Dict[str, Any]:
    return {"name": name, "passed": bool(passed), "detail": detail, "blocking": blocking}


async def run_eligibility(state: AnalysisState) -> AnalysisState:
    s = get_settings()
    inv = state["invoice"]
    f = (state.get("extraction") or {}).get("fields") or {}
    risk = state.get("risk") or {}
    status = inv.get("status", "DRAFT")
    tier = risk.get("tier", "UNASSESSED")
    checks: List[Dict[str, Any]] = []

    buyer = await get_db().users.find_one({"wallet": (inv.get("buyer_wallet") or "").lower(), "role": "buyer"}, {"_id": 0, "name": 1, "status": 1})
    checks.append(_check("Buyer is a registered InvoChain buyer", bool(buyer and buyer.get("status") != "suspended"),
                         f"Buyer: {buyer['name']}" if buyer else "The buyer wallet is not registered as a buyer on InvoChain."))
    checks.append(_check("Invoice registered on-chain", status not in ("DRAFT",), f"Status: {status}"))
    amount = f.get("amount")
    checks.append(_check("Amount within platform limits", bool(amount) and s.min_invoice_amount <= float(amount) <= s.max_invoice_amount,
                         f"{float(amount or 0):,.2f} (allowed {s.min_invoice_amount:,.0f}-{s.max_invoice_amount:,.0f})"))
    days = None
    if f.get("due_date"):
        try:
            days = (date.fromisoformat(f["due_date"]) - datetime.utcnow().date()).days
        except ValueError:
            pass
    checks.append(_check("Due date is far enough away", days is not None and days >= s.min_days_to_due,
                         f"{days} days until due (minimum {s.min_days_to_due})" if days is not None else "No valid due date"))
    checks.append(_check("Not already financed", status not in FINANCED_STATES, f"Status: {status}"))
    checks.append(_check("Risk tier allows financing", tier in ("LOW", "MEDIUM"),
                         f"AI risk tier: {tier}" + (" - held for manual review" if tier == "HIGH" else "")))
    if tier == "MEDIUM":
        checks.append(_check("Additional verification completed (medium risk)", bool(inv.get("extra_verified")),
                             "Confirmed by an administrator" if inv.get("extra_verified") else "Pending administrator confirmation"))
    buyer_ok = status in ("VERIFIED", "FINANCING_REQUESTED", "FINANCED", "REPAID", "CLOSED")
    checks.append(_check("Buyer has verified the invoice", buyer_ok, "Verified by the buyer's wallet" if buyer_ok else "Awaiting the buyer's on-chain verification"))

    blocking = [c for c in checks if c["blocking"] and not c["passed"]]
    eligible = not blocking
    if eligible:
        rec = (f"Eligible. Suggested advance rate {ADVANCE_BY_TIER.get(tier, 8000) / 100:.0f}% of face value "
               f"for a {tier.lower()}-risk invoice. This is a recommendation only; the financier decides and the smart contract enforces the rules.")
        stage = "ready"
    else:
        rec = "Not eligible yet: " + "; ".join(c["name"].lower() for c in blocking) + "."
        stage = "blocked" if any(c["name"].startswith(("Risk tier", "Not already")) and not c["passed"] for c in blocking) else "in_progress"
    return {"eligibility": {"eligible": eligible, "stage": stage, "checks": checks, "recommendation": rec,
                            "suggested_advance_bps": ADVANCE_BY_TIER.get(tier, 8000) if tier != "HIGH" else None,
                            "notice": "Recommendation only. This agent does not approve loans or move funds."}}
