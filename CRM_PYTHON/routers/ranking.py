from fastapi import APIRouter, Depends, Query
from database import get_db
from deps import current_user
from datetime import datetime
from typing import Optional
import unicodedata, re, time

router = APIRouter(prefix="/api/ranking", tags=["Ranking"])

# Simple in-memory cache
_cache: dict = {}
_CACHE_TTL = 120  # 2 minutes


def _normalize_key(v: str) -> str:
    if not v:
        return ""
    n = unicodedata.normalize("NFKD", str(v)).encode("ascii","ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]","",n).lower()


def _humanize_name(v: str) -> str:
    if not v:
        return v
    if " " in v:
        return v
    spaced = re.sub(r"([a-z])([A-Z])",r"\1 \2",v)
    return spaced.strip() or v


def _sanitize_avatar(v: str) -> str:
    if not v:
        return ""
    v = str(v).strip()
    if v.startswith("data:image/") or re.match(r"^https?://",v):
        return v
    if v.startswith("//"):
        return f"https:{v}"
    if v.startswith("/"):
        return v
    if v.lower().startswith("uploads/"):
        return f"/{v}"
    return ""


def _build_ranking_pipeline(start_of_month: datetime, start_of_next_month: datetime,
                             allowed_statuses=None, agente: str = "", hard_limit: int = 100) -> list:
    early_match = {
        "$match": {
            "$or": [
                {"createdAt": {"$gte": start_of_month, "$lt": start_of_next_month}},
                {"dia_venta": {
                    "$gte": start_of_month.strftime("%Y-%m-01"),
                    "$lte": start_of_next_month.strftime("%Y-%m-31")
                }}
            ]
        }
    }

    pipeline = [
        early_match,
        # Parse dia_venta to date
        {"$addFields": {
            "_diaParsed": {
                "$cond": [
                    {"$eq": [{"$type": "$dia_venta"}, "date"]},
                    "$dia_venta",
                    {"$let": {"vars": {"s": {"$toString": "$dia_venta"}}, "in": {
                        "$cond": [
                            {"$regexMatch": {"input": "$$s", "regex": r"^\d{4}-\d{2}-\d{2}$"}},
                            {"$dateFromString": {"dateString": "$$s", "format": "%Y-%m-%d", "timezone": "-06:00"}},
                            {"$cond": [
                                {"$regexMatch": {"input": "$$s", "regex": r"^\d{1,2}/\d{1,2}/\d{4}$"}},
                                {"$let": {"vars": {"parts": {"$split": ["$$s","/"]}}, "in": {
                                    "$dateFromParts": {
                                        "year": {"$toInt": {"$arrayElemAt": ["$$parts",2]}},
                                        "month": {"$toInt": {"$arrayElemAt": ["$$parts",1]}},
                                        "day": {"$toInt": {"$arrayElemAt": ["$$parts",0]}}
                                    }
                                }}},
                                {"$dateFromString": {"dateString": "$$s", "timezone": "-06:00"}}
                            ]}
                        ]
                    }}}
                ]
            }
        }},
        # Fallback to createdAt if diaParsed is null
        {"$addFields": {
            "_diaParsed": {
                "$cond": [
                    {"$ne": ["$_diaParsed", None]},
                    "$_diaParsed",
                    {"$cond": [
                        {"$eq": [{"$type": "$createdAt"}, "date"]},
                        "$createdAt",
                        None
                    ]}
                ]
            }
        }},
        # Filter by date range
        {"$match": {
            "_diaParsed": {"$ne": None},
            "$expr": {"$and": [
                {"$gte": ["$_diaParsed", start_of_month]},
                {"$lt":  ["$_diaParsed", start_of_next_month]}
            ]}
        }},
        # Require agent field
        {"$match": {
            "$or": [
                {"agenteNombre": {"$exists": True, "$ne": None, "$ne": ""}},
                {"agente": {"$exists": True, "$ne": None, "$ne": ""}},
            ],
            "excluirDeReporte": {"$ne": True},
        }},
        # Normalize status and agent
        {"$addFields": {
            "_statusStr": {"$toUpper": {"$trim": {"input": {"$ifNull": ["$status",""]}}}},
            "_agenteFuente": {"$ifNull": ["$agenteNombre","$agente"]},
        }},
        {"$addFields": {
            "_statusNorm": {
                "$cond": [
                    {"$regexMatch": {"input": "$_statusStr", "regex": "CANCEL"}},
                    "CANCEL",
                    {"$cond": [
                        {"$regexMatch": {"input": "$_statusStr", "regex": "COMPLET"}},
                        "COMPLETED",
                        {"$cond": [
                            {"$regexMatch": {"input": "$_statusStr", "regex": "ACTIVE"}},
                            "ACTIVE",
                            {"$cond": [
                                {"$regexMatch": {"input": "$_statusStr", "regex": "PENDIENT|PENDING"}},
                                "PENDING",
                                "$_statusStr"
                            ]}
                        ]}
                    ]}
                ]
            }
        }},
        # Exclude RESERVA
        {"$match": {"_statusStr": {"$not": {"$regex": "RESERVA"}}}},
    ]

    if allowed_statuses:
        pipeline.append({"$match": {"_statusNorm": {"$in": allowed_statuses}}})

    if agente:
        pipeline.append({"$match": {"$or": [
            {"agenteNombre": {"$regex": agente, "$options": "i"}},
            {"agente": {"$regex": agente, "$options": "i"}},
        ]}})

    pipeline += [
        {"$addFields": {
            "isCancel": {"$eq": ["$_statusNorm","CANCEL"]},
            "puntajeEfectivo": {
                "$cond": [
                    {"$eq": ["$_statusNorm","CANCEL"]},
                    0,
                    {"$toDouble": {"$ifNull": ["$puntaje",0]}}
                ]
            },
        }},
        {"$addFields": {
            "_nameNoSpaces": {
                "$replaceAll": {"input": {"$replaceAll": {"input": {"$replaceAll": {"input": "$_agenteFuente","find":"_","replacement":""}}, "find":".","replacement":""}}, "find":" ","replacement":""}
            },
            "_nameNormLower": {
                "$toLower": {
                    "$replaceAll": {"input": {"$replaceAll": {"input": {"$replaceAll": {"input": "$_agenteFuente","find":"_","replacement":""}}, "find":".","replacement":""}}, "find":" ","replacement":""}
                }
            },
        }},
        {"$group": {
            "_id": "$_nameNormLower",
            "ventas": {"$sum": {"$cond": ["$isCancel",0,1]}},
            "sumPuntaje": {"$sum": "$puntajeEfectivo"},
            "avgPuntaje": {"$avg": "$puntajeEfectivo"},
            "signatures": {"$push": {
                "sig": {"$concat": [
                    {"$ifNull": ["$numero_cuenta",""]}, "|",
                    {"$ifNull": ["$telefono",{"$ifNull": ["$telefono_principal",""]}]}, "|",
                    {"$ifNull": ["$nombre_cliente",""]}, "|",
                    {"$ifNull": [{"$dateToString": {"format":"%Y-%m-%d","date":"$_diaParsed"}},""]}
                ]},
                "p": "$puntajeEfectivo"
            }},
            "anyName": {"$first": "$_nameNoSpaces"},
            "anyOriginal": {"$first": "$_agenteFuente"},
        }},
        {"$project": {
            "_id": 0,
            "nombre": {"$ifNull": ["$anyOriginal","$anyName"]},
            "nombreOriginal": {"$ifNull": ["$anyOriginal","$anyName"]},
            "nombreLimpio": "$anyName",
            "nombreNormalizado": "$_id",
            "ventas": 1,
            "sumPuntaje": 1,
            "avgPuntaje": 1,
            "puntos": "$sumPuntaje",
            "signatures": 1,
        }},
        {"$sort": {"puntos": -1, "ventas": -1, "nombre": 1}},
        {"$limit": hard_limit},
    ]
    return pipeline


@router.get("")
async def get_ranking(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    year:        Optional[str] = Query(None),
    statuses:    Optional[str] = Query(None),
    agente:      Optional[str] = Query(None),
    limit:       Optional[int] = Query(None),
    debug:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()

    allowed_statuses = None
    if statuses:
        parsed = [s.strip().upper() for s in statuses.split(",") if s.strip()]
        if parsed:
            allowed_statuses = parsed

    # Determine date range
    now = datetime.utcnow()

    if fechaInicio and fechaFin:
        # Usar fechas explícitas como rango principal
        start_of_month = datetime.fromisoformat(fechaInicio)
        end_dt = datetime.fromisoformat(fechaFin)
        start_of_next_month = datetime(end_dt.year, end_dt.month + 1, 1) if end_dt.month < 12 else datetime(end_dt.year + 1, 1, 1)
        start_date, end_date = fechaInicio, fechaFin
    else:
        if month and re.match(r"^\d{4}-\d{2}$", month):
            yr, mo = map(int, month.split("-"))
        elif month and year and re.match(r"^\d{4}$", year):
            yr, mo = int(year), int(month)
        else:
            yr, mo = now.year, now.month
        start_of_month = datetime(yr, mo, 1)
        start_of_next_month = datetime(yr + 1, 1, 1) if mo == 12 else datetime(yr, mo + 1, 1)
        start_date = start_of_month.strftime("%Y-%m-%d")
        end_date   = now.strftime("%Y-%m-%d")

    hard_limit = min(int(limit) if limit else 100, 500)

    cache_key = f"{start_date}|{end_date}|{statuses}|{agente}|{hard_limit}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached["ts"] < _CACHE_TTL and debug != "1":
        return cached["response"]

    pipeline = _build_ranking_pipeline(start_of_month, start_of_next_month, allowed_statuses, agente or "", hard_limit)
    try:
        ranking_results = await db["costumers_unified"].aggregate(pipeline, allowDiskUse=True).to_list(None)
    except Exception as _exc:
        import logging
        logging.getLogger("ranking").error("aggregate error: %s", _exc)
        ranking_results = []

    # Enrich with user data
    users_docs = await db["users"].find({}, {
        "username":1,"name":1,"email":1,"aliases":1,
        "avatarUrl":1,"avatarFileId":1,"avatarUpdatedAt":1,
        "photoUrl":1,"photo":1,"imageUrl":1,"picture":1,"profilePhoto":1,"avatar":1,
    }).to_list(None)

    user_map: dict = {}
    for u in users_docs:
        for val in [u.get("username"), u.get("name"), (u.get("email") or "").split("@")[0]]:
            k = _normalize_key(val)
            if k and k not in user_map:
                user_map[k] = u
        for alias in (u.get("aliases") or []):
            k = _normalize_key(alias)
            if k and k not in user_map:
                user_map[k] = u

    def build_avatar(u_doc):
        if not u_doc:
            return {"url": None, "fileId": None, "updatedAt": None}
        candidates = []
        if u_doc.get("avatarFileId"):
            candidates.append(f"/api/user-avatars/{u_doc['avatarFileId']}")
        for f in ("avatarUrl","photoUrl","photo","imageUrl","picture","profilePhoto","avatar"):
            candidates.append(u_doc.get(f,""))
        for c in candidates:
            s = _sanitize_avatar(str(c or ""))
            if s:
                updated = u_doc.get("avatarUpdatedAt")
                ts = int(updated.timestamp()*1000) if isinstance(updated, datetime) else None
                if ts:
                    sep = "&" if "?" in s else "?"
                    s = f"{s}{sep}v={ts}"
                return {"url": s, "fileId": str(u_doc["avatarFileId"]) if u_doc.get("avatarFileId") else None, "updatedAt": ts}
        return {"url": None, "fileId": None, "updatedAt": None}

    ranking_data = []
    for i, item in enumerate(ranking_results):
        raw_names = [n for n in [item.get("nombreOriginal"), item.get("nombre"), item.get("nombreLimpio")] if n]
        norm_candidates = [item.get("nombreNormalizado")] + [_normalize_key(n) for n in raw_names]
        matched_user = None
        for c in norm_candidates:
            if c and c in user_map:
                matched_user = user_map[c]
                break

        avatar_info = build_avatar(matched_user)
        display_name = (matched_user or {}).get("name") or (matched_user or {}).get("username") or _humanize_name(raw_names[0] if raw_names else "") or item.get("nombre","—")
        nombre_limpio = _humanize_name(item.get("nombreLimpio") or (raw_names[0] if raw_names else "")) or display_name

        ventas = int(item.get("ventas") or 0)
        puntos = float(item.get("sumPuntaje") or 0)

        ranking_data.append({
            **item,
            "nombre": display_name,
            "nombreOriginal": raw_names[0] if raw_names else display_name,
            "nombreLimpio": nombre_limpio,
            "username": (matched_user or {}).get("username"),
            "userId": str(matched_user["_id"]) if matched_user and matched_user.get("_id") else None,
            "avatarUrl": avatar_info["url"],
            "avatarFileId": avatar_info["fileId"],
            "imageUrl": avatar_info["url"] or item.get("imageUrl"),
            "ventas": ventas,
            "puntos": puntos,
            "sumPuntaje": puntos,
            "avgPuntaje": puntos / ventas if ventas > 0 else 0,
            "promedio": puntos / ventas if ventas > 0 else 0,
            "position": i + 1,
            "signatures": None,  # remove from response
        })

    # Re-sort
    ranking_data.sort(key=lambda x: (-x.get("puntos",0), -x.get("ventas",0), x.get("nombre","")))
    for i, row in enumerate(ranking_data):
        row["position"] = i + 1

    response = {
        "success": True,
        "message": "Datos de ranking obtenidos",
        "ranking": ranking_data,
        "data": {"ranking": ranking_data},
        "meta": {
            "count": len(ranking_data),
            "dateRange": {"startDate": start_date, "endDate": end_date},
            "collectionUsed": "costumers_unified",
        }
    }
    _cache[cache_key] = {"ts": time.time(), "response": response}
    return response
