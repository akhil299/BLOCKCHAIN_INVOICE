import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, ReceiptText, RefreshCw, Search } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { EVENT_LABEL } from "../lib/constants";
import { dateTime, short } from "../lib/format";
import { Addr, Empty, ErrorBox, Loading, Mono, Notice, PageHeader } from "../components/ui";
import { useToast } from "../context/Toasts";

export default function Transactions() {
  const { config } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api("/chain/txs"), []);
  const [q, setQ] = useState("");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const explorer = config?.requiredChainId === 11155111 ? config.explorerTxUrl : null;
  const rows = (data?.txs || []).filter((t) => { const s = q.toLowerCase(); return !s || t.hash.includes(s) || (t.invoice_number || "").toLowerCase().includes(s) || (EVENT_LABEL[t.kind] || t.kind).toLowerCase().includes(s); });
  const sync = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api("/chain/confirm", { method: "POST", body: { tx_hash: hash.trim() } }); toast.push({ tone: r.pending ? "note" : "success", title: r.pending ? "Not mined yet" : "Transaction synced", body: r.pending ? "Try again in a few seconds." : `Events: ${r.events.join(", ") || "none"}` }); setHash(""); reload(); }
    catch (x) { toast.push({ tone: "error", title: "Could not sync", body: x.message }); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Blockchain transactions" subtitle="Every on-chain action InvoChain knows about, with its status and confirmation." actions={<button className="btn btn-ghost" onClick={reload}><RefreshCw className="h-4 w-4" />Refresh</button>} />
      {!explorer && config && <div className="mb-5"><Notice title="Local test network">You are on a local development chain, which has no public block explorer. Hashes can be copied; on Sepolia they become Etherscan links.</Notice></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" /><input className="input !pl-9" placeholder="Search hash, invoice or event" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" /></div>
        <form onSubmit={sync} className="flex flex-1 gap-2 sm:max-w-md"><input className="input font-mono text-xs" placeholder="Sync a transaction by hash (0x…)" value={hash} onChange={(e) => setHash(e.target.value)} pattern="0x[0-9a-fA-F]{64}" aria-label="Transaction hash" /><button className="btn btn-primary shrink-0" disabled={busy || !hash}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sync"}</button></form>
      </div>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> : rows.length === 0 ? <Empty icon={ReceiptText} title="No transactions yet" body="Register an invoice or take any on-chain action and it will show up here." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[860px]">
            <thead className="border-b border-line bg-paper/60"><tr><th className="th">Action</th><th className="th">Invoice</th><th className="th">Transaction hash</th><th className="th">Block</th><th className="th">From</th><th className="th">Time</th><th className="th">Result</th></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((t) => (
              <tr key={t.hash} className="hover:bg-paper/60">
                <td className="td font-semibold">{EVENT_LABEL[t.kind] || t.kind}</td>
                <td className="td">{t.invoice_id ? <Link className="font-mono text-signal-600 hover:underline" to={`/app/invoices/${t.invoice_id}`}>{t.invoice_number || t.invoice_id}</Link> : <span className="text-ink-500">–</span>}</td>
                <td className="td">{explorer ? <a href={explorer + t.hash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-signal-600 hover:underline">{short(t.hash, 10, 8)}<ExternalLink className="h-3 w-3" /></a> : <Mono copy={t.hash}>{short(t.hash, 10, 8)}</Mono>}</td>
                <td className="td font-mono text-xs">{t.block}</td><td className="td"><Addr a={t.from} /></td><td className="td whitespace-nowrap text-ink-500">{dateTime(t.at)}</td>
                <td className="td"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${t.success ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{t.success ? "Confirmed" : "Failed"}</span></td>
              </tr>))}</tbody></table></div>)}
      </div>
    </>
  );
}
