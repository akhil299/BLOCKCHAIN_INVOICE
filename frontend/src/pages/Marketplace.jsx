import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Coins, Store, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { useFund } from "../components/InvoiceActions";
import { TIER } from "../lib/constants";
import { dateOnly, money } from "../lib/format";
import { Addr, Empty, ErrorBox, Loading, Modal, Notice, PageHeader } from "../components/ui";
import { TierBadge } from "../components/StatusBadge";
import { FactorList } from "../components/RiskPanel";
import { Link } from "react-router-dom";

function Card({ l, onOpen, onFund, canFund }) {
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-mono text-sm font-semibold">{l.invoice_number}</p><p className="truncate text-xs text-ink-500">{l.supplier_name} → {l.buyer_name}</p></div><TierBadge tier={l.risk.tier} score={l.risk.score} /></div>
      <div className="my-5 grid grid-cols-2 gap-4">
        <div><p className="text-xs font-semibold text-ink-500">You pay now</p><p className="text-2xl font-extrabold tracking-tight">{money(l.advance_amount)}<span className="ml-1 text-xs font-semibold text-ink-500">tUSD</span></p></div>
        <div><p className="text-xs font-semibold text-ink-500">You receive at due date</p><p className="text-2xl font-extrabold tracking-tight text-signal-600">{money(l.repay_amount)}</p></div>
      </div>
      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-paper p-3 text-center text-xs">
        <div><dt className="text-ink-500">Return</dt><dd className="mt-0.5 font-mono text-sm font-bold">{l.yield_pct}%</dd></div>
        <div><dt className="text-ink-500">Per year</dt><dd className="mt-0.5 font-mono text-sm font-bold">{l.annualised_pct ?? "–"}%</dd></div>
        <div><dt className="text-ink-500">Due in</dt><dd className="mt-0.5 font-mono text-sm font-bold">{l.days_to_due} d</dd></div>
      </dl>
      <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-signal-600"><CheckCircle2 className="h-3.5 w-3.5" />Verified by the buyer's wallet{l.extra_verified && " · extra-verified"}</p>
      <div className="mt-auto flex gap-2 pt-5"><button className="btn btn-ghost flex-1" onClick={() => onOpen(l)}>Details</button>{canFund && <button className="btn btn-signal flex-1" onClick={() => onFund(l)}><Coins className="h-4 w-4" />Fund</button>}</div>
    </article>
  );
}

export default function Marketplace() {
  const { user } = useApp();
  const { data, error, loading, reload } = useAsync(() => api("/marketplace"), []);
  const fund = useFund();
  const [tier, setTier] = useState("ALL");
  const [sort, setSort] = useState("yield");
  const [sel, setSel] = useState(null);
  const canFund = user.role === "financier" && user.status === "active";
  const rows = useMemo(() => {
    let r = (data?.listings || []).filter((l) => tier === "ALL" || l.risk.tier === tier);
    const key = { yield: (l) => -(l.annualised_pct || 0), due: (l) => l.days_to_due, size: (l) => -l.advance_amount, risk: (l) => l.risk.score }[sort];
    return [...r].sort((a, b) => key(a) - key(b));
  }, [data, tier, sort]);
  return (
    <>
      <PageHeader title="Financing marketplace" subtitle="Invoices confirmed by their buyers and waiting for funding. You pay a discount today and receive the full amount when the buyer repays." />
      <div className="mb-5"><Notice title="Test environment">You are funding with tUSD, a worthless test token on the Sepolia network. The AI risk score is advisory; read the factors before you fund.</Notice></div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select className="input !w-auto" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Risk filter"><option value="ALL">All risk levels</option><option value="LOW">Low risk</option><option value="MEDIUM">Medium risk</option></select>
        <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="yield">Highest annual return</option><option value="due">Soonest due</option><option value="size">Largest</option><option value="risk">Lowest risk</option></select>
        <span className="ml-auto text-sm text-ink-500">{rows.length} listing{rows.length === 1 ? "" : "s"}</span>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : rows.length === 0 ? <div className="card"><Empty icon={Store} title="No invoices are seeking funding right now" body="When a supplier requests financing for a verified invoice, it appears here." /></div> : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{rows.map((l) => <Card key={l.id} l={l} canFund={canFund} onOpen={setSel} onFund={(x) => fund({ ...x }, reload)} />)}</div>)}
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.invoice_number || ""} wide>
        {sel && (<div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Invoice value", `${money(sel.amount)} tUSD`], ["Advance rate", `${(sel.advance_bps || 0) / 100}%`], ["Due date", dateOnly(sel.due_date)], ["Invoice token", `#${sel.token_id}`]].map(([k, v]) => <div key={k} className="rounded-xl bg-paper p-3"><p className="text-xs text-ink-500">{k}</p><p className="mt-0.5 font-bold">{v}</p></div>)}</div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm"><span className="flex items-center gap-2 text-ink-500">Supplier <Addr a={sel.supplier_wallet} /></span><span className="flex items-center gap-2 text-ink-500">Buyer <Addr a={sel.buyer_wallet} /></span></div>
          <div><h3 className="mb-2 flex items-center gap-2 font-bold">AI risk assessment <TierBadge tier={sel.risk.tier} score={sel.risk.score} /></h3>{sel.summary && <p className="mb-3 text-sm leading-relaxed text-ink-700">{sel.summary}</p>}<FactorList factors={sel.risk.factors} /><p className="mt-3 text-xs text-ink-500">{sel.risk.disclaimer}</p></div>
          <div className="flex justify-end gap-2"><Link className="btn btn-ghost" to={`/app/invoices/${sel.id}`}>Open full page</Link>{canFund && <button className="btn btn-signal" onClick={() => { const x = sel; setSel(null); fund({ ...x }, reload); }}><Coins className="h-4 w-4" />Fund {money(sel.advance_amount)} tUSD</button>}</div>
        </div>)}
      </Modal>
    </>
  );
}
