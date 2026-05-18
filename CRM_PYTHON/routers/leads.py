from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, require_roles
from datetime import datetime
from typing import Optional, List, Any, Dict
import re, unicodedata, time, json, calendar

router = APIRouter(tags=["Leads"])


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().strip()


def _is_admin_or_bo(user: dict) -> bool:
    r = _normalize(user.get("role", ""))
    return "admin" in r or "backoffice" in r or "rol_icon" in r


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
    for col in ("servicios", "telefonos"):
        v = d.get(col)
        if isinstance(v, str):
            try: d[col] = json.loads(v)
            except: d[col] = None
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
              (nombre_cliente, telefono_principal, telefono, direccion, zip_code, servicios,
               tipo_servicio, numero_cuenta, mercado, motivo_llamada, status,
               puntaje, dia_venta, dia_instalacion, supervisor, agente, agente_nombre,
               source_collection, created_by, created_at, updated_at)
            VALUES
              (:nc, :tp, :t2, :dir, :zip, :srv,
               :ts, :nc2, :mer, :ml, :st,
               :pts, :dv, :di, :sup, :ag, :agn,
               'leads', :by, :now, :now)
        """), {
            "nc":  body.nombre_cliente,
            "tp":  body.telefono_principal,
            "t2":  body.telefono_2,
            "dir": body.direccion,
            "zip": body.zip_code,
            "srv": servicios_json,
            "ts":  body.tipo_servicio,
            "nc2": body.numero_cuenta,
            "mer": body.mercado,
            "ml":  body.motivo_llamada,
            "st":  body.status,
            "pts": puntaje_val,
            "dv":  _parse_date_str(body.dia_venta),
            "di":  _parse_date_str(body.dia_instalacion),
            "sup": body.supervisor or user.get("supervisor", ""),
            "ag":  body.agente or user.get("username", ""),
            "agn": body.agente or user.get("username", ""),
            "by":  user.get("username", ""),
            "now": now,
        })
        await s.commit()
        new_id = r.lastrowid

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
        where.append("(dia_venta BETWEEN :dts AND :dte OR (created_at BETWEEN :dts AND :dte AND dia_venta IS NULL))")
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
                WHERE dia_venta BETWEEN :s AND :e
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

    where = ["1=1"]
    params: dict = {}
    if not is_privileged:
        display = username.replace(".", " ").replace("_", " ").upper()
        where.append("(agente = :u OR agente_nombre = :u OR agente = :d OR agente_nombre = :d)")
        params["u"] = username
        params["d"] = display

    limit_clause = "" if full_export else "LIMIT 1000"

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

    cap = len(leads) if full_export else 1000
    return {"success": True, "data": leads[:cap], "count": len(leads),
            "meta": {"total": len(leads), "returned": min(len(leads), cap)}}


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
    user: dict = Depends(require_roles("Administrador", "Backoffice", "admin", "administrador", "backoffice")),
):
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
    "was_reserva":        "was_reserva",
}


@router.put("/api/leads/{lead_id}")
async def update_lead(
    lead_id: str,
    body: UpdateLeadBody,
    user: dict = Depends(require_roles(
        "Administrador", "Backoffice", "Supervisor", "Agente",
        "admin", "administrador", "backoffice", "supervisor", "agente",
    )),
):
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(400, "Sin campos para actualizar")

    sets = []
    params: dict = {"now": datetime.utcnow(), "by": user.get("username", "system")}

    for field, col in _LEAD_COL_MAP.items():
        if field in data:
            sets.append(f"{col} = :{field}")
            params[field] = data[field]

    # Special handling
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
            SELECT username FROM users
            WHERE LOWER(username) = LOWER(:ag) OR LOWER(name) = LOWER(:ag)
            LIMIT 1
        """), {"ag": target_agent})
        agent_row = r.mappings().first()

    if not agent_row:
        raise HTTPException(404, "Agente no encontrado en el sistema")

    agent_username = agent_row["username"]
    col_name = f"costumers_{agent_username.replace('.','_').replace(' ','_')}"
    now = datetime.utcnow()
    servicios = request_data.get("servicios")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO leads
              (nombre_cliente, telefono_principal, status, agente, agente_nombre,
               servicios, mercado, source_collection, created_by, created_at, updated_at)
            VALUES
              (:nc, :tp, :st, :ag, :agn, :srv, :mer, :src, :by, :now, :now)
        """), {
            "nc":  request_data.get("nombre_cliente", ""),
            "tp":  request_data.get("telefono_principal", ""),
            "st":  request_data.get("status", "pending"),
            "ag":  agent_username,
            "agn": agent_username,
            "srv": json.dumps(servicios) if isinstance(servicios, list) else json.dumps([servicios] if servicios else []),
            "mer": request_data.get("mercado", ""),
            "src": col_name,
            "by":  user.get("username"),
            "now": now,
        })
        await s.commit()
        new_id = r.lastrowid

    return {"success": True, "message": f"Lead guardado en {col_name}",
            "id": str(new_id), "collection": col_name}
