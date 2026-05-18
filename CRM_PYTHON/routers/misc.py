from fastapi import APIRouter, Depends, Query, HTTPException
from database import get_db, get_team_lineas_db
from deps import current_user
from typing import Optional
import datetime as _dt
import re

router = APIRouter(tags=["Misc"])

_ADMIN_ROLES = {"admin", "administrador", "administrator", "administrativo"}
_BO_ROLES    = {"backoffice", "bo"}
_SUP_ROLES   = {"supervisor"}


def _role_lower(user: dict) -> str:
    return (user.get("role") or "").strip().lower()


def _is_admin(role: str) -> bool:
    return any(a in role for a in _ADMIN_ROLES)


def _is_adm_or_bo(role: str) -> bool:
    return any(a in role for a in (_ADMIN_ROLES | _BO_ROLES))


def _is_supervisor(role: str) -> bool:
    return "supervisor" in role


def _normalize_status(raw: str) -> str:
    s = str(raw or "").strip().lower()
    if not s:                          return "pending"
    if s in {"completed", "active", "completado", "activo", "activa", "vendido", "cerrado", "cerrada"}: return "completed"
    if s in {"pending", "pendiente"}:  return "pending"
    if s in {"cancelled", "cancelado", "cancelada"}: return "cancelled"
    if "cancel" in s:                  return "cancelled"
    if "pend"   in s:                  return "pending"
    if any(x in s for x in ("complet", "activ", "cerr", "vend")): return "completed"
    return "pending"


def _is_colchon(lead: dict, ref_date: _dt.datetime = None) -> bool:
    now = ref_date or _dt.datetime.utcnow()
    ref_ym = f"{now.year}-{str(now.month).zfill(2)}"
    dv = str(lead.get("dia_venta") or "")[:7]
    di = str(lead.get("dia_instalacion") or "")[:7]
    return bool(di and di == ref_ym and dv and dv != ref_ym)


# ── GET /api/protected ───────────────────────────────────────────
@router.get("/api/protected")
async def protected(user: dict = Depends(current_user)):
    return {
        "ok": True,
        "user": {
            "id":       str(user.get("_id") or user.get("id") or ""),
            "username": user.get("username", ""),
            "name":     user.get("name") or user.get("nombre") or user.get("username", ""),
            "role":     user.get("role", ""),
            "team":     user.get("team", ""),
        },
    }


# ── GET /api/phones-unified ───────────────────────────────────────
@router.get("/api/phones-unified")
async def phones_unified(
    month:  Optional[int] = Query(None),
    year:   Optional[int] = Query(None),
    source: Optional[str] = Query(None),
    user:   dict = Depends(current_user),
):
    use_residencial = not source or source == "residencial"
    use_lineas      = not source or source == "lineas"

    query: dict = {}
    if month and year:
        start_date = _dt.datetime(year, month, 1)
        end_year   = year + (month // 12)
        end_month  = (month % 12) + 1
        end_date   = _dt.datetime(end_year, end_month, 1)
        query      = {"dia_venta": {"$gte": start_date, "$lt": end_date}}

    phone_filter = {**query, "telefono_principal": {"$exists": True, "$ne": None, "$ne": ""}}

    unified_phones = []
    if use_residencial:
        db = get_db()
        docs = await db["costumers_unified"].find(
            phone_filter,
            {"telefono_principal": 1, "nombre_cliente": 1, "dia_venta": 1, "status": 1},
        ).to_list(None)
        for d in docs:
            d["_id"] = str(d["_id"])
        unified_phones = docs

    lineas_phones = []
    if use_lineas:
        tl_db = get_team_lineas_db()
        coll_names = [c["name"] async for c in tl_db.list_collections()]
        for name in coll_names:
            docs = await tl_db[name].find(
                phone_filter,
                {"telefono_principal": 1, "nombre_cliente": 1, "dia_venta": 1, "status": 1},
            ).to_list(None)
            for d in docs:
                d["_id"] = str(d["_id"])
            lineas_phones.extend(docs)

    return {
        "success": True,
        "source":  source or "both",
        "phones":  unified_phones + lineas_phones,
    }


# ── GET /api/rankings-leads ───────────────────────────────────────
_TARGET_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_SAFE_STATUS     = re.compile(r"^(cancelled|hold|rescheduled|reserva|oficina|cancelado|cancelada)$", re.I)
_VALID_STATUS    = re.compile(r"^(completed|active|pending|completado|activo|activa|vendido)$", re.I)


@router.get("/api/rankings-leads")
async def rankings_leads(
    targetMonth: Optional[str] = Query(None),
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    limit:       int           = Query(5000),
    user:        dict          = Depends(current_user),
):
    db = get_db()
    limit = min(limit, 10_000)
    date_filter: dict = {}

    if targetMonth and _TARGET_MONTH_RE.match(targetMonth):
        ty, tm = (int(x) for x in targetMonth.split("-"))
        start_date = _dt.datetime(ty, tm, 1)
        end_month  = tm % 12 + 1
        end_year   = ty + (tm // 12)
        end_date   = _dt.datetime(end_year, end_month, 1)
        start_str  = f"{targetMonth}-01"
        end_str    = f"{targetMonth}-31"

        ventas_filter = {"$or": [
            {"dia_venta": {"$gte": start_str, "$lte": end_str}},
            {"dia_venta": {"$gte": start_date, "$lt": end_date}},
            {"$and": [
                {"$or": [{"dia_venta": {"$exists": False}}, {"dia_venta": ""}, {"dia_venta": None}]},
                {"createdAt": {"$gte": start_date, "$lt": end_date}},
            ]},
        ]}

        colchon_filter = {"$and": [
            {"$or": [
                {"dia_instalacion": {"$gte": start_str, "$lte": end_str}},
                {"dia_instalacion": {"$gte": start_date, "$lt": end_date}},
            ]},
            {"status": {"$regex": r"^(completed|active|pending|completado|activo|activa|vendido)$", "$options": "i"}},
            {"dia_venta": {"$not": {"$regex": f"^{re.escape(targetMonth)}"}}},
        ]}

        status_exclude = {"status": {"$not": {"$regex": r"^(cancelled|hold|rescheduled|reserva|oficina|cancelado|cancelada)$", "$options": "i"}}}
        date_filter = {"$and": [status_exclude, {"$or": [ventas_filter, colchon_filter]}]}

        ref_date = _dt.datetime(ty, end_month, 1) - _dt.timedelta(days=1)

    elif fechaInicio and fechaFin:
        fi = _dt.datetime.fromisoformat(fechaInicio)
        ft = _dt.datetime.fromisoformat(fechaFin + "T23:59:59")
        fi_year, fi_month = fi.year, fi.month
        colchon_month_start = f"{fi_year}-{str(fi_month).zfill(2)}-01"

        normal_filter = {"$or": [
            {"dia_venta":          {"$gte": fi, "$lte": ft}},
            {"fecha_contratacion": {"$gte": fi, "$lte": ft}},
            {"createdAt":          {"$gte": fi, "$lte": ft}},
            {"creadoEn":           {"$gte": fi, "$lte": ft}},
            {"fecha":              {"$gte": fi, "$lte": ft}},
        ]}
        colchon_filter = {"$and": [
            {"dia_instalacion": {"$gte": fechaInicio, "$lte": fechaFin}},
            {"dia_venta":       {"$lt": colchon_month_start}},
            {"status":          {"$regex": r"^(completed|active|pending|completado|activo|activa|vendido)$", "$options": "i"}},
        ]}
        date_filter = {"$or": [normal_filter, colchon_filter]}
        ref_date = ft
    else:
        ref_date = None

    leads = await db["costumers_unified"].find(
        date_filter,
        {
            "_id": 1, "agenteNombre": 1, "agente": 1, "createdBy": 1, "usuario": 1,
            "status": 1, "dia_venta": 1, "dia_instalacion": 1,
            "puntaje": 1, "supervisor": 1, "equipo": 1, "team": 1,
            "servicios": 1, "tipo_servicio": 1, "servicios_texto": 1,
            "producto": 1, "producto_contratado": 1,
        },
    ).sort([("dia_venta", -1), ("createdAt", -1)]).limit(limit).to_list(None)

    result = []
    for lead in leads:
        lead["_id"] = str(lead["_id"])
        if _is_colchon(lead, ref_date):
            lead["_es_colchon"] = True
        result.append(lead)

    return result


# ── GET /api/customers ────────────────────────────────────────────
@router.get("/api/customers")
async def get_customers(
    page:        int            = Query(1),
    limit:       int            = Query(200),
    sortBy:      str            = Query("creadoEn"),
    sortOrder:   str            = Query("desc"),
    fechaInicio: Optional[str]  = Query(None),
    fechaFin:    Optional[str]  = Query(None),
    status:      Optional[str]  = Query(None),
    user:        dict           = Depends(current_user),
):
    db       = get_db()
    role     = _role_lower(user)
    is_adm   = _is_adm_or_bo(role)
    is_sup   = _is_supervisor(role)
    max_lim  = 10_000 if is_adm else 500
    limit    = min(limit, max_lim)
    skip     = (page - 1) * limit

    base_query: dict = {}
    if fechaInicio and fechaFin:
        base_query["creadoEn"] = {"$gte": _dt.datetime.fromisoformat(fechaInicio), "$lte": _dt.datetime.fromisoformat(fechaFin)}
    elif fechaInicio:
        base_query["creadoEn"] = {"$gte": _dt.datetime.fromisoformat(fechaInicio)}
    elif fechaFin:
        base_query["creadoEn"] = {"$lte": _dt.datetime.fromisoformat(fechaFin)}

    if status:
        base_query["status"] = _normalize_status(status)

    if not is_adm:
        cur = (user.get("username") or "").strip()
        if is_sup:
            agents = await db["users"].find(
                {"supervisor": {"$regex": cur, "$options": "i"}, "role": {"$not": {"$regex": "admin", "$options": "i"}}},
                {"username": 1, "name": 1},
            ).to_list(None)
            names = [str(a.get("username") or a.get("name") or "").strip() for a in agents if a.get("username") or a.get("name")]
            names = [n for n in names if n]
            if names:
                base_query["$or"] = [{"agenteNombre": {"$in": names}}, {"agente": {"$in": names}}, {"usuario": {"$in": names}}]
        else:
            base_query["$or"] = [{"agenteNombre": cur}, {"agente": cur}, {"usuario": cur}]

    sort_dir = 1 if sortOrder == "asc" else -1
    total     = await db["costumers_unified"].count_documents(base_query)
    customers = await db["costumers_unified"].find(base_query).sort(sortBy, sort_dir).skip(skip).limit(limit).to_list(None)
    for c in customers:
        c["_id"] = str(c["_id"])

    return {"success": True, "data": customers, "total": total, "page": page, "limit": limit, "source": "costumers_unified"}


# ── GET /api/customers/agents-summary ────────────────────────────
@router.get("/api/customers/agents-summary")
async def customers_agents_summary(user: dict = Depends(current_user)):
    db   = get_db()
    coll = db["costumers_unified"]

    rows = await coll.aggregate([
        {"$group": {"_id": {"id": "$agenteId", "nombre": "$agenteNombre"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(None)

    distincts = {
        "agente":       await coll.distinct("agente"),
        "agenteNombre": await coll.distinct("agenteNombre"),
    }

    return {
        "success": True,
        "summary":   [{"agenteId": r["_id"].get("id"), "agenteNombre": r["_id"].get("nombre"), "count": r["count"]} for r in rows],
        "distincts": distincts,
    }


# ── GET /api/supervisors-list ─────────────────────────────────────
@router.get("/api/supervisors-list")
async def supervisors_list(user: dict = Depends(current_user)):
    if not _is_admin(_role_lower(user)):
        raise HTTPException(403, "No autorizado")
    db   = get_db()
    sups = await db["users"].distinct("username", {"role": {"$regex": "supervisor", "$options": "i"}})
    return {"success": True, "supervisors": sorted(sups)}


# ── GET /api/supervisors/:team ────────────────────────────────────
@router.get("/api/supervisors/{team}")
async def supervisors_by_team(team: str, user: dict = Depends(current_user)):
    if not _is_admin(_role_lower(user)):
        raise HTTPException(403, "No autorizado")
    return {"success": True, "supervisors": []}


# ── POST /api/admin/force-logout-all ─────────────────────────────
@router.post("/api/admin/force-logout-all")
async def force_logout_all(user: dict = Depends(current_user)):
    if not _is_admin(_role_lower(user)):
        raise HTTPException(403, "No autorizado")
    db = get_db()
    ts = int(_dt.datetime.utcnow().timestamp() * 1000)
    await db["system_settings"].update_one(
        {"key": "forceLogoutBefore"},
        {"$set": {"key": "forceLogoutBefore", "value": ts, "updatedAt": _dt.datetime.utcnow(), "updatedBy": user.get("username")}},
        upsert=True,
    )
    return {"success": True, "message": "Todas las sesiones han sido cerradas", "ts": ts}


# ── POST /api/admin/rename-att-air ────────────────────────────────
@router.post("/api/admin/rename-att-air")
async def rename_att_air(user: dict = Depends(current_user)):
    if not _is_admin(_role_lower(user)):
        raise HTTPException(403, "No autorizado")
    db      = get_db()
    results = {}
    for col in ("costumers_unified", "leads"):
        r = await db[col].update_many({"servicios": "ATT AIR"}, {"$set": {"servicios": "AIR"}})
        results[col] = {"matched": r.matched_count, "modified": r.modified_count}
    return {"success": True, "results": results}
