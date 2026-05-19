from fastapi import APIRouter, Depends, Query
from fastapi import Body
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime
from typing import Optional, List

router = APIRouter(prefix="/api/equipos", tags=["Equipos"])


def _to_ymd(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


SAMPLE_DATA = [
    {"TEAM": "TEAM IRANIA",           "Icon": 8,  "BAMO": 7,  "Total": 15, "Puntaje": 46.7},
    {"TEAM": "TEAM ROBERTO VELASQUEZ","Icon": 12, "BAMO": 11, "Total": 23, "Puntaje": 47.8},
    {"TEAM": "TEAM BRYAN PLEITEZ",    "Icon": 9,  "BAMO": 9,  "Total": 18, "Puntaje": 50.0},
    {"TEAM": "TEAM MARISOL BELTRAN",  "Icon": 6,  "BAMO": 6,  "Total": 12, "Puntaje": 50.0},
    {"TEAM": "TEAM RANDAL MARTINEZ",  "Icon": 11, "BAMO": 9,  "Total": 20, "Puntaje": 45.0},
    {"TEAM": "TEAM LINEA",            "Icon": 4,  "BAMO": 4,  "Total": 8,  "Puntaje": 50.0},
]

# Alias map: last-name fragment → normalized team key
_TEAM_ALIAS = {
    "PLEITEZ":   "PLEITEZ",
    "VELASQUEZ": "ROBERTO",
    "BELTRAN":   "MARISOL",
    "SERRANO":   "IRANIA",
    "JOHANA":    "JOHANA",
    "SANTANA":   "JOHANA",
    "JONATHAN":  "JONATHAN F",
    "LUIS":      "LUIS G",
}


def _normalize_team(team_raw: str) -> str:
    if not team_raw:
        return "SIN EQUIPO"
    parts = team_raw.strip().upper().split()
    last = parts[-1] if parts else team_raw.upper()
    for fragment, alias in _TEAM_ALIAS.items():
        if fragment in last:
            return alias
    return last or "SIN EQUIPO"


@router.get("/test")
async def equipo_test(user: dict = Depends(current_user)):
    return {"success": True, "data": SAMPLE_DATA, "total": len(SAMPLE_DATA), "message": "Datos de prueba"}


@router.get("/lista")
async def equipo_lista(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        try:
            r = await s.execute(text(
                "SELECT DISTINCT UPPER(TRIM(supervisor)) as sup FROM leads WHERE supervisor IS NOT NULL AND supervisor != ''"
            ))
            teams = sorted({row["sup"] for row in r.mappings().all() if row["sup"]})
        except Exception:
            teams = []
    return {"success": True, "data": teams, "total": len(teams)}


@router.get("/estadisticas")
async def equipo_estadisticas(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    scope:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = datetime.utcnow()
    if not fechaInicio or not fechaFin:
        fi = _to_ymd(datetime(now.year, now.month, 1))
        ff = _to_ymd(now)
        if scope == "day":
            fi = ff = _to_ymd(now)
        fechaInicio, fechaFin = fi, ff

    params = {"fi": fechaInicio, "ff": fechaFin}

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT
                    UPPER(TRIM(COALESCE(supervisor, team, equipo, ''))) AS team_raw,
                    UPPER(TRIM(COALESCE(mercado, 'SIN MERCADO')))       AS mercado_norm,
                    LOWER(TRIM(COALESCE(status, '')))                   AS status_lower,
                    COALESCE(puntaje, 0)                                AS puntaje
                FROM leads
                WHERE dia_venta BETWEEN :fi AND :ff
            """), params)
            rows = r.mappings().all()
    except Exception as e:
        return {"success": False, "message": f"Error: {e}", "data": []}

    # Aggregate in Python with team normalization
    agg: dict = {}
    active_re  = {"completed", "completado", "complete", "active", "activo", "activa"}
    pending_re = {"pending", "pendiente"}
    repro_re   = {"repro", "rescheduled", "reagendado"}
    valid_re   = active_re | pending_re  # ventas = completed/active + pending

    for row in rows:
        team_norm  = _normalize_team(row["team_raw"])
        mercado    = row["mercado_norm"]
        sl         = row["status_lower"]
        puntaje    = float(row["puntaje"] or 0)
        is_counted = any(v in sl for v in valid_re)
        is_active  = any(a in sl for a in active_re)
        is_repro   = any(r in sl for r in repro_re)

        if team_norm not in agg:
            agg[team_norm] = {"TEAM": team_norm, "ICON": 0, "BAMO": 0, "Total": 0,
                              "ACTIVAS": 0, "Repro": 0, "Puntaje": 0.0}
        entry = agg[team_norm]
        if is_counted:
            entry["Total"]  += 1
            entry["Puntaje"] += puntaje
            if "ICON" in mercado:
                entry["ICON"] += 1
            elif "BAMO" in mercado:
                entry["BAMO"] += 1
        if is_active:
            entry["ACTIVAS"] += 1
        if is_repro:
            entry["Repro"] += 1

    data = [v for v in agg.values() if v["Total"] > 0]
    data.sort(key=lambda x: -x["Total"])

    return {
        "success":     True,
        "data":        data,
        "total":       len(data),
        "fechaInicio": fechaInicio,
        "fechaFin":    fechaFin,
    }


@router.get("/telefonos")
async def equipo_telefonos(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    """Devuelve todos los teléfonos del mes y detecta duplicados."""
    now = datetime.utcnow()
    fi = fechaInicio or f"{now.year}-{str(now.month).zfill(2)}-01"
    ff = fechaFin    or now.strftime("%Y-%m-%d")
    params = {"fi": fi, "ff": ff}
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT
                    id,
                    COALESCE(telefono_principal, telefono, '') AS tel,
                    nombre_cliente,
                    UPPER(TRIM(COALESCE(supervisor, team, equipo, ''))) AS team_raw,
                    status,
                    dia_venta,
                    dia_instalacion
                FROM leads
                WHERE dia_venta BETWEEN :fi AND :ff
                ORDER BY tel
            """), params)
            rows = r.mappings().all()
    except Exception as e:
        return {"success": False, "message": str(e)}

    # Agrupar por teléfono para detectar duplicados
    from collections import defaultdict
    tel_map: dict = defaultdict(list)
    for row in rows:
        tel = str(row["tel"] or "").strip().replace(" ", "").replace("-", "")
        if not tel:
            continue
        tel_map[tel].append({
            "id":       str(row["id"]),
            "nombre":   row["nombre_cliente"],
            "team":     _normalize_team(row["team_raw"]),
            "status":   row["status"],
            "dia_venta": str(row["dia_venta"] or ""),
            "dia_instalacion": str(row["dia_instalacion"] or ""),
        })

    duplicados = {tel: leads for tel, leads in tel_map.items() if len(leads) > 1}
    todos = [{"tel": tel, "leads": leads} for tel, leads in tel_map.items()]

    return {
        "success": True,
        "total_telefonos": len(tel_map),
        "total_duplicados": len(duplicados),
        "duplicados": [{"tel": tel, "veces": len(leads), "leads": leads} for tel, leads in duplicados.items()],
        "fechaInicio": fi,
        "fechaFin": ff,
    }


@router.post("/comparar-telefonos")
async def equipo_comparar_telefonos(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    telefonos: List[str] = Body(..., description="Lista de teléfonos del Excel"),
    user: dict = Depends(current_user),
):
    """Compara una lista de teléfonos del Excel contra la BD."""
    now = datetime.utcnow()
    fi = fechaInicio or f"{now.year}-{str(now.month).zfill(2)}-01"
    ff = fechaFin    or now.strftime("%Y-%m-%d")

    def clean_tel(t: str) -> str:
        return str(t or "").strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")

    excel_set = {clean_tel(t) for t in telefonos if clean_tel(t)}

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT
                    COALESCE(telefono_principal, telefono, '') AS tel,
                    nombre_cliente,
                    UPPER(TRIM(COALESCE(supervisor, team, equipo, ''))) AS team_raw,
                    status, dia_venta
                FROM leads
                WHERE dia_venta BETWEEN :fi AND :ff
            """), {"fi": fi, "ff": ff})
            rows = r.mappings().all()
    except Exception as e:
        return {"success": False, "message": str(e)}

    db_map = {}
    for row in rows:
        tel = clean_tel(row["tel"])
        if tel:
            db_map[tel] = {"nombre": row["nombre_cliente"], "team": _normalize_team(row["team_raw"]), "status": row["status"]}

    db_set = set(db_map.keys())

    en_excel_y_bd  = [{"tel": t, **db_map[t]} for t in excel_set & db_set]
    solo_en_excel  = list(excel_set - db_set)
    solo_en_bd     = [{"tel": t, **db_map[t]} for t in db_set - excel_set]

    return {
        "success": True,
        "excel_total":    len(excel_set),
        "bd_total":       len(db_set),
        "coinciden":      len(en_excel_y_bd),
        "solo_en_excel":  solo_en_excel,
        "solo_en_bd":     solo_en_bd,
    }


@router.get("/debug")
async def equipo_debug(user: dict = Depends(current_user)):
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT id, supervisor, team, equipo, mercado, status, dia_venta
                FROM leads LIMIT 10
            """))
            sample = [dict(row) for row in r.mappings().all()]
            for d in sample:
                d["id"] = str(d["id"])
                if d.get("dia_venta"): d["dia_venta"] = str(d["dia_venta"])
    except Exception as e:
        sample = [{"error": str(e)}]
    return {"success": True, "sample": sample}
