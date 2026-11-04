import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Search, Upload } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { STATUS } from "../lib/constants";
import { dateOnly, money } from "../lib/format";
import { Empty, ErrorBox, Loading, PageHeader, Tabs } from "../components/ui";
import { StatusBadge, TierBadge } from "../components/StatusBadge";

export default function Invoices() {
  const { user } = useApp();
  const { data, error, loading, reload } = useAsync(() => api("/invoices"), []);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const all = data?.invoices || [];
  const tabs = useMemo(() => {
    const act = user.role === "buyer" ? ["PENDING_VERIFICATION"] : user.role === "supplier" ? ["DRAFT", "PENDING_VERIFICATION"] : ["FLAGGED"];
    const groups = [{ value: "all", label: "All", count: all.length }, { value: "active", label: "In progress", count: all.filter((i) => !["CLOSED", "REJECTED", "CANCELLED"].includes(i.status)).length },
      { value: "action", label: user.role === "admin" ? "Needs review" : "Needs attention", count: all.filter((i) => act.includes(i.status)).length }, { value: "done", label: "Closed", count: all.filter((i) => ["CLOSED", "REJECTED", "CANCELLED"].includes(i.status)).length }];
    return { groups, act };
  }, [all, user.role]);
  const rows = all.filter((i) => {
    if (tab === "active" && ["CLOSED", "REJECTED", "CANCELLED"].includes(i.status)) return false;
    if (tab === "action" && !tabs.act.includes(i.status)) return false;
    if (tab === "done" && !["CLOSED", "REJECTED", "CANCELLED"].includes(i.status)) return false;
    const s = q.trim().toLowerCase();
    return !s || [i.invoice_number, i.buyer_name, i.supplier_name].some((x) => (x || "").toLowerCase().includes(s));
  });
  const title = { supplier: "My invoices", buyer: "Invoices to verify", admin: "All invoices", financier: "Invoices" }[user.role];
  return (
    <>
      <PageHeader title={title} subtitle={user.role === "buyer" ? "Open an invoice to verify or reject it with your wallet." : "Track every invoice and its status on the blockchain."}
        actions={user.role === "supplier" && <Link to="/app/upload" className="btn btn-primary"><Upload className="h-4 w-4" />Upload invoice</Link>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={tabs.groups} value={tab} onChange={setTab} />
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" /><input className="input !pl-9" placeholder="Search number or company" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" /></div>
      </div>
      <div className="card overflow-hidden">
        {loading ? <Loading /> : error ? <div className="p-4"><ErrorBox message={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <Empty icon={FileText} title={all.length ? "Nothing matches your filters" : "No invoices yet"} body={all.length ? "Try a different tab or search." : user.role === "supplier" ? "Upload your first invoice to get started." : "Invoices addressed to you will appear here."} action={!all.length && user.role === "supplier" && <Link to="/app/upload" className="btn btn-primary">Upload invoice</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-line bg-paper/60"><tr><th className="th">Invoice</th><th className="th">{user.role === "supplier" ? "Buyer" : "Supplier"}</th><th className="th text-right">Amount (tUSD)</th><th className="th">Due</th><th className="th">AI risk</th><th className="th">Status</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((i) => (
                  <tr key={i.id} className="hover:bg-paper/60">
                    <td className="td"><Link to={`/app/invoices/${i.id}`} className="font-mono font-semibold text-ink hover:text-signal-600">{i.invoice_number || i.id}</Link>{i.chain_id && <span className="ml-2 text-xs text-ink-500">#{i.chain_id}</span>}</td>
                    <td className="td">{user.role === "supplier" ? i.buyer_name : i.supplier_name}</td>
                    <td className="td text-right font-mono font-semibold">{money(i.amount)}</td>
                    <td className="td whitespace-nowrap text-ink-500">{dateOnly(i.due_date)}</td>
                    <td className="td"><TierBadge tier={i.analysis?.risk?.tier} score={i.analysis?.risk?.score} /></td>
                    <td className="td"><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
