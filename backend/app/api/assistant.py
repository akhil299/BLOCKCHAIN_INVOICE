from typing import Dict, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.agents.assistant import chat
from app.core.security import current_user

router = APIRouter(prefix="/assistant", tags=["assistant"])


class ChatReq(BaseModel):
    message: str = Field(min_length=1, max_length=600)
    history: List[Dict[str, str]] = []


@router.post("/chat")
async def assistant_chat(req: ChatReq, user: dict = Depends(current_user)):
    return await chat(user, req.message, req.history)
