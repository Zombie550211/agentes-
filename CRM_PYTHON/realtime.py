"""Broker pub/sub en memoria para tiempo real (SSE).

Notas de arquitectura:
- Funciona porque el despliegue corre con UN SOLO worker uvicorn (Render free,
  ver render.yaml). El estado vive en memoria del proceso, así que NO se comparte
  entre workers/instancias. Si algún día se escala a varios workers, hay que
  reemplazar este broker por Redis pub/sub (o similar) — el resto del código
  (routers y frontend) puede quedarse igual.
- `publish()` nunca debe romper una escritura de negocio: todo va envuelto en
  try/except y usa put_nowait con descarte si la cola de un cliente lento se llena.
"""
import asyncio
import json
import os
from typing import Optional

from jose import jwt, JWTError

# ── Canales válidos ──────────────────────────────────────────────
CHANNELS = ("residencial", "lineas")

# Tamaño máximo de la cola por cliente. Si un cliente no consume a tiempo,
# descartamos eventos viejos en vez de bloquear al publicador.
_MAX_QUEUE = 100

# canal -> set de colas (una por conexión SSE)
_subscribers: dict[str, set[asyncio.Queue]] = {ch: set() for ch in CHANNELS}


def subscribe(channel: str) -> asyncio.Queue:
    """Registra una nueva conexión y devuelve su cola de eventos."""
    q: asyncio.Queue = asyncio.Queue(maxsize=_MAX_QUEUE)
    _subscribers.setdefault(channel, set()).add(q)
    return q


def unsubscribe(channel: str, q: asyncio.Queue) -> None:
    """Elimina la cola al cerrarse la conexión."""
    subs = _subscribers.get(channel)
    if subs:
        subs.discard(q)


async def publish(channel: str, event: dict) -> None:
    """Encola `event` (serializable a JSON) para todos los clientes del canal.

    Robusto: nunca lanza. Si una cola está llena, se descarta el evento más
    antiguo para hacer sitio (el cliente recargará con el siguiente de todos modos).
    """
    try:
        subs = _subscribers.get(channel)
        if not subs:
            return
        for q in list(subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()        # descarta el más viejo
                    q.put_nowait(event)
                except Exception:
                    pass
    except Exception:
        # El tiempo real nunca debe tumbar una operación de negocio.
        pass


# ── Auth para SSE ────────────────────────────────────────────────
# EventSource no permite cabeceras personalizadas: la autenticación va por la
# cookie httponly `token` (misma que usa deps.current_user). Aquí solo VALIDAMOS
# el token; no renovamos la cookie porque en un StreamingResponse las cabeceras
# ya se enviaron al abrir el stream.
_JWT_SECRET = os.getenv("JWT_SECRET")
_JWT_ALGO = "HS256"


def auth_sse(request) -> Optional[dict]:
    """Devuelve el payload del JWT si la cookie/Authorization es válida, o None."""
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token or not _JWT_SECRET:
        return None
    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALGO])
    except JWTError:
        return None


def event_payload(event: dict) -> str:
    """Formatea un evento como bloque SSE (`data: {...}\\n\\n`)."""
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
