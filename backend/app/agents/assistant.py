"""E. AI Assistant Agent. Gemini + tool calling when a key is configured; otherwise (or on any quota error)
a deterministic intent router answers from the SAME tools. Either way it only reports data retrieved by tools."""
import json
import re
from typing import Any, Dict, List

from app.agents.llm import llm
from app.agents.tools import Tools

SYSTEM = ("You are the InvoChain assistant. Answer ONLY using data returned by your tools; never invent invoice details, "
          "amounts, statuses or transaction hashes. If a tool returns an error or nothing, say so plainly. "
          "AI risk scores are indicators, not proof of fraud. Be concise and friendly. "
          "InvoChain runs on the Sepolia testnet with worthless test tokens.")


def _fmt_money(v) -> str:
    return f"{float(v):,.2f}" if v is not None else "n/a"


def _ref(msg: str, numbers: List[str]) -> str | None:
    low = re.sub(r"[^a-z0-9]", "", msg.lower())
    for n in sorted(numbers, key=len, reverse=True):
        nn = re.sub(r"[^a-z0-9]", "", (n or "").lower())
        if nn and nn in low:
            return n
    m = re.search(r"\b(inv_[0-9a-f]{12})\b", msg)
    return m.group(1) if m else None


_TOKEN = re.compile(r"(?<![\w/-])(?=[A-Za-z0-9/_-]*\d)(?=[A-Za-z0-9/_-]*[A-Za-z-])[A-Za-z0-9/_-]{4,}(?![\w/-])")


def _mentioned_number(msg: str) -> str | None:
    """An invoice-number-looking token in the message (letters+digits), e.g. INV-0001 or 2026/A-9917."""
    for m in _TOKEN.finditer(msg):
        t = m.group(0)
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", t) and not t.lower().startswith("0x"):
            return t
    return None


async def _rules(msg: str, tools: Tools) -> Dict[str, Any]:
    m = msg.lower()
    docs = (await tools.list_invoices())["invoices"]
    ref = _ref(msg, [d["invoice_number"] for d in docs if d.get("invoice_number")])
    used: List[str] = []
    asked = _mentioned_number(msg)
    if asked and not ref:
        return {"answer": f"I couldn't find an invoice matching '{asked}' among the invoices you can access, so I won't guess. Check the number or open the Invoices page.",
                "data": None, "tools_used": [], "mode": "rules"}

    def done(text, data=None):
        return {"answer": text, "data": data, "tools_used": used, "mode": "rules"}

    if re.search(r"what does.*(risk|score)|risk score mean|explain.*score|\bscore\b.*mean", m) and not ref:
        used.append("glossary")
        return done((await tools.glossary("risk score"))["explanation"])
    if re.search(r"why.*(flag|held|hold|risk|score|medium|high)|flag", m):
        used.append("explain_risk")
        r = await tools.explain_risk(ref)
        if "error" in r:
            return done(r["error"])
        lines = "\n".join(f"- {f['title']} ({f['points']} pts): {f['detail']}" for f in r["factors"] if f["points"] > 0) or "- No unusual indicators were found."
        return done(f"Invoice {r['invoice_number']} scored {r['score']}/100 ({r['tier'].lower()} risk), status {r['status']}.\nContributing factors:\n{lines}\n{r['recommended_action']}\n{r['disclaimer']}", r)
    if re.search(r"eligib|can i (get )?financ|qualif", m):
        used.append("check_eligibility")
        r = await tools.check_eligibility(ref)
        if "error" in r:
            return done(r["error"])
        lines = "\n".join(f"- {'PASS' if c['passed'] else 'FAIL'}: {c['check']} ({c['detail']})" for c in r["checks"])
        return done(f"Invoice {r['invoice_number']}: {'eligible' if r['eligible'] else 'not eligible yet'}.\n{lines}\n{r['recommendation']}", r)
    if re.search(r"blockchain|transaction|\btx\b|on-chain|onchain|hash|token", m):
        used.append("blockchain_info")
        r = await tools.blockchain_info(ref)
        if "error" in r:
            return done(r["error"])
        if not r["registered_on_chain"]:
            return done(f"Invoice {r['invoice_number']} is not registered on the blockchain yet. Its document hash is {r['document_hash']}.", r)
        tx = "\n".join(f"- {t['event']} in block {t['block']}: {t['hash']}" for t in r["transactions"]) or "- (no transactions recorded yet)"
        live = r.get("live_on_chain") or {}
        return done(f"Invoice {r['invoice_number']} is blockchain invoice #{r['blockchain_invoice_id']} (live on-chain status: {live.get('status', 'unavailable')}).\nDocument hash: {r['document_hash']}\nTransactions:\n{tx}", r)
    if re.search(r"how many|count|number of", m):
        used.append("count_by_status")
        r = await tools.count_by_status()
        st = next((s for s in ["pending", "financed", "rejected", "verified", "flagged", "draft", "repaid"] if s in m), None)
        if st:
            key = {"pending": "PENDING_VERIFICATION"}.get(st, st.upper())
            return done(f"You have {r['by_status'].get(key, 0)} invoice(s) with status {key} (of {r['total']} total).", r)
        return done(f"You have {r['total']} invoice(s): " + (", ".join(f"{v} {k}" for k, v in r["by_status"].items()) or "none yet") + ".", r)
    if re.search(r"financed|funded|which invoices", m):
        used.append("list_invoices")
        r = await tools.list_invoices("FINANCED")
        if not r["count"]:
            return done("None of your invoices are currently in FINANCED status.", r)
        return done(f"{r['count']} financed invoice(s):\n" + "\n".join(f"- {i['invoice_number']}: {_fmt_money(i['amount'])} tUSD, due {i['due_date']}" for i in r["invoices"]), r)
    if re.search(r"status|where is|track|update on|my invoice", m) or ref:
        used.append("get_invoice")
        r = await tools.get_invoice(ref)
        if "error" in r:
            return done(r["error"])
        extra = f" Note: {r['other_invoices_with_same_number']} other invoice(s) of yours share this number (e.g. drafts)." if r.get("other_invoices_with_same_number") else ""
        return done(f"Invoice {r['invoice_number']} is {r['status']}. Amount {_fmt_money(r['amount'])}, due {r['due_date']}, risk {r['risk_tier'] or 'n/a'} ({r['risk_score']}/100).{extra}", r)
    return done("I can help with: invoice status, why an invoice was flagged, how many are pending, which are financed, financing eligibility, what a risk score means, and blockchain transactions. Mention an invoice number for specifics.")


async def _agent(msg: str, history: List[Dict[str, str]], tools: Tools) -> Dict[str, Any] | None:
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
    from langchain_core.tools import StructuredTool
    from langgraph.prebuilt import create_react_agent

    wrapped = [StructuredTool.from_function(coroutine=getattr(tools, n), name=n, description=(getattr(tools, n).__doc__ or n))
               for n in ("count_by_status", "list_invoices", "get_invoice", "explain_risk", "check_eligibility", "blockchain_info", "glossary")]
    agent = create_react_agent(llm().chat_model(), wrapped, state_modifier=SYSTEM)
    msgs = [(h["role"], h["content"]) for h in history[-6:] if h.get("role") in ("user", "assistant")] + [("user", msg)]
    res = await agent.ainvoke({"messages": msgs}, {"recursion_limit": 8})
    out = res["messages"]
    used = [t.name for t in out if isinstance(t, ToolMessage)]
    final = next((m for m in reversed(out) if isinstance(m, AIMessage) and m.content), None)
    if not final:
        return None
    text = final.content if isinstance(final.content, str) else "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in final.content)
    return {"answer": text.strip(), "data": None, "tools_used": used, "mode": "gemini"} if text.strip() else None


async def chat(user: Dict[str, Any], message: str, history: List[Dict[str, str]] | None = None) -> Dict[str, Any]:
    tools = Tools(user)
    if llm().available:
        try:
            r = await _agent(message, history or [], tools)
            if r:
                return r
        except Exception as e:  # noqa: BLE001 - quota/network: degrade gracefully
            llm().last_error = f"{type(e).__name__}: {str(e)[:160]}"
    r = await _rules(message, tools)
    if llm().available:
        r["note"] = "Gemini was unavailable (quota or network), so this answer came from the built-in rules."
    return r
