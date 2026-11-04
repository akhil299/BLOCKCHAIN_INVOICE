import json
import logging
from datetime import date, datetime
from difflib import SequenceMatcher
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from app.agents.fraud import number_hash
from app.agents.orchestrator import analyze
from app.core.db import get_db
from app.core.security import current_user, norm_wallet, require_roles
from app.ocr.parse import validate_fields
from app.services import invoices as svc
from app.services.chain import chain, run, to_units
from app.services.files import read_upload
from app.core.config import get_settings

log = logging.getLogger("invochain.api.invoices")
router = APIRouter(prefix="/invoices", tags=["invoices"])


class InvoiceFields(BaseModel):
    invoice_number: str = Field(min_length=1, max_length=40)
    supplier_name: str = Field(min_length=2, max_length=120)
    buyer_name: str = Field(min_length=2, max_length=120)
    buyer_wallet: str
    amount: float = Field(gt=0, le=1_000_000_000)
    currency: Optional[str] = Field(default="USD", max_length=6)
    invoice_date: date
    due_date: date
    description: Optional[str] = Field(default=None, max_length=500)

    @field_validator("invoice_number", "supplier_name", "buyer_name", "description", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


def _fields_dict(m: InvoiceFields) -> Dict[str, Any]:
    d = m.model_dump()
    d["invoice_date"], d["due_date"] = m.invoice_date.isoformat(), m.due_date.isoformat()
    d.pop("buyer_wallet")
    return d


async def _suggest_buyer(name: Optional[str]) -> Optional[Dict[str, Any]]:
    if not name:
        return None
    best, best_r = None, 0.0
    for b in await get_db().users.find({"role": "buyer", "status": "active"}, {"_id": 0}).to_list(500):
        r = max(SequenceMatcher(None, name.lower(), (b.get("company") or "").lower()).ratio(),
                SequenceMatcher(None, name.lower(), (b.get("name") or "").lower()).ratio())
        if r > best_r:
            best, best_r = b, r
    return {"wallet": best["wallet"], "name": best["name"], "company": best["company"], "match": round(best_r, 2)} if best and best_r >= 0.75 else None


async def _run_analysis(doc: Dict[str, Any], *, file_bytes=None, mime=None, fields=None, confirmed=False) -> Dict[str, Any]:
    analysis = await analyze(
        {"id": doc["id"], "supplier_wallet": doc["supplier_wallet"], "buyer_wallet": doc.get("buyer_wallet"), "status": doc["status"],
         "doc_hash": doc["doc_hash"], "chain_id": doc.get("chain_id"), "extra_verified": doc.get("extra_verified")},
        file_bytes=file_bytes, mime=mime, fields=fields, fields_confirmed=confirmed)
    analysis["fields_confirmed"] = confirmed
    return analysis


def _flatten(doc: Dict[str, Any], fields: Dict[str, Any]) -> Dict[str, Any]:
    return {"invoice_number": fields.get("invoice_number"), "supplier_name": fields.get("supplier_name"), "buyer_name": fields.get("buyer_name"),
            "amount": fields.get("amount"), "currency": fields.get("currency") or "USD", "invoice_date": fields.get("invoice_date"),
            "due_date": fields.get("due_date"), "description": fields.get("description")}


@router.post("/extract")
async def extract(file: UploadFile = File(...), user: dict = Depends(require_roles("supplier"))):
    """Step 1: upload a PDF/PNG/JPEG. Stores it encrypted, runs OCR + the agents, returns a DRAFT for review."""
    up = await read_upload(file)
    stored = await svc.store_document(up.data, up.mime, up.name)
    live_dup = await get_db().invoices.find_one({"doc_hash": stored["doc_hash"], "status": {"$nin": ["REJECTED", "CANCELLED"]}}, {"_id": 0, "id": 1, "status": 1})
    doc = {"id": svc.new_id(), "supplier_wallet": user["wallet"], "buyer_wallet": None, "status": "DRAFT", "source": "upload",
           "chain_id": None, "on_chain": False, "created_at": datetime.utcnow(), "updated_at": datetime.utcnow(), **stored,
           "invoice_number": None, "supplier_name": user["company"], "buyer_name": None, "amount": None, "currency": "USD",
           "invoice_date": None, "due_date": None, "description": None, "tx_history": []}
    analysis = await _run_analysis(doc, file_bytes=up.data, mime=up.mime)
    ext = analysis.get("extraction") or {}
    doc.update(_flatten(doc, ext.get("fields") or {}))
    doc["supplier_name"] = doc["supplier_name"] or user["company"]
    suggestion = await _suggest_buyer(doc.get("buyer_name"))
    if suggestion:
        doc["buyer_wallet"] = suggestion["wallet"]
    doc["analysis"] = analysis
    await get_db().invoices.insert_one(dict(doc))
    return {"invoice": svc.view(doc, user), "buyer_suggestion": suggestion, "duplicate_document_of": live_dup["id"] if live_dup else None}


class ConfirmReq(InvoiceFields):
    pass


@router.post("/manual")
async def create_manual(req: ConfirmReq, user: dict = Depends(require_roles("supplier"))):
    """Manual entry: the data is rendered to a PDF so it has a document hash + encrypted copy like any upload."""
    fields = _fields_dict(req)
    buyer_wallet = norm_wallet(req.buyer_wallet)
    buyer = await get_db().users.find_one({"wallet": buyer_wallet, "role": "buyer"}, {"_id": 0})
    if not buyer:
        raise HTTPException(422, "That wallet is not a registered buyer on InvoChain.")
    problems = validate_fields(fields)
    if problems:
        raise HTTPException(422, " ".join(problems))
    pdf = svc.render_manual_pdf(fields, user["company"])
    stored = await svc.store_document(pdf, "application/pdf", f"manual-{req.invoice_number}.pdf")
    doc = {"id": svc.new_id(), "supplier_wallet": user["wallet"], "buyer_wallet": buyer_wallet, "status": "DRAFT", "source": "manual",
           "chain_id": None, "on_chain": False, "created_at": datetime.utcnow(), "updated_at": datetime.utcnow(), **stored,
           **_flatten({}, fields), "tx_history": []}
    doc["analysis"] = await _run_analysis(doc, fields=fields, confirmed=True)
    await get_db().invoices.insert_one(dict(doc))
    return {"invoice": svc.view(doc, user)}


@router.put("/{invoice_id}")
async def confirm_fields(invoice_id: str, req: ConfirmReq, user: dict = Depends(require_roles("supplier"))):
    """Step 2: user reviews/corrects the extracted fields; the agents re-run on the confirmed data."""
    doc = await svc.get_invoice_or_404(invoice_id)
    if doc["supplier_wallet"] != user["wallet"]:
        raise HTTPException(403, "This is not your invoice.")
    if doc["status"] != "DRAFT":
        raise HTTPException(409, "Only draft invoices can be edited. This one is already on the blockchain.")
    fields = _fields_dict(req)
    buyer_wallet = norm_wallet(req.buyer_wallet)
    if not await get_db().users.find_one({"wallet": buyer_wallet, "role": "buyer", "status": {"$ne": "suspended"}}):
        raise HTTPException(422, "That wallet is not a registered buyer on InvoChain.")
    if buyer_wallet == user["wallet"]:
        raise HTTPException(422, "The buyer cannot be your own wallet.")
    problems = validate_fields(fields)
    if problems:
        raise HTTPException(422, " ".join(problems))
    doc.update({**_flatten(doc, fields), "buyer_wallet": buyer_wallet})
    doc["analysis"] = await _run_analysis(doc, fields=fields, confirmed=True)
    doc["updated_at"] = datetime.utcnow()
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": {k: v for k, v in doc.items() if k != "id"}})
    return {"invoice": svc.view(doc, user)}


@router.post("/{invoice_id}/prepare-register")
async def prepare_register(invoice_id: str, user: dict = Depends(require_roles("supplier"))):
    """Returns the exact arguments for registryContract.registerInvoice(...) that the supplier signs in MetaMask."""
    doc = await svc.get_invoice_or_404(invoice_id)
    if doc["supplier_wallet"] != user["wallet"]:
        raise HTTPException(403, "This is not your invoice.")
    if doc["status"] != "DRAFT":
        raise HTTPException(409, f"Invoice is already {doc['status']}.")
    a = doc.get("analysis") or {}
    if not a.get("fields_confirmed"):
        raise HTTPException(409, "Review and confirm the extracted details before registering.")
    if not a.get("risk"):
        raise HTTPException(409, "AI analysis has not completed. Run the analysis again.")
    if not doc.get("buyer_wallet"):
        raise HTTPException(409, "Choose the buyer first.")
    nh = number_hash(doc["invoice_number"])
    try:
        dup, existing = await run(chain().check_duplicate, doc["doc_hash"], doc["supplier_wallet"], doc["buyer_wallet"], nh)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"Blockchain is unreachable: {e}")
    if dup:
        raise HTTPException(409, f"Duplicate: blockchain invoice #{existing} already uses this document or invoice number. Duplicates cannot be registered.")
    due = datetime.combine(date.fromisoformat(doc["due_date"]), datetime.min.time())
    inv = datetime.combine(date.fromisoformat(doc["invoice_date"]), datetime.min.time())
    return {"function": "registerInvoice", "contract": chain().deployment["contracts"]["InvoiceRegistry"], "args": {
        "buyer": doc["buyer_wallet"], "amount": str(to_units(doc["amount"])),
        "invoiceDate": int(inv.timestamp()), "dueDate": int(due.timestamp()),
        "docHash": doc["doc_hash"], "numberHash": nh, "cid": doc["cid"]},
        "risk": {"tier": a["risk"]["tier"], "score": a["risk"]["score"]}}


@router.post("/{invoice_id}/reanalyze")
async def reanalyze(invoice_id: str, user: dict = Depends(require_roles("supplier", "admin"))):
    doc = await svc.get_invoice_or_404(invoice_id)
    if user["role"] == "supplier" and doc["supplier_wallet"] != user["wallet"]:
        raise HTTPException(403, "This is not your invoice.")
    if doc["status"] != "DRAFT":
        raise HTTPException(409, "Only draft invoices can be re-analysed (on-chain results are anchored).")
    fields = {k: doc.get(k) for k in ["invoice_number", "supplier_name", "buyer_name", "amount", "currency", "invoice_date", "due_date", "description"]}
    doc["analysis"] = await _run_analysis(doc, fields=fields, confirmed=bool((doc.get("analysis") or {}).get("fields_confirmed")))
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": {"analysis": doc["analysis"], "updated_at": datetime.utcnow()}})
    return {"invoice": svc.view(doc, user)}


@router.get("")
async def list_invoices(status: Optional[str] = None, q: Optional[str] = None, limit: int = Query(100, le=500), user: dict = Depends(current_user)):
    db = get_db()
    flt: Dict[str, Any] = {}
    if user["role"] == "supplier":
        flt["supplier_wallet"] = user["wallet"]
    elif user["role"] == "buyer":
        flt.update({"buyer_wallet": user["wallet"], "status": {"$ne": "DRAFT"}})
    elif user["role"] == "financier":
        flt["$or"] = [{"status": "FINANCING_REQUESTED"}, {"financier_wallet": user["wallet"]}]
    if status:
        flt["status"] = status.upper() if "status" not in flt or isinstance(flt["status"], str) else flt["status"]
        if user["role"] == "buyer" and status.upper() == "DRAFT":
            raise HTTPException(403, "Not allowed.")
    docs = await db.invoices.find(flt, {"_id": 0}).sort("created_at", -1).to_list(limit)
    if q:
        ql = q.lower()
        docs = [d for d in docs if ql in (d.get("invoice_number") or "").lower() or ql in (d.get("buyer_name") or "").lower() or ql in (d.get("supplier_name") or "").lower()]
    return {"invoices": [svc.view(d, user) for d in docs if svc.can_view(d, user)]}


@router.get("/{invoice_id}")
async def get_invoice(invoice_id: str, user: dict = Depends(current_user)):
    doc = await svc.get_invoice_or_404(invoice_id)
    if not svc.can_view(doc, user):
        raise HTTPException(403, "You do not have access to this invoice.")
    out = svc.view(doc, user)
    if doc.get("chain_id") and chain().status().get("connected"):
        try:
            oc = await run(chain().get_invoice, doc["chain_id"])
            out["onchain"] = {k: v for k, v in oc.items()}
            out["onchain_matches_db"] = oc["status"] == doc["status"]
        except Exception:  # noqa: BLE001
            out["onchain"] = None
    return {"invoice": out}


@router.get("/{invoice_id}/document")
async def download_document(invoice_id: str, user: dict = Depends(current_user)):
    doc = await svc.get_invoice_or_404(invoice_id)
    if not svc.can_view(doc, user) or (user["role"] == "financier" and doc["status"] not in svc.FINANCIER_VISIBLE):
        raise HTTPException(403, "You do not have access to this document.")
    data = await svc.load_document(doc)
    return Response(content=data, media_type=doc["mime"], headers={"Content-Disposition": f'inline; filename="{doc["file_name"]}"',
                                                                  "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.delete("/{invoice_id}")
async def delete_draft(invoice_id: str, user: dict = Depends(require_roles("supplier"))):
    doc = await svc.get_invoice_or_404(invoice_id)
    if doc["supplier_wallet"] != user["wallet"] or doc["status"] != "DRAFT":
        raise HTTPException(403, "Only your own draft invoices can be deleted.")
    await get_db().invoices.delete_one({"id": invoice_id})
    return {"deleted": True}
