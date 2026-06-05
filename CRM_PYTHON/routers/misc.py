from fastapi import APIRouter, Depends, Query, HTTPException
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from typing import Optional
import datetime as _dt
import re, json, calendar

router = APIRouter(tags=["Misc"])

_ADMIN_ROLES = {"admin", "administrador", "administrator", "administrativo"}
_BO_ROLES    = {"backoffice", "bo"}


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
    if not dv or not di or dv == di:
        return False
    return di == ref_ym and dv < ref_ym


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

    date_clause = ""
    params: dict = {}
    if month and year:
        _, last_day = calendar.monthrange(year, month)
        params["start"] = f"{year}-{str(month).zfill(2)}-01"
        params["end"]   = f"{year}-{str(month).zfill(2)}-{str(last_day).zfill(2)}"
        date_clause     = " AND dia_venta BETWEEN :start AND :end"

    unified_phones = []
    if use_residencial:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT id, telefono_principal, nombre_cliente, dia_venta, status
                FROM leads
                WHERE telefono_principal IS NOT NULL AND telefono_principal != ''{date_clause}
                LIMIT 5000
            """), params)
            for row in r.mappings().all():
                d = dict(row)
                d["_id"] = str(d["id"])
                d["dia_venta"] = str(d.get("dia_venta") or "")
                unified_phones.append(d)

    lineas_phones = []
    if use_lineas:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT id, telefono_principal, nombre_cliente, dia_venta, status
                FROM lineas_clientes
                WHERE telefono_principal IS NOT NULL AND telefono_principal != ''{date_clause}
                LIMIT 5000
            """), params)
            for row in r.mappings().all():
                d = dict(row)
                d["_id"] = str(d["id"])
                d["dia_venta"] = str(d.get("dia_venta") or "")
                lineas_phones.append(d)

    return {
        "success": True,
        "source":  source or "both",
        "phones":  unified_phones + lineas_phones,
    }


# ── GET /api/rankings-leads ───────────────────────────────────────
_TARGET_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


@router.get("/api/rankings-leads")
async def rankings_leads(
    targetMonth: Optional[str] = Query(None),
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    limit:       int           = Query(5000),
    user:        dict          = Depends(current_user),
):
    limit = min(limit, 10_000)
    params: dict = {"lim": limit}
    where_clauses = []
    ref_date = None

    if targetMonth and _TARGET_MONTH_RE.match(targetMonth):
        ty, tm = (int(x) for x in targetMonth.split("-"))
        _, last_day = calendar.monthrange(ty, tm)
        params["start"] = f"{targetMonth}-01"
        params["end"]   = f"{targetMonth}-{str(last_day).zfill(2)}"
        where_clauses.append("""
            status NOT REGEXP '^(cancelled|hold|rescheduled|reserva|oficina|cancelado|cancelada)$'
            AND (
              (dia_venta BETWEEN :start AND :end)
              OR (
                dia_instalacion BETWEEN :start AND :end
                AND status REGEXP '^(completed|active|pending|completado|activo|activa|vendido)$'
                AND (dia_venta IS NULL OR dia_venta < :start)
              )
            )
        """)
        next_m = tm % 12 + 1
        next_y = ty + (1 if tm == 12 else 0)
        ref_date = _dt.datetime(next_y, next_m, 1) - _dt.timedelta(days=1)
    elif fechaInicio and fechaFin:
        params["fi"] = fechaInicio
        params["ft"] = fechaFin
        params["col_start"] = fechaInicio[:7] + "-01"
        where_clauses.append("""
            (
              (dia_venta BETWEEN :fi AND :ft)
              OR (
                dia_instalacion BETWEEN :fi AND :ft
                AND (dia_venta IS NULL OR dia_venta < :col_start)
                AND status REGEXP '^(completed|active|pending|completado|activo|activa|vendido)$'
              )
            )
        """)
        try:
            ref_date = _dt.datetime.fromisoformat(fechaFin)
        except Exception:
            ref_date = _dt.datetime.utcnow()

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, agente_nombre, agente, status, dia_venta, dia_instalacion,
                   puntaje, supervisor, equipo, team, servicios, tipo_servicio
            FROM leads
            WHERE {where_sql}
            ORDER BY dia_venta DESC, created_at DESC
            LIMIT :lim
        """), params)
        rows = r.mappings().all()

    result = []
    for row in rows:
        d = dict(row)
        d["_id"] = str(d.get("id", ""))
        d["agenteNombre"] = d.get("agente_nombre", "")
        v = d.get("servicios")
        if isinstance(v, str):
            try: d["servicios"] = json.loads(v)
            except: d["servicios"] = None
        if d.get("dia_venta"):     d["dia_venta"] = str(d["dia_venta"])
        if d.get("dia_instalacion"): d["dia_instalacion"] = str(d["dia_instalacion"])
        if _is_colchon(d, ref_date):
            d["_es_colchon"] = True
        result.append(d)

    return result


# ── GET /api/customers ────────────────────────────────────────────
@router.get("/api/customers")
async def get_customers(
    page:        int            = Query(1),
    limit:       int            = Query(200),
    sortBy:      str            = Query("created_at"),
    sortOrder:   str            = Query("desc"),
    fechaInicio: Optional[str]  = Query(None),
    fechaFin:    Optional[str]  = Query(None),
    status:      Optional[str]  = Query(None),
    user:        dict           = Depends(current_user),
):
    role    = _role_lower(user)
    is_adm  = _is_adm_or_bo(role)
    is_sup  = _is_supervisor(role)
    max_lim = 10_000 if is_adm else 500
    limit   = min(limit, max_lim)
    skip    = (page - 1) * limit

    allowed_sort = {"created_at", "dia_venta", "nombre_cliente", "status", "agente_nombre"}
    sort_col = sortBy if sortBy in allowed_sort else "created_at"
    sort_dir = "ASC" if sortOrder == "asc" else "DESC"

    where = ["1=1"]
    params: dict = {"lim": limit, "off": skip}

    if fechaInicio and fechaFin:
        where.append("created_at BETWEEN :fi AND :ft")
        params["fi"] = fechaInicio
        params["ft"] = fechaFin + " 23:59:59"
    elif fechaInicio:
        where.append("created_at >= :fi")
        params["fi"] = fechaInicio
    elif fechaFin:
        where.append("created_at <= :ft")
        params["ft"] = fechaFin + " 23:59:59"

    if status:
        where.append("status = :status")
        params["status"] = _normalize_status(status)

    if not is_adm:
        cur = (user.get("username") or "").strip()
        if is_sup:
            async with AsyncSessionLocal() as s:
                r = await s.execute(text("""
                    SELECT username FROM users
                    WHERE LOWER(supervisor) LIKE :sup AND LOWER(role) NOT LIKE '%admin%'
                """), {"sup": f"%{cur.lower()}%"})
                agent_names = [row["username"] for row in r.mappings().all()]
            if agent_names:
                placeholders = ",".join([f":a{i}" for i in range(len(agent_names))])
                where.append(f"(agente_nombre IN ({placeholders}) OR agente IN ({placeholders}))")
                for i, name in enumerate(agent_names):
                    params[f"a{i}"] = name
            else:
                where.append("1=0")
        else:
            where.append("(agente_nombre = :cur OR agente = :cur)")
            params["cur"] = cur

    where_sql = " AND ".join(where)

    async with AsyncSessionLocal() as s:
        cnt_r = await s.execute(text(f"SELECT COUNT(*) as cnt FROM leads WHERE {where_sql}"), params)
        total = cnt_r.scalar()
        r = await s.execute(text(f"""
            SELECT * FROM leads WHERE {where_sql}
            ORDER BY {sort_col} {sort_dir}
            LIMIT :lim OFFSET :off
        """), params)
        customers = []
        for row in r.mappings().all():
            d = dict(row)
            d["_id"] = str(d.get("id", ""))
            d["agenteNombre"] = d.get("agente_nombre", "")
            for col in ("servicios", "telefonos"):
                v = d.get(col)
                if isinstance(v, str):
                    try: d[col] = json.loads(v)
                    except: d[col] = None
            if d.get("dia_venta"):       d["dia_venta"] = str(d["dia_venta"])
            if d.get("dia_instalacion"): d["dia_instalacion"] = str(d["dia_instalacion"])
            customers.append(d)

    return {"success": True, "data": customers, "total": total, "page": page, "limit": limit, "source": "leads"}


# ── GET /api/customers/agents-summary ────────────────────────────
@router.get("/api/customers/agents-summary")
async def customers_agents_summary(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT agente_nombre, agente, COUNT(*) as count
            FROM leads
            GROUP BY agente_nombre, agente
            ORDER BY count DESC
        """))
        rows = r.mappings().all()

    summary = [
        {"agenteNombre": row["agente_nombre"], "agenteId": None, "count": row["count"]}
        for row in rows
    ]
    names  = list({row["agente_nombre"] for row in rows if row["agente_nombre"]})
    agents = list({row["agente"] for row in rows if row["agente"]})

    return {
        "success": True,
        "summary":   summary,
        "distincts": {"agente": agents, "agenteNombre": names},
    }


# ── GET /api/supervisors-list ─────────────────────────────────────
@router.get("/api/supervisors-list")
async def supervisors_list(user: dict = Depends(current_user)):
    if not _is_admin(_role_lower(user)):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT DISTINCT username FROM users WHERE LOWER(role) LIKE '%supervisor%' ORDER BY username"
        ))
        sups = [row["username"] for row in r.mappings().all()]
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
    ts = int(_dt.datetime.utcnow().timestamp() * 1000)
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO system_settings (`key`, value, updated_by)
            VALUES ('forceLogoutBefore', :v, :by)
            ON DUPLICATE KEY UPDATE value = :v, updated_by = :by
        """), {"v": json.dumps(ts), "by": user.get("username")})
        await s.commit()
    return {"success": True, "message": "Todas las sesiones han sido cerradas", "ts": ts}


# ── POST /api/admin/cache/clear ──────────────────────────────────
@router.post("/api/admin/cache/clear")
async def clear_all_caches(user: dict = Depends(current_user)):
    if not _is_admin(_role_lower(user)):
        raise HTTPException(403, "No autorizado")
    import importlib, sys
    cleared = []
    for mod_name, attr in [
        ("routers.dashboard", "_cache"),
        ("routers.ranking",   "_cache"),
        ("routers.lineas",    "_LINEAS_CACHE"),
    ]:
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, attr):
            getattr(mod, attr).clear()
            cleared.append(f"{mod_name}.{attr}")
    return {"success": True, "cleared": cleared, "message": "Caché del servidor limpiado"}


# ── POST /api/admin/rename-att-air ────────────────────────────────
@router.post("/api/admin/rename-att-air")
async def rename_att_air(user: dict = Depends(current_user)):
    if not _is_admin(_role_lower(user)):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "UPDATE leads SET servicios = REPLACE(servicios, '\"ATT AIR\"', '\"AIR\"') "
            "WHERE servicios LIKE '%ATT AIR%'"
        ))
        await s.commit()
        modified = r.rowcount
    return {"success": True, "results": {"leads": {"matched": modified, "modified": modified}}}
