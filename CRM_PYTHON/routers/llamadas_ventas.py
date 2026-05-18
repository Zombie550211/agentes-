from fastapi import APIRouter, Depends, Query, Request, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
from database import get_db
from deps import current_user
from bson import ObjectId
import datetime as _dt, re

router = APIRouter(tags=["Llamadas Ventas"])

_ADMIN_ROLES = {"admin", "administrador", "administrator", "backoffice", "bo"}


def _is_admin(role: str) -> bool:
    r = role.strip().lower()
    return any(a in r for a in _ADMIN_ROLES)


# ── LLAMADAS-VENTAS ──────────────────────────────────────────────

@router.get("/api/llamadas-ventas")
async def get_llamadas_ventas(
    month: Optional[int] = Query(None),
    year:  Optional[int] = Query(None),
    user:  dict = Depends(current_user),
):
    if not _is_admin(user.get("role", "")):
        raise HTTPException(403, "No autorizado")

    db  = get_db()
    now = _dt.datetime.utcnow()
    target_month = month if month else now.month
    target_year  = year  if year  else now.year

    import calendar
    _, last_day = calendar.monthrange(target_year, target_month)
    start_date = _dt.datetime(target_year, target_month, 1)
    end_date   = _dt.datetime(target_year, target_month, last_day, 23, 59, 59)

    pipeline = [
        {"$match": {"fecha": {"$gte": start_date, "$lte": end_date}}},
        {"$addFields": {"__fechaKey": {"$dateToString": {"format": "%Y-%m-%d", "date": "$fecha"}}}},
        {"$sort": {"actualizadoEn": -1, "creadoEn": -1, "_id": -1}},
        {"$group": {
            "_id": {"fechaKey": "$__fechaKey", "team": "$team", "tipo": "$tipo"},
            "doc": {"$first": "$$ROOT"}
        }},
        {"$replaceRoot": {"newRoot": "$doc"}},
        {"$project": {"__fechaKey": 0}},
        {"$sort": {"fecha": 1, "team": 1, "tipo": 1}},
    ]

    registros = await db["llamadas_ventas"].aggregate(pipeline).to_list(None)
    for r in registros:
        r["_id"] = str(r["_id"])
    return {"success": True, "data": registros, "count": len(registros), "month": target_month, "year": target_year}


class LlamadasVentasBody(BaseModel):
    day:   Any
    team:  str
    type:  str
    value: Any = None


@router.post("/api/llamadas-ventas")
async def post_llamadas_ventas(body: LlamadasVentasBody, user: dict = Depends(current_user)):
    if not _is_admin(user.get("role", "")):
        raise HTTPException(403, "No autorizado")

    db = get_db()

    if body.type in ("LLAMADAS", "VENTAS"):
        raw = str(body.value or "").strip()
        if not raw or raw == "-":
            raise HTTPException(400, "Valor inválido para LLAMADAS/VENTAS")
        try:
            float(raw)
        except ValueError:
            raise HTTPException(400, "Valor no numérico para LLAMADAS/VENTAS")

    now  = _dt.datetime.utcnow()
    day  = int(body.day)
    fecha_start = _dt.datetime(now.year, now.month, day)
    fecha_end   = _dt.datetime(now.year, now.month, day) + _dt.timedelta(days=1)
    valor_final = body.value if body.type == "TOTALES" else (float(body.value) if body.value is not None else 0)

    result = await db["llamadas_ventas"].update_many(
        {"fecha": {"$gte": fecha_start, "$lt": fecha_end}, "team": body.team, "tipo": body.type},
        {
            "$set": {"valor": valor_final, "actualizadoEn": now, "actualizadoPor": user.get("username", "unknown")},
            "$setOnInsert": {"fecha": fecha_start, "creadoEn": now, "creadoPor": user.get("username", "unknown")},
        },
        upsert=True,
    )
    return {
        "success": True, "message": "Datos guardados",
        "data": {
            "day": day, "team": body.team, "type": body.type, "value": valor_final,
            "modifiedCount": result.modified_count, "upsertedCount": 1 if result.upserted_id else 0,
        }
    }


# ── LLAMADAS-VENTAS-EXCEL ────────────────────────────────────────
_SHEETS_COL = "llamadas_ventas_excel_sheets"
_DATA_COL   = "llamadas_ventas_excel_data"
_USERS_COL  = "llamadas_ventas_excel_users"
_DATE_RE    = re.compile(r"^(0[1-9]|1[0-2])/(0[1-9]|[12]\d|3[01])/\d{4}$")


def _check_excel_access(user: dict):
    if not _is_admin(user.get("role", "")):
        raise HTTPException(403, "No autorizado")


def _sid_to_oid(sid: str) -> ObjectId:
    try:
        return ObjectId(sid)
    except Exception:
        raise HTTPException(400, "sheetId inválido")


@router.get("/api/llamadas-ventas-excel/sheets")
async def excel_get_sheets(user: dict = Depends(current_user)):
    _check_excel_access(user)
    db = get_db()
    sheets = await db[_SHEETS_COL].find(
        {}, {"_id": 1, "name": 1, "createdAt": 1, "createdBy": 1, "updatedAt": 1, "updatedBy": 1}
    ).sort([("createdAt", 1), ("_id", 1)]).to_list(None)
    return {"success": True, "data": [
        {"_id": str(s["_id"]), "name": s.get("name"), "createdAt": s.get("createdAt"),
         "createdBy": s.get("createdBy"), "updatedAt": s.get("updatedAt"), "updatedBy": s.get("updatedBy")}
        for s in sheets
    ]}


class CreateSheetBody(BaseModel):
    name: Optional[str] = None


@router.post("/api/llamadas-ventas-excel/sheets")
async def excel_create_sheet(body: CreateSheetBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    db  = get_db()
    now = _dt.datetime.utcnow()
    base_name = (body.name or "").strip() or now.strftime("%Y-%m-%d")
    name = base_name
    if await db[_SHEETS_COL].find_one({"name": name}):
        name = f"{base_name} ({now.strftime('%H:%M:%S')})"
    doc = {"name": name, "createdAt": now, "createdBy": user.get("username", "unknown"),
           "updatedAt": now, "updatedBy": user.get("username", "unknown")}
    result = await db[_SHEETS_COL].insert_one(doc)
    return {"success": True, "data": {"_id": str(result.inserted_id), **{k: v for k, v in doc.items()}}}


@router.get("/api/llamadas-ventas-excel/sheets/{sheet_id}")
async def excel_get_sheet(sheet_id: str, user: dict = Depends(current_user)):
    _check_excel_access(user)
    db  = get_db()
    oid = _sid_to_oid(sheet_id)
    sheet = await db[_SHEETS_COL].find_one({"_id": oid}, {"name": 1})
    if not sheet:
        raise HTTPException(404, "Sheet no encontrado")
    data  = await db[_DATA_COL].find({"sheetId": sheet_id}, {"_id": 0, "kind": 1, "team": 1, "person": 1, "col": 1, "metric": 1, "value": 1}).to_list(None)
    users = await db[_USERS_COL].find({"sheetId": sheet_id}, {"_id": 0, "name": 1, "role": 1, "team": 1}).to_list(None)
    return {"success": True, "sheet": {"_id": str(sheet["_id"]), "name": sheet.get("name")}, "data": data, "users": users}


class ExcelCellBody(BaseModel):
    sheetId: str
    team:    Optional[str] = None
    person:  Optional[str] = None
    col:     Optional[str] = None
    metric:  Optional[str] = None
    value:   Any = None


@router.post("/api/llamadas-ventas-excel/cell")
async def excel_save_cell(body: ExcelCellBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    db  = get_db()
    sid = body.sheetId.strip()
    if not sid:
        raise HTTPException(400, "Falta sheetId")

    now = _dt.datetime.utcnow()
    v   = str(body.value or "").strip()

    if body.metric:
        kind   = "summary"
        filt   = {"sheetId": sid, "kind": kind, "metric": str(body.metric).strip().upper()}
    else:
        if not body.team or not body.person or not body.col:
            raise HTTPException(400, "Faltan campos: team, person, col")
        kind = "cell"
        filt = {"sheetId": sid, "kind": kind, "team": str(body.team).strip(),
                "person": str(body.person).strip(), "col": str(body.col).strip().upper()}

    if v == "":
        await db[_DATA_COL].delete_one(filt)
    else:
        await db[_DATA_COL].update_one(
            filt,
            {"$set": {"value": v, "updatedAt": now, "updatedBy": user.get("username", "unknown")},
             "$setOnInsert": {"sheetId": sid, "kind": kind, "createdAt": now, "createdBy": user.get("username", "unknown")}},
            upsert=True,
        )
    try:
        await db[_SHEETS_COL].update_one(
            {"_id": ObjectId(sid)},
            {"$set": {"updatedAt": now, "updatedBy": user.get("username", "unknown")}}
        )
    except Exception:
        pass
    return {"success": True}


class ExcelUserBody(BaseModel):
    sheetId: str
    name:    str
    team:    str
    role:    Optional[str] = ""


@router.post("/api/llamadas-ventas-excel/user")
async def excel_save_user(body: ExcelUserBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    db  = get_db()
    sid = body.sheetId.strip()
    if not sid or not body.name or not body.team:
        raise HTTPException(400, "Faltan campos: sheetId, name, team")
    now  = _dt.datetime.utcnow()
    name = body.name.strip().upper()
    team = body.team.strip()
    doc  = {"sheetId": sid, "name": name, "role": (body.role or "").strip(), "team": team,
            "updatedAt": now, "updatedBy": user.get("username", "unknown")}
    await db[_USERS_COL].update_one(
        {"sheetId": sid, "name": name, "team": team},
        {"$set": doc, "$setOnInsert": {"createdAt": now, "createdBy": user.get("username", "unknown")}},
        upsert=True,
    )
    return {"success": True, "data": {"name": name, "role": doc["role"], "team": team}}


class ExcelUserDeleteBody(BaseModel):
    sheetId: str
    name:    str
    team:    str


@router.post("/api/llamadas-ventas-excel/user-delete")
async def excel_delete_user(body: ExcelUserDeleteBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    db   = get_db()
    sid  = body.sheetId.strip()
    name = body.name.strip().upper()
    team = body.team.strip()
    if not sid or not name or not team:
        raise HTTPException(400, "Faltan campos: sheetId, name, team")
    await db[_USERS_COL].delete_one({"sheetId": sid, "name": name, "team": team})
    await db[_DATA_COL].delete_many({"sheetId": sid, "kind": "cell", "team": team, "person": name})
    return {"success": True}


@router.delete("/api/llamadas-ventas-excel/sheets/{sheet_id}")
async def excel_delete_sheet(sheet_id: str, user: dict = Depends(current_user)):
    _check_excel_access(user)
    db  = get_db()
    oid = _sid_to_oid(sheet_id)
    r   = await db[_SHEETS_COL].delete_one({"_id": oid})
    if not r.deleted_count:
        raise HTTPException(404, "Sheet no encontrado")
    await db[_USERS_COL].delete_many({"sheetId": sheet_id})
    await db[_DATA_COL].delete_many({"sheetId": sheet_id})
    return {"success": True, "message": "Sheet eliminado"}


class PatchSheetBody(BaseModel):
    name: str


@router.patch("/api/llamadas-ventas-excel/sheets/{sheet_id}")
async def excel_rename_sheet(sheet_id: str, body: PatchSheetBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    db       = get_db()
    oid      = _sid_to_oid(sheet_id)
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(400, "sheetId y nombre requeridos")
    if not _DATE_RE.match(new_name):
        raise HTTPException(400, "Formato de fecha inválido. Use MM/DD/YYYY")
    now    = _dt.datetime.utcnow()
    result = await db[_SHEETS_COL].update_one(
        {"_id": oid},
        {"$set": {"name": new_name, "updatedAt": now, "updatedBy": user.get("username", "unknown")}}
    )
    if not result.matched_count:
        raise HTTPException(404, "Sheet no encontrado")
    return {"success": True, "message": "Nombre actualizado", "data": {"name": new_name}}
