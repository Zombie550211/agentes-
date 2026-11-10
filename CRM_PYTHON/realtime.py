"""Broker pub/sub en memoria para tiempo real (SSE).

Notas de arquitectura:
- Funciona porque el despliegue corre con UN SOLO worker uvicorn (EC2, servicio
  systemd detrás de nginx). El estado vive en memoria del proceso, así que NO se comparte
  entre workers/instancias. Si algún día se escala a varios workers, hay que
  reemplazar este broker por Redis pub/sub (o similar) — el resto del código
  (routers y frontend) puede quedarse igual.
- `publish()` nunca debe romper una escritura de negocio: todo va envuelto en
  try/except y usa put_nowait con descarte si la cola de un cliente lento se llena.
"""
import asyncio
import json
import os
from pathlib import Path
from typing import Optional

import jwt
from jwt import PyJWTError as JWTError

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


# ── Canales del centro de notificaciones ─────────────────────────
# Una conexión por navegador (js/core/notificaciones.worker.js) escucha a la vez su canal
# personal y el de su rol; el servidor publica en el que corresponda y solo le llega a
# quien debe. Los nombres no compiten con CHANNELS: esos los valida /api/stream.
def canal_usuario(user_id) -> str:
    return f"usuario:{user_id}"


CANAL_ADMIN = "rol:admin"
# Todos los usuarios conectados. Solo lleva avisos sin datos ({"type": "cola"}): la página
# que le interesa vuelve a pedir lo suyo a su API.
CANAL_TODOS = "todos"


def avisar_cola() -> None:
    """La cola de transferencias cambió (alguien se conectó o se fue, pausa, transferencia
    nueva...): las páginas de Transferencias la recargan al momento en vez de preguntar
    cada pocos segundos."""
    publish_nowait(CANAL_TODOS, {"type": "cola"})


# Presencia: desde cuándo está conectado cada usuario (canal «usuario:{id}»). La usa la cola
# de Líneas (routers/transferencias.py): quien se conecta entra al final. Una recarga o un
# corte corto (< GRACIA_RECONEXION s) conserva el «desde» para no perder el lugar.
GRACIA_RECONEXION = 120
_presencia: dict[str, dict] = {}   # canal -> {"desde": datetime UTC, "salio": datetime | None}


def _ahora():
    import datetime as _dt
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)


def conectado_desde(user_id):
    """Momento (UTC) desde el que el usuario está conectado, o None si no lo está."""
    ch = canal_usuario(user_id)
    if not _subscribers.get(ch):
        return None
    p = _presencia.get(ch)
    return p["desde"] if p else None


# Un reinicio del backend (cada despliegue, o el del servidor) borraba _presencia: todos se
# reconectaban a la vez con un «desde» nuevo y la cola quedaba en el orden en que volvieron
# (un agente 5.º pasaba a 10.º). Al apagar se guarda en disco y al arrancar se recupera:
# quien se reconecta dentro de GRACIA_REINICIO conserva su lugar.
GRACIA_REINICIO = 600
_ARCHIVO_PRESENCIA = Path(os.getenv("PRESENCIA_FILE") or
                          Path(__file__).resolve().parent.parent / "datos_privados" / "presencia_cola.json")


# Despliegue sin cortes (scripts/deploy/aplicar_release.sh): el proceso nuevo arranca mientras
# el viejo sigue atendiendo, así que la presencia también se guarda cada 30 s y solo la
# guarda el proceso que de verdad tiene clientes (el nuevo, recién arrancado, todavía no).
_tuvo_clientes = False


def guardar_presencia() -> None:
    """Quién estaba conectado y desde cuándo (al apagar y cada 30 s)."""
    if not _tuvo_clientes:
        return
    ahora = _ahora()
    datos = {ch: {"desde": p["desde"].isoformat(), "salio": (p.get("salio") or ahora).isoformat(),
                  # uvicorn corta las conexiones SSE antes de llegar aquí: quien salió en los
                  # últimos 30 s salió por el apagado, no porque se fuera.
                  "conectado": bool(_subscribers.get(ch)) or not p.get("salio")
                               or (ahora - p["salio"]).total_seconds() < 30}
             for ch, p in _presencia.items()}
    try:
        _ARCHIVO_PRESENCIA.parent.mkdir(parents=True, exist_ok=True)
        tmp = _ARCHIVO_PRESENCIA.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps(datos))
        tmp.replace(_ARCHIVO_PRESENCIA)
    except Exception as e:
        print(f"[realtime] no se pudo guardar la presencia: {e}")


def cargar_presencia() -> None:
    """Al arrancar: recupera los «desde»; los que estaban conectados al apagar tienen
    GRACIA_REINICIO para volver sin perder su lugar en la cola."""
    import datetime as _dt
    try:
        datos = json.loads(_ARCHIVO_PRESENCIA.read_text())
    except FileNotFoundError:
        return
    except Exception as e:
        print(f"[realtime] presencia guardada ilegible, se ignora: {e}")
        return
    ahora = _ahora()
    for ch, p in datos.items():
        try:
            salio = _dt.datetime.fromisoformat(p["salio"])
            desde = _dt.datetime.fromisoformat(p["desde"])
            if p.get("conectado"):
                if (ahora - salio).total_seconds() <= GRACIA_REINICIO:
                    _presencia[ch] = {"desde": desde, "salio": ahora, "gracia": GRACIA_REINICIO}
            else:   # ya se había ido antes de apagar: sigue con la gracia normal
                _presencia[ch] = {"desde": desde, "salio": salio}
        except Exception:
            continue


async def bucle_guardar_presencia():
    while True:
        await asyncio.sleep(30)
        if any(_subscribers.get(ch) for ch in list(_presencia)):
            guardar_presencia()


def subscribe_many(channels: list[str]) -> asyncio.Queue:
    """Una sola cola registrada en varios canales."""
    global _tuvo_clientes
    q: asyncio.Queue = asyncio.Queue(maxsize=_MAX_QUEUE)
    cambio_presencia = False
    for ch in channels:
        if ch.startswith("usuario:") and not _subscribers.get(ch):
            cambio_presencia = True
            _tuvo_clientes = True
            p = _presencia.get(ch)
            ahora = _ahora()
            gracia = p.get("gracia", GRACIA_RECONEXION) if p else GRACIA_RECONEXION
            if not p or not p.get("salio") or (ahora - p["salio"]).total_seconds() > gracia:
                _presencia[ch] = {"desde": ahora, "salio": None}
            else:
                p["salio"] = None
                p.pop("gracia", None)
        _subscribers.setdefault(ch, set()).add(q)
    if cambio_presencia:
        avisar_cola()
    return q


def unsubscribe_many(channels: list[str], q: asyncio.Queue) -> None:
    for ch in channels:
        subs = _subscribers.get(ch)
        if subs is not None:
            subs.discard(q)
            if not subs and ch in _presencia:
                _presencia[ch]["salio"] = _ahora()
                avisar_cola()
            if not subs and ch not in CHANNELS:
                _subscribers.pop(ch, None)   # los personales no se quedan vacíos en memoria


async def publish(channel: str, event: dict) -> None:
    """Encola `event` (serializable a JSON) para todos los clientes del canal.

    Robusto: nunca lanza. Si una cola está llena, se descarta el evento más
    antiguo para hacer sitio (el cliente recargará con el siguiente de todos modos).
    """
    publish_nowait(channel, event)


def publish_nowait(channel: str, event: dict) -> None:
    """Igual que publish(), sin await (no espera nada: solo deja el evento en las colas)."""
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
