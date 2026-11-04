"""Feature engineering for the anomaly model. Features are computed from the invoice itself plus the
supplier's previous invoices stored in MongoDB, so the model sees behaviour, not just one document."""
import math
from datetime import date, datetime
from difflib import SequenceMatcher
from statistics import mean, pstdev
from typing import Dict, List

NEUTRAL_SIMILARITY = 0.25

FEATURES = [
    "amount_log", "amount_z_supplier", "amount_z_pair", "is_round_amount", "term_days", "age_days",
    "number_similarity", "same_amount_recent", "supplier_velocity_7d", "pair_history", "missing_count", "ocr_confidence",
]

FEATURE_LABELS = {
    "amount_log": "invoice amount",
    "amount_z_supplier": "amount compared with the supplier's usual invoices",
    "amount_z_pair": "amount compared with this supplier-buyer relationship",
    "is_round_amount": "suspiciously round amount",
    "term_days": "payment term length",
    "age_days": "invoice age (negative = future-dated)",
    "number_similarity": "similarity of the invoice number to earlier ones",
    "same_amount_recent": "earlier invoices with the same amount",
    "supplier_velocity_7d": "number of invoices from this supplier in the last 7 days",
    "pair_history": "prior invoices between this supplier and buyer",
    "missing_count": "missing required fields",
    "ocr_confidence": "extraction confidence",
}


def _d(v) -> date | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _z(x: float, series: List[float]) -> float:
    if len(series) < 3:
        return 0.0
    sd = pstdev(series)
    return 0.0 if sd < 1e-9 else max(-8.0, min(8.0, (x - mean(series)) / sd))


def build_features(inv: Dict, history: List[Dict], missing_count: int = 0, ocr_confidence: float = 1.0,
                   today: date | None = None) -> Dict[str, float]:
    """`inv` needs: amount, invoice_date, due_date, invoice_number, buyer_wallet. `history` = supplier's other invoices."""
    today = today or datetime.utcnow().date()
    amount = float(inv.get("amount") or 0)
    inv_d, due_d = _d(inv.get("invoice_date")), _d(inv.get("due_date"))
    number = (inv.get("invoice_number") or "").upper()
    buyer = (inv.get("buyer_wallet") or "").lower()

    amounts = [float(h["amount"]) for h in history if h.get("amount")]
    pair = [h for h in history if (h.get("buyer_wallet") or "").lower() == buyer]
    pair_amounts = [float(h["amount"]) for h in pair if h.get("amount")]
    sims = [SequenceMatcher(None, number, (h.get("invoice_number") or "").upper()).ratio() for h in history if h.get("invoice_number")]
    same_amt = [h for h in pair if abs(float(h.get("amount") or 0) - amount) < 0.005]
    recent = 0
    for h in history:
        created = _d(h.get("created_at"))
        if created and 0 <= (today - created).days <= 7:
            recent += 1

    return {
        "amount_log": math.log(max(amount, 1.0)),
        "amount_z_supplier": _z(amount, amounts),
        "amount_z_pair": _z(amount, pair_amounts),
        "is_round_amount": 1.0 if amount >= 1000 and abs(amount - round(amount, -3)) < 0.005 else 0.0,
        "term_days": float((due_d - inv_d).days) if inv_d and due_d else 30.0,
        "age_days": float((today - inv_d).days) if inv_d else 0.0,
        "number_similarity": max(sims) if sims else NEUTRAL_SIMILARITY,  # no history -> neutral, not "unusually different"
        "same_amount_recent": float(len(same_amt)),
        "supplier_velocity_7d": float(recent),
        "pair_history": float(len(pair)),
        "missing_count": float(missing_count),
        "ocr_confidence": float(ocr_confidence),
    }
