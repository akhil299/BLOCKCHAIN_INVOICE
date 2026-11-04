import { useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Banknote, Check, FileText, Loader2, RefreshCw, ShieldAlert, Users, Ban } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { useToast } from "../context/Toasts";
import { EVENT_LABEL, ROLE_LABEL } from "../lib/constants";
import { dateTime, money } from "../lib/format";
import { Addr, Empty, ErrorBox, Loading, PageHeader, Stat, Tabs } from "../components/ui";
import { StatusBadge, TierBadge } from "../components/StatusBadge";
import { StatusChart } from "./Dashboard";

export default function Admin() {
  const toast = useToast();
  const stats = useAsync(() => api("/dashboard"), []);
  const users = useAsync(() => api("/admin/users"), []);
  const flagged = useAsync(() => api("/admin/flagged"), []);
  const txs = useAsync(() => api("/chain/txs"), []);
  const [tab, setTab] = useState("flagged");
  const [busy, setBusy] = useState(null);
  const reloadAll = () => { stats.reload(); users.reload(); flagged.reload(); txs.reload(); };
  const act = async (key, fn, ok) => { setBusy(key); try { await fn(); toast.push({ tone: "success", title: ok }); reloadAll(); } catch (e) { toast.push({ tone: "error", title: "Action failed", body: e.message }); } finally { setBusy(null); } };
  if (stats.loading) return <Loading />;
  if (stats.error) return <ErrorBox message={stats.error} onRetry={stats.reload} />;
  const d = stats.data;
  const pending = (users.data?.users || []).filter((u) => u.status === "pending");
  return (
    <>
      <PageHeader title="Administration" subtitle="Manage users, review held invoices and watch platform activity."
        actions={<button className="btn btn-ghost" onClick={() => act("rec", () => api("/chain/reconcile", { method: "POST" }), "Re-checked invoices against the blockchain")}>{busy === "rec" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Sync with blockchain</button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registered users" value={d.users} icon={Users} hint={Object.entries(d.users_by_role).map(([r, n]) => `${n} ${r}`).join(" · ")} />
        <Stat label="Total invoices" value={d.total} icon={FileText} tone="signal" />
        <Stat label="Flagged invoices" value={d.flagged} icon={ShieldAlert} tone="red" hint="Held for manual review" />
        <Stat label="Financing volume" value={money(d.volume_financed)} icon={Banknote} tone="green" hint={`${d.financed} financed · ${d.transactions} transactions`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-2"><h2 className="mb-2 font-bold">Invoices by status</h2><StatusChart by={d.by_status} /></div>
        <div className="card p-6"><h2 className="mb-3 flex items-center gap-2 font-bold"><Activity className="h-4 w-4" />Financing activity</h2>
          {(txs.data?.txs || []).slice(0, 7).map((t) => <div key={t.hash} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0"><span className="font-semibold">{EVENT_LABEL[t.kind] || t.kind}</span><span className="text-xs text-ink-500">{dateTime(t.at)}</span></div>)}
          {!(txs.data?.txs || []).length && <p className="text-sm text-ink-500">No transactions yet.</p>}
          <Link to="/app/transactions" className="mt-3 inline-block text-sm font-semibold text-signal-600 hover:underline">All transactions →</Link></div>
      </div>

      <div className="mt-6 mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: "flagged", label: "Review queue", count: flagged.data?.invoices.length }, { value: "users", label: "Users", count: users.data?.users.length }, ...(pending.length ? [{ value: "pending", label: "Approvals", count: pending.length }] : [])]} /></div>
      <div className="card overflow-hidden">
        {tab === "flagged" && (flagged.loading ? <Loading /> : flagged.data?.invoices.length === 0 ? <Empty icon={ShieldAlert} title="Nothing to review" body="High-risk invoices and medium-risk invoices needing extra verification appear here." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px]"><thead className="border-b border-line bg-paper/60"><tr><th className="th">Invoice</th><th className="th">Supplier</th><th className="th text-right">Amount</th><th className="th">AI risk</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{flagged.data.invoices.map((i) => <tr key={i.id} className="hover:bg-paper/60"><td className="td font-mono font-semibold">{i.invoice_number}</td><td className="td">{i.supplier_name}</td><td className="td text-right font-mono">{money(i.amount)}</td><td className="td"><TierBadge tier={i.analysis?.risk?.tier} score={i.analysis?.risk?.score} /></td><td className="td"><StatusBadge status={i.status} /></td><td className="td text-right"><Link className="btn btn-primary !py-1.5" to={`/app/invoices/${i.id}`}>Review</Link></td></tr>)}</tbody></table></div>))}
        {(tab === "users" || tab === "pending") && (users.loading ? <Loading /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px]"><thead className="border-b border-line bg-paper/60"><tr><th className="th">Name</th><th className="th">Company</th><th className="th">Role</th><th className="th">Wallet</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">{(tab === "pending" ? pending : users.data.users).map((u) => (
              <tr key={u.wallet} className="hover:bg-paper/60"><td className="td font-semibold">{u.name}</td><td className="td">{u.company}</td><td className="td">{ROLE_LABEL[u.role]}</td><td className="td"><Addr a={u.wallet} /></td>
                <td className="td"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${u.status === "active" ? "bg-emerald-50 text-emerald-700" : u.status === "pending" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>{u.status}</span></td>
                <td className="td"><div className="flex justify-end gap-2">
                  {u.status !== "active" && <button className="btn btn-signal !py-1.5" disabled={!!busy} onClick={() => act(u.wallet, () => api(`/admin/users/${u.wallet}/approve`, { method: "POST" }), "User approved")}>{busy === u.wallet ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve</button>}
                  {u.status !== "suspended" && u.role !== "admin" && <button className="btn btn-ghost !py-1.5" disabled={!!busy} onClick={() => confirm(`Suspend ${u.name}?`) && act(u.wallet, () => api(`/admin/users/${u.wallet}/suspend`, { method: "POST" }), "User suspended")}><Ban className="h-4 w-4" />Suspend</button>}</div></td></tr>))}</tbody></table></div>))}
      </div>
    </>
  );
}
