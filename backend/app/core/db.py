"""MongoDB access (Motor). MONGO_URI=mock switches to an in-memory mongomock database."""
from typing import Any

from app.core.config import get_settings

_client: Any = None
_db: Any = None


async def connect() -> None:
    global _client, _db
    s = get_settings()
    if s.mongo_uri == "mock":
        from mongomock_motor import AsyncMongoMockClient

        _client = AsyncMongoMockClient()
    else:
        from motor.motor_asyncio import AsyncIOMotorClient

        _client = AsyncIOMotorClient(s.mongo_uri, serverSelectionTimeoutMS=5000)
    _db = _client[s.mongo_db]
    await ensure_indexes()


async def ensure_indexes() -> None:
    db = get_db()
    await db.users.create_index("wallet", unique=True)
    await db.invoices.create_index("id", unique=True)
    await db.invoices.create_index("supplier_wallet")
    await db.invoices.create_index("buyer_wallet")
    await db.invoices.create_index("doc_hash")
    await db.invoices.create_index("chain_id")
    await db.chain_txs.create_index("hash")
    await db.nonces.create_index("wallet", unique=True)


def get_db():
    if _db is None:
        raise RuntimeError("Database not initialised")
    return _db


async def disconnect() -> None:
    global _client, _db
    if _client is not None and get_settings().mongo_uri != "mock":
        _client.close()
    _client = None
    _db = None
