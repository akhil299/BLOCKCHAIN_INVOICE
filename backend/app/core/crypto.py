"""AES-256-GCM helpers. Invoice files are encrypted BEFORE they leave the server (IPFS is public).

Each invoice gets a random data key. The data key is wrapped with a key derived from
ENCRYPTION_MASTER_KEY and stored in MongoDB; ciphertext (nonce || ct || tag) is what gets pinned.
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings


def _master() -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"invochain-v1", info=b"key-wrap").derive(
        get_settings().encryption_master_key.encode()
    )


def new_data_key() -> bytes:
    return AESGCM.generate_key(bit_length=256)


def encrypt(data: bytes, key: bytes, aad: bytes = b"") -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, data, aad or None)


def decrypt(blob: bytes, key: bytes, aad: bytes = b"") -> bytes:
    return AESGCM(key).decrypt(blob[:12], blob[12:], aad or None)


def wrap_key(data_key: bytes) -> str:
    return base64.b64encode(encrypt(data_key, _master(), b"wrap")).decode()


def unwrap_key(wrapped: str) -> bytes:
    return decrypt(base64.b64decode(wrapped), _master(), b"wrap")


def sha256_hex(data: bytes) -> str:
    """0x-prefixed 32-byte hex, directly usable as a Solidity bytes32."""
    return "0x" + hashlib.sha256(data).hexdigest()
