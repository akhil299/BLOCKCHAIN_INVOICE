from typing import Any, Dict, List, Optional, TypedDict


class AnalysisState(TypedDict, total=False):
    # inputs
    invoice: Dict[str, Any]          # id, supplier_wallet, buyer_wallet, status, chain_id, doc_hash ...
    file_bytes: Optional[bytes]
    mime: Optional[str]
    fields: Dict[str, Any]           # provided when the user corrected/confirmed the data (skips OCR)
    fields_confirmed: bool
    # agent outputs
    extraction: Dict[str, Any]
    fraud: Dict[str, Any]
    risk: Dict[str, Any]
    eligibility: Dict[str, Any]
    summary: str
    trace: List[Dict[str, Any]]
    fatal: Optional[str]
