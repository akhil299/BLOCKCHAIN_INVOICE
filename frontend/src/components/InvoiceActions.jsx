import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { keccak256, toUtf8Bytes } from "ethers";
import { Ban, CheckCircle2, Coins, Gavel, HandCoins, Loader2, Send, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { toUnits } from "../lib/chain";
import { money } from "../lib/format";
import { useApp } from "../context/Auth";
import { useToast } from "../context/Toasts";
import { Modal, Notice } from "./ui";

const bpsOf = (inv) => inv.advance_bps || 9000;
const unitsOf = (a) => BigInt(Math.round(Number(a) * 1e6));

/** Approve tUSD (if needed) then fund. Exposed separately so the marketplace can reuse it. */
export function useFund() {
  const { runTx } = useApp();
  return (inv, done) => runTx({
    title: "Fund invoice",
    success: "Funds sent to the supplier. The invoice is now financed.",
    send: async ({ registry, usd }, signer, say) => {
      const adv = (unitsOf(inv.amount) * BigInt(bpsOf(inv))) / 10000n;
      const me = await signer.getAddress();
      if ((await usd.balanceOf(me)) < adv) throw Object.assign(new Error("tUSD balance too low"), { data: "0xe450d38c" });
      if ((await usd.allowance(me, await registry.getAddress())) < adv) {
        say(`Step 1 of 2: allow InvoChain to move ${money(Number(adv) / 1e6)} tUSD`);
        await (await usd.approve(await registry.getAddress(), adv)).wait();
        say("Step 2 of 2: confirm the funding transaction");
      }
      return registry.approveFinancing(inv.chain_id);
    },
  }).then((h) => { if (h) done?.(); return h; });
}

export default function InvoiceActions({ invoice: inv, onChanged }) {
  const { user, runTx, balances } = useApp();
  const toast = useToast();
  const nav = useNavigate();
  const fund = useFund();
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState("");
  const [bps, setBps] = useState(inv.analysis?.eligibility?.suggested_advance_bps || 9000);
  const [repay, setRepay] = useState(null);
  const [tier, setTier] = useState("LOW");
  const role = user.role, st = inv.status, cid = inv.chain_id;
  const done = () => onChanged?.();
  const outstanding = Math.max(0, (inv.repay_amount || 0) - (inv.repaid_amount || 0));
  const risk = inv.analysis?.risk;
  const anchored = Boolean(inv.risk_anchor_tx) || (inv.onchain && inv.onchain.risk !== "UNASSESSED");
  const isMine = (w) => w && w === user.wallet;

  const register = async () => {
    setBusy(true);
    try {
      const prep = await api(`/invoices/${inv.id}/prepare-register`, { method: "POST" });
      const a = prep.args;
      await runTx({ title: "Register invoice", success: "Invoice registered. The AI risk result is now being recorded on-chain.",
        send: ({ registry }) => registry.registerInvoice(a.buyer, BigInt(a.amount), a.invoiceDate, a.dueDate, a.docHash, a.numberHash, a.cid) });
      done();
    } catch (e) { toast.push({ tone: "error", title: "Cannot register yet", body: e.message }); }
    finally { setBusy(false); }
  };
  const tx = async (title, send, success) => { setBusy(true); try { const h = await runTx({ title, send, success }); if (h) done(); } finally { setBusy(false); } };
  const doRepay = async () => {
    const amt = repay ?? outstanding;
    await tx("Repay invoice", async ({ registry, usd }, signer, say) => {
      const units = toUnits(amt), me = await signer.getAddress();
      if ((await usd.allowance(me, await registry.getAddress())) < units) { say(`Step 1 of 2: allow ${money(amt)} tUSD`); await (await usd.approve(await registry.getAddress(), units)).wait(); say("Step 2 of 2: confirm the repayment"); }
      return registry.recordRepayment(cid, units);
    }, "Repayment recorded and sent to the financier.");
    setModal(null);
  };
  const adminApi = async (path, body, okMsg) => {
    setBusy(true);
    try { await api(path, { method: "POST", body }); toast.push({ tone: "success", title: okMsg }); done(); }
    catch (e) { toast.push({ tone: "error", title: "Action failed", body: e.message }); } finally { setBusy(false); }
  };

  const B = ({ icon: Icon, children, kind = "primary", ...p }) => <button className={`btn btn-${kind}`} disabled={busy || p.disabled} {...p}>{busy && p.onClick && kind !== "ghost" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}{children}</button>;
  const items = [];
  const notes = [];

  if (role === "supplier" && isMine(inv.supplier_wallet)) {
    if (st === "DRAFT") {
      items.push(<B key="reg" icon={Send} onClick={register}>Register on blockchain</B>);
      items.push(<B key="del" icon={Trash2} kind="ghost" onClick={async () => { if (!confirm("Delete this draft?")) return; await api(`/invoices/${inv.id}`, { method: "DELETE" }); nav("/app/invoices"); }}>Delete draft</B>);
      if (risk?.tier === "HIGH") notes.push(<Notice key="h" tone="warn" title="High-risk invoice">You can still register it, but it will be held for manual review by an administrator before the buyer can verify it.</Notice>);
    }
    if (st === "CREATED") {
      if (anchored) items.push(<B key="sub" icon={Send} onClick={() => tx("Submit to buyer", ({ registry }) => registry.submitForVerification(cid), "The buyer can now verify this invoice.")}>Submit to buyer for verification</B>);
      else notes.push(<Notice key="w" title="Recording the AI risk result on-chain…">This takes a few seconds. <button className="font-semibold underline" onClick={done}>Refresh</button>{inv.risk_anchor_error && <span className="block text-rose-700">Last error: {inv.risk_anchor_error}</span>}</Notice>);
    }
    if (st === "VERIFIED") {
      const needsExtra = inv.risk_tier_on_chain === "MEDIUM" && !inv.extra_verified;
      items.push(
        <div key="rf" className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">Advance rate<select className="input mt-1.5 !w-36" value={bps} onChange={(e) => setBps(Number(e.target.value))}>{[7000, 7500, 8000, 8500, 9000, 9500].map((b) => <option key={b} value={b}>{b / 100}% · {money((inv.amount * b) / 10000)}</option>)}</select></label>
          <B icon={HandCoins} disabled={needsExtra} onClick={() => tx("Request financing", ({ registry }) => registry.requestFinancing(cid, bps), "Listed in the marketplace. A financier can now fund it.")}>Request financing</B>
        </div>);
      if (needsExtra) notes.push(<Notice key="x" tone="warn" title="Additional verification needed">Medium-risk invoices must be confirmed by an administrator before they can be financed.</Notice>);
    }
    if (st === "FINANCING_REQUESTED") items.push(<B key="cr" icon={Ban} kind="ghost" onClick={() => tx("Cancel financing request", ({ registry }) => registry.cancelFinancingRequest(cid), "Request withdrawn.")}>Withdraw request</B>);
    if (["CREATED", "PENDING_VERIFICATION", "VERIFIED"].includes(st)) items.push(<B key="ci" icon={XCircle} kind="ghost" onClick={() => confirm("Cancel this invoice? It can no longer be financed.") && tx("Cancel invoice", ({ registry }) => registry.cancelInvoice(cid), "Invoice cancelled.")}>Cancel invoice</B>);
  }
  if (role === "buyer" && isMine(inv.buyer_wallet)) {
    if (st === "PENDING_VERIFICATION") {
      items.push(<B key="v" icon={CheckCircle2} kind="signal" onClick={() => tx("Verify invoice", ({ registry }) => registry.verifyInvoice(cid), "You confirmed this invoice. The supplier can now request financing.")}>Verify this invoice</B>);
      items.push(<B key="r" icon={XCircle} kind="danger" onClick={() => setModal("reject")}>Reject</B>);
    }
  }
  if ((role === "buyer" && isMine(inv.buyer_wallet)) || (role === "supplier" && isMine(inv.supplier_wallet))) {
    if (st === "FINANCED") items.push(<B key="rp" icon={Coins} onClick={() => { setRepay(outstanding); setModal("repay"); }}>Repay {money(outstanding)} tUSD</B>);
  }
  if (role === "financier") {
    if (st === "FINANCING_REQUESTED") items.push(<B key="f" icon={Coins} kind="signal" onClick={() => fund(inv, done)}>Fund {money(inv.advance_amount || (inv.amount * bpsOf(inv)) / 10000)} tUSD</B>);
    if (st === "REPAID" && isMine(inv.financier_wallet)) items.push(<B key="mp" icon={ShieldCheck} onClick={() => tx("Mark as paid", ({ registry }) => registry.markAsPaid(cid), "Invoice settled and its token burned.")}>Confirm settlement</B>);
  }
  if (role === "admin") {
    if (st === "FLAGGED") {
      items.push(<B key="cf" icon={Gavel} onClick={() => setModal("clear")}>Clear flag (sign as admin)</B>);
    }
    if (st === "REPAID") items.push(<B key="mp" icon={ShieldCheck} onClick={() => tx("Mark as paid", ({ registry }) => registry.markAsPaid(cid), "Invoice settled.")}>Confirm settlement</B>);
    if (inv.chain_id && (inv.risk_tier_on_chain === "MEDIUM") && !inv.extra_verified && !["CLOSED", "REJECTED", "CANCELLED"].includes(st))
      items.push(<B key="ev" icon={ShieldCheck} kind="ghost" onClick={() => adminApi(`/admin/invoices/${inv.id}/extra-verification`, undefined, "Additional verification recorded on-chain")}>Confirm additional verification</B>);
  }
  if (!items.length && !notes.length) return null;
  return (
    <div className="space-y-4">
      {notes}
      {items.length > 0 && <div className="flex flex-wrap items-end gap-3">{items}</div>}
      {role === "financier" && st === "FINANCING_REQUESTED" && balances.tusd != null && balances.tusd < (inv.advance_amount || 0) && <p className="text-sm text-risk-medium">Your tUSD balance is {money(balances.tusd)}. Get test tokens from the faucet in Profile & wallet.</p>}

      <Modal open={modal === "reject"} onClose={() => setModal(null)} title="Reject this invoice">
        <p className="text-sm text-ink-500">The supplier is told the invoice was rejected. Only a fingerprint of your reason is stored on-chain.</p>
        <textarea className="input mt-4" rows={3} placeholder="Reason (e.g. amount does not match the purchase order)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setModal(null)}>Back</button>
          <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={async () => { await tx("Reject invoice", ({ registry }) => registry.rejectInvoice(cid, keccak256(toUtf8Bytes(reason.trim()))), "Invoice rejected."); setModal(null); }}>Reject invoice</button></div>
      </Modal>
      <Modal open={modal === "repay"} onClose={() => setModal(null)} title="Repay invoice">
        <p className="text-sm text-ink-500">Outstanding: <b>{money(outstanding)} tUSD</b>. You can pay part now and the rest later. Payment goes straight to the financier.</p>
        <input type="number" min="0.01" max={outstanding} step="0.01" className="input mt-4" value={repay ?? ""} onChange={(e) => setRepay(Number(e.target.value))} aria-label="Repayment amount" />
        <p className="mt-2 text-xs text-ink-500">Your tUSD balance: {money(balances.tusd)}</p>
        <div className="mt-5 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setModal(null)}>Back</button><button className="btn btn-primary" disabled={busy || !(repay > 0) || repay > outstanding + 0.0001} onClick={doRepay}>Repay</button></div>
      </Modal>
      <Modal open={modal === "clear"} onClose={() => setModal(null)} title="Clear manual-review flag">
        <p className="text-sm text-ink-500">After reviewing the documents, lower the risk tier so the invoice can continue. Medium-risk invoices still need additional verification. This transaction must be signed by the contract admin wallet.</p>
        <select className="input mt-4" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="New risk tier"><option value="LOW">Low risk</option><option value="MEDIUM">Medium risk (extra verification required)</option></select>
        <div className="mt-5 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setModal(null)}>Back</button>
          <button className="btn btn-primary" disabled={busy} onClick={async () => {
            await api(`/admin/invoices/${inv.id}/review`, { method: "POST", body: { decision: "clear", note: `Cleared as ${tier} after manual review` } }).catch(() => {});
            await tx("Clear flag", ({ registry }) => registry.clearFlag(cid, tier === "LOW" ? 1 : 2), "Flag cleared."); setModal(null);
          }}>Sign & clear</button></div>
      </Modal>
    </div>
  );
}
