from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import current_user, current_wallet, require_roles
from app.agents.llm import llm
from app.services import invoices as svc
from app.services.chain import chain, run

router = APIRouter(prefix="/chain", tags=["blockchain"])


class ConfirmReq(BaseModel):
    tx_hash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")


@router.get("/config")
async def config():
    s = get_settings()
    st = chain().status()
    return {"chain": st, "requiredChainId": s.effective_required_chain, "explorerTxUrl": s.explorer_tx_url,
            "ipfsMode": s.ipfs_mode, "aiMode": "gemini" if llm().available else "rules",
            "testnetNotice": "Testnet only. tUSD and ETH on Sepolia have no real-world value."}


@router.post("/confirm")
async def confirm(req: ConfirmReq, _: str = Depends(current_wallet)):
    """Call after MetaMask reports a mined tx: the backend re-reads the chain (never trusts the browser)."""
    try:
        return await svc.process_tx(req.tx_hash.lower())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"Could not read the transaction from the blockchain: {e}")


@router.get("/txs")
async def txs(user: dict = Depends(current_user)):
    flt: Dict[str, Any] = {} if user["role"] == "admin" else {"$or": [{"from": user["wallet"]}, {"parties": user["wallet"]}]}
    rows = await get_db().chain_txs.find(flt, {"_id": 0}).sort("at", -1).to_list(300)
    for r in rows:
        r["at"] = r["at"].isoformat() + "Z"
    return {"txs": rows, "explorerTxUrl": get_settings().explorer_tx_url}


@router.get("/balance")
async def balance(user: dict = Depends(current_user)):
    try:
        return await run(chain().balances, user["wallet"])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, str(e))


@router.post("/reconcile")
async def reconcile(_: dict = Depends(require_roles("admin"))):
    return await svc.reconcile()
