import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, Eye, FileLock2, Fingerprint, Hash } from "lucide-react";
import { api, fetchBlob } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { dateOnly, dateTime, money, short } from "../lib/format";
import { EVENT_LABEL } from "../lib/constants";
import { Addr, ErrorBox, Loading, Mono, Notice, Tabs } from "../components/ui";
import { StatusBadge, TierBadge } from "../components/StatusBadge";
import LifecycleRail from "../components/LifecycleRail";
import RiskPanel from "../components/RiskPanel";
import InvoiceActions from "../components/InvoiceActions";

function Row({ k, children }) { return <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 text-sm last:border-0"><dt className="text-ink-500">{k}</dt><dd className="min-w-0 text-right font-semibold">{children}</dd></div>; }

export default function InvoiceDetail() {
  const { id } = useParams();
  const { user, config } = useApp();
  const { data, error, loading, reload } = useAsync(() => api(`/invoices/${id}`), [id]);
  const txs = useAsync(() => api("/chain/txs"), [id]);
  const [tab, setTab] = useState("risk");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const inv = data.invoice;
  const mine = (txs.data?.txs || []).filter((t) => t.invoice_id === inv.id).sort((a, b) => a.block - b.block);
  const openDoc = async () => { const b = await fetchBlob(`/invoices/${inv.id}/document`); window.open(URL.createObjectURL(b), "_blank"); };
  const explorer = config?.requiredChainId === 11155111 ? config.explorerTxUrl : null;
  const refresh = () => { reload(); txs.reload(); };
  return (
    <>
      <Link to="/app/invoices" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink"><ArrowLeft className="h-4 w-4" />All invoices</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="font-mono text-2xl font-bold tracking-tight">{inv.invoice_number || inv.id}</h1><p className="mt-1 text-ink-500">{inv.supplier_name} → {inv.buyer_name}</p></div>
        <div className="flex items-center gap-2"><TierBadge tier={inv.analysis?.risk?.tier} score={inv.analysis?.risk?.score} /><StatusBadge status={inv.status} /></div>
      </div>

      <div className="card mb-5 p-6"><LifecycleRail status={inv.status} statusBeforeFlag={inv.status_before_flag} /></div>
      {inv.onchain && inv.onchain_matches_db === false && <div className="mb-5"><Notice tone="warn" title="Blockchain state is newer">The blockchain shows {inv.onchain.status}. Refresh in a moment; the server is catching up.</Notice></div>}
      {inv.admin_review && <div className="mb-5"><Notice title={`Administrator review: ${inv.admin_review.decision === "clear" ? "cleared" : "kept on hold"}`}>{inv.admin_review.note}</Notice></div>}
      <div className="card mb-5 p-6"><h2 className="mb-4 font-bold">Actions</h2><InvoiceActions invoice={inv} onChanged={refresh} />{!["x"].includes(inv.status) && <p className="mt-1 text-xs text-ink-500 empty:hidden" />}</div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="card p-6 lg:col-span-2">
          <h2 className="mb-2 font-bold">Invoice details</h2>
          <dl>
            <Row k="Amount"><span className="font-mono text-base">{money(inv.amount)} {inv.currency === "USD" ? "tUSD" : inv.currency}</span></Row>
            <Row k="Invoice date">{dateOnly(inv.invoice_date)}</Row><Row k="Due date">{dateOnly(inv.due_date)}</Row>
            <Row k="Supplier"><Addr a={inv.supplier_wallet} /></Row><Row k="Buyer"><Addr a={inv.buyer_wallet} /></Row>
            {inv.description && <Row k="Description"><span className="font-medium">{inv.description}</span></Row>}
            {inv.financier_wallet && <Row k="Financier"><Addr a={inv.financier_wallet} /></Row>}
            {inv.financed_amount != null && <Row k="Advance paid">{money(inv.financed_amount)} tUSD ({(inv.advance_bps || 0) / 100}%)</Row>}
            {inv.repay_amount != null && <Row k="Repaid">{money(inv.repaid_amount)} / {money(inv.repay_amount)} tUSD</Row>}
          </dl>
          <h3 className="mb-1 mt-6 flex items-center gap-2 text-sm font-bold"><Fingerprint className="h-4 w-4" />Proof & storage</h3>
          <dl>
            <Row k="Document hash"><Mono copy={inv.doc_hash}>{short(inv.doc_hash, 10, 8)}</Mono></Row>
            <Row k="IPFS CID (encrypted)"><Mono copy={inv.cid}>{short(inv.cid, 10, 6)}</Mono></Row>
            {inv.chain_id && <Row k="Blockchain invoice">#{inv.chain_id}</Row>}
            {inv.token_id && <Row k="Invoice token (ERC-721)">#{inv.token_id}{inv.token_locked ? " · locked" : ""}</Row>}
          </dl>
          {!(user.role === "financier" && !["FINANCED", "REPAID", "CLOSED"].includes(inv.status) && inv.status !== "FINANCING_REQUESTED") && (
            <button onClick={openDoc} className="btn btn-ghost mt-5 w-full"><Eye className="h-4 w-4" />Open document (decrypted for you)</button>)}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500"><FileLock2 className="h-3.5 w-3.5" />Stored encrypted. Only the parties to this invoice can read it.</p>
        </section>

        <section className="card p-6 lg:col-span-3">
          <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: "risk", label: "AI risk analysis" }, { value: "history", label: "Blockchain history", count: mine.length }]} /></div>
          {tab === "risk" ? <RiskPanel analysis={inv.analysis} /> : mine.length === 0 ? <p className="py-8 text-center text-sm text-ink-500">No blockchain transactions recorded for this invoice yet.</p> : (
            <ol className="relative space-y-5 border-l-2 border-line pl-6">
              {mine.map((t) => (
                <li key={t.hash} className="relative"><span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-signal bg-white" />
                  <p className="text-sm font-bold">{EVENT_LABEL[t.kind] || t.kind}</p>
                  <p className="text-xs text-ink-500">{dateTime(t.at)} · block {t.block} · by <span className="font-mono">{short(t.from)}</span></p>
                  <p className="mt-1 font-mono text-xs">{explorer ? <a className="inline-flex items-center gap-1 text-signal-600 hover:underline" href={explorer + t.hash} target="_blank" rel="noreferrer">{short(t.hash, 12, 8)}<ExternalLink className="h-3 w-3" /></a> : short(t.hash, 12, 8)}</p>
                </li>))}
            </ol>)}
        </section>
      </div>
    </>
  );
}
