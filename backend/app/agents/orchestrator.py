"""Central orchestrator: a LangGraph state machine that coordinates the specialised agents.

  START -> [extraction | skip when fields already confirmed] -> fraud -> risk -> eligibility -> summary -> END

Every step appends to `trace`, so each result can be explained and audited.
"""
import time
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict

from langgraph.graph import END, START, StateGraph

from app.agents.eligibility import run_eligibility
from app.agents.explain import run_summary
from app.agents.extraction import run_extraction
from app.agents.fraud import run_fraud
from app.agents.risk import run_risk
from app.agents.state import AnalysisState

VERSION = "invochain-agents-1.0"


def _traced(name: str, fn: Callable[[AnalysisState], Awaitable[Dict[str, Any]]]):
    async def node(state: AnalysisState) -> Dict[str, Any]:
        t0 = time.perf_counter()
        status, note = "ok", ""
        try:
            out = await fn(state)
        except Exception as e:  # noqa: BLE001
            out, status, note = {"fatal": f"{name} failed: {type(e).__name__}: {e}"}, "error", str(e)[:200]
        trace = list(state.get("trace") or [])
        trace.append({"agent": name, "status": status, "ms": int((time.perf_counter() - t0) * 1000), "note": note,
                      "at": datetime.utcnow().isoformat() + "Z"})
        return {**out, "trace": trace}

    return node


def _after_extraction(state: AnalysisState) -> str:
    return END if state.get("fatal") else "fraud_agent"


def build_graph():
    """Node names carry an _agent suffix because LangGraph forbids names that equal state keys."""
    g = StateGraph(AnalysisState)
    g.add_node("extraction_agent", _traced("Invoice Extraction Agent", run_extraction))
    g.add_node("fraud_agent", _traced("Fraud Detection Agent", run_fraud))
    g.add_node("risk_agent", _traced("Risk Assessment Agent", run_risk))
    g.add_node("eligibility_agent", _traced("Financing Eligibility Agent", run_eligibility))
    g.add_node("summary_agent", _traced("Explanation", run_summary))
    # extraction always runs first: for user-confirmed fields it only validates (no OCR)
    g.add_edge(START, "extraction_agent")
    g.add_conditional_edges("extraction_agent", _after_extraction, {"fraud_agent": "fraud_agent", END: END})
    g.add_conditional_edges("fraud_agent", lambda s: END if s.get("fatal") else "risk_agent", {"risk_agent": "risk_agent", END: END})
    g.add_conditional_edges("risk_agent", lambda s: END if s.get("fatal") else "eligibility_agent", {"eligibility_agent": "eligibility_agent", END: END})
    g.add_edge("eligibility_agent", "summary_agent")
    g.add_edge("summary_agent", END)
    return g.compile()


_graph = None


async def analyze(invoice: Dict[str, Any], *, file_bytes: bytes | None = None, mime: str | None = None,
                  fields: Dict[str, Any] | None = None, fields_confirmed: bool = False) -> Dict[str, Any]:
    """Runs the multi-agent workflow and returns the analysis document to store on the invoice."""
    global _graph
    if _graph is None:
        _graph = build_graph()
    final = await _graph.ainvoke({"invoice": invoice, "file_bytes": file_bytes, "mime": mime, "fields": fields or {},
                                  "fields_confirmed": fields_confirmed, "trace": []})
    return {
        "extraction": final.get("extraction"), "fraud": final.get("fraud"), "risk": final.get("risk"),
        "eligibility": final.get("eligibility"), "summary": final.get("summary"), "trace": final.get("trace"),
        "fatal": final.get("fatal"), "orchestrator_version": VERSION, "analyzed_at": datetime.utcnow().isoformat() + "Z",
    }
