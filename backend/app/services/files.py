"""Secure upload handling: size limit, magic-byte type sniffing, filename sanitising."""
import re
from dataclasses import dataclass

from fastapi import HTTPException, UploadFile

from app.core.config import get_settings

SIGNATURES = [
    (b"%PDF-", "application/pdf", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
]


@dataclass
class CleanUpload:
    data: bytes
    mime: str
    ext: str
    name: str


def safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]", "_", (name or "invoice").split("/")[-1].split("\\")[-1])
    return base[:80] or "invoice"


async def read_upload(file: UploadFile) -> CleanUpload:
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) == 0:
        raise HTTPException(422, "The uploaded file is empty.")
    if len(data) > limit:
        raise HTTPException(413, f"File is larger than {get_settings().max_upload_mb} MB.")
    for sig, mime, ext in SIGNATURES:
        if data.startswith(sig):
            return CleanUpload(data, mime, ext, safe_name(file.filename or f"invoice.{ext}"))
    raise HTTPException(415, "Unsupported file type. Upload a PDF, PNG or JPEG invoice.")
