from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from bson import ObjectId
from database import get_db, get_team_lineas_db
from deps import current_user, require_roles, ADMIN_ROLES, ADMIN_BO
from datetime import datetime
from typing import Optional, List, Any, Dict
import re, unicodedata, time

router = APIRouter(tags=["Leads"])

# ── Cache para colecciones ─────────────────────────────────────
_col_cache = {"ts": 0, "names": None}
_COL_TTL = 60


async def _get_costumers_collections(db) -> List[str]:
    global _col_cache
    if _col_cache["names"] and time.time() - _col_cache["ts"] < _COL_TTL:
        return _col_cache["names"]
    cols = await db.list_collection_names()
    names = [n for n in cols if re.match(r"^costumers(_|$)|^customers_unified", n, re.IGNORECASE)]
    _col_cache = {"ts": time.time(), "names": names}
    return names


def _oid(s: str):
    try:
        return ObjectId(str(s))
    except Exception:
        return None


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii","ignore").decode().lower().strip()


def _is_admin_or_bo(user: dict) -> bool:
    r = _normalize(user.get("role",""))
    return "admin" in r or "backoffice" in r or r == "rol_icon" or "rol_icon" in r


def _is_supervisor(user: dict) -> bool:
    return "supervisor" in _normalize(user.get("role",""))


def _is_agent(user: dict) -> bool:
    return not _is_admin_or_bo(user) and not _is_supervisor(user)


def _mercado_restrict(user: dict) -> str:
    r = _normalize(user.get("role",""))
    if "rol_bamo" in r or r == "bamo":
        return "BAMO"
    return ""


async def _find_lead_in_collection(col, record_id: str, obj_id):
    if obj_id:
        doc = await col.find_one({"_id": obj_id})
        if doc:
            return doc
    doc = await col.find_one({"_id": record_id})
    if doc:
        return doc
    alt_keys = ["id","leadId","sourceId","id_cliente","idCliente","clienteId","cliente_id","clientId","client_id"]
    query = {"$or": [{k: record_id} for k in alt_keys]}
    if obj_id:
        query["$or"] += [{k: obj_id} for k in alt_keys]
    return await col.find_one(query)


async def _find_lead_anywhere(db, record_id: str):
    obj_id = _oid(record_id)
    # Try unified first
    try:
        doc = await _find_lead_in_collection(db["costumers_unified"], record_id, obj_id)
        if doc:
            return doc, "costumers_unified"
    except Exception:
        pass
    # Try other costumers collections
    cols = await _get_costumers_collections(db)
    for col_name in cols:
        if col_name == "costumers_unified":
            continue
        try:
            doc = await _find_lead_in_collection(db[col_name], record_id, obj_id)
            if doc:
                return doc, col_name
        except Exception:
            pass
    return None, None


def _serialize_lead(doc: dict) -> dict:
    if doc is None:
        return {}
    d = dict(doc)
    d["_id"] = str(d["_id"]) if d.get("_id") else None
    d["id"]  = d["_id"] or ""
    return d


# ── GET /api/leads ──────────────────────────────────────────────
@router.get("/api/leads/months")
async def leads_months(
    limit: int = Query(60),
    sample: int = Query(20000),
    user: dict = Depends(current_user),
):
    db = get_db()
    pipeline = [
        {"$addFields": {
            "_raw": {"$ifNull": [
                "$dia_venta",
                {"$ifNull": ["$diaVenta",
                    {"$ifNull": ["$fecha_contratacion",
                        {"$ifNull": ["$fechaContratacion",
                            {"$ifNull": ["$createdAt", "$creadoEn"]}
                        ]}
                    ]}
                ]}
            ]}
        }},
        {"$match": {"_raw": {"$ne": None}}},
        {"$addFields": {
            "_ym": {"$cond": [
                {"$eq": [{"$type": "$_raw"}, "date"]},
                {"$dateToString": {"format": "%Y-%m", "date": "$_raw"}},
                {"$substr": [{"$toString": "$_raw"}, 0, 7]},
            ]}
        }},
        {"$match": {"_ym": {"$regex": r"^\d{4}-\d{2}$"}}},
        {"$group": {"_id": "$_ym"}},
        {"$sort": {"_id": -1}},
        {"$limit": limit},
    ]
    try:
        rows = await db["costumers_unified"].aggregate(pipeline, allowDiskUse=True).to_list(None)
        months = [r["_id"] for r in rows]
    except Exception:
        months = []
    return {"success": True, "data": months, "months": months, "source": "costumers_unified", "count": len(months)}


@router.get("/api/leads/collection-counts-public")
async def leads_collection_counts_public():
    db = get_db()
    cols = await _get_costumers_collections(db)
    result = {}
    for col_name in cols:
        try:
            result[col_name] = await db[col_name].estimated_document_count()
        except Exception:
            result[col_name] = 0
    return {"success": True, "data": result}


@router.get("/api/leads/collection-counts")
async def leads_collection_counts(user: dict = Depends(current_user)):
    db = get_db()
    cols = await _get_costumers_collections(db)
    result = {}
    for col_name in cols:
        try:
            result[col_name] = await db[col_name].estimated_document_count()
        except Exception:
            result[col_name] = 0
    return {"success": True, "data": result}


@router.get("/api/leads/agents-summary")
async def leads_agents_summary(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()
    now = datetime.utcnow()

    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    end   = fechaFin   or now.strftime("%Y-%m-%d")

    pipeline = [
        {"$addFields": {
            "_dateStr": {"$ifNull": [
                {"$cond": [{"$eq":[{"$type":"$dia_venta"},"date"]},{"$dateToString":{"format":"%Y-%m-%d","date":"$dia_venta"}},{"$toString":"$dia_venta"}]},
                {"$cond": [{"$eq":[{"$type":"$createdAt"},"date"]},{"$dateToString":{"format":"%Y-%m-%d","date":"$createdAt"}},""]},
            ]},
            "_agente": {"$ifNull":["$agenteNombre","$agente"]},
        }},
        {"$match": {
            "_dateStr": {"$gte": start, "$lte": end},
            "_agente": {"$ne": None, "$ne": ""},
        }},
        {"$group": {
            "_id": "$_agente",
            "total": {"$sum": 1},
            "completed": {"$sum": {"$cond": [{"$regexMatch":{"input":{"$toUpper":{"$ifNull":["$status",""]}},"regex":"COMPLET|ACTIVE"}},1,0]}},
            "cancelled": {"$sum": {"$cond": [{"$regexMatch":{"input":{"$toUpper":{"$ifNull":["$status",""]}},"regex":"CANCEL"}},1,0]}},
            "puntaje":   {"$sum": {"$toDouble":{"$ifNull":["$puntaje",0]}}},
        }},
        {"$sort": {"total": -1}},
        {"$limit": 200},
    ]
    rows = await db["costumers_unified"].aggregate(pipeline, allowDiskUse=True).to_list(None)
    return {"success": True, "data": rows}


@router.get("/api/leads/kpis")
async def leads_kpis(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()
    now = datetime.utcnow()

    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    end   = fechaFin   or now.strftime("%Y-%m-%d")

    pipeline = [
        {"$addFields": {
            "_dateStr": {"$cond": [
                {"$eq": [{"$type":"$dia_venta"},"date"]},
                {"$dateToString":{"format":"%Y-%m-%d","date":"$dia_venta"}},
                {"$toString": "$dia_venta"}
            ]},
        }},
        {"$match": {"_dateStr": {"$gte": start, "$lte": end}}},
        {"$group": {
            "_id": None,
            "total": {"$sum": 1},
            "completed": {"$sum": {"$cond":[{"$regexMatch":{"input":{"$toUpper":{"$ifNull":["$status",""]}},"regex":"COMPLET|ACTIVE"}},1,0]}},
            "cancelled": {"$sum": {"$cond":[{"$regexMatch":{"input":{"$toUpper":{"$ifNull":["$status",""]}},"regex":"CANCEL"}},1,0]}},
            "pending":   {"$sum": {"$cond":[{"$regexMatch":{"input":{"$toUpper":{"$ifNull":["$status",""]}},"regex":"PENDING|PENDIENTE"}},1,0]}},
            "puntajeTotal": {"$sum": {"$toDouble":{"$ifNull":["$puntaje",0]}}},
        }},
    ]
    rows = await db["costumers_unified"].aggregate(pipeline).to_list(None)
    kpi = rows[0] if rows else {"total":0,"completed":0,"cancelled":0,"pending":0,"puntajeTotal":0}
    kpi.pop("_id", None)
    return {"success": True, "data": kpi}


class LeadCreateBody(BaseModel):
    nombre_cliente:     str = ""
    telefono_principal: str = ""
    telefono_2:         str = ""
    direccion:          str = ""
    zip_code:           str = ""
    servicios:          str = ""
    tipo_servicio:      str = ""
    numero_cuenta:      str = ""
    mercado:            str = ""
    motivo_llamada:     str = ""
    status:             str = "PENDING"
    autopago:           str = ""
    sistema:            str = ""
    riesgo:             str = ""
    comentario:         str = ""
    puntaje:            str = ""
    dia_venta:          str = ""
    dia_instalacion:    str = ""
    supervisor:         str = ""
    agente:             str = ""
    creadoEn:           Optional[str] = None


@router.post("/api/leads")
async def create_lead(body: LeadCreateBody, user: dict = Depends(current_user)):
    db = get_db()
    now = datetime.utcnow()
    doc = body.model_dump()
    doc["createdAt"]  = now
    doc["updatedAt"]  = now
    doc["creadoPor"]  = user.get("username", "")
    doc["creadoPorId"] = str(user.get("id", ""))
    if not doc.get("agente"):
        doc["agente"] = user.get("username", "")
    if not doc.get("supervisor"):
        doc["supervisor"] = user.get("supervisor", "")

    new_id = ObjectId()
    doc["_id"]              = new_id
    doc["sourceCollection"] = "leads"
    doc["sourceId"]         = str(new_id)

    await db["costumers_unified"].insert_one(doc)
    return {
        "success": True,
        "message": "Lead guardado exitosamente",
        "id":      str(new_id),
    }


@router.get("/api/leads")
async def list_leads(
    fechaInicio:       Optional[str] = Query(None),
    fechaFin:          Optional[str] = Query(None),
    status:            Optional[str] = Query(None),
    month:             Optional[str] = Query(None),
    allData:           Optional[str] = Query(None),
    noFilter:          Optional[str] = Query(None),
    skipDate:          Optional[str] = Query(None),
    noAutoMonth:       Optional[str] = Query(None),
    agentName:         Optional[str] = Query(None),
    agents:            Optional[str] = Query(None),
    vendedor:          Optional[str] = Query(None),
    telefono:          Optional[str] = Query(None),
    telefono_principal:Optional[str] = Query(None),
    nombre_cliente:    Optional[str] = Query(None),
    direccion:         Optional[str] = Query(None),
    year:              Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()
    and_conds = []

    def _esc(s: str) -> str:
        return re.escape(str(s or "").strip())

    # Text filters
    tel_val = str(telefono_principal or telefono or "").strip()
    if tel_val:
        rx = _esc(tel_val)
        and_conds.append({"$or": [
            {"telefono_principal": {"$regex": rx, "$options":"i"}},
            {"telefono":           {"$regex": rx, "$options":"i"}},
            {"phone":              {"$regex": rx, "$options":"i"}},
        ]})

    if nombre_cliente:
        rx = _esc(nombre_cliente)
        and_conds.append({"$or": [
            {"nombre_cliente": {"$regex": rx, "$options":"i"}},
            {"nombre":         {"$regex": rx, "$options":"i"}},
            {"name":           {"$regex": rx, "$options":"i"}},
        ]})

    if direccion:
        rx = _esc(direccion)
        and_conds.append({"$or": [
            {"direccion": {"$regex": rx, "$options":"i"}},
            {"address":   {"$regex": rx, "$options":"i"}},
        ]})

    # Mercado restriction by role
    mercado_restrict = _mercado_restrict(user)
    if mercado_restrict:
        and_conds.append({"mercado": {"$regex": f"^{mercado_restrict}$", "$options":"i"}})

    # Global request (all collections, no date filter)
    is_global = any(str(v or "").lower() in ("true","1") for v in [allData, noFilter, skipDate])
    if is_global and not fechaInicio and not fechaFin and not month and not status:
        leads = []
        cols = await _get_costumers_collections(db)
        for col_name in cols:
            try:
                docs = await db[col_name].find({}).to_list(None)
                leads.extend(docs)
            except Exception:
                pass
        # Apply mercado filter
        if mercado_restrict:
            target = mercado_restrict.upper()
            leads = [d for d in leads if str(d.get("mercado") or "").strip().upper() == target]
        # Apply reserva visibility filter for non-privileged users
        if not _is_admin_or_bo(user):
            username = user.get("username","")
            team = user.get("team","")
            leads = [d for d in leads if _can_see_lead(d, user, username, team)]
        # Serialize
        leads = [_serialize_lead(d) for d in leads]
        return {"success": True, "data": leads, "queryUsed": {"global": True}}

    # Reserva visibility
    if not _is_admin_or_bo(user):
        username = user.get("username","")
        team = user.get("team","")
        scope_or = _build_reserva_scope(user, username, team)
        and_conds.append({"$or": [
            {"status": {"$not": re.compile("reserva","i")}},
            {"$and": [
                {"status": {"$regex": "reserva","$options":"i"}},
                scope_or if scope_or else {"_id": "__no_reserva__"}
            ]}
        ]})

    # Status filter
    if status and status.lower() != "todos":
        and_conds.append({"status": status})

    # Agent filter (supervisor)
    if _is_supervisor(user):
        agent_filter = str(agentName or vendedor or "").strip()
        if agent_filter:
            rx = _esc(agent_filter)
            and_conds.append({"$or": [
                {"agenteNombre": {"$regex": rx, "$options":"i"}},
                {"agente":       {"$regex": rx, "$options":"i"}},
                {"createdBy":    {"$regex": rx, "$options":"i"}},
            ]})
    elif _is_agent(user):
        username = user.get("username","")
        if username:
            rx = _esc(username)
            and_conds.append({"$or": [
                {"agenteNombre": {"$regex": rx, "$options":"i"}},
                {"agente":       {"$regex": rx, "$options":"i"}},
                {"createdBy":    {"$regex": rx, "$options":"i"}},
            ]})

    # Date filter
    disable_auto = str(noAutoMonth or "").lower() in ("1","true")
    if not disable_auto and not fechaInicio and not fechaFin:
        now = datetime.utcnow()
        if month and re.match(r"^\d{4}-\d{2}$", month):
            yr, mo = map(int, month.split("-"))
        elif month and year and re.match(r"^\d{4}$", year or ""):
            yr, mo = int(year), int(month)
        else:
            yr, mo = now.year, now.month
        fechaInicio = f"{yr}-{mo:02d}-01"
        import calendar
        last_day = calendar.monthrange(yr, mo)[1]
        fechaFin = f"{yr}-{mo:02d}-{last_day:02d}"

    if fechaInicio or fechaFin:
        date_or = []
        if fechaInicio and fechaFin:
            date_or.append({"$and":[
                {"dia_venta":{"$regex":f"^{(fechaInicio or '')[:7]}-","$options":"i"}},
            ]})
        # Use aggregation approach for date filtering
        start_str = fechaInicio or "2000-01-01"
        end_str   = fechaFin   or "2099-12-31"
        and_conds.append({"$or": [
            {"dia_venta": {"$gte": start_str, "$lte": end_str}},
            # Also match Date objects by string comparison via the query
            {"$and": [
                {"dia_venta": {"$type": "date"}},
                {"dia_venta": {"$gte": datetime.fromisoformat(start_str), "$lte": datetime.fromisoformat(end_str + "T23:59:59")}},
            ]},
        ]})

    query = {"$and": and_conds} if and_conds else {}

    try:
        docs = await db["costumers_unified"].find(query).sort("_id", -1).limit(5000).to_list(None)
    except Exception as _exc:
        import logging
        logging.getLogger("leads").error("list_leads error: %s", _exc)
        docs = []

    leads = [_serialize_lead(d) for d in docs]
    return {"success": True, "data": leads, "queryUsed": query}


def _can_see_lead(doc: dict, user: dict, username: str, team: str) -> bool:
    status = _normalize(doc.get("status") or "")
    if "reserva" not in status:
        return True
    if _is_admin_or_bo(user):
        return True
    uname_n = _normalize(username)
    if _is_agent(user):
        agente = _normalize(doc.get("agenteNombre") or doc.get("agente") or "")
        created = _normalize(doc.get("createdBy") or "")
        return uname_n and (agente == uname_n or created == uname_n)
    if _is_supervisor(user):
        t = _normalize(doc.get("team") or "")
        t_n = _normalize(team)
        sup = _normalize(doc.get("supervisor") or "")
        return (t_n and t == t_n) or (uname_n and sup == uname_n)
    return False


def _build_reserva_scope(user: dict, username: str, team: str) -> Optional[dict]:
    scope_or = []
    if _is_agent(user) and username:
        rx = re.escape(username)
        scope_or.extend([
            {"createdBy":    {"$regex": f"^{rx}$", "$options":"i"}},
            {"agenteNombre": {"$regex": f"^{rx}$", "$options":"i"}},
            {"agente":       {"$regex": f"^{rx}$", "$options":"i"}},
        ])
    elif _is_supervisor(user):
        if team:
            rx = re.escape(team)
            scope_or.append({"team": {"$regex": f"^{rx}$", "$options":"i"}})
        if username:
            rx = re.escape(username)
            scope_or.append({"supervisor": {"$regex": f"^{rx}$", "$options":"i"}})
    return {"$or": scope_or} if scope_or else None


# ── LEADS STATS ────────────────────────────────────────────────
@router.get("/api/estadisticas/leads-dashboard")
async def leads_dashboard(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()
    now = datetime.utcnow()

    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    end   = fechaFin   or now.strftime("%Y-%m-%d")

    pipeline = [
        {"$addFields": {
            "_dateStr": {"$cond":[
                {"$eq":[{"$type":"$dia_venta"},"date"]},
                {"$dateToString":{"format":"%Y-%m-%d","date":"$dia_venta"}},
                {"$toString":"$dia_venta"}
            ]},
            "_statusU": {"$toUpper": {"$trim": {"input": {"$ifNull":["$status",""]}}}},
        }},
        {"$match": {"_dateStr":{"$gte":start,"$lte":end}}},
        {"$facet": {
            "byStatus": [
                {"$group":{"_id":"$_statusU","count":{"$sum":1}}},
                {"$sort":{"count":-1}},
            ],
            "byMercado": [
                {"$group":{"_id":{"$toUpper":{"$ifNull":["$mercado","SIN MERCADO"]}},"count":{"$sum":1}}},
                {"$sort":{"count":-1}},
            ],
            "totals": [
                {"$group":{
                    "_id": None,
                    "total": {"$sum":1},
                    "completed": {"$sum":{"$cond":[{"$regexMatch":{"input":"$_statusU","regex":"COMPLET|ACTIVE"}},1,0]}},
                    "cancelled": {"$sum":{"$cond":[{"$regexMatch":{"input":"$_statusU","regex":"CANCEL"}},1,0]}},
                    "puntaje": {"$sum":{"$toDouble":{"$ifNull":["$puntaje",0]}}},
                }},
            ],
        }},
    ]
    rows = await db["costumers_unified"].aggregate(pipeline).to_list(None)
    data = rows[0] if rows else {}
    totals = (data.get("totals") or [{}])[0]
    totals.pop("_id",None)
    return {"success": True, "data": {
        "byStatus": data.get("byStatus",[]),
        "byMercado": data.get("byMercado",[]),
        "totals": totals,
        "dateRange": {"start": start, "end": end},
    }}


# ── SEMAFORO ───────────────────────────────────────────────────
@router.get("/api/semaforo")
async def semaforo(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    statuses:    Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()
    now = datetime.utcnow()
    start_date = fechaInicio or datetime(now.year, now.month, 1).strftime("%Y-%m-%d")
    end_date   = fechaFin   or now.strftime("%Y-%m-%d")

    allowed_statuses = None
    if statuses:
        parsed = [s.strip().upper() for s in statuses.split(",") if s.strip()]
        if parsed:
            allowed_statuses = parsed

    pipeline = [
        {"$addFields": {
            "_agenteFuente": {"$ifNull":["$agenteNombre","$agente"]},
            "_statusStr": {"$toUpper":{"$trim":{"input":{"$ifNull":["$status",""]}}}},
        }},
        {"$addFields": {
            "_statusNorm": {"$cond":[
                {"$regexMatch":{"input":"$_statusStr","regex":"CANCEL"}},"CANCEL",
                {"$cond":[{"$regexMatch":{"input":"$_statusStr","regex":"COMPLET"}},"COMPLETED",
                    {"$cond":[{"$regexMatch":{"input":"$_statusStr","regex":"ACTIVE"}},"ACTIVE",
                        {"$cond":[{"$regexMatch":{"input":"$_statusStr","regex":"PENDIENT|PENDING"}},"PENDING","$_statusStr"]}
                    ]}
                ]}
            ]},
        }},
        {"$addFields": {
            "isCancel": {"$eq":["$_statusNorm","CANCEL"]},
            "isValido": {"$in":["$_statusNorm",["PENDING","COMPLETED","ACTIVE"]]},
            "puntajeEfectivo": {"$cond":[{"$in":["$_statusNorm",["PENDING","COMPLETED","ACTIVE"]]},{"$toDouble":{"$ifNull":["$puntaje",0]}},0]},
        }},
    ]

    if allowed_statuses:
        pipeline.append({"$match":{"_statusNorm":{"$in":allowed_statuses}}})

    pipeline += [
        {"$match": {
            "$and": [
                {"$or":[{"agenteNombre":{"$ne":None,"$ne":""}},{"agente":{"$ne":None,"$ne":""}}]},
                {"excluirDeReporte":{"$ne":True}},
            ]
        }},
        {"$addFields": {
            "_diaParsed": {"$cond":[
                {"$eq":[{"$type":"$dia_venta"},"date"]},"$dia_venta",
                {"$cond":[
                    {"$regexMatch":{"input":{"$toString":"$dia_venta"},"regex":r"^\d{4}-\d{2}-\d{2}$"}},
                    {"$dateFromString":{"dateString":{"$toString":"$dia_venta"},"format":"%Y-%m-%d","timezone":"-06:00"}},
                    {"$dateFromString":{"dateString":{"$toString":"$dia_venta"},"timezone":"-06:00"}},
                ]}
            ]},
        }},
        {"$match": {"$expr":{"$and":[
            {"$gte":[{"$dateToString":{"format":"%Y-%m-%d","date":{"$ifNull":["$_diaParsed","$createdAt"]},"timezone":"-06:00"}},start_date]},
            {"$lte":[{"$dateToString":{"format":"%Y-%m-%d","date":{"$ifNull":["$_diaParsed","$createdAt"]},"timezone":"-06:00"}},end_date]},
        ]}}},
        {"$group": {
            "_id": "$_agenteFuente",
            "ventas": {"$sum":{"$cond":["$isCancel",0,1]}},
            "sumPuntaje": {"$sum":"$puntajeEfectivo"},
        }},
        {"$project": {"_id":0,"agente":"$_id","ventas":1,"puntaje":"$sumPuntaje"}},
        {"$sort": {"puntaje":-1,"ventas":-1}},
    ]

    try:
        rows = await db["costumers_unified"].aggregate(pipeline, allowDiskUse=True).to_list(None)
    except Exception:
        rows = []

    return {"success": True, "data": rows, "dateRange": {"start": start_date, "end": end_date}}


# ── COMISIONES ─────────────────────────────────────────────────
@router.get("/api/comisiones/agents")
async def comisiones_agents(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    year:        Optional[str] = Query(None),
    debug:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()
    now = datetime.utcnow()

    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    elif month and year and re.match(r"^\d{4}$", year or ""):
        yr, mo = int(year), int(month)
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    import calendar
    end_of_month = f"{yr}-{mo:02d}-{calendar.monthrange(yr,mo)[1]:02d}"
    is_current = (now.year == yr and now.month == mo)
    end = fechaFin or (now.strftime("%Y-%m-%d") if is_current else end_of_month)

    pipeline = [
        {"$addFields": {
            "_statusLower": {"$toLower":{"$toString":{"$ifNull":["$status",""]}}},
            "_agentName": {"$ifNull":["$agenteNombre","$agente"]},
            "_date": {"$cond":[
                {"$eq":[{"$type":"$dia_venta"},"date"]},
                "$dia_venta",
                {"$cond":[
                    {"$eq":[{"$type":"$dia_venta"},"string"]},
                    {"$dateFromString":{"dateString":{"$toString":"$dia_venta"},"timezone":"-06:00","onError":None,"onNull":None}},
                    None
                ]}
            ]},
            "_points": {"$toDouble":{"$ifNull":["$puntaje",0]}},
        }},
        {"$match": {
            "_agentName": {"$ne": None, "$ne":""},
            "_date": {"$ne": None},
            "$expr": {
                "$and": [
                    {"$regexMatch":{"input":"$_statusLower","regex":r"completed|completado|complete|active|activo|activa"}},
                    {"$gte":[{"$dateToString":{"format":"%Y-%m-%d","date":"$_date"}},start]},
                    {"$lte":[{"$dateToString":{"format":"%Y-%m-%d","date":"$_date"}},end]},
                ]
            }
        }},
        {"$group": {
            "_id": {"$toString":"$_agentName"},
            "ventas": {"$sum":1},
            "puntos": {"$sum":"$_points"},
        }},
        {"$project":{"_id":0,"nombre":"$_id","ventas":1,"puntos":1}},
        {"$sort":{"puntos":-1,"ventas":-1,"nombre":1}},
        {"$limit":500},
    ]

    try:
        rows = await db["costumers_unified"].aggregate(pipeline, allowDiskUse=True).to_list(None)
    except Exception:
        rows = []

    return {"success": True, "data": rows, "meta": {"startDate": start, "endDate": end}}


@router.get("/api/comisiones/agentes-mes")
async def comisiones_agentes_mes(
    month: Optional[str] = Query(None),
    year:  Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    return await comisiones_agents(fechaInicio=None, fechaFin=None, month=month, year=year, debug=None, user=user)


@router.get("/api/comisiones/agentes-lineas")
async def comisiones_agentes_lineas(
    month: Optional[str] = Query(None),
    year:  Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    db = get_db()
    now = datetime.utcnow()

    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    elif month and year and re.match(r"^\d{4}$", year or ""):
        yr, mo = int(year), int(month)
    else:
        yr, mo = now.year, now.month

    import calendar
    start = f"{yr}-{mo:02d}-01"
    end   = f"{yr}-{mo:02d}-{calendar.monthrange(yr,mo)[1]:02d}"

    tl_db = get_team_lineas_db()
    if tl_db is None:
        return {"success": True, "data": []}

    cols = await tl_db.list_collection_names()
    agent_totals: dict = {}
    for col_name in cols:
        try:
            docs = await tl_db[col_name].find(
                {"dia_venta": {"$gte": start, "$lte": end}},
                {"agente":1,"agenteNombre":1,"puntaje":1,"status":1}
            ).to_list(None)
            for doc in docs:
                name = str(doc.get("agenteNombre") or doc.get("agente") or "").strip()
                if not name:
                    continue
                if name not in agent_totals:
                    agent_totals[name] = {"nombre": name, "ventas": 0, "puntos": 0.0}
                agent_totals[name]["ventas"] += 1
                agent_totals[name]["puntos"] += float(doc.get("puntaje") or 0)
        except Exception:
            pass

    rows = sorted(agent_totals.values(), key=lambda x: (-x["puntos"], -x["ventas"]))
    return {"success": True, "data": rows}


@router.get("/api/leads-lineas")
async def leads_lineas(
    month:   Optional[str] = Query(None),
    year:    Optional[str] = Query(None),
    allData: Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    tl_db = get_team_lineas_db()
    if tl_db is None:
        return {"success": True, "data": [], "meta": {"collections": 0, "total": 0}}

    role = str(user.get("role","")).lower()
    username = user.get("username","")
    is_privileged = any(r in role for r in ["admin","backoffice","supervisor"])
    full_export = allData in ("true", "1", "yes") and is_privileged

    filt: dict = {}
    if not is_privileged:
        display = username.replace(".", " ").replace("_", " ").upper()
        filt = {"$or": [{"agente": username}, {"agenteNombre": username}, {"agente": display}, {"agenteNombre": display}]}

    per_col_limit = 0 if full_export else 500

    cols = await tl_db.list_collection_names()
    leads = []
    for col_name in cols:
        try:
            cursor = tl_db[col_name].find(filt).sort("creadoEn", -1)
            if per_col_limit:
                cursor = cursor.limit(per_col_limit)
            docs = await cursor.to_list(None)
            for d in docs:
                d["_id"] = str(d["_id"])
                d["_collection"] = col_name
            leads.extend(docs)
        except Exception:
            pass

    leads.sort(key=lambda x: str(x.get("creadoEn", "") or ""), reverse=True)
    cap = len(leads) if full_export else 1000
    return {"success": True, "data": leads[:cap], "count": len(leads),
            "meta": {"collections": len(cols), "total": len(leads), "returned": min(len(leads), cap)}}


# ── SINGLE LEAD CRUD ───────────────────────────────────────────
@router.get("/api/leads/{lead_id}")
async def get_lead(lead_id: str, user: dict = Depends(current_user)):
    if not re.match(r"^[a-fA-F0-9]{24}$", lead_id):
        raise HTTPException(404, "Lead no encontrado")
    db = get_db()
    doc, col_name = await _find_lead_anywhere(db, lead_id)
    if not doc:
        raise HTTPException(404, "Lead no encontrado")
    return {"success": True, "data": _serialize_lead(doc), "lead": _serialize_lead(doc), "foundInCollection": col_name}


class UpdateStatusBody(BaseModel):
    status: str


@router.put("/api/leads/{lead_id}/status")
async def update_lead_status(
    lead_id: str,
    body: UpdateStatusBody,
    user: dict = Depends(require_roles("Administrador","Backoffice","admin","administrador","backoffice")),
):
    if not body.status:
        raise HTTPException(400, "status requerido")
    db = get_db()
    obj_id = _oid(lead_id)
    filters = []
    if obj_id:
        filters.append({"_id": obj_id})
    filters += [{"_id": lead_id}, {"id": lead_id}, {"leadId": lead_id}]

    # Try unified first
    for filt in filters:
        try:
            r = await db["costumers_unified"].update_one(filt, {"$set": {"status": body.status}})
            if r.matched_count > 0:
                return {"success": True, "message": "Status actualizado", "data": {"id": lead_id, "status": body.status, "collection": "costumers_unified"}}
        except Exception:
            pass

    # Try other collections
    cols = await _get_costumers_collections(db)
    for col_name in cols:
        if col_name == "costumers_unified":
            continue
        for filt in filters:
            try:
                r = await db[col_name].update_one(filt, {"$set": {"status": body.status}})
                if r.matched_count > 0:
                    return {"success": True, "message": "Status actualizado", "data": {"id": lead_id, "status": body.status, "collection": col_name}}
            except Exception:
                pass

    raise HTTPException(404, "Cliente no encontrado")


class UpdateLeadBody(BaseModel):
    model_config = {"extra": "allow"}

    nombre_cliente:     Optional[str] = None
    telefono_principal: Optional[str] = None
    telefono:           Optional[str] = None
    telefono_alterno:   Optional[str] = None
    telefono_alt:       Optional[str] = None
    numero_cuenta:      Optional[str] = None
    direccion:          Optional[str] = None
    zip_code:           Optional[str] = None
    zip:                Optional[str] = None
    autopago:           Optional[str] = None
    riesgo:             Optional[str] = None
    tipo_servicio:      Optional[str] = None
    sistema:            Optional[str] = None
    mercado:            Optional[str] = None
    servicios:          Optional[str] = None
    dia_venta:          Optional[str] = None
    dia_instalacion:    Optional[str] = None
    puntaje:            Optional[Any] = None
    status:             Optional[str] = None
    supervisor:         Optional[str] = None
    supervisorName:     Optional[str] = None
    agente:             Optional[str] = None
    agenteNombre:       Optional[str] = None
    createdBy:          Optional[str] = None
    motivo_llamada:     Optional[str] = None
    nota:               Optional[str] = None
    notas:              Optional[str] = None
    fecha_contratacion: Optional[str] = None
    was_reserva:        Optional[bool] = None


@router.put("/api/leads/{lead_id}")
async def update_lead(
    lead_id: str,
    body: UpdateLeadBody,
    user: dict = Depends(require_roles("Administrador","Backoffice","Supervisor","Supervisor Team Lineas","Agente","admin","administrador","backoffice","supervisor","agente")),
):
    db = get_db()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(400, "Sin campos para actualizar")
    update_data["updatedAt"] = datetime.utcnow()
    update_data["updatedBy"] = user.get("username","system")

    obj_id = _oid(lead_id)
    filters = []
    if obj_id:
        filters.append({"_id": obj_id})
    filters.append({"_id": lead_id})

    for filt in filters:
        try:
            r = await db["costumers_unified"].update_one(filt, {"$set": update_data})
            if r.matched_count > 0:
                return {"success": True, "message": "Lead actualizado"}
        except Exception:
            pass

    cols = await _get_costumers_collections(db)
    for col_name in cols:
        if col_name == "costumers_unified":
            continue
        for filt in filters:
            try:
                r = await db[col_name].update_one(filt, {"$set": update_data})
                if r.matched_count > 0:
                    return {"success": True, "message": "Lead actualizado"}
            except Exception:
                pass

    raise HTTPException(404, "Lead no encontrado")


@router.delete("/api/leads/{lead_id}")
async def delete_lead(lead_id: str, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    db = get_db()
    obj_id = _oid(lead_id)
    filters = []
    if obj_id:
        filters.append({"_id": obj_id})
    filters.append({"_id": lead_id})

    for filt in filters:
        try:
            r = await db["costumers_unified"].delete_one(filt)
            if r.deleted_count > 0:
                return {"success": True, "message": "Lead eliminado"}
        except Exception:
            pass

    cols = await _get_costumers_collections(db)
    for col_name in cols:
        if col_name == "costumers_unified":
            continue
        for filt in filters:
            try:
                r = await db[col_name].delete_one(filt)
                if r.deleted_count > 0:
                    return {"success": True, "message": "Lead eliminado"}
            except Exception:
                pass

    raise HTTPException(404, "Lead no encontrado")


# ── DEBUG ──────────────────────────────────────────────────────
@router.get("/api/debug/search-lead/{lead_id}")
async def debug_search_lead(lead_id: str, user: dict = Depends(current_user)):
    db = get_db()
    obj_id = _oid(lead_id)
    filters = []
    if obj_id:
        filters.append({"_id": obj_id})
    filters += [{"_id": lead_id}, {"id": lead_id}]
    alt_keys = ["leadId","lead_id","id_cliente","clienteId","cliente_id","clientId","client_id","numero_cuenta"]
    filters += [{k: lead_id} for k in alt_keys]

    cols = await db.list_collection_names()
    costumer_cols = [n for n in cols if re.match(r"^costumers(_|$)|^customers_unified", n, re.IGNORECASE)]
    other_cols = [n for n in cols if n not in costumer_cols and n != "users"]
    search_order = costumer_cols + other_cols

    results = {"id": lead_id, "found": False, "collection": None, "document": None, "searchedCollections": [], "details": []}
    for col_name in search_order:
        try:
            results["searchedCollections"].append(col_name)
            col = db[col_name]
            for filt in filters:
                try:
                    found = await col.find_one(filt)
                    if found:
                        results["found"] = True
                        results["collection"] = col_name
                        results["document"] = {
                            "_id": str(found["_id"]) if found.get("_id") else None,
                            "nombre_cliente": found.get("nombre_cliente"),
                            "status": found.get("status"),
                            "dia_venta": str(found.get("dia_venta","")) if found.get("dia_venta") else None,
                            "agente": found.get("agente") or found.get("agenteNombre"),
                        }
                        return {"success": True, **results}
                except Exception:
                    pass
        except Exception as e:
            results["details"].append(f"Error en {col_name}: {e}")

    return {"success": False, "message": "Lead no encontrado en ninguna colección", **results}


# ── LINEAS-TEAM (from api.js) ───────────────────────────────────
@router.get("/api/lineas-team")
async def get_lineas_team(
    month:       Optional[str] = Query(None),
    status:      Optional[str] = Query(None),
    supervisor:  Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    tl_db = get_team_lineas_db()
    if tl_db is None:
        return {"success": True, "data": []}

    role = str(user.get("role","")).lower()
    username = user.get("username","")
    is_admin_bo = any(r in role for r in ["admin","backoffice"])
    is_supervisor = "supervisor" in role

    filt: dict = {}
    if not is_admin_bo and not is_supervisor:
        display = username.replace(".",  " ").replace("_"," ").upper()
        filt = {"$or":[{"agente":username},{"agenteNombre":username},{"agente":display},{"agenteNombre":display}]}

    cols = await tl_db.list_collection_names()
    leads = []
    for col_name in cols:
        try:
            docs = await tl_db[col_name].find(filt).sort("creadoEn",-1).limit(500).to_list(None)
            for d in docs:
                d["_id"] = str(d["_id"])
                d["_collection"] = col_name
            leads.extend(docs)
        except Exception:
            pass

    if status:
        leads = [l for l in leads if str(l.get("status","")).lower() == status.lower()]

    leads.sort(key=lambda x: str(x.get("creadoEn","") or ""), reverse=True)
    return {"success": True, "data": leads[:2000], "count": len(leads)}


class LineasTeamStatusBody(BaseModel):
    id: str
    status: str
    collectionName: Optional[str] = None


@router.put("/api/lineas-team/status")
async def update_lineas_team_status(body: LineasTeamStatusBody, user: dict = Depends(current_user)):
    if not body.id or not body.status:
        raise HTTPException(400, "id y status requeridos")
    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")
    obj_id = _oid(body.id)
    filt = {"_id": obj_id} if obj_id else {"_id": body.id}
    cols = [body.collectionName] if body.collectionName else await tl_db.list_collection_names()
    for col_name in cols:
        try:
            r = await tl_db[col_name].update_one(filt, {"$set": {"status": body.status, "actualizadoEn": datetime.utcnow()}})
            if r.matched_count > 0:
                return {"success": True, "message": "Status actualizado"}
        except Exception:
            pass
    raise HTTPException(404, "Registro no encontrado")


class LineasLineStatusBody(BaseModel):
    id: str
    lineIndex: int
    lineStatus: str
    collectionName: Optional[str] = None


@router.put("/api/lineas-team/line-status")
async def update_lineas_team_line_status(body: LineasLineStatusBody, user: dict = Depends(current_user)):
    if not body.id:
        raise HTTPException(400, "id requerido")
    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")
    obj_id = _oid(body.id)
    filt = {"_id": obj_id} if obj_id else {"_id": body.id}
    update = {"$set": {
        f"lineas_status.{body.lineIndex}": body.lineStatus,
        f"lines.{body.lineIndex}.estado": body.lineStatus,
        "actualizadoEn": datetime.utcnow()
    }}
    cols = [body.collectionName] if body.collectionName else await tl_db.list_collection_names()
    for col_name in cols:
        try:
            r = await tl_db[col_name].update_one(filt, update)
            if r.matched_count > 0:
                return {"success": True, "message": "Estado de línea actualizado"}
        except Exception:
            pass
    raise HTTPException(404, "Registro no encontrado")


@router.get("/api/lineas-team/collections")
async def get_lineas_team_collections(user: dict = Depends(current_user)):
    tl_db = get_team_lineas_db()
    if tl_db is None:
        return {"success": True, "collections": []}
    cols = await tl_db.list_collection_names()
    return {"success": True, "collections": cols}


# ── POST /api/crm_agente ────────────────────────────────────────
@router.post("/api/crm_agente")
async def crm_agente(raw_request: Request, user: dict = Depends(current_user)):
    try:
        request_data = await raw_request.json()
    except Exception:
        request_data = {}

    db = get_db()
    target_agent = str(request_data.get("agenteAsignado") or request_data.get("agente") or "").replace("_"," ").strip()
    if not target_agent:
        raise HTTPException(400, "Se requiere agente o agenteAsignado")

    agent_user = await db["users"].find_one({"$or": [
        {"username": {"$regex": f"^{re.escape(target_agent)}$", "$options":"i"}},
        {"name":     {"$regex": f"^{re.escape(target_agent)}$", "$options":"i"}},
        {"username": {"$regex": re.escape(target_agent), "$options":"i"}},
        {"name":     {"$regex": re.escape(target_agent), "$options":"i"}},
    ]})

    if not agent_user:
        raise HTTPException(404, "Agente no encontrado en el sistema")

    agent_username = agent_user.get("username","unknown")
    col_name = f"costumers_{agent_username.replace('.','_').replace(' ','_')}"
    now = datetime.utcnow()
    lead_data = {**request_data, "createdAt": now, "updatedAt": now, "createdBy": user.get("username")}
    lead_data.pop("_id", None)

    result = await db[col_name].insert_one(lead_data)
    return {"success": True, "message": f"Lead guardado en {col_name}", "id": str(result.inserted_id), "collection": col_name}
