"""Endpoint SSE (Server-Sent Events) para tiempo real.

GET /api/stream?channel=residencial|lineas

El navegador (EventSource) abre una conexión persistente y recibe un aviso cada
vez que cambian los datos del canal; entonces el frontend re-ejecuta su función
de carga sin recargar la página. Ver realtime.py para el broker pub/sub.
"""
import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse

import realtime

router = APIRouter(tags=["Realtime"])

# Cada cuántos segundos enviar un comentario-heartbeat para mantener viva la
# conexión a través de proxies que cierran conexiones HTTP inactivas.
_HEARTBEAT_SECS = 20


@router.get("/api/stream")
async def stream(request: Request, channel: str = "residencial"):
    if channel not in realtime.CHANNELS:
        return JSONResponse({"detail": "Canal inválido"}, status_code=400)

    user = realtime.auth_sse(request)
    if not user:
        return JSONResponse({"detail": "No autenticado"}, status_code=401)

    queue = realtime.subscribe(channel)

    async def event_gen():
        # Evento inicial para confirmar la conexión en el cliente.
        yield realtime.event_payload({"type": "connected", "channel": channel})
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECS)
                    yield realtime.event_payload(event)
                except asyncio.TimeoutError:
                    # Heartbeat: comentario SSE (líneas que empiezan por ':' se ignoran).
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            realtime.unsubscribe(channel, queue)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # evita buffering en nginx/proxies
        },
    )
