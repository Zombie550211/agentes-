"""
POST /api/ai/chat — asistente de IA del CRM (solo lectura, v1).

Ver ai_assistant.py para el catálogo de tools y el porqué de la arquitectura
(las tools reutilizan en proceso la lógica de leads/ranking/equipo, heredando los
mismos permisos por rol/equipo/mercado que ya usa el resto del CRM).
"""
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional

from deps import current_user
import ai_assistant
import realtime

router = APIRouter(tags=["Asistente IA"])


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = None


@router.post("/api/ai/chat")
async def ai_chat(body: ChatBody, user: dict = Depends(current_user)):
    history = [h.model_dump() for h in (body.history or [])]

    async def event_gen():
        yield realtime.event_payload({"type": "connected"})
        async for event in ai_assistant.ask_stream(body.message, history, user):
            yield realtime.event_payload(event)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
