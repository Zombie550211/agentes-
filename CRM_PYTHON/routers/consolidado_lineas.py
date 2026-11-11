"""Consolidado de Líneas (lineas/consolidado.html).

GET /api/consolidado-lineas?mes=YYYY-MM → misma respuesta que /api/consolidado (Residencial),
armada con routers/consolidado.armar, pero en LÍNEAS en vez de puntaje (Líneas no tiene puntaje).

- Ventas del mes: lineas_clientes con dia_venta en el mes (sin dia_venta, la fecha de creación),
  igual que /api/lineas-stats.
- Cada venta aporta una unidad por línea, con el status de esa línea y la misma regla que
  Estadísticas Líneas (lineas/estadisticas.html → __getLineStatus): con una sola línea manda
  el status de la venta; con varias, lineas_status[i] y, si falta, el de la venta.
- Columnas: Active (active / completed / finaliz…), Pending, Cancel, Hold. Repro y lo demás
  no entra.
- Team: lineas_clientes.team (TEAM LINEAS …) con su supervisor y agentes de Permisos.

Quién ve qué: consolidado.ver_todo o lineas.gestion (administración, back office), todos los
teams; los demás solo el suyo (users.team de la BD). Respeta la restricción de mercado.
"""
import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion
from permissions import resolve_market_restriction
from routers.consolidado import armar, periodo
import rbac

router = APIRouter(prefix="/api/consolidado-lineas", tags=["Consolidado"])

_ROLES_AGENTE = ("agente", "vendedor", "lineas-agentes", "lineas agentes")


def _columna(status: str) -> str | None:
    s = (status or "").strip().upper()
    if "CANCEL" in s:
        return "cancel"
    if "HOLD" in s:
        return "hold"
    if "ACTIV" in s or "COMPLET" in s or "FINALIZ" in s:
        return "active"
    if s in ("PENDING", "PENDIENTE"):
        return "pending"
    return None


def _json(v):
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v) if v else None
    except (TypeError, ValueError):
        return None


def _status_lineas(venta: dict) -> list[str]:
    """Status de cada línea de la venta (misma regla que Estadísticas Líneas)."""
    ls = _json(venta["lineas_status"])
    ld = _json(venta["lines_data"])
    n = int(venta["cantidad_lineas"] or 0)
    if n <= 0:
        n = len(ld) if isinstance(ld, (list, dict)) and ld else 0
    if n <= 0:
        n = len(ls) if isinstance(ls, dict) and ls else 1
    general = str(venta["status"] or "").strip().upper()
    if n == 1 and general:
        return [general]
    out = []
    for i in range(n):
        st = ls.get(str(i)) if isinstance(ls, dict) else (ls[i] if isinstance(ls, list) and i < len(ls) else None)
        out.append(str(st or general or "PENDING").strip().upper())
    return out


@router.get("")
async def consolidado_lineas(mes: str | None = Query(None), user: dict = Depends(current_user)):
    desde, hasta, mes = periodo(mes)
    params: dict = {"d": desde, "h": hasta}
    filtro_mercado = ""
    mercado = await resolve_market_restriction(user)
    if mercado:
        filtro_mercado = "AND UPPER(TRIM(COALESCE(mercado, ''))) = :mer"
        params["mer"] = mercado

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT username, role, TRIM(team) AS team FROM users
            WHERE team IS NOT NULL AND TRIM(team) != ''
              AND COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1
        """))
        usuarios = r.mappings().all()
        r = await s.execute(text(f"""
            SELECT UPPER(TRIM(COALESCE(team, ''))) AS team,
                   TRIM(COALESCE(supervisor, '')) AS supervisor,
                   TRIM(COALESCE(NULLIF(agente, ''), NULLIF(agente_nombre, ''), agente_asignado, '')) AS agente,
                   UPPER(TRIM(COALESCE(mercado, ''))) AS mercado,
                   status, cantidad_lineas, lineas_status, lines_data
            FROM lineas_clientes
            WHERE COALESCE(dia_venta, DATE(created_at)) >= :d
              AND COALESCE(dia_venta, DATE(created_at)) < :h
              {filtro_mercado}
        """), params)
        ventas = r.mappings().all()

        mi_team = None
        if not (rbac.tiene(user, "consolidado.ver_todo") or rbac.tiene(user, "lineas.gestion")):
            r = await s.execute(text("SELECT TRIM(team) FROM users WHERE id = :id"), {"id": user.get("id")})
            mi_team = (r.scalar() or "").strip().upper()

    # Teams de Líneas (los que tienen supervisor) y sus agentes.
    teams: dict[str, dict] = {}
    for u in usuarios:
        if team_seccion(u["team"]) == "lineas" and "supervisor" in str(u["role"] or "").lower():
            t = teams.setdefault(u["team"].upper(), {"team": u["team"], "supervisores": [], "roster": []})
            t["supervisores"].append(u["username"])
    for u in usuarios:
        t = teams.get((u["team"] or "").upper())
        if t and str(u["role"] or "").strip().lower() in _ROLES_AGENTE:
            t["roster"].append(u["username"])

    aportes = []
    for v in ventas:
        for st in _status_lineas(v):
            col = _columna(st)
            if col is None:
                continue
            aportes.append({"team": v["team"] or None, "supervisor": v["supervisor"], "agente": v["agente"],
                            "mercado": v["mercado"], "col": col, "valor": 1})
    return armar(teams, aportes, mi_team, mes, decimales=0)
