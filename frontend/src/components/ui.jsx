import { useEffect } from "react";
import { AlertTriangle, Check, Copy, Inbox, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { useState } from "react";
import { short } from "../lib/format";

export function Spinner({ className }) { return <Loader2 className={clsx("animate-spin text-signal", className || "h-5 w-5")} aria-label="Loading" />; }

export function Loading({ label = "Loading…" }) {
  return <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-500"><Spinner />{label}</div>;
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div className="card flex items-start gap-3 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1"><p className="font-semibold">Something went wrong</p><p className="mt-0.5">{message}</p></div>
      {onRetry && <button className="btn btn-ghost !py-1.5" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, body, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-paper-100 text-ink-500"><Icon className="h-6 w-6" /></div>
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold tracking-tight sm:text-[1.7rem]">{title}</h1>{subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-500">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone = "ink" }) {
  const tones = { ink: "bg-ink text-white", signal: "bg-signal-100 text-signal-600", amber: "bg-amber-100 text-amber-700", red: "bg-rose-100 text-rose-700", green: "bg-emerald-100 text-emerald-700" };
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        {Icon && <span className={clsx("grid h-9 w-9 place-items-center rounded-xl", tones[tone])}><Icon className="h-[18px] w-[18px]" /></span>}
      </div>
      <p className="mt-3 text-[1.65rem] font-bold leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-2 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-risk-high">{error}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/55 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx("card max-h-[90vh] w-full overflow-y-auto p-6 shadow-pop", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-paper-100" aria-label="Close"><X className="h-5 w-5" /></button></div>
        {children}
      </div>
    </div>
  );
}

export function Mono({ children, className, copy }) {
  const [done, setDone] = useState(false);
  return (
    <span className={clsx("inline-flex max-w-full items-center gap-1.5 font-mono text-[0.8rem]", className)}>
      <span className="truncate" title={typeof children === "string" ? children : undefined}>{children}</span>
      {copy && (
        <button className="shrink-0 text-ink-500 hover:text-signal-600" aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(copy); setDone(true); setTimeout(() => setDone(false), 1200); }}>
          {done ? <Check className="h-3.5 w-3.5 text-risk-low" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}

export const Addr = ({ a }) => (a ? <Mono copy={a}>{short(a, 6, 4)}</Mono> : <span className="text-ink-500">–</span>);

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-white p-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={clsx("rounded-lg px-3.5 py-1.5 text-sm font-semibold transition", value === t.value ? "bg-ink text-white" : "text-ink-500 hover:text-ink")}>
          {t.label}{t.count != null && <span className={clsx("ml-1.5 text-xs", value === t.value ? "text-white/70" : "text-ink-500/70")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = "info", title, children }) {
  const t = { info: "border-signal/30 bg-signal-50 text-ink", warn: "border-amber-300 bg-amber-50 text-amber-900", error: "border-rose-200 bg-rose-50 text-rose-900" }[tone];
  return <div className={clsx("rounded-xl border p-4 text-sm", t)}>{title && <p className="mb-1 font-semibold">{title}</p>}{children}</div>;
}
