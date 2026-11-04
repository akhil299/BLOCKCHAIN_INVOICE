import { useState } from "react";
import { NavLink, Outlet, Navigate, useLocation, Link } from "react-router-dom";
import clsx from "clsx";
import { Bot, Boxes, ChevronDown, FileText, Gauge, LayoutDashboard, LogOut, Menu, ReceiptText, Search, ShieldAlert, ShieldCheck, Store, Upload, User, Wallet, X, Coins } from "lucide-react";
import { useApp } from "../context/Auth";
import { ROLE_LABEL, chainName } from "../lib/constants";
import { money, short } from "../lib/format";
import { Loading, Notice } from "./ui";

export function Logo({ light = true, className }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5 text-lg font-extrabold tracking-tight", light ? "text-white" : "text-ink", className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden><rect width="32" height="32" rx="8" fill={light ? "#12B5A6" : "#0A1B3D"} /><path d="M9 10h14M9 16h14M9 22h8" stroke={light ? "#0A1B3D" : "#12B5A6"} strokeWidth="2.6" strokeLinecap="round" /><circle cx="23" cy="22" r="2.4" fill={light ? "#0A1B3D" : "#fff"} /></svg>
      InvoChain
    </span>
  );
}

const NAV = {
  supplier: [
    ["/app", "Dashboard", LayoutDashboard, true], ["/app/upload", "Upload invoice", Upload], ["/app/invoices", "My invoices", FileText],
    ["/app/fraud", "AI risk insights", ShieldAlert], ["/app/tokens", "Invoice tokens", Boxes], ["/app/transactions", "Transactions", ReceiptText], ["/app/assistant", "AI assistant", Bot],
  ],
  buyer: [
    ["/app", "Dashboard", LayoutDashboard, true], ["/app/invoices", "Invoices to verify", FileText], ["/app/fraud", "AI risk insights", ShieldAlert],
    ["/app/tokens", "Invoice tokens", Boxes], ["/app/transactions", "Transactions", ReceiptText], ["/app/assistant", "AI assistant", Bot],
  ],
  financier: [
    ["/app", "Dashboard", LayoutDashboard, true], ["/app/marketplace", "Marketplace", Store], ["/app/portfolio", "My portfolio", Coins], ["/app/fraud", "AI risk insights", ShieldAlert],
    ["/app/tokens", "Invoice tokens", Boxes], ["/app/transactions", "Transactions", ReceiptText], ["/app/assistant", "AI assistant", Bot],
  ],
  admin: [
    ["/app/admin", "Admin dashboard", LayoutDashboard, true], ["/app/invoices", "All invoices", FileText], ["/app/fraud", "AI risk insights", ShieldAlert],
    ["/app/tokens", "Invoice tokens", Boxes], ["/app/transactions", "Transactions", ReceiptText], ["/app/assistant", "AI assistant", Bot],
  ],
};

function Sidebar({ role, onNavigate }) {
  return (
    <nav className="flex h-full flex-col bg-ink-900 px-4 py-5 text-white" aria-label="Main">
      <Link to="/" className="mb-8 px-2"><Logo /></Link>
      <ul className="flex-1 space-y-1">
        {(NAV[role] || []).map(([to, label, Icon, end]) => (
          <li key={to}>
            <NavLink to={to} end={end} onClick={onNavigate}
              className={({ isActive }) => clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", isActive ? "bg-white/10 text-white shadow-[inset_3px_0_0_#12B5A6]" : "text-white/65 hover:bg-white/5 hover:text-white")}>
              <Icon className="h-[18px] w-[18px]" />{label}
            </NavLink>
          </li>
        ))}
      </ul>
      <NavLink to="/app/profile" onClick={onNavigate} className={({ isActive }) => clsx("mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold", isActive ? "bg-white/10" : "text-white/65 hover:bg-white/5 hover:text-white")}>
        <User className="h-[18px] w-[18px]" />Profile & wallet
      </NavLink>
      <p className="mt-4 rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-white/60">Test environment. Tokens and ETH on this network have no real-world value.</p>
    </nav>
  );
}

function NetworkPill() {
  const { config, chainId, wrongNetwork, fixNetwork, requiredChain } = useApp();
  if (wrongNetwork) return <button onClick={fixNetwork} className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"><span className="h-2 w-2 rounded-full bg-risk-high" />Wrong network · switch to {chainName(requiredChain)}</button>;
  const ok = config?.chain?.connected;
  return <span className={clsx("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1", ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200")}><span className={clsx("h-2 w-2 rounded-full", ok ? "bg-risk-low" : "bg-risk-medium")} />{ok ? `${chainName(chainId || requiredChain)} testnet` : "Blockchain offline"}</span>;
}

function Topbar({ onMenu }) {
  const { wallet, user, balances, logout } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/85 px-4 py-3 backdrop-blur sm:px-8">
      <button className="rounded-lg p-2 hover:bg-paper-100 lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      <NetworkPill />
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden items-center gap-4 rounded-xl border border-line px-3.5 py-1.5 text-xs sm:flex">
          <span><span className="text-ink-500">ETH </span><b className="font-mono">{balances.eth == null ? "–" : balances.eth.toFixed(4)}</b></span>
          <span className="h-4 w-px bg-line" />
          <span><span className="text-ink-500">tUSD </span><b className="font-mono">{balances.tusd == null ? "–" : money(balances.tusd, 0)}</b></span>
        </div>
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-1.5 hover:bg-paper-100" aria-haspopup="menu" aria-expanded={open}>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-xs font-bold text-white">{(user?.name || "?")[0]}</span>
            <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-bold">{user?.name}</span><span className="block font-mono text-[0.7rem] text-ink-500">{short(wallet, 6, 4)}</span></span>
            <ChevronDown className="h-4 w-4 text-ink-500" />
          </button>
          {open && (
            <div className="card absolute right-0 mt-2 w-56 p-1.5 shadow-pop" role="menu" onMouseLeave={() => setOpen(false)}>
              <p className="px-3 py-2 text-xs text-ink-500">{ROLE_LABEL[user?.role]} · {user?.company}</p>
              <Link to="/app/profile" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-paper-100" onClick={() => setOpen(false)}><Wallet className="h-4 w-4" />Profile & wallet</Link>
              <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-risk-high hover:bg-rose-50"><LogOut className="h-4 w-4" />Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function AppShell() {
  const { phase, user, config, configError } = useApp();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  if (phase === "boot" || phase === "connecting" || phase === "signing") return <div className="grid h-full place-items-center"><Loading label={phase === "signing" ? "Waiting for your signature…" : "Loading…"} /></div>;
  if (phase === "idle") return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (phase === "needs-role") return <Navigate to="/register" replace />;
  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block"><div className="fixed inset-y-0 w-64"><Sidebar role={user.role} /></div></aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-ink-900/60" onClick={() => setDrawer(false)} /><div className="absolute inset-y-0 left-0 w-72"><button className="absolute right-3 top-4 z-10 text-white" onClick={() => setDrawer(false)} aria-label="Close menu"><X /></button><Sidebar role={user.role} onNavigate={() => setDrawer(false)} /></div></div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setDrawer(true)} />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-7 sm:px-8">
          {(configError || (config && !config.chain?.connected)) && (
            <div className="mb-6"><Notice tone="warn" title="Blockchain connection unavailable">{configError || config.chain.error} You can browse existing data, but on-chain actions are disabled until this is fixed (see README, "Troubleshooting").</Notice></div>
          )}
          <Outlet key={loc.pathname} />
        </main>
      </div>
    </div>
  );
}
