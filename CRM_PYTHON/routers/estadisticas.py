"""Estadísticas (residencial/estadisticas.html) — cuadros de rendimiento.

GET /api/estadisticas/ventas?periodo=dia|mes&fecha=YYYY-MM-DD
  Ventas por team del día (por defecto) o del mes de esa fecha (hora de El Salvador).
  Filas = equipos de venta (con supervisor), Residencial y Líneas móviles, aunque estén en 0.

  Residencial (leads, por dia_venta), mismas reglas que la Estadísticas anterior:
  - No cuentan canceladas ni repro / reagendadas (una repro reprocesa una venta ya contada)
    ni las marcadas excluir_de_reporte. Respeta la restricción de mercado del usuario.
  - Team: el de su supervisor en Permisos (leads.supervisor → users.team); si no se
    encuentra, leads.team. Columnas: ventas, ICON, BAMO y puntos (suma de puntaje).
  Líneas (lineas_clientes, por dia_venta o, sin ella, la fecha de creación), igual que
  /api/lineas-stats: cada cliente es una venta y suma sus cantidad_lineas.

Lectura para todo usuario con sesión: las métricas por team ya eran globales en la página
anterior (ver /api/lineas-stats).
"""
import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion
from permissions import resolve_market_restriction
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/estadisticas", tags=["Estadísticas"])

_NO_CUENTA = re.compile(r"cancel|repro|resched|reagend")


def _clave(nombre) -> str:
    return re.sub(r"\s+", " ", str(nombre or "").replace(".", " ").replace("_", " ")).strip().lower()


def _rango(periodo: str, fecha: str) -> tuple[date, date, date]:
    """(desde, hasta exclusivo, día consultado)."""
    try:
        dia = datetime.strptime(fecha, "%Y-%m-%d").date() if fecha else ahora_sv().date()
    except ValueError:
        raise HTTPException(400, "fecha debe ser YYYY-MM-DD")
    if periodo == "dia":
        return dia, dia + timedelta(days=1), dia
    if periodo == "mes":
        desde = dia.replace(day=1)
        hasta = date(desde.year + (desde.month == 12), desde.month % 12 + 1, 1)
        return desde, hasta, dia
    raise HTTPException(400, "periodo debe ser dia o mes")


def _fila(team: str) -> dict:
    return {"team": team, "seccion": team_seccion(team), "ventas": 0, "icon": 0, "bamo": 0,
            "puntos": 0.0, "lineas": 0}


@router.get("/ventas")
async def ventas_por_team(periodo: str = "dia", fecha: str = "", user: dict = Depends(current_user)):
    desde, hasta, dia = _rango(periodo, fecha)
    params: dict = {"d": desde, "h": hasta}
    filtro_mercado = ""
    mercado = await resolve_market_restriction(user)
    if mercado:
        filtro_mercado = "AND UPPER(TRIM(COALESCE(mercado, ''))) = :mer"
        params["mer"] = mercado

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT username, role, TRIM(team) AS team FROM users
            WHERE team IS NOT NULL AND TRIM(team) != '' AND COALESCE(active, 1) = 1
        """))
        usuarios = r.mappings().all()
        r = await s.execute(text(f"""
            SELECT TRIM(COALESCE(supervisor, '')) AS supervisor, TRIM(COALESCE(team, '')) AS team,
                   COALESCE(status, '') AS status, COALESCE(puntaje, 0) AS puntaje,
                   UPPER(TRIM(COALESCE(mercado, ''))) AS mercado
            FROM leads
            WHERE dia_venta >= :d AND dia_venta < :h
              AND (excluir_de_reporte IS NULL OR excluir_de_reporte = FALSE)
              {filtro_mercado}
        """), params)
        ventas_res = r.mappings().all()
        r = await s.execute(text(f"""
            SELECT TRIM(COALESCE(team, '')) AS team, TRIM(COALESCE(supervisor, '')) AS supervisor,
                   COALESCE(cantidad_lineas, 1) AS lineas,
                   UPPER(TRIM(COALESCE(mercado, ''))) AS mercado
            FROM lineas_clientes
            WHERE COALESCE(dia_venta, DATE(created_at)) >= :d
              AND COALESCE(dia_venta, DATE(created_at)) < :h
              {filtro_mercado}
        """), params)
        ventas_lin = r.mappings().all()

    # Equipos de venta (con supervisor) y supervisor → team.
    filas: dict[str, dict] = {}
    team_de_sup: dict[str, str] = {}
    for u in usuarios:
        if "supervisor" in str(u["role"] or "").lower():
            filas.setdefault(u["team"].upper(), _fila(u["team"]))
            team_de_sup[_clave(u["username"])] = u["team"].upper()

    def destino(supervisor: str, team: str) -> dict:
        k = team_de_sup.get(_clave(supervisor)) or (team.upper() if team else "")
        if k not in filas:
            filas[k] = _fila(team or supervisor or "Sin team")
        return filas[k]

    for v in ventas_res:
        if _NO_CUENTA.search(v["status"].lower()):
            continue
        f = destino(v["supervisor"], v["team"])
        f["ventas"] += 1
        f["puntos"] += float(v["puntaje"] or 0)
        f["icon"] += "ICON" in v["mercado"]
        f["bamo"] += "BAMO" in v["mercado"]

    for v in ventas_lin:
        f = destino(v["supervisor"], v["team"])
        f["ventas"] += 1
        f["lineas"] += max(int(v["lineas"] or 1), 1)
        f["icon"] += "ICON" in v["mercado"]
        f["bamo"] += "BAMO" in v["mercado"]

    lista = sorted(filas.values(), key=lambda f: (f["seccion"] == "lineas", -f["ventas"], f["team"].upper()))
    for f in lista:
        f["puntos"] = round(f["puntos"], 2)
    return {"success": True, "periodo": periodo, "fecha": dia.isoformat(),
            "desde": desde.isoformat(), "hasta": (hasta - timedelta(days=1)).isoformat(),
            "hoy": ahora_sv().date().isoformat(), "teams": lista}


def _norm_svc(x) -> str:
    return re.sub(r"\s+", " ", str(x or "")).strip().upper()


@router.get("/servicios")
async def servicios_por_dia(mes: str = "", user: dict = Depends(current_user)):
    """Desglose por servicio de un MES, día por día (ventas de Residencial).

    mes=YYYY-MM (por defecto el actual). Cada servicio trae, por día del mes, cuántas ventas
    hubo en ICON, BAMO y sin mercado; la página filtra por mercado y suma.
    Mismas reglas que /ventas (sin canceladas, repro ni excluidas; restricción de mercado),
    así el total de un día coincide con Ventas de ese día. Cada venta cuenta una vez, con su
    primer servicio, llevado a su nombre oficial con los equivalentes de Productos.
    """
    import json
    hoy = ahora_sv().date()
    if mes:
        m = re.fullmatch(r"(\d{4})-(\d{2})", mes)
        if not m or not 1 <= int(m.group(2)) <= 12:
            raise HTTPException(400, "mes debe ser YYYY-MM")
        desde = date(int(m.group(1)), int(m.group(2)), 1)
    else:
        desde = hoy.replace(day=1)
    hasta = date(desde.year + (desde.month == 12), desde.month % 12 + 1, 1)
    params: dict = {"d": desde, "h": hasta}
    filtro_mercado = ""
    mercado = await resolve_market_restriction(user)
    if mercado:
        filtro_mercado = "AND UPPER(TRIM(COALESCE(mercado, ''))) = :mer"
        params["mer"] = mercado

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT servicio, equivalentes FROM productos"))
        canon: dict[str, str] = {}
        for p in r.mappings().all():
            if not p["servicio"]:
                continue
            canon[_norm_svc(p["servicio"])] = p["servicio"]
            eq = p["equivalentes"]
            if isinstance(eq, str):
                try:
                    eq = json.loads(eq)
                except ValueError:
                    eq = []
            for e in eq or []:
                canon[_norm_svc(e)] = p["servicio"]
        r = await s.execute(text(f"""
            SELECT dia_venta, servicios, tipo_servicio, COALESCE(status, '') AS status,
                   UPPER(TRIM(COALESCE(mercado, ''))) AS mercado
            FROM leads
            WHERE dia_venta >= :d AND dia_venta < :h
              AND (excluir_de_reporte IS NULL OR excluir_de_reporte = FALSE)
              {filtro_mercado}
        """), params)
        filas = r.mappings().all()

    servicios: dict[str, dict] = {}
    for v in filas:
        if _NO_CUENTA.search(v["status"].lower()) or not v["dia_venta"]:
            continue
        sv = v["servicios"]
        if isinstance(sv, str):
            try:
                sv = json.loads(sv)
            except ValueError:
                sv = [sv]
        nombre = (sv[0] if isinstance(sv, list) and sv else None) or v["tipo_servicio"] or "Otro"
        nombre = canon.get(_norm_svc(nombre), str(nombre).strip() or "Otro")
        merc = "icon" if "ICON" in v["mercado"] else "bamo" if "BAMO" in v["mercado"] else "otro"
        dia = str(v["dia_venta"].day if hasattr(v["dia_venta"], "day") else int(str(v["dia_venta"])[8:10]))
        f = servicios.setdefault(nombre, {"servicio": nombre, "dias": {}})
        celda = f["dias"].setdefault(dia, {"icon": 0, "bamo": 0, "otro": 0})
        celda[merc] += 1

    n_dias = (hasta - desde).days
    return {"success": True, "mes": desde.strftime("%Y-%m"), "dias": n_dias,
            "hoy": hoy.isoformat(), "servicios": list(servicios.values())}
