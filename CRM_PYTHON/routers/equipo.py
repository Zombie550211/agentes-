from fastapi import APIRouter, Depends, Query
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime
from typing import Optional

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
                WHERE (
                    (dia_venta BETWEEN :fi AND :ff AND (dia_instalacion IS NULL OR dia_instalacion BETWEEN :fi AND :ff))
                    OR (dia_instalacion BETWEEN :fi AND :ff AND (dia_venta IS NULL OR dia_venta < :fi))
                    OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :fi AND :ff)
                )
            """), params)
            rows = r.mappings().all()
    except Exception as e:
        return {"success": False, "message": f"Error: {e}", "data": []}

    # Aggregate in Python with team normalization
    agg: dict = {}
    cancel_re  = {"cancel", "reserva"}
    active_re  = {"completed", "completado", "complete", "active", "activo", "activa"}
    repro_re   = {"repro", "rescheduled", "reagendado"}

    for row in rows:
        team_norm  = _normalize_team(row["team_raw"])
        mercado    = row["mercado_norm"]
        sl         = row["status_lower"]
        puntaje    = float(row["puntaje"] or 0)
        is_cancel  = any(c in sl for c in cancel_re)
        is_counted = not is_cancel
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
