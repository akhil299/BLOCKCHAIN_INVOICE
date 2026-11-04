import clsx from "clsx";
import { Check } from "lucide-react";
import { LIFECYCLE, STATUS } from "../lib/constants";

const SIDE = new Set(["REJECTED", "FLAGGED", "CANCELLED", "DRAFT"]);

/** The invoice's journey: every on-chain state in order, with the current one highlighted. */
export default function LifecycleRail({ status, statusBeforeFlag }) {
  const effective = status === "FLAGGED" ? statusBeforeFlag : status;
  const idx = LIFECYCLE.indexOf(effective);
  const side = SIDE.has(status);
  return (
    <div>
      <ol className="flex items-start overflow-x-auto pb-1" aria-label="Invoice lifecycle">
        {LIFECYCLE.map((s, i) => {
          const done = idx > i || (status === "CLOSED" && i <= idx), current = idx === i && !side && status !== "CLOSED";
          return (
            <li key={s} className="relative flex min-w-[88px] flex-1 flex-col items-center text-center">
              {i > 0 && <span className={clsx("absolute right-1/2 top-[13px] h-0.5 w-full rail-fill", done || current || (idx >= i) ? "bg-signal" : "bg-line")} aria-hidden />}
              <span className={clsx("relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-bold",
                done ? "border-signal bg-signal text-white" : current ? "border-ink bg-ink text-white ring-4 ring-signal/25" : "border-line bg-white text-ink-500")}>
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={clsx("mt-2 px-1 text-[0.72rem] leading-tight", current ? "font-bold text-ink" : done ? "font-semibold text-ink-700" : "text-ink-500")}>{STATUS[s].label}</span>
            </li>
          );
        })}
      </ol>
      {side && status !== "DRAFT" && (
        <p className={clsx("mt-3 rounded-lg px-3 py-2 text-sm font-medium", status === "CANCELLED" ? "bg-slate-100 text-slate-700" : "bg-rose-50 text-rose-700")}>
          {STATUS[status].label}: {STATUS[status].hint}.
        </p>
      )}
      {status === "DRAFT" && <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">Draft: not registered on the blockchain yet.</p>}
    </div>
  );
}
