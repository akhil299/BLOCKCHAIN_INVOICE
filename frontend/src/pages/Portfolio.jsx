import { Link } from "react-router-dom";
import { Banknote, Coins, Hourglass, Landmark, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { dateOnly, money } from "../lib/format";
import { Empty, ErrorBox, Loading, PageHeader, Stat } from "../components/ui";
import { StatusBadge, TierBadge } from "../components/StatusBadge";

export default function Portfolio() {
  const { runTx } = useApp();
  const { data, error, loading, reload } = useAsync(() => api("/marketplace/portfolio"), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const rows = data.funded;
  const deployed = rows.reduce((s, r) => s + (r.advance_amount || 0), 0);
  const active = rows.filter((r) => ["FINANCED", "REPAID"].includes(r.status));
  const repaid = rows.filter((r) => ["REPAID", "CLOSED"].includes(r.status));
  const earned = repaid.reduce((s, r) => s + (r.amount - (r.advance_amount || 0)), 0);
  const settle = (r) => runTx({ title: "Confirm settlement", success: "Invoice settled and its token burned.", send: ({ registry }) => registry.markAsPaid(r.chain_id) }).then((h) => h && reload());
  return (
    <>
      <PageHeader title="My portfolio" subtitle="Every invoice you have funded, with repayment progress." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Funds deployed" value={money(deployed)} icon={Landmark} hint="tUSD advanced" />
        <Stat label="Active financing" value={active.length} icon={Hourglass} tone="amber" />
        <Stat label="Repaid invoices" value={repaid.length} icon={ShieldCheck} tone="green" />
        <Stat label="Returns earned" value={money(earned)} icon={Banknote} tone="signal" hint="tUSD" />
      </div>
      <div className="card mt-5 overflow-hidden">
        {rows.length === 0 ? <Empty icon={Coins} title="You haven't funded any invoices yet" body="Browse verified invoices in the marketplace." action={<Link className="btn btn-primary" to="/app/marketplace">Open marketplace</Link>} /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[860px]">
            <thead className="border-b border-line bg-paper/60"><tr><th className="th">Invoice</th><th className="th text-right">Advanced</th><th className="th text-right">Owed</th><th className="th">Repayment</th><th className="th">Due</th><th className="th">Risk</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r) => {
              const p = r.repay_amount ? Math.min(100, ((r.repaid_amount || 0) / r.amount) * 100) : 0;
              return (<tr key={r.id} className="hover:bg-paper/60">
                <td className="td"><Link to={`/app/invoices/${r.id}`} className="font-mono font-semibold hover:text-signal-600">{r.invoice_number}</Link><p className="text-xs text-ink-500">{r.supplier_name}</p></td>
                <td className="td text-right font-mono">{money(r.advance_amount)}</td><td className="td text-right font-mono font-semibold">{money(r.amount)}</td>
                <td className="td"><div className="w-36"><div className="h-2 overflow-hidden rounded-full bg-paper-100"><div className="h-full rounded-full bg-signal rail-fill" style={{ width: `${p}%` }} /></div><p className="mt-1 text-xs text-ink-500">{money(r.repaid_amount || 0)} of {money(r.amount)}</p></div></td>
                <td className="td whitespace-nowrap text-ink-500">{dateOnly(r.due_date)}</td><td className="td"><TierBadge tier={r.risk.tier} /></td><td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right">{r.status === "REPAID" && <button className="btn btn-primary !py-1.5" onClick={() => settle(r)}>Confirm settlement</button>}</td>
              </tr>);
            })}</tbody></table></div>)}
      </div>
    </>
  );
}
