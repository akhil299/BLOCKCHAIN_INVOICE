from pathlib import Path

import pytest
from fastapi import HTTPException

from app.agents.llm import redact
from app.agents.risk import tier_for
from app.core import crypto
from app.ml.features import build_features
from app.ml.model import get_model
from app.ocr.extract import extract_text
from app.ocr.parse import missing_fields, parse_invoice_text, validate_fields
from tests.conftest import SAMPLES


def parse(name):
    p = SAMPLES / name
    r = extract_text(p.read_bytes(), "application/pdf" if p.suffix == ".pdf" else "image/png")
    return parse_invoice_text(r.text)


def test_parser_reads_clean_pdf():
    f, conf, _ = parse("01_clean_invoice.pdf")
    assert f["invoice_number"] == "INV-2026-0142"
    assert f["supplier_name"] == "Acme Components Pvt Ltd" and f["buyer_name"] == "Globex Retail Ltd"
    assert f["amount"] == 8224.60 and f["currency"] == "USD"
    assert not missing_fields(f)


def test_ocr_reads_scanned_png():
    f, _, _ = parse("07_scanned_invoice.png")
    assert f["invoice_number"] == "HX-5521" and f["amount"] == 10903.20
    assert f["buyer_name"] == "Orbit Foods Pvt Ltd"


def test_validation_catches_bad_dates():
    probs = validate_fields({"invoice_date": "2026-10-10", "due_date": "2026-10-01", "amount": 5})
    assert any("after the invoice date" in p for p in probs)


def test_crypto_roundtrip_and_tamper():
    key = crypto.new_data_key()
    blob = crypto.encrypt(b"secret invoice", key, aad=b"x")
    assert crypto.decrypt(blob, key, aad=b"x") == b"secret invoice"
    with pytest.raises(Exception):
        crypto.decrypt(blob, key, aad=b"y")
    assert crypto.unwrap_key(crypto.wrap_key(key)) == key
    assert crypto.sha256_hex(b"a").startswith("0x") and len(crypto.sha256_hex(b"a")) == 66


def test_model_separates_normal_from_anomalous():
    m = get_model()
    normal = build_features({"amount": 9137.40, "invoice_date": "2026-10-20", "due_date": "2026-12-20", "invoice_number": "A-1", "buyer_wallet": "0x1"}, [])
    odd = dict(normal, amount_log=13.8, amount_z_supplier=7, is_round_amount=1, term_days=-20, number_similarity=0.97, supplier_velocity_7d=12)
    assert m.score(normal)["anomaly_percentile"] < 85
    assert m.score(odd)["anomaly_percentile"] > 95
    assert m.score(odd)["top_deviations"]


def test_risk_tiers():
    assert tier_for(0) == "LOW" and tier_for(34) == "LOW" and tier_for(35) == "MEDIUM" and tier_for(69) == "MEDIUM" and tier_for(70) == "HIGH"


def test_redaction_removes_pii():
    out = redact("Contact a.b@corp.com or +91 98765 43210, IBAN DE89370400440532013000 acct 123456789012 see https://x.io/a")
    for leak in ("a.b@corp.com", "98765", "DE893704", "123456789012", "https://x.io"):
        assert leak not in out


async def test_upload_validation_rejects_bad_files():
    import io
    from fastapi import UploadFile
    from app.services.files import read_upload
    bad = UploadFile(io.BytesIO(b"MZ\x90 not an invoice"), filename="evil.pdf")
    with pytest.raises(HTTPException) as e:
        await read_upload(bad)
    assert e.value.status_code == 415
    empty = UploadFile(io.BytesIO(b""), filename="a.pdf")
    with pytest.raises(HTTPException):
        await read_upload(empty)
