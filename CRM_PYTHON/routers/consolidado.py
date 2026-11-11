"""Consolidado (residencial/consolidado.html).

GET /api/consolidado?mes=YYYY-MM → puntaje de las ventas del mes sumado por status, en dos
vistas. Entran las ventas del mes (leads.dia_venta) y las de colchón: instaladas este mes
(dia_instalacion) pero vendidas en un mes anterior, con la misma regla que routers/ranking.py.
- total:   una fila por team de venta (su supervisor).
- equipos: por cada team, una fila por agente.
- mercados: una fila por mercado (ICON, BAMO) con el puntaje por status; la página lo
  muestra como % de cada columna (ICON + BAMO = 100 %). También va por team en equipos[].mercados
  y por agente en equipos[].agentes_mercado.
Van por nombre; ordenar por columna lo hace la página al tocar el encabezado.

Columnas (suma de leads.puntaje): Active, Pending, Active + Pending, Cancel, Hold y
Suma total (las cuatro). Status con las mismas reglas que routers/equipo.py:
- Active:  completed / active / activo / cerrada…
- Pending: pending / pendiente (o vacío)
- Cancel:  cancel…
- Hold:    hold
Lo demás (oficina, reserva, repro) no entra en ninguna columna.

Quién ve qué: administración y back office, todos los teams; los demás (supervisor, agente,
vendedor…) solo el suyo, leído de la BD (users.team) y no del token. Sin team de venta de
Residencial, nada.

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
import rbac

router = APIRouter(prefix="/api/consolidado", tags=["Consolidado"])

_EXCLUIDO = ("reser", "resched", "reagend", "repro", "oficina")
_ACTIVE = ("completed", "completado", "complete", "active", "activo", "activa", "cerrad")
COLUMNAS = ("active", "pending", "cancel", "hold")
MERCADOS = ("ICON", "BAMO")   # siempre salen, aunque estén en cero


def _es_admin_bo(user: dict) -> bool:
    """Permiso desde Roles y permisos (rbac.py): consolidado.ver_todo."""
    return rbac.tiene(user, "consolidado.ver_todo")


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


def _cerrar(fila: dict, decimales: int = 2) -> dict:
    """Redondea y añade Active + Pending y Suma total."""
    for c in COLUMNAS:
        fila[c] = round(fila[c], decimales)
    fila["active_pending"] = round(fila["active"] + fila["pending"], decimales)
    fila["total"] = round(fila["active"] + fila["pending"] + fila["cancel"] + fila["hold"], decimales)
    return fila


def periodo(mes: str | None) -> tuple[date, date, str]:
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
            SELECT TRIM(COALESCE(supervisor, '')) AS supervisor,
                   TRIM(COALESCE(NULLIF(agente, ''), agente_nombre, '')) AS agente,
                   status_grupo AS status, COALESCE(puntaje, 0) AS puntaje,
                   UPPER(TRIM(COALESCE(mercado, ''))) AS mercado
            FROM leads
            WHERE ((dia_venta >= :d AND dia_venta < :h)
                   OR (dia_instalacion >= :d AND dia_instalacion < :h
                       AND (dia_venta IS NULL OR dia_venta < :d)))   -- colchón
              AND (excluir_de_reporte IS NULL OR excluir_de_reporte = FALSE)
              {filtro_mercado}
        """), params)
        ventas = r.mappings().all()

        mi_team = None
        if not _es_admin_bo(user):
            r = await s.execute(text("SELECT TRIM(team) FROM users WHERE id = :id"), {"id": user.get("id")})
            mi_team = (r.scalar() or "").strip().upper()

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

    aportes = []
    for v in ventas:
        col = _columna(v["status"])
        if col is None:
            continue
        aportes.append({"team": team_de_sup.get(_clave(v["supervisor"])), "supervisor": v["supervisor"],
                        "agente": v["agente"], "mercado": v["mercado"], "col": col,
                        "valor": float(v["puntaje"] or 0)})
    return armar(teams, aportes, mi_team, mes)


def armar(teams: dict, aportes: list[dict], mi_team: str | None, mes: str, decimales: int = 2) -> dict:
    """Arma la respuesta del consolidado (lo comparten Residencial y Líneas).

    teams:   TEAM (mayúsculas) → {"team", "supervisores": [...], "roster": [agentes]}.
    aportes: una entrada por lo que suma: {"team": TEAM o None, "supervisor", "agente",
             "mercado", "col": active|pending|cancel|hold, "valor"}. Sin team → fila propia
             por supervisor (ya no está en Permisos, o venta sin supervisor).
    mi_team: None = todos los teams; si no, solo ese.
    """
    def cerrar(f: dict) -> dict:
        return _cerrar(f, decimales)

    def lista_mercados(por: dict) -> list[dict]:
        filas = [{"mercado": m, **cerrar(dict(por.get(m) or _vacio()))} for m in MERCADOS]
        filas += [{"mercado": m, **cerrar(dict(f))} for m, f in por.items() if m not in MERCADOS]
        return filas

    for t in teams.values():
        t["fila"] = _vacio()
        t["mercados"] = {}
        t["ag_merc"] = {}               # clave del agente → {mercado: fila}
        t["agentes"] = {_clave(n): {"agente": n, **_vacio()} for n in t["roster"]}

    for a in aportes:
        col, pts = a["col"], a["valor"]
        key = a["team"]
        if key is None or key not in teams:
            nombre = a["supervisor"] or "Sin supervisor"
            key = "SUP:" + _clave(nombre)
            teams.setdefault(key, {"team": "", "supervisores": [nombre], "roster": [],
                                   "fila": _vacio(), "mercados": {}, "ag_merc": {}, "agentes": {}})
        t = teams[key]
        t["fila"][col] += pts
        merc = a["mercado"] or "SIN MERCADO"
        t["mercados"].setdefault(merc, _vacio())[col] += pts
        clave_ag = _clave(a["agente"]) or "—"
        ag = t["agentes"].setdefault(clave_ag, {"agente": a["agente"] or "Sin agente", **_vacio()})
        ag[col] += pts
        t["ag_merc"].setdefault(clave_ag, {}).setdefault(merc, _vacio())[col] += pts

    if mi_team is not None:
        teams = {k: v for k, v in teams.items() if k == mi_team}

    # Por mercado (ICON / BAMO): suma de los teams visibles; los % los calcula la página.
    por_mercado: dict[str, dict] = {m: _vacio() for m in MERCADOS}
    for t in teams.values():
        for m, f in t["mercados"].items():
            dst = por_mercado.setdefault(m, _vacio())
            for c in COLUMNAS:
                dst[c] += f[c]
    mercados = [{"mercado": m, **cerrar(f)} for m, f in por_mercado.items()
                if m in MERCADOS or any(f.values())]

    total, equipos = [], []
    for key in sorted(teams, key=lambda k: (k.startswith("SUP:"), teams[k]["team"] or teams[k]["supervisores"][0])):
        t = teams[key]
        fila = cerrar(t["fila"])
        if key.startswith("SUP:") and fila["total"] == 0:
            continue
        base = {"team": t["team"], "supervisor": ", ".join(t["supervisores"])}
        total.append({**base, **fila})
        agentes = sorted((cerrar(a) for a in t["agentes"].values()), key=lambda a: a["agente"].lower())
        # Por mercado de cada agente (botón «Ver team» de la vista Por mercado).
        agentes_mercado = [{"agente": t["agentes"][k]["agente"], "total": t["agentes"][k]["total"],
                            "mercados": lista_mercados(t["ag_merc"].get(k, {}))}
                           for k in sorted(t["agentes"], key=lambda k: t["agentes"][k]["agente"].lower())]
        equipos.append({**base, "totales": fila, "agentes": agentes,
                        "mercados": lista_mercados(t["mercados"]), "agentes_mercado": agentes_mercado})

    return {"success": True, "mes": mes, "todos": mi_team is None, "total": total, "equipos": equipos,
            "mercados": mercados}
