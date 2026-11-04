import os
import tempfile
from pathlib import Path

# Hardhat's well-known PUBLIC dev keys - local testing only, never use on a public network.
KEYS = {
    "admin": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "supplier": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "buyer": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "financier": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "buyer2": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
}
from eth_account import Account  # noqa: E402

ADDR = {k: Account.from_key(v).address for k, v in KEYS.items()}

os.environ.update({
    "MONGO_URI": "mock", "MONGO_DB": "invochain_test", "LLM_ENABLED": "false", "IPFS_MODE": "mock",
    "STORAGE_DIR": tempfile.mkdtemp(prefix="invochain-test-"), "OPERATOR_PRIVATE_KEY": KEYS["admin"],
    "ADMIN_WALLETS": ADDR["admin"], "RPC_URL": os.environ.get("RPC_URL", "http://127.0.0.1:8545"), "CHAIN_ID": "31337",
    "JWT_SECRET": "test-secret-test-secret-test-secret-123",
})
SAMPLES = Path(__file__).resolve().parents[2] / "samples"
