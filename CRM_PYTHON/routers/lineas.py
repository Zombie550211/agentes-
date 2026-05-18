from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from bson import ObjectId
from database import get_db, get_team_lineas_db
from deps import current_user
from datetime import datetime, timezone
from typing import Optional, List, Any
import re, random, unicodedata, time

# ── Caché en memoria para /api/lineas-team (TTL 45s por clave usuario) ──
_LINEAS_CACHE: dict = {}   # key → {"ts": float, "data": list}
_LINEAS_TTL = 45           # segundos

def _cache_get(key: str):
    entry = _LINEAS_CACHE.get(key)
    if entry and (time.monotonic() - entry["ts"]) < _LINEAS_TTL:
        return entry["data"]
    return None

def _cache_set(key: str, data: list):
    _LINEAS_CACHE[key] = {"ts": time.monotonic(), "data": data}

def _cache_invalidate():
    _LINEAS_CACHE.clear()

router = APIRouter(tags=["Lineas"])

# ── TEAMS data ─────────────────────────────────────────────────
TEAMS = {
    "TEAM LINEAS":   {"supervisor":"jonathan.figueroa","supervisorKey":"JONATHAN F","agents":["VICTOR HURTADO","EDWARD RAMIREZ","CRISTIAN RIVERA","ANDREA ARDON","OSCAR RIVERA","MELANIE HURTADO","DENNIS VASQUEZ"]},
    "TEAM LUIS G":   {"supervisor":"luis.g","supervisorKey":"LUIS G","agents":["DANIEL DEL CID","FERNANDO BELTRAN","KARLA RODRIGUEZ","JOCELYN REYES","JONATHAN GARCIA","NANCY LOPEZ","TATIANA GIRON","CESAR CLAROS","KARLA PONCE","MANUEL FLORES"]},
    "TEAM IRANIA S": {"supervisor":"irania.serrano","supervisorKey":"IRANIA S","agents":["JOSUE RENDEROS","TATIANA AYALA","GISELLE DIAZ","MIGUEL NUNEZ","ROXANA MARTINEZ"]},
    "TEAM BRYAN P":  {"supervisor":"bryan.pleitez","supervisorKey":"BRYAN P","agents":["ABIGAIL GALDAMEZ","ALEXANDER RIVERA","DIEGO MEJIA","EVELIN GARCIA","FABRICIO PANAMENO","LUIS CHAVARRIA","STEVEN VARELA"]},
    "TEAM ROBERTO V":{"supervisor":"roberto.velasquez","supervisorKey":"ROBERTO V","agents":["CINDY FLORES","DANIELA BONILLA","FRANCISCO AGUILAR","LEVY CEREN","LISBETH CORTEZ","LUCIA FERMAN","NELSON CEREN"]},
    "TEAM JOHANA":   {"supervisor":"johana","supervisorKey":"JOHANA","agents":["ANDERSON GUZMAN","CARLOS GRANDE","GUADALUPE SANTANA","JULIO CHAVEZ","PRISCILA HERNANDEZ","RIQUELMI TORRES"]},
}

SUPERVISOR_KEYS = ["JONATHAN F","LUIS G"]

WEBHOOK_ALLOWED_ORIGINS = {
    "https://www.lineas-moviles.com","https://lineas-moviles.com",
    "http://www.lineas-moviles.com","http://lineas-moviles.com",
}

import os
WEBHOOK_KEY = os.getenv("WEBHOOK_LINEAS_KEY","")


def _normalize_col_name(s: str) -> str:
    try:
        n = unicodedata.normalize("NFD", str(s or "")).encode("ascii","ignore").decode()
        n = re.sub(r"[^A-Za-z0-9_\s-]"," ",n)
        n = re.sub(r"[\s-]+"," ",n).strip().replace(" ","_")
        return (n or "UNKNOWN").upper()
    except Exception:
        return re.sub(r"[\s-]+","_",str(s or "").strip()).upper() or "UNKNOWN"


def _normalize_agent_display(s: str) -> str:
    return re.sub(r"\s+"," ",str(s or "").strip().replace("_"," ")).upper()


def _normalize_status(s: str) -> str:
    v = str(s or "").strip().lower()
    if v in ("repro","rescheduled","reagendado"):
        return "rescheduled"
    if v in ("pending","pendiente"):
        return "pending"
    return v


def _normalize_date(s) -> Optional[str]:
    if not s:
        return None
    v = str(s).strip()
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", v)
    if m:
        return f"{int(m.group(1))}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", v)
    if m:
        return f"{int(m.group(3))}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return v


def _oid(s):
    try:
        return ObjectId(str(s))
    except Exception:
        return None


async def _pick_supervisor_key() -> str:
    db = get_db()
    try:
        doc = await db["_rr_config"].find_one_and_update(
            {"_id": "rr_supervisor"},
            {"$inc": {"idx": 1}},
            upsert=True, return_document=True,
        )
        idx = ((doc.get("idx") or 1) - 1) % len(SUPERVISOR_KEYS)
        return SUPERVISOR_KEYS[idx]
    except Exception:
        return random.choice(SUPERVISOR_KEYS)


async def _pick_agent(supervisor_key: str) -> Optional[str]:
    team = next((t for t in TEAMS.values() if t.get("supervisorKey","").upper() == supervisor_key.upper()), None)
    if not team or not team.get("agents"):
        return None
    agents = team["agents"]
    key = supervisor_key.upper()
    db = get_db()
    try:
        doc = await db["_rr_config"].find_one_and_update(
            {"_id": f"rr_agent_{key}"},
            {"$inc": {"idx": 1}},
            upsert=True, return_document=True,
        )
        idx = ((doc.get("idx") or 1) - 1) % len(agents)
        return agents[idx]
    except Exception:
        return random.choice(agents)


def _is_privileged(role: str) -> bool:
    r = str(role or "").lower()
    return any(v in r for v in ["admin","administrador","backoffice","back office","back_office","bo","b.o","supervisor"])


# ── WEBHOOK ────────────────────────────────────────────────────
@router.options("/api/webhook/lineas")
async def webhook_options(request: Request):
    origin = request.headers.get("origin","")
    headers = {}
    if origin in WEBHOOK_ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        headers["Access-Control-Allow-Headers"] = "Content-Type, x-api-key"
    return JSONResponse(content=None, status_code=204, headers=headers)


@router.post("/api/webhook/lineas")
async def webhook_post(request: Request, x_api_key: str = Header(default="")):
    origin = request.headers.get("origin","")
    cors_headers = {}
    if origin in WEBHOOK_ALLOWED_ORIGINS:
        cors_headers["Access-Control-Allow-Origin"] = origin

    api_key = x_api_key or ""
    if not WEBHOOK_KEY or api_key != WEBHOOK_KEY:
        return JSONResponse({"success": False, "message": "API key inválida"}, 401, headers=cors_headers)

    body = await request.json()
    clean = lambda s: str(s or "").strip()
    digits_only = lambda s: re.sub(r"\D+","",str(s or ""))

    nombre = clean(body.get("nombre") or body.get("nombre_cliente",""))
    telefono = digits_only(body.get("telefono") or body.get("telefono_principal",""))
    if not nombre:
        return JSONResponse({"success": False, "message": "Campo requerido: nombre"}, 400, headers=cors_headers)
    if not telefono:
        return JSONResponse({"success": False, "message": "Campo requerido: telefono"}, 400, headers=cors_headers)

    tl_db = get_team_lineas_db()
    if tl_db is None:
        return JSONResponse({"success": False, "message": "BD de Team Líneas no disponible"}, 503, headers=cors_headers)

    now = datetime.utcnow()
    today_str = now.strftime("%Y-%m-%d")
    supervisor_key = clean(body.get("supervisor","")).upper() or await _pick_supervisor_key()
    assigned_agent = await _pick_agent(supervisor_key) or "SIN ASIGNAR"

    lead = {
        "nombre_cliente": nombre.upper(),
        "telefono_principal": telefono,
        "telefono_alt": digits_only(body.get("telefono_alt","")),
        "direccion": clean(body.get("direccion") or body.get("address","")),
        "zip_code": clean(body.get("zip") or body.get("zip_code","")),
        "mercado": str(body.get("mercado","BAMO")).upper(),
        "supervisor": supervisor_key,
        "servicio_interes": clean(body.get("servicio") or body.get("servicio_interes","")),
        "notas": clean(body.get("notas") or body.get("mensaje","")),
        "fuente": clean(body.get("fuente","Chatbot AI")),
        "status": "pending",
        "dia_venta": now,
        "creadoEn": now, "createdAt": now,
        "agente": assigned_agent, "agenteNombre": assigned_agent,
        "cantidad_lineas": int(body.get("cantidad_lineas",1) or 1),
        "_origen": "botpress_webhook",
    }

    result = await tl_db["ENTRANTES_CHATBOT"].insert_one(lead)
    return JSONResponse({"success": True, "message": "Lead registrado correctamente en Team Líneas", "id": str(result.inserted_id)}, 201, headers=cors_headers)


@router.get("/api/webhook/lineas")
async def webhook_get(
    limit: int = 100, skip: int = 0,
    user: dict = Depends(current_user),
):
    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")

    role = str(user.get("role","")).lower()
    username = str(user.get("username",""))

    is_admin_bo = any(r in role for r in ["admin","backoffice","back_office"])
    is_supervisor = "supervisor" in role

    if is_admin_bo:
        filt = {}
    elif is_supervisor:
        sup_key = None
        for t in TEAMS.values():
            if (t.get("supervisor","")).lower() == username.lower():
                sup_key = t.get("supervisorKey")
                break
        filt = {"supervisor": sup_key} if sup_key else {"supervisor": "__none__"}
    else:
        display = username.replace(".","").replace("_"," ").upper()
        filt = {"$or": [
            {"agente": username}, {"agenteNombre": username},
            {"agente": display}, {"agenteNombre": display},
        ]}

    leads = await tl_db["ENTRANTES_CHATBOT"].find(filt).sort("creadoEn",-1).skip(skip).limit(min(limit,500)).to_list(None)
    for l in leads:
        l["_id"] = str(l["_id"])
    return {"success": True, "data": leads, "total": len(leads)}


# ── LINEAS (crmagente.Lineas) ──────────────────────────────────
@router.get("/api/lineas")
async def get_lineas(user: dict = Depends(current_user)):
    db = get_db()
    username = user.get("username","")
    role = str(user.get("role","")).lower()
    privileged_roles = ["admin","administrador","backoffice","back office","back_office","bo","b.o","supervisor","supervisor team lineas"]
    is_privileged = any(r == role or role.startswith(r) for r in privileged_roles)
    filt = {} if is_privileged else {
        "$or": [{"agente": username},{"agenteNombre": username},{"createdBy": username},{"registeredBy": username}]
    }
    docs = await db["Lineas"].find(filt).sort("creadoEn",-1).to_list(None)
    for d in docs:
        d["_id"] = str(d["_id"])
    return {"success": True, "data": docs, "count": len(docs), "user": username, "filtered": not is_privileged}


class LineasBody(BaseModel):
    nombre_cliente: str
    telefono_principal: str
    numero_cuenta: str
    autopay: str
    pin_seguridad: str
    direccion: str
    dia_venta: str
    dia_instalacion: str
    status: str
    cantidad_lineas: int
    id: str
    mercado: str
    supervisor: str
    telefonos: Optional[List[str]] = []
    servicios: Optional[List[str]] = []
    agenteAsignado: Optional[str] = None
    lineas_status: Optional[Any] = None
    lines: Optional[List[Any]] = []


@router.post("/api/lineas")
async def post_lineas(body: LineasBody, user: dict = Depends(current_user)):
    errors = []
    autopay_val = str(body.autopay or "").lower()
    if autopay_val not in ("si","no"):
        errors.append("autopay debe ser si | no")

    status_norm = _normalize_status(body.status)
    if status_norm not in ("pending","rescheduled"):
        errors.append("status inválido (permitidos: pending, repro/rescheduled)")

    mercado = str(body.mercado or "").lower()
    if mercado not in ("bamo","icon"):
        errors.append("mercado debe ser bamo | icon")

    supervisor_val = str(body.supervisor or "").lower()
    role = str(user.get("role","")).lower()
    if not supervisor_val and user.get("supervisor"):
        supervisor_val = str(user["supervisor"]).lower()
    elif not supervisor_val and user.get("team"):
        t = str(user["team"]).lower()
        if "jonathan" in t:
            supervisor_val = "jonathan f"
        elif "luis" in t:
            supervisor_val = "luis g"
    if not supervisor_val:
        errors.append("No se pudo determinar el supervisor")
    elif supervisor_val not in ("jonathan f","luis g"):
        errors.append("supervisor inválido (permitidos: JONATHAN F, LUIS G)")

    cantidad_lineas = int(body.cantidad_lineas or 0)
    if cantidad_lineas < 1 or cantidad_lineas > 5:
        errors.append("cantidad_lineas debe ser 1-5")

    telefonos = [re.sub(r"\D+","",t) for t in (body.telefonos or []) if t]
    if len(telefonos) != cantidad_lineas:
        errors.append("La cantidad de teléfonos debe coincidir con cantidad_lineas")

    if errors:
        raise HTTPException(400, {"message":"Validación fallida","errors":errors})

    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")

    username = user.get("username","")
    target_agent = username
    if "supervisor" in role and body.agenteAsignado:
        target_agent = body.agenteAsignado
    target_col_name = _normalize_col_name(target_agent)

    servicios = [str(s) for s in (body.servicios or [])]
    initial_lineas_status = {}
    initial_lines = []
    payload_lineas_st = body.lineas_status if isinstance(body.lineas_status, dict) else {}
    payload_lines = body.lines or []

    for i in range(cantidad_lineas):
        st = str(payload_lineas_st.get(i) or payload_lineas_st.get(str(i)) or "").strip().upper()
        if not st and i < len(payload_lines) and isinstance(payload_lines[i], dict):
            pl = payload_lines[i]
            st = str(pl.get("estado") or pl.get("status") or "").strip().upper()
        if not st:
            st = "PENDING" if status_norm == "pending" else status_norm.upper()
        initial_lineas_status[i] = st
        telf = telefonos[i] if i < len(telefonos) else ""
        serv = servicios[i] if i < len(servicios) else ""
        initial_lines.append({"telefono": telf, "servicio": serv, "estado": st})

    now = datetime.utcnow()
    doc = {
        "team": "team lineas",
        "nombre_cliente": body.nombre_cliente.strip().upper(),
        "telefono_principal": re.sub(r"\D+","",body.telefono_principal),
        "numero_cuenta": str(body.numero_cuenta).strip(),
        "autopay": autopay_val == "si",
        "pin_seguridad": str(body.pin_seguridad).strip(),
        "direccion": str(body.direccion).strip(),
        "servicios": servicios,
        "dia_venta": _normalize_date(body.dia_venta),
        "dia_instalacion": _normalize_date(body.dia_instalacion),
        "status": status_norm.upper(),
        "cantidad_lineas": cantidad_lineas,
        "telefonos": telefonos,
        "ID": str(body.id).strip(),
        "mercado": mercado.upper(),
        "supervisor": supervisor_val.upper(),
        "userId": str(user.get("_id") or user.get("id") or ""),
        "agente": _normalize_agent_display(username),
        "agenteAsignado": _normalize_agent_display(target_agent),
        "agenteAsignadoCollection": target_col_name,
        "lineas_status": initial_lineas_status,
        "lines": initial_lines,
        "creadoEn": now, "actualizadoEn": now,
        "_raw": body.model_dump(),
    }

    result = await tl_db[target_col_name].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return JSONResponse({"success": True, "message": f"Guardado en TEAM_LINEAS > {target_col_name}", "id": str(result.inserted_id), "data": doc}, 201)


# ── LINEAS-TEAM notes/update/delete ───────────────────────────
class LineasTeamUpdateBody(BaseModel):
    id: str
    nombre_cliente: Optional[str] = None
    telefono_principal: Optional[str] = None
    numero_cuenta: Optional[str] = None
    cantidad_lineas: Optional[int] = None
    status: Optional[str] = None
    dia_venta: Optional[str] = None
    dia_instalacion: Optional[str] = None


@router.put("/api/lineas-team/update")
async def lineas_team_update(body: LineasTeamUpdateBody, user: dict = Depends(current_user)):
    if not body.id:
        raise HTTPException(400, "ID requerido")

    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")

    update_data: dict = {"actualizadoEn": datetime.utcnow()}
    if body.nombre_cliente:     update_data["nombre_cliente"] = body.nombre_cliente.strip().upper()
    if body.telefono_principal: update_data["telefono_principal"] = re.sub(r"\D+","",body.telefono_principal)
    if body.numero_cuenta:      update_data["numero_cuenta"] = str(body.numero_cuenta).strip()
    if body.cantidad_lineas:    update_data["cantidad_lineas"] = int(body.cantidad_lineas)
    if body.status:             update_data["status"] = _normalize_status(body.status).upper()
    if body.dia_venta:          update_data["dia_venta"] = _normalize_date(body.dia_venta)
    if body.dia_instalacion:    update_data["dia_instalacion"] = _normalize_date(body.dia_instalacion)

    oid = _oid(body.id)
    filt = {"_id": oid} if oid else {"_id": body.id}

    cols = await tl_db.list_collection_names()
    for col_name in cols:
        try:
            r = await tl_db[col_name].update_one(filt, {"$set": update_data})
            if r.matched_count > 0:
                return {"success": True, "message": "Registro actualizado"}
        except Exception:
            pass
    raise HTTPException(404, "Registro no encontrado")


class NoteBody(BaseModel):
    clientId: str
    texto: Optional[str] = ""
    type: Optional[str] = "general"


class NoteEditBody(BaseModel):
    clientId: str
    noteId: str
    texto: Optional[str] = ""


class NoteDeleteBody(BaseModel):
    noteId: str


@router.post("/api/lineas-team/notes")
async def lineas_notes_add(body: NoteBody, user: dict = Depends(current_user)):
    if not body.clientId:
        raise HTTPException(400, "clientId requerido")
    db = get_db()
    lead_oid = _oid(body.clientId) or body.clientId
    nota = {
        "leadId": lead_oid,
        "texto": str(body.texto or "")[:1000],
        "type": body.type or "general",
        "autor": user.get("username","Sistema"),
        "createdAt": datetime.utcnow(),
    }
    await db["lineas_notes"].insert_one(nota)
    nota["_id"] = str(nota.get("_id",""))
    nota["leadId"] = str(nota["leadId"])
    return {"success": True, "message": "Nota guardada", "data": nota}


@router.post("/api/lineas-team/notes/edit")
async def lineas_notes_edit(body: NoteEditBody, user: dict = Depends(current_user)):
    if not body.clientId or not body.noteId:
        raise HTTPException(400, "clientId y noteId requeridos")
    db = get_db()
    note_oid = _oid(body.noteId) or body.noteId
    result = await db["lineas_notes"].update_one(
        {"_id": note_oid},
        {"$set": {"texto": str(body.texto or "")[:1000], "updatedAt": datetime.utcnow(), "updatedBy": user.get("username")}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Nota no encontrada")
    return {"success": True, "message": "Nota actualizada"}


@router.post("/api/lineas-team/notes/delete")
async def lineas_notes_delete(body: NoteDeleteBody, user: dict = Depends(current_user)):
    if not body.noteId:
        raise HTTPException(400, "noteId requerido")
    db = get_db()
    note_oid = _oid(body.noteId) or body.noteId
    result = await db["lineas_notes"].delete_one({"_id": note_oid})
    if not result.deleted_count:
        raise HTTPException(404, "Nota no encontrada")
    return {"success": True, "message": "Nota eliminada"}


class LineasTeamDeleteBody(BaseModel):
    id: str


@router.delete("/api/lineas-team/delete")
async def lineas_team_delete(body: LineasTeamDeleteBody, user: dict = Depends(current_user)):
    if not body.id:
        raise HTTPException(400, "ID requerido")
    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")
    oid = _oid(body.id)
    if not oid:
        raise HTTPException(400, "ID inválido")
    cols = await tl_db.list_collection_names()
    for col_name in cols:
        try:
            r = await tl_db[col_name].delete_one({"_id": oid})
            if r.deleted_count > 0:
                return {"success": True, "message": "Registro eliminado"}
        except Exception:
            pass
    raise HTTPException(404, "Registro no encontrado")


# ── GET /api/lineas-team ───────────────────────────────────────
@router.get("/api/lineas-team")
async def lineas_team_list(user: dict = Depends(current_user)):
    tl_db = get_team_lineas_db()
    if tl_db is None:
        return {"success": True, "data": [], "count": 0}

    role = str(user.get("role", "")).lower()
    username = str(user.get("username", ""))
    is_admin_bo = any(r in role for r in ["admin", "backoffice", "back_office", "rol_icon"])
    is_supervisor = "supervisor" in role

    # Clave de caché por usuario (admins comparten una sola entrada)
    cache_key = "__admin__" if is_admin_bo else username

    cached = _cache_get(cache_key)
    if cached is not None:
        return {"success": True, "data": cached, "count": len(cached)}

    if is_admin_bo:
        filt: dict = {}
    elif is_supervisor:
        sup_key = None
        for t in TEAMS.values():
            if t.get("supervisor", "").lower() == username.lower():
                sup_key = t.get("supervisorKey")
                break
        filt = {"supervisor": {"$regex": sup_key, "$options": "i"}} if sup_key else {"supervisor": "__none__"}
    else:
        display = username.replace(".", " ").replace("_", " ").upper()
        filt = {"$or": [
            {"agente": username}, {"agenteNombre": username},
            {"agente": display}, {"agenteNombre": display},
            {"agenteAsignado": username}, {"agenteAsignado": display},
        ]}

    cols = await tl_db.list_collection_names()
    records = []
    for col_name in cols:
        try:
            docs = await tl_db[col_name].find(filt).sort("creadoEn", -1).limit(300).to_list(None)
            for d in docs:
                d["_id"] = str(d["_id"])
                d["_collection"] = col_name
            records.extend(docs)
        except Exception:
            pass

    records.sort(key=lambda x: str(x.get("creadoEn") or ""), reverse=True)
    _cache_set(cache_key, records)
    return {"success": True, "data": records, "count": len(records)}


# ── PUT /api/lineas-team/status ────────────────────────────────
class LineasTeamStatusBody(BaseModel):
    id: str
    status: str


@router.put("/api/lineas-team/status")
async def lineas_team_status(body: LineasTeamStatusBody, user: dict = Depends(current_user)):
    if not body.id or not body.status:
        raise HTTPException(400, "id y status requeridos")
    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")

    oid = _oid(body.id)
    filt = {"_id": oid} if oid else {"_id": body.id}
    update = {"$set": {"status": body.status.upper(), "actualizadoEn": datetime.utcnow()}}

    cols = await tl_db.list_collection_names()
    for col_name in cols:
        try:
            r = await tl_db[col_name].update_one(filt, update)
            if r.matched_count > 0:
                _cache_invalidate()
                return {"success": True, "message": "Status actualizado", "status": body.status}
        except Exception:
            pass
    raise HTTPException(404, "Registro no encontrado")


# ── PUT /api/lineas-team/line-status ──────────────────────────
class LineStatusBody(BaseModel):
    clientId: str
    lineIndex: int
    status: str


@router.put("/api/lineas-team/line-status")
async def lineas_team_line_status(body: LineStatusBody, user: dict = Depends(current_user)):
    if not body.clientId:
        raise HTTPException(400, "clientId requerido")
    tl_db = get_team_lineas_db()
    if tl_db is None:
        raise HTTPException(503, "BD de Team Líneas no disponible")

    oid = _oid(body.clientId)
    filt = {"_id": oid} if oid else {"_id": body.clientId}
    new_status = body.status.upper()
    update = {"$set": {
        f"lineas_status.{body.lineIndex}": new_status,
        f"lines.{body.lineIndex}.estado": new_status,
        "actualizadoEn": datetime.utcnow(),
    }}

    cols = await tl_db.list_collection_names()
    for col_name in cols:
        try:
            r = await tl_db[col_name].update_one(filt, update)
            if r.matched_count > 0:
                _cache_invalidate()
                return {"success": True, "message": "Estado de línea actualizado", "lineIndex": body.lineIndex, "status": new_status}
        except Exception:
            pass
    raise HTTPException(404, "Registro no encontrado")
