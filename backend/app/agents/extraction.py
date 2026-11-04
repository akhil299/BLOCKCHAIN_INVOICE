"""A. Invoice Extraction Agent - OCR -> structured JSON, flags missing fields, optional LLM gap-filling."""
from datetime import date
from typing import Any, Dict

from app.agents.llm import llm, redact
from app.agents.state import AnalysisState
from app.core.config import get_settings
from app.ocr.extract import OcrUnavailable, extract_text
from app.ocr.parse import REQUIRED, missing_fields, parse_invoice_text, validate_fields

LLM_SYSTEM = ("You extract fields from invoice text. Use ONLY information present in the text. "
              "If a field is not present return null. Never guess.")


async def _llm_fill(text: str, fields: Dict[str, Any], missing: list) -> Dict[str, Any]:
    body = redact(text) if get_settings().redact_before_llm else text
    res = await llm().generate_json(
        f"Invoice text:\n---\n{body[:6000]}\n---\nReturn JSON with keys {missing}. "
        "Dates as YYYY-MM-DD, amount as a number (grand total), names as strings.", LLM_SYSTEM)
    out: Dict[str, Any] = {}
    if isinstance(res, dict):
        for k in missing:
            v = res.get(k)
            if v in (None, "", "null"):
                continue
            if k == "amount":
                try:
                    v = float(str(v).replace(",", ""))
                except ValueError:
                    continue
            if k in ("invoice_date", "due_date"):
                try:
                    date.fromisoformat(str(v))
                except ValueError:
                    continue
            out[k] = v
    return out


async def run_extraction(state: AnalysisState) -> AnalysisState:
    warnings = []
    # --- user supplied / corrected fields: validate only
    if state.get("fields_confirmed") or not state.get("file_bytes"):
        fields = {k: (state.get("fields") or {}).get(k) for k in
                  ["invoice_number", "supplier_name", "buyer_name", "amount", "currency", "invoice_date", "due_date", "description"]}
        conf = {k: 1.0 for k, v in fields.items() if v not in (None, "")}
        method, ocr_conf, chars = "user-confirmed", 1.0, 0
    else:
        try:
            ocr = extract_text(state["file_bytes"], state["mime"])
        except OcrUnavailable as e:
            return {"extraction": {"fields": {}, "confidence": {}, "missing_fields": list(REQUIRED), "warnings": [str(e)],
                                   "method": "none", "ocr_confidence": 0.0, "text_chars": 0, "valid": False}, "fatal": str(e)}
        except Exception as e:  # noqa: BLE001 - corrupt files etc.
            return {"extraction": {"fields": {}, "confidence": {}, "missing_fields": list(REQUIRED),
                                   "warnings": [f"The file could not be read: {type(e).__name__}"], "method": "none",
                                   "ocr_confidence": 0.0, "text_chars": 0, "valid": False}, "fatal": "unreadable file"}
        method, ocr_conf, chars = ocr.method, ocr.confidence, len(ocr.text)
        fields, conf, warnings = parse_invoice_text(ocr.text)
        if ocr.method == "ocr" and ocr.confidence < 0.6:
            warnings.append(f"Scan quality is low (OCR confidence {ocr.confidence:.0%}). Check every field carefully.")
        miss = missing_fields(fields)
        if miss and llm().available and ocr.text.strip():
            filled = await _llm_fill(ocr.text, fields, miss)
            for k, v in filled.items():
                fields[k], conf[k] = v, 0.6
            if filled:
                warnings.append("Some fields were filled in by the AI assistant: " + ", ".join(filled) + ". Please verify them.")

    miss = missing_fields(fields)
    problems = validate_fields(fields)
    extraction = {"fields": fields, "confidence": conf, "missing_fields": miss, "warnings": warnings + problems,
                  "method": method, "ocr_confidence": round(ocr_conf, 3), "text_chars": chars,
                  "valid": not miss and not [p for p in problems if "past" not in p]}
    return {"extraction": extraction}
