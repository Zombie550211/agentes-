from fastapi import APIRouter, Depends, Query
from database import get_db
from deps import current_user
from datetime import datetime, timezone
from typing import Optional

router = APIRouter(prefix="/api/equipos", tags=["Equipos"])


def _to_ymd(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


SAMPLE_DATA = [
    {"TEAM": "TEAM IRANIA",          "Icon": 8,  "BAMO": 7,  "Total": 15, "Puntaje": 46.7},
    {"TEAM": "TEAM ROBERTO VELASQUEZ","Icon": 12, "BAMO": 11, "Total": 23, "Puntaje": 47.8},
    {"TEAM": "TEAM BRYAN PLEITEZ",   "Icon": 9,  "BAMO": 9,  "Total": 18, "Puntaje": 50.0},
    {"TEAM": "TEAM MARISOL BELTRAN", "Icon": 6,  "BAMO": 6,  "Total": 12, "Puntaje": 50.0},
    {"TEAM": "TEAM RANDAL MARTINEZ", "Icon": 11, "BAMO": 9,  "Total": 20, "Puntaje": 45.0},
    {"TEAM": "TEAM LINEA",           "Icon": 4,  "BAMO": 4,  "Total": 8,  "Puntaje": 50.0},
]


@router.get("/test")
async def equipo_test(user: dict = Depends(current_user)):
    return {"success": True, "data": SAMPLE_DATA, "total": len(SAMPLE_DATA), "message": "Datos de prueba"}


@router.get("/lista")
async def equipo_lista(user: dict = Depends(current_user)):
    db = get_db()
    try:
        teams = await db["costumers_unified"].distinct("supervisor")
        teams = [str(t).strip().upper() for t in teams if t]
        teams = sorted(set(teams))
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
    db = get_db()

    now = datetime.utcnow()
    if not fechaInicio or not fechaFin:
        start_month = datetime(now.year, now.month, 1)
        fechaInicio = _to_ymd(start_month)
        fechaFin    = _to_ymd(now)
        if scope == "day":
            fechaInicio = _to_ymd(now)
            fechaFin    = _to_ymd(now)

    # Stages comunes de filtro y agrupación
    common_stages = [
        {"$addFields": {
            "_dateRaw": {"$ifNull": ["$dia_venta", {"$ifNull": ["$fecha_contratacion", {"$ifNull": ["$createdAt", None]}]}]}
        }},
        {"$addFields": {
            "_date": {"$cond": [
                {"$eq": [{"$type": "$_dateRaw"}, "date"]},
                "$_dateRaw",
                {"$cond": [
                    {"$eq": [{"$type": "$_dateRaw"}, "string"]},
                    {"$dateFromString": {"dateString": {"$toString": "$_dateRaw"}, "timezone": "-06:00", "onError": None, "onNull": None}},
                    None
                ]}
            ]}
        }},
        {"$match": {
            "_date": {"$ne": None},
            "$expr": {"$and": [
                {"$gte": [{"$dateToString": {"format": "%Y-%m-%d", "date": "$_date"}}, fechaInicio]},
                {"$lte": [{"$dateToString": {"format": "%Y-%m-%d", "date": "$_date"}}, fechaFin]},
            ]},
        }},
        {"$addFields": {
            "_statusLower": {"$toLower": {"$trim": {"input": {"$toString": {"$ifNull": ["$status",""]}}}}},
            "_teamRaw": {"$toUpper": {"$trim": {"input": {"$ifNull": ["$supervisor", {"$ifNull": ["$team", {"$ifNull": ["$equipo", ""]}]}]}}}},
            "_mercadoNorm": {"$toUpper": {"$trim": {"input": {"$ifNull": ["$mercado", "SIN MERCADO"]}}}},
            "_puntaje": {"$toDouble": {"$ifNull": ["$puntaje", 0]}},
        }},
        # Normalizar supervisor: extraer último apellido ("Bryan Pleitez" → "PLEITEZ")
        # y mapear alias conocidos
        {"$addFields": {
            "_teamParts": {"$split": ["$_teamRaw", " "]},
        }},
        {"$addFields": {
            "_teamLast": {"$cond": [
                {"$gt": [{"$size": "$_teamParts"}, 1]},
                {"$arrayElemAt": ["$_teamParts", -1]},
                "$_teamRaw"
            ]},
        }},
        {"$addFields": {
            "_teamNorm": {"$switch": {
                "branches": [
                    {"case": {"$regexMatch": {"input": "$_teamLast", "regex": "PLEITEZ"}}, "then": "PLEITEZ"},
                    {"case": {"$regexMatch": {"input": "$_teamLast", "regex": "VELASQUEZ"}}, "then": "ROBERTO"},
                    {"case": {"$regexMatch": {"input": "$_teamLast", "regex": "BELTRAN"}}, "then": "MARISOL"},
                    {"case": {"$regexMatch": {"input": "$_teamLast", "regex": "SERRANO"}}, "then": "IRANIA"},
                    {"case": {"$regexMatch": {"input": "$_teamLast", "regex": "JOHANA|SANTANA"}}, "then": "JOHANA"},
                    {"case": {"$regexMatch": {"input": "$_teamLast", "regex": "JONATHAN"}}, "then": "JONATHAN F"},
                    {"case": {"$regexMatch": {"input": "$_teamLast", "regex": "LUIS"}}, "then": "LUIS G"},
                ],
                "default": {"$cond": [{"$eq": ["$_teamRaw", ""]}, "SIN EQUIPO", "$_teamLast"]}
            }},
        }},
        {"$addFields": {
            "_isCounted": {"$not": {"$regexMatch": {"input": "$_statusLower", "regex": r"cancel|reserva"}}},
            "_isActive":  {"$regexMatch": {"input": "$_statusLower", "regex": r"completed|completado|complete|active|activo|activa"}},
            "_isRepro":   {"$regexMatch": {"input": "$_statusLower", "regex": r"repro|rescheduled|reagendado"}},
        }},
        {"$group": {
            "_id":     "$_teamNorm",
            "ICON":    {"$sum": {"$cond": [{"$and": ["$_isCounted", {"$regexMatch": {"input": "$_mercadoNorm", "regex": "ICON"}}]}, 1, 0]}},
            "BAMO":    {"$sum": {"$cond": [{"$and": ["$_isCounted", {"$regexMatch": {"input": "$_mercadoNorm", "regex": "BAMO"}}]}, 1, 0]}},
            "Total":   {"$sum": {"$cond": ["$_isCounted", 1, 0]}},
            "ACTIVAS": {"$sum": {"$cond": ["$_isActive", 1, 0]}},
            "Repro":   {"$sum": {"$cond": ["$_isRepro", 1, 0]}},
            "Puntaje": {"$sum": {"$cond": ["$_isCounted", "$_puntaje", 0]}},
        }},
    ]

    pipeline = common_stages + [
        {"$project": {
            "_id": 0,
            "TEAM":    "$_id",
            "ICON":    1, "BAMO": 1, "Total": 1, "ACTIVAS": 1,
            "Puntaje": 1, "Repro": 1,
        }},
        {"$match": {"Total": {"$gt": 0}}},
        {"$sort": {"Total": -1}},
    ]

    try:
        data = await db["costumers_unified"].aggregate(pipeline, allowDiskUse=True).to_list(None)
    except Exception as e:
        import logging
        logging.getLogger("equipo").error("aggregate error: %s", e)
        return {"success": False, "message": f"Error al obtener estadísticas: {e}", "data": []}

    return {
        "success": True,
        "data": data,
        "total": len(data),
        "fechaInicio": fechaInicio,
        "fechaFin": fechaFin,
    }


@router.get("/debug")
async def equipo_debug(user: dict = Depends(current_user)):
    db = get_db()
    try:
        sample = await db["costumers_unified"].find(
            {}, {"supervisor":1,"team":1,"equipo":1,"mercado":1,"status":1,"dia_venta":1}
        ).limit(10).to_list(None)
        for d in sample:
            d["_id"] = str(d["_id"])
    except Exception as e:
        sample = [{"error": str(e)}]
    return {"success": True, "sample": sample}
