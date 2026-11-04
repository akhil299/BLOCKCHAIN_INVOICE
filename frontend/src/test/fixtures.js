const W = { supplier: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", buyer: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", financier: "0x90f79bf6eb2c4f870365e785982e1f101e93b906", admin: "0xf39fd6e51aad88f6f4ce6aB8827279cffFb92266".toLowerCase() };
export const wallets = W;
const factors = [
  { source: "rule", id: "LONG_TERMS", title: "Very long payment terms", detail: "210 days between invoice and due date.", points: 10, severity: "warning" },
  { source: "model", id: "ANOMALY_MODEL", title: "Statistical anomaly model", detail: "Looks unusual.", points: 12, severity: "warning" },
  { source: "policy", id: "FORCED_HIGH", title: "Policy: held for manual review", detail: "Duplicate found.", points: 0, severity: "critical" },
];
export const analysis = (tier = "MEDIUM", score = 41) => ({
  fields_confirmed: true, summary: "Risk score 41/100 (medium risk). Main factors: long terms.",
  extraction: { fields: {}, confidence: { amount: 0.93, invoice_number: 0.5 }, missing_fields: [], warnings: ["Due date was derived from payment terms."], method: "pdf-text", ocr_confidence: 1, valid: true },
  fraud: { signals: [{ id: "LONG_TERMS", severity: "warning", points: 10, title: "Very long payment terms", detail: "x" }] },
  risk: { score, tier, factors, rule_points: 22, model_points: 12, recommended_action: "Needs additional verification.", disclaimer: "AI-generated risk indicator. It is not a determination of fraud.", model: { model_version: "iforest-synthetic-v1" }, assessed_at: "2026-11-01T10:00:00Z" },
  eligibility: { eligible: false, stage: "in_progress", recommendation: "Not eligible yet: buyer has verified the invoice.", notice: "Recommendation only.", suggested_advance_bps: 8000, checks: [{ name: "Buyer is a registered InvoChain buyer", passed: true, detail: "Buyer: Globex" }, { name: "Buyer has verified the invoice", passed: false, detail: "Awaiting" }] },
  trace: [{ agent: "Invoice Extraction Agent", status: "ok", ms: 12 }, { agent: "Fraud Detection Agent", status: "ok", ms: 8 }],
});
export const invoice = (over = {}) => ({
  id: "inv_abc123", chain_id: 1, invoice_number: "INV-2026-0142", supplier_name: "Acme Components", buyer_name: "Globex Retail Ltd", supplier_wallet: W.supplier, buyer_wallet: W.buyer,
  amount: 8224.6, currency: "USD", invoice_date: "2026-10-20", due_date: "2026-12-25", description: "Bearings", status: "VERIFIED", doc_hash: "0x" + "ab".repeat(32), cid: "bafymock123", mime: "application/pdf",
  token_id: 1, token_locked: false, on_chain: true, risk_tier_on_chain: "MEDIUM", extra_verified: false, risk_anchor_tx: "0x" + "cd".repeat(32), financier_wallet: null,
  advance_bps: 9000, advance_amount: 7402.14, analysis: analysis(), created_at: "2026-10-26T10:00:00Z",
  onchain: { status: "VERIFIED", risk: "MEDIUM" }, onchain_matches_db: true, ...over,
});
export const listing = { id: "inv_abc123", chain_id: 1, invoice_number: "INV-2026-0142", supplier_name: "Acme", buyer_name: "Globex", amount: 8224.6, due_date: "2026-12-25", days_to_due: 54, advance_bps: 9000, advance_amount: 7402.14, repay_amount: 8224.6, profit: 822.46, yield_pct: 11.11, annualised_pct: 75.1,
  risk: { score: 5, tier: "LOW", disclaimer: "x", factors: [{ id: "NEW_RELATIONSHIP", title: "First invoice", detail: "No history", points: 5, severity: "info" }] }, buyer_verified: true, extra_verified: false, token_id: 1, status: "FINANCING_REQUESTED", summary: "Low risk.", supplier_wallet: W.supplier, buyer_wallet: W.buyer, repaid_amount: 0 };
const tx = { hash: "0x" + "12".repeat(32), kind: "InvoiceVerified", from: W.buyer, block: 12, success: true, invoice_id: "inv_abc123", invoice_number: "INV-2026-0142", at: "2026-10-27T10:00:00Z", parties: [] };
const stat = { total: 4, pending_verification: 1, financed: 1, rejected: 0, financing_received: 7402.14, draft: 1, awaiting_funding: 1, risk_alerts: [{ id: "inv_abc123", invoice_number: "INV-1", tier: "MEDIUM", score: 41, status: "VERIFIED" }], by_status: { DRAFT: 1, VERIFIED: 2, FINANCED: 1 }, pending: 1, verified: 2, to_repay: 1, amount_to_repay: 100, available: 1, approved: 1, funds_deployed: 7402.14, active: 1, repaid: 0, returns_earned: 0,
  users: 5, users_by_role: { supplier: 2, buyer: 2, admin: 1 }, pending_approvals: 1, flagged: 1, volume_financed: 7402.14, transactions: 3, tiers: { LOW: 1, MEDIUM: 2, HIGH: 1 } };
export const routes = {
  "/chain/config": { chain: { connected: true, chainId: 31337, contracts: { InvoiceRegistry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", InvoiceToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", TestUSD: "0x5FbDB2315678afecb367f032d93F642f64180aa3" } }, requiredChainId: 31337, explorerTxUrl: "https://sepolia.etherscan.io/tx/", ipfsMode: "mock", aiMode: "rules" },
  "/dashboard": stat, "/invoices": { invoices: [invoice(), invoice({ id: "inv_2", status: "PENDING_VERIFICATION", invoice_number: "HX-1" }), invoice({ id: "inv_3", status: "DRAFT", chain_id: null, token_id: null, invoice_number: "D-1" })] },
  "/invoices/inv_abc123": { invoice: invoice() }, "/users/buyers": { buyers: [{ wallet: W.buyer, name: "Bob", company: "Globex Retail Ltd" }] },
  "/chain/txs": { txs: [tx], explorerTxUrl: "x" }, "/marketplace": { listings: [listing] }, "/marketplace/portfolio": { funded: [{ ...listing, status: "FINANCED", repaid_amount: 1000, financier_wallet: W.financier }] },
  "/ai/overview": { total: 4, average_score: 33.5, tiers: { LOW: 1, MEDIUM: 2, HIGH: 1 }, top_signals: [{ title: "Very long payment terms", count: 2 }], histogram: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0], recent: [{ id: "inv_abc123", invoice_number: "INV-1", supplier_name: "Acme", amount: 100, score: 41, tier: "MEDIUM", status: "VERIFIED", summary: "Medium." }], model: { version: "iforest-synthetic-v1", trained_on: "synthetic", samples: 6000, algorithm: "IsolationForest", note: "n" } },
  "/admin/users": { users: [{ wallet: W.supplier, role: "supplier", name: "Sam", company: "Acme", status: "active", created_at: "2026-10-01T10:00:00Z", chain_role_synced: true }, { wallet: W.financier, role: "financier", name: "Fay", company: "Atlas", status: "pending", created_at: "2026-10-02T10:00:00Z" }] },
  "/admin/flagged": { invoices: [invoice({ status: "FLAGGED" })] }, "/assistant/chat": { answer: "Invoice INV-2026-0142 is VERIFIED.\n- risk MEDIUM", mode: "rules", tools_used: ["get_invoice"] },
};
