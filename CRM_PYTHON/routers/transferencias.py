"""Transferencias de llamadas entre secciones.

Residencial transfiere llamadas a un agente de un team de Líneas, y Líneas a un
agente de un team de Residencial. La sección de cada team sale de
deps.team_seccion (fuente única), así que el destino es siempre la sección
contraria a la de origen.

Resultado: el agente que RECIBIÓ la transferencia (o el supervisor de su team) la cierra con uno de los
estados de RESULTADOS y una captura (obligatoria para "Venta completada"). Si la transferencia
llegó a Líneas, la venta completada lleva además cuántas líneas se vendieron (1-5),
porque la promoción paga por línea. Una vez completada
solo admin / back office pueden cambiarla, porque es lo que cuenta para la
promoción de transferencias.

Cola: ninguna transferencia se dirige a mano. Se asigna sola al primero de la cola de la
sección que la recibe (Líneas para lo que transfiere Residencial y al revés) = sus agentes CONECTADOS (con el centro de notificaciones
abierto, realtime) ordenados por la última transferencia que recibieron (el que hace más
que no recibe, o nunca, va primero). Al recibir una baja al final. Un lock serializa las
asignaciones simultáneas (el despliegue corre con un solo worker, ver realtime.py).

Protección de 24 h: desde que una transferencia se asigna (asignada_at; las viejas, su
created_at), el agente que la recibió tiene PROTECCION_H horas para registrar el resultado.
Mientras tanto los demás agentes del departamento destino la ven con candado. Si pasa el
plazo sin resultado queda LIBRE: bucle_liberadas() avisa a todo ese departamento y
cualquiera de sus agentes puede tomarla (POST /{id}/tomar), con una protección nueva.

Visibilidad del historial:
  - admin / back office → todas las transferencias de la sección.
  - supervisor          → las que hizo o recibió su team.
  - agente              → las que hizo o recibió él.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone
import re

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion
from tiempo_sv import TZ_SV
import realtime

router = APIRouter(prefix="/api/transferencias", tags=["Transferencias de llamadas"])

_SECCIONES = ("residencial", "lineas")
# Teams que no atienden llamadas (mismo criterio que Tiempo laboral). El filtro es por
# team y no por rol: quien está en un team de venta recibe transferencias aunque su rol
# sea otro (p.ej. Edward Ramirez, rol Administrador en TEAM LINEAS JONATHAN).
_TEAM_EXCLUIDO = re.compile(r"backoffice|back office|icon|usa|administra|monitoreo", re.I)

RESULTADOS = {
    "completada": "Venta completada",
    "fraude": "Fraude",
    "balance": "Balance",
    "pago_full": "Pago full",
    "no_interesado": "No interesado",
    "seguimiento": "En seguimiento",
}
# Antes también había "no_realizada": las filas que lo tienen se siguen mostrando, pero
# ya no se puede registrar.
# Solo capturas subidas al propio CRM como imagen (/api/files/upload las guarda en BD).
_URL_CAPTURA = re.compile(r"^/api/files/(\d+)/image$")
_MAX_LINEAS = 5


# «TRF-000123», «trf123», «#123» o «123» en el buscador → id 123.
_BUSCA_ID = re.compile(r"^(?:#|trf-?)?0*(\d{1,9})$", re.I)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _uid(user: dict) -> int:
    try:
        return int(user.get("id") or 0)
    except (TypeError, ValueError):
        return 0


def _contraria(seccion: str) -> str:
    return "lineas" if seccion == "residencial" else "residencial"


def _es_admin_bo(role: str) -> bool:
    r = str(role or "").lower()
    return r in ("admin", "administrador", "administrativo") or "backoffice" in r


def _es_agente(role: str) -> bool:
    """Agente de venta: roles «Agente», «Lineas-Agentes» y «vendedor»."""
    r = str(role or "").lower()
    return ("agente" in r or "vendedor" in r) and "supervisor" not in r


def _es_supervisor(role: str) -> bool:
    return "supervisor" in str(role or "").lower()


def _validar_seccion(seccion: str) -> str:
    s = str(seccion or "").strip().lower()
    if s not in _SECCIONES:
        raise HTTPException(400, "Sección inválida (residencial o lineas)")
    return s


async def _mi_team(s, user: dict) -> str:
    """Team actual del usuario según la BD (el del token puede estar desfasado)."""
    r = await s.execute(text("SELECT team FROM users WHERE id = :id"), {"id": _uid(user)})
    return ((r.scalar() or user.get("team") or "")).strip()


async def _puede_cerrar(s, user: dict, row) -> bool:
    """Quien recibió la transferencia, o el supervisor del team que la recibió."""
    if row["agente_destino_id"] == _uid(user):
        return True
    if not _es_supervisor(user.get("role", "")):
        return False
    mi_team = await _mi_team(s, user)
    return bool(mi_team) and mi_team.lower() == str(row["team_destino"] or "").strip().lower()


async def _agentes_por_team(s, seccion_destino: str) -> dict[str, list[dict]]:
    """Agentes activos de los teams de la sección indicada, agrupados por team."""
    r = await s.execute(text("""
        SELECT id, username, name, role, TRIM(team) AS team FROM users
        WHERE COALESCE(active, 1) = 1 AND team IS NOT NULL AND TRIM(team) != ''
          AND COALESCE(acceso_crm, 1) = 1   -- sin usuario no puede atender la transferencia
        ORDER BY TRIM(team), username
    """))
    teams: dict[str, list[dict]] = {}
    for u in r.mappings().all():
        team = u["team"]
        if team_seccion(team) != seccion_destino or _TEAM_EXCLUIDO.search(team):
            continue
        # Solo agentes: fuera supervisores, administradores, back office…
        if not _es_agente(u["role"]):
            continue
        teams.setdefault(team, []).append({
            "id": int(u["id"]),
            "nombre": (u["username"] or "").strip(),
            "username": u["username"],
            "role": u["role"] or "",
        })
    return teams


# Ranking: los supervisores y Control de calidad no venden; solo salen si tienen alguna
# transferencia en el periodo (siguen pudiendo recibirlas en el formulario).
_FUERA_RANKING = re.compile(r"calidad", re.I)


# ── GET /api/transferencias/destinos?origen=residencial ─────────────
@router.get("/destinos")
async def destinos(origen: str, user: dict = Depends(current_user)):
    origen = _validar_seccion(origen)
    async with AsyncSessionLocal() as s:
        teams = await _agentes_por_team(s, _contraria(origen))
    return {
        "success": True,
        "seccion_destino": _contraria(origen),
        "teams": [{"team": t, "agentes": a} for t, a in teams.items()],
    }


def _rango_dias_sv(desde: str, hasta: str) -> dict:
    """desde/hasta (YYYY-MM-DD) son días de El Salvador; created_at se guarda en UTC.

    Antes se comparaban tal cual: lo transferido de 18:00 a 23:59 (hora SV) caía en el
    día UTC siguiente y no salía en «Hoy» al crearlo. Devuelve los límites en UTC
    (desde = 00:00 SV de ese día; hasta = 00:00 SV del día siguiente, exclusivo)."""
    params: dict = {}
    for nombre, valor in (("desde", desde), ("hasta", hasta)):
        if not valor:
            continue
        try:
            dia = datetime.strptime(valor, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, f"{nombre} debe ser YYYY-MM-DD")
        if nombre == "hasta":
            dia += timedelta(days=1)
        params[nombre] = dia.replace(tzinfo=TZ_SV).astimezone(timezone.utc).replace(tzinfo=None)
    return params


# ── GET /api/transferencias/ranking?seccion=residencial&desde=…&hasta=… ──
@router.get("/ranking")
async def ranking(seccion: str, desde: str = "", hasta: str = "",
                  user: dict = Depends(current_user)):
    """Por cada agente de la sección, en el periodo: transferencias que HIZO (enviadas) y
    que RECIBIÓ de la otra sección (recibidas), con las cerradas como venta de cada una.
    Lo ve cualquier usuario: solo nombres y cantidades, como los rankings. Entran todos los
    agentes de los teams de la sección, también con 0 (menos supervisores y Control de
    calidad sin movimiento). La página elige qué contar según su
    filtro Todas / Enviadas / Recibidas."""
    seccion = _validar_seccion(seccion)
    where = []
    params: dict = {"sec": seccion}
    params.update(_rango_dias_sv(desde, hasta))
    if "desde" in params:
        where.append("t.created_at >= :desde")
    if "hasta" in params:
        where.append("t.created_at < :hasta")
    rango = "".join(" AND " + w for w in where)
    async with AsyncSessionLocal() as s:
        teams = await _agentes_por_team(s, seccion)
        r = await s.execute(text(f"""
            SELECT LOWER(t.created_by) AS clave, COUNT(*) AS total,
                   SUM(t.resultado = 'completada') AS cerradas
            FROM transferencias_llamadas t
            WHERE t.seccion_origen = :sec{rango}
            GROUP BY LOWER(t.created_by)
        """), params)
        enviadas = {str(x["clave"] or ""): x for x in r.mappings().all()}
        r = await s.execute(text(f"""
            SELECT t.agente_destino_id AS clave, COUNT(*) AS total,
                   SUM(t.resultado = 'completada') AS cerradas
            FROM transferencias_llamadas t
            WHERE t.seccion_origen <> :sec{rango}
            GROUP BY t.agente_destino_id
        """), params)
        recibidas = {int(x["clave"] or 0): x for x in r.mappings().all()}
    filas = []
    for team, agentes in teams.items():
        for a in agentes:
            e = enviadas.get(str(a["username"] or "").lower())
            rc = recibidas.get(a["id"])
            if not e and not rc and (_es_supervisor(a["role"]) or _FUERA_RANKING.search(team)):
                continue
            filas.append({
                "nombre": a["nombre"], "team": team,
                "enviadas": int(e["total"]) if e else 0,
                "enviadas_cerradas": int(e["cerradas"] or 0) if e else 0,
                "recibidas": int(rc["total"]) if rc else 0,
                "recibidas_cerradas": int(rc["cerradas"] or 0) if rc else 0,
            })
    return {"success": True, "agentes": filas}


class TransferenciaIn(BaseModel):
    origen: str
    telefono: str = Field(..., max_length=30)
    motivo: str = Field(..., max_length=1000)
    nombre_cliente: str = Field(..., max_length=150)
    direccion: str = Field(..., max_length=300)
    # Solo Líneas → Residencial elige destino; Residencial → Líneas lo asigna la cola.
    team_destino: str = Field("", max_length=100)
    agente_destino_id: int = 0


# ── Valor de cada línea (monedero de quien transfirió) ─────────────
# Según los días desde la transferencia hasta que se cierra como venta completada.
# Las completadas antes de existir la regla no tienen valor_linea y cuentan $1.
VALOR_LINEA = ((15, 1.00), (22, 0.50))   # hasta el día 15: $1 · hasta el día 22: $0.50
VALOR_LINEA_DESPUES = 0.25                 # desde el día 23


def valor_por_linea(transferida, completada) -> float:
    dias = (completada - transferida).total_seconds() / 86400
    for tope, valor in VALOR_LINEA:
        if dias <= tope:
            return valor
    return VALOR_LINEA_DESPUES


# ── GET /api/transferencias/monedas-pendientes ── ventas completadas de lo que YO transferí
#    cuya moneda aún no vi (la página la anima una vez y luego llama a monedas-vistas) ──
@router.get("/monedas-pendientes")
async def monedas_pendientes(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, nombre_cliente, lineas, COALESCE(valor_linea, 1.00) AS valor_linea
            FROM transferencias_llamadas
            WHERE created_by = :yo AND resultado = 'completada' AND moneda_vista_at IS NULL
            ORDER BY resultado_at ASC LIMIT 50"""), {"yo": user.get("username")})
        filas = [{"id": int(x["id"]), "cliente": x["nombre_cliente"], "lineas": int(x["lineas"] or 1),
                  "valor_linea": float(x["valor_linea"])} for x in r.mappings().all()]
    for f in filas:
        f["monto"] = round(f["lineas"] * f["valor_linea"], 2)
    return {"success": True, "ventas": filas}


# ── POST /api/transferencias/monedas-vistas {ids} ── la animación de la moneda ya se vio ──
@router.post("/monedas-vistas")
async def monedas_vistas(body: dict, user: dict = Depends(current_user)):
    ids = [int(x) for x in (body.get("ids") or []) if str(x).isdigit()][:200]
    if ids:
        async with AsyncSessionLocal() as s:
            await s.execute(text(f"""
                UPDATE transferencias_llamadas SET moneda_vista_at = :ahora
                WHERE id IN ({",".join(map(str, ids))}) AND created_by = :yo AND moneda_vista_at IS NULL"""),
                {"ahora": _utcnow(), "yo": user.get("username")})
            await s.commit()
    return {"success": True}


async def _supervisor_por_team(s) -> dict[str, str]:
    """team (minúsculas) → supervisor. users.supervisor guarda iniciales, así que se toma del
    team: quien tiene rol de supervisor (o administrador) en él, prefiriendo al que comparte
    nombre con el team («TEAM LINEAS JONATHAN» → JONATHAN F)."""
    r = await s.execute(text("""
        SELECT username, role, TRIM(team) AS team FROM users
        WHERE team IS NOT NULL AND TRIM(team) <> '' AND COALESCE(active, 1) = 1
          AND (LOWER(role) LIKE '%supervisor%' OR LOWER(role) LIKE '%admin%')"""))
    por_team: dict[str, list] = {}
    for u in r.mappings().all():
        por_team.setdefault(u["team"].lower(), []).append(u)
    out = {}
    for team, us in por_team.items():
        palabras = {w for w in re.split(r"\W+", team) if len(w) > 2 and w not in ("team", "lineas")}
        def puntos(u):
            nombre = {w for w in re.split(r"\W+", str(u["username"] or "").lower()) if w}
            return (len(palabras & nombre), "supervisor" in str(u["role"] or "").lower())
        out[team] = max(us, key=puntos)["username"].strip()
    return out


# ── Protección de 24 h y transferencias libres ──────────────────────
PROTECCION_H = 24
_FIN_PROTECCION = f"DATE_ADD(COALESCE(t.asignada_at, t.created_at), INTERVAL {PROTECCION_H} HOUR)"


def _vencida(iso_z) -> bool:
    if not iso_z:
        return False
    return datetime.strptime(iso_z, "%Y-%m-%dT%H:%M:%SZ") <= _utcnow()


async def _seccion_de(s, user: dict) -> str:
    mi_team = await _mi_team(s, user)
    return team_seccion(mi_team, user.get("role", "")) if mi_team else ""


# ── POST /api/transferencias/{id}/tomar ── un agente del departamento toma una libre ──
@router.post("/{tid}/tomar")
async def tomar(tid: int, user: dict = Depends(current_user)):
    async with _cola_lock, AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT t.id, t.seccion_origen, t.resultado, t.agente_destino_id,
                   DATE_FORMAT({_FIN_PROTECCION}, '%Y-%m-%dT%H:%i:%sZ') AS protegido_hasta
            FROM transferencias_llamadas t WHERE t.id = :id"""), {"id": tid})
        t = r.mappings().first()
        if not t:
            raise HTTPException(404, "Transferencia no encontrada")
        if t["resultado"]:
            raise HTTPException(409, "Esa transferencia ya fue gestionada")
        if not _vencida(t["protegido_hasta"]):
            raise HTTPException(409, "Sigue protegida para el agente que la recibió")
        if await _seccion_de(s, user) != _contraria(t["seccion_origen"]):
            raise HTTPException(403, "Solo los agentes del departamento que la recibió pueden tomarla")
        r = await s.execute(text("SELECT username, team FROM users WHERE id = :id"), {"id": _uid(user)})
        yo = r.mappings().first() or {}
        await s.execute(text("""
            UPDATE transferencias_llamadas
            SET agente_destino_id = :yo, agente_destino_nombre = :nombre, team_destino = :team,
                asignada_at = :ahora, libre_aviso_at = NULL
            WHERE id = :id AND resultado IS NULL"""), {
            "yo": _uid(user), "nombre": (yo.get("username") or user.get("username") or "").strip(),
            "team": (yo.get("team") or "").strip(), "ahora": _utcnow(), "id": tid})
        await s.commit()
    return {"success": True, "message": f"La tomaste: tienes {PROTECCION_H} h para gestionarla"}


async def _avisar_liberadas() -> int:
    """Marca las transferencias que acaban de quedar libres y avisa a todo el departamento
    destino (canal personal de cada uno de sus usuarios). Devuelve cuántas liberó."""
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT t.id, t.seccion_origen, t.nombre_cliente, t.agente_destino_nombre
            FROM transferencias_llamadas t
            WHERE t.resultado IS NULL AND t.libre_aviso_at IS NULL
              AND {_FIN_PROTECCION} <= UTC_TIMESTAMP()
              AND t.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)"""))
        libres = [dict(x) for x in r.mappings().all()]
        if not libres:
            return 0
        await s.execute(text(f"UPDATE transferencias_llamadas SET libre_aviso_at = :ahora "
                             f"WHERE id IN ({','.join(str(int(x['id'])) for x in libres)})"),
                        {"ahora": _utcnow()})
        await s.commit()
        r = await s.execute(text("""SELECT id, role, team FROM users
                                    WHERE COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1"""))
        usuarios = [dict(x) for x in r.mappings().all()]
    for seccion in ("lineas", "residencial"):
        grupo = [x for x in libres if _contraria(x["seccion_origen"]) == seccion]
        if not grupo:
            continue
        evento = {"type": "transferencias_libres", "seccion": seccion, "cantidad": len(grupo),
                  "clientes": [x["nombre_cliente"] for x in grupo][:10]}
        for u in usuarios:
            if (u["team"] or "").strip() and team_seccion(u["team"], u["role"] or "") == seccion:
                await realtime.publish(realtime.canal_usuario(u["id"]), evento)
        await realtime.publish(realtime.CANAL_ADMIN, evento)   # los administradores ven todas
    return len(libres)


async def bucle_liberadas():
    """Cada minuto: avisa de las transferencias que cumplieron sus 24 h sin gestionar."""
    while True:
        try:
            n = await _avisar_liberadas()
            if n:
                print(f"[transferencias] {n} liberadas: aviso al departamento")
        except Exception as e:
            print(f"[transferencias] bucle_liberadas: {e}")
        await asyncio.sleep(60)


# ── Cola de agentes (de Líneas para lo que transfiere Residencial y viceversa) ──
_cola_lock = asyncio.Lock()
# «Poner primero» (admin/BO), por sección destino: ese agente recibe la PRÓXIMA transferencia
# aunque no le toque; al recibirla vuelve a su lugar. En memoria (un solo worker).
_cola_primero: dict[str, int] = {}

# «Pausa» (almuerzo, se levanta del puesto): el agente no recibe transferencias pero conserva
# su lugar. Se guarda el turno que tenía al pausar; mientras dura la pausa la cola avanza sin
# él (los demás reciben y bajan al final, él va subiendo) y sigue en la lista aunque se
# desconecte o se le cierre la sesión. Al quitarla queda en ese mismo lugar hasta que reciba
# su siguiente transferencia, aunque se haya reconectado en medio. Se guardan en la tabla
# transferencias_cola_pausa (migración 0086) para que un reinicio o despliegue no las borre;
# estos dicts son su copia en memoria (un solo worker), cargada en la primera consulta.
_pausas: dict[int, dict] = {}        # user_id -> {"turno": datetime|None, "desde": datetime}
_turno_fijo: dict[int, dict] = {}    # user_id -> {"turno": datetime|None, "desde": datetime}
_pausas_cargadas = False


async def _cargar_pausas(s) -> None:
    global _pausas_cargadas
    if _pausas_cargadas:
        return
    r = await s.execute(text("SELECT user_id, estado, turno, desde FROM transferencias_cola_pausa"))
    for x in r.mappings().all():
        (_pausas if x["estado"] == "pausa" else _turno_fijo)[int(x["user_id"])] = \
            {"turno": x["turno"], "desde": x["desde"]}
    _pausas_cargadas = True


async def _guardar_pausa(s, uid: int, estado: str | None, dato: dict | None = None) -> None:
    """Refleja en la BD el estado de pausa de un agente (None = sin pausa ni turno fijo)."""
    if estado is None:
        await s.execute(text("DELETE FROM transferencias_cola_pausa WHERE user_id = :u"), {"u": uid})
    else:
        await s.execute(text("""
            INSERT INTO transferencias_cola_pausa (user_id, estado, turno, desde)
            VALUES (:u, :e, :t, :d)
            ON DUPLICATE KEY UPDATE estado = VALUES(estado), turno = VALUES(turno), desde = VALUES(desde)
        """), {"u": uid, "e": estado, "t": dato["turno"], "d": dato["desde"]})
    await s.commit()


# En el CRM local (COLA_TODOS=1 en .env.local) los agentes reales están conectados a
# producción, no al local: la cola los muestra a todos para poder probarla.
_COLA_TODOS = os.getenv("COLA_TODOS", "").strip() == "1"


def _conectado(user_id: int) -> bool:
    return _COLA_TODOS or bool(realtime._subscribers.get(realtime.canal_usuario(user_id)))


async def _cola(s, seccion: str, solo_conectados: bool = True) -> list[dict]:
    """Agentes de la sección (destino) en orden de turno (el primero recibe la siguiente):
    los conectados, o todos con solo_conectados=False (cuando no hay nadie conectado)."""
    await _cargar_pausas(s)
    teams = await _agentes_por_team(s, seccion)
    agentes = [dict(a, team=t) for t, lista in teams.items() for a in lista
               if not solo_conectados or _conectado(a["id"]) or a["id"] in _pausas]
    if not agentes:
        return []
    r = await s.execute(text(f"""
        SELECT agente_destino_id AS id, MAX(created_at) AS ultima
        FROM transferencias_llamadas
        WHERE seccion_origen = :origen
          AND agente_destino_id IN ({",".join(str(int(a["id"])) for a in agentes)})
        GROUP BY agente_destino_id
    """), {"origen": _contraria(seccion)})
    ultima = {int(x["id"]): x["ultima"] for x in r.mappings().all()}
    for a in agentes:
        a["ultima"] = ultima.get(a["id"])
    # Turno = lo más reciente entre «recibió su última transferencia» y «se conectó»: quien
    # acaba de recibir o de conectarse va al final. Sin ninguna de las dos (desconectados en
    # la asignación de respaldo), primero.
    for a in agentes:
        desde = realtime.conectado_desde(a["id"]) if solo_conectados and not _COLA_TODOS else None
        a["turno"] = max([x for x in (a["ultima"], desde) if x is not None], default=None)
        a["pausado"] = a["id"] in _pausas
        if a["pausado"]:
            a["turno"] = _pausas[a["id"]]["turno"]
        elif a["id"] in _turno_fijo:
            fijo = _turno_fijo[a["id"]]
            if a["ultima"] and a["ultima"] > fijo["desde"]:
                _turno_fijo.pop(a["id"], None)   # ya recibió después de la pausa: turno normal
                await _guardar_pausa(s, a["id"], None)
            else:
                a["turno"] = fijo["turno"]
    primero = _cola_primero.get(seccion)
    agentes.sort(key=lambda a: (a["id"] != primero, a["turno"] is not None,
                                a["turno"] or datetime.min, a["nombre"].lower()))
    return agentes


# ── GET /api/transferencias/cola?seccion=lineas|residencial ── agentes conectados de esa
#    sección (la que RECIBE), en orden de turno ──
@router.get("/cola")
async def cola(seccion: str = "lineas", user: dict = Depends(current_user)):
    seccion = _validar_seccion(seccion)
    async with AsyncSessionLocal() as s:
        agentes = await _cola(s, seccion)
        sig_sin = None
        if not any(not a["pausado"] for a in agentes):
            todos = [a for a in await _cola(s, seccion, solo_conectados=False) if not a["pausado"]]
            if todos:
                sig_sin = {"id": todos[0]["id"], "nombre": todos[0]["nombre"], "team": todos[0]["team"]}
    yo = _uid(user)
    return {"success": True, "siguiente_sin_conexion": sig_sin, "mi_pausa": yo in _pausas, "agentes": [{
        "id": a["id"], "nombre": a["nombre"], "team": a["team"], "conectado": True, "pausado": a["pausado"],
        "ultima": a["ultima"].replace(tzinfo=timezone.utc).isoformat() if a["ultima"] else None,
    } for a in agentes], "puede_ordenar": _es_admin_bo(user.get("role", "")),
        "primero": _cola_primero.get(seccion), "yo": _uid(user)}


# ── POST /api/transferencias/cola/primero {id} ── admin/BO: ese agente va primero (una vez) ──
@router.post("/cola/primero")
async def cola_primero(body: dict, user: dict = Depends(current_user)):
    if not _es_admin_bo(user.get("role", "")):
        raise HTTPException(403, "Solo administración puede cambiar el orden de la cola")
    seccion = _validar_seccion(body.get("seccion") or "lineas")
    aid = int(body.get("id") or 0)
    if aid in _pausas:
        raise HTTPException(409, "Ese agente está en pausa: no puede recibir transferencias")
    if aid:
        _cola_primero[seccion] = aid
    else:
        _cola_primero.pop(seccion, None)
    return {"success": True, "primero": _cola_primero.get(seccion)}


# ── POST /api/transferencias/cola/pausa {pausar: bool, id?} ── el agente se pausa a sí
#    mismo; admin/BO puede pausar o quitar la pausa de cualquiera (id) ──
@router.post("/cola/pausa")
async def cola_pausa(body: dict, user: dict = Depends(current_user)):
    aid = int(body.get("id") or 0) or _uid(user)
    if aid != _uid(user) and not _es_admin_bo(user.get("role", "")):
        raise HTTPException(403, "Solo puedes pausar tu propio turno")
    pausar = bool(body.get("pausar"))
    async with _cola_lock, AsyncSessionLocal() as s:
        await _cargar_pausas(s)
        if pausar:
            if aid in _pausas:
                return {"success": True, "pausado": True}
            # El turno de este momento (con la conexión actual) es el que conserva.
            for seccion in ("lineas", "residencial"):
                fila = next((a for a in await _cola(s, seccion) if a["id"] == aid), None) or \
                    next((a for a in await _cola(s, seccion, solo_conectados=False) if a["id"] == aid), None)
                if fila:
                    break
            if not fila:
                raise HTTPException(400, "No estás en ninguna cola de transferencias")
            _pausas[aid] = {"turno": fila["turno"], "desde": _utcnow()}
            _turno_fijo.pop(aid, None)
            await _guardar_pausa(s, aid, "pausa", _pausas[aid])
            for sec in list(_cola_primero):
                if _cola_primero[sec] == aid:
                    _cola_primero.pop(sec, None)
        else:
            p = _pausas.pop(aid, None)
            if p:
                _turno_fijo[aid] = {"turno": p["turno"], "desde": _utcnow()}
                await _guardar_pausa(s, aid, "fijo", _turno_fijo[aid])
    return {"success": True, "pausado": aid in _pausas}


# ── POST /api/transferencias ────────────────────────────────────────
@router.post("")
async def crear(body: TransferenciaIn, user: dict = Depends(current_user)):
    origen = _validar_seccion(body.origen)
    telefono = re.sub(r"\D", "", body.telefono or "")
    if not 7 <= len(telefono) <= 15:
        raise HTTPException(400, "Número de teléfono inválido")
    motivo = (body.motivo or "").strip()
    nombre = (body.nombre_cliente or "").strip()
    direccion = (body.direccion or "").strip()
    if not motivo or not nombre or not direccion:
        raise HTTPException(400, "Todos los campos son obligatorios")

    async with _cola_lock, AsyncSessionLocal() as s:
        # El primero de la cola de la sección contraria (sus agentes conectados). Las mismas
        # reglas en las dos direcciones.
        destino = _contraria(origen)
        # Los que están en pausa conservan su lugar pero no reciben.
        turno = [a for a in await _cola(s, destino) if not a["pausado"]]
        if not turno:
            # Nadie conectado: igual se asigna, al siguiente por turno entre todos; le llega
            # a la campana al entrar y corren sus 24 h.
            turno = [a for a in await _cola(s, destino, solo_conectados=False) if not a["pausado"]]
        if not turno:
            raise HTTPException(409, "No hay agentes para recibir la transferencia")
        agente, team = turno[0], turno[0]["team"]
        if agente["id"] == _cola_primero.get(destino):
            _cola_primero.pop(destino, None)   # «Poner primero» vale para una sola transferencia

        r = await s.execute(text("SELECT name, username, team FROM users WHERE id = :id"),
                            {"id": _uid(user)})
        yo = r.mappings().first() or {}

        r = await s.execute(text("""
            INSERT INTO transferencias_llamadas
                (seccion_origen, telefono, motivo, nombre_cliente, direccion,
                 team_destino, agente_destino_id, agente_destino_nombre,
                 created_by, created_by_nombre, created_by_team, created_at, asignada_at)
            VALUES (:origen, :tel, :motivo, :nombre, :dir, :team, :ag_id, :ag_nombre,
                    :by, :by_nombre, :by_team, :now, :now)
        """), {
            "origen": origen, "tel": telefono, "motivo": motivo, "nombre": nombre,
            "dir": direccion, "team": team, "ag_id": agente["id"],
            "ag_nombre": agente["nombre"], "by": user.get("username"),
            "by_nombre": (yo.get("username") or user.get("username") or "").strip(),
            "by_team": (yo.get("team") or user.get("team") or "").strip(),
            "now": _utcnow(),
        })
        nuevo_id = int(r.lastrowid or 0)
        # Notificación guardada (campana del CRM): le llega al agente aunque en ese momento
        # no esté escuchando el aviso en vivo. old_status «TRANSFERENCIA» la distingue.
        await s.execute(text("""
            INSERT INTO status_notifications
                (seccion, cliente, old_status, new_status, actor, target_agente, target_supervisor, created_at)
            VALUES (:sec, :cli, 'TRANSFERENCIA', 'ASIGNADA', :act, :ag, '', :ts)"""), {
            "sec": _contraria(origen), "cli": nombre[:150],
            "act": (yo.get("username") or user.get("username") or "").strip(),
            "ag": agente["nombre"], "ts": _utcnow()})
        await s.commit()
    # Aviso al agente que la recibe y a los administradores (centro de notificaciones).
    evento = {
        "type": "transferencia_asignada", "id": nuevo_id, "cliente": nombre,
        "seccion": _contraria(origen), "horas": PROTECCION_H, "agente": agente["nombre"],
        "de": (yo.get("username") or user.get("username") or "").strip()}
    await realtime.publish(realtime.canal_usuario(agente["id"]), evento)
    await realtime.publish(realtime.CANAL_ADMIN, evento)
    return {"success": True, "message": "Transferencia registrada",
            "id": nuevo_id, "agente": agente["nombre"], "team": team}


# ── GET /api/transferencias?seccion=residencial&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
@router.get("")
async def listar(seccion: str, desde: str = "", hasta: str = "", buscar: str = "",
                 user: dict = Depends(current_user)):
    """Transferencias en las que participa la sección: hechas desde ella
    (seccion_origen) o recibidas por ella (la contraria las originó).

    Con `buscar` (nombre del cliente, teléfono o ID «TRF-000123») se ignora el rango de fechas, para
    encontrar la venta aunque sea antigua; la visibilidad por rol se mantiene."""
    seccion = _validar_seccion(seccion)
    where = ["1=1"]
    params: dict = {}
    buscar = (buscar or "").strip()[:100]
    if buscar:
        if len(buscar) < 2:
            raise HTTPException(400, "Escribe al menos 2 caracteres para buscar")
        # % y _ son comodines de LIKE: se escapan para buscar el texto tal cual.
        literal = re.sub(r"([\\%_])", r"\\\1", buscar)
        cond = ["t.nombre_cliente LIKE :q_nombre"]
        params["q_nombre"] = f"%{literal}%"
        m_id = _BUSCA_ID.match(buscar.replace(" ", ""))
        if m_id:
            cond.append("t.id = :q_id")
            params["q_id"] = int(m_id.group(1))
        digitos = re.sub(r"\D", "", buscar)
        if len(digitos) >= 3:
            cond.append("t.telefono LIKE :q_tel")
            params["q_tel"] = f"%{digitos}%"
        where.append("(" + " OR ".join(cond) + ")")
    else:
        params.update(_rango_dias_sv(desde, hasta))
        if "desde" in params:
            where.append("t.created_at >= :desde")
        if "hasta" in params:
            where.append("t.created_at < :hasta")

    role = user.get("role", "")
    mi_team = ""
    if not _es_admin_bo(role):
        async with AsyncSessionLocal() as s:
            mi_team = await _mi_team(s, user)
        mi_seccion = team_seccion(mi_team, role) if mi_team else ""
        # Lo que llegó a la sección del usuario lo ve todo ese departamento (con candado
        # mientras está protegido para otro), además de lo que hizo o recibió él / su team.
        depto = "t.seccion_origen <> :mi_sec" if mi_seccion else "0"
        params["mi_sec"] = mi_seccion
        if _es_supervisor(role) and mi_team:
            where.append(f"(t.created_by_team = :team OR t.team_destino = :team OR {depto})")
            params["team"] = mi_team
        else:
            where.append(f"(t.created_by = :yo OR t.agente_destino_id = :yo_id OR {depto})")
            params["yo"] = user.get("username")
            params["yo_id"] = _uid(user)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT t.id, t.seccion_origen, t.telefono, t.motivo, t.nombre_cliente,
                   t.direccion, t.team_destino, t.agente_destino_id,
                   t.agente_destino_nombre, t.created_by, t.created_by_nombre,
                   t.created_by_team, t.resultado, t.resultado_nota, t.lineas,
                   t.captura_file_id, t.resultado_por, t.valor_linea,
                   (t.resultado = 'completada' AND t.moneda_vista_at IS NULL) AS moneda_pendiente,
                   DATE_FORMAT(t.resultado_at, '%Y-%m-%dT%H:%i:%sZ') AS resultado_at,
                   DATE_FORMAT(t.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at,
                   DATE_FORMAT({_FIN_PROTECCION}, '%Y-%m-%dT%H:%i:%sZ') AS protegido_hasta
            FROM transferencias_llamadas t
            WHERE {' AND '.join(where)}
            ORDER BY t.created_at DESC
            LIMIT 500
        """), params)
        filas = [dict(x) for x in r.mappings().all()]
        sup_de = await _supervisor_por_team(s)
    for f in filas:   # para el filtro Supervisor de la página
        f["created_by_supervisor"] = sup_de.get(str(f["created_by_team"] or "").strip().lower(), "")
        f["destino_supervisor"] = sup_de.get(str(f["team_destino"] or "").strip().lower(), "")

    gestion = _es_admin_bo(role)
    yo_id = _uid(user)
    mi_seccion = team_seccion(mi_team, role) if mi_team else ""
    mi_team_sup = mi_team.lower() if _es_supervisor(role) else ""
    for f in filas:
        f["direccion_tipo"] = "enviada" if f["seccion_origen"] == seccion else "recibida"
        f["libre"] = not f["resultado"] and _vencida(f["protegido_hasta"])
        f["valor_linea"] = float(f["valor_linea"]) if f["valor_linea"] is not None else (1.0 if f["resultado"] == "completada" else None)
        # La animación de la moneda es solo para quien transfirió.
        f["moneda_pendiente"] = bool(f["moneda_pendiente"]) and \
            str(f["created_by"] or "").lower() == str(user.get("username") or "").lower()
        mia = f["agente_destino_id"] == yo_id
        # La puede tomar (al vencer la protección) un agente del departamento que la recibió.
        f["tomable"] = (not f["resultado"] and not mia and bool(mi_seccion)
                        and _contraria(f["seccion_origen"]) == mi_seccion)
        # Protegida para otro: sin datos de contacto del cliente.
        if f["tomable"] and not f["libre"] and str(f["created_by"] or "").lower() != str(user.get("username") or "").lower():
            f["telefono"] = f["direccion"] = f["motivo"] = None
            f["protegida_otro"] = True
        fid = f.pop("captura_file_id", None)
        f["captura_url"] = f"/api/files/{fid}/image" if fid else None
        receptor = f["agente_destino_id"] == yo_id or (
            bool(mi_team_sup) and str(f["team_destino"] or "").strip().lower() == mi_team_sup)
        f["puede_registrar"] = gestion or (receptor and f["resultado"] != "completada")
        # Supervisor: puede poner las líneas que falten en las ventas de su team.
        f["puede_lineas"] = (gestion or receptor) and f["resultado"] == "completada" and \
            f["seccion_origen"] == "residencial" and not f["lineas"]
    return {"success": True, "transferencias": filas}


# ── GET /api/transferencias/lineas-pendientes ───────────────────────
@router.get("/lineas-pendientes")
async def lineas_pendientes(user: dict = Depends(current_user)):
    """Ventas completadas que el usuario RECIBIÓ en Líneas antes de que existiera el campo
    de líneas (lineas NULL), de cualquier fecha: la página le obliga a completarlas para
    recalcular lo que se paga por línea."""
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT t.id, t.telefono, t.nombre_cliente, t.direccion, t.created_by_nombre,
                   t.created_by_team, t.captura_file_id,
                   DATE_FORMAT(t.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at
            FROM transferencias_llamadas t
            WHERE t.agente_destino_id = :yo AND t.seccion_origen = 'residencial'
              AND t.resultado = 'completada' AND t.lineas IS NULL
            ORDER BY t.created_at
            LIMIT 200
        """), {"yo": _uid(user)})
        filas = [dict(x) for x in r.mappings().all()]
    for f in filas:
        fid = f.pop("captura_file_id", None)
        f["captura_url"] = f"/api/files/{fid}/image" if fid else None
    return {"success": True, "transferencias": filas}


class LineasIn(BaseModel):
    lineas: int


# ── PUT /api/transferencias/{id}/lineas ─────────────────────────────
@router.put("/{tid}/lineas")
async def registrar_lineas(tid: int, body: LineasIn, user: dict = Depends(current_user)):
    """Solo la cantidad de líneas de una venta completada que llegó a Líneas. El agente que
    la recibió o su supervisor pueden ponerla una vez (si aún falta); admin / back office, siempre."""
    if not 1 <= body.lineas <= _MAX_LINEAS:
        raise HTTPException(400, f"La cantidad de líneas va de 1 a {_MAX_LINEAS}")
    gestion = _es_admin_bo(user.get("role", ""))
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT seccion_origen, agente_destino_id, team_destino, resultado, lineas
            FROM transferencias_llamadas WHERE id = :id
        """), {"id": tid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Transferencia no encontrada")
        if row["resultado"] != "completada" or _contraria(row["seccion_origen"]) != "lineas":
            raise HTTPException(400, "Solo las ventas completadas que llegaron a Líneas llevan líneas")
        if not gestion:
            if not await _puede_cerrar(s, user, row):
                raise HTTPException(403, "Solo el agente que recibió la transferencia o su supervisor pueden indicar las líneas")
            if row["lineas"] is not None:
                raise HTTPException(403, "Las líneas ya están registradas; solo administración o back office pueden cambiarlas")
        await s.execute(text("UPDATE transferencias_llamadas SET lineas = :n WHERE id = :id"),
                        {"n": body.lineas, "id": tid})
        await s.commit()
    return {"success": True, "message": "Líneas registradas"}


class ResultadoIn(BaseModel):
    resultado: str
    captura_url: Optional[str] = Field(None, max_length=200)
    nota: Optional[str] = Field(None, max_length=500)
    lineas: Optional[int] = None


# ── PUT /api/transferencias/{id}/resultado ──────────────────────────
@router.put("/{tid}/resultado")
async def registrar_resultado(tid: int, body: ResultadoIn, user: dict = Depends(current_user)):
    resultado = str(body.resultado or "").strip().lower()
    if resultado not in RESULTADOS:
        raise HTTPException(400, "Resultado inválido")
    gestion = _es_admin_bo(user.get("role", ""))
    username = str(user.get("username") or "")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT seccion_origen, agente_destino_id, team_destino, resultado, captura_file_id,
                   created_at, valor_linea
            FROM transferencias_llamadas WHERE id = :id
        """), {"id": tid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Transferencia no encontrada")
        if not gestion and not await _puede_cerrar(s, user, row):
            raise HTTPException(403, "Solo el agente que recibió la transferencia o su supervisor pueden registrar el resultado")
        if not gestion and row["resultado"] == "completada":
            raise HTTPException(403, "Ya está registrada como venta completada; solo administración o back office pueden cambiarla")

        captura_id = row["captura_file_id"]
        url = (body.captura_url or "").strip()
        if url:
            m = _URL_CAPTURA.match(url)
            if not m:
                raise HTTPException(400, "La captura debe subirse al CRM como imagen")
            fid = int(m.group(1))
            r = await s.execute(text("""
                SELECT uploaded_by, content_type FROM note_files WHERE id = :id
            """), {"id": fid})
            arch = r.mappings().first()
            # Solo una imagen que haya subido el propio usuario: no se puede
            # adjuntar el archivo de otro adivinando su id.
            if (not arch or str(arch["uploaded_by"] or "") != username
                    or not str(arch["content_type"] or "").startswith("image/")):
                raise HTTPException(400, "Captura no válida")
            captura_id = fid
        if resultado == "completada" and not captura_id:
            raise HTTPException(400, "Para registrar la venta completada sube la captura de la venta cerrada")

        # Solo una venta completada que llegó a Líneas (origen residencial) lleva líneas.
        lineas = None
        if resultado == "completada" and _contraria(row["seccion_origen"]) == "lineas":
            lineas = body.lineas
            if not isinstance(lineas, int) or not 1 <= lineas <= _MAX_LINEAS:
                raise HTTPException(400, f"Indica la cantidad de líneas vendidas (1 a {_MAX_LINEAS})")

        nota = (body.nota or "").strip() or None
        ahora = _utcnow()
        # Valor de cada línea para quien transfirió: se fija la primera vez que pasa a
        # «Venta completada», según lo que tardó desde la transferencia (valor_por_linea).
        valor = row["valor_linea"]
        if resultado == "completada" and row["resultado"] != "completada":
            valor = valor_por_linea(row["created_at"], ahora)
        elif resultado != "completada":
            valor = None
        await s.execute(text("""
            UPDATE transferencias_llamadas
               SET resultado = :res, resultado_nota = :nota, captura_file_id = :cap,
                   lineas = :lineas, resultado_por = :por, resultado_at = :now,
                   valor_linea = :valor,
                   moneda_vista_at = IF(:nueva_venta = 1, NULL, moneda_vista_at)
             WHERE id = :id
        """), {"res": resultado, "nota": nota, "cap": captura_id, "lineas": lineas,
               "por": (user.get("name") or username).strip(), "now": ahora, "valor": valor, "id": tid,
               # Recién pasa a venta completada: quien transfirió verá la moneda al entrar.
               "nueva_venta": int(resultado == "completada" and row["resultado"] != "completada")})
        await s.commit()
    return {"success": True, "message": RESULTADOS[resultado]}
