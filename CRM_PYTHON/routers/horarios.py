"""Horarios de agentes — los carga el supervisor y se envían al Sistema de Cuadratura.

Quién ve qué:
- Admin / Back Office: todo el personal activo, agrupado por su equipo tal como está en
  Permisos (users.team), con filtro opcional por equipo. Los equipos de venta van en
  Residencial / Líneas; los demás (Administración, Backoffice, USA…) en "Administración
  y apoyo". Quien no tiene equipo no aparece.
- Supervisor: solo su propio team (users.team); es quien carga el horario de cada agente.
- Agente: el horario de su propio team, en lectura. De los compañeros no ve el ID de reloj
  ni la fecha de ingreso (solo los suyos).
El team se lee de la BD en cada petición (el de la sesión puede estar desactualizado).

Empleados sin usuario (POST /empleados): cualquier rol que no sea agente puede dar de alta
a un empleado nuevo con su nombre y su equipo (el supervisor, solo en el suyo) para cargarle
turnos antes de que tenga usuario del CRM (los agentes nuevos no entran al CRM hasta sus
primeras ventas). Es un registro de users con acceso_crm = 0: no puede iniciar sesión, sale
en su equipo con la etiqueta "Sin usuario" y viaja a Cuadratura como los demás. Cuando le
toca entrar, administración le da acceso desde Permisos (mismo registro: conserva horarios
y su enlace con Cuadratura).

Reglas de edición:
- El supervisor no puede modificar días pasados (lo ya trabajado lo corrige RRHH en
  Cuadratura); admin y back office sí.
- Guardar una semana REEMPLAZA los días editables de cada agente enviado: un día sin
  datos queda libre.
- Dos personas pueden editar a la vez la misma semana (supervisor y admin, o dos
  pestañas). Para que una no borre sin saberlo lo que guardó la otra, cada agente viaja
  con una `version` (huella de sus días en la semana): si al guardar ya no coincide, se
  responde 409 y no se toca nada.
- Nombre completo (users.nombre_completo): el nombre legal; es el que se ve en Horarios
  y el que va a Cuadratura al crear el empleado.
- Fecha de ingreso (users.fecha_ingreso): va a Cuadratura como hire_date.
- ID de reloj (users.reloj_id): es el número con el que el agente marca en el reloj
  biométrico. Lo usa Cuadratura para enlazar horario y marcaciones. Único por agente.

El envío a Cuadratura está en cuadratura_sync.py.
"""
import hashlib
import re
import secrets
import unicodedata
from datetime import date, time, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import audit
import cuadratura_sync as cs
from database_mysql import AsyncSessionLocal
from deps import ADMIN_ROLES, current_user, team_seccion

router = APIRouter(prefix="/api/horarios", tags=["Horarios"])

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
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

def _puede_alta(user: dict) -> bool:
    """Dar de alta empleados sin usuario: cualquier rol que no sea de agente."""
    return not cs.es_agente(user.get("role"))



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
        SELECT id, username, name, nombre_completo, fecha_ingreso, role, team, supervisor, reloj_id,
               COALESCE(acceso_crm, 1) AS acceso_crm
        FROM users WHERE COALESCE(active, 1) = 1 ORDER BY name
    """))
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


def _primer_dia_editable(user: dict) -> date:
    """Admin/BO editan cualquier fecha; el supervisor desde hoy en adelante."""
    return date.min if _es_admin_bo(user) else cs.hoy_sv()


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
class DiaIn(BaseModel):
    date: date
    start: Optional[str] = None
    end: Optional[str] = None
    break_minutes: int = Field(default=60, ge=0, le=480)
    rest_day: bool = False
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _validar(self):
        if self.rest_day:
            self.start = self.end = None
            return self
        if not (self.start and self.end and _HHMM.match(self.start) and _HHMM.match(self.end)):
            raise ValueError(f"{self.date}: indique hora de entrada y salida (HH:MM) o marque día libre")
        if self.start == self.end:
            raise ValueError(f"{self.date}: la entrada y la salida no pueden ser iguales")
        # Shortday (4 h o menos): sin hora de comida.
        self.break_minutes = cs.comida_minutos(self.start, self.end, self.break_minutes)
        return self


class AgenteSemanaIn(BaseModel):
    user_id: int
    dias: List[DiaIn] = Field(default_factory=list, max_length=7)
    # Huella recibida en GET /semana. Si falta (cliente antiguo) no se comprueba.
    version: Optional[str] = Field(default=None, max_length=64)


class SemanaIn(BaseModel):
    inicio: date
    agentes: List[AgenteSemanaIn] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def _fechas(self):
        lunes = cs.lunes_de(self.inicio)
        fin = lunes + timedelta(days=6)
        ids = [a.user_id for a in self.agentes]
        if len(ids) != len(set(ids)):
            raise ValueError("Hay agentes repetidos")
        for a in self.agentes:
            fechas = [d.date for d in a.dias]
            if len(fechas) != len(set(fechas)):
                raise ValueError("Hay días repetidos para un mismo agente")
            if any(not lunes <= f <= fin for f in fechas):
                raise ValueError("Todas las fechas deben estar dentro de la semana")
        self.inicio = lunes
        return self


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


class CopiarIn(BaseModel):
    desde: date
    hacia: date
    equipo: str = ""  # el filtro de equipo que tiene puesto el admin en pantalla


class EnviarIn(BaseModel):
    inicio: date


# ── Endpoints ───────────────────────────────────────────────────
class EmpleadoIn(BaseModel):
    nombre: str = Field(..., max_length=160)
    team: str = Field(..., max_length=100)

    @field_validator("nombre")
    @classmethod
    def _v(cls, v):
        v = " ".join(str(v or "").split())
        if len(v) < 5 or " " not in v:
            raise ValueError("Escribe nombre y apellido")
        if not re.fullmatch(r"[^\W\d_]+(?:[ '.-][^\W\d_]+)*", v):
            raise ValueError("El nombre solo admite letras, espacios, guion y apóstrofo")
        return v


@router.post("/empleados")
async def alta_empleado(body: EmpleadoIn, request: Request, user: dict = Depends(current_user)):
    """Empleado nuevo SIN usuario del CRM, para cargarle el horario (ver docstring del módulo)."""
    if not _puede_alta(user):
        raise HTTPException(403, "Los agentes no pueden dar de alta empleados")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, role, TRIM(team) AS team, supervisor FROM users
            WHERE COALESCE(active, 1) = 1 AND TRIM(COALESCE(team, '')) <> ''
        """))
        usuarios = [dict(u) for u in r.mappings().all() if cs.tiene_equipo(u["team"])]
        # El equipo tiene que existir (lo crea Permisos, no esta pantalla).
        miembros = [u for u in usuarios if _norm(u["team"]) == _norm(body.team)]
        if not miembros:
            raise HTTPException(400, "Ese equipo no existe")
        team = miembros[0]["team"]
        if not _es_admin_bo(user):
            yo = next((u for u in usuarios if str(u["id"]) == str(user.get("id"))), None)
            if _norm((yo or {}).get("team") or user.get("team")) != _norm(team):
                raise HTTPException(403, "Solo puede agregar empleados a su propio equipo")
        r = await s.execute(text("""
            SELECT id FROM users WHERE COALESCE(active, 1) = 1
              AND (LOWER(TRIM(name)) = LOWER(:n) OR LOWER(TRIM(nombre_completo)) = LOWER(:n)) LIMIT 1
        """), {"n": body.nombre})
        if r.first():
            raise HTTPException(409, f"Ya existe un usuario activo llamado {body.nombre}")
        # Supervisor: el que más se repite entre los agentes del equipo (como en Permisos).
        claves = [str(u["supervisor"] or "").strip() for u in miembros if str(u["supervisor"] or "").strip()]
        supervisor = max(set(claves), key=claves.count) if claves else ""
        rol = "Lineas-Agentes" if team_seccion(team) == "lineas" else "Agente"
        # Usuario y contraseña de relleno: nadie los conoce y el login ignora acceso_crm = 0.
        # Permisos los sustituye al darle acceso.
        username = "sin-usuario-" + secrets.token_hex(5)
        import bcrypt as _bcrypt
        relleno = _bcrypt.hashpw(secrets.token_bytes(32), _bcrypt.gensalt(rounds=10)).decode()
        res = await s.execute(text("""
            INSERT INTO users (username, password_hash, name, nombre_completo, role, team, supervisor,
                               active, acceso_crm)
            VALUES (:u, :p, :n, :n, :r, :t, :sup, 1, 0)
        """), {"u": username, "p": relleno, "n": body.nombre, "r": rol, "t": team, "sup": supervisor})
        nuevo_id = res.lastrowid
        await s.commit()
    audit._log("horarios_alta_empleado", user.get("username", ""), _ip(request),
               {"empleado": nuevo_id, "nombre": body.nombre, "team": team})
    return {"success": True, "id": nuevo_id, "nombre": body.nombre, "team": team}


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
                                  "seccion": _seccion(a, teams_venta), "supervisor": sups.get(clave),
                                  "puede_alta": _puede_alta(user) and (_es_admin_bo(user) or clave == mi_clave)})
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
            "sin_usuario": not int(a.get("acceso_crm", 1)),
            "es_supervisor": cs._es_supervisor_rol(a["role"]),
            "supervisor": a["supervisor"],
            "reloj_id": _privado(a, a["reloj_id"]),
            "nombre_completo": a["nombre_completo"],
            "fecha_ingreso": _privado(a, a["fecha_ingreso"].isoformat() if a["fecha_ingreso"] else None),
            "dias": dias_por_agente.get(int(a["id"]), {}),
            "version": versiones.get(int(a["id"]), _VERSION_VACIA),
        } for a in agentes],
    }


@router.put("/semana")
async def guardar_semana(body: SemanaIn, request: Request, user: dict = Depends(current_user)):
    if not (_es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "Solo supervisores y administración pueden cargar horarios")
    desde = max(body.inicio, _primer_dia_editable(user))
    fin = body.inicio + timedelta(days=6)
    if desde > fin:
        raise HTTPException(400, "Esa semana ya pasó; las correcciones las hace RRHH en Cuadratura")

    guardados = omitidos = 0
    async with AsyncSessionLocal() as s:
        visibles = {int(a["id"]): a["name"] or a["username"] for a in await _agentes_visibles(s, user)}
        ajenos = [a.user_id for a in body.agentes if a.user_id not in visibles]
        if ajenos:
            raise HTTPException(403, f"No puede editar el horario de estos agentes: {ajenos}")

        # Control de edición simultánea: FOR UPDATE bloquea esos días hasta el commit,
        # así otro guardado de los mismos agentes espera y luego ve la versión nueva.
        lista = ",".join(str(int(a.user_id)) for a in body.agentes)
        r = await s.execute(text(f"""
            SELECT {_COLS_DIA} FROM agent_schedules
            WHERE work_date BETWEEN :i AND :f AND user_id IN ({lista})
            FOR UPDATE
        """), {"i": body.inicio, "f": fin})
        actuales = _versiones(r.mappings().all())
        cambiados = [visibles[a.user_id] for a in body.agentes
                     if a.version is not None and actuales.get(a.user_id, _VERSION_VACIA) != a.version]
        if cambiados:
            raise HTTPException(409, "Otra persona guardó cambios en el horario de "
                                     f"{', '.join(cambiados)} mientras usted editaba. "
                                     "No se guardó nada: recargue la semana y vuelva a aplicar sus cambios.")

        for ag in body.agentes:
            await s.execute(text("""
                DELETE FROM agent_schedules
                WHERE user_id = :u AND work_date BETWEEN :d AND :f
            """), {"u": ag.user_id, "d": desde, "f": fin})
            for d in ag.dias:
                if d.date < desde:
                    omitidos += 1
                    continue
                await s.execute(text("""
                    INSERT INTO agent_schedules
                        (user_id, work_date, start_time, end_time, break_minutes, rest_day, notes, updated_by)
                    VALUES (:u, :d, :st, :en, :b, :r, :n, :by)
                """), {"u": ag.user_id, "d": d.date, "st": d.start, "en": d.end,
                       "b": 0 if d.rest_day else d.break_minutes, "r": 1 if d.rest_day else 0,
                       "n": d.notes, "by": user.get("username")})
                guardados += 1
        await s.commit()

    audit._log("horarios_guardar", user.get("username", ""), _ip(request),
               {"semana": body.inicio.isoformat(), "agentes": len(body.agentes), "dias": guardados})
    return {"success": True, "guardados": guardados, "omitidos": omitidos}


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


@router.post("/copiar")
async def copiar_semana(body: CopiarIn, request: Request, user: dict = Depends(current_user)):
    """Copia los horarios de una semana a otra para los agentes visibles (y del equipo
    filtrado, si lo hay). Solo reemplaza el destino de los agentes que tienen algo cargado
    en la semana origen: a quien no tiene nada que copiar no se le borra su semana."""
    if not (_es_admin_bo(user) or _es_supervisor(user)):
        raise HTTPException(403, "No autorizado")
    origen, destino = cs.lunes_de(body.desde), cs.lunes_de(body.hacia)
    if origen == destino:
        raise HTTPException(400, "Elija semanas distintas")
    desde_dest = max(destino, _primer_dia_editable(user))
    fin_dest = destino + timedelta(days=6)
    if desde_dest > fin_dest:
        raise HTTPException(400, "La semana destino ya pasó")
    delta = destino - origen

    async with AsyncSessionLocal() as s:
        ids = [int(a["id"]) for a in await _agentes_visibles(s, user, body.equipo)]
        if not ids:
            return {"success": True, "copiados": 0}
        r = await s.execute(text(f"""
            SELECT DISTINCT user_id FROM agent_schedules
            WHERE user_id IN ({",".join(str(i) for i in ids)}) AND work_date BETWEEN :o AND :of
        """), {"o": origen, "of": origen + timedelta(days=6)})
        ids = [int(x) for x in r.scalars().all()]
        if not ids:
            return {"success": True, "copiados": 0}
        lista = ",".join(str(i) for i in ids)
        await s.execute(text(f"""
            DELETE FROM agent_schedules
            WHERE user_id IN ({lista}) AND work_date BETWEEN :d AND :f
        """), {"d": desde_dest, "f": fin_dest})
        r = await s.execute(text(f"""
            INSERT INTO agent_schedules
                (user_id, work_date, start_time, end_time, break_minutes, rest_day, notes, updated_by)
            SELECT user_id, DATE_ADD(work_date, INTERVAL :dias DAY), start_time, end_time,
                   break_minutes, rest_day, notes, :by
            FROM agent_schedules
            WHERE user_id IN ({lista}) AND work_date BETWEEN :o AND :of
              AND DATE_ADD(work_date, INTERVAL :dias DAY) >= :d
        """), {"dias": delta.days, "by": user.get("username"), "o": origen,
               "of": origen + timedelta(days=6), "d": desde_dest})
        await s.commit()
    audit._log("horarios_copiar", user.get("username", ""), _ip(request),
               {"desde": origen.isoformat(), "hacia": destino.isoformat(), "agentes": len(ids),
                "filas": r.rowcount})
    return {"success": True, "copiados": r.rowcount, "agentes": len(ids)}


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
