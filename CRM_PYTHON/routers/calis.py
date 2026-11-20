"""Calis del día (residencial/estadisticas.html, tabla de la izquierda).

Una cifra por team y por día, que se escribe a mano. Filas = equipos de venta (los que
tienen al menos un supervisor, mismo criterio que /api/teams?sales=1), de Residencial
y de Líneas. Columnas = los 7 días de una semana (lunes a domingo, hora de El Salvador).

- GET /api/calis?semana=YYYY-MM-DD → la semana que contiene ese día (por defecto la
  actual), con los teams, los valores y qué teams puede editar quien consulta.
- PUT /api/calis {team, fecha, cantidad} → guarda una casilla; cantidad null la vacía.
  Admin / Back Office: todos los teams (calis.editar_todos). Supervisor: solo el suyo
  (calis.su_equipo; el team se lee de la BD, no del token). Cada cambio avisa a todas
  las pestañas por el centro de notificaciones (evento «calis»).

Tabla calis_dia (migración 0112).
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import rbac
import realtime
from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/calis", tags=["Calis"])

MAX_CANTIDAD = 100000


def _lunes_de(d: date) -> date:
    return d - timedelta(days=d.weekday())


async def _mi_team(s, user: dict) -> str:
    r = await s.execute(text("SELECT TRIM(team) FROM users WHERE id = :id"), {"id": user.get("id")})
    return (r.scalar() or "").strip().upper()


async def _teams_venta(s) -> list[str]:
    r = await s.execute(text("""
        SELECT TRIM(team) AS team FROM users
        WHERE team IS NOT NULL AND TRIM(team) != '' AND COALESCE(active, 1) = 1
        GROUP BY TRIM(team)
        HAVING SUM(LOWER(role) LIKE '%supervisor%') > 0
    """))
    return [x[0] for x in r.all() if x[0]]


def _puede_editar(user: dict, team: str, mi_team: str) -> bool:
    if rbac.tiene(user, "calis.editar_todos"):
        return True
    return rbac.tiene(user, "calis.su_equipo") and team.strip().upper() == mi_team


@router.get("")
async def semana_calis(semana: str = "", user: dict = Depends(current_user)):
    hoy = ahora_sv().date()
    try:
        base = datetime.strptime(semana, "%Y-%m-%d").date() if semana else hoy
    except ValueError:
        raise HTTPException(400, "semana debe ser YYYY-MM-DD")
    lunes = _lunes_de(base)
    domingo = lunes + timedelta(days=6)

    async with AsyncSessionLocal() as s:
        teams = await _teams_venta(s)
        mi_team = await _mi_team(s, user)
        r = await s.execute(text("""
            SELECT team, fecha, cantidad FROM calis_dia WHERE fecha BETWEEN :d AND :h
        """), {"d": lunes, "h": domingo})
        filas = r.mappings().all()

    valores: dict[str, dict[str, int]] = {}
    for f in filas:
        valores.setdefault(f["team"].upper(), {})[f["fecha"].isoformat()] = int(f["cantidad"])

    # Un team que ya no existe pero tiene datos en esa semana sigue saliendo (no se pierden).
    nombres = {t.upper(): t for t in teams}
    for f in filas:
        nombres.setdefault(f["team"].upper(), f["team"])

    # Residencial primero y luego Líneas, cada grupo en orden alfabético.
    orden = sorted(nombres.values(), key=lambda t: (team_seccion(t) == "lineas", t.upper()))
    lista = [{
        "team": t,
        "seccion": team_seccion(t),
        "valores": valores.get(t.upper(), {}),
        "editable": _puede_editar(user, t, mi_team),
    } for t in orden]

    return {
        "success": True,
        "lunes": lunes.isoformat(),
        "dias": [(lunes + timedelta(days=i)).isoformat() for i in range(7)],
        "hoy": hoy.isoformat(),
        "teams": lista,
    }


class CaliIn(BaseModel):
    team: str = Field(min_length=1, max_length=150)
    fecha: str
    cantidad: Optional[int] = Field(default=None, ge=0, le=MAX_CANTIDAD)


@router.put("")
async def guardar_cali(body: CaliIn, user: dict = Depends(current_user)):
    try:
        fecha = datetime.strptime(body.fecha, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "fecha debe ser YYYY-MM-DD")
    team = body.team.strip()

    async with AsyncSessionLocal() as s:
        validos = {t.upper(): t for t in await _teams_venta(s)}
        if team.upper() not in validos:
            raise HTTPException(404, "Ese team no es un equipo de venta")
        team = validos[team.upper()]
        if not _puede_editar(user, team, await _mi_team(s, user)):
            raise HTTPException(403, "No puedes editar los calis de ese team")

        if body.cantidad is None:
            await s.execute(text("DELETE FROM calis_dia WHERE team = :t AND fecha = :f"),
                            {"t": team, "f": fecha})
        else:
            await s.execute(text("""
                INSERT INTO calis_dia (team, fecha, cantidad, editado_por)
                VALUES (:t, :f, :c, :u)
                ON DUPLICATE KEY UPDATE cantidad = VALUES(cantidad), editado_por = VALUES(editado_por)
            """), {"t": team, "f": fecha, "c": body.cantidad, "u": user.get("username") or ""})
        await s.commit()

    await realtime.publish(realtime.CANAL_TODOS, {"type": "calis", "fecha": fecha.isoformat()})
    return {"success": True, "team": team, "fecha": fecha.isoformat(), "cantidad": body.cantidad}
