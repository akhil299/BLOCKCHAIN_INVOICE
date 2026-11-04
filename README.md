# InvoChain: AI-powered decentralized invoice financing

Suppliers upload invoices, AI agents screen them, buyers confirm them from their own wallets, and financiers fund them
with **test tokens** on **Ethereum Sepolia**. A smart contract guarantees an invoice can never be registered twice or
financed twice. **Everything in this project runs on free tiers. No real money is involved anywhere.**

> Academic demonstration. Sepolia ETH and tUSD have no real-world value. The AI risk score is a screening indicator,
> never a finding of fraud, and it can never approve or move funds.

---

## 1. What was tested, and what you must verify yourself

I could run the parts of the system that do not need your wallet or paid/personal accounts. Be clear-eyed about the split:

| Area | Status |
|---|---|
| Smart contracts (38 Hardhat tests: lifecycle, duplicates, roles, token lock, double-financing, **reentrancy attack**, pause) | Tested |
| Backend (8 unit tests + 4 end-to-end tests against a real local chain, signing every tx like MetaMask would) | Tested |
| OCR (Tesseract) + parser on realistic sample PDFs and a scanned PNG | Tested |
| Fraud rules, Isolation Forest model, risk score, eligibility, LangGraph orchestrator | Tested |
| AI assistant: tool layer + rule-based fallback answering from real DB/chain data | Tested |
| Frontend: production build + 29 render/behaviour tests for every page and role | Tested |
| **MetaMask popups, real browser rendering/visual polish** | **You verify** (I had no browser or wallet) |
| **Deployment to Sepolia, faucet ETH, live RPC** | **You verify** |
| **Gemini (live LLM) path** | **You verify** (needs your key; the app works without it) |
| **Pinata (live IPFS) path** | **You verify** (needs your JWT; `mock`/`local` modes work offline) |

The checklist in section 9 walks you through verifying the "You verify" rows.

---

## 2. Architecture

```
 Browser (React + Tailwind + Ethers.js)  ──MetaMask signs──►  Ethereum (Sepolia / local Hardhat)
      │  REST + JWT (wallet signature login)                      ▲  InvoiceRegistry, InvoiceToken (ERC-721), TestUSD (ERC-20)
      ▼                                                           │  read-only + operator txs (web3.py)
 FastAPI backend ─────────────────────────────────────────────────┘
   ├─ OCR (PyMuPDF text layer → Tesseract)         ├─ MongoDB: users, invoices, AI results, tx history
   ├─ LangGraph orchestrator                       ├─ IPFS (Pinata / local / mock): ENCRYPTED invoice files
   │    Extraction → Fraud → Risk → Eligibility    └─ Gemini (optional, free tier) for explanations + chat
   └─ AI assistant (read-only, role-scoped tools)
```

**Who can do what on-chain** (enforced by the contract, not the app):

| Action | Allowed caller |
|---|---|
| `registerInvoice` | wallet with `SUPPLIER_ROLE` (granted automatically at signup) |
| `submitForVerification`, `requestFinancing`, `cancel…` | the invoice's supplier |
| `verifyInvoice`, `rejectInvoice` | **only the buyer named on the invoice** |
| `approveFinancing` | wallet with `FINANCIER_ROLE` (admin-approved), not a party to the invoice |
| `recordRepayment` | the invoice's buyer (or supplier, as recourse) |
| `markAsPaid` | the financier of that invoice, or the operator |
| `setRiskAssessment`, `flagInvoice`, `confirmExtraVerification` | backend **operator** wallet (records AI output only) |
| `clearFlag`, `pause` | contract **admin** wallet |

The operator key **cannot** verify, finance or repay. Invoice lifecycle:
`CREATED → PENDING_VERIFICATION → VERIFIED → FINANCING_REQUESTED → FINANCED → REPAID → CLOSED`, plus `REJECTED`, `FLAGGED`, `CANCELLED`.

AI tiers are advisory input to *fixed contract rules*: **HIGH** → invoice is `FLAGGED` and frozen until the admin wallet clears
it; **MEDIUM** → financing is blocked until additional verification is confirmed; **LOW** → proceeds after buyer confirmation.
An invoice cannot even be submitted to a buyer until its AI risk tier has been anchored on-chain.

---

## 3. Everything is free

| Need | Free option used | Notes |
|---|---|---|
| Blockchain | **Local Hardhat chain** (no faucet at all) or **Sepolia** | Sepolia needs faucet ETH for gas |
| Sepolia ETH | Public faucets (e.g. Google Cloud Web3 faucet, Alchemy faucet, a PoW faucet) | Availability and limits change; search "Sepolia faucet" |
| RPC | Free Infura / Alchemy key, or a public Sepolia RPC | Backend uses view calls + `eth_getTransactionReceipt`, friendly to free-tier limits |
| Database | MongoDB in Docker, or Atlas free tier, or `MONGO_URI=mock` (in-memory) | |
| IPFS | Pinata free plan, a local Kubo node, or `mock` | Files are **encrypted before upload** |
| OCR | Tesseract (local) | |
| LLM | Gemini free tier (optional) | Falls back to built-in rules on any error or quota hit |
| Hosting | Run locally; optional free tiers (Vercel + Render) | |

**Gemini caveats:** free-tier quotas are small and change over time (check your limits in Google AI Studio), and
free-tier prompts may be used by Google to improve its products. So: use **sample invoices only** with Gemini. InvoChain
redacts emails, phone numbers, IBANs, long numbers and URLs before any LLM call (`REDACT_BEFORE_LLM=true`), caches
results, spaces requests out, and degrades to rules if Gemini fails. Fraud, risk and eligibility never need an LLM.

---

## 4. Prerequisites

* **Node.js 20+** and npm
* **Python 3.11+**
* **Tesseract OCR**: `sudo apt install tesseract-ocr` · `brew install tesseract` · Windows: install from the UB Mannheim build and add to PATH
* **MetaMask** browser extension
* Docker (optional, for MongoDB). Or use `MONGO_URI=mock` for a quick non-persistent demo.

---

## 5. Quick start A: local chain (no faucet, no keys)

### Easiest way (recommended, works on Windows, Mac and Linux)
Install **Node.js 20+**, **Python 3.10+**, **Tesseract** and **MetaMask** (section 4), open a terminal in this folder, then:

```bash
python scripts/setup.py          # one time: checks tools, creates .env, installs everything (5-10 min)
python scripts/start_local.py    # every time: starts blockchain + contracts + backend + website
```
Open **http://localhost:5173**. The script prints the MetaMask test accounts to import. Press **Ctrl+C** to stop everything.
(On Mac/Linux use `python3`.) Logs are written to the `logs/` folder. Data resets each time you stop (fake local blockchain + in-memory database).

### Manual way (if you want to run each part yourself)


```bash
cp .env.example .env            # then edit as below
```

Edit `.env`:
```
MONGO_URI=mongodb://localhost:27017      # or: mock
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
IPFS_MODE=mock
OPERATOR_PRIVATE_KEY=<Account #0 private key printed by `npx hardhat node`>
ADMIN_WALLETS=<Account #0 address>
```

**Terminal 1: chain + deploy**
```bash
docker compose up -d                      # MongoDB (skip if MONGO_URI=mock)
cd contracts && npm install --legacy-peer-deps
npx hardhat node                          # leave running; note the printed accounts + private keys
# new terminal:
npx hardhat run scripts/deploy.js --network localhost
```
If the Solidity compiler download is blocked on your network, prefix commands with `USE_SOLCJS=1` (uses the bundled pure-JS compiler).

**Terminal 2: backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Terminal 3: frontend**
```bash
cd frontend && npm install --legacy-peer-deps && npm run dev      # http://localhost:5173
```

**MetaMask (local only):** import Hardhat accounts #0–#3 using the private keys printed by `hardhat node`
(these keys are public, so use them for local development only, never on a real network):
#0 = admin, #1 = supplier, #2 = buyer, #3 = financier. The app adds the "Hardhat Local" network for you.

---

## 6. Quick start B: Sepolia

1. **Create wallets** in MetaMask (never reuse a wallet with real funds): *Deployer/Admin*, *Supplier*, *Buyer*, *Financier*,
   plus a separate *Operator* account whose private key goes in `.env`.
2. **Get free Sepolia ETH** for Deployer, Operator, Supplier, Buyer, Financier (a small amount each; send a bit between your own accounts to top up).
3. **Get an RPC URL** (free Infura/Alchemy project, or a public Sepolia endpoint).
4. Fill `.env`:
   ```
   SEPOLIA_RPC_URL=...   DEPLOYER_PRIVATE_KEY=<deployer>   OPERATOR_ADDRESS=<operator address>
   RPC_URL=<same RPC>    CHAIN_ID=11155111               OPERATOR_PRIVATE_KEY=<operator key>
   ADMIN_WALLETS=<deployer address>
   ```
5. Deploy: `cd contracts && npx hardhat run scripts/deploy.js --network sepolia`
6. (Optional) verify on Etherscan with the commands the script prints (free API key).
7. Start backend and frontend as in section 5. The app forces Sepolia and offers to switch your wallet.

**Optional switches in `.env`:** `GEMINI_API_KEY=` (free key) for LLM explanations/chat, `IPFS_MODE=pinata` + `PINATA_JWT=`
for real IPFS, `RECONCILE_INTERVAL_SECONDS=60` for background chain reconciliation.

---

## 7. Demo walkthrough (5 minutes)

Sample invoices are in `samples/` (regenerate with fresh dates: `python samples/generate_samples.py`).

1. **Admin** signs in (wallet in `ADMIN_WALLETS`). **Buyer** and **Supplier** sign in with their wallets, choose roles and register. **Financier** registers, then the admin approves them in *Administration → Approvals*.
2. **Supplier:** *Upload invoice* → `01_clean_invoice.pdf`. Review the extracted fields, pick the buyer, *Confirm & run AI check* → low risk. *Register on blockchain* (sign) → *Submit to buyer* (sign).
3. **Buyer:** open the invoice → *Verify this invoice* (sign). An ERC-721 token is minted.
4. **Supplier:** *Request financing* (90%). **Financier:** *Marketplace* → review risk and verification → *Fund* (approve tUSD + sign). Get tUSD from *Profile & wallet* first.
5. **Buyer:** *Repay* (get tUSD from the faucet first). **Financier:** *Confirm settlement*. The token is burned.
6. **Everyone:** ask the *AI assistant* "What is the status of INV-2026-0142?" and open *Transactions*.
7. **Attacks to try:** upload `02_exact_duplicate_of_01.pdf` (held, and the contract refuses to register it); `03_same_number…` (same number, different file); `04_suspicious_inconsistent.pdf` (due date before invoice date, supplier = buyer, round amount); `05_large_long_terms.pdf` (medium risk, needs admin "extra verification"); try to fund the same invoice twice.

---

## 8. Project structure

```
invochain/
├── README.md  OWNERSHIP.md  .env.example  docker-compose.yml
├── contracts/                  Hardhat project
│   ├── contracts/              InvoiceRegistry.sol, InvoiceToken.sol (ERC-721), TestUSD.sol (ERC-20), InvoiceTypes.sol, mocks/
│   ├── test/InvoChain.test.js  38 tests
│   └── scripts/deploy.js       deploys + exports ABIs/addresses
├── backend/
│   ├── app/core/               config, db, wallet-signature auth, AES-256-GCM crypto
│   ├── app/api/                auth, invoices, chain, marketplace, dashboard, admin, ai, assistant, users
│   ├── app/services/           web3 chain service, IPFS, secure uploads, invoice domain logic
│   ├── app/ocr/                PDF text layer + Tesseract + field parser
│   ├── app/ml/                 features, synthetic data, Isolation Forest (+ trained artifact)
│   ├── app/agents/             orchestrator (LangGraph), extraction, fraud, risk, eligibility, assistant + tools, llm wrapper
│   └── tests/                  unit + end-to-end (real local chain)
├── frontend/src/               pages (14), components, wallet/auth context, Ethers helpers, tests
├── shared/                     ABIs (+ deployment.json after you deploy)
└── samples/                    realistic test invoices + generator
```

The 14 pages: Landing · Login · Register/role selection · Dashboards (supplier/buyer/financier) · Invoice upload · Invoice management (+ detail) ·
AI fraud dashboard · AI assistant · Financing marketplace · Financier portfolio · Invoice tokens · Transaction explorer · Profile · Admin.

---

## 9. Verification checklist (the parts I couldn't run)

1. `cd contracts && npx hardhat test` → 38 passing.
2. Start the local chain + deploy, then `cd backend && pytest` → 12 passing (the 4 end-to-end tests auto-skip if no chain is running; each test reverts the chain to a clean snapshot).
3. `cd frontend && npm test && npm run build` → 29 passing, build succeeds.
4. In a real browser: sign in, register, run the full demo above. Watch for MetaMask prompts, toasts with tx hashes, and status changes.
5. On Sepolia: confirm tx hashes open on Etherscan from the *Transactions* page.
6. Set `GEMINI_API_KEY` and confirm the assistant badge says "Powered by Gemini" and answers still match your data.
7. Set `IPFS_MODE=pinata` + `PINATA_JWT`, upload an invoice, and check the CID resolves to **encrypted** bytes on a public gateway (unreadable without the key).

---

## 10. Security notes

* No seed phrases or private keys are ever requested. Login = free signed message (nonce, single use, 5 min).
* The only private key the backend holds is the **testnet operator key** in `.env`. Use a throwaway wallet. It has no power over funds, verification or repayment.
* Invoice files: type sniffed by magic bytes (PDF/PNG/JPEG), size-limited, filename sanitised, **AES-256-GCM encrypted before IPFS**, key wrapped with `ENCRYPTION_MASTER_KEY`, integrity re-checked on download. Only a SHA-256 hash and the CID go on-chain.
* Smart contracts: OpenZeppelin `AccessControl`, `ReentrancyGuard`, `Pausable`, `SafeERC20`; checks-effects-interactions; input validation; custom errors; events on every transition; duplicate keys on-chain.
* API: JWT, role guards on every route, per-invoice access rules (buyers only see invoices addressed to them, financiers only marketplace/funded ones), assistant tools are read-only and scoped to the signed-in user.
* **Not audited.** Do not deploy to mainnet or use for real money.

### Known limitations (honest list)
* A smart contract cannot verify that goods were delivered. The buyer's wallet attestation plus admin review is the mechanism; real deployments need KYC/legal agreements.
* The anomaly model trains on **synthetic** data (no free labelled fraud dataset exists). It is a screening aid; thresholds are heuristics.
* OCR handles typical single-column invoices; unusual layouts need the review step (that is why it exists).
* Reconciliation uses view calls and receipts instead of `eth_getLogs`, so it works on free RPC tiers but is not a full event indexer.
* The role "financier" requires admin approval; "supplier"/"buyer" are self-service for demo convenience.

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Hardhat can't download the Solidity compiler | `USE_SOLCJS=1 npx hardhat compile` |
| "Tesseract OCR is not installed" | Install Tesseract and make sure `tesseract` is on PATH |
| Banner "Blockchain connection unavailable" | Chain/RPC not running, or contracts not deployed (`shared/deployment.json` missing). Deploy, then restart the backend |
| "Your wallet doesn't have the required role" right after signup | Role grant takes a few seconds. *Profile & wallet → Retry now* |
| Financier can't see the marketplace | Admin must approve the financier first |
| "Wrong network" | Click the red pill to switch to the required network |
| Admin can't clear a flag | `clearFlag` must be signed by the **deployer** wallet (contract admin). Put that address in `ADMIN_WALLETS` |
| Assistant says "Built-in rules" | No `GEMINI_API_KEY`, or quota hit; answers still come from your real data |
| Backend tests skipped | Start `npx hardhat node`, deploy, rerun |
| Insufficient funds for gas | Get Sepolia ETH from a faucet (local chain accounts already have 10,000 ETH) |

Licence: MIT for the code in this repository. OpenZeppelin contracts are MIT-licensed.
