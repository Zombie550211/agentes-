"""Endpoints SSE (Server-Sent Events) para tiempo real.

GET /api/stream?channel=residencial|lineas
GET /api/stream/notificaciones  → centro de notificaciones (ver más abajo)

El navegador (EventSource) abre una conexión persistente y recibe un aviso cada
vez que cambian los datos del canal; entonces el frontend re-ejecuta su función
de carga sin recargar la página. Ver realtime.py para el broker pub/sub.
"""
import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse

import realtime
import session_guard
from deps import ADMIN_ROLES

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

    revocado = await session_guard.is_session_revoked(user)
    if revocado:
        return JSONResponse({"detail": revocado}, status_code=401)

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
                    # Heartbeat. Además se revalida la sesión: esta conexión puede
                    # durar horas, y comprobar solo al abrirla dejaba a un usuario
                    # suspendido recibiendo datos del CRM en vivo indefinidamente.
                    # Va cacheado en session_guard, así que casi siempre es un
                    # lookup en memoria, no una consulta a la BD.
                    if await session_guard.is_session_revoked(user):
                        break
                    # Comentario SSE (las líneas que empiezan por ':' se ignoran).
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


# ── Centro de notificaciones ─────────────────────────────────────
# Una sola conexión por NAVEGADOR, no por pestaña: la abre el SharedWorker
# js/core/notificaciones.worker.js y la reparte a todas las pestañas del CRM. Escucha el
# canal personal del usuario y, si es administración, el de su rol. Los eventos son
# avisos cortos ({"type": "faltas"}); la página vuelve a pedir el dato a su API, así que
# aquí no viaja nada que el usuario no pueda leer de todos modos.
# Va bajo /api/stream/ para que el proxy le aplique lo mismo que a /api/stream.
_ADMIN = {r.lower() for r in ADMIN_ROLES}


@router.get("/api/stream/notificaciones")
async def stream_notificaciones(request: Request):
    user = realtime.auth_sse(request)
    if not user:
        return JSONResponse({"detail": "No autenticado"}, status_code=401)
    revocado = await session_guard.is_session_revoked(user)
    if revocado:
        return JSONResponse({"detail": revocado}, status_code=401)

    canales = [realtime.canal_usuario(user.get("id"))]
    if str(user.get("role") or "").strip().lower() in _ADMIN:
        canales.append(realtime.CANAL_ADMIN)
    queue = realtime.subscribe_many(canales)

    async def event_gen():
        # Quién es: el worker lo compara con la sesión de cada pestaña para saber si la
        # conexión sigue siendo de ese usuario (cambio de cuenta en el mismo navegador).
        yield realtime.event_payload({"type": "connected", "user_id": str(user.get("id"))})
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECS)
                    yield realtime.event_payload(event)
                except asyncio.TimeoutError:
                    if await session_guard.is_session_revoked(user):
                        break
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            realtime.unsubscribe_many(canales, queue)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
