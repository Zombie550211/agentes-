"""Horarios de agentes.

Desde el 13-10-2026 la página /horarios.html muestra el horario TAL COMO ESTÁ EN EL SISTEMA
DE CUADRATURA (GET /api/horarios/cuadratura, que lee su /api/integrations/crm/schedules-week):
sus empleados, turnos y días sin turno. Cuadratura además los devuelve al CRM
(cuadratura_entrada.py → agent_schedules).

Asignar (POST /api/horarios/cuadratura/dia, se escribe al momento en Cuadratura):
- Un día VACÍO se asigna una sola vez: el supervisor (su team, de hoy en adelante), back
  office o administración.
- Un día ya asignado solo lo cambia o quita administración (aquí) o RRHH (en Cuadratura).

Quién ve qué en /api/horarios/cuadratura:
- Admin / Back Office: todo el personal activo de Cuadratura.
- Supervisor y agente: solo el cuadro de su team. El team es el de su ficha en Cuadratura
  (crm_agent_id = users.id); si aún no tiene ficha, el de Permisos (users.team).

Lo demás de este módulo es lo anterior a ese cambio y sigue en uso por el envío del CRM a
Cuadratura (cuadratura_sync.py): GET /semana (agent_schedules del CRM, mismas reglas de
alcance por team), el envío manual y su historial, y los datos de la ficha:
- Nombre completo (users.nombre_completo): el nombre legal; va a Cuadratura al crear el empleado.
- Fecha de ingreso (users.fecha_ingreso): va a Cuadratura como hire_date.
- ID de reloj (users.reloj_id): el número con el que el agente marca en el reloj biométrico.
"""
import hashlib
import os
import re
import time as time_mod
import unicodedata
from datetime import date, time, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import audit
import cuadratura_sync as cs
from database_mysql import AsyncSessionLocal
from deps import ADMIN_ROLES, current_user, team_seccion

router = APIRouter(prefix="/api/horarios", tags=["Horarios"])

_RELOJ = re.compile(r"^[0-9A-Za-z]{1,32}$")


# ── Roles y alcance ─────────────────────────────────────────────
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().strip()
    s = re.sub(r"^team\s+", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def _rol(user: dict) -> str:
    return unicodedata.normalize("NFD", str(user.get("role") or "")).encode("ascii", "ignore").decode().lower()


def _es_admin_bo(user: dict) -> bool:
    r = _rol(user)
    return "admin" in r or "backoffice" in r or "back office" in r


def _es_supervisor(user: dict) -> bool:
    return "supervisor" in _rol(user) and not _es_admin_bo(user)


# Orden de las secciones en la tabla.
_ORDEN_SECCION = {"residencial": 0, "lineas": 1, "apoyo": 2}


def _grupo(a: dict) -> str:
    """Clave del grupo de la tabla: el equipo de Permisos (users.team)."""
    return _norm(a["team"])


def _grupo_label(a: dict) -> str:
    return (a["team"] or "").strip()


def _seccion(a: dict, teams_venta: set[str]) -> str:
    """residencial / lineas para los equipos de venta (los que tienen supervisor);
    "apoyo" para el resto (Administración, Backoffice, USA…)."""
    if cs.clave_equipo(a["team"]) not in teams_venta:
        return "apoyo"
    return team_seccion(a["team"])


def _teams_venta(usuarios) -> set[str]:
    return {cs.clave_equipo(u["team"]) for u in usuarios
            if cs._es_supervisor_rol(u["role"]) and cs.clave_equipo(u["team"])}


async def _agentes_visibles(s, user: dict, equipo: str = "") -> list[dict]:
    r = await s.execute(text("""
        SELECT id, username, name, nombre_completo, fecha_ingreso, role, team, supervisor, reloj_id
        FROM users WHERE COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1 ORDER BY name
    """))
    # Solo usuarios del CRM (acceso_crm = 0 = empleado sin usuario: no sale).
    # Horarios refleja los equipos de Permisos: entra todo el personal activo que tenga
    # equipo, sea cual sea su rol; quien no tiene equipo no aparece en ningún caso. Los
    # equipos sin supervisor solo los ve (y edita) administración / back office. A
    # Cuadratura viaja el mismo personal (cuadratura_sync.armar_paquete).
    todos = [dict(u) for u in r.mappings().all()]
    agentes = [u for u in todos if cs.tiene_equipo(u.get("team"))]
    if _es_admin_bo(user):
        if equipo:
            agentes = [a for a in agentes if _norm(_grupo_label(a)) == _norm(equipo)]
        return agentes
    # Supervisor y agente: solo su propio team. El vínculo fiable es users.team (el
    # supervisor y sus agentes lo comparten, p.ej. Eduardo Nuñez → "TEAM MIGUEL NUÑEZ").
    yo = next((u for u in todos if str(u["id"]) == str(user.get("id"))), None)
    team_propio = (yo or {}).get("team") or user.get("team")
    mi_team = _norm(team_propio) if cs.tiene_equipo(team_propio) else ""
    if mi_team:
        return [a for a in agentes if _norm(a["team"]) == mi_team]
    return []  # sin equipo no se muestra nada


async def _supervisores_por_equipo(s) -> dict[str, str]:
    """Clave normalizada del equipo → nombre(s) de su supervisor, para agrupar la tabla."""
    r = await s.execute(text("""
        SELECT name, username, role, team FROM users
        WHERE COALESCE(active, 1) = 1 AND team IS NOT NULL AND team <> ''
        ORDER BY name
    """))
    sups: dict[str, list[str]] = {}
    for u in r.mappings().all():
        if _es_supervisor(dict(u)):
            sups.setdefault(_norm(u["team"]), []).append(u["name"] or u["username"])
    return {k: " / ".join(v) for k, v in sups.items()}


def _lunes(valor: Optional[str]) -> date:
    if not valor:
        return cs.lunes_de(cs.hoy_sv())
    try:
        return cs.lunes_de(date.fromisoformat(valor[:10]))
    except ValueError:
        raise HTTPException(400, "Fecha inválida, use AAAA-MM-DD")


_COLS_DIA = "user_id, work_date, start_time, end_time, break_minutes, rest_day, notes"


def _dia_json(f) -> dict:
    return {
        "start": cs._hhmm(f["start_time"]),
        "end": cs._hhmm(f["end_time"]),
        "break_minutes": int(f["break_minutes"] or 0),
        "rest_day": bool(f["rest_day"]),
        "notes": f["notes"],
    }


def _versiones(filas) -> dict[int, str]:
    """user_id → huella de sus días en la semana (la misma en GET y en PUT)."""
    por_agente: dict[int, list] = {}
    for f in filas:
        d = _dia_json(f)
        por_agente.setdefault(int(f["user_id"]), []).append(
            (f["work_date"].isoformat(), d["start"], d["end"], d["break_minutes"], d["rest_day"], d["notes"]))
    return {u: hashlib.sha256(repr(sorted(v)).encode()).hexdigest()[:16] for u, v in por_agente.items()}


_VERSION_VACIA = ""  # agente sin ningún día cargado en la semana


def _ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else "")


# ── Modelos ─────────────────────────────────────────────────────
class RelojIn(BaseModel):
    reloj_id: Optional[str] = None

    @field_validator("reloj_id")
    @classmethod
    def _v(cls, v):
        if v is None or not str(v).strip():
            return None
        v = str(v).strip()
        if not _RELOJ.match(v):
            raise ValueError("El ID de reloj solo admite letras y números")
        return v.lstrip("0") or "0"  # el reloj rellena con ceros: '0083' = '83'


class NombreIn(BaseModel):
    nombre_completo: Optional[str] = Field(default=None, max_length=160)

    @field_validator("nombre_completo")
    @classmethod
    def _v(cls, v):
        v = " ".join(str(v or "").split())
        if v and not re.fullmatch(r"[^\W\d_]+(?:[ '.-][^\W\d_]+)*", v):
            raise ValueError("El nombre completo solo admite letras, espacios, guion y apóstrofo")
        return v or None


class IngresoIn(BaseModel):
    fecha_ingreso: Optional[date] = None

    @field_validator("fecha_ingreso")
    @classmethod
    def _v(cls, v):
        if v and not (date(1990, 1, 1) <= v <= cs.hoy_sv() + timedelta(days=366)):
            raise ValueError("Fecha de ingreso fuera de rango")
        return v


class EnviarIn(BaseModel):
    inicio: date


# ── Endpoints ───────────────────────────────────────────────────
@router.get("/semana")
async def ver_semana(inicio: Optional[str] = Query(None), equipo: str = Query(""),
                     user: dict = Depends(current_user)):
    lunes = _lunes(inicio)
    fin = lunes + timedelta(days=6)
    async with AsyncSessionLocal() as s:
        agentes = await _agentes_visibles(s, user, equipo)
        ids = [a["id"] for a in agentes] or [0]
        r = await s.execute(text(f"""
            SELECT {_COLS_DIA} FROM agent_schedules
            WHERE work_date BETWEEN :i AND :f AND user_id IN ({",".join(str(int(i)) for i in ids)})
        """), {"i": lunes, "f": fin})
        filas = r.mappings().all()
        ultimo = None
        if _es_admin_bo(user) or _es_supervisor(user):
            r = await s.execute(text("""
                SELECT id, estado, http_status, agentes, resumen, error, origen, enviado_por, created_at
                FROM cuadratura_envios WHERE date_from = :i ORDER BY id DESC LIMIT 1
            """), {"i": lunes})
            ultimo = r.mappings().first()
        sups = await _supervisores_por_equipo(s)
        r = await s.execute(text("SELECT role, team FROM users WHERE COALESCE(active, 1) = 1"))
        teams_venta = _teams_venta([dict(u) for u in r.mappings().all()])

    # Grupos por equipo (el vínculo agente ↔ supervisor es users.team): Residencial y luego Líneas.
    yo = next((a for a in agentes if str(a["id"]) == str(user.get("id"))), None)
    mi_clave = _norm((yo or {}).get("team") or user.get("team"))
    grupos: dict[str, dict] = {}
    for a in agentes:
        clave = _grupo(a)
        grupos.setdefault(clave, {"clave": clave, "team": _grupo_label(a),
                                  "seccion": _seccion(a, teams_venta), "supervisor": sups.get(clave)})
    # Residencial, Líneas y Administración y apoyo; dentro, por nombre de equipo.
    grupos_ordenados = sorted(grupos.values(),
                              key=lambda g: (_ORDEN_SECCION.get(g["seccion"], 9), g["team"].lower()))

    dias_por_agente: dict[int, dict] = {}
    for f in filas:
        dias_por_agente.setdefault(int(f["user_id"]), {})[f["work_date"].isoformat()] = _dia_json(f)
    versiones = _versiones(filas)

    equipos = sorted({_grupo_label(a) for a in agentes}) if _es_admin_bo(user) else []
    if _es_admin_bo(user) and equipo:
        async with AsyncSessionLocal() as s:  # lista completa para el filtro
            equipos = sorted({_grupo_label(a) for a in await _agentes_visibles(s, user)})

    puede_editar = _es_admin_bo(user) or _es_supervisor(user)

    def _privado(a: dict, valor):
        # Quien no edita (agente) solo ve el ID de reloj y la fecha de ingreso propios.
        return valor if puede_editar or str(a["id"]) == str(user.get("id")) else None

    return {
        "success": True,
        "inicio": lunes.isoformat(),
        "fin": fin.isoformat(),
        "hoy": cs.hoy_sv().isoformat(),
        "dias": [(lunes + timedelta(days=i)).isoformat() for i in range(7)],
        "puede_editar": puede_editar,
        "editable_desde": None if _es_admin_bo(user) else cs.hoy_sv().isoformat(),
        "es_admin": _es_admin_bo(user),
        # Sólo administración (no backoffice): puede eliminar empleados, como en Permisos
        # (DELETE /api/users/{id} exige ADMIN_ROLES).
        "es_administrador": _rol(user).strip() in {r.lower() for r in ADMIN_ROLES},
        "yo": user.get("id"),
        "cuadratura_configurada": cs.configurado(),
        "equipos": equipos,
        "ultimo_envio": _envio_json(ultimo) if ultimo else None,
        "grupos": grupos_ordenados,
        "agentes": [{
            "id": a["id"],
            "name": a["name"] or a["username"],
            "username": a["username"],
            "team": a["team"],
            "grupo": _grupo(a),
            "es_supervisor": cs._es_supervisor_rol(a["role"]),
            "supervisor": a["supervisor"],
            "reloj_id": _privado(a, a["reloj_id"]),
            "nombre_completo": a["nombre_completo"],
            "fecha_ingreso": _privado(a, a["fecha_ingreso"].isoformat() if a["fecha_ingreso"] else None),
            "dias": dias_por_agente.get(int(a["id"]), {}),
            "version": versiones.get(int(a["id"]), _VERSION_VACIA),
        } for a in agentes],
    }


_CACHE_CUADRATURA: dict[date, tuple[float, dict]] = {}
# Corta: la página se actualiza sola cada 15 s y un cambio de RRHH debe verse en ese plazo.
_CACHE_SEGUNDOS = 10


def vaciar_cache_cuadratura() -> None:
    """Lo llama cuadratura_entrada.py al recibir un cambio de RRHH."""
    _CACHE_CUADRATURA.clear()


def _cuadratura_url(ruta: str) -> str:
    if not cs.configurado():
        raise HTTPException(503, "Falta CUADRATURA_URL y CUADRATURA_API_KEY en el .env del CRM")
    return os.getenv("CUADRATURA_URL", "").rstrip("/") + ruta


async def _semana_cuadratura(lunes: date, fresca: bool = False) -> dict:
    """La semana tal como está en Cuadratura (GET /api/integrations/crm/schedules-week).
    Se guarda 10 s para que muchos agentes con Horarios abierto no carguen a Cuadratura;
    `fresca` la vuelve a pedir (para comprobar permisos antes de escribir)."""
    guardado = _CACHE_CUADRATURA.get(lunes)
    if guardado and not fresca and time_mod.monotonic() - guardado[0] < _CACHE_SEGUNDOS:
        return guardado[1]
    url = _cuadratura_url("/api/integrations/crm/schedules-week")
    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.get(url, params={"date_from": lunes.isoformat()},
                              headers={"X-API-Key": os.getenv("CUADRATURA_API_KEY", "")})
        r.raise_for_status()
        datos = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(502, f"No se pudo leer el horario del Sistema de Cuadratura ({type(e).__name__})")
    _CACHE_CUADRATURA[lunes] = (time_mod.monotonic(), datos)
    for k in [k for k, (t, _) in _CACHE_CUADRATURA.items() if time_mod.monotonic() - t > 600]:
        _CACHE_CUADRATURA.pop(k, None)
    return datos


def _es_administrador(user: dict) -> bool:
    """Rol de administración estricto (sin back office): el único que cambia un día ya asignado."""
    return _rol(user).strip() in {r.lower() for r in ADMIN_ROLES}


async def _vista_cuadratura(datos: dict, user: dict) -> tuple[list[dict], Optional[str], Optional[dict]]:
    """(empleados que ve este usuario, su team, su propia ficha).

    Administración / back office ven a todo el personal; supervisores y agentes, solo el
    cuadro de su team. El team sale de la ficha de Cuadratura enlazada a este usuario
    (crm_agent_id = users.id); si aún no tiene ficha, del team de Permisos."""
    empleados = datos.get("employees") or []
    es_admin = _es_admin_bo(user)
    yo = next((e for e in empleados if str(e.get("crm_agent_id") or "") == str(user.get("id"))), None)
    mi_team = None
    if not es_admin:
        mi_team = (yo or {}).get("team")
        if not mi_team:
            async with AsyncSessionLocal() as s:
                r = await s.execute(text("SELECT team FROM users WHERE id = :i"), {"i": user.get("id")})
                team_crm = r.scalar() or user.get("team")
            if cs.tiene_equipo(team_crm):
                mi_team = next((e["team"] for e in empleados
                                if e.get("team") and _norm(e["team"]) == _norm(team_crm)), None)
        empleados = [e for e in empleados if mi_team and e.get("team") == mi_team]
    return empleados, mi_team, yo


@router.get("/cuadratura")
async def ver_semana_cuadratura(inicio: Optional[str] = Query(None), user: dict = Depends(current_user)):
    """Horarios de la semana leídos del Sistema de Cuadratura (ver _vista_cuadratura)."""
    lunes = _lunes(inicio)
    datos = await _semana_cuadratura(lunes)
    empleados, mi_team, yo = await _vista_cuadratura(datos, user)
    es_admin = _es_admin_bo(user)
    ids = {e["id"] for e in empleados}
    return {
        "success": True,
        "inicio": lunes.isoformat(),
        "hoy": str(datos.get("today") or cs.hoy_sv().isoformat()),
        "dias": [(lunes + timedelta(days=i)).isoformat() for i in range(7)],
        "es_admin": es_admin,
        "mi_team": mi_team,
        "yo": (yo or {}).get("id"),
        # Asignar un día vacío: supervisor (su team, de hoy en adelante), back office y
        # administración. Cambiar o quitar un día ya asignado: solo administración.
        "puede_asignar": es_admin or _es_supervisor(user),
        "puede_cambiar": _es_administrador(user),
        "editable_desde": None if _es_administrador(user) else cs.hoy_sv().isoformat(),
        "empleados": [{k: e.get(k) for k in ("id", "full_name", "team", "section", "is_supervisor", "position", "area")}
                      for e in empleados],
        "turnos": [a for a in datos.get("assignments") or [] if a.get("employee_id") in ids],
        "libres": [d for d in datos.get("days_off") or [] if d.get("employee_id") in ids],
    }


class DiaCuadraturaIn(BaseModel):
    employee_id: int
    fecha: date
    tipo: str = Field(pattern="^(turno|quitar|libre|vacacion|compensatorio|incapacidad|suspendido|baja)$")
    start: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    break_minutes: int = Field(default=60, ge=0, le=480)
    notes: Optional[str] = Field(default=None, max_length=500)


@router.post("/cuadratura/dia")
async def asignar_dia_cuadratura(body: DiaCuadraturaIn, request: Request, user: dict = Depends(current_user)):
    """Asigna el horario de un día y lo escribe al momento en Cuadratura (no hay botón de envío).

    - Supervisor / back office: solo un día VACÍO (sin turno ni día libre), una vez; el
      supervisor, de su team y de hoy en adelante. Cuadratura lo rechaza con 409 si ya
      tiene algo, así que dos personas a la vez no se pisan.
    - Administración: cualquier día, también cambiarlo o quitarlo («quitar»).
    Después lo cambia RRHH en Cuadratura, que lo devuelve al CRM (cuadratura_entrada.py)."""
    admin = _es_administrador(user)
    if not (admin or _es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "Solo supervisores y administración asignan horarios")
    if body.tipo == "quitar" and not admin:
        raise HTTPException(403, "Solo administración puede quitar un horario")
    if not admin and body.fecha < cs.hoy_sv():
        raise HTTPException(400, "Ese día ya pasó: lo corrige administración o RRHH en Cuadratura")
    lunes = cs.lunes_de(body.fecha)
    visibles, _, _ = await _vista_cuadratura(await _semana_cuadratura(lunes, fresca=True), user)
    if body.employee_id not in {e["id"] for e in visibles}:
        raise HTTPException(403, "Esa persona no es de su team")

    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.post(_cuadratura_url("/api/integrations/crm/schedule-day"),
                               headers={"X-API-Key": os.getenv("CUADRATURA_API_KEY", "")},
                               json={"employee_id": body.employee_id, "work_date": body.fecha.isoformat(),
                                     "kind": body.tipo, "start_time": body.start, "end_time": body.end,
                                     "break_minutes": body.break_minutes, "notes": body.notes,
                                     "only_if_empty": not admin, "by": user.get("username") or str(user.get("id"))})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"No se pudo guardar en el Sistema de Cuadratura ({type(e).__name__})")
    _CACHE_CUADRATURA.pop(lunes, None)
    if r.status_code in (404, 409, 422):
        try:
            detalle = r.json().get("detail")
        except ValueError:
            detalle = None
        raise HTTPException(r.status_code, detalle if isinstance(detalle, str) else "Cuadratura rechazó el horario")
    if r.status_code >= 400:
        raise HTTPException(502, f"El Sistema de Cuadratura respondió {r.status_code}")
    audit._log("horarios_asignar", user.get("username", ""), _ip(request),
               {"empleado_cuadratura": body.employee_id, "fecha": body.fecha.isoformat(), "tipo": body.tipo,
                "start": body.start, "end": body.end})
    return {"success": True}


@router.put("/reloj/{user_id}")
async def asignar_reloj(user_id: int, body: RelojIn, request: Request, user: dict = Depends(current_user)):
    if not (_es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        if user_id not in {int(a["id"]) for a in await _agentes_visibles(s, user)}:
            raise HTTPException(403, "Ese agente no pertenece a su equipo")
        if body.reloj_id:
            r = await s.execute(text("SELECT id, name, username FROM users WHERE reloj_id = :r AND id <> :u"),
                                {"r": body.reloj_id, "u": user_id})
            otro = r.mappings().first()
            if otro:
                raise HTTPException(409, f"El ID de reloj {body.reloj_id} ya es de {otro['name'] or otro['username']}")
        try:
            await s.execute(text("UPDATE users SET reloj_id = :r WHERE id = :u"), {"r": body.reloj_id, "u": user_id})
            await s.commit()
        except IntegrityError:  # otro lo asignó entre la comprobación y el UPDATE
            await s.rollback()
            raise HTTPException(409, f"El ID de reloj {body.reloj_id} ya está asignado a otro agente")
    audit._log("horarios_reloj_id", user.get("username", ""), _ip(request),
               {"agente": user_id, "reloj_id": body.reloj_id})
    return {"success": True, "reloj_id": body.reloj_id}


@router.put("/nombre/{user_id}")
async def asignar_nombre(user_id: int, body: NombreIn, request: Request, user: dict = Depends(current_user)):
    if not (_es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        if user_id not in {int(a["id"]) for a in await _agentes_visibles(s, user)}:
            raise HTTPException(403, "Ese agente no pertenece a su equipo")
        await s.execute(text("UPDATE users SET nombre_completo = :n WHERE id = :u"),
                        {"n": body.nombre_completo, "u": user_id})
        await s.commit()
    audit._log("horarios_nombre_completo", user.get("username", ""), _ip(request),
               {"agente": user_id, "nombre_completo": body.nombre_completo})
    return {"success": True, "nombre_completo": body.nombre_completo}


@router.put("/ingreso/{user_id}")
async def asignar_ingreso(user_id: int, body: IngresoIn, request: Request, user: dict = Depends(current_user)):
    if not (_es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        if user_id not in {int(a["id"]) for a in await _agentes_visibles(s, user)}:
            raise HTTPException(403, "Ese agente no pertenece a su equipo")
        await s.execute(text("UPDATE users SET fecha_ingreso = :f WHERE id = :u"),
                        {"f": body.fecha_ingreso, "u": user_id})
        await s.commit()
    fecha = body.fecha_ingreso.isoformat() if body.fecha_ingreso else None
    audit._log("horarios_fecha_ingreso", user.get("username", ""), _ip(request),
               {"agente": user_id, "fecha_ingreso": fecha})
    return {"success": True, "fecha_ingreso": fecha}


@router.post("/enviar")
async def enviar_ahora(body: EnviarIn, user: dict = Depends(current_user)):
    if not (_es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "No autorizado")
    res = await cs.enviar_semana(body.inicio, origen="manual", por=user.get("username"))
    if res.get("estado") == "sin_configurar":
        raise HTTPException(503, res["error"])
    return {"success": res.get("estado") in ("ok", "parcial", "sin_cambios"), **res}


@router.get("/envios")
async def historial_envios(limit: int = Query(20, ge=1, le=100), user: dict = Depends(current_user)):
    if not (_es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, date_from, estado, http_status, agentes, resumen, error, origen, enviado_por, created_at
            FROM cuadratura_envios ORDER BY id DESC LIMIT :l
        """), {"l": limit})
        return {"success": True, "envios": [_envio_json(e) for e in r.mappings().all()]}


def _envio_json(e) -> dict:
    import json
    resumen = e.get("resumen")
    if isinstance(resumen, str):
        try:
            resumen = json.loads(resumen)
        except ValueError:
            resumen = None
    return {
        "id": e["id"],
        "semana": e["date_from"].isoformat() if e.get("date_from") else None,
        "estado": e["estado"],
        "http_status": e["http_status"],
        "agentes": e["agentes"],
        "resumen": resumen,
        "error": e["error"],
        "origen": e["origen"],
        "enviado_por": e["enviado_por"],
        "fecha": e["created_at"].isoformat() if e.get("created_at") else None,
    }
