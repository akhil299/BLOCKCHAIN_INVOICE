"""End-to-end lifecycle against a REAL local chain (npx hardhat node + deploy). Transactions are signed with
Hardhat's public dev keys exactly where MetaMask would sign them in the browser."""
import asyncio

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from httpx import ASGITransport
from web3 import Web3

from tests.conftest import ADDR, KEYS, SAMPLES

from app.core import db as dbmod
from app.core.config import get_settings
from app.core.security import login_message
from app.main import app
from app.services.chain import chain

pytestmark = pytest.mark.asyncio


def chain_ready() -> bool:
    return chain().status().get("connected", False)


pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not chain_ready(), reason="needs `npx hardhat node` + deploy (see README)")]


def send(fn, who: str) -> str:
    """Sign & send a contract call from a named dev account (what MetaMask does in the browser)."""
    c = chain()
    acct = Account.from_key(KEYS[who])
    tx = fn.build_transaction({"from": acct.address, "nonce": c.w3.eth.get_transaction_count(acct.address, "pending"), "chainId": c.w3.eth.chain_id})
    h = c.w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
    r = c.w3.eth.wait_for_transaction_receipt(h)
    assert r["status"] == 1, "transaction reverted"
    return "0x" + h.hex().removeprefix("0x")


class Client:
    def __init__(self, http):
        self.http, self.tokens = http, {}

    async def login(self, who: str):
        addr = ADDR[who].lower()
        n = (await self.http.post("/api/auth/nonce", json={"address": addr})).json()
        sig = Account.sign_message(encode_defunct(text=n["message"]), KEYS[who]).signature.hex()
        r = await self.http.post("/api/auth/login", json={"address": addr, "signature": sig})
        assert r.status_code == 200, r.text
        self.tokens[who] = r.json()["token"]
        return r.json()

    async def call(self, who, method, path, expect=200, **kw):
        h = {"Authorization": f"Bearer {self.tokens[who]}"} if who in self.tokens else {}
        r = await self.http.request(method, "/api" + path, headers=h, **kw)
        assert r.status_code == expect, f"{method} {path} -> {r.status_code}: {r.text[:400]}"
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else r

    async def confirm(self, who, tx_hash):
        res = await self.call(who, "POST", "/chain/confirm", json={"tx_hash": tx_hash})
        assert res["pending"] is False and res["success"] is True
        return res


@pytest.fixture(autouse=True)
def chain_snapshot():
    """Each test starts from the freshly deployed chain state (evm_snapshot / evm_revert)."""
    if not chain_ready():
        yield
        return
    w3 = chain().w3
    snap = w3.provider.make_request("evm_snapshot", [])["result"]
    yield
    w3.provider.make_request("evm_revert", [snap])


@pytest.fixture
async def c():
    await dbmod.connect()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=60) as http:
        yield Client(http)
    await dbmod.disconnect()


async def wait_role(c, who, tries=30):
    for _ in range(tries):
        me = await c.call(who, "GET", "/auth/me")
        if me["user"]["chain_role_synced"]:
            return
        await asyncio.sleep(0.5)
    raise AssertionError(f"{who} chain role never synced")


async def onboard(c):
    adm = await c.login("admin")
    assert adm["user"]["role"] == "admin"  # ADMIN_WALLETS auto-admin
    for who, role, name in [("supplier", "supplier", "Acme Components"), ("buyer", "buyer", "Globex Retail"),
                            ("financier", "financier", "Atlas Capital"), ("buyer2", "buyer", "Nova Trading Co")]:
        assert (await c.login(who))["user"] is None
        await c.call(who, "POST", "/auth/register", json={"role": role, "name": name + " Owner", "company": name + (" Ltd" if who == "buyer" else "")})
    await wait_role(c, "supplier")
    # financier must be approved by an admin before it can fund
    me = await c.call("financier", "GET", "/auth/me")
    assert me["user"]["status"] == "pending"
    await c.call("financier", "GET", "/marketplace", expect=403)
    await c.call("admin", "POST", f"/admin/users/{ADDR['financier'].lower()}/approve")
    await wait_role(c, "financier")


async def upload_and_confirm(c, sample, buyer="buyer"):
    f = SAMPLES / sample
    up = await c.call("supplier", "POST", "/invoices/extract", files={"file": (sample, f.read_bytes(), "application/pdf")})
    inv = up["invoice"]
    fld = {k: inv[k] for k in ("invoice_number", "supplier_name", "buyer_name", "amount", "invoice_date", "due_date", "description", "currency")}
    fld["buyer_wallet"] = ADDR[buyer].lower()
    if fld["description"] is None:
        fld.pop("description")
    conf = await c.call("supplier", "PUT", f"/invoices/{inv['id']}", json=fld)
    return up, conf["invoice"]


async def test_full_lifecycle(c):
    await onboard(c)
    reg, usd, tok = chain().registry, chain().usd, chain().token

    # --- role enforcement
    await c.call("buyer", "POST", "/invoices/extract", expect=403, files={"file": ("a.pdf", b"%PDF-1.4", "application/pdf")})
    await c.call("supplier", "GET", "/admin/users", expect=403)
    await c.call("supplier", "GET", "/marketplace", expect=403)
    await c.call("supplier", "POST", "/invoices/extract", expect=415, files={"file": ("a.pdf", b"not a pdf at all", "application/pdf")})

    # --- 1. upload -> OCR -> agents -> review/correct -> low-risk analysis
    up, inv = await upload_and_confirm(c, "01_clean_invoice.pdf")
    assert up["invoice"]["status"] == "DRAFT" and up["invoice"]["invoice_number"] == "INV-2026-0142"
    assert up["buyer_suggestion"]["wallet"] == ADDR["buyer"].lower()  # "Globex Retail Ltd" matched automatically
    risk = inv["analysis"]["risk"]
    assert risk["tier"] == "LOW" and risk["score"] < 35, [(f["id"], f["points"], f["detail"]) for f in risk["factors"]]
    assert [t["agent"] for t in inv["analysis"]["trace"]][:3] == ["Invoice Extraction Agent", "Fraud Detection Agent", "Risk Assessment Agent"]
    assert "not a determination of fraud" in risk["disclaimer"]

    # --- 2. register on-chain (supplier signs), backend mirrors + anchors the AI risk tier
    prep = await c.call("supplier", "POST", f"/invoices/{inv['id']}/prepare-register")
    a = prep["args"]
    tx = send(reg.functions.registerInvoice(Web3.to_checksum_address(a["buyer"]), int(a["amount"]), a["invoiceDate"], a["dueDate"], a["docHash"], a["numberHash"], a["cid"]), "supplier")
    res = await c.confirm("supplier", tx)
    assert "InvoiceRegistered" in res["events"]
    got = (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]
    assert got["status"] == "CREATED" and got["chain_id"] == 1 and got["risk_anchor_tx"]
    assert got["onchain"]["risk"] == "LOW" and got["onchain_matches_db"]

    # --- 3. duplicate protection: same file again is held, and registering it is refused
    up2, inv2 = await upload_and_confirm(c, "02_exact_duplicate_of_01.pdf")
    assert up2["duplicate_document_of"] == inv["id"]
    assert inv2["analysis"]["risk"]["tier"] == "HIGH"
    assert any(s["id"] == "DUPLICATE_DOCUMENT" for s in inv2["analysis"]["fraud"]["signals"])
    await c.call("supplier", "POST", f"/invoices/{inv2['id']}/prepare-register", expect=409)
    # even bypassing the API, the CONTRACT refuses the duplicate
    with pytest.raises(Exception):
        reg.functions.registerInvoice(Web3.to_checksum_address(a["buyer"]), int(a["amount"]), a["invoiceDate"], a["dueDate"], a["docHash"], a["numberHash"], a["cid"]).call({"from": ADDR["supplier"]})
    # same invoice number, different file
    _, inv3 = await upload_and_confirm(c, "03_same_number_different_amount.pdf")
    assert inv3["analysis"]["risk"]["tier"] == "HIGH"
    await c.call("supplier", "POST", f"/invoices/{inv3['id']}/prepare-register", expect=409)

    # --- 4. submit -> buyer verifies (only the buyer can) -> ERC-721 minted
    await c.confirm("supplier", send(reg.functions.submitForVerification(1), "supplier"))
    with pytest.raises(Exception):
        send(reg.functions.verifyInvoice(1), "supplier")
    buyer_view = await c.call("buyer", "GET", "/invoices")
    assert [i["id"] for i in buyer_view["invoices"]] == [inv["id"]]
    await c.call("financier", "GET", f"/invoices/{inv['id']}", expect=403)  # not in marketplace yet
    await c.confirm("buyer", send(reg.functions.verifyInvoice(1), "buyer"))
    got = (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]
    assert got["status"] == "VERIFIED" and got["token_id"] == 1
    assert tok.functions.ownerOf(1).call().lower() == ADDR["supplier"].lower()

    # --- 5. financing request -> marketplace -> financier funds with tUSD
    await c.confirm("supplier", send(reg.functions.requestFinancing(1, 9000), "supplier"))
    mk = (await c.call("financier", "GET", "/marketplace"))["listings"]
    assert len(mk) == 1 and mk[0]["advance_bps"] == 9000 and mk[0]["risk"]["tier"] == "LOW" and mk[0]["buyer_verified"]
    assert mk[0]["profit"] == pytest.approx(8224.60 - 7402.14, abs=0.01)
    assert (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]["token_locked"] is True
    with pytest.raises(Exception):  # token transfer blocked while financing is active
        send(tok.functions.transferFrom(Web3.to_checksum_address(ADDR["supplier"]), Web3.to_checksum_address(ADDR["buyer2"]), 1), "supplier")
    send(usd.functions.faucet(), "financier")
    advance = reg.functions.advanceFor(int(8224.60 * 1e6), 9000).call()
    send(usd.functions.approve(reg.address, advance), "financier")
    await c.confirm("financier", send(reg.functions.approveFinancing(1), "financier"))
    got = (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]
    assert got["status"] == "FINANCED" and got["financier_wallet"] == ADDR["financier"].lower() and got["financed_amount"] == pytest.approx(7402.14, abs=0.01)
    # double financing impossible
    with pytest.raises(Exception):
        send(reg.functions.approveFinancing(1), "financier")
    assert (await c.call("financier", "GET", "/marketplace"))["listings"] == []
    assert len((await c.call("financier", "GET", "/marketplace/portfolio"))["funded"]) == 1

    # --- 6. dashboards
    sd = await c.call("supplier", "GET", "/dashboard")
    assert sd["total"] == 3 and sd["financed"] == 1 and sd["draft"] == 2 and sd["financing_received"] == pytest.approx(7402.14, abs=0.01)
    fd = await c.call("financier", "GET", "/dashboard")
    assert fd["active"] == 1 and fd["funds_deployed"] == pytest.approx(7402.14, abs=0.01)

    # --- 7. repayment (simulated) and settlement
    send(usd.functions.faucet(), "buyer")
    full = int(8224.60 * 1e6)
    send(usd.functions.approve(reg.address, full), "buyer")
    await c.confirm("buyer", send(reg.functions.recordRepayment(1, full), "buyer"))
    assert (await c.call("buyer", "GET", f"/invoices/{inv['id']}"))["invoice"]["status"] == "REPAID"
    await c.confirm("financier", send(reg.functions.markAsPaid(1), "financier"))
    got = (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]
    assert got["status"] == "CLOSED" and got["token_id"] is None
    fd = await c.call("financier", "GET", "/dashboard")
    assert fd["repaid"] == 1 and fd["returns_earned"] == pytest.approx(822.46, abs=0.01)

    # --- 8. transaction explorer
    txs = (await c.call("supplier", "GET", "/chain/txs"))["txs"]
    kinds = {t["kind"] for t in txs}
    assert {"InvoiceRegistered", "RiskAssessmentRecorded", "InvoiceVerified", "InvoiceSettled"} <= kinds
    assert len((await c.call("admin", "GET", "/chain/txs"))["txs"]) >= len(txs)

    # --- 9. AI assistant answers from real data
    ask = lambda q: c.call("supplier", "POST", "/assistant/chat", json={"message": q})
    r = await ask("What is the status of INV-2026-0142?")
    assert "CLOSED" in r["answer"] and r["tools_used"] == ["get_invoice"]
    r = await ask("Why was my duplicate invoice flagged?")
    assert "explain_risk" in r["tools_used"]
    r = await ask("How many invoices are pending?")
    assert "invoice(s)" in r["answer"]
    r = await ask("Explain the blockchain transaction for INV-2026-0142")
    assert "blockchain invoice #1" in r["answer"] and "0x" in r["answer"]
    r = await ask("What does my AI risk score mean?")
    assert "not a finding of fraud" in r["answer"].lower() or "not a finding of fraud" in r["answer"]
    r = await c.call("buyer", "POST", "/assistant/chat", json={"message": "status of INV-0001"})  # not theirs / doesn't exist
    assert "couldn't find an invoice matching 'INV-0001'" in r["answer"]


async def test_medium_risk_needs_extra_verification_and_high_is_held(c):
    await onboard(c)
    reg = chain().registry
    # sample 05: large first invoice with 210-day terms -> medium
    up = await c.call("supplier", "POST", "/invoices/extract", files={"file": ("05.pdf", (SAMPLES / "05_large_long_terms.pdf").read_bytes(), "application/pdf")})
    i = up["invoice"]
    fld = {k: i[k] for k in ("invoice_number", "supplier_name", "buyer_name", "amount", "invoice_date", "due_date", "currency")}
    fld["buyer_wallet"] = ADDR["buyer2"].lower()
    inv = (await c.call("supplier", "PUT", f"/invoices/{i['id']}", json=fld))["invoice"]
    risk = inv["analysis"]["risk"]
    assert risk["tier"] in ("MEDIUM", "HIGH"), risk
    sigs = {s["id"] for s in inv["analysis"]["fraud"]["signals"]}
    assert "LONG_TERMS" in sigs

    # a suspicious invoice (dates inconsistent / same party names) is rejected at the form stage with a clear message
    s4 = await c.call("supplier", "POST", "/invoices/extract", files={"file": ("04.pdf", (SAMPLES / "04_suspicious_inconsistent.pdf").read_bytes(), "application/pdf")})
    d = s4["invoice"]
    assert d["analysis"]["risk"]["tier"] == "HIGH"
    ids = {s["id"] for s in d["analysis"]["fraud"]["signals"]}
    assert {"DUE_BEFORE_INVOICE", "SAME_PARTY_NAMES"} <= ids
    bad = {k: d[k] for k in ("invoice_number", "supplier_name", "buyer_name", "amount", "invoice_date", "due_date", "currency")}
    bad["buyer_wallet"] = ADDR["buyer2"].lower()
    await c.call("supplier", "PUT", f"/invoices/{d['id']}", json=bad, expect=422)

    # proceed with the medium/high one on-chain: contract enforces tier rules, not the AI
    prep = await c.call("supplier", "POST", f"/invoices/{inv['id']}/prepare-register")
    a = prep["args"]
    cid_before = reg.functions.invoiceCount().call()
    await c.confirm("supplier", send(reg.functions.registerInvoice(Web3.to_checksum_address(a["buyer"]), int(a["amount"]), a["invoiceDate"], a["dueDate"], a["docHash"], a["numberHash"], a["cid"]), "supplier"))
    new_id = cid_before + 1
    got = (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]
    if risk["tier"] == "HIGH":
        assert got["status"] == "FLAGGED"
        with pytest.raises(Exception):
            send(reg.functions.submitForVerification(new_id), "supplier")  # blocked while flagged
        flagged = (await c.call("admin", "GET", "/admin/flagged"))["invoices"]
        assert any(f["id"] == inv["id"] for f in flagged)
        await c.call("admin", "POST", f"/admin/invoices/{inv['id']}/review", json={"decision": "clear", "note": "Documents checked manually."})
        await c.confirm("admin", send(reg.functions.clearFlag(new_id, 2), "admin"))  # admin signs clearFlag themselves
        assert (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]["status"] == "CREATED"
    assert got["onchain"]["risk"] in ("MEDIUM", "HIGH")
    await c.confirm("supplier", send(reg.functions.submitForVerification(new_id), "supplier"))
    await c.confirm("buyer2", send(reg.functions.verifyInvoice(new_id), "buyer2"))
    with pytest.raises(Exception):  # MEDIUM: financing blocked until extra verification
        send(reg.functions.requestFinancing(new_id, 8000), "supplier")
    await c.call("admin", "POST", f"/admin/invoices/{inv['id']}/extra-verification")
    await c.confirm("supplier", send(reg.functions.requestFinancing(new_id, 8000), "supplier"))
    assert (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]["status"] == "FINANCING_REQUESTED"


async def test_buyer_rejection(c):
    await onboard(c)
    reg = chain().registry
    _, inv = await upload_and_confirm(c, "06_clean_second.pdf", buyer="buyer2")
    prep = (await c.call("supplier", "POST", f"/invoices/{inv['id']}/prepare-register"))["args"]
    await c.confirm("supplier", send(reg.functions.registerInvoice(Web3.to_checksum_address(prep["buyer"]), int(prep["amount"]), prep["invoiceDate"], prep["dueDate"], prep["docHash"], prep["numberHash"], prep["cid"]), "supplier"))
    n = reg.functions.invoiceCount().call()
    await c.confirm("supplier", send(reg.functions.submitForVerification(n), "supplier"))
    await c.confirm("buyer2", send(reg.functions.rejectInvoice(n, Web3.keccak(text="Amount does not match PO")), "buyer2"))
    assert (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]["status"] == "REJECTED"
    assert (await c.call("buyer2", "GET", "/dashboard"))["rejected"] == 1
    with pytest.raises(Exception):
        send(reg.functions.requestFinancing(n, 9000), "supplier")


async def test_flagged_invoice_held_until_admin_clears(c):
    await onboard(c)
    reg = chain().registry
    _, inv = await upload_and_confirm(c, "06_clean_second.pdf", buyer="buyer2")
    a = (await c.call("supplier", "POST", f"/invoices/{inv['id']}/prepare-register"))["args"]
    await c.confirm("supplier", send(reg.functions.registerInvoice(Web3.to_checksum_address(a["buyer"]), int(a["amount"]), a["invoiceDate"], a["dueDate"], a["docHash"], a["numberHash"], a["cid"]), "supplier"))
    # operator flags it for manual review (e.g. a late alert); the supplier cannot push it forward
    tx = chain().op_flag(1, Web3.keccak(text="late alert"))
    await c.confirm("admin", tx["hash"])
    assert (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]["status"] == "FLAGGED"
    with pytest.raises(Exception):
        send(reg.functions.submitForVerification(1), "supplier")
    assert any(f["id"] == inv["id"] for f in (await c.call("admin", "GET", "/admin/flagged"))["invoices"])
    # only the ADMIN wallet can clear it - the backend operator key cannot be abused by anyone else
    with pytest.raises(Exception):
        send(reg.functions.clearFlag(1, 1), "supplier")
    await c.confirm("admin", send(reg.functions.clearFlag(1, 1), "admin"))
    got = (await c.call("supplier", "GET", f"/invoices/{inv['id']}"))["invoice"]
    assert got["status"] == "CREATED" and got["onchain"]["risk"] == "LOW"
    # reconcile (view-calls only) is idempotent and consistent
    r = await c.call("admin", "POST", "/chain/reconcile")
    assert r["on_chain_total"] == 1
