import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, ai, assistant, auth, chain as chain_api, dashboard, invoices, marketplace, users
from app.core import db
from app.core.config import get_settings
from app.services import invoices as inv_svc
from app.services.chain import chain

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("invochain")


async def _reconcile_loop(interval: int):
    while True:
        await asyncio.sleep(interval)
        try:
            if chain().status().get("connected"):
                await inv_svc.reconcile()
        except Exception as e:  # noqa: BLE001
            log.warning("reconcile failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    s = get_settings()
    if s.jwt_secret.startswith("change-me"):
        log.warning("JWT_SECRET is the default value. Set a long random secret in .env before sharing this app.")
    task = asyncio.create_task(_reconcile_loop(s.reconcile_interval_seconds)) if s.reconcile_interval_seconds > 0 else None
    yield
    if task:
        task.cancel()
    await db.disconnect()


app = FastAPI(title=get_settings().app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

for r in (auth.router, invoices.router, chain_api.router, marketplace.router, dashboard.router, admin.router, ai.router, users.router, assistant.router):
    app.include_router(r, prefix="/api")


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server. Check the backend logs."})


@app.get("/api/health")
async def health():
    return {"ok": True, "chain": chain().status(), "ipfs_mode": get_settings().ipfs_mode}
