"""Cantidad de CXC Xfinity (frontend/residencial/estadisticas.html).

Tabla que se llena a mano, por mes, con dos vistas independientes:
  - por team   (clave = nombre del team)
  - por agente (clave = id del usuario; se guarda también su nombre y team del momento)

Todos los usuarios con sesión la ven; sólo ADMIN_ROLES la editan.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import realtime
from database_mysql import AsyncSessionLocal
from deps import current_user, require_roles, ADMIN_ROLES, team_seccion, _normalize_role

router = APIRouter(prefix="/api/cxc-xfinity", tags=["CXC Xfinity"])

_ADMIN_NORM = {_normalize_role(r) for r in ADMIN_ROLES}
_YM_RE = r"^\d{4}-(0[1-9]|1[0-2])$"


def _puede_editar(user: dict) -> bool:
    return _normalize_role(user.get("role")) in _ADMIN_NORM


def _es_agente(role) -> bool:
    x = str(role or "").lower()
    return ("agente" in x or "vendedor" in x) and "supervisor" not in x


@router.get("")
async def obtener(month: str, user: dict = Depends(current_user)):
    import re
    if not re.match(_YM_RE, month or ""):
        raise HTTPException(400, "Mes inválido (YYYY-MM)")
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
            SELECT tipo, clave, nombre, team, cantidad FROM cxc_xfinity WHERE ym = :ym
        """), {"ym": month})
        guardados = [dict(row) for row in r.mappings().all()]
    return {
        "success": True,
        "month": month,
        "teams": teams,
        "agentes": agentes,
        "valores": guardados,
        "puede_editar": _puede_editar(user),
    }


class Valor(BaseModel):
    month: str = Field(..., pattern=_YM_RE)
    tipo: str = Field(..., pattern=r"^(team|agente)$")
    clave: str = Field(..., min_length=1, max_length=150)
    nombre: str = Field("", max_length=150)
    team: str = Field("", max_length=150)
    # None o 0 = sin dato (se borra la fila)
    cantidad: int | None = Field(None, ge=0, le=100_000)


@router.put("")
async def guardar(body: Valor, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    clave = body.clave.strip()
    if not clave:
        raise HTTPException(400, "Falta la clave")
    async with AsyncSessionLocal() as s:
        if not body.cantidad:
            await s.execute(text("""
                DELETE FROM cxc_xfinity WHERE ym = :ym AND tipo = :tipo AND clave = :clave
            """), {"ym": body.month, "tipo": body.tipo, "clave": clave})
        else:
            await s.execute(text("""
                INSERT INTO cxc_xfinity (ym, tipo, clave, nombre, team, cantidad, actualizado_por)
                VALUES (:ym, :tipo, :clave, :nombre, :team, :cant, :por)
                ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), team = VALUES(team),
                    cantidad = VALUES(cantidad), actualizado_por = VALUES(actualizado_por)
            """), {
                "ym": body.month, "tipo": body.tipo, "clave": clave,
                "nombre": (body.nombre or clave).strip(), "team": body.team.strip() or None,
                "cant": body.cantidad, "por": user.get("username", ""),
            })
        await s.commit()
    await realtime.publish("residencial", {"type": "cxc", "action": "update"})
    return {"success": True}
