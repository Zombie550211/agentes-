"""Cantidad de CXC Xfinity (frontend/residencial/estadisticas.html).

Tabla que se llena a mano, un número por día (el historial queda guardado y el total
del mes es la suma de sus días), con dos vistas independientes:
  - por team   (clave = nombre del team)
  - por agente (clave = id del usuario; se guarda también su nombre y team del momento)

Todos los usuarios con sesión la ven; la editan administración y el equipo de
Control de Calidad (por su equipo, no por rol: son Backoffice como otros).
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import realtime
from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion, _normalize_role
from tiempo_sv import ahora_sv
import rbac

router = APIRouter(prefix="/api/cxc-xfinity", tags=["CXC Xfinity"])

def _fecha(valor: str) -> date:
    """Valida YYYY-MM-DD y que no sea un día futuro (hora de El Salvador)."""
    try:
        d = date.fromisoformat(valor or "")
    except ValueError:
        raise HTTPException(400, "Fecha inválida (YYYY-MM-DD)")
    if d > ahora_sv().date():
        raise HTTPException(400, "No se puede usar una fecha futura")
    return d


_EQUIPOS_EDITORES = {"control de calidad"}


def _puede_editar(user: dict) -> bool:
    if rbac.tiene(user, "estadisticas.cxc_editar"):
        return True
    return _normalize_role(user.get("team")) in _EQUIPOS_EDITORES


def _es_agente(role) -> bool:
    x = str(role or "").lower()
    return ("agente" in x or "vendedor" in x) and "supervisor" not in x


@router.get("")
async def obtener(fecha: str, user: dict = Depends(current_user)):
    dia = _fecha(fecha)
    inicio_mes = dia.replace(day=1)
    fin_mes = (inicio_mes + timedelta(days=32)).replace(day=1)
    async with AsyncSessionLocal() as s:
        # Teams de venta de Residencial (los que tienen supervisor), como Ventas por equipo.
        r = await s.execute(text("""
            SELECT TRIM(team) AS team FROM users
            WHERE team IS NOT NULL AND TRIM(team) != ''
            GROUP BY TRIM(team)
            HAVING SUM(LOWER(role) LIKE '%supervisor%') > 0
            ORDER BY team
        """))
        teams = [row["team"] for row in r.mappings().all() if team_seccion(row["team"]) == "residencial"]
        # Agentes activos de Residencial.
        r = await s.execute(text("""
            SELECT id, username, role, TRIM(team) AS team FROM users
            WHERE COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1
              AND team IS NOT NULL AND TRIM(team) != ''
            ORDER BY team, username
        """))
        agentes = [
            {"id": str(row["id"]), "nombre": row["username"] or "", "team": row["team"]}
            for row in r.mappings().all()
            if _es_agente(row["role"]) and team_seccion(row["team"], row["role"]) == "residencial"
               and row["team"] in teams
        ]
        r = await s.execute(text("""
            SELECT tipo, clave, nombre, team, cantidad FROM cxc_xfinity_dia WHERE fecha = :f
        """), {"f": dia})
        guardados = [dict(row) for row in r.mappings().all()]
        r = await s.execute(text("""
            SELECT tipo, clave, MAX(nombre) AS nombre, MAX(team) AS team, SUM(cantidad) AS total
            FROM cxc_xfinity_dia
            WHERE fecha >= :ini AND fecha < :fin
            GROUP BY tipo, clave
        """), {"ini": inicio_mes, "fin": fin_mes})
        del_mes = [{**dict(row), "total": int(row["total"])} for row in r.mappings().all()]
    return {
        "success": True,
        "fecha": dia.isoformat(),
        "teams": teams,
        "agentes": agentes,
        "valores": guardados,
        "mes": del_mes,
        "puede_editar": _puede_editar(user),
    }


class Valor(BaseModel):
    fecha: str = Field(..., max_length=10)
    tipo: str = Field(..., pattern=r"^(team|agente)$")
    clave: str = Field(..., min_length=1, max_length=150)
    nombre: str = Field("", max_length=150)
    team: str = Field("", max_length=150)
    # None o 0 = sin dato (se borra la fila)
    cantidad: int | None = Field(None, ge=0, le=100_000)


@router.put("")
async def guardar(body: Valor, user: dict = Depends(current_user)):
    if not _puede_editar(user):
        raise HTTPException(403, "Solo administración y Control de Calidad editan esta tabla")
    dia = _fecha(body.fecha)
    clave = body.clave.strip()
    if not clave:
        raise HTTPException(400, "Falta la clave")
    async with AsyncSessionLocal() as s:
        if not body.cantidad:
            await s.execute(text("""
                DELETE FROM cxc_xfinity_dia WHERE fecha = :f AND tipo = :tipo AND clave = :clave
            """), {"f": dia, "tipo": body.tipo, "clave": clave})
        else:
            await s.execute(text("""
                INSERT INTO cxc_xfinity_dia (fecha, tipo, clave, nombre, team, cantidad, actualizado_por)
                VALUES (:f, :tipo, :clave, :nombre, :team, :cant, :por)
                ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), team = VALUES(team),
                    cantidad = VALUES(cantidad), actualizado_por = VALUES(actualizado_por)
            """), {
                "f": dia, "tipo": body.tipo, "clave": clave,
                "nombre": (body.nombre or clave).strip(), "team": body.team.strip() or None,
                "cant": body.cantidad, "por": user.get("username", ""),
            })
        await s.commit()
    await realtime.publish("residencial", {"type": "cxc", "action": "update"})
    return {"success": True}
