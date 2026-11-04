import { useState } from "react";
import { Bot, CheckCircle2, ChevronDown, CircleAlert, Cpu, Info, ListChecks, XCircle } from "lucide-react";
import clsx from "clsx";
import RiskGauge from "./RiskGauge";
import { TIER } from "../lib/constants";

const SEV = { critical: "bg-rose-100 text-rose-700", warning: "bg-amber-100 text-amber-800", info: "bg-slate-100 text-slate-600" };

export function FactorList({ factors = [] }) {
  const shown = factors.filter((f) => f.points > 0 || f.severity === "critical");
  if (!shown.length) return <p className="flex items-center gap-2 text-sm text-ink-500"><CheckCircle2 className="h-4 w-4 text-risk-low" />No unusual indicators were found.</p>;
  const max = Math.max(...shown.map((f) => f.points), 1);
  return (
    <ul className="space-y-3">
      {shown.map((f) => (
        <li key={f.id} className="rounded-xl border border-line p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 text-sm font-semibold">{f.title}<span className={clsx("rounded-full px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide", SEV[f.severity])}>{f.source === "model" ? "AI model" : f.severity}</span></p><p className="mt-1 text-sm text-ink-500">{f.detail}</p></div>
            <span className="shrink-0 font-mono text-sm font-semibold">+{f.points}</span>
          </div>
          {f.points > 0 && <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-paper-100"><div className="h-full rounded-full bg-ink" style={{ width: `${(f.points / max) * 100}%` }} /></div>}
        </li>
      ))}
    </ul>
  );
}

export function Eligibility({ data }) {
  if (!data) return null;
  return (
    <div>
      <p className={clsx("mb-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold", data.eligible ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>{data.recommendation}</p>
      <ul className="space-y-1.5">
        {data.checks.map((c) => (
          <li key={c.name} className="flex items-start gap-2.5 text-sm">
            {c.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-risk-low" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-risk-high" />}
            <span><span className="font-semibold">{c.name}</span><span className="text-ink-500"> · {c.detail}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-500">{data.notice}</p>
    </div>
  );
}

/** Full, explainable AI result for one invoice. */
export default function RiskPanel({ analysis, compact }) {
  const [trace, setTrace] = useState(false);
  const risk = analysis?.risk;
  if (!risk) return <p className="text-sm text-ink-500">No AI analysis is available yet.</p>;
  const t = TIER[risk.tier];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-6">
        <RiskGauge score={risk.score} tier={risk.tier} size={compact ? 180 : 220} />
        <div className="min-w-[220px] flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink-500"><Bot className="h-4 w-4" />AI summary</p>
          <p className="mt-1.5 text-[0.95rem] leading-relaxed">{analysis.summary}</p>
          <p className="mt-3 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: t.color + "14", color: t.color }}>{risk.recommended_action}</p>
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-bold">Why this score</h3>
        <FactorList factors={risk.factors} />
        <div className="mt-3 grid gap-2 text-xs text-ink-500 sm:grid-cols-2">
          <p className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />Rules contributed <b className="font-mono text-ink">{risk.rule_points}</b> · model contributed <b className="font-mono text-ink">{risk.model_points}</b></p>
          <p className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" />{risk.model?.model_version}: trained on synthetic data</p>
        </div>
      </div>
      <div className="flex gap-2.5 rounded-xl bg-paper p-3.5 text-xs leading-relaxed text-ink-700"><Info className="mt-0.5 h-4 w-4 shrink-0" /><p>{risk.disclaimer}</p></div>
      {!compact && analysis.eligibility && (<div><h3 className="mb-3 text-sm font-bold">Financing eligibility</h3><Eligibility data={analysis.eligibility} /></div>)}
      {!compact && analysis.trace?.length > 0 && (
        <div>
          <button className="flex items-center gap-1.5 text-sm font-semibold text-ink-700" onClick={() => setTrace((v) => !v)} aria-expanded={trace}><ChevronDown className={clsx("h-4 w-4 transition", trace && "rotate-180")} />Agent trace ({analysis.trace.length} steps)</button>
          {trace && <ol className="mt-3 space-y-1.5 text-sm">{analysis.trace.map((s, i) => (<li key={i} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"><span className={clsx("h-2 w-2 rounded-full", s.status === "ok" ? "bg-risk-low" : "bg-risk-high")} /><span className="flex-1 font-semibold">{s.agent}</span><span className="font-mono text-xs text-ink-500">{s.ms} ms</span></li>))}</ol>}
        </div>
      )}
    </div>
  );
}
