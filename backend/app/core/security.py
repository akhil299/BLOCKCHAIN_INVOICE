"""Wallet-signature authentication (Sign-In-With-Ethereum style) + role guards.

No passwords, no seed phrases and no private keys ever reach the backend:
 1. client asks for a nonce,   2. signs the message with MetaMask,   3. backend recovers the address -> JWT.
"""
import secrets
import time
from typing import Optional

import jwt
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from web3 import Web3

from app.core.config import get_settings
from app.core.db import get_db

bearer = HTTPBearer(auto_error=False)
ROLES = ("supplier", "buyer", "financier", "admin")


def norm_wallet(addr: str) -> str:
    if not isinstance(addr, str) or not Web3.is_address(addr):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid wallet address")
    return addr.lower()


def login_message(wallet: str, nonce: str) -> str:
    s = get_settings()
    return (
        "InvoChain wants you to sign in with your wallet.\n\n"
        f"Address: {Web3.to_checksum_address(wallet)}\n"
        f"Chain ID: {s.effective_required_chain}\n"
        f"Nonce: {nonce}\n\n"
        "This signature costs no gas and does not authorise any transaction."
    )


async def issue_nonce(wallet: str) -> dict:
    nonce = secrets.token_hex(16)
    expires = time.time() + get_settings().nonce_ttl_seconds
    await get_db().nonces.update_one({"wallet": wallet}, {"$set": {"nonce": nonce, "expires": expires}}, upsert=True)
    return {"nonce": nonce, "message": login_message(wallet, nonce)}


async def verify_login(wallet: str, signature: str) -> None:
    rec = await get_db().nonces.find_one({"wallet": wallet})
    if not rec or rec["expires"] < time.time():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign-in request expired. Please try again.")
    try:
        recovered = Account.recover_message(encode_defunct(text=login_message(wallet, rec["nonce"])), signature=signature)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Signature could not be verified.")
    if recovered.lower() != wallet:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Signature does not match the wallet address.")
    await get_db().nonces.delete_one({"wallet": wallet})  # one-time use


def create_token(wallet: str) -> str:
    s = get_settings()
    now = int(time.time())
    return jwt.encode({"sub": wallet, "iat": now, "exp": now + s.jwt_expire_minutes * 60}, s.jwt_secret, algorithm="HS256")


async def current_wallet(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> str:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in. Connect your wallet and sign the message.")
    try:
        payload = jwt.decode(creds.credentials, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")
    return payload["sub"]


async def current_user(wallet: str = Depends(current_wallet)) -> dict:
    user = await get_db().users.find_one({"wallet": wallet}, {"_id": 0})
    if not user:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Complete registration and choose a role first.")
    if user.get("status") == "suspended":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is suspended. Contact an administrator.")
    return user


def require_roles(*roles: str):
    async def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"Your role ({user['role']}) cannot do this. Required: {', '.join(roles)}."
            )
        if user["role"] == "financier" and user.get("status") == "pending":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your financier account is awaiting administrator approval.")
        return user

    return dep
