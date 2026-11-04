"""Central configuration. Everything secret comes from environment variables (see ../.env.example)."""
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]  # repo root (…/invochain)
BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT / ".env"), str(BACKEND_DIR / ".env")), extra="ignore"
    )

    # --- app
    app_name: str = "InvoChain API"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    admin_wallets: str = ""  # comma separated; these wallets become ADMIN on first login

    # --- database ("mock" = in-memory, NOT persistent; for quick demos & tests only)
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "invochain"

    # --- auth
    jwt_secret: str = "change-me-in-production-please-use-a-long-random-string"
    jwt_expire_minutes: int = 720
    nonce_ttl_seconds: int = 300

    # --- blockchain (testnet only!)
    rpc_url: str = "http://127.0.0.1:8545"
    chain_id: int = 31337  # 11155111 for Sepolia
    required_chain_id: int = 0  # 0 = use chain_id; the frontend forces this network
    operator_private_key: str = ""  # backend "operator" wallet: records AI risk tiers, syncs roles. TESTNET KEY ONLY.
    deployment_file: str = str(ROOT / "shared" / "deployment.json")
    abi_dir: str = str(ROOT / "shared" / "abi")
    explorer_tx_url: str = "https://sepolia.etherscan.io/tx/"
    reconcile_interval_seconds: int = 0  # >0 enables background on-chain reconciliation

    # --- AI
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    llm_enabled: bool = True
    redact_before_llm: bool = True
    llm_min_interval_seconds: float = 4.0  # stay inside the free-tier requests/minute
    min_days_to_due: int = 7
    min_invoice_amount: float = 100.0
    max_invoice_amount: float = 1_000_000.0

    # --- storage
    ipfs_mode: str = "mock"  # mock | pinata | local
    pinata_jwt: str = ""
    ipfs_api_url: str = "http://127.0.0.1:5001"  # local Kubo
    ipfs_gateways: str = "https://gateway.pinata.cloud/ipfs/,https://ipfs.io/ipfs/,https://dweb.link/ipfs/"
    storage_dir: str = str(BACKEND_DIR / "storage")
    encryption_master_key: str = "change-me-32+chars-secret-for-wrapping-keys"
    max_upload_mb: int = 10

    @field_validator("admin_wallets", mode="before")
    @classmethod
    def _strip(cls, v):
        return (v or "").strip()

    @property
    def admin_wallet_list(self) -> List[str]:
        return [w.strip().lower() for w in self.admin_wallets.split(",") if w.strip()]

    @property
    def cors_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def gateways(self) -> List[str]:
        return [g.strip() for g in self.ipfs_gateways.split(",") if g.strip()]

    @property
    def effective_required_chain(self) -> int:
        return self.required_chain_id or self.chain_id


@lru_cache
def get_settings() -> Settings:
    return Settings()
