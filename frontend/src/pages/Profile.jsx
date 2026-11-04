import { useState } from "react";
import { Coins, Loader2, LogOut, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useToast } from "../context/Toasts";
import { ROLE_LABEL, chainName } from "../lib/constants";
import { money } from "../lib/format";
import { Field, Mono, Notice, PageHeader } from "../components/ui";

export default function Profile() {
  const { user, setUser, wallet, balances, config, chainId, runTx, logout, refreshBalances } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ name: user.name, company: user.company, email: user.email || "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api("/auth/me", { method: "PATCH", body: { name: f.name, company: f.company, email: f.email || null } }); setUser(r.user); toast.push({ tone: "success", title: "Profile saved" }); }
    catch (x) { toast.push({ tone: "error", title: "Could not save", body: x.message }); } finally { setBusy(false); }
  };
  const faucet = () => runTx({ title: "Claim test tUSD", sync: false, success: "10,000 tUSD added to your wallet.", send: ({ usd }) => usd.faucet() }).then(() => refreshBalances());
  const syncRole = async () => { try { const r = await api("/auth/me/sync-role", { method: "POST" }); setUser(r.user); toast.push({ tone: r.user.chain_role_synced ? "success" : "error", title: r.user.chain_role_synced ? "On-chain role is active" : "Role sync failed", body: r.user.chain_role_error }); } catch (x) { toast.push({ tone: "error", title: "Could not sync", body: x.message }); } };
  const needsRole = ["supplier", "financier"].includes(user.role) && !user.chain_role_synced && user.status === "active";
  const c = config?.chain?.contracts;
  return (
    <>
      <PageHeader title="Profile & wallet" subtitle="Your account, your wallet and your test tokens." />
      <div className="grid gap-5 lg:grid-cols-5">
        <form onSubmit={save} className="card space-y-4 p-6 lg:col-span-3">
          <h2 className="font-bold">Account</h2>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Name" htmlFor="pn"><input id="pn" className="input" required minLength={2} value={f.name} onChange={set("name")} /></Field><Field label="Company" htmlFor="pc"><input id="pc" className="input" required minLength={2} value={f.company} onChange={set("company")} /></Field></div>
          <Field label="Email" htmlFor="pe"><input id="pe" type="email" className="input" value={f.email} onChange={set("email")} /></Field>
          <dl className="grid gap-3 rounded-xl bg-paper p-4 text-sm sm:grid-cols-3"><div><dt className="text-ink-500">Role</dt><dd className="font-bold">{ROLE_LABEL[user.role]}</dd></div><div><dt className="text-ink-500">Status</dt><dd className="font-bold capitalize">{user.status}</dd></div><div><dt className="text-ink-500">Contract role</dt><dd className="font-bold">{user.role === "buyer" || user.role === "admin" ? "Not needed" : user.chain_role_synced ? "Active" : "Pending"}</dd></div></dl>
          {needsRole && <Notice tone="warn" title="On-chain role not active yet">Your wallet needs a role on the smart contract before it can transact. It is granted automatically after registration. <button type="button" className="font-semibold underline" onClick={syncRole}>Retry now</button>{user.chain_role_error && <span className="mt-1 block text-xs">{user.chain_role_error}</span>}</Notice>}
          <div className="flex justify-between gap-3"><button type="button" className="btn btn-ghost" onClick={logout}><LogOut className="h-4 w-4" />Sign out</button><button className="btn btn-primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</button></div>
        </form>
        <div className="space-y-5 lg:col-span-2">
          <div className="card p-6"><h2 className="mb-4 font-bold">Wallet</h2>
            <dl className="space-y-3 text-sm"><div><dt className="text-ink-500">Address</dt><dd><Mono copy={wallet}>{wallet}</Mono></dd></div><div className="flex justify-between"><dt className="text-ink-500">Network</dt><dd className="font-semibold">{chainName(chainId)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">ETH (gas)</dt><dd className="font-mono font-semibold">{balances.eth == null ? "–" : balances.eth.toFixed(5)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">tUSD (test)</dt><dd className="font-mono font-semibold">{money(balances.tusd)}</dd></div></dl>
            <button className="btn btn-signal mt-5 w-full" onClick={faucet}><Coins className="h-4 w-4" />Get 10,000 test tUSD</button>
            <p className="mt-2 text-xs text-ink-500">Once per day. Gas needs free Sepolia ETH from a public faucet; tUSD has no real value.</p>
            <button className="btn btn-ghost mt-3 w-full !py-2" onClick={refreshBalances}><RefreshCw className="h-4 w-4" />Refresh balances</button></div>
          <div className="card p-6"><h2 className="mb-3 font-bold">Platform</h2>
            <dl className="space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-ink-500">Registry</dt><dd><Mono copy={c?.InvoiceRegistry}>{c?.InvoiceRegistry?.slice(0, 18)}…</Mono></dd></div><div className="flex justify-between gap-3"><dt className="text-ink-500">Invoice token</dt><dd><Mono copy={c?.InvoiceToken}>{c?.InvoiceToken?.slice(0, 18)}…</Mono></dd></div><div className="flex justify-between gap-3"><dt className="text-ink-500">tUSD</dt><dd><Mono copy={c?.TestUSD}>{c?.TestUSD?.slice(0, 18)}…</Mono></dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Document storage</dt><dd className="font-semibold">{config?.ipfsMode === "mock" ? "Local (IPFS off)" : `IPFS (${config?.ipfsMode})`}</dd></div><div className="flex justify-between"><dt className="text-ink-500">AI engine</dt><dd className="font-semibold">{config?.aiMode === "gemini" ? "Gemini + rules" : "Rules only"}</dd></div></dl></div>
        </div>
      </div>
    </>
  );
}
