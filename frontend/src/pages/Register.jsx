import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Building2, Landmark, Loader2, Truck } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { short } from "../lib/format";
import { Field, Notice } from "../components/ui";
import { Logo } from "../components/Layout";

const ROLES = [
  { id: "supplier", icon: Truck, title: "Supplier", text: "I issue invoices and want to be paid early." },
  { id: "buyer", icon: Building2, title: "Buyer", text: "I receive invoices and confirm them before payment." },
  { id: "financier", icon: Landmark, title: "Financier", text: "I fund verified invoices from the marketplace.", note: "Needs administrator approval" },
];

export default function Register() {
  const { phase, wallet, refreshUser, logout } = useApp();
  const nav = useNavigate();
  const [role, setRole] = useState("supplier");
  const [f, setF] = useState({ name: "", company: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (phase === "ready") return <Navigate to="/app" replace />;
  if (phase !== "needs-role") return <Navigate to="/login" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api("/auth/register", { method: "POST", body: { role, name: f.name, company: f.company, email: f.email || null } }); await refreshUser(); nav("/app"); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-full bg-paper px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between"><Logo light={false} /><button onClick={logout} className="text-sm font-semibold text-ink-500 hover:text-ink">Use a different wallet</button></div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-ink-500">Wallet <span className="font-mono">{short(wallet, 8, 6)}</span> will be linked to this role. You can't change the role later.</p>
          <form onSubmit={submit} className="mt-6 space-y-6">
            <fieldset><legend className="label">I am a…</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {ROLES.map(({ id, icon: Icon, title, text, note }) => (
                  <label key={id} className={clsx("cursor-pointer rounded-xl border-2 p-4 transition", role === id ? "border-signal bg-signal-50" : "border-line hover:border-ink-500/40")}>
                    <input type="radio" name="role" value={id} checked={role === id} onChange={() => setRole(id)} className="sr-only" />
                    <Icon className={clsx("mb-3 h-6 w-6", role === id ? "text-signal-600" : "text-ink-500")} /><p className="font-bold">{title}</p><p className="mt-1 text-xs leading-relaxed text-ink-500">{text}</p>
                    {note && <p className="mt-2 text-xs font-semibold text-amber-700">{note}</p>}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" htmlFor="name"><input id="name" required minLength={2} className="input" value={f.name} onChange={set("name")} autoComplete="name" /></Field>
              <Field label="Company" htmlFor="company" hint={role === "buyer" ? "Suppliers find you by this name." : undefined}><input id="company" required minLength={2} className="input" value={f.company} onChange={set("company")} autoComplete="organization" /></Field>
            </div>
            <Field label="Email (optional)" htmlFor="email"><input id="email" type="email" className="input" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
            {err && <Notice tone="error">{err}</Notice>}
            <button className="btn btn-primary w-full !py-3" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create account</button>
          </form>
        </div>
      </div>
    </div>
  );
}
