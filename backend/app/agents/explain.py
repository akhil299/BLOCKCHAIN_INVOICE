"""Plain-English explanation of an analysis. Gemini when available, deterministic template otherwise."""
from typing import Any, Dict

from app.agents.llm import llm

SYSTEM = ("You explain invoice risk results to small-business users in 3-4 short sentences. "
          "Use ONLY the facts provided. Never call an invoice fraudulent; call these 'indicators'. Do not invent numbers.")


def template_summary(risk: Dict[str, Any], elig: Dict[str, Any]) -> str:
    top = [f for f in risk.get("factors", []) if f.get("points", 0) > 0 or f.get("severity") == "critical"][:3]
    reasons = "; ".join(f["title"].lower() for f in top) or "no unusual patterns were found"
    return (f"Risk score {risk.get('score')}/100 ({risk.get('tier', '').lower()} risk). Main factors: {reasons}. "
            f"{risk.get('recommended_action', '')} {elig.get('recommendation', '')}").strip()


async def run_summary(state) -> Dict[str, Any]:
    risk, elig = state.get("risk") or {}, state.get("eligibility") or {}
    text = None
    if llm().available:
        facts = {"score": risk.get("score"), "tier": risk.get("tier"),
                 "factors": [{"title": f["title"], "detail": f["detail"], "points": f["points"]} for f in risk.get("factors", [])[:6]],
                 "eligibility": elig.get("recommendation")}
        text = await llm().generate(f"Facts: {facts}\nWrite the explanation.", SYSTEM)
    return {"summary": (text or template_summary(risk, elig)).strip()}
