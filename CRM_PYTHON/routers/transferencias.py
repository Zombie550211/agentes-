"""Transferencias de llamadas entre secciones.

Residencial transfiere llamadas a un agente de un team de Líneas, y Líneas a un
agente de un team de Residencial. La sección de cada team sale de
deps.team_seccion (fuente única), así que el destino es siempre la sección
contraria a la de origen.

Visibilidad del historial:
  - admin / back office → todas las transferencias de la sección.
  - supervisor          → las que hizo o recibió su team.
  - agente              → las que hizo o recibió él.
"""
from datetime import datetime, timezone
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion

router = APIRouter(prefix="/api/transferencias", tags=["Transferencias de llamadas"])

_SECCIONES = ("residencial", "lineas")
# Teams que no atienden llamadas (mismo criterio que Tiempo laboral).
_TEAM_EXCLUIDO = re.compile(r"backoffice|back office|icon|usa|administra|monitoreo", re.I)
_ROL_EXCLUIDO = re.compile(r"admin|backoffice|back office", re.I)


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


def _es_supervisor(role: str) -> bool:
    return "supervisor" in str(role or "").lower()


def _validar_seccion(seccion: str) -> str:
    s = str(seccion or "").strip().lower()
    if s not in _SECCIONES:
        raise HTTPException(400, "Sección inválida (residencial o lineas)")
    return s


async def _agentes_por_team(s, seccion_destino: str) -> dict[str, list[dict]]:
    """Agentes activos de los teams de la sección indicada, agrupados por team."""
    r = await s.execute(text("""
        SELECT id, username, name, role, TRIM(team) AS team FROM users
        WHERE COALESCE(active, 1) = 1 AND team IS NOT NULL AND TRIM(team) != ''
        ORDER BY TRIM(team), COALESCE(NULLIF(name, ''), username)
    """))
    teams: dict[str, list[dict]] = {}
    for u in r.mappings().all():
        team = u["team"]
        if team_seccion(team) != seccion_destino or _TEAM_EXCLUIDO.search(team):
            continue
        if _ROL_EXCLUIDO.search(str(u["role"] or "")):
            continue
        teams.setdefault(team, []).append({
            "id": int(u["id"]),
            "nombre": (u["name"] or u["username"] or "").strip(),
            "username": u["username"],
        })
    return teams


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


class TransferenciaIn(BaseModel):
    origen: str
    telefono: str = Field(..., max_length=30)
    motivo: str = Field(..., max_length=1000)
    nombre_cliente: str = Field(..., max_length=150)
    direccion: str = Field(..., max_length=300)
    team_destino: str = Field(..., max_length=100)
    agente_destino_id: int


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

    async with AsyncSessionLocal() as s:
        # El destino se valida contra la BD: el team debe ser de la sección
        # contraria y el agente pertenecer a ese team.
        teams = await _agentes_por_team(s, _contraria(origen))
        team = (body.team_destino or "").strip()
        agente = next((a for a in teams.get(team, []) if a["id"] == body.agente_destino_id), None)
        if not agente:
            raise HTTPException(400, "El agente seleccionado no pertenece a ese team")

        r = await s.execute(text("SELECT name, username, team FROM users WHERE id = :id"),
                            {"id": _uid(user)})
        yo = r.mappings().first() or {}

        await s.execute(text("""
            INSERT INTO transferencias_llamadas
                (seccion_origen, telefono, motivo, nombre_cliente, direccion,
                 team_destino, agente_destino_id, agente_destino_nombre,
                 created_by, created_by_nombre, created_by_team, created_at)
            VALUES (:origen, :tel, :motivo, :nombre, :dir, :team, :ag_id, :ag_nombre,
                    :by, :by_nombre, :by_team, :now)
        """), {
            "origen": origen, "tel": telefono, "motivo": motivo, "nombre": nombre,
            "dir": direccion, "team": team, "ag_id": agente["id"],
            "ag_nombre": agente["nombre"], "by": user.get("username"),
            "by_nombre": (yo.get("name") or user.get("name") or user.get("username") or "").strip(),
            "by_team": (yo.get("team") or user.get("team") or "").strip(),
            "now": _utcnow(),
        })
        await s.commit()
    return {"success": True, "message": "Transferencia registrada"}


# ── GET /api/transferencias?seccion=residencial&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
@router.get("")
async def listar(seccion: str, desde: str = "", hasta: str = "",
                 user: dict = Depends(current_user)):
    """Transferencias en las que participa la sección: hechas desde ella
    (seccion_origen) o recibidas por ella (la contraria las originó)."""
    seccion = _validar_seccion(seccion)
    where = ["1=1"]
    params: dict = {}
    for nombre, valor in (("desde", desde), ("hasta", hasta)):
        if valor:
            try:
                params[nombre] = datetime.strptime(valor, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(400, f"{nombre} debe ser YYYY-MM-DD")
    if "desde" in params:
        where.append("t.created_at >= :desde")
    if "hasta" in params:
        where.append("t.created_at < DATE_ADD(:hasta, INTERVAL 1 DAY)")

    role = user.get("role", "")
    if not _es_admin_bo(role):
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("SELECT team FROM users WHERE id = :id"),
                                {"id": _uid(user)})
            mi_team = ((r.scalar() or user.get("team") or "")).strip()
        if _es_supervisor(role) and mi_team:
            where.append("(t.created_by_team = :team OR t.team_destino = :team)")
            params["team"] = mi_team
        else:
            where.append("(t.created_by = :yo OR t.agente_destino_id = :yo_id)")
            params["yo"] = user.get("username")
            params["yo_id"] = _uid(user)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT t.id, t.seccion_origen, t.telefono, t.motivo, t.nombre_cliente,
                   t.direccion, t.team_destino, t.agente_destino_id,
                   t.agente_destino_nombre, t.created_by, t.created_by_nombre,
                   t.created_by_team,
                   DATE_FORMAT(t.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at
            FROM transferencias_llamadas t
            WHERE {' AND '.join(where)}
            ORDER BY t.created_at DESC
            LIMIT 500
        """), params)
        filas = [dict(x) for x in r.mappings().all()]

    for f in filas:
        f["direccion_tipo"] = "enviada" if f["seccion_origen"] == seccion else "recibida"
    return {"success": True, "transferencias": filas}
