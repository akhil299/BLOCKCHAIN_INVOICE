import { useState } from "react";
import { Boxes, Lock, LockOpen, Scale, ScrollText } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { contractsFor, provider } from "../lib/chain";
import { dateOnly, money, short } from "../lib/format";
import { Addr, Empty, ErrorBox, Loading, Mono, Notice, PageHeader } from "../components/ui";
import { StatusBadge } from "../components/StatusBadge";
import { Link } from "react-router-dom";

function TokenCard({ inv, config }) {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const read = async () => {
    try {
      const c = contractsFor(provider(), config.chain.contracts);
      const uri = await c.token.tokenURI(inv.token_id);
      setMeta(JSON.parse(atob(uri.split(",")[1])));
    } catch { setErr("Could not read the token from the blockchain. Check your wallet network."); }
  };
  const burned = inv.status === "CLOSED";
  return (
    <article className="card overflow-hidden">
      <div className="relative bg-ink p-5 text-white">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "repeating-linear-gradient(45deg,#fff 0 1px,transparent 1px 10px)" }} aria-hidden />
        <div className="relative flex items-start justify-between"><div><p className="text-xs font-semibold text-white/60">INVO token</p><p className="font-mono text-3xl font-bold">#{inv.token_id ?? "–"}</p></div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${inv.token_locked ? "bg-amber-400/20 text-amber-200" : "bg-signal/20 text-signal"}`}>{inv.token_locked ? <><Lock className="h-3 w-3" />Locked</> : <><LockOpen className="h-3 w-3" />Transferable</>}</span></div>
        <p className="relative mt-4 font-mono text-sm text-white/85">{inv.invoice_number}</p>
      </div>
      <div className="space-y-3 p-5 text-sm">
        <div className="flex items-center justify-between"><span className="text-ink-500">Invoice</span><Link className="font-semibold text-signal-600 hover:underline" to={`/app/invoices/${inv.id}`}>#{inv.chain_id} · {money(inv.amount)} tUSD</Link></div>
        <div className="flex items-center justify-between"><span className="text-ink-500">Supplier</span><Addr a={inv.supplier_wallet} /></div>
        <div className="flex items-center justify-between gap-4"><span className="text-ink-500">Invoice hash</span><Mono copy={inv.doc_hash}>{short(inv.doc_hash, 8, 6)}</Mono></div>
        <div className="flex items-center justify-between"><span className="text-ink-500">Status</span><StatusBadge status={inv.status} /></div>
        {!burned && !meta && <button className="btn btn-ghost w-full !py-2" onClick={read}>Read on-chain metadata</button>}
        {err && <p className="text-xs text-risk-high">{err}</p>}
        {meta && <pre className="max-h-44 overflow-auto rounded-xl bg-paper p-3 font-mono text-[0.7rem] leading-relaxed">{JSON.stringify(meta, null, 2)}</pre>}
        {burned && <p className="text-xs text-ink-500">This token was burned when the invoice settled. The registry keeps the permanent history.</p>}
      </div>
    </article>
  );
}

export default function Tokens() {
  const { config } = useApp();
  const { data, error, loading, reload } = useAsync(() => api("/invoices"), []);
  const list = (data?.invoices || []).filter((i) => i.token_id || i.status === "CLOSED").filter((i) => i.chain_id);
  return (
    <>
      <PageHeader title="Invoice tokens" subtitle="Each verified invoice gets exactly one ERC-721 token. It is a receipt on the blockchain, not a legal title." />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {[[Boxes, "One token per claim", "The token ID equals the invoice ID, so two tokens can never represent the same financing claim."], [Lock, "Locked while financed", "From the financing request until settlement the token cannot be transferred, so nobody can sell the same invoice twice."], [Scale, "Not proof of ownership", "Holding the token does not make you the legal owner of a receivable. Financing proceeds always go to the supplier of record."]].map(([Icon, t, d]) => (
          <div key={t} className="card p-5"><Icon className="mb-3 h-6 w-6 text-signal-600" /><h2 className="font-bold">{t}</h2><p className="mt-1 text-sm leading-relaxed text-ink-500">{d}</p></div>))}
      </div>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : list.length === 0 ? <div className="card"><Empty icon={ScrollText} title="No tokens yet" body="A token is minted automatically when the buyer verifies an invoice." /></div> : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{list.map((i) => <TokenCard key={i.id} inv={i} config={config} />)}</div>}
      <div className="mt-6"><Notice title="Settlement design">After the buyer repays in full and the financier confirms, the contract burns the token and sets the invoice to Settled. Transfers are blocked during financing; outside financing a token may be moved, but the supplier must hold it to request funding.</Notice></div>
    </>
  );
}
