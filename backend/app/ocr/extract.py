"""Text extraction: PDF text layer first (fast, exact), Tesseract OCR as the fallback for scans/photos."""
import io
from dataclasses import dataclass
from typing import List

import fitz  # PyMuPDF
import pytesseract
from PIL import Image, ImageOps

MAX_OCR_PAGES = 3
MIN_TEXT_CHARS = 40


@dataclass
class OcrResult:
    text: str
    method: str  # pdf-text | ocr | none
    confidence: float  # 0..1
    pages: int


class OcrUnavailable(RuntimeError):
    pass


def _ocr_image(img: Image.Image):
    img = ImageOps.autocontrast(ImageOps.grayscale(img))
    try:
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, config="--psm 6")
    except pytesseract.TesseractNotFoundError as e:
        raise OcrUnavailable("Tesseract OCR is not installed on the server (see README: apt/brew/choco install tesseract).") from e
    words: List[str] = []
    confs: List[float] = []
    cur_line = None
    for txt, conf, blk, par, ln in zip(data["text"], data["conf"], data["block_num"], data["par_num"], data["line_num"]):
        key = (blk, par, ln)
        if cur_line is not None and key != cur_line:
            words.append("\n")
        cur_line = key
        if txt.strip():
            words.append(txt)
            try:
                c = float(conf)
                if c >= 0:
                    confs.append(c)
            except ValueError:
                pass
    text = " ".join(words).replace(" \n ", "\n").replace("\n ", "\n")
    return text, (sum(confs) / len(confs) / 100 if confs else 0.0)


def extract_text(data: bytes, mime: str) -> OcrResult:
    if mime == "application/pdf":
        doc = fitz.open(stream=data, filetype="pdf")
        pages = doc.page_count
        text = "\n".join(doc[i].get_text("text") for i in range(min(pages, 10)))
        if len(text.strip()) >= MIN_TEXT_CHARS:
            return OcrResult(text, "pdf-text", 1.0, pages)
        texts, confs = [], []
        for i in range(min(pages, MAX_OCR_PAGES)):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(2.5, 2.5))
            t, c = _ocr_image(Image.open(io.BytesIO(pix.tobytes("png"))))
            texts.append(t)
            confs.append(c)
        joined = "\n".join(texts)
        return OcrResult(joined, "ocr" if joined.strip() else "none", sum(confs) / len(confs) if confs else 0.0, pages)
    img = Image.open(io.BytesIO(data))
    img.load()
    t, c = _ocr_image(img)
    return OcrResult(t, "ocr" if t.strip() else "none", c, 1)
