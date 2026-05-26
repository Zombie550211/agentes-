from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime
from typing import Optional, List, Any
import re, random, unicodedata, time, json, os

_LINEAS_CACHE: dict = {}
_LINEAS_TTL = 45


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

TEAMS = {
    "TEAM LINEAS":    {"supervisor": "jonathan.figueroa", "supervisorKey": "JONATHAN F",
                       "agents": ["VICTOR HURTADO","EDWARD RAMIREZ","CRISTIAN RIVERA","ANDREA ARDON","OSCAR RIVERA","MELANIE HURTADO","DENNIS VASQUEZ"]},
    "TEAM LUIS G":    {"supervisor": "luis.g",            "supervisorKey": "LUIS G",
                       "agents": ["DANIEL DEL CID","FERNANDO BELTRAN","KARLA RODRIGUEZ","JOCELYN REYES","JONATHAN GARCIA","NANCY LOPEZ","TATIANA GIRON","CESAR CLAROS","KARLA PONCE","MANUEL FLORES"]},
    "TEAM IRANIA S":  {"supervisor": "irania.serrano",    "supervisorKey": "IRANIA S",
                       "agents": ["JOSUE RENDEROS","TATIANA AYALA","GISELLE DIAZ","MIGUEL NUNEZ","ROXANA MARTINEZ"]},
    "TEAM BRYAN P":   {"supervisor": "bryan.pleitez",     "supervisorKey": "BRYAN P",
                       "agents": ["ABIGAIL GALDAMEZ","ALEXANDER RIVERA","DIEGO MEJIA","EVELIN GARCIA","FABRICIO PANAMENO","LUIS CHAVARRIA","STEVEN VARELA"]},
    "TEAM ROBERTO V": {"supervisor": "roberto.velasquez", "supervisorKey": "ROBERTO V",
                       "agents": ["CINDY FLORES","DANIELA BONILLA","FRANCISCO AGUILAR","LEVY CEREN","LISBETH CORTEZ","LUCIA FERMAN","NELSON CEREN"]},
    "TEAM JOHANA":    {"supervisor": "johana",             "supervisorKey": "JOHANA",
                       "agents": ["ANDERSON GUZMAN","CARLOS GRANDE","GUADALUPE SANTANA","JULIO CHAVEZ","PRISCILA HERNANDEZ","RIQUELMI TORRES"]},
}

SUPERVISOR_KEYS = ["JONATHAN F", "LUIS G"]

WEBHOOK_ALLOWED_ORIGINS = {
    "https://www.lineas-moviles.com", "https://lineas-moviles.com",
    "http://www.lineas-moviles.com",  "http://lineas-moviles.com",
}
WEBHOOK_KEY = os.getenv("WEBHOOK_LINEAS_KEY", "")


def _normalize_col_name(s: str) -> str:
    try:
        n = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
        n = re.sub(r"[^A-Za-z0-9_\s-]", " ", n)
        n = re.sub(r"[\s-]+", " ", n).strip().replace(" ", "_")
        return (n or "UNKNOWN").upper()
    except Exception:
        return re.sub(r"[\s-]+", "_", str(s or "").strip()).upper() or "UNKNOWN"


def _normalize_agent_display(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().replace("_", " ")).upper()


def _normalize_status(s: str) -> str:
    v = str(s or "").strip().lower()
    if v in ("repro", "rescheduled", "reagendado"):
        return "rescheduled"
    if v in ("pending", "pendiente"):
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


def _is_privileged(role: str) -> bool:
    r = str(role or "").lower()
    return any(v in r for v in ["admin", "administrador", "backoffice", "back office", "back_office", "bo", "b.o", "supervisor"])


def _fmt_lc(row) -> dict:
    d = dict(row)
    d["_id"] = str(d.get("id", ""))
    for col in ("servicios", "telefonos"):
        v = d.get(col)
        if isinstance(v, str):
            try: d[col] = json.loads(v)
            except: d[col] = []
        elif v is None:
            d[col] = []
    for col in ("lineas_status", "lines_data"):
        v = d.get(col)
        if isinstance(v, str):
            try: d[col] = json.loads(v)
            except: d[col] = {}
        elif v is None:
            d[col] = {}
    for col in ("dia_venta", "dia_instalacion", "created_at", "updated_at"):
        if d.get(col) is not None:
            d[col] = str(d[col])
    d["creadoEn"]      = d.get("created_at")
    d["actualizadoEn"] = d.get("updated_at")
    d["agenteNombre"]  = d.get("agente_nombre")
    d["agenteAsignado"] = d.get("agente_asignado")
    d["_collection"]   = d.get("collection_name")
    d["imagen_url"]    = d.get("imagen_url") or ""
    return d


async def _rr_pick(rr_key: str, choices: list):
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("""
                INSERT INTO rr_config (rr_key, idx) VALUES (:k, 1)
                ON DUPLICATE KEY UPDATE idx = idx + 1
            """), {"k": rr_key})
            r = await s.execute(text("SELECT idx FROM rr_config WHERE rr_key = :k"), {"k": rr_key})
            await s.commit()
            row = r.mappings().first()
            if row:
                return choices[(row["idx"] - 1) % len(choices)]
    except Exception:
        pass
    return random.choice(choices)


async def _pick_supervisor_key() -> str:
    return await _rr_pick("rr_supervisor", SUPERVISOR_KEYS)


async def _pick_agent(supervisor_key: str) -> Optional[str]:
    team = next((t for t in TEAMS.values() if t.get("supervisorKey", "").upper() == supervisor_key.upper()), None)
    if not team or not team.get("agents"):
        return None
    return await _rr_pick(f"rr_agent_{supervisor_key.upper()}", team["agents"])


# ── WEBHOOK ─────────────────────────────────────────────────────────

@router.options("/api/webhook/lineas")
async def webhook_options(request: Request):
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in WEBHOOK_ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        headers["Access-Control-Allow-Headers"] = "Content-Type, x-api-key"
    return JSONResponse(content=None, status_code=204, headers=headers)


@router.post("/api/webhook/lineas")
async def webhook_post(request: Request, x_api_key: str = Header(default="")):
    origin = request.headers.get("origin", "")
    cors_headers = {}
    if origin in WEBHOOK_ALLOWED_ORIGINS:
        cors_headers["Access-Control-Allow-Origin"] = origin

    if not WEBHOOK_KEY or x_api_key != WEBHOOK_KEY:
        return JSONResponse({"success": False, "message": "API key inválida"}, 401, headers=cors_headers)

    body = await request.json()
    clean      = lambda s: str(s or "").strip()
    digits_only = lambda s: re.sub(r"\D+", "", str(s or ""))

    nombre   = clean(body.get("nombre") or body.get("nombre_cliente", ""))
    telefono = digits_only(body.get("telefono") or body.get("telefono_principal", ""))
    if not nombre:
        return JSONResponse({"success": False, "message": "Campo requerido: nombre"}, 400, headers=cors_headers)
    if not telefono:
        return JSONResponse({"success": False, "message": "Campo requerido: telefono"}, 400, headers=cors_headers)

    now            = datetime.utcnow()
    supervisor_key = clean(body.get("supervisor", "")).upper() or await _pick_supervisor_key()
    assigned_agent = await _pick_agent(supervisor_key) or "SIN ASIGNAR"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO lineas_clientes
                (collection_name, nombre_cliente, telefono_principal, telefono_alt,
                 direccion, zip_code, mercado, supervisor, servicio_interes, notas, fuente,
                 status, dia_venta, agente, agente_nombre, cantidad_lineas, created_at, updated_at)
            VALUES
                ('ENTRANTES_CHATBOT', :nc, :tp, :ta,
                 :dir, :zip, :merc, :sup, :si, :notas, :fuente,
                 'pending', :dv, :ag, :ag, :cl, :now, :now)
        """), {
            "nc":    nombre.upper(),
            "tp":    telefono,
            "ta":    digits_only(body.get("telefono_alt", "")),
            "dir":   clean(body.get("direccion") or body.get("address", "")),
            "zip":   clean(body.get("zip") or body.get("zip_code", "")),
            "merc":  str(body.get("mercado", "BAMO")).upper(),
            "sup":   supervisor_key,
            "si":    clean(body.get("servicio") or body.get("servicio_interes", "")),
            "notas": clean(body.get("notas") or body.get("mensaje", "")),
            "fuente": clean(body.get("fuente", "Chatbot AI")),
            "dv":    now.strftime("%Y-%m-%d"),
            "ag":    assigned_agent,
            "cl":    int(body.get("cantidad_lineas", 1) or 1),
            "now":   now,
        })
        await s.commit()
        new_id = r.lastrowid

    return JSONResponse(
        {"success": True, "message": "Lead registrado correctamente en Team Líneas", "id": str(new_id)},
        201, headers=cors_headers,
    )


@router.get("/api/webhook/lineas")
async def webhook_get(
    limit: int = 100,
    skip:  int = 0,
    user: dict = Depends(current_user),
):
    role     = str(user.get("role", "")).lower()
    username = str(user.get("username", ""))
    is_admin_bo  = any(r in role for r in ["admin", "backoffice", "back_office"])
    is_supervisor = "supervisor" in role

    where:  list = ["(collection_name = 'ENTRANTES_CHATBOT')"]
    params: dict = {}

    if is_supervisor:
        sup_key = None
        uname_low = username.lower()
        for t in TEAMS.values():
            if (t.get("supervisor", "").lower() == uname_low or
                    t.get("supervisorKey", "").lower() == uname_low):
                sup_key = t.get("supervisorKey")
                break
        if sup_key:
            first_word = sup_key.split()[0].upper()
            where.append("""(UPPER(TRIM(supervisor)) = :sup
                             OR UPPER(TRIM(supervisor)) LIKE :sup_like
                             OR UPPER(REPLACE(supervisor,'.', ' ')) LIKE :sup_like)""")
            params["sup"]      = sup_key.upper()
            params["sup_like"] = f"{first_word}%"
        else:
            where.append("supervisor = '__none__'")
    elif not is_admin_bo:
        display = username.replace(".", "").replace("_", " ").upper()
        where.append("(agente = :ag1 OR agente_nombre = :ag1 OR agente = :ag2 OR agente_nombre = :ag2)")
        params["ag1"] = username
        params["ag2"] = display

    where_sql = " AND ".join(f"({w})" for w in where)
    lim = min(limit, 500)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT * FROM lineas_clientes
            WHERE {where_sql}
            ORDER BY created_at DESC
            LIMIT :lim OFFSET :skip
        """), {**params, "lim": lim, "skip": skip})
        leads = [_fmt_lc(row) for row in r.mappings().all()]

    return {"success": True, "data": leads, "total": len(leads)}


# ── LINEAS INTERNAS (lineas_internal) ───────────────────────────────

@router.get("/api/lineas")
async def get_lineas(user: dict = Depends(current_user)):
    username = user.get("username", "")
    role     = str(user.get("role", "")).lower()
    privileged_roles = ["admin", "administrador", "backoffice", "back office", "back_office", "bo", "b.o", "supervisor"]
    is_priv  = any(r == role or role.startswith(r) for r in privileged_roles)

    where:  list = []
    params: dict = {}
    if not is_priv:
        where.append("(agente = :u OR agente_nombre = :u OR created_by = :u OR registered_by = :u)")
        params["u"] = username

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT * FROM lineas_internal {where_sql}
            ORDER BY created_at DESC
        """), params)
        docs = []
        for row in r.mappings().all():
            d = dict(row)
            d["_id"] = str(d.get("id", ""))
            raw = d.get("data")
            if isinstance(raw, str):
                try:
                    extra = json.loads(raw)
                    if isinstance(extra, dict):
                        d.update(extra)
                except Exception:
                    pass
            for col in ("created_at", "updated_at"):
                if d.get(col) is not None:
                    d[col] = str(d[col])
            d["creadoEn"] = d.get("created_at")
            docs.append(d)

    return {"success": True, "data": docs, "count": len(docs), "user": username, "filtered": not is_priv}


class LineasBody(BaseModel):
    nombre_cliente:    str
    telefono_principal: str
    numero_cuenta:     str
    autopay:           str
    pin_seguridad:     str
    direccion:         str
    dia_venta:         str
    dia_instalacion:   str
    status:            str
    cantidad_lineas:   int
    id:                str
    mercado:           str
    supervisor:        str
    telefonos:         Optional[List[str]] = []
    servicios:         Optional[List[str]] = []
    agenteAsignado:    Optional[str] = None
    lineas_status:     Optional[Any] = None
    lines:             Optional[List[Any]] = []
    imagen_url:        Optional[str] = None


@router.post("/api/lineas")
async def post_lineas(body: LineasBody, user: dict = Depends(current_user)):
    errors = []
    autopay_val  = str(body.autopay or "").lower()
    status_norm  = _normalize_status(body.status)
    mercado      = str(body.mercado or "").lower()
    role         = str(user.get("role", "")).lower()
    supervisor_val = str(body.supervisor or "").lower()

    if autopay_val not in ("si", "no"):
        errors.append("autopay debe ser si | no")
    if status_norm not in ("pending", "rescheduled"):
        errors.append("status inválido (permitidos: pending, repro/rescheduled)")
    if mercado not in ("bamo", "icon"):
        errors.append("mercado debe ser bamo | icon")

    if not supervisor_val and user.get("supervisor"):
        supervisor_val = str(user["supervisor"]).lower()
    elif not supervisor_val and user.get("team"):
        t = str(user["team"]).lower()
        if "jonathan" in t:
            supervisor_val = "jonathan f"
        elif "luis" in t:
            supervisor_val = "luis g"

    # Normalizar supervisor a clave corta si viene nombre completo
    _sup_map = {
        "jonathan figueroa": "jonathan f", "jonathan.figueroa": "jonathan f",
        "jonathan f": "jonathan f",
        "luis g": "luis g", "luis.g": "luis g",
    }
    supervisor_val = _sup_map.get(supervisor_val, supervisor_val)

    if not supervisor_val:
        errors.append("No se pudo determinar el supervisor")
    elif supervisor_val not in ("jonathan f", "luis g"):
        errors.append("supervisor inválido (permitidos: JONATHAN F, LUIS G)")

    cantidad_lineas = int(body.cantidad_lineas or 0)
    if cantidad_lineas < 1 or cantidad_lineas > 5:
        errors.append("cantidad_lineas debe ser 1-5")

    telefonos = [re.sub(r"\D+", "", t) for t in (body.telefonos or []) if t]
    if len(telefonos) != cantidad_lineas:
        errors.append("La cantidad de teléfonos debe coincidir con cantidad_lineas")

    if errors:
        raise HTTPException(400, {"message": "Validación fallida", "errors": errors})

    telefono_clean = re.sub(r"\D+", "", body.telefono_principal)
    cuenta_clean   = str(body.numero_cuenta).strip()

    username     = user.get("username", "")
    target_agent = username
    if "supervisor" in role and body.agenteAsignado:
        target_agent = body.agenteAsignado
    target_col_name = _normalize_col_name(target_agent)

    servicios = [str(s) for s in (body.servicios or [])]
    payload_lineas_st = body.lineas_status if isinstance(body.lineas_status, dict) else {}
    payload_lines     = body.lines or []
    initial_lineas_status: dict = {}
    initial_lines: list = []

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

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO lineas_clientes
                (collection_name, team, nombre_cliente, telefono_principal, numero_cuenta,
                 autopago, pin_seguridad, direccion, servicios, dia_venta, dia_instalacion,
                 status, cantidad_lineas, telefonos, mercado, supervisor,
                 agente, agente_nombre, agente_asignado, lineas_status, lines_data,
                 fuente, imagen_url, created_at, updated_at)
            VALUES
                (:col, 'TEAM LINEAS', :nc, :tp, :nuc,
                 :ap, :pin, :dir, :svc, :dv, :di,
                 :st, :cl, :tel, :merc, :sup,
                 :ag, :ag, :aga, :lst, :ldat,
                 'CRM', :img, :now, :now)
        """), {
            "col":  target_col_name,
            "nc":   body.nombre_cliente.strip().upper(),
            "tp":   re.sub(r"\D+", "", body.telefono_principal),
            "nuc":  str(body.numero_cuenta).strip(),
            "ap":   autopay_val == "si",
            "pin":  str(body.pin_seguridad).strip(),
            "dir":  str(body.direccion).strip(),
            "svc":  json.dumps(servicios),
            "dv":   _normalize_date(body.dia_venta),
            "di":   _normalize_date(body.dia_instalacion),
            "st":   status_norm.upper(),
            "cl":   cantidad_lineas,
            "tel":  json.dumps(telefonos),
            "merc": mercado.upper(),
            "sup":  supervisor_val.upper(),
            "ag":   _normalize_agent_display(username),
            "aga":  _normalize_agent_display(target_agent),
            "lst":  json.dumps(initial_lineas_status),
            "ldat": json.dumps(initial_lines),
            "img":  str(body.imagen_url).strip() if body.imagen_url else None,
            "now":  now,
        })
        await s.commit()
        new_id = r.lastrowid

    _cache_invalidate()
    return JSONResponse({
        "success": True,
        "message": f"Guardado en TEAM_LINEAS > {target_col_name}",
        "id": str(new_id),
        "data": {
            "_id": str(new_id),
            "collection_name": target_col_name,
            "nombre_cliente": body.nombre_cliente.strip().upper(),
            "status": status_norm.upper(),
            "agente": _normalize_agent_display(username),
            "agenteAsignado": _normalize_agent_display(target_agent),
            "ID": str(body.id).strip(),
        },
    }, 201)


# ── LINEAS-TEAM update/notes/delete ─────────────────────────────────

class LineasTeamUpdateBody(BaseModel):
    id:                 str
    nombre_cliente:     Optional[str] = None
    telefono_principal: Optional[str] = None
    numero_cuenta:      Optional[str] = None
    pin_seguridad:      Optional[str] = None
    direccion:          Optional[str] = None
    cantidad_lineas:    Optional[int] = None
    status:             Optional[str] = None
    dia_venta:          Optional[str] = None
    dia_instalacion:    Optional[str] = None
    imagen_url:         Optional[str] = None
    line_index:         Optional[int] = None
    line_telefono:      Optional[str] = None
    line_servicio:      Optional[str] = None


@router.put("/api/lineas-team/update")
async def lineas_team_update(body: LineasTeamUpdateBody, user: dict = Depends(current_user)):
    if not body.id:
        raise HTTPException(400, "ID requerido")
    try:
        mid = int(body.id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    sets:   list = ["updated_at = :now"]
    params: dict = {"id": mid, "now": datetime.utcnow()}

    if body.nombre_cliente:
        sets.append("nombre_cliente = :nc"); params["nc"] = body.nombre_cliente.strip().upper()
    if body.telefono_principal:
        sets.append("telefono_principal = :tp"); params["tp"] = re.sub(r"\D+", "", body.telefono_principal)
    if body.numero_cuenta:
        sets.append("numero_cuenta = :nuc"); params["nuc"] = str(body.numero_cuenta).strip()
    if body.pin_seguridad is not None:
        sets.append("pin_seguridad = :pin"); params["pin"] = str(body.pin_seguridad).strip()
    if body.direccion is not None:
        sets.append("direccion = :dir"); params["dir"] = str(body.direccion).strip()
    if body.cantidad_lineas:
        sets.append("cantidad_lineas = :cl"); params["cl"] = int(body.cantidad_lineas)
    if body.status:
        sets.append("status = :st"); params["st"] = _normalize_status(body.status).upper()
    if body.dia_venta:
        sets.append("dia_venta = :dv"); params["dv"] = _normalize_date(body.dia_venta)
    if body.dia_instalacion:
        sets.append("dia_instalacion = :di"); params["di"] = _normalize_date(body.dia_instalacion)
    if body.imagen_url is not None:
        sets.append("imagen_url = :img"); params["img"] = body.imagen_url or None

    if body.line_index is not None:
        li = int(body.line_index)
        if body.line_telefono is not None:
            clean_tel = re.sub(r"\D+", "", str(body.line_telefono))
            params["ltel"] = clean_tel
            params["ltel_path1"] = f"$[{li}]"
            params["ltel_path2"] = f"$[{li}].telefono"
            sets.append("telefonos = JSON_SET(COALESCE(telefonos, JSON_ARRAY()), :ltel_path1, :ltel)")
        if body.line_servicio is not None:
            params["lserv"] = body.line_servicio.strip().upper()
            params["lserv_path"] = f"$[{li}].servicio"
        if body.line_telefono is not None and body.line_servicio is not None:
            sets.append("lines_data = JSON_SET(JSON_SET(COALESCE(lines_data, JSON_ARRAY()), :ltel_path2, :ltel), :lserv_path, :lserv)")
        elif body.line_telefono is not None:
            sets.append("lines_data = JSON_SET(COALESCE(lines_data, JSON_ARRAY()), :ltel_path2, :ltel)")
        elif body.line_servicio is not None:
            sets.append("lines_data = JSON_SET(COALESCE(lines_data, JSON_ARRAY()), :lserv_path, :lserv)")

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text(f"UPDATE lineas_clientes SET {', '.join(sets)} WHERE id = :id"), params
        )
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")

    _cache_invalidate()
    return {"success": True, "message": "Registro actualizado"}


class NoteBody(BaseModel):
    clientId: str
    texto:    Optional[str] = ""
    type:     Optional[str] = "general"


class NoteEditBody(BaseModel):
    clientId: str
    noteId:   str
    texto:    Optional[str] = ""


class NoteDeleteBody(BaseModel):
    noteId: str


@router.post("/api/lineas-team/notes")
async def lineas_notes_add(body: NoteBody, user: dict = Depends(current_user)):
    if not body.clientId:
        raise HTTPException(400, "clientId requerido")
    now   = datetime.utcnow()
    texto = str(body.texto or "")[:1000]
    autor = user.get("username", "Sistema")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO lineas_notes (lead_id, texto, type, autor, created_at, updated_at)
            VALUES (:lid, :txt, :type, :autor, :now, :now)
        """), {
            "lid":   str(body.clientId),
            "txt":   texto,
            "type":  body.type or "general",
            "autor": autor,
            "now":   now,
        })
        await s.commit()
        new_id = r.lastrowid

    return {"success": True, "message": "Nota guardada", "data": {
        "_id": str(new_id), "leadId": str(body.clientId),
        "texto": texto, "type": body.type or "general",
        "autor": autor, "createdAt": str(now),
    }}


@router.post("/api/lineas-team/notes/edit")
async def lineas_notes_edit(body: NoteEditBody, user: dict = Depends(current_user)):
    if not body.clientId or not body.noteId:
        raise HTTPException(400, "clientId y noteId requeridos")
    try:
        note_id = int(body.noteId)
    except ValueError:
        raise HTTPException(400, "noteId inválido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE lineas_notes
            SET texto = :txt, updated_at = :now, updated_by = :by
            WHERE id = :id
        """), {
            "txt": str(body.texto or "")[:1000],
            "now": datetime.utcnow(),
            "by":  user.get("username"),
            "id":  note_id,
        })
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Nota no encontrada")

    return {"success": True, "message": "Nota actualizada"}


@router.post("/api/lineas-team/notes/delete")
async def lineas_notes_delete(body: NoteDeleteBody, user: dict = Depends(current_user)):
    if not body.noteId:
        raise HTTPException(400, "noteId requerido")
    try:
        note_id = int(body.noteId)
    except ValueError:
        raise HTTPException(400, "noteId inválido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM lineas_notes WHERE id = :id"), {"id": note_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Nota no encontrada")

    return {"success": True, "message": "Nota eliminada"}


@router.get("/api/lineas-team/notes/{lead_id}")
async def lineas_notes_get(lead_id: str, user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT * FROM lineas_notes WHERE lead_id = :lid ORDER BY created_at DESC
        """), {"lid": lead_id})
        notes = []
        for row in r.mappings().all():
            n = dict(row)
            n["_id"] = str(n.get("id", ""))
            for col in ("created_at", "updated_at"):
                if n.get(col) is not None:
                    n[col] = str(n[col])
            notes.append(n)
    return {"success": True, "data": notes}


class LineasTeamDeleteBody(BaseModel):
    id: str


@router.delete("/api/lineas-team/delete")
async def lineas_team_delete(body: LineasTeamDeleteBody, user: dict = Depends(current_user)):
    if not body.id:
        raise HTTPException(400, "ID requerido")
    try:
        mid = int(body.id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM lineas_clientes WHERE id = :id"), {"id": mid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")

    _cache_invalidate()
    return {"success": True, "message": "Registro eliminado"}


# ── GET /api/lineas-team ─────────────────────────────────────────────

@router.get("/api/lineas-team")
async def lineas_team_list(user: dict = Depends(current_user)):
    role     = str(user.get("role", "")).lower()
    username = str(user.get("username", ""))
    is_admin_bo   = any(r in role for r in ["admin", "backoffice", "back_office", "rol_icon", "rol_bamo", "icon", "bamo"])
    is_supervisor = "supervisor" in role

    cache_key = "__admin__" if is_admin_bo else username
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"success": True, "data": cached, "count": len(cached)}

    where:  list = []
    params: dict = {}

    if is_supervisor:
        sup_key = None
        uname_low = username.lower()
        for t in TEAMS.values():
            # Acepta match por username de login (luis.g) O por supervisorKey (LUIS G)
            if (t.get("supervisor", "").lower() == uname_low or
                    t.get("supervisorKey", "").lower() == uname_low):
                sup_key = t.get("supervisorKey")
                break
        if sup_key:
            # Match flexible: cubre "JONATHAN F", "JONATHAN FIGUEROA", "jonathan.figueroa", etc.
            first_word = sup_key.split()[0].upper()  # "JONATHAN" ó "LUIS"
            where.append("""(
                UPPER(TRIM(supervisor)) = :sup
                OR UPPER(TRIM(supervisor)) LIKE :sup_like
                OR UPPER(REPLACE(supervisor, '.', ' ')) LIKE :sup_like
            )""")
            params["sup"]      = sup_key.upper()
            params["sup_like"] = f"{first_word}%"
        else:
            where.append("supervisor = '__none__'")
    elif not is_admin_bo:
        display = username.replace(".", " ").replace("_", " ").upper()
        where.append("""(agente = :ag1 OR agente_nombre = :ag1
                         OR agente = :ag2 OR agente_nombre = :ag2
                         OR agente_asignado = :ag1 OR agente_asignado = :ag2)""")
        params["ag1"] = username
        params["ag2"] = display

    where_sql = ("WHERE " + " AND ".join(f"({w})" for w in where)) if where else ""

    # Admins y backoffice: sin límite fijo (max 10000); supervisores/agentes: 3000
    row_limit = 10000 if is_admin_bo else 3000

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT * FROM lineas_clientes
            {where_sql}
            ORDER BY created_at DESC
            LIMIT :_lim
        """), {**params, "_lim": row_limit})
        records = [_fmt_lc(row) for row in r.mappings().all()]

    _cache_set(cache_key, records)
    return {"success": True, "data": records, "count": len(records)}


# ── PUT /api/lineas-team/status ──────────────────────────────────────

class LineasTeamStatusBody(BaseModel):
    id:     str
    status: str


@router.put("/api/lineas-team/status")
async def lineas_team_status(body: LineasTeamStatusBody, user: dict = Depends(current_user)):
    if not body.id or not body.status:
        raise HTTPException(400, "id y status requeridos")
    try:
        mid = int(body.id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE lineas_clientes
            SET status = :st, updated_at = :now
            WHERE id = :id
        """), {"st": body.status.upper(), "now": datetime.utcnow(), "id": mid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")

    _cache_invalidate()
    return {"success": True, "message": "Status actualizado", "status": body.status}


# ── PUT /api/lineas-team/line-status ────────────────────────────────

class LineStatusBody(BaseModel):
    clientId:  str
    lineIndex: int
    status:    str


@router.put("/api/lineas-team/line-status")
async def lineas_team_line_status(body: LineStatusBody, user: dict = Depends(current_user)):
    if not body.clientId:
        raise HTTPException(400, "clientId requerido")
    try:
        mid = int(body.clientId)
    except ValueError:
        raise HTTPException(400, "clientId inválido")

    new_status = body.status.upper()
    idx        = body.lineIndex

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE lineas_clientes
            SET lineas_status = JSON_SET(COALESCE(lineas_status, '{}'),
                                         CONCAT('$.\"', :idx, '\"'), :st),
                lines_data    = JSON_SET(COALESCE(lines_data, '[]'),
                                         CONCAT('$[', :idx, '].estado'), :st),
                updated_at    = :now
            WHERE id = :id
        """), {"idx": str(idx), "st": new_status, "now": datetime.utcnow(), "id": mid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")

    _cache_invalidate()
    return {"success": True, "message": "Estado de línea actualizado",
            "lineIndex": idx, "status": new_status}
