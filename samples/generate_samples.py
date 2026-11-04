"""Generates realistic sample invoices relative to TODAY so due dates stay financeable.
   python samples/generate_samples.py          (requires reportlab + PyMuPDF + Pillow from backend/requirements.txt)
"""
import io
import shutil
import sys
from datetime import date, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent


def money(v: float) -> str:
    return f"{v:,.2f}"


def make_pdf(path: Path, *, number, supplier, supplier_addr, buyer, buyer_addr, inv_date, due_date, items, tax_rate=0.18, note=""):
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4
    c.setFillColor(colors.HexColor("#0A1B3D"))
    c.rect(0, h - 38 * mm, w, 38 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(20 * mm, h - 20 * mm, supplier)
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, h - 27 * mm, supplier_addr)
    c.setFont("Helvetica-Bold", 26)
    c.drawRightString(w - 20 * mm, h - 22 * mm, "TAX INVOICE")
    c.setFillColor(colors.black)
    y = h - 52 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Bill To:")
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y - 6 * mm, buyer)
    c.drawString(20 * mm, y - 12 * mm, buyer_addr)
    c.setFont("Helvetica", 10)
    c.drawString(120 * mm, y, f"Invoice No: {number}")
    c.drawString(120 * mm, y - 6 * mm, f"Invoice Date: {inv_date.strftime('%d/%m/%Y')}")
    c.drawString(120 * mm, y - 12 * mm, f"Due Date: {due_date.strftime('%d/%m/%Y')}")
    y -= 32 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Description")
    c.drawRightString(w - 20 * mm, y, "Amount (USD)")
    c.line(20 * mm, y - 2 * mm, w - 20 * mm, y - 2 * mm)
    c.setFont("Helvetica", 10)
    sub = 0.0
    for desc, qty, rate in items:
        y -= 8 * mm
        amt = qty * rate
        sub += amt
        c.drawString(20 * mm, y, f"{desc} ({qty} x {money(rate)})")
        c.drawRightString(w - 20 * mm, y, money(amt))
    tax = round(sub * tax_rate, 2)
    total = round(sub + tax, 2)
    y -= 14 * mm
    c.drawRightString(w - 55 * mm, y, "Subtotal:")
    c.drawRightString(w - 20 * mm, y, money(sub))
    c.drawRightString(w - 55 * mm, y - 6 * mm, f"GST ({int(tax_rate*100)}%):")
    c.drawRightString(w - 20 * mm, y - 6 * mm, money(tax))
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(w - 55 * mm, y - 14 * mm, "Grand Total:")
    c.drawRightString(w - 20 * mm, y - 14 * mm, f"$ {money(total)}")
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, 30 * mm, note or "Payment terms: bank transfer within due date. Thank you for your business.")
    c.save()
    return total


def main():
    today = date.today()
    ACME = ("Acme Components Pvt Ltd", "14 Industrial Estate, Bengaluru 560058")
    GLOBEX = ("Globex Retail Ltd", "88 Market Street, Mumbai 400001")

    clean_total = make_pdf(
        OUT / "01_clean_invoice.pdf", number="INV-2026-0142", supplier=ACME[0], supplier_addr=ACME[1],
        buyer=GLOBEX[0], buyer_addr=GLOBEX[1], inv_date=today - timedelta(days=6), due_date=today + timedelta(days=54),
        items=[("Precision bearings, batch A", 120, 34.50), ("Steel housings", 40, 61.25), ("Freight and handling", 1, 380.00)])

    # exact duplicate (identical bytes -> same document hash)
    shutil.copyfile(OUT / "01_clean_invoice.pdf", OUT / "02_exact_duplicate_of_01.pdf")

    # same invoice number + same parties, slightly different content (re-billing trick)
    make_pdf(
        OUT / "03_same_number_different_amount.pdf", number="INV-2026-0142", supplier=ACME[0], supplier_addr=ACME[1],
        buyer=GLOBEX[0], buyer_addr=GLOBEX[1], inv_date=today - timedelta(days=5), due_date=today + timedelta(days=55),
        items=[("Precision bearings, batch A", 130, 34.50), ("Steel housings", 40, 61.25), ("Freight and handling", 1, 380.00)])

    # suspicious: big round amount, due date BEFORE invoice date, supplier name == buyer name
    make_pdf(
        OUT / "04_suspicious_inconsistent.pdf", number="INV-0001", supplier="Nova Trading Co", supplier_addr="12 Harbour Road",
        buyer="Nova Trading Co", buyer_addr="12 Harbour Road", inv_date=today - timedelta(days=1), due_date=today - timedelta(days=20),
        items=[("Consulting services", 1, 950000.00)], tax_rate=0.0, note="URGENT - please fund immediately.")

    # medium: unusually large for a first invoice, very long payment terms
    make_pdf(
        OUT / "05_large_long_terms.pdf", number="2026/A-9917", supplier="Helix Packaging LLP", supplier_addr="Plot 7, Sector 18, Pune",
        buyer="Orbit Foods Pvt Ltd", buyer_addr="3rd Floor, Tech Park, Hyderabad", inv_date=today - timedelta(days=2), due_date=today + timedelta(days=210),
        items=[("Custom corrugated packaging", 5000, 42.00), ("Printing plates", 3, 1500.00)])

    # ordinary second invoice for a different pair
    make_pdf(
        OUT / "06_clean_second.pdf", number="HX-5521", supplier="Helix Packaging LLP", supplier_addr="Plot 7, Sector 18, Pune",
        buyer="Orbit Foods Pvt Ltd", buyer_addr="3rd Floor, Tech Park, Hyderabad", inv_date=today - timedelta(days=10), due_date=today + timedelta(days=50),
        items=[("Folding cartons", 800, 11.40), ("Delivery", 1, 120.00)])

    # scanned/photo-like PNG to exercise Tesseract (render page, downscale, add slight noise)
    import fitz
    from PIL import Image, ImageFilter
    pix = fitz.open(OUT / "06_clean_second.pdf")[0].get_pixmap(matrix=fitz.Matrix(2.2, 2.2))
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("L").filter(ImageFilter.GaussianBlur(0.6))
    img.save(OUT / "07_scanned_invoice.png")
    print("Generated samples in", OUT, "| clean invoice total:", money(clean_total))


if __name__ == "__main__":
    sys.exit(main())
