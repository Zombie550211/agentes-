"""Revocación de sesiones — invalida JWT que ya fueron emitidos.

Un JWT es válido hasta su `exp` pase lo que pase: `current_user` sólo verifica la
firma y nunca consulta la BD. Sin este módulo eso significaba que suspender a un
usuario (users.active = 0) no le quitaba el acceso — seguía entrando con su token
hasta 30 días si había marcado "Recordar sesión" — y que el botón de admin
"cerrar todas las sesiones" no hacía absolutamente nada: escribía la clave
`forceLogoutBefore` en system_settings y nadie la leía jamás.

Aquí viven las dos comprobaciones que faltaban:

  - `forceLogoutBefore`: corte global por timestamp, comparado contra el `iat`
    del token. Es el mismo patrón que ya usaba el modo mantenimiento en
    routers/auth.py, que sí compara `iat < activeSince`.
  - `users.active`: un usuario suspendido pierde el acceso aunque su token siga
    vivo.

Ambas van cacheadas en memoria porque `current_user` corre en cada petición de
los ~200 endpoints: sin caché serían dos consultas por request contra la RDS.
Los TTL son cortos y, además, quien suspende o cierra sesiones invalida la
entrada a mano (`invalidate_user` / `invalidate_force_logout`), así que el efecto
es inmediato y el TTL sólo cubre cambios hechos por fuera de la app (un UPDATE
directo en la BD, u otro worker de uvicorn).

Criterio ante fallo de MySQL: se conserva el último valor conocido en vez de
cerrarle la sesión a toda la empresa. Un corte de BD no debe convertirse en un
cierre de sesión masivo; los datos igual no se pueden leer sin BD.
"""
import asyncio
import json
import time

from sqlalchemy import text

from database_mysql import AsyncSessionLocal

_FORCE_LOGOUT_TTL = 30   # segundos
_USER_STATE_TTL   = 60   # segundos

# {"ts": momento de la última lectura, "value": timestamp en ms del corte global}
_force_logout: dict = {"ts": 0.0, "value": 0, "loaded": False}

# user_id -> {"ts": momento de la lectura, "active": bool, "role": str}
_user_state: dict[str, dict] = {}


def invalidate_force_logout() -> None:
    """Fuerza a releer el corte global en la siguiente petición."""
    _force_logout["ts"] = 0.0


def invalidate_user(user_id) -> None:
    """Fuerza a releer el estado de un usuario (suspensión, borrado, cambio de rol)."""
    _user_state.pop(str(user_id), None)


async def _force_logout_before() -> int:
    """Timestamp en ms del último 'cerrar todas las sesiones' (0 si nunca hubo)."""
    now = time.monotonic()
    if _force_logout["loaded"] and (now - _force_logout["ts"]) < _FORCE_LOGOUT_TTL:
        return _force_logout["value"]
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(
                "SELECT value FROM system_settings WHERE `key` = 'forceLogoutBefore' LIMIT 1"
            ))
            row = r.first()
    except Exception:
        return _force_logout["value"]   # BD caída: se mantiene lo último conocido

    value = 0
    if row and row[0] is not None:
        raw = row[0]
        try:
            # La columna es JSON y misc.py guarda json.dumps(ts); según el driver
            # llega ya deserializado (int) o como texto.
            value = int(json.loads(raw) if isinstance(raw, (str, bytes, bytearray)) else raw)
        except (ValueError, TypeError):
            value = 0

    _force_logout.update(ts=now, value=value, loaded=True)
    return value


async def _user_state_of(user_id: str) -> dict | None:
    """Estado actual del usuario en la BD: {"active": bool, "role": str}.

    Devuelve None cuando no se puede determinar (BD caída, id no resoluble): el
    llamador lo interpreta como "no bloquear".
    """
    uid = str(user_id or "").strip()
    if not uid:
        return None

    entry = _user_state.get(uid)
    now = time.monotonic()
    if entry and (now - entry["ts"]) < _USER_STATE_TTL:
        return entry

    try:
        int(uid)
    except ValueError:
        # Tokens antiguos con _id de Mongo: no se pueden resolver contra MySQL.
        # No bloqueamos por eso; caducarán solos.
        return None

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(
                text("SELECT active, role FROM users WHERE id = :id LIMIT 1"), {"id": int(uid)}
            )
            row = r.first()
    except Exception:
        return entry   # BD caída: se reusa lo último conocido, o None

    if row is None:
        state = {"ts": now, "active": False, "role": ""}   # usuario borrado
    else:
        active = True if row[0] is None else bool(row[0])
        state = {"ts": now, "active": active, "role": str(row[1] or "")}

    _user_state[uid] = state
    return state


async def is_session_revoked(payload: dict) -> str | None:
    """Devuelve el motivo por el que el token ya no vale, o None si sigue vigente.

    `payload` es el JWT ya decodificado y con la firma verificada.
    """
    # Las dos comprobaciones son independientes y en el caso normal (sesión
    # vigente) hacen falta ambas, así que se lanzan a la vez: con la caché fría
    # eso cuesta una consulta de tiempo en vez de dos encadenadas.
    cutoff, estado = await asyncio.gather(
        _force_logout_before(),
        _user_state_of(payload.get("id")),
    )

    if cutoff:
        try:
            iat = int(payload.get("iat") or 0)
        except (ValueError, TypeError):
            iat = 0
        # `iat` va en segundos (deps.make_token) y el corte se guarda en ms.
        if iat and iat * 1000 < cutoff:
            return "Sesión cerrada por un administrador"

    if estado is None:
        return None

    if not estado["active"]:
        return "Cuenta suspendida"

    # El rol viaja dentro del token y la renovación por sliding-session copia los
    # claims viejos, así que sin esto una degradación de rol no se aplicaría nunca.
    # Al no coincidir se obliga a reloguear, que es cuando se emite el rol nuevo.
    rol_token = str(payload.get("role") or "").strip()
    rol_bd    = estado["role"].strip()
    if rol_bd and rol_token != rol_bd:
        return "Tu rol cambió: vuelve a iniciar sesión"

    return None
