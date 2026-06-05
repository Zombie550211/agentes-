from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, require_roles
from datetime import datetime
from typing import Optional, List, Any, Dict
import re, unicodedata, time, json, calendar, traceback, asyncio
from geocoder import geocode_and_save

router = APIRouter(tags=["Leads"])


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().strip()


def _is_admin_or_bo(user: dict) -> bool:
    r = _normalize(user.get("role", ""))
    return (
        "admin" in r or "backoffice" in r
        or "rol_icon" in r or "rol_bamo" in r
        or r == "icon" or r == "bamo"
    )


def _is_supervisor(user: dict) -> bool:
    return "supervisor" in _normalize(user.get("role", ""))


def _is_agent(user: dict) -> bool:
    return not _is_admin_or_bo(user) and not _is_supervisor(user)


def _mercado_restrict(user: dict) -> str:
    r = _normalize(user.get("role", ""))
    if "rol_bamo" in r or r == "bamo":
        return "BAMO"
    return ""


def _serialize_lead(row) -> dict:
    d = dict(row)
    d["_id"] = str(d.get("id", ""))
    d["id"]  = d["_id"]
    d["agenteNombre"] = d.get("agente_nombre", "")
    for col in ("servicios", "telefonos", "notas"):
        v = d.get(col)
        if isinstance(v, str):
            try: d[col] = json.loads(v)
            except: d[col] = [] if col == "notas" else None
        elif v is None and col == "notas":
            d[col] = []
    if d.get("dia_venta"):        d["dia_venta"]        = str(d["dia_venta"])
    if d.get("dia_instalacion"):  d["dia_instalacion"]  = str(d["dia_instalacion"])
    if d.get("fecha_contratacion"): d["fecha_contratacion"] = str(d["fecha_contratacion"])
    if d.get("created_at"):       d["createdAt"] = str(d["created_at"])
    if d.get("updated_at"):       d["updatedAt"] = str(d["updated_at"])
    return d


def _find_id(s: str) -> tuple[Optional[int], Optional[str]]:
    """Return (mysql_int_id, mongo_id_str) from an arbitrary ID string."""
    try:
        return int(s), None
    except (ValueError, TypeError):
        return None, s


# ── GET /api/leads/months ──────────────────────────────────────────
@router.get("/api/leads/months")
async def leads_months(
    limit: int = Query(60),
    user: dict = Depends(current_user),
):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT DISTINCT
              CASE
                WHEN dia_venta IS NOT NULL THEN DATE_FORMAT(dia_venta, '%Y-%m')
                ELSE DATE_FORMAT(created_at, '%Y-%m')
              END AS ym
            FROM leads
            WHERE dia_venta IS NOT NULL OR created_at IS NOT NULL
            HAVING ym IS NOT NULL AND ym REGEXP '^[0-9]{4}-[0-9]{2}$'
            ORDER BY ym DESC
            LIMIT :lim
        """), {"lim": limit})
        months = [row["ym"] for row in r.mappings().all()]
    return {"success": True, "data": months, "months": months, "source": "leads", "count": len(months)}


# ── GET /api/leads/bootstrap ──────────────────────────────────────
# Una sola llamada que devuelve leads + teams + agents + months en paralelo
@router.get("/api/leads/bootstrap")
async def leads_bootstrap(
    month:       Optional[str] = Query(None),
    year:        Optional[str] = Query(None),
    noAutoMonth: Optional[str] = Query(None),
    allData:     Optional[str] = Query(None),
    limit:       int           = Query(5000),
    user: dict = Depends(current_user),
):
    async def _get_leads():
        where = ["1=1"]
        params: dict = {}
        mercado_restrict = _mercado_restrict(user)
        if mercado_restrict:
            where.append("UPPER(TRIM(COALESCE(mercado,''))) = :mer")
            params["mer"] = mercado_restrict
        if _is_agent(user):
            username = user.get("username", "")
            if username:
                where.append("(agente_nombre = :u OR agente = :u OR created_by = :u)")
                params["u"] = username
        disable_auto = str(noAutoMonth or "").lower() in ("1", "true")
        is_global    = str(allData or "").lower() in ("true", "1")
        if not is_global and not disable_auto:
            now = datetime.utcnow()
            if month and re.match(r"^\d{4}-\d{2}$", month):
                yr, mo = map(int, month.split("-"))
            else:
                yr, mo = now.year, now.month
            dts = f"{yr}-{mo:02d}-01"
            _, last_day = calendar.monthrange(yr, mo)
            dte = f"{yr}-{mo:02d}-{last_day:02d}"
            where.append("dia_venta >= :dts AND dia_venta < :dte_excl")
            import calendar as _c2
            _nm2 = mo + 1 if mo < 12 else 1
            _ny2 = yr if mo < 12 else yr + 1
            params["dte_excl"] = f"{_ny2}-{_nm2:02d}-01"
            params["dts"] = dts
            params["dte"] = dte
        params["_lim"] = min(int(limit), 20000)
        where_sql = " AND ".join(where)
        count_params = {k: v for k, v in params.items() if k != "_lim"}
        async with AsyncSessionLocal() as s:
            rc = await s.execute(text(f"SELECT COUNT(*) AS total FROM leads WHERE {where_sql}"), count_params)
            total_mes = int(rc.scalar() or 0)
            r = await s.execute(text(f"SELECT * FROM leads WHERE {where_sql} ORDER BY created_at DESC LIMIT :_lim"), params)
            return [_serialize_lead(row) for row in r.mappings().all()], total_mes

    async def _get_teams():
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("SELECT DISTINCT team FROM users WHERE team IS NOT NULL AND team != '' ORDER BY team"))
            return [row["team"] for row in r.mappings().all()]

    async def _get_agents():
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("SELECT id, username, name, role, team, supervisor FROM users ORDER BY name"))
            return [dict(row) for row in r.mappings().all()]

    async def _get_months():
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT DISTINCT
                  CASE WHEN dia_venta IS NOT NULL THEN DATE_FORMAT(dia_venta,'%Y-%m')
                       ELSE DATE_FORMAT(created_at,'%Y-%m') END AS ym
                FROM leads
                WHERE dia_venta IS NOT NULL OR created_at IS NOT NULL
                HAVING ym IS NOT NULL AND ym REGEXP '^[0-9]{4}-[0-9]{2}$'
                ORDER BY ym DESC LIMIT 120
            """))
            return [row["ym"] for row in r.mappings().all()]

    async def _get_renames():
        try:
            async with AsyncSessionLocal() as s:
                r = await s.execute(text("""
                    SELECT old_name, new_name,
                           DATE_FORMAT(changed_at, '%Y-%m-%d') AS changed_at
                    FROM team_renames ORDER BY changed_at ASC
                """))
                return [dict(row) for row in r.mappings().all()]
        except Exception:
            return []

    async def _get_lineas_stats():
        try:
            now = datetime.utcnow()  # noqa
            if month and re.match(r"^\d{4}-\d{2}$", month):
                yr, mo = map(int, month.split("-"))
            else:
                yr, mo = now.year, now.month
            _, last_day = calendar.monthrange(yr, mo)
            mes_ini = f"{yr}-{mo:02d}-01"
            mes_fin = f"{yr}-{mo:02d}-{last_day:02d}"
            hoy     = now.strftime("%Y-%m-%d")

            # Agrupar por supervisor directamente desde lineas_clientes
            async with AsyncSessionLocal() as s:
                r = await s.execute(text("""
                    SELECT
                      UPPER(TRIM(COALESCE(supervisor, 'SIN SUPERVISOR'))) AS sup,
                      SUM(CASE WHEN dia_venta BETWEEN :ini AND :fin THEN 1 ELSE 0 END) AS mes,
                      SUM(CASE WHEN DATE(dia_venta) = :hoy THEN 1 ELSE 0 END)          AS hoy
                    FROM lineas_clientes
                    WHERE LOWER(TRIM(COALESCE(status,''))) NOT IN
                          ('cancelled','cancelado','cancelada','cancel')
                    GROUP BY sup
                    ORDER BY mes DESC
                """), {"ini": mes_ini, "fin": mes_fin, "hoy": hoy})
                rows = r.mappings().all()

            # Mapear supervisorKey → nombre de equipo
            sup_map = {
                "JONATHAN F": "TEAM LINEAS JONATHAN",
                "JONATHAN":   "TEAM LINEAS JONATHAN",
                "LUIS G":     "TEAM LINEAS LUIS",
                "LUIS":       "TEAM LINEAS LUIS",
            }
            teams: dict = {}
            for row in rows:
                sup_raw = str(row["sup"] or "").strip().upper()
                team_lbl = sup_map.get(sup_raw, sup_raw)
                if team_lbl not in teams:
                    teams[team_lbl] = {"team": team_lbl, "mes": 0, "hoy": 0}
                teams[team_lbl]["mes"] += int(row["mes"] or 0)
                teams[team_lbl]["hoy"] += int(row["hoy"] or 0)

            return sorted(teams.values(), key=lambda x: -x["mes"])
        except Exception as _le:
            import traceback as _tb
            print(f"[lineas_stats ERROR] {_le}\n{_tb.format_exc()}")
            return []

    (leads, total_mes), teams, agents, months, renames, lineas_stats = await asyncio.gather(
        _get_leads(), _get_teams(), _get_agents(), _get_months(), _get_renames(), _get_lineas_stats()
    )
    return {"success": True, "v": "v2", "leads": leads, "total_mes": total_mes,
            "teams": teams, "agents": agents,
            "months": months, "renames": renames, "lineas_stats": lineas_stats}


@router.get("/api/leads/collection-counts-public")
async def leads_collection_counts_public():
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT COUNT(*) as cnt FROM leads"))
        total = r.scalar()
    return {"success": True, "data": {"leads": total}}


@router.get("/api/leads/collection-counts")
async def leads_collection_counts(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT COUNT(*) as cnt FROM leads"))
        total = r.scalar()
    return {"success": True, "data": {"leads": total}}


# ── GET /api/leads/agents-summary ─────────────────────────────────
@router.get("/api/leads/agents-summary")
async def leads_agents_summary(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = datetime.utcnow()
    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    end   = fechaFin   or now.strftime("%Y-%m-%d")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT
              COALESCE(agente_nombre, agente) AS _agente,
              COUNT(*) AS total,
              SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'COMPLET|ACTIVE' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'CANCEL' THEN 1 ELSE 0 END) AS cancelled,
              SUM(COALESCE(puntaje, 0)) AS puntaje
            FROM leads
            WHERE dia_venta BETWEEN :s AND :e
              AND COALESCE(agente_nombre, agente) IS NOT NULL
            GROUP BY COALESCE(agente_nombre, agente)
            ORDER BY total DESC
            LIMIT 200
        """), {"s": start, "e": end})
        rows = [dict(row) for row in r.mappings().all()]
    return {"success": True, "data": rows}


# ── GET /api/leads/kpis ───────────────────────────────────────────
@router.get("/api/leads/kpis")
async def leads_kpis(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = datetime.utcnow()
    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    end   = fechaFin   or now.strftime("%Y-%m-%d")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'COMPLET|ACTIVE' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'CANCEL' THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'PENDING|PENDIENTE' THEN 1 ELSE 0 END) AS `pending`,
              SUM(COALESCE(puntaje, 0)) AS puntajeTotal
            FROM leads
            WHERE dia_venta BETWEEN :s AND :e
        """), {"s": start, "e": end})
        row = r.mappings().first()
    kpi = dict(row) if row else {"total": 0, "completed": 0, "cancelled": 0, "pending": 0, "puntajeTotal": 0}
    kpi.pop("_id", None)
    return {"success": True, "data": kpi}


# ── POST /api/leads ───────────────────────────────────────────────
class LeadCreateBody(BaseModel):
    nombre_cliente:     str = ""
    telefono_principal: str = ""
    telefono_2:         str = ""
    direccion:          str = ""
    zip_code:           str = ""
    servicios:          Any = ""
    tipo_servicio:      str = ""
    numero_cuenta:      str = ""
    mercado:            str = ""
    motivo_llamada:     str = ""
    status:             str = "PENDING"
    autopago:           str = ""
    sistema:            str = ""
    riesgo:             str = ""
    comentario:         str = ""
    imagen_url:         str = ""
    puntaje:            str = ""
    dia_venta:          str = ""
    dia_instalacion:    str = ""
    supervisor:         str = ""
    agente:             str = ""
    creadoEn:           Optional[str] = None


def _parse_date_str(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


@router.post("/api/leads")
async def create_lead(body: LeadCreateBody, user: dict = Depends(current_user)):
    now = datetime.utcnow()
    # Auto-asignar supervisor/team desde el perfil del agente si no viene en el body
    if not body.supervisor:
        if _is_supervisor(user):
            # El propio supervisor crea el lead → él ES el supervisor del lead
            sup_val = (user.get("name") or "").strip() or (user.get("username") or "").strip()
        else:
            sup_val = (user.get("supervisor") or "").strip() or (user.get("supervisorKey") or "").strip()
        body = body.model_copy(update={"supervisor": sup_val})
    servicios_json = json.dumps(
        body.servicios if isinstance(body.servicios, list) else ([body.servicios] if body.servicios else [])
    )
    try:
        puntaje_val = float(body.puntaje) if body.puntaje else 0.0
    except ValueError:
        puntaje_val = 0.0

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO leads
              (nombre_cliente, telefono_principal, telefono, telefono_alterno, direccion, zip_code, servicios,
               tipo_servicio, numero_cuenta, mercado, motivo_llamada, status,
               autopago, sistema, riesgo,
               puntaje, dia_venta, dia_instalacion, supervisor, agente, agente_nombre,
               imagen_url, source_collection, created_by, created_at, updated_at)
            VALUES
              (:nc, :tp, :t2, :talt, :dir, :zip, :srv,
               :ts, :nc2, :mer, :ml, :st,
               :ap, :sis, :rie,
               :pts, :dv, :di, :sup, :ag, :agn,
               :img, 'leads', :by, :now, :now)
        """), {
            "nc":   body.nombre_cliente,
            "tp":   body.telefono_principal,
            "t2":   body.telefono_2,
            "talt": getattr(body, "telefono_alterno", "") or body.telefono_2 or "",
            "dir":  body.direccion,
            "zip": body.zip_code,
            "srv": servicios_json,
            "ts":  body.tipo_servicio,
            "nc2": body.numero_cuenta,
            "mer": body.mercado,
            "ml":  body.motivo_llamada,
            "st":  body.status,
            "ap":  1 if str(body.autopago or "").lower() in ("si","sí","yes","true","1") else (0 if str(body.autopago or "").lower() in ("no","false","0") else None),
            "sis": body.sistema or None,
            "rie": body.riesgo or None,
            "pts": puntaje_val,
            "dv":  _parse_date_str(body.dia_venta),
            "di":  _parse_date_str(body.dia_instalacion),
            "sup": body.supervisor or "",
            "ag":  body.agente or user.get("username", ""),
            "agn": body.agente or user.get("username", ""),
            "img": body.imagen_url or None,
            "by":  user.get("username", ""),
            "now": now,
        })
        await s.commit()
        new_id = r.lastrowid

    # Geocodificar en background — no bloquea la respuesta
    if body.direccion and body.direccion.strip():
        asyncio.create_task(geocode_and_save(new_id, body.direccion))

    return {"success": True, "message": "Lead guardado exitosamente", "id": str(new_id)}


# ── GET /api/leads ────────────────────────────────────────────────
@router.get("/api/leads")
async def list_leads(
    fechaInicio:        Optional[str] = Query(None),
    fechaFin:           Optional[str] = Query(None),
    status:             Optional[str] = Query(None),
    month:              Optional[str] = Query(None),
    allData:            Optional[str] = Query(None),
    noFilter:           Optional[str] = Query(None),
    skipDate:           Optional[str] = Query(None),
    noAutoMonth:        Optional[str] = Query(None),
    agentName:          Optional[str] = Query(None),
    agents:             Optional[str] = Query(None),
    vendedor:           Optional[str] = Query(None),
    telefono:           Optional[str] = Query(None),
    telefono_principal: Optional[str] = Query(None),
    nombre_cliente:     Optional[str] = Query(None),
    direccion:          Optional[str] = Query(None),
    year:               Optional[str] = Query(None),
    limit:              int           = Query(5000),
    user: dict = Depends(current_user),
):
    where = ["1=1"]
    params: dict = {}

    # Text search filters
    tel_val = str(telefono_principal or telefono or "").strip()
    if tel_val:
        where.append("(telefono_principal LIKE :tel OR telefono LIKE :tel)")
        params["tel"] = f"%{tel_val}%"

    if nombre_cliente:
        where.append("nombre_cliente LIKE :nc")
        params["nc"] = f"%{nombre_cliente}%"

    if direccion:
        where.append("direccion LIKE :dir")
        params["dir"] = f"%{direccion}%"

    # Mercado restriction
    mercado_restrict = _mercado_restrict(user)
    if mercado_restrict:
        where.append("UPPER(TRIM(COALESCE(mercado,''))) = :mer")
        params["mer"] = mercado_restrict

    # Status filter
    if status and status.lower() != "todos":
        where.append("status = :status")
        params["status"] = status

    # Role-based agent filter
    if _is_supervisor(user):
        agent_filter = str(agentName or vendedor or "").strip()
        if agent_filter:
            where.append("(agente_nombre LIKE :af OR agente LIKE :af)")
            params["af"] = f"%{agent_filter}%"
    elif _is_agent(user):
        username = user.get("username", "")
        if username:
            where.append("(agente_nombre = :u OR agente = :u OR created_by = :u)")
            params["u"] = username

    # Date filter
    disable_auto = str(noAutoMonth or "").lower() in ("1", "true")
    is_global = any(str(v or "").lower() in ("true", "1") for v in [allData, noFilter, skipDate])
    if not is_global and not disable_auto and not fechaInicio and not fechaFin:
        now = datetime.utcnow()
        if month and re.match(r"^\d{4}-\d{2}$", month):
            yr, mo = map(int, month.split("-"))
        elif month and year and re.match(r"^\d{4}$", year or ""):
            yr, mo = int(year), int(month)
        else:
            yr, mo = now.year, now.month
        fechaInicio = f"{yr}-{mo:02d}-01"
        _, last_day = calendar.monthrange(yr, mo)
        fechaFin = f"{yr}-{mo:02d}-{last_day:02d}"

    if fechaInicio or fechaFin:
        s = fechaInicio or "2000-01-01"
        e = fechaFin   or "2099-12-31"
        where.append("""(
            (dia_venta BETWEEN :dts AND :dte)
            OR (dia_instalacion IS NOT NULL AND LEFT(dia_instalacion,7)=LEFT(:dts,7) AND (dia_venta IS NULL OR LEFT(dia_venta,7)<LEFT(:dts,7)))
            OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :dts AND :dte)
        )""")
        params["dts"] = s
        params["dte"] = e

    where_sql = " AND ".join(where)

    try:
        async with AsyncSessionLocal() as s:
            params["_lim"] = min(int(limit), 20000)
            r = await s.execute(text(f"""
                SELECT * FROM leads WHERE {where_sql}
                ORDER BY created_at DESC LIMIT :_lim
            """), params)
            leads = [_serialize_lead(row) for row in r.mappings().all()]
    except Exception as exc:
        import logging
        logging.getLogger("leads").error("list_leads error: %s", exc)
        leads = []

    return {"success": True, "data": leads, "queryUsed": {"where": where_sql}}


# ── LEADS STATS ────────────────────────────────────────────────────
@router.get("/api/estadisticas/leads-dashboard")
async def leads_dashboard(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = datetime.utcnow()
    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    end   = fechaFin   or now.strftime("%Y-%m-%d")
    p = {"s": start, "e": end}

    async with AsyncSessionLocal() as s:
        by_status = await s.execute(text("""
            SELECT UPPER(TRIM(COALESCE(status,''))) AS status_u, COUNT(*) AS count
            FROM leads WHERE dia_venta BETWEEN :s AND :e
            GROUP BY status_u ORDER BY count DESC
        """), p)
        by_mercado = await s.execute(text("""
            SELECT UPPER(COALESCE(mercado,'SIN MERCADO')) AS mercado_u, COUNT(*) AS count
            FROM leads WHERE dia_venta BETWEEN :s AND :e
            GROUP BY mercado_u ORDER BY count DESC
        """), p)
        totals_r = await s.execute(text("""
            SELECT COUNT(*) AS total,
              SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'COMPLET|ACTIVE' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'CANCEL' THEN 1 ELSE 0 END) AS cancelled,
              SUM(COALESCE(puntaje, 0)) AS puntaje
            FROM leads WHERE dia_venta BETWEEN :s AND :e
        """), p)
        totals = dict(totals_r.mappings().first() or {})
        totals.pop("_id", None)

    return {"success": True, "data": {
        "byStatus":  [dict(r) for r in by_status.mappings().all()],
        "byMercado": [dict(r) for r in by_mercado.mappings().all()],
        "totals":    totals,
        "dateRange": {"start": start, "end": end},
    }}


# ── SEMAFORO ───────────────────────────────────────────────────────
@router.get("/api/semaforo")
async def semaforo(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    statuses:    Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = datetime.utcnow()
    start = fechaInicio or datetime(now.year, now.month, 1).strftime("%Y-%m-%d")
    end   = fechaFin   or now.strftime("%Y-%m-%d")

    status_clause = ""
    params: dict = {"s": start, "e": end}
    if statuses:
        parsed = [x.strip().upper() for x in statuses.split(",") if x.strip()]
        if parsed:
            phs = ",".join([f":st{i}" for i in range(len(parsed))])
            status_clause = f"AND UPPER(TRIM(COALESCE(status,''))) IN ({phs})"
            for i, v in enumerate(parsed):
                params[f"st{i}"] = v

    async with AsyncSessionLocal() as s:
        try:
            r = await s.execute(text(f"""
                SELECT
                  COALESCE(agente_nombre, agente) AS agente_fuente,
                  SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) REGEXP 'CANCEL' THEN 0 ELSE 1 END) AS ventas,
                  SUM(CASE WHEN UPPER(TRIM(COALESCE(status,''))) NOT REGEXP 'CANCEL'
                      THEN COALESCE(puntaje,0) ELSE 0 END) AS sum_puntaje
                FROM leads
                WHERE (
                    (dia_venta BETWEEN :s AND :e AND (dia_instalacion IS NULL OR LEFT(dia_instalacion,7)=LEFT(dia_venta,7)))
                    OR (dia_instalacion IS NOT NULL AND LEFT(dia_instalacion,7)=LEFT(:s,7) AND (dia_venta IS NULL OR LEFT(dia_venta,7)<LEFT(:s,7)))
                    OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :s AND :e)
                )
                  AND (agente_nombre IS NOT NULL OR agente IS NOT NULL)
                  AND (excluir_de_reporte IS NULL OR excluir_de_reporte = FALSE)
                  {status_clause}
                GROUP BY COALESCE(agente_nombre, agente)
                ORDER BY sum_puntaje DESC, ventas DESC
            """), params)
            rows = [{"agente": row["agente_fuente"], "ventas": row["ventas"], "puntaje": float(row["sum_puntaje"] or 0)}
                    for row in r.mappings().all()]
        except Exception:
            rows = []

    return {"success": True, "data": rows, "dateRange": {"start": start, "end": end}}


# ── COMISIONES ─────────────────────────────────────────────────────
@router.get("/api/comisiones/agents")
async def comisiones_agents(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    year:        Optional[str] = Query(None),
    debug:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = datetime.utcnow()
    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    elif month and year and re.match(r"^\d{4}$", year or ""):
        yr, mo = int(year), int(month)
    else:
        yr, mo = now.year, now.month

    start = fechaInicio or f"{yr}-{mo:02d}-01"
    is_current = (now.year == yr and now.month == mo)
    end_of_month = f"{yr}-{mo:02d}-{calendar.monthrange(yr, mo)[1]:02d}"
    end = fechaFin or (now.strftime("%Y-%m-%d") if is_current else end_of_month)

    async with AsyncSessionLocal() as s:
        try:
            r = await s.execute(text("""
                SELECT
                  COALESCE(agente_nombre, agente) AS nombre,
                  COUNT(*) AS ventas,
                  SUM(COALESCE(puntaje, 0)) AS puntos
                FROM leads
                WHERE dia_venta BETWEEN :s AND :e
                  AND LOWER(TRIM(COALESCE(status,'')))
                      REGEXP 'completed|completado|complete|active|activo|activa'
                  AND (agente_nombre IS NOT NULL OR agente IS NOT NULL)
                GROUP BY COALESCE(agente_nombre, agente)
                ORDER BY puntos DESC, ventas DESC
                LIMIT 500
            """), {"s": start, "e": end})
            rows = [dict(row) for row in r.mappings().all()]
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
    now = datetime.utcnow()
    if month and re.match(r"^\d{4}-\d{2}$", month):
        yr, mo = map(int, month.split("-"))
    elif month and year and re.match(r"^\d{4}$", year or ""):
        yr, mo = int(year), int(month)
    else:
        yr, mo = now.year, now.month

    start = f"{yr}-{mo:02d}-01"
    end   = f"{yr}-{mo:02d}-{calendar.monthrange(yr, mo)[1]:02d}"

    async with AsyncSessionLocal() as s:
        try:
            r = await s.execute(text("""
                SELECT
                  COALESCE(agente_nombre, agente) AS nombre,
                  COUNT(*) AS ventas,
                  SUM(COALESCE(puntaje, 0)) AS puntos
                FROM lineas_clientes
                WHERE dia_venta BETWEEN :s AND :e
                GROUP BY COALESCE(agente_nombre, agente)
                ORDER BY puntos DESC, ventas DESC
            """), {"s": start, "e": end})
            rows = [dict(row) for row in r.mappings().all()]
        except Exception:
            rows = []

    return {"success": True, "data": rows}


# ── LEADS-LINEAS ───────────────────────────────────────────────────
@router.get("/api/leads-lineas")
async def leads_lineas(
    month:   Optional[str] = Query(None),
    year:    Optional[str] = Query(None),
    allData: Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    role     = str(user.get("role", "")).lower()
    username = user.get("username", "")
    is_privileged = any(r in role for r in ["admin", "backoffice", "supervisor"])
    full_export   = allData in ("true", "1", "yes") and is_privileged

    # Mes por defecto: mes actual si no se especifica
    target_month = month
    if not target_month:
        now = datetime.utcnow()
        if year and re.match(r"^\d{4}$", year):
            target_month = f"{year}-{now.month:02d}"
        else:
            target_month = now.strftime("%Y-%m")

    where = ["1=1"]
    params: dict = {}

    # Filtro de agente para no-privilegiados
    if not is_privileged:
        display = username.replace(".", " ").replace("_", " ").upper()
        where.append("(agente = :u OR agente_nombre = :u OR agente = :d OR agente_nombre = :d)")
        params["u"] = username
        params["d"] = display

    # Filtro de mes en MySQL — incluye mes actual + mes anterior (para colchón)
    if not full_export and target_month and re.match(r"^\d{4}-\d{2}$", target_month):
        yr, mo = map(int, target_month.split("-"))
        _, last_day = calendar.monthrange(yr, mo)
        prev_mo = mo - 1 if mo > 1 else 12
        prev_yr = yr if mo > 1 else yr - 1
        dts = f"{prev_yr}-{prev_mo:02d}-01"   # inicio del mes anterior
        dte = f"{yr}-{mo:02d}-{last_day:02d}"  # fin del mes actual
        where.append("""(
            (dia_venta IS NOT NULL AND dia_venta BETWEEN :dts AND :dte)
            OR (dia_venta IS NULL AND dia_instalacion IS NOT NULL AND dia_instalacion BETWEEN :dts AND :dte)
            OR (dia_venta IS NULL AND dia_instalacion IS NULL AND DATE(created_at) BETWEEN :dts AND :dte)
        )""")
        params["dts"] = dts
        params["dte"] = dte

    limit_clause = "" if full_export else "LIMIT 3000"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT *, collection_name AS _collection
            FROM lineas_clientes
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            {limit_clause}
        """), params)
        leads = []
        for row in r.mappings().all():
            d = dict(row)
            d["_id"] = str(d.get("id", ""))
            for col in ("servicios", "telefonos", "lineas_status", "lines_data"):
                v = d.get(col)
                if isinstance(v, str):
                    try: d[col] = json.loads(v)
                    except: d[col] = None
            if d.get("dia_venta"): d["dia_venta"] = str(d["dia_venta"])
            leads.append(d)

    cap = len(leads) if full_export else 3000
    return {"success": True, "data": leads[:cap], "count": len(leads),
            "month": target_month,
            "meta": {"total": len(leads), "returned": min(len(leads), cap), "month": target_month}}


# ── SINGLE LEAD CRUD ───────────────────────────────────────────────
@router.get("/api/leads/{lead_id}")
async def get_lead(lead_id: str, user: dict = Depends(current_user)):
    mysql_id, mongo_id = _find_id(lead_id)
    async with AsyncSessionLocal() as s:
        if mysql_id:
            r = await s.execute(text("SELECT * FROM leads WHERE id = :id LIMIT 1"), {"id": mysql_id})
        else:
            r = await s.execute(text("SELECT * FROM leads WHERE mongo_id = :mid LIMIT 1"), {"mid": mongo_id})
        row = r.mappings().first()
    if not row:
        raise HTTPException(404, "Lead no encontrado")
    doc = _serialize_lead(row)
    return {"success": True, "data": doc, "lead": doc, "foundInCollection": "leads"}


class UpdateStatusBody(BaseModel):
    status: str


@router.put("/api/leads/{lead_id}/status")
async def update_lead_status(
    lead_id: str,
    body: UpdateStatusBody,
    user: dict = Depends(current_user),
):
    if not (_is_admin_or_bo(user) or _is_supervisor(user)):
        raise HTTPException(403, "No autorizado")
    if not body.status:
        raise HTTPException(400, "status requerido")
    mysql_id, mongo_id = _find_id(lead_id)
    async with AsyncSessionLocal() as s:
        if mysql_id:
            r = await s.execute(text(
                "UPDATE leads SET status = :st WHERE id = :id"
            ), {"st": body.status, "id": mysql_id})
        else:
            r = await s.execute(text(
                "UPDATE leads SET status = :st WHERE mongo_id = :mid"
            ), {"st": body.status, "mid": mongo_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Lead no encontrado")
    return {"success": True, "message": "Status actualizado", "data": {"id": lead_id, "status": body.status}}


class UpdateLeadBody(BaseModel):
    model_config = {"extra": "allow"}

    nombre_cliente:     Optional[str] = None
    telefono_principal: Optional[str] = None
    telefono:           Optional[str] = None
    telefono_alterno:   Optional[str] = None
    numero_cuenta:      Optional[str] = None
    direccion:          Optional[str] = None
    zip_code:           Optional[str] = None
    autopago:           Optional[str] = None
    riesgo:             Optional[str] = None
    tipo_servicio:      Optional[str] = None
    sistema:            Optional[str] = None
    mercado:            Optional[str] = None
    servicios:          Optional[Any] = None
    dia_venta:          Optional[str] = None
    dia_instalacion:    Optional[str] = None
    puntaje:            Optional[Any] = None
    status:             Optional[str] = None
    supervisor:         Optional[str] = None
    agente:             Optional[str] = None
    agenteNombre:       Optional[str] = None
    motivo_llamada:     Optional[str] = None
    nota:               Optional[str] = None
    notas:              Optional[Any] = None
    imagen_url:         Optional[str] = None
    was_reserva:        Optional[bool] = None


_LEAD_COL_MAP = {
    "nombre_cliente":     "nombre_cliente",
    "telefono_principal": "telefono_principal",
    "telefono":           "telefono",
    "telefono_alterno":   "telefono_alterno",
    "numero_cuenta":      "numero_cuenta",
    "direccion":          "direccion",
    "zip_code":           "zip_code",
    "tipo_servicio":      "tipo_servicio",
    "mercado":            "mercado",
    "status":             "status",
    "supervisor":         "supervisor",
    "agente":             "agente",
    "agenteNombre":       "agente_nombre",
    "motivo_llamada":     "motivo_llamada",
    "nota":               "nota",
    "imagen_url":         "imagen_url",
    "was_reserva":        "was_reserva",
    "sistema":            "sistema",
    "riesgo":             "riesgo",
}


@router.put("/api/leads/{lead_id}")
async def update_lead(
    lead_id: str,
    body: UpdateLeadBody,
    user: dict = Depends(current_user),
):
    if not (_is_admin_or_bo(user) or _is_supervisor(user) or _is_agent(user)):
        raise HTTPException(403, "No autorizado")
    data = body.model_dump(exclude_none=True)
    # No sobreescribir con strings vacíos — solo procesar campos con valor real
    data = {k: v for k, v in data.items() if v != "" and v is not None}
    if not data:
        raise HTTPException(400, "Sin campos para actualizar")

    sets = []
    params: dict = {"now": datetime.utcnow(), "by": user.get("username", "system")}

    for field, col in _LEAD_COL_MAP.items():
        if field in data:
            sets.append(f"{col} = :{field}")
            params[field] = data[field]

    # Special handling
    if "autopago" in data:
        v = str(data["autopago"] or "").lower().strip()
        if v in ("si", "sí", "yes", "true", "1"):
            sets.append("autopago = :autopago_val")
            params["autopago_val"] = 1
        elif v in ("no", "false", "0"):
            sets.append("autopago = :autopago_val")
            params["autopago_val"] = 0
    if "servicios" in data:
        v = data["servicios"]
        sets.append("servicios = :servicios_json")
        params["servicios_json"] = json.dumps(v) if isinstance(v, list) else json.dumps([v]) if v else "[]"
    if "dia_venta" in data:
        sets.append("dia_venta = :dv_parsed")
        params["dv_parsed"] = _parse_date_str(data["dia_venta"])
    if "dia_instalacion" in data:
        sets.append("dia_instalacion = :di_parsed")
        params["di_parsed"] = _parse_date_str(data["dia_instalacion"])
    if "puntaje" in data:
        try: params["puntaje_val"] = float(data["puntaje"])
        except: params["puntaje_val"] = 0.0
        sets.append("puntaje = :puntaje_val")
    if "notas" in data:
        v = data["notas"]
        sets.append("notas = :notas_json")
        params["notas_json"] = json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else (v or "[]")

    if not sets:
        raise HTTPException(400, "Sin campos válidos para actualizar")

    sets.append("updated_at = :now")
    sets.append("updated_by = :by")

    mysql_id, mongo_id = _find_id(lead_id)
    if mysql_id:
        params["id"] = mysql_id
        where = "id = :id"
    else:
        params["mid"] = mongo_id
        where = "mongo_id = :mid"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"UPDATE leads SET {', '.join(sets)} WHERE {where}"), params)
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Lead no encontrado")

    return {"success": True, "message": "Lead actualizado"}


@router.delete("/api/leads/{lead_id}")
async def delete_lead(lead_id: str, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    mysql_id, mongo_id = _find_id(lead_id)
    async with AsyncSessionLocal() as s:
        if mysql_id:
            r = await s.execute(text("DELETE FROM leads WHERE id = :id"), {"id": mysql_id})
        else:
            r = await s.execute(text("DELETE FROM leads WHERE mongo_id = :mid"), {"mid": mongo_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Lead no encontrado")
    return {"success": True, "message": "Lead eliminado"}


# ── DEBUG ──────────────────────────────────────────────────────────
@router.get("/api/debug/search-lead/{lead_id}")
async def debug_search_lead(lead_id: str, user: dict = Depends(current_user)):
    mysql_id, mongo_id = _find_id(lead_id)
    async with AsyncSessionLocal() as s:
        if mysql_id:
            r = await s.execute(text("SELECT * FROM leads WHERE id = :id LIMIT 1"), {"id": mysql_id})
        else:
            r = await s.execute(text("SELECT * FROM leads WHERE mongo_id = :mid LIMIT 1"), {"mid": mongo_id})
        row = r.mappings().first()
    if row:
        d = dict(row)
        return {"success": True, "found": True, "collection": "leads",
                "document": {"_id": str(d["id"]), "nombre_cliente": d.get("nombre_cliente"),
                             "status": d.get("status"), "agente": d.get("agente")}}
    return {"success": False, "found": False, "message": "Lead no encontrado", "id": lead_id}


# ── LINEAS-TEAM (duplicate routes from lineas.py for compatibility) ─
@router.get("/api/lineas-team")
async def get_lineas_team(
    month:      Optional[str] = Query(None),
    status:     Optional[str] = Query(None),
    supervisor: Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    role     = str(user.get("role", "")).lower()
    username = user.get("username", "")
    is_admin_bo  = any(r in role for r in ["admin", "backoffice"])
    is_supervisor = "supervisor" in role

    where = ["1=1"]
    params: dict = {}
    if not is_admin_bo and not is_supervisor:
        display = username.replace(".", " ").replace("_", " ").upper()
        where.append("(agente = :u OR agente_nombre = :u OR agente = :d OR agente_nombre = :d)")
        params["u"] = username
        params["d"] = display

    if status:
        where.append("LOWER(status) = :st")
        params["st"] = status.lower()

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT *, collection_name AS _collection
            FROM lineas_clientes WHERE {' AND '.join(where)}
            ORDER BY created_at DESC LIMIT 2000
        """), params)
        leads = []
        for row in r.mappings().all():
            d = dict(row)
            d["_id"] = str(d.get("id", ""))
            for col in ("servicios", "telefonos", "lineas_status", "lines_data"):
                v = d.get(col)
                if isinstance(v, str):
                    try: d[col] = json.loads(v)
                    except: d[col] = None
            if d.get("dia_venta"): d["dia_venta"] = str(d["dia_venta"])
            leads.append(d)

    return {"success": True, "data": leads, "count": len(leads)}


class LineasTeamStatusBody(BaseModel):
    id: str
    status: str
    collectionName: Optional[str] = None


@router.put("/api/lineas-team/status")
async def update_lineas_team_status(body: LineasTeamStatusBody, user: dict = Depends(current_user)):
    if not body.id or not body.status:
        raise HTTPException(400, "id y status requeridos")
    mysql_id, mongo_id = _find_id(body.id)
    async with AsyncSessionLocal() as s:
        if mysql_id:
            r = await s.execute(text(
                "UPDATE lineas_clientes SET status = :st, updated_at = :now WHERE id = :id"
            ), {"st": body.status, "now": datetime.utcnow(), "id": mysql_id})
        else:
            r = await s.execute(text(
                "UPDATE lineas_clientes SET status = :st, updated_at = :now WHERE mongo_id = :mid"
            ), {"st": body.status, "now": datetime.utcnow(), "mid": mongo_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")
    return {"success": True, "message": "Status actualizado"}


class LineasLineStatusBody(BaseModel):
    id: str
    lineIndex: int
    lineStatus: str
    collectionName: Optional[str] = None


@router.put("/api/lineas-team/line-status")
async def update_lineas_team_line_status(body: LineasLineStatusBody, user: dict = Depends(current_user)):
    if not body.id:
        raise HTTPException(400, "id requerido")
    mysql_id, mongo_id = _find_id(body.id)
    new_status = body.lineStatus.upper()
    idx = int(body.lineIndex)
    async with AsyncSessionLocal() as s:
        if mysql_id:
            r = await s.execute(text(
                "UPDATE lineas_clientes SET "
                "lineas_status = JSON_SET(COALESCE(lineas_status,'{}'), CONCAT('$.\"', :idx, '\"'), :st), "
                "lines_data = JSON_SET(COALESCE(lines_data,'[]'), CONCAT('$[', :idx, '].estado'), :st), "
                "updated_at = :now WHERE id = :id"
            ), {"idx": str(idx), "st": new_status, "now": datetime.utcnow(), "id": mysql_id})
        else:
            r = await s.execute(text(
                "UPDATE lineas_clientes SET "
                "lineas_status = JSON_SET(COALESCE(lineas_status,'{}'), CONCAT('$.\"', :idx, '\"'), :st), "
                "lines_data = JSON_SET(COALESCE(lines_data,'[]'), CONCAT('$[', :idx, '].estado'), :st), "
                "updated_at = :now WHERE mongo_id = :mid"
            ), {"idx": str(idx), "st": new_status, "now": datetime.utcnow(), "mid": mongo_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Registro no encontrado")
    return {"success": True, "message": "Estado de línea actualizado"}


@router.get("/api/lineas-team/collections")
async def get_lineas_team_collections(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT DISTINCT collection_name FROM lineas_clientes WHERE collection_name IS NOT NULL"
        ))
        cols = [row["collection_name"] for row in r.mappings().all()]
    return {"success": True, "collections": cols}


# ── POST /api/crm_agente ────────────────────────────────────────────
@router.post("/api/crm_agente")
async def crm_agente(raw_request: Request, user: dict = Depends(current_user)):
    try:
        request_data = await raw_request.json()
    except Exception:
        request_data = {}

    target_agent = str(
        request_data.get("agenteAsignado") or request_data.get("agente") or ""
    ).replace("_", " ").strip()
    if not target_agent:
        raise HTTPException(400, "Se requiere agente o agenteAsignado")

    # Find agent in users table
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT username, supervisor FROM users
            WHERE LOWER(username) = LOWER(:ag) OR LOWER(name) = LOWER(:ag)
            LIMIT 1
        """), {"ag": target_agent})
        agent_row = r.mappings().first()

    if not agent_row:
        raise HTTPException(404, "Agente no encontrado en el sistema")

    agent_username  = agent_row["username"]
    agent_supervisor = agent_row.get("supervisor") or ""
    col_name = f"costumers_{agent_username.replace('.','_').replace(' ','_')}"
    now = datetime.utcnow()
    servicios = request_data.get("servicios")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO leads
              (nombre_cliente, telefono_principal, status, agente, agente_nombre,
               servicios, mercado, supervisor, source_collection, created_by, created_at, updated_at)
            VALUES
              (:nc, :tp, :st, :ag, :agn, :srv, :mer, :sup, :src, :by, :now, :now)
        """), {
            "nc":  request_data.get("nombre_cliente", ""),
            "tp":  request_data.get("telefono_principal", ""),
            "st":  request_data.get("status", "pending"),
            "ag":  agent_username,
            "agn": agent_username,
            "srv": json.dumps(servicios) if isinstance(servicios, list) else json.dumps([servicios] if servicios else []),
            "mer": request_data.get("mercado", ""),
            "sup": agent_supervisor,
            "src": col_name,
            "by":  user.get("username"),
            "now": now,
        })
        await s.commit()
        new_id = r.lastrowid

    return {"success": True, "message": f"Lead guardado en {col_name}",
            "id": str(new_id), "collection": col_name}
