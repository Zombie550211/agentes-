"""Consolidado (residencial/consolidado.html).

GET /api/consolidado?mes=YYYY-MM → puntaje de las ventas del mes sumado por status, en dos
vistas. Entran las ventas del mes (leads.dia_venta) y las de colchón: instaladas este mes
(dia_instalacion) pero vendidas en un mes anterior, con la misma regla que routers/ranking.py.
- total:   una fila por team de venta (su supervisor).
- equipos: por cada team, una fila por agente.

Columnas (suma de leads.puntaje): Active, Pending, Active + Pending, Cancel, Hold y
Suma total (las cuatro). Status con las mismas reglas que routers/equipo.py:
- Active:  completed / active / activo / cerrada…
- Pending: pending / pendiente (o vacío)
- Cancel:  cancel…
- Hold:    hold
Lo demás (oficina, reserva, repro) no entra en ninguna columna.

Team de una venta: leads.supervisor es el nombre del supervisor; se cruza con users para
sacar su team de Permisos. Los agentes de cada team salen de Permisos (Agente y vendedor,
aunque no tengan ventas) más quien tenga ventas bajo ese supervisor. Se respetan
excluir_de_reporte y la restricción de mercado (market:restrict_view).
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion
from permissions import resolve_market_restriction
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/consolidado", tags=["Consolidado"])

_EXCLUIDO = ("reser", "resched", "reagend", "repro", "oficina")
_ACTIVE = ("completed", "completado", "complete", "active", "activo", "activa", "cerrad")
COLUMNAS = ("active", "pending", "cancel", "hold")


def _columna(status: str) -> str | None:
    s = (status or "").strip().lower()
    if "cancel" in s:
        return "cancel"
    if "hold" in s:
        return "hold"
    if any(x in s for x in _EXCLUIDO):
        return None
    if any(x in s for x in _ACTIVE):
        return "active"
    if s == "" or "pend" in s:
        return "pending"
    return None


def _clave(nombre: str) -> str:
    """'Jorge.Segovia' ≈ 'jorge segovia' (mismo criterio que notifications._same_user)."""
    return re.sub(r"\s+", " ", str(nombre or "").replace(".", " ").replace("_", " ")).strip().lower()


def _vacio() -> dict:
    return {c: 0.0 for c in COLUMNAS}


def _cerrar(fila: dict) -> dict:
    """Redondea y añade Active + Pending y Suma total."""
    for c in COLUMNAS:
        fila[c] = round(fila[c], 2)
    fila["active_pending"] = round(fila["active"] + fila["pending"], 2)
    fila["total"] = round(fila["active"] + fila["pending"] + fila["cancel"] + fila["hold"], 2)
    return fila


def _periodo(mes: str | None) -> tuple[date, date, str]:
    hoy = ahora_sv().date()
    if mes:
        m = re.fullmatch(r"(\d{4})-(\d{2})", mes)
        if not m or not (1 <= int(m.group(2)) <= 12):
            raise HTTPException(400, "Mes inválido (YYYY-MM)")
        y, mo = int(m.group(1)), int(m.group(2))
    else:
        y, mo = hoy.year, hoy.month
    desde = date(y, mo, 1)
    hasta = date(y + (mo == 12), mo % 12 + 1, 1)
    return desde, hasta, f"{y:04d}-{mo:02d}"


@router.get("")
async def consolidado(mes: str | None = Query(None), user: dict = Depends(current_user)):
    desde, hasta, mes = _periodo(mes)
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
            SELECT TRIM(COALESCE(supervisor, '')) AS supervisor,
                   TRIM(COALESCE(NULLIF(agente, ''), agente_nombre, '')) AS agente,
                   status, COALESCE(puntaje, 0) AS puntaje
            FROM leads
            WHERE ((dia_venta >= :d AND dia_venta < :h)
                   OR (dia_instalacion >= :d AND dia_instalacion < :h
                       AND (dia_venta IS NULL OR dia_venta < :d)))   -- colchón
              AND (excluir_de_reporte IS NULL OR excluir_de_reporte = FALSE)
              {filtro_mercado}
        """), params)
        ventas = r.mappings().all()

    # Teams de venta de Residencial (los que tienen supervisor) y su roster.
    teams: dict[str, dict] = {}          # TEAM (mayúsculas) → datos
    team_de_sup: dict[str, str] = {}     # clave del supervisor → TEAM
    for u in usuarios:
        if team_seccion(u["team"]) != "residencial":
            continue
        if "supervisor" in str(u["role"] or "").lower():
            t = teams.setdefault(u["team"].upper(), {"team": u["team"], "supervisores": [], "roster": []})
            t["supervisores"].append(u["username"])
            team_de_sup[_clave(u["username"])] = u["team"].upper()
    for u in usuarios:
        t = teams.get((u["team"] or "").upper())
        if t and str(u["role"] or "").strip().lower() in ("agente", "vendedor"):
            t["roster"].append(u["username"])

    for t in teams.values():
        t["fila"] = _vacio()
        t["agentes"] = {_clave(n): {"agente": n, **_vacio()} for n in t["roster"]}

    for v in ventas:
        col = _columna(v["status"])
        if col is None:
            continue
        key = team_de_sup.get(_clave(v["supervisor"]))
        if key is None:
            # Supervisor que ya no está en Permisos (o venta sin supervisor): fila propia.
            nombre = v["supervisor"] or "Sin supervisor"
            key = "SUP:" + _clave(nombre)
            teams.setdefault(key, {"team": "", "supervisores": [nombre], "roster": [],
                                   "fila": _vacio(), "agentes": {}})
        t = teams[key]
        pts = float(v["puntaje"] or 0)
        t["fila"][col] += pts
        ag = t["agentes"].setdefault(_clave(v["agente"]) or "—",
                                     {"agente": v["agente"] or "Sin agente", **_vacio()})
        ag[col] += pts

    total, equipos = [], []
    for key in sorted(teams, key=lambda k: (k.startswith("SUP:"), teams[k]["team"] or teams[k]["supervisores"][0])):
        t = teams[key]
        fila = _cerrar(t["fila"])
        if key.startswith("SUP:") and fila["total"] == 0:
            continue
        base = {"team": t["team"], "supervisor": ", ".join(t["supervisores"])}
        total.append({**base, **fila})
        agentes = sorted((_cerrar(a) for a in t["agentes"].values()),
                         key=lambda a: (-a["total"], a["agente"].lower()))
        equipos.append({**base, "totales": fila, "agentes": agentes})

    return {"success": True, "mes": mes, "total": total, "equipos": equipos}
