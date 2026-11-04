"""Decentralised storage of ENCRYPTED invoice files.

Modes (IPFS_MODE):
  mock    - nothing leaves the machine; a deterministic fake CID is used (for tests / zero-setup demos).
  pinata  - pins to Pinata's free plan using PINATA_JWT.
  local   - pins to a local IPFS (Kubo) node at IPFS_API_URL.
An encrypted copy is always cached under STORAGE_DIR so documents stay available if a gateway is slow.
"""
import hashlib
from pathlib import Path
from typing import Optional

import httpx

from app.core.config import get_settings


class IpfsError(RuntimeError):
    pass


def _cache_path(cid: str) -> Path:
    d = Path(get_settings().storage_dir) / "blobs"
    d.mkdir(parents=True, exist_ok=True)
    return d / (hashlib.sha256(cid.encode()).hexdigest() + ".enc")


async def pin(blob: bytes, filename: str) -> str:
    s = get_settings()
    mode = s.ipfs_mode.lower()
    if mode == "mock":
        cid = "bafymock" + hashlib.sha256(blob).hexdigest()[:44]
    elif mode == "pinata":
        if not s.pinata_jwt:
            raise IpfsError("IPFS_MODE=pinata but PINATA_JWT is empty.")
        headers = {"Authorization": f"Bearer {s.pinata_jwt}"}
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post("https://uploads.pinata.cloud/v3/files", headers=headers,
                             data={"network": "public", "name": filename},
                             files={"file": (filename + ".enc", blob, "application/octet-stream")})
            if r.status_code in (404, 410):  # legacy endpoint fallback
                r = await c.post("https://api.pinata.cloud/pinning/pinFileToIPFS", headers=headers,
                                 files={"file": (filename + ".enc", blob, "application/octet-stream")})
                if r.status_code == 200:
                    cid = r.json()["IpfsHash"]
                else:
                    raise IpfsError(f"Pinata upload failed ({r.status_code}).")
            elif r.status_code in (200, 201):
                cid = r.json()["data"]["cid"]
            else:
                raise IpfsError(f"Pinata upload failed ({r.status_code}): {r.text[:200]}")
    elif mode == "local":
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{s.ipfs_api_url}/api/v0/add?pin=true", files={"file": (filename + ".enc", blob)})
            if r.status_code != 200:
                raise IpfsError(f"Local IPFS node error ({r.status_code}).")
            cid = r.json()["Hash"]
    else:
        raise IpfsError(f"Unknown IPFS_MODE '{s.ipfs_mode}'.")
    _cache_path(cid).write_bytes(blob)
    return cid


async def fetch(cid: str) -> bytes:
    p = _cache_path(cid)
    if p.exists():
        return p.read_bytes()
    s = get_settings()
    if s.ipfs_mode.lower() == "mock":
        raise IpfsError("Document not found in local storage.")
    last: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
        for gw in s.gateways:
            try:
                r = await c.get(gw.rstrip("/") + "/" + cid)
                if r.status_code == 200:
                    p.write_bytes(r.content)
                    return r.content
            except Exception as e:  # noqa: BLE001
                last = e
    raise IpfsError(f"Could not retrieve {cid} from any gateway ({last}).")
