import { useEffect } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, Fingerprint, KeyRound, Loader2, Wallet } from "lucide-react";
import { useApp } from "../context/Auth";
import { hasWallet } from "../lib/chain";
import { chainName } from "../lib/constants";
import { Logo } from "../components/Layout";
import { Notice } from "../components/ui";

export default function Login() {
  const { phase, connect, wallet, wrongNetwork, fixNetwork, requiredChain, config, configError } = useApp();
  const busy = phase === "connecting" || phase === "signing" || phase === "boot";
  if (phase === "ready") return <Navigate to="/app" replace />;
  if (phase === "needs-role") return <Navigate to="/register" replace />;
  const steps = [
    [Wallet, "Connect MetaMask", "Choose the account you want to use."],
    [Fingerprint, "Sign a free message", "Proves the wallet is yours. No gas, no transaction."],
    [KeyRound, "Pick your role", "Supplier, buyer or financier (first time only)."],
  ];
  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_1.1fr]">
      <div className="hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/"><Logo /></Link>
        <div>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">Your wallet is your login.</h1>
          <ul className="mt-10 space-y-6">{steps.map(([Icon, t, d]) => (<li key={t} className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10"><Icon className="h-5 w-5 text-signal" /></span><div><p className="font-bold">{t}</p><p className="text-sm text-white/65">{d}</p></div></li>))}</ul>
        </div>
        <p className="text-sm text-white/55">InvoChain never asks for your seed phrase or private key.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo light={false} /></div>
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">Connect your wallet to continue.</p>
          <div className="mt-6 space-y-4">
            {!hasWallet() && <Notice tone="warn" title="MetaMask is not installed">Install the <a className="font-semibold underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask extension</a> and reload this page.</Notice>}
            {configError && <Notice tone="error" title="Server unreachable">{configError}</Notice>}
            {wrongNetwork && <Notice tone="warn" title={`Switch to ${chainName(requiredChain)}`}>Your wallet is on a different network. <button className="font-semibold underline" onClick={fixNetwork}>Switch now</button></Notice>}
            <button onClick={connect} disabled={busy || !hasWallet()} className="btn btn-primary w-full !py-3.5 text-base">
              {busy ? <><Loader2 className="h-5 w-5 animate-spin" />{phase === "signing" ? "Check MetaMask to sign…" : "Connecting…"}</> : <><Wallet className="h-5 w-5" />Connect with MetaMask</>}
            </button>
            {phase === "signing" && <p className="flex items-center gap-2 text-sm text-ink-500"><CheckCircle2 className="h-4 w-4 text-risk-low" />Wallet connected. Sign the message to finish.</p>}
            <p className="text-center text-xs text-ink-500">Testnet only: {config ? chainName(config.requiredChainId) : "…"} · no real money</p>
          </div>
        </div>
      </div>
    </div>
  );
}
