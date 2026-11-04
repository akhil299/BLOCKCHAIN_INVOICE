"""Web3 access to the InvoChain contracts (read calls + the OPERATOR wallet's limited transactions).

The operator can only: record AI risk tiers, confirm extra verification, flag invoices, and sync
supplier/financier roles. It can NOT verify, finance or repay invoices - those need the user's own wallet.
"""
import asyncio
import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from eth_account import Account
from web3 import Web3
from web3.logs import DISCARD

from app.core.config import get_settings

STATUS = ["NONE", "CREATED", "PENDING_VERIFICATION", "VERIFIED", "FINANCING_REQUESTED", "FINANCED",
          "REPAID", "CLOSED", "REJECTED", "FLAGGED", "CANCELLED"]
RISK = ["UNASSESSED", "LOW", "MEDIUM", "HIGH"]
RISK_INDEX = {n: i for i, n in enumerate(RISK)}
TERMINAL = {"CLOSED", "REJECTED", "CANCELLED"}
TOKEN_DECIMALS = 6

_FIELDS = ["id", "supplier", "buyer", "amount", "invoiceDate", "dueDate", "docHash", "refKey", "cid",
           "status", "statusBeforeFlag", "risk", "extraVerified", "riskReportHash", "advanceBps",
           "financier", "financedAmount", "repayAmount", "repaidAmount", "financedAt", "repaidAt"]


class ChainError(RuntimeError):
    pass


def to_units(amount: float) -> int:
    return int(round(float(amount) * 10 ** TOKEN_DECIMALS))


def from_units(units: int) -> float:
    return int(units) / 10 ** TOKEN_DECIMALS


def _hex(b: bytes) -> str:
    return "0x" + bytes(b).hex()


class ChainService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ready = False
        self.w3: Optional[Web3] = None
        self.deployment: Dict[str, Any] = {}
        self.registry = None
        self.token = None
        self.usd = None
        self.operator = None
        self._init_error: Optional[str] = None

    # ------------------------------------------------------------------ setup
    def _load(self) -> None:
        if self._ready:
            return
        s = get_settings()
        dep_path = Path(s.deployment_file)
        if not dep_path.exists():
            self._init_error = f"No deployment file at {dep_path}. Deploy the contracts first (see README)."
            raise ChainError(self._init_error)
        self.deployment = json.loads(dep_path.read_text())
        abi_dir = Path(s.abi_dir)
        self.w3 = Web3(Web3.HTTPProvider(s.rpc_url, request_kwargs={"timeout": 30}))
        if not self.w3.is_connected():
            self._init_error = f"Cannot reach the blockchain RPC at {s.rpc_url}."
            raise ChainError(self._init_error)
        c = self.deployment["contracts"]

        def mk(name: str, addr: str):
            return self.w3.eth.contract(address=Web3.to_checksum_address(addr), abi=json.loads((abi_dir / f"{name}.json").read_text()))

        self.registry = mk("InvoiceRegistry", c["InvoiceRegistry"])
        self.token = mk("InvoiceToken", c["InvoiceToken"])
        self.usd = mk("TestUSD", c["TestUSD"])
        if s.operator_private_key:
            self.operator = Account.from_key(s.operator_private_key)
        self._ready = True
        self._init_error = None

    def status(self) -> Dict[str, Any]:
        """Never raises - used by /health and /chain/config."""
        try:
            self._load()
            return {"connected": True, "chainId": int(self.w3.eth.chain_id), "block": int(self.w3.eth.block_number),
                    "operator": self.operator.address if self.operator else None, "contracts": self.deployment["contracts"],
                    "deployBlock": self.deployment.get("deployBlock", 0)}
        except Exception as e:  # noqa: BLE001
            return {"connected": False, "error": self._init_error or str(e)}

    # ------------------------------------------------------------------ reads (blocking)
    def invoice_count(self) -> int:
        self._load()
        return int(self.registry.functions.invoiceCount().call())

    def get_invoice(self, chain_id: int) -> Dict[str, Any]:
        self._load()
        raw = self.registry.functions.getInvoiceDetails(int(chain_id)).call()
        d = dict(zip(_FIELDS, raw))
        return {
            "chain_id": int(d["id"]), "supplier": d["supplier"].lower(), "buyer": d["buyer"].lower(),
            "amount_units": int(d["amount"]), "invoice_date": int(d["invoiceDate"]), "due_date": int(d["dueDate"]),
            "doc_hash": _hex(d["docHash"]), "ref_key": _hex(d["refKey"]), "cid": d["cid"],
            "status": STATUS[int(d["status"])], "status_before_flag": STATUS[int(d["statusBeforeFlag"])],
            "risk": RISK[int(d["risk"])], "extra_verified": bool(d["extraVerified"]),
            "risk_report_hash": _hex(d["riskReportHash"]), "advance_bps": int(d["advanceBps"]),
            "financier": d["financier"].lower() if int(d["financier"], 16) else None,
            "financed_amount_units": int(d["financedAmount"]), "repay_amount_units": int(d["repayAmount"]),
            "repaid_amount_units": int(d["repaidAmount"]), "financed_at": int(d["financedAt"]), "repaid_at": int(d["repaidAt"]),
        }

    def check_duplicate(self, doc_hash: str, supplier: str, buyer: str, number_hash: str):
        self._load()
        dup, existing = self.registry.functions.checkDuplicate(
            doc_hash, Web3.to_checksum_address(supplier), Web3.to_checksum_address(buyer), number_hash).call()
        return bool(dup), int(existing)

    def has_role(self, role_name: str, wallet: str) -> bool:
        self._load()
        role = Web3.keccak(text=role_name)
        return bool(self.registry.functions.hasRole(role, Web3.to_checksum_address(wallet)).call())

    def balances(self, wallet: str) -> Dict[str, Any]:
        self._load()
        w = Web3.to_checksum_address(wallet)
        return {"eth": float(Web3.from_wei(self.w3.eth.get_balance(w), "ether")),
                "tusd": from_units(self.usd.functions.balanceOf(w).call())}

    def get_receipt(self, tx_hash: str) -> Optional[Dict[str, Any]]:
        """Returns tx info + decoded InvoChain events, or None if not mined yet."""
        self._load()
        try:
            receipt = self.w3.eth.get_transaction_receipt(tx_hash)
        except Exception:  # noqa: BLE001  (TransactionNotFound)
            return None
        tx = self.w3.eth.get_transaction(tx_hash)
        block = self.w3.eth.get_block(receipt["blockNumber"])
        events: List[Dict[str, Any]] = []
        for abi_item in self.registry.abi:
            if abi_item.get("type") != "event":
                continue
            ev = getattr(self.registry.events, abi_item["name"])()
            for log in ev.process_receipt(receipt, errors=DISCARD):
                args = {k: (_hex(v) if isinstance(v, (bytes, bytearray)) else (str(v).lower() if isinstance(v, str) and v.startswith("0x") else v))
                        for k, v in dict(log["args"]).items()}
                events.append({"name": log["event"], "args": args, "log_index": int(log["logIndex"])})
        events.sort(key=lambda e: e["log_index"])
        return {
            "hash": tx_hash.lower(), "from": tx["from"].lower(), "to": (tx["to"] or "").lower(),
            "block": int(receipt["blockNumber"]), "timestamp": int(block["timestamp"]),
            "success": receipt["status"] == 1, "gas_used": int(receipt["gasUsed"]), "events": events,
            "to_registry": (tx["to"] or "").lower() == self.registry.address.lower(),
        }

    # ------------------------------------------------------------------ operator writes (blocking)
    def _send(self, fn) -> Dict[str, Any]:
        self._load()
        if not self.operator:
            raise ChainError("OPERATOR_PRIVATE_KEY is not configured on the backend.")
        with self._lock:
            tx = fn.build_transaction({
                "from": self.operator.address,
                "nonce": self.w3.eth.get_transaction_count(self.operator.address, "pending"),
                "chainId": int(self.w3.eth.chain_id),
            })
            signed = self.operator.sign_transaction(tx)
            h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(h, timeout=180)
        if receipt["status"] != 1:
            raise ChainError(f"Operator transaction {h.hex()} reverted")
        return {"hash": "0x" + h.hex().removeprefix("0x"), "block": int(receipt["blockNumber"])}

    def op_set_risk(self, chain_id: int, tier: str, report_hash: str) -> Dict[str, Any]:
        return self._send(self.registry.functions.setRiskAssessment(int(chain_id), RISK_INDEX[tier], report_hash))

    def op_confirm_extra(self, chain_id: int) -> Dict[str, Any]:
        return self._send(self.registry.functions.confirmExtraVerification(int(chain_id)))

    def op_flag(self, chain_id: int, reason_hash: str) -> Dict[str, Any]:
        return self._send(self.registry.functions.flagInvoice(int(chain_id), reason_hash))

    def op_grant_role(self, role_name: str, wallet: str) -> Optional[Dict[str, Any]]:
        if self.has_role(role_name, wallet):
            return None
        return self._send(self.registry.functions.grantRole(Web3.keccak(text=role_name), Web3.to_checksum_address(wallet)))


_svc = ChainService()


def chain() -> ChainService:
    return _svc


async def run(fn, *a, **kw):
    """Run a blocking web3 call without blocking the event loop."""
    return await asyncio.to_thread(fn, *a, **kw)
