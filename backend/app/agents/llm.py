"""Gemini access through LangChain, designed for the FREE tier:
 * never required - every caller has a deterministic fallback,
 * rate-limited and cached so the daily/minute quotas are not burned,
 * PII is redacted before text leaves the server (free-tier prompts may be used by Google to improve products).
"""
import asyncio
import hashlib
import json
import logging
import re
import time
from collections import OrderedDict
from typing import Optional

from app.core.config import get_settings

log = logging.getLogger("invochain.llm")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)")
_LONGNUM = re.compile(r"\b\d{9,}\b")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b")
_URL = re.compile(r"https?://\S+")


def redact(text: str) -> str:
    for rx, rep in ((_EMAIL, "[email]"), (_URL, "[url]"), (_IBAN, "[iban]"), (_LONGNUM, "[number]")):
        text = rx.sub(rep, text)
    return _PHONE.sub(lambda m: m.group(0) if re.fullmatch(r"[\d.,/\- ]{1,12}", m.group(0)) else "[phone]", text)


class LLM:
    def __init__(self) -> None:
        self._last = 0.0
        self._lock = asyncio.Lock()
        self._cache: "OrderedDict[str, str]" = OrderedDict()
        self._model = None
        self.last_error: Optional[str] = None

    @property
    def available(self) -> bool:
        s = get_settings()
        return bool(s.llm_enabled and s.gemini_api_key)

    def _get_model(self):
        if self._model is None:
            from langchain_google_genai import ChatGoogleGenerativeAI

            s = get_settings()
            self._model = ChatGoogleGenerativeAI(model=s.gemini_model, google_api_key=s.gemini_api_key,
                                                 temperature=0.2, max_retries=1, timeout=40)
        return self._model

    def chat_model(self):
        """Raw LangChain chat model (used by the tool-calling assistant)."""
        return self._get_model()

    async def generate(self, prompt: str, system: str = "", cache: bool = True) -> Optional[str]:
        if not self.available:
            return None
        key = hashlib.sha256((system + "\x00" + prompt).encode()).hexdigest()
        if cache and key in self._cache:
            return self._cache[key]
        try:
            from langchain_core.messages import HumanMessage, SystemMessage

            async with self._lock:
                wait = get_settings().llm_min_interval_seconds - (time.monotonic() - self._last)
                if wait > 0:
                    await asyncio.sleep(wait)
                msgs = ([SystemMessage(content=system)] if system else []) + [HumanMessage(content=prompt)]
                res = await self._get_model().ainvoke(msgs)
                self._last = time.monotonic()
            text = res.content if isinstance(res.content, str) else "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in res.content)
            self.last_error = None
            if cache:
                self._cache[key] = text
                if len(self._cache) > 256:
                    self._cache.popitem(last=False)
            return text
        except Exception as e:  # noqa: BLE001 - quota/network errors must never break the app
            self.last_error = f"{type(e).__name__}: {str(e)[:160]}"
            log.warning("Gemini call failed (falling back to rules): %s", self.last_error)
            return None

    async def generate_json(self, prompt: str, system: str = "") -> Optional[dict]:
        text = await self.generate(prompt + "\n\nReturn ONLY valid JSON, no markdown fences.", system)
        if not text:
            return None
        text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", text, re.S)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    return None
        return None


_llm = LLM()


def llm() -> LLM:
    return _llm
