import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { short } from "../lib/format";

const Ctx = createContext(null);
export const useToast = () => useContext(Ctx);

const ICON = {
  info: <Loader2 className="h-5 w-5 animate-spin text-signal" />,
  success: <CheckCircle2 className="h-5 w-5 text-risk-low" />,
  error: <AlertTriangle className="h-5 w-5 text-risk-high" />,
  note: <Info className="h-5 w-5 text-ink-500" />,
};

export function ToastProvider({ children, explorerTxUrl }) {
  const [items, setItems] = useState([]);
  const timers = useRef({});
  const idRef = useRef(1);

  const dismiss = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const arm = useCallback((id, ms) => {
    clearTimeout(timers.current[id]);
    if (ms) timers.current[id] = setTimeout(() => dismiss(id), ms);
  }, [dismiss]);

  const push = useCallback((t) => {
    const id = idRef.current++;
    setItems((xs) => [...xs, { tone: "note", ...t, id }]);
    if (!t.sticky) arm(id, t.tone === "error" ? 9000 : 5000);
    return id;
  }, [arm]);

  const update = useCallback((id, patch) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (!patch.sticky) arm(id, patch.tone === "error" ? 10000 : 6000);
  }, [arm]);

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto card flex gap-3 p-4 shadow-pop">
            <div className="mt-0.5">{ICON[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 break-words text-sm text-ink-500">{t.body}</p>}
              {t.hash && (
                <p className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-ink-500">
                  {explorerTxUrl ? (
                    <a href={explorerTxUrl + t.hash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-signal-600 hover:underline">
                      {short(t.hash, 10, 8)} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span title={t.hash}>{short(t.hash, 10, 8)}</span>
                  )}
                </p>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className={clsx("h-6 w-6 shrink-0 rounded-md text-ink-500 hover:bg-paper-100")} aria-label="Dismiss">
              <X className="mx-auto h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
