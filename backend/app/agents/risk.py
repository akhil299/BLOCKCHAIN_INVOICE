"""C. Risk Assessment Agent - 0-100 score = rule points (<=65) + Isolation-Forest anomaly points (<=35).
Always explainable, always labelled as a model indicator rather than confirmed fraud."""
from datetime import datetime
from typing import Any, Dict

from app.agents.state import AnalysisState
from app.core.db import get_db
from app.ml.features import build_features
from app.ml.model import get_model

LOW_MAX, MEDIUM_MAX = 34, 69  # 0-34 low, 35-69 medium, 70-100 high
MODEL_MAX_POINTS = 35


def tier_for(score: int) -> str:
    return "LOW" if score <= LOW_MAX else "MEDIUM" if score <= MEDIUM_MAX else "HIGH"


async def run_risk(state: AnalysisState) -> AnalysisState:
    inv = state["invoice"]
    ext = state.get("extraction") or {}
    f = ext.get("fields") or {}
    fraud = state.get("fraud") or {"signals": [], "rule_points": 0}
    history = await get_db().invoices.find({"supplier_wallet": inv["supplier_wallet"], "id": {"$ne": inv["id"]},
                                            "status": {"$nin": ["REJECTED", "CANCELLED"]}}, {"_id": 0}).to_list(500)
    feats = build_features({**f, "buyer_wallet": inv.get("buyer_wallet")}, history,
                           missing_count=len(ext.get("missing_fields") or []), ocr_confidence=ext.get("ocr_confidence", 1.0))
    ml = get_model().score(feats)
    model_points = round(MODEL_MAX_POINTS * max(0.0, min(1.0, (ml["anomaly_percentile"] - 85.0) / 15.0)))
    score = min(100, fraud["rule_points"] + model_points)
    forced = [s for s in fraud["signals"] if s.get("forces_high")]
    if forced:
        score = max(score, 80)
    tier = tier_for(score)

    factors = [{"source": "rule", "id": s["id"], "title": s["title"], "detail": s["detail"], "points": s["points"], "severity": s["severity"]}
              for s in sorted(fraud["signals"], key=lambda s: -s["points"])]
    if model_points:
        devs = ", ".join(d["label"] for d in ml["top_deviations"]) or "overall pattern"
        factors.append({"source": "model", "id": "ANOMALY_MODEL", "title": "Statistical anomaly model",
                        "detail": f"The invoice looks unusual compared with typical invoices (more unusual than {ml['anomaly_percentile']:.0f}% of the training data). Most unusual: {devs}.",
                        "points": model_points, "severity": "warning"})
    if forced:
        factors.append({"source": "policy", "id": "FORCED_HIGH", "title": "Policy: held for manual review",
                        "detail": "A duplicate or self-dealing indicator was found, so the invoice is held for review regardless of the numeric score.",
                        "points": 0, "severity": "critical"})
    action = {"LOW": "Can proceed to buyer verification, then to financier review.",
              "MEDIUM": "Needs additional verification by an administrator before it can be financed.",
              "HIGH": "Held for manual review. It cannot be financed until an administrator clears it."}[tier]
    return {"risk": {
        "score": int(score), "tier": tier, "factors": factors, "recommended_action": action,
        "rule_points": fraud["rule_points"], "model_points": model_points, "model": ml, "features": {k: round(v, 3) for k, v in feats.items()},
        "model_note": "Model trained on SYNTHETIC invoice data; use as a screening aid only.",
        "disclaimer": "AI-generated risk indicator. It is not a determination of fraud and never approves or blocks funds by itself - "
                      "smart-contract rules and human reviewers make the final decision.",
        "assessed_at": datetime.utcnow().isoformat() + "Z"}}
