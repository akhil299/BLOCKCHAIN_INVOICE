import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bot, Building2, Fingerprint, Landmark, Lock, ShieldCheck, Truck } from "lucide-react";
import { Logo } from "../components/Layout";
import LifecycleRail from "../components/LifecycleRail";
import { LIFECYCLE } from "../lib/constants";
import { useApp } from "../context/Auth";

/** The hero's single moving part: the sample invoice walks through its real lifecycle once. */
function TicketDemo() {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setStep(4); return; }
    let i = -1; const t = setInterval(() => { i += 1; setStep(Math.min(i, LIFECYCLE.length - 1)); if (i >= LIFECYCLE.length - 1) clearInterval(t); }, 950);
    return () => clearInterval(t);
  }, []);
  const status = step < 0 ? "CREATED" : LIFECYCLE[step];
  const money = step >= 4 ? "7,402.14" : "8,224.60";
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-signal/10 blur-2xl" aria-hidden />
      <div className="rounded-2xl bg-white p-6 text-ink shadow-pop">
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-semibold text-ink-500">Invoice</p><p className="font-mono text-lg font-semibold">INV-2026-0142</p></div>
          <div className="text-right"><p className="text-xs font-semibold text-ink-500">Acme Components → Globex Retail</p><p className="text-xs text-ink-500">Due in 54 days</p></div>
        </div>
        <div className="my-5 border-t border-dashed border-line" />
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-xs font-semibold text-ink-500">Invoice value</p><p className="text-2xl font-extrabold tracking-tight">8,224.60 <span className="text-sm font-semibold text-ink-500">tUSD</span></p></div>
          <div><p className="text-xs font-semibold text-ink-500">{step >= 4 ? "Paid to supplier today" : "Advance available (90%)"}</p>
            <p className="text-2xl font-extrabold tracking-tight text-signal-600">{step >= 4 ? money : "7,402.14"} <span className="text-sm font-semibold text-ink-500">tUSD</span></p></div>
        </div>
        <div className="mt-6"><LifecycleRail status={status} /></div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-inset ring-emerald-200">AI risk 5 / 100 · low</span>
          <span className="rounded-full bg-signal-50 px-3 py-1 text-signal-600 ring-1 ring-inset ring-signal/30">Buyer verified on-chain</span>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  ["Upload", "The supplier uploads a PDF or photo. Text is read automatically and can be corrected."],
  ["AI screening", "Agents look for duplicates, date errors and unusual amounts, then explain a 0–100 risk score."],
  ["Buyer confirms", "The named buyer verifies the invoice from their own wallet. Nobody can do it for them."],
  ["Token minted", "A unique invoice token and the document fingerprint are recorded on the blockchain."],
  ["Funded", "A financier picks the invoice from the marketplace and advances test tokens."],
  ["Repaid", "The buyer repays the financier and the contract settles the invoice."],
];

export default function Landing() {
  const { phase, connect } = useApp();
  const nav = useNavigate();
  const go = async () => { if (phase === "ready") nav("/app"); else nav("/login"); };
  return (
    <div className="min-h-full bg-paper">
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)", backgroundSize: "44px 44px" }} aria-hidden />
        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Logo />
          <nav className="flex items-center gap-3 text-sm font-semibold">
            <a href="#how" className="hidden text-white/70 hover:text-white sm:block">How it works</a>
            <a href="#safety" className="hidden text-white/70 hover:text-white sm:block">Safeguards</a>
            <button onClick={go} className="btn btn-signal">{phase === "ready" ? "Open dashboard" : "Sign in"}</button>
          </nav>
        </header>
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/85 ring-1 ring-white/15"><span className="h-1.5 w-1.5 rounded-full bg-signal" />Runs on the Sepolia test network. No real money.</p>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">Get paid today for invoices that are due in sixty days.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">InvoChain lets suppliers raise cash against unpaid invoices. AI screens every invoice, the buyer confirms it with their wallet, and a smart contract makes sure no invoice is ever financed twice.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button onClick={go} className="btn btn-signal !px-6 !py-3 text-base">Connect your wallet <ArrowRight className="h-4 w-4" /></button>
              <a href="#how" className="btn !px-6 !py-3 text-base text-white ring-1 ring-white/25 hover:bg-white/10">See how it works</a>
            </div>
          </div>
          <TicketDemo />
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-3xl font-extrabold tracking-tight">From invoice to cash in six steps</h2>
        <p className="mt-2 max-w-2xl text-ink-500">Each step is a real state in the smart contract, so everyone sees the same history.</p>
        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="card p-6"><span className="mb-4 grid h-9 w-9 place-items-center rounded-xl bg-ink text-sm font-bold text-white">{i + 1}</span><h3 className="font-bold">{t}</h3><p className="mt-1.5 text-sm leading-relaxed text-ink-500">{d}</p></li>
          ))}
        </ol>
      </section>

      <section id="safety" className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">Built so the risky parts can't be skipped</h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2">
            {[
              [Fingerprint, "Duplicates are blocked on-chain", "Every document fingerprint and invoice number is registered once. The contract refuses a second copy, whatever the app says."],
              [Bot, "AI advises, it never approves", "The risk score is a screening aid. High-risk invoices wait for a human; the AI cannot verify, fund or release money."],
              [Lock, "Documents stay private", "Files are encrypted before they reach IPFS. Only the blockchain gets a hash, never the invoice itself."],
              [ShieldCheck, "Your keys stay in your wallet", "InvoChain never sees a seed phrase or private key. You sign each transaction in MetaMask."],
            ].map(([Icon, t, d]) => (
              <div key={t} className="flex gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-signal-100 text-signal-600"><Icon className="h-5 w-5" /></span><div><h3 className="font-bold">{t}</h3><p className="mt-1 text-sm leading-relaxed text-ink-500">{d}</p></div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-3xl font-extrabold tracking-tight">Who uses InvoChain</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[[Truck, "Suppliers", "Upload invoices, see your AI risk score, and request funding without waiting for the due date."], [Building2, "Buyers", "Confirm or reject the invoices addressed to you, then repay on the due date."], [Landmark, "Financiers", "Browse verified invoices with risk explanations and fund the ones you like."]].map(([Icon, t, d]) => (
            <div key={t} className="card p-6"><Icon className="mb-4 h-7 w-7 text-ink-600" /><h3 className="font-bold">{t}</h3><p className="mt-1.5 text-sm leading-relaxed text-ink-500">{d}</p></div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line bg-white py-8 text-center text-sm text-ink-500">
        <Logo light={false} className="mb-3 !text-base" />
        <p className="mx-auto max-w-2xl px-6">InvoChain is an academic demonstration. It runs on the Sepolia test network with worthless test tokens and does not provide financial services.</p>
      </footer>
    </div>
  );
}
