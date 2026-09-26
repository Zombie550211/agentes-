"""
Semáforo de clientes — reglas de los "casos a solventar".

Cada venta residencial registra en el formulario un CASO A SOLVENTAR (desconectar
el servicio en la dirección anterior, cancelar el servicio anterior, bajar el
precio…) o marca "sin caso pendiente". Cuando el cliente pasa a COMPLETED empieza
a correr el reloj, en días naturales:

    0 – 72 h     verde      (3 días)
    72 – 120 h   amarillo   (+2 días)
    120 – 144 h  rojo       (+1 día)
    ≥ 144 h      negro      → el lead pasa solo a status y status comisión "oficina"

El caso queda SOLVENTADO en cuanto el agente sube un comprobante (captura o audio
de la llamada). Un caso solventado se muestra en verde y ya no corre el reloj.

El reloj arranca en el momento más tardío entre `fecha_completed` y la hora en que
se escribió el caso (`caso_creado_at`): si a un cliente completado hace un mes se
le añade un caso desde Editar cliente, no cae en negro de golpe.

Solo entran los casos cuyo reloj arranca DESPUÉS de la activación del semáforo
(app_config.semaforo_casos_inicio, que la migración 0050 fija con la hora del
primer arranque tras el despliegue). Así las ventas antiguas no pasan a oficina.

Estados de `leads.caso_estado`:
    NULL          el lead no tiene caso (registrado antes de esta función)
    'sin_caso'    el agente marcó que no hay nada pendiente
    'pendiente'   hay caso y aún no hay comprobante
    'solventado'  hay comprobante
    'vencido'     llegó a negro; el lead ya está en oficina
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

HORAS_VERDE = 72
HORAS_AMARILLO = 120
HORAS_ROJO = 144

COLORES = ("verde", "amarillo", "rojo", "negro")

# Inicio del reloj de un caso (SQL). COALESCE: si falta alguna de las dos fechas
# se usa la otra.
SQL_INICIO_RELOJ = (
    "GREATEST(COALESCE(fecha_completed, caso_creado_at), "
    "COALESCE(caso_creado_at, fecha_completed))"
)

# El lead sigue en completed (o active, sinónimo en datos antiguos).
SQL_STATUS_COMPLETED = (
    "(LOWER(COALESCE(status,'')) LIKE 'complet%' "
    "OR LOWER(COALESCE(status,'')) IN ('active','activo','activa'))"
)

# Qué leads están en el semáforo (necesita el parámetro :inicio).
SQL_EN_SEMAFORO = f"""(
    caso_estado = 'vencido'
    OR (caso_estado IN ('pendiente','solventado')
        AND {SQL_STATUS_COMPLETED}
        AND fecha_completed IS NOT NULL
        AND {SQL_INICIO_RELOJ} >= :inicio)
)"""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_dt(v) -> Optional[datetime]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v).replace("Z", "").split(".")[0])
    except ValueError:
        return None


def inicio_reloj(fecha_completed, caso_creado_at) -> Optional[datetime]:
    a, b = _to_dt(fecha_completed), _to_dt(caso_creado_at)
    if a and b:
        return max(a, b)
    return a or b


def clasificar(caso_estado: str, fecha_completed, caso_creado_at, ahora: Optional[datetime] = None) -> dict:
    """Color del semáforo y plazos de un caso.

    Devuelve {color, solventado, horas_transcurridas, horas_restantes_color,
    vence_at} — horas_restantes_color: lo que falta para pasar al siguiente color
    (None si ya está solventado o en negro)."""
    ahora = ahora or _utcnow()
    estado = str(caso_estado or "").lower()
    if estado == "vencido":
        return {"color": "negro", "solventado": False, "horas_transcurridas": None,
                "horas_restantes_color": None, "vence_at": None}
    ini = inicio_reloj(fecha_completed, caso_creado_at)
    if estado == "solventado":
        return {"color": "verde", "solventado": True, "horas_transcurridas": None,
                "horas_restantes_color": None, "vence_at": None}
    if not ini:
        return {"color": "verde", "solventado": False, "horas_transcurridas": 0,
                "horas_restantes_color": HORAS_VERDE, "vence_at": None}
    h = max(0.0, (ahora - ini).total_seconds() / 3600.0)
    if h < HORAS_VERDE:
        color, limite = "verde", HORAS_VERDE
    elif h < HORAS_AMARILLO:
        color, limite = "amarillo", HORAS_AMARILLO
    elif h < HORAS_ROJO:
        color, limite = "rojo", HORAS_ROJO
    else:
        color, limite = "negro", None
    return {
        "color": color,
        "solventado": False,
        "horas_transcurridas": round(h, 1),
        "horas_restantes_color": round(limite - h, 1) if limite else None,
        "vence_at": (ini + timedelta(hours=HORAS_ROJO)).isoformat(),
    }


# ── Quién ve qué ────────────────────────────────────────────────────
# agente      → solo sus clientes
# supervisor  → los clientes de los agentes de su team (y los que lo tengan a él
#               como supervisor en el lead)
# resto       → todos (administración, backoffice, ICON…), separados por team
def _rol(user: dict) -> str:
    import unicodedata
    return unicodedata.normalize("NFD", str(user.get("role") or "")).encode("ascii", "ignore").decode().lower()


def es_supervisor(user: dict) -> bool:
    return "supervisor" in _rol(user)


def es_agente(user: dict) -> bool:
    r = _rol(user)
    if "supervisor" in r or "admin" in r or "backoffice" in r:
        return False
    return "agent" in r or "vendedor" in r


def ambito(user: dict) -> str:
    if es_supervisor(user):
        return "supervisor"
    if es_agente(user):
        return "agente"
    return "todos"


# Team de un lead: el team ACTUAL de su agente en users; si no, el del lead; si
# no, el del supervisor que figura en el lead. (En leads.team casi nunca hay nada.)
SQL_EQUIPO = """COALESCE(
    (SELECT NULLIF(TRIM(ua.team),'') FROM users ua
      WHERE ua.username IN (leads.agente_nombre, leads.agente, leads.created_by)
        AND COALESCE(TRIM(ua.team),'') <> '' LIMIT 1),
    NULLIF(TRIM(leads.team),''),
    (SELECT NULLIF(TRIM(us.team),'') FROM users us
      WHERE (us.username = leads.supervisor OR us.name = leads.supervisor)
        AND LOWER(us.role) LIKE '%supervisor%' AND COALESCE(TRIM(us.team),'') <> '' LIMIT 1),
    'Sin team')"""


async def team_de_usuario(session, user: dict) -> str:
    """Team del usuario según la tabla users (el token puede estar desactualizado)."""
    try:
        r = await session.execute(text("SELECT team FROM users WHERE username = :u LIMIT 1"),
                                  {"u": (user.get("username") or "").strip()})
        row = r.first()
        if row and row[0]:
            return str(row[0]).strip()
    except Exception:
        pass
    return str(user.get("team") or "").strip()


async def filtro_ambito(session, user: dict) -> tuple:
    """(sql, params) que limita los leads a lo que el usuario puede ver en el
    semáforo. Usa la columna calculada `equipo` (SQL_EQUIPO AS equipo)."""
    a = ambito(user)
    if a == "agente":
        return SQL_DUENO, params_dueno(user)
    if a == "supervisor":
        team = await team_de_usuario(session, user)
        u = (user.get("username") or "").strip()
        n = (user.get("name") or "").strip() or u
        return ("(equipo = :sup_team OR supervisor = :sup_u OR supervisor = :sup_n)",
                {"sup_team": team or "__sin_team__", "sup_u": u, "sup_n": n})
    return "1=1", {}


# ── Llamadas (bloqueo de pantalla) ──────────────────────────────────
# 1ª llamada = la del CASO: se pide en cuanto el cliente pasa a completed y la
# pantalla del agente queda bloqueada hasta que sube el comprobante (captura o
# audio). Con ella el caso queda solventado.
# Después, llamadas de SEGUIMIENTO contadas desde la anterior: las 2 primeras a
# los 14 días y el resto cada 30, mientras el cliente siga completed. Cuando toca
# una hay aviso, y si a los 3 días no se ha subido, se bloquea la pantalla.
# Los seguimientos no cambian el color del semáforo.
SEG_LLAMADAS_QUINCENALES = 2
SEG_DIAS_QUINCENAL = 14
SEG_DIAS_MENSUAL = 30
SEG_MARGEN_DIAS = 3

SQL_PROXIMO_SEG = (
    f"DATE_ADD(seg_ultima_llamada_at, INTERVAL IF(COALESCE(seg_llamadas,0) < {SEG_LLAMADAS_QUINCENALES}, "
    f"{SEG_DIAS_QUINCENAL}, {SEG_DIAS_MENSUAL}) DAY)"
)

SQL_DUENO = ("(agente_nombre = :own_u OR agente = :own_u OR created_by = :own_u "
             "OR agente_nombre = :own_n OR agente = :own_n)")


def proximo_seguimiento(ultima, n) -> Optional[datetime]:
    """Fecha en la que toca la siguiente llamada de seguimiento."""
    u = _to_dt(ultima)
    if not u:
        return None
    dias = SEG_DIAS_QUINCENAL if int(n or 0) < SEG_LLAMADAS_QUINCENALES else SEG_DIAS_MENSUAL
    return u + timedelta(days=dias)


def params_dueno(user: dict) -> dict:
    u = (user.get("username") or "").strip()
    return {"own_u": u, "own_n": (user.get("name") or "").strip() or u}


async def llamadas_pendientes(session, user: dict, ahora: Optional[datetime] = None) -> list:
    """Llamadas que debe el agente: las del caso (bloquean ya) y los seguimientos
    vencidos (bloquean pasados SEG_MARGEN_DIAS). Devuelve [(fila, info)] con
    info = {motivo, numero, vence_at, bloquea, bloquea_at}."""
    ahora = ahora or _utcnow()
    inicio = await get_inicio(session)
    p = {**params_dueno(user), "inicio": inicio, "ahora": ahora}
    out = []
    r = await session.execute(text(f"""
        SELECT * FROM leads
        WHERE caso_estado = 'pendiente'
          AND {SQL_STATUS_COMPLETED}
          AND fecha_completed IS NOT NULL
          AND {SQL_INICIO_RELOJ} >= :inicio
          AND {SQL_DUENO}
        ORDER BY {SQL_INICIO_RELOJ} ASC
        LIMIT 300
    """), p)
    for row in r.mappings().all():
        row = dict(row)
        c = clasificar(row.get("caso_estado"), row.get("fecha_completed"), row.get("caso_creado_at"), ahora)
        if c["color"] == "negro":
            continue  # ya es de oficina: el vencimiento lo pasará en su próxima ronda
        out.append((row, {"motivo": "caso", "numero": 1, "vence_at": c["vence_at"],
                          "bloquea": True, "bloquea_at": None}))
    r = await session.execute(text(f"""
        SELECT * FROM leads
        WHERE caso_estado = 'solventado'
          AND seg_ultima_llamada_at IS NOT NULL
          AND {SQL_STATUS_COMPLETED}
          AND {SQL_PROXIMO_SEG} <= :ahora
          AND {SQL_DUENO}
        ORDER BY {SQL_PROXIMO_SEG} ASC
        LIMIT 300
    """), p)
    for row in r.mappings().all():
        row = dict(row)
        vence = proximo_seguimiento(row.get("seg_ultima_llamada_at"), row.get("seg_llamadas"))
        bloquea_at = vence + timedelta(days=SEG_MARGEN_DIAS) if vence else None
        out.append((row, {"motivo": "seguimiento", "numero": int(row.get("seg_llamadas") or 0) + 1,
                          "vence_at": vence.isoformat() if vence else None,
                          "bloquea": bool(bloquea_at and ahora >= bloquea_at),
                          "bloquea_at": bloquea_at.isoformat() if bloquea_at else None}))
    return out


# Interruptor del bloqueo: app_config.semaforo_bloqueo = '1' lo activa. Apagado,
# las llamadas se siguen pidiendo con el aviso, pero ni se bloquea la pantalla
# ni se rechazan ventas (el semáforo y el paso a oficina corren igual).
# Se activa sin desplegar código:  UPDATE app_config SET valor='1'
#                                  WHERE clave='semaforo_bloqueo';
_bloqueo_cache: dict = {"valor": None, "ts": 0.0}


async def bloqueo_activo(session) -> bool:
    import time
    if _bloqueo_cache["valor"] is not None and time.time() - _bloqueo_cache["ts"] < 60:
        return _bloqueo_cache["valor"]
    valor = False
    try:
        r = await session.execute(text(
            "SELECT valor FROM app_config WHERE clave = 'semaforo_bloqueo' LIMIT 1"))
        row = r.first()
        valor = bool(row and str(row[0]).strip() == "1")
    except Exception:
        valor = False
    _bloqueo_cache.update(valor=valor, ts=time.time())
    return valor


async def tiene_bloqueo(user: dict) -> bool:
    from database_mysql import AsyncSessionLocal
    try:
        async with AsyncSessionLocal() as s:
            if not await bloqueo_activo(s):
                return False
            return any(info["bloquea"] for _, info in await llamadas_pendientes(s, user))
    except Exception as e:  # BD sin migrar: no bloquear
        print(f"[semaforo] tiene_bloqueo: {e}")
        return False


# ── Activación ──────────────────────────────────────────────────────
_inicio_cache: dict = {"valor": None, "ts": 0.0}


async def get_inicio(session) -> datetime:
    """Momento de activación del semáforo (app_config). Si aún no existe —BD sin la
    migración— se devuelve 'ahora', de modo que ningún caso antiguo entre."""
    import time
    if _inicio_cache["valor"] and time.time() - _inicio_cache["ts"] < 300:
        return _inicio_cache["valor"]
    valor = None
    try:
        r = await session.execute(text(
            "SELECT valor FROM app_config WHERE clave = 'semaforo_casos_inicio' LIMIT 1"))
        row = r.first()
        valor = _to_dt(row[0]) if row else None
    except Exception:
        valor = None
    if valor is None:
        return _utcnow()
    _inicio_cache.update(valor=valor, ts=time.time())
    return valor


# ── Paso automático a negro / oficina ───────────────────────────────
async def vencer_casos() -> int:
    """Pasa a oficina (status y status comisión) los casos pendientes que llevan
    144 h o más sin comprobante. Devuelve cuántos leads cambió.

    Idempotente: solo toca caso_estado = 'pendiente', y los deja en 'vencido'."""
    from database_mysql import AsyncSessionLocal
    ahora = _utcnow()
    async with AsyncSessionLocal() as s:
        inicio = await get_inicio(s)
        limite = ahora - timedelta(hours=HORAS_ROJO)
        r = await s.execute(text(f"""
            SELECT id, nombre_cliente, status, agente, agente_nombre, created_by, supervisor
            FROM leads
            WHERE caso_estado = 'pendiente'
              AND {SQL_STATUS_COMPLETED}
              AND fecha_completed IS NOT NULL
              AND {SQL_INICIO_RELOJ} >= :inicio
              AND {SQL_INICIO_RELOJ} <= :limite
        """), {"inicio": inicio, "limite": limite})
        filas = [dict(x) for x in r.mappings().all()]
        if not filas:
            return 0
        ids = [f["id"] for f in filas]
        # El UPDATE repite la condición: si entre el SELECT y aquí alguien subió el
        # comprobante, ese lead ya no está 'pendiente' y no se toca.
        from sqlalchemy import bindparam
        await s.execute(text("""
            UPDATE leads
               SET status = 'oficina', status_comision = 'oficina',
                   caso_estado = 'vencido', caso_vencido_at = :ahora,
                   updated_at = :ahora, updated_by = 'semaforo'
             WHERE id IN :ids AND caso_estado = 'pendiente'
        """).bindparams(bindparam("ids", expanding=True)), {"ahora": ahora, "ids": ids})
        await s.commit()

    # Aviso persistente al agente y a su supervisor, como cualquier cambio de status.
    try:
        from notifications import record_status_changes
        await record_status_changes([{
            "seccion": "residencial", "cliente": f.get("nombre_cliente") or "Sin nombre",
            "old_status": f.get("status") or "", "new_status": "oficina",
            "actor": "Semáforo de clientes",
            "target_agente": f.get("agente_nombre") or f.get("agente") or f.get("created_by") or "",
            "target_supervisor": f.get("supervisor") or "",
        } for f in filas])
    except Exception as e:  # el aviso nunca debe impedir el cambio
        print(f"[semaforo] aviso de status: {e}")
    try:
        import realtime
        await realtime.publish("residencial", {"type": "residencial", "action": "semaforo"})
    except Exception:
        pass
    print(f"[semaforo] {len(filas)} caso(s) vencido(s) → oficina")
    return len(filas)


async def bucle_vencimientos(cada_segundos: int = 300):
    """Revisa los vencimientos cada 5 minutos. Lo arranca main.py solo en la
    instancia dueña del esquema (una sola, para no duplicar avisos)."""
    import asyncio
    await asyncio.sleep(20)  # deja terminar el arranque
    while True:
        try:
            await vencer_casos()
        except Exception as e:
            print(f"[semaforo] error en vencimientos: {e}")
        await asyncio.sleep(cada_segundos)
