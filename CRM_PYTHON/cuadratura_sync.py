"""Envío de horarios de agentes al Sistema de Cuadratura (marcación / planillas).

Los supervisores cargan los horarios en /horarios.html (tabla agent_schedules). Este
módulo arma el paquete de una semana (lunes–domingo) y lo envía por HTTPS a
POST {CUADRATURA_URL}/api/integrations/crm/schedules con la clave X-API-Key.

Cuándo se envía:
- Automático (bucle_envio_horarios): cada 15 min se revisa la semana actual y, desde
  el sábado, la siguiente. Solo se envía si el contenido cambió desde el último envío
  exitoso de esa semana (se compara un hash). Así el envío del fin de semana sale solo
  y las correcciones de un supervisor llegan en minutos sin reenviar lo mismo.
- Manual: botón "Enviar ahora" en /horarios.html (POST /api/horarios/enviar).

Variables de entorno:
  CUADRATURA_URL       p.ej. https://asistencia.connecting.com  (sin / final)
  CUADRATURA_API_KEY   clave cnx_… generada en Cuadratura → Integración CRM
  CUADRATURA_SYNC      1 (defecto) activa el envío automático; 0 lo apaga
Contrato completo: docs de Cuadratura, "integracion-crm.md".
"""
import asyncio
import hashlib
import json
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import text

from database_mysql import AsyncSessionLocal

TZ = ZoneInfo("America/El_Salvador")
INTERVALO_SEG = 15 * 60


def configurado() -> bool:
    return bool(os.getenv("CUADRATURA_URL") and os.getenv("CUADRATURA_API_KEY"))


def lunes_de(d: date) -> date:
    return d - timedelta(days=d.weekday())


def hoy_sv() -> date:
    return datetime.now(TZ).date()


def es_agente(role: str) -> bool:
    import unicodedata
    r = unicodedata.normalize("NFD", str(role or "")).encode("ascii", "ignore").decode().lower()
    if any(x in r for x in ("admin", "backoffice", "supervisor")):
        return False
    return any(x in r for x in ("agente", "vendedor", "agent", "seller"))


# Equipos que Permisos (crear-cuenta.html, _HIDDEN_TEAMS) trata como "sin equipo".
_EQUIPOS_OCULTOS = {"backoffice"}


def tiene_equipo(team: str) -> bool:
    """¿Tiene equipo según Permisos? Quien no lo tiene no sale en Horarios ni viaja a Cuadratura."""
    t = str(team or "").strip()
    return bool(t) and t.lower() not in _EQUIPOS_OCULTOS


def clave_equipo(team: str) -> str:
    """'TEAM Miguel Nuñez' y 'miguel nunez' → 'miguelnunez' (para comparar equipos)."""
    import re
    import unicodedata
    s = unicodedata.normalize("NFD", str(team or "")).encode("ascii", "ignore").decode().lower().strip()
    s = re.sub(r"^team\s+", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def _es_supervisor_rol(role: str) -> bool:
    import unicodedata
    r = unicodedata.normalize("NFD", str(role or "")).encode("ascii", "ignore").decode().lower()
    return "supervisor" in r and not any(x in r for x in ("admin", "backoffice", "back office"))


def _es_backoffice(role: str) -> bool:
    import unicodedata
    r = unicodedata.normalize("NFD", str(role or "")).encode("ascii", "ignore").decode().lower()
    return "backoffice" in r or "back office" in r


def agentes_de_equipos(usuarios) -> list:
    """Todo el personal de los equipos de venta (Residencial y Líneas), es decir, equipos
    que tienen un supervisor: agentes, el propio supervisor y quien tenga otro rol pero
    pertenezca al equipo (p.ej. un agente con rol Administrador). Quedan fuera Backoffice,
    Administración y los que no tienen equipo."""
    usuarios = list(usuarios)
    con_sup = {clave_equipo(u["team"]) for u in usuarios
               if _es_supervisor_rol(u["role"]) and clave_equipo(u["team"])}
    return [u for u in usuarios
            if clave_equipo(u["team"]) in con_sup and not _es_backoffice(u["role"])]


_PARTICULAS = {"de", "del", "la", "las", "los", "y"}


def _separar_nombre(nombre: str) -> tuple[str, str]:
    # «de», «del», «la»… van pegadas a la palabra siguiente: «Emanuel De Jesús
    # Velásquez Hernández» → nombres «Emanuel De Jesús», apellidos «Velásquez Hernández».
    partes: list[str] = []
    pendiente = ""
    for p in (nombre or "").split():
        if p.lower() in _PARTICULAS:
            pendiente = f"{pendiente} {p}".strip()
            continue
        partes.append(f"{pendiente} {p}".strip())
        pendiente = ""
    if pendiente:
        partes.append(pendiente)
    if not partes:
        return "Sin", "Nombre"
    if len(partes) == 1:
        return partes[0], "-"
    # 4 o más: los 2 últimos son apellidos («Carlos Alberto Pérez López»); si no, 1 nombre.
    corte = len(partes) - 2 if len(partes) >= 4 else 1
    return " ".join(partes[:corte]), " ".join(partes[corte:])


def _hhmm(v) -> str | None:
    """TIME de MySQL llega como timedelta; se normaliza a 'HH:MM'."""
    if v is None:
        return None
    if isinstance(v, timedelta):
        total = int(v.total_seconds())
        return f"{(total // 3600) % 24:02d}:{(total % 3600) // 60:02d}"
    return str(v)[:5]


async def armar_paquete(inicio: date) -> dict:
    """Paquete de la semana: TODO el personal activo con equipo (como en /horarios.html), cada
    uno con su equipo exacto de Permisos (campaign), tenga o no horario cargado. Así en Cuadratura cada
    empleado queda en su team aunque esa semana aún no tenga turnos. (Hasta el 07-10-2026
    solo viajaban los teams de venta.)

    (Hasta el 05-10-2026 solo iban los que tenían horario, porque Cuadratura creaba fichas
    vacías. Desde su commit a27cef7 ya no las crea: al agente que no está en Empleados lo
    rechaza con un aviso para que RRHH lo registre.)

    Va con roster_complete=True porque siempre se arma con la semana ENTERA de todos
    los teams: a quien estaba en un envío anterior y ya no viene (salió del team),
    Cuadratura le libera los turnos que vinieron del CRM, respetando los ajustes
    manuales de RRHH."""
    fin = inicio + timedelta(days=6)
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, username, name, nombre_completo, fecha_ingreso, role, team, supervisor, reloj_id
            FROM users WHERE COALESCE(active, 1) = 1
        """))
        # Todo el personal activo CON equipo, igual que /horarios.html (los equipos de
        # Permisos): Horarios del CRM y de Cuadratura muestran a las mismas personas. Quien
        # no tiene equipo no viaja.
        usuarios = [dict(u) for u in r.mappings().all() if tiene_equipo(u["team"])]
        r = await s.execute(text("""
            SELECT user_id, work_date, start_time, end_time, break_minutes, rest_day, notes
            FROM agent_schedules WHERE work_date BETWEEN :i AND :f
            ORDER BY user_id, work_date
        """), {"i": inicio, "f": fin})
        filas = r.mappings().all()

    por_usuario: dict[int, list] = {}
    for f in filas:
        turno = {"date": f["work_date"].isoformat()}
        if f["rest_day"]:
            turno["rest_day"] = True
        else:
            turno.update(start=_hhmm(f["start_time"]), end=_hhmm(f["end_time"]),
                         break_minutes=int(f["break_minutes"] or 0))
        if f["notes"]:
            turno["notes"] = f["notes"][:500]
        por_usuario.setdefault(int(f["user_id"]), []).append(turno)

    # Ordenados por team, igual que en /horarios.html: Residencial y luego Líneas; dentro,
    # team por team, con el supervisor primero y sus agentes por nombre.
    from deps import team_seccion

    def _orden(u):
        return (team_seccion(u["team"]) != "residencial", clave_equipo(u["team"]),
                not _es_supervisor_rol(u["role"]), (u["name"] or u["username"] or "").strip().lower())

    agentes = []
    for u in sorted(usuarios, key=_orden):
        nombre, apellido = _separar_nombre(u["nombre_completo"] or u["name"] or u["username"])
        agente = {
            "crm_agent_id": str(u["id"]),
            "badge_number": (u["reloj_id"] or None),
            "first_name": nombre[:100],
            "last_name": apellido[:100],
            "campaign": (u["team"] or None) and u["team"][:120],
            "supervisor": (u["supervisor"] or None) and u["supervisor"][:160],
            "shifts": por_usuario.get(int(u["id"]), []),
        }
        if u["fecha_ingreso"]:
            agente["hire_date"] = u["fecha_ingreso"].isoformat()
        agentes.append(agente)
    return {"date_from": inicio.isoformat(), "date_to": fin.isoformat(), "roster_complete": True,
            "agents": agentes}


def _hash(paquete: dict) -> str:
    return hashlib.sha256(json.dumps(paquete, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def _ultimo_hash_ok(inicio: date) -> str | None:
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT payload_hash FROM cuadratura_envios
            WHERE date_from = :i AND estado IN ('ok', 'parcial')
            ORDER BY id DESC LIMIT 1
        """), {"i": inicio})
        return r.scalar()


async def _registrar(inicio: date, h: str, estado: str, http_status, agentes: int,
                     resumen, error, origen: str, por: str | None) -> dict:
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO cuadratura_envios
                (date_from, date_to, payload_hash, estado, http_status, agentes, resumen, error, origen, enviado_por)
            VALUES (:i, :f, :h, :e, :hs, :a, :r, :err, :o, :por)
        """), {"i": inicio, "f": inicio + timedelta(days=6), "h": h, "e": estado, "hs": http_status,
               "a": agentes, "r": json.dumps(resumen, ensure_ascii=False) if resumen else None,
               "err": (error or "")[:2000] or None, "o": origen, "por": por})
        await s.commit()
    return {"estado": estado, "http_status": http_status, "resumen": resumen, "error": error}


async def enviar_semana(inicio: date, origen: str = "manual", por: str | None = None,
                        solo_si_cambio: bool = False) -> dict:
    """Envía la semana que empieza en `inicio` (lunes). Devuelve el resultado registrado."""
    inicio = lunes_de(inicio)
    if not configurado():
        return {"estado": "sin_configurar",
                "error": "Faltan CUADRATURA_URL y CUADRATURA_API_KEY en el .env del CRM"}

    paquete = await armar_paquete(inicio)
    h = _hash(paquete)
    if solo_si_cambio and h == await _ultimo_hash_ok(inicio):
        return {"estado": "sin_cambios"}
    if not paquete["agents"]:
        return {"estado": "sin_agentes"}

    url = os.getenv("CUADRATURA_URL", "").rstrip("/") + "/api/integrations/crm/schedules"
    headers = {
        "X-API-Key": os.getenv("CUADRATURA_API_KEY", ""),
        "Idempotency-Key": f"crm-{inicio.isoformat()}-{h[:24]}",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as cli:
            resp = await cli.post(url, json=paquete, headers=headers)
    except httpx.HTTPError as e:
        return await _registrar(inicio, h, "error", None, len(paquete["agents"]), None,
                                f"No se pudo conectar con Cuadratura: {e}", origen, por)

    try:
        cuerpo = resp.json()
    except ValueError:
        cuerpo = {"detail": resp.text[:500]}
    if resp.status_code != 200:
        detalle = cuerpo.get("detail") if isinstance(cuerpo, dict) else cuerpo
        return await _registrar(inicio, h, "error", resp.status_code, len(paquete["agents"]), None,
                                json.dumps(detalle, ensure_ascii=False)[:2000], origen, por)

    # Se guarda un resumen: contadores + solo los agentes con error o conflicto.
    resumen = {k: cuerpo.get(k) for k in ("sync_id", "employees_created", "shifts_created",
                                          "shifts_updated", "shifts_removed", "conflicts", "errors")}
    resumen["observaciones"] = [a for a in cuerpo.get("agents", []) if a.get("status") != "ok"][:200]
    return await _registrar(inicio, h, cuerpo.get("status", "ok"), 200, len(paquete["agents"]),
                            resumen, None, origen, por)


async def bucle_envio_horarios():
    """Tarea de fondo (solo en la instancia dueña del esquema, igual que el semáforo)."""
    if os.getenv("CUADRATURA_SYNC", "1").strip().lower() in ("0", "false", "no"):
        print("[cuadratura] envío automático desactivado (CUADRATURA_SYNC=0)")
        return
    await asyncio.sleep(60)  # dejar terminar el arranque
    while True:
        try:
            if configurado():
                hoy = hoy_sv()
                semanas = [lunes_de(hoy)]
                if hoy.weekday() >= 5:  # sábado o domingo → también la semana siguiente
                    semanas.append(lunes_de(hoy) + timedelta(days=7))
                for inicio in semanas:
                    res = await enviar_semana(inicio, origen="auto", solo_si_cambio=True)
                    if res.get("estado") not in ("sin_cambios", "sin_agentes"):
                        print(f"[cuadratura] semana {inicio}: {res.get('estado')} {res.get('error') or ''}")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # nunca tumbar la tarea
            print(f"[cuadratura] error en el bucle de envío: {e}")
        await asyncio.sleep(INTERVALO_SEG)
