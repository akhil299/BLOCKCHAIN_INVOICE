"""Rule-based invoice field parser. Deterministic, free, and good enough for typical invoice layouts.
Every field carries a confidence so the UI can highlight what the user should double-check."""
import re
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from dateutil import parser as dparser

DATE_TOKEN = (
    r"(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}"
    r"|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}"
    r"|\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{4}"
    r"|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})"
)
NUM = r"([0-9][0-9,]*(?:\.[0-9]{1,2})?)"
CURRENCY_SYMBOLS = {"$": "USD", "US$": "USD", "USD": "USD", "€": "EUR", "EUR": "EUR", "£": "GBP", "GBP": "GBP",
                    "₹": "INR", "INR": "INR", "RS": "INR", "RS.": "INR"}


def parse_date(token: str, dayfirst: bool = True) -> Optional[date]:
    token = re.sub(r"(\d)(st|nd|rd|th)", r"\1", token.strip(), flags=re.I)
    try:
        if re.match(r"^\d{4}[-/.]", token):
            return dparser.parse(token, dayfirst=False).date()
        d = dparser.parse(token, dayfirst=dayfirst, fuzzy=False).date()
        return d if 1990 <= d.year <= 2100 else None
    except (ValueError, OverflowError):
        return None


_PARTY_CUT = re.compile(r"\s+(?:TAX\s+INVOICE\b|INVOICE\s*(?:NO|DATE|NUMBER)\b|DUE\s*DATE\b|DATE\s*:)", re.I)
_LABEL_START = re.compile(r"^(invoice\s*(no|date|number)|due\s*date|date)\b", re.I)


def _clean(v: str) -> str:
    return re.sub(r"\s{2,}", " ", v).strip(" \t:-|,")


def _trim_party(v: str) -> str:
    """OCR often merges neighbouring columns onto one line; cut at the first foreign label."""
    return _clean(_PARTY_CUT.split(v, maxsplit=1)[0])


def _find_labelled_date(text: str, labels: List[str]) -> Optional[Tuple[date, float]]:
    for label in labels:
        m = re.search(rf"{label}\s*[:\-#]?\s*{DATE_TOKEN}", text, re.I)
        if m:
            d = parse_date(m.group(1))
            if d:
                return d, 0.92
        m = re.search(rf"{label}\s*[:\-#]?\s*\n\s*{DATE_TOKEN}", text, re.I)
        if m:
            d = parse_date(m.group(1))
            if d:
                return d, 0.85
    return None


def _parse_amount(s: str) -> Optional[float]:
    try:
        v = float(s.replace(",", ""))
        return v if v > 0 else None
    except ValueError:
        return None


def _detect_currency(text: str) -> Optional[str]:
    m = re.search(r"(US\$|\$|€|£|₹|\bUSD\b|\bEUR\b|\bGBP\b|\bINR\b|\bRs\.?)", text)
    return CURRENCY_SYMBOLS.get(m.group(1).upper()) if m else None


def parse_invoice_text(text: str) -> Tuple[Dict, Dict, List[str]]:
    warnings: List[str] = []
    fields: Dict = {"invoice_number": None, "supplier_name": None, "buyer_name": None, "amount": None,
                    "currency": None, "invoice_date": None, "due_date": None, "description": None}
    conf: Dict[str, float] = {}
    t = text.replace("\r", "")
    lines = [ln.strip() for ln in t.split("\n")]

    # ---- invoice number
    num_patterns = [
        (r"invoice\s*(?:no\.?|number|num\.?|#|id)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,30})", 0.93),
        (r"\binv(?:oice)?[\s#:\-]+([A-Z]{0,5}[-/]?\d[A-Z0-9\-/_.]{2,30})", 0.8),
        (r"(?:ref(?:erence)?|bill)\s*(?:no\.?|number|#)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,30})", 0.6),
        (r"#\s*([A-Z0-9][A-Z0-9\-/_]{2,30})", 0.5),
    ]
    for pat, c in num_patterns:
        for m in re.finditer(pat, t, re.I):
            cand = m.group(1).strip(".-")
            if re.search(r"\d", cand) and cand.lower() not in {"date"}:
                fields["invoice_number"], conf["invoice_number"] = cand.upper(), c
                break
        if fields["invoice_number"]:
            break

    # ---- dates
    inv = _find_labelled_date(t, [r"invoice\s*date", r"date\s*of\s*issue", r"issue\s*date", r"issued(?:\s*on)?", r"\bdated?"])
    due = _find_labelled_date(t, [r"due\s*date", r"payment\s*due(?:\s*date)?", r"due\s*on", r"pay\s*by", r"\bdue\b"])
    if inv:
        fields["invoice_date"], conf["invoice_date"] = inv[0].isoformat(), inv[1]
    if due:
        fields["due_date"], conf["due_date"] = due[0].isoformat(), due[1]
    if not fields["due_date"] and fields["invoice_date"]:
        m = re.search(r"(?:net|terms?[:\s]*(?:net)?)\s*(\d{1,3})\b|payment\s*terms?\s*[:\-]?\s*(\d{1,3})\s*days", t, re.I)
        if m:
            days = int(m.group(1) or m.group(2))
            fields["due_date"] = (date.fromisoformat(fields["invoice_date"]) + timedelta(days=days)).isoformat()
            conf["due_date"] = 0.6
            warnings.append(f"Due date was derived from payment terms ({days} days). Please confirm it.")
    if not fields["invoice_date"]:
        alld = [parse_date(x) for x in re.findall(DATE_TOKEN, t)]
        alld = [d for d in alld if d]
        if alld:
            fields["invoice_date"], conf["invoice_date"] = min(alld).isoformat(), 0.4
            warnings.append("Invoice date was guessed from the earliest date in the document.")

    # ---- amount
    amount_labels = [
        (r"grand\s*total", 0.93), (r"total\s*amount\s*due", 0.93), (r"amount\s*due", 0.92), (r"balance\s*due", 0.92),
        (r"total\s*due", 0.92), (r"total\s*payable", 0.9), (r"(?<!sub)(?<!sub\s)total(?!\s*(?:tax|gst|vat|discount))", 0.8),
    ]
    for label, c in amount_labels:
        found = None
        for m in re.finditer(rf"{label}[^\d]{{0,25}}?(?:US\$|\$|€|£|₹|USD|EUR|GBP|INR|Rs\.?)?\s*{NUM}", t, re.I):
            a = _parse_amount(m.group(m.lastindex))
            if a:
                found = a
        if found:
            fields["amount"], conf["amount"] = found, c
            break
    if fields["amount"] is None:
        nums = [_parse_amount(x) for x in re.findall(r"(?:US\$|\$|€|£|₹|USD|EUR|GBP|INR|Rs\.?)\s*" + NUM, t, re.I)]
        nums = [n for n in nums if n]
        if nums:
            fields["amount"], conf["amount"] = max(nums), 0.4
            warnings.append("Amount was guessed as the largest currency value in the document.")
    fields["currency"] = _detect_currency(t)

    # ---- parties
    def after_label(labels: str) -> Optional[str]:
        for i, ln in enumerate(lines):
            m = re.match(rf"^(?:{labels})\s*[:\-]?\s*(.*)$", ln, re.I)
            if m:
                rest = _trim_party(m.group(1))
                if rest and not _LABEL_START.match(rest):
                    return rest
                for nxt in lines[i + 1:i + 4]:
                    if nxt and not re.match(r"^(address|tel|phone|email|gst|vat|tax)", nxt, re.I):
                        cand = _trim_party(nxt)
                        if cand and not _LABEL_START.match(cand):
                            return cand
        return None

    s = after_label(r"from|seller|supplier|vendor|billed\s*by|issued\s*by|sold\s*by")
    if s:
        fields["supplier_name"], conf["supplier_name"] = s, 0.85
    else:
        for ln in lines[:8]:
            if ln and not re.match(r"^(tax\s*)?invoice\b", ln, re.I) and not re.search(r"\d{3,}", ln) and 2 < len(ln) < 70:
                fields["supplier_name"], conf["supplier_name"] = _trim_party(ln), 0.5
                break
    b = after_label(r"bill(?:ed)?\s*to|buyer|customer|client|sold\s*to|invoice\s*to|consignee")
    if b:
        fields["buyer_name"], conf["buyer_name"] = b, 0.85

    # ---- description
    m = re.search(r"(?:description|particulars|items?|services?)\s*[:\-]?\s*\n?(.{5,400}?)(?:\n\s*(?:sub\s*total|total|amount|grand)|$)", t, re.I | re.S)
    if m:
        desc = _clean(re.sub(r"\s*\n\s*", "; ", m.group(1)))
        if len(desc) > 4:
            fields["description"], conf["description"] = desc[:300], 0.5

    for k, v in fields.items():
        if v in (None, ""):
            conf.pop(k, None)
    return fields, conf, warnings


REQUIRED = ["invoice_number", "supplier_name", "buyer_name", "amount", "invoice_date", "due_date"]


def missing_fields(fields: Dict) -> List[str]:
    return [k for k in REQUIRED if fields.get(k) in (None, "")]


def validate_fields(fields: Dict) -> List[str]:
    """Logical validation shared by extraction and manual entry. Returns human-readable problems."""
    problems: List[str] = []
    try:
        inv = date.fromisoformat(fields["invoice_date"]) if fields.get("invoice_date") else None
        due = date.fromisoformat(fields["due_date"]) if fields.get("due_date") else None
    except ValueError:
        return ["A date is not in YYYY-MM-DD format."]
    if inv and due and due <= inv:
        problems.append("Due date must be after the invoice date.")
    if due and due <= datetime.utcnow().date():
        problems.append("Due date is today or in the past, so the invoice cannot be financed.")
    amt = fields.get("amount")
    if amt is not None and (not isinstance(amt, (int, float)) or amt <= 0):
        problems.append("Amount must be a positive number.")
    return problems
