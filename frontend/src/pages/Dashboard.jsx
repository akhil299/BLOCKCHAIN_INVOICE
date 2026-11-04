import { Link, Navigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Banknote, CheckCircle2, Clock, FileText, HandCoins, Landmark, ShieldAlert, Store, Upload, XCircle } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { STATUS, TIER } from "../lib/constants";
import { money } from "../lib/format";
import { ErrorBox, Loading, PageHeader, Stat } from "../components/ui";
import { TierBadge } from "../components/StatusBadge";

const TONE_COLOR = { slate: "#94A3B8", blue: "#0EA5E9", amber: "#D98E04", teal: "#12B5A6", indigo: "#6366F1", green: "#12A150", red: "#D6455D" };

export function StatusChart({ by }) {
  const data = Object.entries(by || {}).map(([k, v]) => ({ key: k, name: STATUS[k]?.label || k, value: v, color: TONE_COLOR[STATUS[k]?.tone] || "#94A3B8" }));
  if (!data.length) return <p className="py-10 text-center text-sm text-ink-500">No invoices yet.</p>;
  return (
    <div className="h-64" role="img" aria-label="Invoices by status">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 16, right: 16 }}>
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94A3B8" />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fontWeight: 600 }} stroke="#94A3B8" />
          <Tooltip cursor={{ fill: "#F3F6FB" }} />
          <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={18}>{data.map((d) => <Cell key={d.key} fill={d.color} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Supplier({ d }) {
  return (
    <>
      <PageHeader title="Your invoices at a glance" subtitle="Upload an invoice, let the AI screen it, and get paid before the due date." actions={<Link to="/app/upload" className="btn btn-primary"><Upload className="h-4 w-4" />Upload invoice</Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total invoices" value={d.total} icon={FileText} hint={`${d.draft} draft`} />
        <Stat label="Pending verification" value={d.pending_verification} icon={Clock} tone="amber" hint="Waiting for the buyer" />
        <Stat label="Financed" value={d.financed} icon={CheckCircle2} tone="green" hint={`${d.awaiting_funding} awaiting funding`} />
        <Stat label="Rejected" value={d.rejected} icon={XCircle} tone="red" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2"><h2 className="mb-2 font-bold">Invoices by status</h2><StatusChart by={d.by_status} /></div>
        <div className="space-y-4">
          <Stat label="Total financing received" value={<>{money(d.financing_received)} <span className="text-base font-semibold text-ink-500">tUSD</span></>} icon={Banknote} tone="signal" />
          <div className="card p-5"><h2 className="mb-3 flex items-center gap-2 font-bold"><ShieldAlert className="h-4 w-4 text-risk-medium" />AI risk alerts</h2>
            {d.risk_alerts.length === 0 ? <p className="text-sm text-ink-500">No alerts. Your invoices look ordinary.</p> :
              <ul className="space-y-2.5">{d.risk_alerts.map((a) => (<li key={a.id}><Link to={`/app/invoices/${a.id}`} className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-paper-100"><span className="truncate text-sm font-semibold">{a.invoice_number || a.id}</span><TierBadge tier={a.tier} score={a.score} /></Link></li>))}</ul>}
          </div>
        </div>
      </div>
    </>
  );
}

function Buyer({ d }) {
  return (
    <>
      <PageHeader title="Invoices addressed to you" subtitle="Confirm invoices that are genuine, reject the ones that are not." actions={d.pending > 0 && <Link to="/app/invoices" className="btn btn-primary">Review {d.pending} pending <ArrowRight className="h-4 w-4" /></Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending invoices" value={d.pending} icon={Clock} tone="amber" hint="Need your decision" />
        <Stat label="Verified" value={d.verified} icon={CheckCircle2} tone="green" />
        <Stat label="Rejected" value={d.rejected} icon={XCircle} tone="red" />
        <Stat label="To repay" value={`${money(d.amount_to_repay)}`} icon={Banknote} tone="signal" hint={`${d.to_repay} financed invoice(s)`} />
      </div>
      <div className="card mt-4 p-6"><h2 className="mb-2 font-bold">Invoice history</h2><StatusChart by={d.by_status} /></div>
    </>
  );
}

function Financier({ d }) {
  return (
    <>
      <PageHeader title="Your funding overview" subtitle="Browse verified invoices and track what you have funded." actions={<Link to="/app/marketplace" className="btn btn-primary"><Store className="h-4 w-4" />Open marketplace</Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Available requests" value={d.available} icon={Store} tone="signal" hint="Verified, seeking funding" />
        <Stat label="Approved financings" value={d.approved} icon={HandCoins} />
        <Stat label="Funds deployed" value={`${money(d.funds_deployed)}`} icon={Landmark} hint="tUSD" />
        <Stat label="Returns earned" value={`${money(d.returns_earned)}`} icon={Banknote} tone="green" hint={`${d.repaid} repaid`} />
      </div>
      <div className="card mt-4 p-6"><h2 className="mb-2 font-bold">Your portfolio by status</h2><StatusChart by={d.by_status} /></div>
    </>
  );
}

export default function Dashboard() {
  const { user } = useApp();
  const { data, error, loading, reload } = useAsync(() => api("/dashboard"), []);
  if (user.role === "admin") return <Navigate to="/app/admin" replace />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (user.role === "financier" && user.status === "pending") return <div className="card p-8 text-center"><AlertTriangle className="mx-auto mb-3 h-8 w-8 text-risk-medium" /><h1 className="text-xl font-bold">Awaiting approval</h1><p className="mt-2 text-sm text-ink-500">An administrator must approve your financier account before you can fund invoices.</p></div>;
  return { supplier: <Supplier d={data} />, buyer: <Buyer d={data} />, financier: <Financier d={data} /> }[user.role];
}
