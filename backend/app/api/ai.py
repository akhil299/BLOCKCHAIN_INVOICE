from collections import Counter

from fastapi import APIRouter, Depends

from app.core.db import get_db
from app.core.security import require_roles
from app.ml.model import get_model

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/overview")
async def overview(user: dict = Depends(require_roles("supplier", "admin", "buyer", "financier"))):
    flt = {"supplier_wallet": user["wallet"]} if user["role"] == "supplier" else {}
    docs = [d for d in await get_db().invoices.find(flt, {"_id": 0}).sort("created_at", -1).to_list(2000)
            if (d.get("analysis") or {}).get("risk")]
    if user["role"] == "buyer":
        docs = [d for d in docs if d.get("buyer_wallet") == user["wallet"] and d["status"] != "DRAFT"]
    if user["role"] == "financier":
        docs = [d for d in docs if d["status"] in ("FINANCING_REQUESTED", "FINANCED", "REPAID", "CLOSED")]
    scores = [d["analysis"]["risk"]["score"] for d in docs]
    signals = Counter(s["title"] for d in docs for s in (d["analysis"].get("fraud") or {}).get("signals", []) if s["points"] > 0)
    m = get_model()
    return {
        "total": len(docs), "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        "tiers": dict(Counter(d["analysis"]["risk"]["tier"] for d in docs)),
        "top_signals": [{"title": t, "count": c} for t, c in signals.most_common(6)],
        "histogram": [sum(1 for s in scores if lo <= s < lo + 10 or (lo == 90 and s == 100)) for lo in range(0, 100, 10)],
        "recent": [{"id": d["id"], "invoice_number": d.get("invoice_number"), "supplier_name": d.get("supplier_name"), "amount": d.get("amount"),
                    "score": d["analysis"]["risk"]["score"], "tier": d["analysis"]["risk"]["tier"], "status": d["status"],
                    "summary": d["analysis"].get("summary")} for d in docs[:15]],
        "model": {"version": m.version, "trained_on": m.art["trained_on"], "samples": m.art["n_samples"], "algorithm": "IsolationForest",
                  "note": "Anomaly detector trained on synthetic data. Indicators are not confirmed fraud."},
    }
