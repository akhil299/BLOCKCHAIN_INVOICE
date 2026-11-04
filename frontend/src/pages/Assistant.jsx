import { useEffect, useRef, useState } from "react";
import { Bot, Database, Send, Sparkles, User } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { PageHeader } from "../components/ui";

const SUGGEST = {
  supplier: ["What is the status of my latest invoice?", "Why was my invoice flagged?", "How many invoices are pending?", "Which invoices have been financed?", "Is my invoice eligible for financing?", "What does my AI risk score mean?", "Explain the blockchain transaction"],
  buyer: ["How many invoices are pending?", "What does my AI risk score mean?", "What is the status of my latest invoice?", "Explain the blockchain transaction"],
  financier: ["Which invoices have been financed?", "What does my AI risk score mean?", "Explain the blockchain transaction", "How many invoices are pending?"],
  admin: ["How many invoices are flagged?", "What does my AI risk score mean?", "Why was my latest invoice flagged?"],
};

function Text({ t }) {
  return <div className="space-y-1.5 text-[0.95rem] leading-relaxed">{t.split("\n").map((l, i) => l.startsWith("- ") ? <p key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" /><span className="min-w-0 break-words">{l.slice(2)}</span></p> : l ? <p key={i} className="break-words">{l}</p> : null)}</div>;
}

export default function Assistant() {
  const { user, config } = useApp();
  const [msgs, setMsgs] = useState([{ role: "assistant", content: `Hi ${user.name.split(" ")[0]}! I answer from your real invoices and the blockchain. I never guess. Ask me about status, risk, eligibility or transactions.` }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  const send = async (q) => {
    const message = (q ?? text).trim();
    if (!message || busy) return;
    setText(""); setBusy(true);
    const history = msgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: message }]);
    try {
      const r = await api("/assistant/chat", { method: "POST", body: { message, history } });
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, mode: r.mode, tools: r.tools_used, note: r.note }]);
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: e.message, error: true }]); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="AI assistant" subtitle="Ask about your invoices in plain English." actions={<span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold ring-1 ring-line"><Sparkles className="h-3.5 w-3.5 text-signal-600" />{config?.aiMode === "gemini" ? "Powered by Gemini" : "Built-in rules (no API key set)"}</span>} />
      <div className="card flex h-[calc(100vh-17rem)] min-h-[440px] flex-col overflow-hidden">
        <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={clsx("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", m.role === "user" ? "bg-ink text-white" : "bg-signal-100 text-signal-600")}>{m.role === "user" ? <User className="h-[18px] w-[18px]" /> : <Bot className="h-[18px] w-[18px]" />}</span>
              <div className={clsx("max-w-[85%] rounded-2xl px-4 py-3", m.role === "user" ? "bg-ink text-white" : m.error ? "bg-rose-50 text-rose-800" : "bg-paper")}>
                <Text t={m.content} />
                {m.tools?.length > 0 && <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[0.7rem] font-semibold text-ink-500"><Database className="h-3 w-3" />Looked up: {m.tools.map((t) => <span key={t} className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-line">{t}</span>)}</p>}
                {m.note && <p className="mt-2 text-[0.7rem] text-ink-500">{m.note}</p>}
              </div>
            </div>
          ))}
          {busy && <div className="flex gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-signal-100 text-signal-600"><Bot className="h-[18px] w-[18px]" /></span><div className="flex items-center gap-1.5 rounded-2xl bg-paper px-4 py-4" aria-label="Assistant is typing">{[0, 1, 2].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-ink-500/50" style={{ animationDelay: `${d * 120}ms` }} />)}</div></div>}
          <div ref={end} />
        </div>
        <div className="border-t border-line p-4">
          {msgs.length < 3 && <div className="mb-3 flex flex-wrap gap-2">{(SUGGEST[user.role] || []).map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:border-signal hover:text-signal-600">{s}</button>)}</div>}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
            <input className="input" placeholder="Ask about an invoice, e.g. “status of INV-2026-0142”" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} aria-label="Message" />
            <button className="btn btn-primary shrink-0" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      </div>
    </>
  );
}
