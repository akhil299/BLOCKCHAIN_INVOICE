"""E. Assistant tools. READ-ONLY and scoped to the signed-in user, so the assistant can only report real data
the user is already allowed to see. No tool changes any state or signs anything."""
import re
from typing import Any, Dict, List, Optional

from app.core.db import get_db
from app.services import invoices as svc
from app.services.chain import chain, run

GLOSSARY = {
    "risk score": "The risk score (0-100) is an AI-generated screening indicator: rule checks (duplicates, date logic, amount patterns) plus an anomaly model. 0-34 is low, 35-69 medium (needs extra verification), 70-100 high (held for manual review). It is NOT a finding of fraud and never approves or blocks funds by itself.",
    "statuses": "CREATED (registered on-chain) -> PENDING_VERIFICATION (waiting for the buyer) -> VERIFIED (buyer confirmed, ERC-721 receipt minted) -> FINANCING_REQUESTED (listed in the marketplace) -> FINANCED (a financier funded it) -> REPAID -> CLOSED. Side states: REJECTED, FLAGGED (held for review), CANCELLED.",
    "token": "Each verified invoice gets an ERC-721 receipt token. It is locked while financing is active and burned on settlement. It is a technical reference, not proof of legal ownership of the receivable.",
    "tusd": "tUSD is a worthless test token on Sepolia that simulates financing. No real money is involved.",
}


class Tools:
    def __init__(self, user: Dict[str, Any]):
        self.user = user

    async def _visible(self) -> List[Dict[str, Any]]:
        u = self.user
        flt: Dict[str, Any] = {}
        if u["role"] == "supplier":
            flt["supplier_wallet"] = u["wallet"]
        elif u["role"] == "buyer":
            flt["buyer_wallet"] = u["wallet"]
        elif u["role"] == "financier":
            flt["$or"] = [{"status": "FINANCING_REQUESTED"}, {"financier_wallet": u["wallet"]}]
        docs = await get_db().invoices.find(flt, {"_id": 0}).sort("created_at", -1).to_list(500)
        return [d for d in docs if svc.can_view(d, u)]

    async def resolve(self, ref: Optional[str]) -> Optional[Dict[str, Any]]:
        """Best match for an invoice reference. Prefers on-chain invoices over drafts when numbers collide."""
        docs = await self._visible()
        if not docs:
            return None
        if not ref:
            return docs[0]
        r = re.sub(r"[^a-z0-9]", "", ref.lower())
        norm = lambda v: re.sub(r"[^a-z0-9]", "", (v or "").lower())  # noqa: E731
        exact = [d for d in docs if r and r in (norm(d.get("invoice_number")), norm(d["id"]))]
        matches = exact or [d for d in docs if r and r in norm(d.get("invoice_number"))]
        if not matches:
            return None
        matches.sort(key=lambda d: (d["status"] == "DRAFT", docs.index(d)))
        best = dict(matches[0])
        best["_other_matches"] = len(matches) - 1
        return best

    # ------------------------------------------------------------------ tools
    async def count_by_status(self) -> Dict[str, Any]:
        """Number of the user's invoices in each status."""
        docs = await self._visible()
        counts: Dict[str, int] = {}
        for d in docs:
            counts[d["status"]] = counts.get(d["status"], 0) + 1
        return {"total": len(docs), "by_status": counts}

    async def list_invoices(self, status: Optional[str] = None) -> Dict[str, Any]:
        """List the user's invoices, optionally only those with a given status (e.g. FINANCED, PENDING_VERIFICATION)."""
        docs = await self._visible()
        if status:
            docs = [d for d in docs if d["status"] == status.upper()]
        return {"count": len(docs), "invoices": [{"invoice_number": d.get("invoice_number"), "id": d["id"], "status": d["status"], "amount": d.get("amount"),
                                                  "buyer": d.get("buyer_name"), "supplier": d.get("supplier_name"), "due_date": d.get("due_date"),
                                                  "risk_tier": ((d.get("analysis") or {}).get("risk") or {}).get("tier")} for d in docs[:25]]}

    async def get_invoice(self, ref: Optional[str] = None) -> Dict[str, Any]:
        """Details and current status of one invoice, by invoice number or id. Without a reference, the most recent invoice."""
        d = await self.resolve(ref)
        if not d:
            return {"error": f"No invoice matching '{ref}' that you can access." if ref else "You have no invoices yet."}
        risk = (d.get("analysis") or {}).get("risk") or {}
        return {"invoice_number": d.get("invoice_number"), "id": d["id"], "status": d["status"], "amount": d.get("amount"), "buyer": d.get("buyer_name"),
                "supplier": d.get("supplier_name"), "invoice_date": d.get("invoice_date"), "due_date": d.get("due_date"), "on_chain": d.get("on_chain"),
                "blockchain_invoice_id": d.get("chain_id"), "risk_score": risk.get("score"), "risk_tier": risk.get("tier"),
                "financier": d.get("financier_wallet"), "financed_amount": d.get("financed_amount"), "repaid_amount": d.get("repaid_amount"),
                "other_invoices_with_same_number": d.get("_other_matches", 0)}

    async def explain_risk(self, ref: Optional[str] = None) -> Dict[str, Any]:
        """Why an invoice received its AI risk score / was flagged: contributing factors with points."""
        d = await self.resolve(ref)
        if not d:
            return {"error": "Invoice not found among the invoices you can access."}
        a = d.get("analysis") or {}
        risk = a.get("risk")
        if not risk:
            return {"error": "This invoice has no AI analysis yet."}
        return {"invoice_number": d.get("invoice_number"), "status": d["status"], "score": risk["score"], "tier": risk["tier"],
                "factors": [{"title": f["title"], "detail": f["detail"], "points": f["points"]} for f in risk["factors"]],
                "recommended_action": risk["recommended_action"], "summary": a.get("summary"), "admin_review": d.get("admin_review"), "disclaimer": risk["disclaimer"]}

    async def check_eligibility(self, ref: Optional[str] = None) -> Dict[str, Any]:
        """Whether an invoice is currently eligible for financing, with each check."""
        d = await self.resolve(ref)
        if not d:
            return {"error": "Invoice not found among the invoices you can access."}
        from app.agents.eligibility import run_eligibility
        out = await run_eligibility({"invoice": {**d, "buyer_wallet": d.get("buyer_wallet")}, "extraction": {"fields": {k: d.get(k) for k in ("amount", "due_date")}}, "risk": (d.get("analysis") or {}).get("risk") or {}})
        e = out["eligibility"]
        return {"invoice_number": d.get("invoice_number"), "eligible": e["eligible"], "checks": [{"check": c["name"], "passed": c["passed"], "detail": c["detail"]} for c in e["checks"]], "recommendation": e["recommendation"]}

    async def blockchain_info(self, ref: Optional[str] = None) -> Dict[str, Any]:
        """Live on-chain state and recorded transactions for an invoice."""
        d = await self.resolve(ref)
        if not d:
            return {"error": "Invoice not found among the invoices you can access."}
        txs = await get_db().chain_txs.find({"invoice_id": d["id"]}, {"_id": 0}).sort("at", 1).to_list(50)
        out: Dict[str, Any] = {"invoice_number": d.get("invoice_number"), "registered_on_chain": bool(d.get("chain_id")), "blockchain_invoice_id": d.get("chain_id"),
                               "document_hash": d.get("doc_hash"), "ipfs_cid": d.get("cid"),
                               "transactions": [{"hash": t["hash"], "event": t["kind"], "block": t["block"], "success": t["success"]} for t in txs]}
        if d.get("chain_id") and chain().status().get("connected"):
            try:
                oc = await run(chain().get_invoice, d["chain_id"])
                out["live_on_chain"] = {"status": oc["status"], "risk_tier_recorded": oc["risk"], "buyer": oc["buyer"], "supplier": oc["supplier"], "financier": oc["financier"]}
            except Exception as e:  # noqa: BLE001
                out["live_on_chain_error"] = str(e)[:120]
        return out

    async def glossary(self, term: str = "risk score") -> Dict[str, Any]:
        """Explain a platform concept: 'risk score', 'statuses', 'token', 'tusd'."""
        t = term.lower()
        for k, v in GLOSSARY.items():
            if k in t or t in k:
                return {"term": k, "explanation": v}
        return {"terms": list(GLOSSARY)}
