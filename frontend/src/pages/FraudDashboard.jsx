import { useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Bot, ChevronDown, Cpu, ShieldAlert, ShieldCheck, Siren } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import clsx from "clsx";
import { api } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { TIER } from "../lib/constants";
import { money } from "../lib/format";
import { Empty, ErrorBox, Loading, Notice, PageHeader, Stat } from "../components/ui";
import { StatusBadge, TierBadge } from "../components/StatusBadge";

export default function FraudDashboard() {
  const { data: d, error, loading, reload } = useAsync(() => api("/ai/overview"), []);
  const [open, setOpen] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const pie = ["LOW", "MEDIUM", "HIGH"].map((t) => ({ name: TIER[t].label, value: d.tiers[t] || 0, color: TIER[t].color }));
  const hist = d.histogram.map((v, i) => ({ range: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}`, count: v, color: i < 3.5 ? "#12A150" : i < 7 ? "#D98E04" : "#D6455D" }));
  const high = d.tiers.HIGH || 0;
  return (
    <>
      <PageHeader title="AI fraud & risk insights" subtitle="How the agents scored your invoices. These are screening indicators, not accusations." />
      <div className="mb-5"><Notice title="Indicators, not verdicts">The fraud and risk agents highlight invoices that look unusual or inconsistent. A high score sends the invoice to a human reviewer; it is never proof of fraud and the AI cannot approve or move money.</Notice></div>
      {d.total === 0 ? <div className="card"><Empty icon={ShieldCheck} title="No analysed invoices yet" body="Once invoices are uploaded, their AI analysis appears here." /></div> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Invoices analysed" value={d.total} icon={Activity} />
            <Stat label="Average risk score" value={d.average_score} icon={ShieldCheck} tone="signal" hint="0 = ordinary, 100 = very unusual" />
            <Stat label="High-risk (held)" value={high} icon={Siren} tone="red" />
            <Stat label="Medium-risk" value={d.tiers.MEDIUM || 0} icon={ShieldAlert} tone="amber" hint="Need extra verification" />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="card p-6"><h2 className="mb-2 font-bold">Risk tiers</h2>
              <div className="h-56"><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" innerRadius={52} outerRadius={84} paddingAngle={3} stroke="none">{pie.map((p) => <Cell key={p.name} fill={p.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
              <ul className="mt-2 space-y-1.5 text-sm">{pie.map((p) => <li key={p.name} className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.name}</span><b className="font-mono">{p.value}</b></li>)}</ul></div>
            <div className="card p-6"><h2 className="mb-2 font-bold">Score distribution</h2>
              <div className="h-64"><ResponsiveContainer><BarChart data={hist} margin={{ left: -20, right: 8 }}><XAxis dataKey="range" tick={{ fontSize: 10 }} stroke="#94A3B8" /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#94A3B8" /><Tooltip cursor={{ fill: "#F3F6FB" }} /><Bar dataKey="count" radius={[6, 6, 0, 0]}>{hist.map((h, i) => <Cell key={i} fill={h.color} />)}</Bar></BarChart></ResponsiveContainer></div></div>
            <div className="card p-6"><h2 className="mb-3 font-bold">Most common indicators</h2>
              {d.top_signals.length === 0 ? <p className="text-sm text-ink-500">No indicators triggered.</p> : <ul className="space-y-3">{d.top_signals.map((s) => <li key={s.title}><div className="mb-1 flex justify-between text-sm"><span className="font-semibold">{s.title}</span><b className="font-mono">{s.count}</b></div><div className="h-1.5 rounded-full bg-paper-100"><div className="h-full rounded-full bg-ink" style={{ width: `${(s.count / d.top_signals[0].count) * 100}%` }} /></div></li>)}</ul>}</div>
          </div>
          <div className="card mt-4 overflow-hidden">
            <div className="border-b border-line p-5"><h2 className="font-bold">Recent analyses</h2></div>
            <ul className="divide-y divide-line">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <button className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-paper/60" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-mono text-sm font-bold text-white" style={{ background: TIER[r.tier].color }}>{r.score}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-mono text-sm font-semibold">{r.invoice_number || r.id}</span><span className="block truncate text-xs text-ink-500">{r.supplier_name} · {money(r.amount)} tUSD</span></span>
                    <span className="hidden sm:block"><TierBadge tier={r.tier} /></span><StatusBadge status={r.status} /><ChevronDown className={clsx("h-4 w-4 text-ink-500 transition", open === r.id && "rotate-180")} />
                  </button>
                  {open === r.id && <div className="bg-paper/60 px-5 pb-5 pt-1"><p className="flex gap-2 text-sm leading-relaxed"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-signal-600" />{r.summary}</p><Link className="mt-3 inline-block text-sm font-semibold text-signal-600 hover:underline" to={`/app/invoices/${r.id}`}>Open full explanation →</Link></div>}
                </li>
              ))}
            </ul>
          </div>
          <div className="card mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 p-5 text-sm"><Cpu className="h-5 w-5 text-ink-500" /><span><b>Model:</b> {d.model.algorithm} ({d.model.version})</span><span><b>Trained on:</b> {d.model.trained_on} data, {d.model.samples.toLocaleString()} samples</span><span className="text-ink-500">{d.model.note}</span></div>
        </>
      )}
    </>
  );
}
