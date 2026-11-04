"""B. Fraud Detection Agent - duplicates, inconsistencies and suspicious patterns (rule based, explainable).
Signals are INDICATORS, never a verdict of fraud."""
import re
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from typing import Any, Dict, List

from web3 import Web3

from app.agents.state import AnalysisState
from app.core.config import get_settings
from app.core.db import get_db
from app.services.chain import chain, run

RULE_CAP = 65
LIVE_EXCLUDED = {"REJECTED", "CANCELLED", "DRAFT"}


def normalise_number(n: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (n or "").upper())


def number_hash(n: str) -> str:
    return "0x" + Web3.keccak(text=normalise_number(n)).hex().removeprefix("0x")


def _sig(sid: str, severity: str, points: int, title: str, detail: str, forces_high: bool = False) -> Dict[str, Any]:
    return {"id": sid, "severity": severity, "points": points, "title": title, "detail": detail, "forces_high": forces_high}


async def run_fraud(state: AnalysisState) -> AnalysisState:
    inv = state["invoice"]
    f = (state.get("extraction") or {}).get("fields") or {}
    conf = (state.get("extraction") or {}).get("confidence") or {}
    db = get_db()
    signals: List[Dict[str, Any]] = []
    duplicate = {"exact_document": False, "same_number_pair": False, "existing_invoice_id": None}

    others = await db.invoices.find({"supplier_wallet": inv["supplier_wallet"], "id": {"$ne": inv["id"]}}, {"_id": 0}).to_list(500)
    live = [o for o in others if o.get("status") not in LIVE_EXCLUDED]

    # ---- exact document duplicate (any supplier: the same file must never be financed twice)
    same_doc = await db.invoices.find_one({"doc_hash": inv.get("doc_hash"), "id": {"$ne": inv["id"]},
                                           "status": {"$nin": list(LIVE_EXCLUDED)}}, {"_id": 0, "id": 1, "invoice_number": 1})
    if same_doc and inv.get("doc_hash"):
        duplicate.update(exact_document=True, existing_invoice_id=same_doc["id"])
        signals.append(_sig("DUPLICATE_DOCUMENT", "critical", 60, "Identical document already registered",
                            f"This exact file matches invoice {same_doc.get('invoice_number') or same_doc['id']}.", True))

    # ---- same invoice number for the same parties
    num = normalise_number(f.get("invoice_number"))
    buyer = (inv.get("buyer_wallet") or "").lower()
    if num:
        dup_pair = [o for o in live if normalise_number(o.get("invoice_number")) == num and (o.get("buyer_wallet") or "").lower() == buyer]
        if dup_pair:
            duplicate.update(same_number_pair=True, existing_invoice_id=duplicate["existing_invoice_id"] or dup_pair[0]["id"])
            signals.append(_sig("DUPLICATE_NUMBER", "critical", 50, "Invoice number already used with this buyer",
                                f"Invoice number {f.get('invoice_number')} was already submitted for the same buyer.", True))
        else:
            sims = [(SequenceMatcher(None, num, normalise_number(o.get("invoice_number"))).ratio(), o) for o in live if o.get("invoice_number")]
            sims = [(r, o) for r, o in sims if r >= 0.88 and normalise_number(o.get("invoice_number")) != num]
            if sims:
                r, o = max(sims, key=lambda t: t[0])
                signals.append(_sig("NEAR_DUPLICATE_NUMBER", "warning", 15, "Very similar invoice number",
                                    f"{f.get('invoice_number')} is {r:.0%} similar to earlier invoice {o.get('invoice_number')}."))

    # ---- on-chain duplicate check (defence in depth; the contract enforces it again at registration)
    if inv.get("doc_hash") and f.get("invoice_number") and inv.get("buyer_wallet") and chain().status().get("connected"):
        try:
            is_dup, existing = await run(chain().check_duplicate, inv["doc_hash"], inv["supplier_wallet"], inv["buyer_wallet"], number_hash(f["invoice_number"]))
            if is_dup and not duplicate["exact_document"] and not duplicate["same_number_pair"]:
                duplicate.update(exact_document=True, existing_invoice_id=existing)
                signals.append(_sig("DUPLICATE_ON_CHAIN", "critical", 60, "Already registered on the blockchain",
                                    f"On-chain invoice #{existing} already uses this document or invoice number.", True))
        except Exception:  # noqa: BLE001 - chain being down must not block analysis
            pass

    # ---- same amount re-billed to the same buyer recently
    amount = f.get("amount")
    if amount:
        recent_same = [o for o in live if (o.get("buyer_wallet") or "").lower() == buyer and abs(float(o.get("amount") or 0) - float(amount)) < 0.005]
        if recent_same:
            signals.append(_sig("SAME_AMOUNT_REPEATED", "warning", 12, "Same amount billed to the same buyer before",
                                f"{len(recent_same)} earlier invoice(s) to this buyer have exactly the same amount."))

    # ---- date consistency
    inv_d = due_d = None
    try:
        inv_d = date.fromisoformat(f["invoice_date"]) if f.get("invoice_date") else None
        due_d = date.fromisoformat(f["due_date"]) if f.get("due_date") else None
    except ValueError:
        signals.append(_sig("BAD_DATE_FORMAT", "warning", 10, "Unreadable date", "A date could not be interpreted."))
    today = datetime.utcnow().date()
    if inv_d and due_d and due_d <= inv_d:
        signals.append(_sig("DUE_BEFORE_INVOICE", "critical", 30, "Due date is not after the invoice date",
                            f"Invoice date {inv_d} but due date {due_d}."))
    if inv_d and inv_d > today + timedelta(days=1):
        signals.append(_sig("FUTURE_DATED", "warning", 20, "Invoice is dated in the future", f"Invoice date {inv_d} is after today."))
    if inv_d and due_d and (due_d - inv_d).days > 180:
        signals.append(_sig("LONG_TERMS", "warning", 10, "Very long payment terms", f"{(due_d - inv_d).days} days between invoice and due date."))
    if inv_d and (today - inv_d).days > 120:
        signals.append(_sig("STALE_INVOICE", "info", 6, "Old invoice", f"Issued {(today - inv_d).days} days ago."))

    # ---- amount patterns
    amounts = [float(o["amount"]) for o in others if o.get("amount")]
    if amount and len(amounts) >= 3:
        mean = sum(amounts) / len(amounts)
        sd = (sum((a - mean) ** 2 for a in amounts) / len(amounts)) ** 0.5
        if sd > 0 and abs(float(amount) - mean) / sd > 3:
            signals.append(_sig("AMOUNT_OUTLIER", "warning", 20, "Amount far outside the supplier's history",
                                f"{float(amount):,.2f} vs typical {mean:,.2f}."))
    if amount and float(amount) >= 1000 and abs(float(amount) - round(float(amount), -3)) < 0.005:
        signals.append(_sig("ROUND_AMOUNT", "info", 8, "Perfectly round amount", f"{float(amount):,.2f} is an exact multiple of 1,000."))

    if amount and float(amount) >= 100_000 and not others:
        signals.append(_sig("LARGE_FIRST_INVOICE", "warning", 20, "Large invoice from a supplier with no history",
                            f"{float(amount):,.2f} is the supplier's first invoice on the platform, so there is nothing to compare it with."))

    # ---- relationship / velocity / self dealing
    if not [o for o in others if (o.get("buyer_wallet") or "").lower() == buyer]:
        signals.append(_sig("NEW_RELATIONSHIP", "info", 5, "First invoice between this supplier and buyer", "No prior history to compare against."))
    week = [o for o in others if o.get("created_at") and (datetime.utcnow() - o["created_at"]).days <= 7]
    if len(week) >= 5:
        signals.append(_sig("HIGH_VELOCITY", "warning", 10, "Many invoices submitted this week", f"{len(week)} invoices in the last 7 days."))
    if buyer and buyer == inv["supplier_wallet"]:
        signals.append(_sig("SELF_DEALING", "critical", 40, "Supplier and buyer wallets are the same", "A business cannot invoice itself.", True))
    sn, bn = (f.get("supplier_name") or "").strip().lower(), (f.get("buyer_name") or "").strip().lower()
    if sn and bn and SequenceMatcher(None, sn, bn).ratio() > 0.92:
        signals.append(_sig("SAME_PARTY_NAMES", "critical", 40, "Supplier and buyer names are the same or near-identical", f"'{f.get('supplier_name')}' vs '{f.get('buyer_name')}'.", True))

    # ---- data quality
    miss = (state.get("extraction") or {}).get("missing_fields") or []
    if miss:
        signals.append(_sig("MISSING_FIELDS", "warning", min(15, 5 * len(miss)), "Required fields missing", ", ".join(miss)))
    weak = [k for k, v in conf.items() if v < 0.5 and k in ("amount", "invoice_number", "invoice_date", "due_date")]
    if weak and (state.get("extraction") or {}).get("method") != "user-confirmed":
        signals.append(_sig("LOW_EXTRACTION_CONFIDENCE", "info", 6, "Low-confidence extraction", "Check: " + ", ".join(weak)))

    rule_points = min(RULE_CAP, sum(s["points"] for s in signals))
    return {"fraud": {"signals": signals, "rule_points": rule_points, "duplicate": duplicate,
                      "checked_history": len(others),
                      "disclaimer": "These are automated indicators of unusual or inconsistent invoices. They are not a finding of fraud."}}
