import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Check, FileUp, Loader2, PenLine, ScanText, Sparkles } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { useApp } from "../context/Auth";
import { useAsync } from "../lib/hooks";
import { Field, Notice, PageHeader } from "../components/ui";
import RiskPanel from "../components/RiskPanel";
import InvoiceActions from "../components/InvoiceActions";
import { StatusBadge } from "../components/StatusBadge";

const STEPS = ["Upload", "Review details", "AI check & register"];
const EMPTY = { invoice_number: "", supplier_name: "", buyer_name: "", buyer_wallet: "", amount: "", currency: "USD", invoice_date: "", due_date: "", description: "" };

function Stepper({ step }) {
  return (
    <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 items-center gap-3">
          <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold", i < step ? "bg-signal text-white" : i === step ? "bg-ink text-white ring-4 ring-signal/25" : "bg-white text-ink-500 ring-1 ring-line")}>{i < step ? <Check className="h-4 w-4" /> : i + 1}</span>
          <span className={clsx("hidden text-sm font-semibold sm:block", i === step ? "text-ink" : "text-ink-500")}>{s}</span>
          {i < STEPS.length - 1 && <span className={clsx("h-0.5 flex-1 rounded", i < step ? "bg-signal" : "bg-line")} />}
        </li>
      ))}
    </ol>
  );
}

function Conf({ c }) {
  if (c == null) return null;
  return <span className={clsx("ml-2 rounded-full px-2 py-0.5 text-[0.68rem] font-bold", c >= 0.8 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>{c >= 0.8 ? "read OK" : "please check"}</span>;
}

export default function InvoiceUpload() {
  const { user } = useApp();
  const buyers = useAsync(() => api("/users/buyers"), []);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [inv, setInv] = useState(null);
  const [form, setForm] = useState({ ...EMPTY, supplier_name: user.company });
  const [conf, setConf] = useState({});
  const [warn, setWarn] = useState([]);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const list = buyers.data?.buyers || [];

  const onFile = useCallback(async (file) => {
    if (!file) return;
    setErr(null);
    if (file.size > 10 * 1024 * 1024) return setErr("That file is larger than 10 MB.");
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) return setErr("Upload a PDF, PNG or JPEG file.");
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await api("/invoices/extract", { method: "POST", form: fd });
      const i = res.invoice, ex = i.analysis?.extraction || {};
      setInv(i); setConf(ex.confidence || {}); setWarn([...(ex.warnings || []), ...(res.duplicate_document_of ? ["This exact file has already been uploaded. It will be treated as a duplicate."] : [])]);
      setForm({ ...EMPTY, supplier_name: i.supplier_name || user.company, invoice_number: i.invoice_number || "", buyer_name: i.buyer_name || "", buyer_wallet: i.buyer_wallet || "", amount: i.amount ?? "", currency: i.currency || "USD", invoice_date: i.invoice_date || "", due_date: i.due_date || "", description: i.description || "" });
      setStep(1);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, [user.company]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pickBuyer = (e) => { const b = list.find((x) => x.wallet === e.target.value); setForm((f) => ({ ...f, buyer_wallet: e.target.value, buyer_name: b ? b.company : f.buyer_name })); };
  const missing = ["invoice_number", "supplier_name", "buyer_wallet", "amount", "invoice_date", "due_date"].filter((k) => !String(form[k] ?? "").trim());

  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const body = { ...form, amount: Number(form.amount), description: form.description || null };
    try {
      const res = inv ? await api(`/invoices/${inv.id}`, { method: "PUT", body }) : await api("/invoices/manual", { method: "POST", body });
      setInv(res.invoice); setStep(2);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const refresh = async () => { const r = await api(`/invoices/${inv.id}`); setInv(r.invoice); };

  return (
    <>
      <PageHeader title="Upload an invoice" subtitle="We read the invoice, you confirm the details, the AI agents screen it, then you register it on the blockchain." />
      <Stepper step={step} />

      {step === 0 && (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            {mode === "upload" ? (
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
                className={clsx("card flex min-h-[320px] flex-col items-center justify-center border-2 border-dashed p-8 text-center transition", drag ? "border-signal bg-signal-50" : "border-line")}>
                {busy ? (<><Loader2 className="mb-4 h-10 w-10 animate-spin text-signal" /><p className="font-bold">Reading your invoice…</p><p className="mt-1 text-sm text-ink-500">Extracting text, encrypting the file and running the AI checks.</p></>) : (<>
                  <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-ink text-white"><FileUp className="h-7 w-7" /></div>
                  <p className="text-lg font-bold">Drop your invoice here</p><p className="mt-1 text-sm text-ink-500">PDF, PNG or JPEG · up to 10 MB</p>
                  <button className="btn btn-primary mt-5" onClick={() => input.current?.click()}>Choose a file</button>
                  <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="sr-only" onChange={(e) => onFile(e.target.files[0])} aria-label="Invoice file" />
                  <p className="mt-6 text-sm text-ink-500">No file? <button className="font-semibold text-signal-600 hover:underline" onClick={() => { setMode("manual"); setInv(null); setStep(1); }}>Enter the details manually</button></p>
                </>)}
              </div>
            ) : null}
            {err && <div className="mt-4"><Notice tone="error">{err}</Notice></div>}
          </div>
          <aside className="space-y-4 lg:col-span-2">
            <div className="card p-5"><h3 className="mb-3 flex items-center gap-2 font-bold"><ScanText className="h-4 w-4 text-signal-600" />What happens to your file</h3>
              <ol className="space-y-2.5 text-sm text-ink-500">{["Text is read from the PDF or scanned with OCR.", "The file is encrypted, then stored on IPFS. Only a hash goes on the blockchain.", "AI agents check for duplicates, date errors and unusual amounts.", "Nothing is final until you confirm the details and sign in your wallet."].map((t, i) => <li key={i} className="flex gap-2.5"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />{t}</li>)}</ol></div>
            <Notice title="Try the sample invoices">The project ships realistic test invoices in the <span className="font-mono">samples/</span> folder: a clean one, a duplicate, and a suspicious one.</Notice>
          </aside>
        </div>
      )}

      {step === 1 && (
        <form onSubmit={submit} className="grid gap-5 lg:grid-cols-5">
          <div className="card p-6 lg:col-span-3">
            <h2 className="mb-1 flex items-center gap-2 font-bold"><PenLine className="h-4 w-4" />Review and correct the details</h2>
            <p className="mb-5 text-sm text-ink-500">{inv ? "Fields marked “please check” were hard to read." : "Enter the invoice details exactly as they appear on your invoice."}</p>
            {warn.length > 0 && <div className="mb-5 space-y-2">{warn.map((w, i) => <Notice key={i} tone="warn"><span className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</span></Notice>)}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={<>Invoice number<Conf c={conf.invoice_number} /></>} htmlFor="invno"><input id="invno" required className="input font-mono" value={form.invoice_number} onChange={set("invoice_number")} maxLength={40} /></Field>
              <Field label={<>Amount (USD)<Conf c={conf.amount} /></>} htmlFor="amt" hint="Treated as tUSD on the test network."><input id="amt" required type="number" min="0.01" step="0.01" className="input font-mono" value={form.amount} onChange={set("amount")} /></Field>
              <Field label={<>Invoice date<Conf c={conf.invoice_date} /></>} htmlFor="idate"><input id="idate" required type="date" className="input" value={form.invoice_date} onChange={set("invoice_date")} /></Field>
              <Field label={<>Due date<Conf c={conf.due_date} /></>} htmlFor="ddate"><input id="ddate" required type="date" className="input" value={form.due_date} onChange={set("due_date")} /></Field>
              <Field label={<>Supplier name<Conf c={conf.supplier_name} /></>} htmlFor="sup"><input id="sup" required className="input" value={form.supplier_name} onChange={set("supplier_name")} /></Field>
              <Field label={<>Buyer name<Conf c={conf.buyer_name} /></>} htmlFor="buyn"><input id="buyn" required className="input" value={form.buyer_name} onChange={set("buyer_name")} /></Field>
              <div className="sm:col-span-2"><Field label="Buyer on InvoChain" htmlFor="buyw" hint="The buyer must be registered. Only this wallet can verify the invoice.">
                <select id="buyw" required className="input" value={form.buyer_wallet} onChange={pickBuyer}><option value="">Select the buyer…</option>{list.map((b) => <option key={b.wallet} value={b.wallet}>{b.company} · {b.name}</option>)}</select></Field>
                {!buyers.loading && list.length === 0 && <p className="mt-2 text-xs font-medium text-risk-medium">No buyers are registered yet. Ask the buyer to sign up with their own wallet first.</p>}</div>
              <div className="sm:col-span-2"><Field label={<>Description of goods or services<Conf c={conf.description} /></>} htmlFor="desc"><textarea id="desc" rows={2} className="input" maxLength={500} value={form.description} onChange={set("description")} /></Field></div>
            </div>
            {err && <div className="mt-5"><Notice tone="error">{err}</Notice></div>}
            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => { setStep(0); setMode("upload"); setErr(null); }}>Start over</button>
              <button className="btn btn-primary" disabled={busy || missing.length > 0}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Confirm & run AI check</button>
            </div>
            {missing.length > 0 && <p className="mt-3 text-right text-xs text-ink-500">Still needed: {missing.map((m) => m.replace("_", " ")).join(", ")}</p>}
          </div>
          <aside className="lg:col-span-2">
            {inv?.analysis?.extraction && <div className="card p-5"><h3 className="mb-3 font-bold">How we read it</h3>
              <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-ink-500">Method</dt><dd className="font-semibold">{inv.analysis.extraction.method === "pdf-text" ? "PDF text layer" : inv.analysis.extraction.method === "ocr" ? "OCR (Tesseract)" : inv.analysis.extraction.method}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">OCR confidence</dt><dd className="font-mono font-semibold">{Math.round((inv.analysis.extraction.ocr_confidence || 0) * 100)}%</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Missing fields</dt><dd className="font-semibold">{inv.analysis.extraction.missing_fields.length || "none"}</dd></div></dl></div>}
          </aside>
        </form>
      )}

      {step === 2 && inv && (
        <div className="space-y-5">
          <div className="card flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="font-mono text-lg font-bold">{inv.invoice_number}</p><p className="text-sm text-ink-500">{inv.supplier_name} → {inv.buyer_name}</p></div><StatusBadge status={inv.status} /></div>
          <div className="card p-6"><h2 className="mb-5 font-bold">AI risk assessment</h2><RiskPanel analysis={inv.analysis} /></div>
          <div className="card p-6"><h2 className="mb-4 font-bold">Next: put it on the blockchain</h2>
            <p className="mb-4 text-sm text-ink-500">You'll sign one transaction in MetaMask. It records the document fingerprint, not the document. After that, the AI result is anchored and you can submit the invoice to the buyer.</p>
            <InvoiceActions invoice={inv} onChanged={refresh} /></div>
          <button className="btn btn-ghost" onClick={() => { setStep(0); setInv(null); setMode("upload"); setForm({ ...EMPTY, supplier_name: user.company }); }}>Upload another invoice</button>
        </div>
      )}
    </>
  );
}
