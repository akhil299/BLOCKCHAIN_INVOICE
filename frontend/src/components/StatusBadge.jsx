import clsx from "clsx";
import { STATUS, TIER } from "../lib/constants";

const TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200", blue: "bg-sky-50 text-sky-700 ring-sky-200", amber: "bg-amber-50 text-amber-800 ring-amber-200",
  teal: "bg-signal-50 text-signal-600 ring-signal/30", indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200", green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: "slate" };
  return <span title={s.hint} className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", TONES[s.tone])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{s.label}</span>;
}

export function TierBadge({ tier, score }) {
  if (!tier) return <span className="text-xs text-ink-500">Not assessed</span>;
  const t = TIER[tier];
  return <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", t.soft)}>{t.label}{score != null && <span className="font-mono opacity-80">{score}</span>}</span>;
}
