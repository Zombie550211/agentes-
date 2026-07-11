from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from limiter import limiter
from datetime import datetime, timezone
from typing import Optional, List, Any
import re, random, unicodedata, time, json, os, secrets, asyncio
import realtime


def _utcnow() -> datetime:
    """UTC naive (reemplazo no-deprecado de datetime.utcnow()).

    Mantiene el valor sin tzinfo para que coincida con las columnas DATETIME de
    MySQL (que se leen como naive) y no rompa comparaciones.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

_LINEAS_CACHE: dict = {}
_LINEAS_TTL = 45

# Referencias a tareas fire-and-forget de notificación SSE (evita que el GC
# las recoja antes de completarse).
_notify_tasks: set = set()


def _cache_get(key: str):
    entry = _LINEAS_CACHE.get(key)
    if entry and (time.monotonic() - entry["ts"]) < _LINEAS_TTL:
        return entry["data"]
    return None


def _cache_set(key: str, data: list):
    _LINEAS_CACHE[key] = {"ts": time.monotonic(), "data": data}


def _notify_lineas(action: str = "change"):
    """Avisa (sin bloquear) a los clientes SSE del canal 'lineas'.

    Fire-and-forget: si no hay loop activo (p. ej. en tests sync), no hace nada.
    realtime.publish es a prueba de excepciones, así que nunca rompe la escritura.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(realtime.publish("lineas", {"type": "lineas", "action": action}))
    _notify_tasks.add(task)
    task.add_done_callback(_notify_tasks.discard)


def _cache_invalidate():
    _LINEAS_CACHE.clear()
    _notify_lineas()


router = APIRouter(tags=["Lineas"])

def _team_token(team_name: str) -> str:
    """'TEAM LINEAS JONATHAN' -> 'JONATHAN' (palabra distintiva del team).
    Sirve para cruzar con lead.supervisor ('JONATHAN F', 'VICTOR H', …)."""
    u = (team_name or "").upper().replace("TEAM LINEAS", "").replace("TEAM", "").strip()
    parts = u.split()
    return parts[0] if parts else ""


async def get_lineas_teams() -> list:
    """Teams de Líneas derivados de la tabla `users` (página de permisos).

    Fuente ÚNICA de verdad de roles/teams/agentes — sin nombres hardcodeados.
    Si en permisos se crea un team o se mueve/asciende un agente, esto lo refleja.
    """
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT username, name, role, team
            FROM users
            WHERE UPPER(COALESCE(team,'')) LIKE 'TEAM LINEAS%'
            ORDER BY team, name
        """))
        rows = r.mappings().all()
    teams: dict = {}
    for u in rows:
        team_db = str(u["team"] or "").strip()
        if not team_db:
            continue
        token = _team_token(team_db)
        t = teams.setdefault(team_db, {
            "team": team_db, "token": token,
            "label": ("Team " + token.title()) if token else team_db.title(),
            "supervisor": None, "agents": [],
        })
        role  = str(u["role"] or "").lower()
        uname = str(u["username"] or "")
        name  = str(u["name"] or uname).strip()
        if "supervisor" in role:
            t["supervisor"] = {"username": uname, "name": name}
        elif not re.match(r"^lineas[\s-]", uname, re.I):  # excluir cuentas legacy duplicadas
            t["agents"].append({"username": uname, "name": name})
    return list(teams.values())


@router.get("/api/lineas/teams")
async def lineas_teams(user: dict = Depends(current_user)):
    """Teams/agentes de Líneas según la página de permisos (tabla users).
    Fuente única para todas las pantallas de Líneas — nada hardcodeado."""
    return {"success": True, "teams": await get_lineas_teams()}


# ── Autorización por alcance (visibilidad = permiso de edición) ──────
# Un usuario solo puede MODIFICAR los registros que también puede VER. La
# cláusula de abajo es la fuente única de verdad y la reutiliza tanto el
# listado (GET /api/lineas-team) como las comprobaciones de modificación.

def _is_admin_bo_lineas(user: dict) -> bool:
    """admin / backoffice / roles equivalentes (icon/bamo): acceso total.

    El conjunto de tokens debe coincidir EXACTAMENTE con el de GET /api/lineas-team
    para que el alcance de edición sea igual al de visibilidad ('admin' ya cubre
    administrador/administrator por substring).
    """
    r = str(user.get("role", "")).lower()
    return any(v in r for v in (
        "admin", "backoffice", "back_office",
        "rol_icon", "rol_bamo", "icon", "bamo",
    ))


def _user_scope_clause(user: dict) -> tuple[str, dict]:
    """Devuelve (condición_sql, params) que delimita los registros del usuario.

    Cadena vacía ('') = acceso total (admin/backoffice). Mantener alineado con
    el filtrado de GET /api/lineas-team.
    """
    role     = str(user.get("role", "")).lower()
    username = str(user.get("username", ""))
    is_supervisor = "supervisor" in role

    if _is_admin_bo_lineas(user):
        return "", {}

    if is_supervisor:
        # Team del supervisor desde el JWT (poblado en login desde users/permisos)
        token = _team_token(user.get("team", ""))
        if token:
            return ("""(
                UPPER(TRIM(supervisor)) LIKE :sup_like
                OR UPPER(REPLACE(supervisor, '.', ' ')) LIKE :sup_like
            )""", {"sup_like": f"{token}%"})
        return "supervisor = '__none__'", {}

    display = username.replace(".", " ").replace("_", " ").upper()
    return ("""(agente = :ag1 OR agente_nombre = :ag1
                OR agente = :ag2 OR agente_nombre = :ag2
                OR agente_asignado = :ag1 OR agente_asignado = :ag2)""",
            {"ag1": username, "ag2": display})


async def _ensure_can_modify(s, mid: int, user: dict) -> None:
    """Lanza 403 si el usuario no tiene alcance sobre el registro `mid`.

    admin/backoffice → cualquiera; supervisor → los de su equipo; agente → los suyos.
    Debe llamarse dentro de una sesión activa, antes del UPDATE.
    """
    clause, params = _user_scope_clause(user)
    if not clause:
        return  # acceso total
    r = await s.execute(
        text(f"SELECT 1 FROM lineas_clientes WHERE id = :id AND {clause} LIMIT 1"),
        {"id": mid, **params},
    )
    if r.first() is None:
        raise HTTPException(403, "No autorizado para modificar este registro")

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


def _llamada_sets_lineas(old_status: str, new_status: str) -> str:
    """SQL extra al cambiar status: dispara el ciclo de llamadas de verificación.
    → COMPLETED: fecha_completed=now, llamada Pendiente (1ª a los 7 días).
    → CANCELLED: llamada Pendiente inmediata."""
    old_n = str(old_status or "").lower()
    new_n = str(new_status or "").lower()
    if old_n == new_n:
        return ""
    if "complet" in new_n:
        return ", fecha_completed = UTC_TIMESTAMP(), llamada_cliente = 'Pendiente'"
    if "cancel" in new_n:
        return ", llamada_cliente = 'Pendiente'"
    return ""


def _fmt_lc(row) -> dict:
    d = dict(row)
    d["_id"] = str(d.get("id", ""))
    for col in ("servicios", "telefonos"):
        v = d.get(col)
        if isinstance(v, str):
            try: d[col] = json.loads(v)
            except (ValueError, TypeError): d[col] = []
        elif v is None:
            d[col] = []
    for col in ("lineas_status", "lines_data"):
        v = d.get(col)
        if isinstance(v, str):
            try: d[col] = json.loads(v)
            except (ValueError, TypeError): d[col] = {}
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
    # Round-robin entre supervisores de Líneas que tienen agentes (desde permisos)
    teams = [t for t in await get_lineas_teams() if t["agents"] and t.get("supervisor")]
    if not teams:
        return ""
    keys = [t["supervisor"]["name"] for t in teams]
    return await _rr_pick("rr_supervisor", keys)


async def _pick_agent(supervisor_key: str) -> Optional[str]:
    keyU = (supervisor_key or "").upper()
    team = next((t for t in await get_lineas_teams()
                 if t["token"] and t["token"] in keyU and t["agents"]), None)
    if not team:
        return None
    return await _rr_pick(f"rr_agent_{team['token']}", [a["name"] for a in team["agents"]])


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
@limiter.limit("20/minute")
async def webhook_post(request: Request, x_api_key: str = Header(default="")):
    origin = request.headers.get("origin", "")
    cors_headers = {}
    if origin in WEBHOOK_ALLOWED_ORIGINS:
        cors_headers["Access-Control-Allow-Origin"] = origin

    # Comparación en tiempo constante para no filtrar la clave por timing.
    if not WEBHOOK_KEY or not secrets.compare_digest(str(x_api_key), str(WEBHOOK_KEY)):
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

    now            = _utcnow()
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

    # Refresca caché y avisa a los dashboards conectados (venta entrante del chatbot).
    _cache_invalidate()

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
        token = _team_token(user.get("team", ""))
        if token:
            where.append("""(UPPER(TRIM(supervisor)) LIKE :sup_like
                             OR UPPER(REPLACE(supervisor,'.', ' ')) LIKE :sup_like)""")
            params["sup_like"] = f"{token}%"
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
        "victor hurtado": "victor h", "victor.hurtado": "victor h",
        "victor h": "victor h",
    }
    supervisor_val = _sup_map.get(supervisor_val, supervisor_val)

    if not supervisor_val:
        errors.append("No se pudo determinar el supervisor")
    elif supervisor_val not in ("jonathan f", "luis g", "victor h"):
        errors.append("supervisor inválido (permitidos: JONATHAN F, LUIS G, VICTOR H)")

    cantidad_lineas = int(body.cantidad_lineas or 0)
    if cantidad_lineas < 1 or cantidad_lineas > 10:
        errors.append("cantidad_lineas debe ser 1-10")

    telefonos = [re.sub(r"\D+", "", t) for t in (body.telefonos or []) if t]
    if len(telefonos) != cantidad_lineas:
        errors.append("La cantidad de teléfonos debe coincidir con cantidad_lineas")

    if errors:
        raise HTTPException(400, {"message": "Validación fallida", "errors": errors})

    username     = user.get("username", "")
    target_agent = username
    if "supervisor" in role and body.agenteAsignado:
        target_agent = body.agenteAsignado
    target_col_name = _normalize_col_name(target_agent)

    # Determinar nombre del team según supervisor
    if "jonathan" in supervisor_val:
        team_name = "TEAM LINEAS JONATHAN"
    elif "luis" in supervisor_val:
        team_name = "TEAM LINEAS LUIS"
    elif "victor" in supervisor_val:
        team_name = "TEAM LINEAS VICTOR"
    else:
        team_name = "TEAM LINEAS"

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

    now = _utcnow()

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO lineas_clientes
                (collection_name, team, nombre_cliente, telefono_principal, numero_cuenta,
                 autopago, pin_seguridad, direccion, servicios, dia_venta, dia_instalacion,
                 status, cantidad_lineas, telefonos, mercado, supervisor,
                 agente, agente_nombre, agente_asignado, lineas_status, lines_data,
                 fuente, imagen_url, created_at, updated_at)
            VALUES
                (:col, :team_name, :nc, :tp, :nuc,
                 :ap, :pin, :dir, :svc, :dv, :di,
                 :st, :cl, :tel, :merc, :sup,
                 :ag, :ag, :aga, :lst, :ldat,
                 'CRM', :img, :now, :now)
        """), {
            "col":       target_col_name,
            "team_name": team_name,
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
    supervisor:         Optional[str] = None
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
    params: dict = {"id": mid, "now": _utcnow()}

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
    if body.supervisor is not None and body.supervisor.strip():
        # Normalizar a clave corta: "JONATHAN F" o "LUIS G"
        sup_clean = body.supervisor.strip().upper()
        if "JONATHAN" in sup_clean:
            sup_clean = "JONATHAN F"
        elif "LUIS" in sup_clean:
            sup_clean = "LUIS G"
        sets.append("supervisor = :sup"); params["sup"] = sup_clean

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
        await _ensure_can_modify(s, mid, user)
        extra_llamada = ""
        prev_status, notif_row = "", None
        if body.status:
            pr = await s.execute(text(
                "SELECT status, nombre_cliente, agente_nombre, agente, agente_asignado, supervisor "
                "FROM lineas_clientes WHERE id = :id LIMIT 1"), {"id": mid})
            notif_row = pr.mappings().first() or {}
            prev_status = notif_row.get("status") or ""
            extra_llamada = _llamada_sets_lineas(prev_status, body.status)
        r = await s.execute(
            text(f"UPDATE lineas_clientes SET {', '.join(sets)}{extra_llamada} WHERE id = :id"), params
        )
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")

    # Notificación persistente de cambio de status (se muestra al entrar al CRM)
    if body.status and notif_row is not None:
        from notifications import record_status_change
        asyncio.create_task(record_status_change(
            seccion="lineas",
            cliente=notif_row.get("nombre_cliente") or "Sin nombre",
            old_status=prev_status,
            new_status=_normalize_status(body.status).upper(),
            actor=user.get("name") or user.get("username", ""),
            target_agente=(notif_row.get("agente_nombre") or notif_row.get("agente")
                           or notif_row.get("agente_asignado") or ""),
            target_supervisor=notif_row.get("supervisor") or "",
        ))

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
    now   = _utcnow()
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
        nr = await s.execute(text("SELECT autor FROM lineas_notes WHERE id = :id LIMIT 1"), {"id": note_id})
        note_row = nr.first()
        if note_row is None:
            raise HTTPException(404, "Nota no encontrada")
        # Solo el autor de la nota o administración/backoffice pueden editarla.
        if not _is_admin_bo_lineas(user) and (note_row[0] or "") != user.get("username"):
            raise HTTPException(403, "Solo el autor puede editar esta nota")
        r = await s.execute(text("""
            UPDATE lineas_notes
            SET texto = :txt, updated_at = :now, updated_by = :by
            WHERE id = :id
        """), {
            "txt": str(body.texto or "")[:1000],
            "now": _utcnow(),
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
        nr = await s.execute(text("SELECT autor FROM lineas_notes WHERE id = :id LIMIT 1"), {"id": note_id})
        note_row = nr.first()
        if note_row is None:
            raise HTTPException(404, "Nota no encontrada")
        # Solo el autor de la nota o administración/backoffice pueden borrarla.
        if not _is_admin_bo_lineas(user) and (note_row[0] or "") != user.get("username"):
            raise HTTPException(403, "Solo el autor puede eliminar esta nota")
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
    # Borrado irreversible: restringido a administración / backoffice.
    if not _is_admin_bo_lineas(user):
        raise HTTPException(403, "No autorizado para eliminar registros")
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
async def lineas_team_list(
    month: Optional[str] = None,   # YYYY-MM — si se pasa, filtra por ese mes
    user: dict = Depends(current_user),
):
    role     = str(user.get("role", "")).lower()
    username = str(user.get("username", ""))
    is_admin_bo   = any(r in role for r in ["admin", "backoffice", "back_office", "rol_icon", "rol_bamo", "icon", "bamo"])
    is_supervisor = "supervisor" in role

    cache_key = (f"__admin__{month}" if is_admin_bo else f"{username}__{month}") if month else ("__admin__" if is_admin_bo else username)
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"success": True, "data": cached, "count": len(cached)}

    where:  list = []
    params: dict = {}

    if is_supervisor:
        # Team del supervisor desde el JWT (poblado en login desde permisos)
        token = _team_token(user.get("team", ""))
        if token:
            where.append("""(
                UPPER(TRIM(supervisor)) LIKE :sup_like
                OR UPPER(REPLACE(supervisor, '.', ' ')) LIKE :sup_like
            )""")
            params["sup_like"] = f"{token}%"
        else:
            where.append("supervisor = '__none__'")
    elif not is_admin_bo:
        display = username.replace(".", " ").replace("_", " ").upper()
        where.append("""(agente = :ag1 OR agente_nombre = :ag1
                         OR agente = :ag2 OR agente_nombre = :ag2
                         OR agente_asignado = :ag1 OR agente_asignado = :ag2)""")
        params["ag1"] = username
        params["ag2"] = display

    # Filtro de mes si se especifica (optimiza mucho el payload)
    if month and re.match(r"^\d{4}-\d{2}$", month):
        where.append("LEFT(COALESCE(dia_venta, created_at), 7) = :month_filter")
        params["month_filter"] = month

    where_sql = ("WHERE " + " AND ".join(f"({w})" for w in where)) if where else ""

    row_limit = 10000 if is_admin_bo else 3000

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, team, supervisor, agente, agente_nombre,
                   cantidad_lineas, dia_venta, dia_instalacion, status, mercado, nombre_cliente,
                   telefono_principal, numero_cuenta, pin_seguridad, direccion,
                   telefonos, lineas_status, lines_data, servicios, imagen_url, autopago,
                   created_at
            FROM lineas_clientes
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
        await _ensure_can_modify(s, mid, user)
        pr = await s.execute(text("SELECT status FROM lineas_clientes WHERE id = :id LIMIT 1"), {"id": mid})
        prev_status = (pr.first() or [""])[0] or ""
        extra = _llamada_sets_lineas(prev_status, body.status)
        r = await s.execute(text(f"""
            UPDATE lineas_clientes
            SET status = :st, updated_at = :now{extra}
            WHERE id = :id
        """), {"st": body.status.upper(), "now": _utcnow(), "id": mid})
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
        await _ensure_can_modify(s, mid, user)
        r = await s.execute(text("""
            UPDATE lineas_clientes
            SET lineas_status = JSON_SET(COALESCE(lineas_status, '{}'),
                                         CONCAT('$.\"', :idx, '\"'), :st),
                lines_data    = JSON_SET(COALESCE(lines_data, '[]'),
                                         CONCAT('$[', :idx, '].estado'), :st),
                updated_at    = :now
            WHERE id = :id
        """), {"idx": str(idx), "st": new_status, "now": _utcnow(), "id": mid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")

    _cache_invalidate()
    return {"success": True, "message": "Estado de línea actualizado",
            "lineIndex": idx, "status": new_status}


# ── LLAMADAS DE VERIFICACIÓN / SEGUIMIENTO (líneas) ─────────────────

@router.get("/api/lineas-team/{client_id}/llamadas")
async def lineas_get_llamadas(client_id: str, user: dict = Depends(current_user)):
    """Historial de llamadas registradas de un cliente de líneas."""
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, lead_id, numero_llamada, tipo, imagen_url, nota, created_by, created_at
            FROM lead_llamadas
            WHERE lead_id = :lid AND source = 'lineas'
            ORDER BY numero_llamada ASC
        """), {"lid": str(client_id)})
        rows = [dict(row) for row in r.mappings().all()]
    for d in rows:
        if d.get("created_at"):
            d["created_at"] = str(d["created_at"])
    return {"success": True, "data": rows, "total": len(rows)}


class LlamadaLineasBody(BaseModel):
    imagen_url: str = ""
    nota:       str = ""


@router.post("/api/lineas-team/{client_id}/llamada")
async def lineas_registrar_llamada(
    client_id: str,
    body: LlamadaLineasBody,
    user: dict = Depends(current_user),
):
    """Registra una llamada de verificación/seguimiento de líneas: imagen + nota obligatorias."""
    imagen = (body.imagen_url or "").strip()
    nota   = (body.nota or "").strip()
    if not imagen:
        raise HTTPException(400, "La captura de la llamada (imagen) es obligatoria")
    if not nota:
        raise HTTPException(400, "La nota de la llamada es obligatoria")
    try:
        mid = int(client_id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    now   = _utcnow()
    autor = user.get("name") or user.get("username") or "system"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, nombre_cliente, agente, agente_nombre, agente_asignado, status,
                   COALESCE(llamadas_realizadas,0) AS lr
            FROM lineas_clientes WHERE id = :id LIMIT 1
        """), {"id": mid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Cliente no encontrado")

        if not _is_admin_bo_lineas(user):
            own = {str(row["agente"] or "").strip().lower(),
                   str(row["agente_nombre"] or "").strip().lower(),
                   str(row["agente_asignado"] or "").strip().lower()}
            me = {str(user.get("username") or "").strip().lower(),
                  str(user.get("name") or "").strip().lower()}
            if not (own & me):
                raise HTTPException(403, "Solo el dueño del cliente puede registrar la llamada")

        n_actual = int(row["lr"] or 0)
        if n_actual >= 3:
            raise HTTPException(400, "Este cliente ya tiene las 3 llamadas registradas")

        numero = n_actual + 1
        tipo   = "verificacion" if n_actual == 0 else "seguimiento"

        await s.execute(text("""
            INSERT INTO lead_llamadas (lead_id, numero_llamada, tipo, imagen_url, nota, created_by, created_at, source)
            VALUES (:lid, :num, :tipo, :img, :nota, :by, :now, 'lineas')
        """), {"lid": str(mid), "num": numero, "tipo": tipo,
               "img": imagen, "nota": nota, "by": autor, "now": now})

        # Nota también en el historial de notas de líneas
        await s.execute(text("""
            INSERT INTO lineas_notes (lead_id, texto, type, autor, created_at, updated_at)
            VALUES (:lid, :txt, 'llamada', :autor, :now, :now)
        """), {"lid": str(mid),
               "txt": f"[Llamada {numero}/3 — {tipo}] {nota}",
               "autor": autor, "now": now})

        await s.execute(text("""
            UPDATE lineas_clientes SET
              llamadas_realizadas = :num,
              fecha_ultima_llamada = :now,
              llamada_cliente = 'Completada',
              updated_at = :now
            WHERE id = :id
        """), {"num": numero, "now": now, "id": mid})
        await s.commit()

    _cache_invalidate()
    return {"success": True, "message": f"Llamada {numero}/3 registrada",
            "data": {"numero_llamada": numero, "tipo": tipo, "restantes": 3 - numero}}


# ── GET /api/lineas/team-stats ─────────────────────────────────────────────
# Devuelve ventas del mes y del día por equipo de líneas, usando los supervisores
# registrados como "Supervisor Team Lineas" en la tabla users.
@router.get("/api/lineas-equipos/stats")
async def lineas_team_stats(
    month: Optional[str] = None,   # YYYY-MM, default: mes actual
    user: dict = Depends(current_user),
):
    now = _utcnow()
    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    else:
        yr, mo = now.year, now.month

    import calendar as _cal
    _, last_day = _cal.monthrange(yr, mo)
    mes_ini = f"{yr}-{mo:02d}-01"
    mes_fin = f"{yr}-{mo:02d}-{last_day:02d}"
    hoy     = now.strftime("%Y-%m-%d")

    # Obtener supervisores de Team Lineas desde users
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT username, name, team FROM users
            WHERE LOWER(role) LIKE '%supervisor team lineas%'
               OR LOWER(role) LIKE '%supervisor%lineas%'
            ORDER BY name
        """))
        supervisors = r.mappings().all()

    # Si no hay supervisores registrados, usar los conocidos como fallback
    if not supervisors:
        sup_keys = [
            {"username": "jonathan.figueroa", "name": "TEAM LINEAS JONATHAN", "team": "TEAM LINEAS JONATHAN"},
            {"username": "luis.g",            "name": "TEAM LINEAS LUIS",     "team": "TEAM LINEAS LUIS"},
        ]
    else:
        sup_keys = [dict(s) for s in supervisors]

    teams_out = []
    for sup in sup_keys:
        sup_u    = str(sup.get("username") or "").lower()
        team_lbl = str(sup.get("team") or sup.get("name") or sup_u).upper()

        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT
                  SUM(CASE WHEN dia_venta BETWEEN :ini AND :fin THEN 1 ELSE 0 END) AS mes,
                  SUM(CASE WHEN DATE(dia_venta) = :hoy             THEN 1 ELSE 0 END) AS hoy
                FROM lineas_clientes
                WHERE (
                    LOWER(TRIM(supervisor))      = :sup
                    OR LOWER(TRIM(supervisor))   LIKE :sup_like
                )
                AND LOWER(TRIM(COALESCE(status,''))) NOT IN ('cancelled','cancelado','cancelada','cancel')
            """), {
                "ini": mes_ini, "fin": mes_fin, "hoy": hoy,
                "sup": sup_u, "sup_like": f"%{sup_u.replace('.', ' ')}%",
            })
            row = r.mappings().first()

        teams_out.append({
            "team":  team_lbl,
            "mes":   int(row["mes"]  or 0) if row else 0,
            "hoy":   int(row["hoy"]  or 0) if row else 0,
        })

    return {"success": True, "teams": teams_out, "month": f"{yr}-{mo:02d}"}
