from fastapi import APIRouter, Depends, Query
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime, timezone
from typing import Optional
import unicodedata, re, time, json


def _utcnow() -> datetime:
    """UTC naive (reemplazo de datetime.utcnow() deprecado en Python 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
router = APIRouter(prefix="/api/ranking", tags=["Ranking"])

_cache: dict = {}
_CACHE_TTL = 120


def _normalize_key(v: str) -> str:
    if not v:
        return ""
    n = unicodedata.normalize("NFKD", str(v)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]", "", n).lower()


def _humanize_name(v: str) -> str:
    if not v or " " in v:
        return v
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", v).strip() or v


def _sanitize_avatar(v: str) -> str:
    if not v:
        return ""
    v = str(v).strip()
    if v.startswith("data:image/") or re.match(r"^https?://", v):
        return v
    if v.startswith("//"):
        return f"https:{v}"
    if v.startswith("/"):
        return v
    if v.lower().startswith("uploads/"):
        return f"/{v}"
    return ""


def _norm_strip(s: str) -> str:
    return re.sub(r"[ ._]", "", str(s or "")).lower()


@router.get("")
async def get_ranking(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    month:       Optional[str] = Query(None),
    year:        Optional[str] = Query(None),
    statuses:    Optional[str] = Query(None),
    agente:      Optional[str] = Query(None),
    mercado:     Optional[str] = Query(None),
    servicio:    Optional[str] = Query(None),
    limit:       Optional[int] = Query(None),
    debug:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = _utcnow()

    allowed_statuses = None
    if statuses:
        parsed = [s.strip().upper() for s in statuses.split(",") if s.strip()]
        if parsed:
            allowed_statuses = parsed

    if fechaInicio and fechaFin:
        start_date = fechaInicio
        end_date   = fechaFin
    else:
        if month and re.match(r"^\d{4}-\d{2}$", month):
            yr, mo = map(int, month.split("-"))
        elif month and year and re.match(r"^\d{4}$", year or ""):
            yr, mo = int(year), int(month)
        else:
            yr, mo = now.year, now.month
        start_date = f"{yr}-{mo:02d}-01"
        end_date   = now.strftime("%Y-%m-%d")

    hard_limit = min(int(limit) if limit else 100, 500)

    cache_key = f"{start_date}|{end_date}|{statuses}|{agente}|{mercado}|{servicio}|{hard_limit}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached["ts"] < _CACHE_TTL and debug != "1":
        return cached["response"]

    # ── SQL query ──────────────────────────────────────────────────
    # Calcular fecha exclusiva del mes siguiente para capturar todas las horas del último día
    from datetime import date as _date, timezone
    _s_date = _date.fromisoformat(start_date)
    _nm = _s_date.month + 1 if _s_date.month < 12 else 1
    _ny = _s_date.year if _s_date.month < 12 else _s_date.year + 1
    end_excl = f"{_ny}-{_nm:02d}-01"

    params: dict = {
        "s": start_date, "e": end_date, "lim": hard_limit, "end_excl": end_excl,
        "s_ym": start_date[:7], "e_ym": end_excl[:7],
    }

    where = [
        # Lead normal (dia_venta en el mes) O lead colchón (dia_instalacion en el mes, dia_venta anterior)
        """(
            (dia_venta >= :s AND dia_venta < :end_excl)
            OR (
                dia_instalacion IS NOT NULL
                AND LEFT(dia_instalacion,7) >= :s_ym
                AND LEFT(dia_instalacion,7) < :e_ym
                AND (dia_venta IS NULL OR LEFT(dia_venta,7) < :s_ym)
            )
        )""",
        "(agente_nombre IS NOT NULL AND agente_nombre != '') OR (agente IS NOT NULL AND agente != '')",
        "excluir_de_reporte = FALSE OR excluir_de_reporte IS NULL",
        """UPPER(TRIM(COALESCE(status,''))) IN (
            'PENDING','PENDIENTE','PENDIENTES',
            'COMPLETED','ACTIVE','COMPLETADO','ACTIVO','ACTIVA','VENDIDO','CERRADO','CERRADA','VENTA CERRADA',
            'RESERVA'
        )""",
    ]

    if agente:
        where.append("(LOWER(agente_nombre) LIKE :ag OR LOWER(agente) LIKE :ag)")
        params["ag"] = f"%{agente.lower()}%"

    if mercado:
        where.append("UPPER(TRIM(COALESCE(mercado,''))) = :mercado")
        params["mercado"] = mercado.strip().upper()

    if servicio:
        # Busca en tipo_servicio o dentro del campo servicios (JSON array guardado como texto)
        where.append("(UPPER(COALESCE(tipo_servicio,'')) LIKE :svc OR UPPER(COALESCE(servicios,'')) LIKE :svc)")
        params["svc"] = f"%{servicio.strip().upper()}%"

    where_sql = " AND ".join(f"({w})" for w in where)

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT
                    agente                                          AS agente_key,
                    COALESCE(agente_nombre, agente)                AS agente_fuente,
                    UPPER(TRIM(COALESCE(status, '')))              AS status_u,
                    COALESCE(puntaje, 0)                           AS puntaje,
                    dia_venta, dia_instalacion,
                    numero_cuenta, telefono_principal, nombre_cliente
                FROM leads
                WHERE {where_sql}
                ORDER BY dia_venta DESC, created_at DESC
            """), params)
            rows = r.mappings().all()
    except Exception as exc:
        import logging
        logging.getLogger("ranking").error("query error: %s", exc)
        rows = []

    # ── Aggregate in Python ────────────────────────────────────────
    # Agrupa por agente (username), separa ventas normales de colchón
    s_ym = start_date[:7]   # e.g. "2026-06"

    agg: dict = {}
    for row in rows:
        agente_key  = str(row["agente_key"] or "")
        agente_raw  = str(row["agente_fuente"] or agente_key)
        status_u    = str(row["status_u"] or "")
        puntaje_val = float(row["puntaje"] or 0)
        is_cancel   = "CANCEL" in status_u

        dv   = str(row["dia_venta"] or "")[:7]
        dinst = str(row["dia_instalacion"] or "")[:7]
        # Lead colchón: dia_instalacion en el mes Y dia_venta en mes anterior
        is_colchon = bool(dinst and dinst == s_ym and (not dv or dv < s_ym))
        # Lead completed/active para "activas"
        is_active_status = any(t in status_u for t in ("COMPLET", "ACTIV", "VENDIDO", "CERRADO"))

        # Usar agente (username) como clave de agrupación
        key = _norm_strip(agente_key) if agente_key else _norm_strip(agente_raw)
        if not key:
            continue

        # Optional: filter by allowed statuses
        if allowed_statuses:
            status_norm = (
                "CANCEL"    if "CANCEL"   in status_u else
                "COMPLETED" if "COMPLET"  in status_u else
                "ACTIVE"    if "ACTIVE"   in status_u else
                "PENDING"   if ("PENDIENT" in status_u or "PENDING" in status_u) else
                status_u
            )
            if status_norm not in allowed_statuses:
                continue

        if key not in agg:
            agg[key] = {
                "nombreOriginal": agente_raw,
                "nombreNormalizado": key,
                "agente_username": agente_key,
                "ventas": 0,
                "colchon": 0,
                "activas": 0,
                "sumPuntaje": 0.0,
                "sumPuntajeVentas": 0.0,
                "sumPuntajeColchon": 0.0,
                "sigs": set(),
            }
        entry = agg[key]
        if is_colchon:
            entry["colchon"] += 1
            entry["sumPuntaje"] += puntaje_val
            entry["sumPuntajeColchon"] += puntaje_val
            if is_active_status:
                entry["activas"] += 1
        elif not is_cancel:
            entry["ventas"] += 1
            entry["sumPuntaje"] += puntaje_val
            entry["sumPuntajeVentas"] += puntaje_val
            if is_active_status:
                entry["activas"] += 1
        # Preferir nombre de display más largo
        if len(agente_raw) > len(entry["nombreOriginal"]):
            entry["nombreOriginal"] = agente_raw

    # ── Enrich with user data ──────────────────────────────────────
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT id, username, name, email, aliases, avatar_url, role,
                       COALESCE(team, supervisor, '') AS team
                FROM users
            """))
            users_rows = r.mappings().all()
    except Exception:
        users_rows = []

    user_map: dict = {}
    for u in users_rows:
        aliases = u.get("aliases")
        if isinstance(aliases, str):
            try: aliases = json.loads(aliases)
            except (ValueError, TypeError): aliases = []
        for val in [u.get("username"), u.get("name"), (u.get("email") or "").split("@")[0]]:
            k = _normalize_key(val)
            if k and k not in user_map:
                user_map[k] = dict(u)
        for alias in (aliases or []):
            k = _normalize_key(alias)
            if k and k not in user_map:
                user_map[k] = dict(u)

    def build_avatar(u_doc):
        if not u_doc:
            return {"url": None, "fileId": None, "updatedAt": None}
        raw = u_doc.get("avatar_url") or ""
        url = _sanitize_avatar(str(raw))
        return {"url": url or None, "fileId": None, "updatedAt": None}

    sorted_agg = sorted(agg.values(), key=lambda x: (-x["sumPuntaje"], -x["ventas"]))
    if len(sorted_agg) > hard_limit:
        sorted_agg = sorted_agg[:hard_limit]

    ranking_data = []
    for i, item in enumerate(sorted_agg):
        raw_name   = item["nombreOriginal"]
        norm_key   = item["nombreNormalizado"]
        username   = item.get("agente_username", "")
        candidates = [_normalize_key(username), norm_key, _normalize_key(raw_name)]
        matched_user = next((user_map[c] for c in candidates if c and c in user_map), None)

        avatar_info  = build_avatar(matched_user)
        display_name = (
            (matched_user or {}).get("name")
            or (matched_user or {}).get("username")
            or _humanize_name(raw_name)
            or "—"
        )
        ventas         = int(item["ventas"])
        colchon        = int(item["colchon"])
        activas        = int(item["activas"])
        puntos         = float(item["sumPuntaje"])
        puntos_ventas  = float(item["sumPuntajeVentas"])
        puntos_colchon = float(item["sumPuntajeColchon"])
        total          = ventas + colchon

        ranking_data.append({
            "nombre":           display_name,
            "nombreOriginal":   raw_name,
            "nombreLimpio":     _humanize_name(raw_name),
            "nombreNormalizado": norm_key,
            "username":         (matched_user or {}).get("username"),
            "userId":           str(matched_user["id"]) if matched_user else None,
            "team":             str((matched_user or {}).get("team") or ""),
            "avatarUrl":        avatar_info["url"],
            "imageUrl":         avatar_info["url"],
            "ventas":           ventas,
            "colchon":          colchon,
            "activas":          activas,
            "total":            total,
            "puntos":           puntos,
            "puntos_ventas":    puntos_ventas,
            "puntos_colchon":   puntos_colchon,
            "sumPuntaje":       puntos,
            "avgPuntaje":       puntos / total if total > 0 else 0,
            "promedio":         puntos / total if total > 0 else 0,
            "position":         i + 1,
            "signatures":       None,
        })

    # Ordenar por puntos de ventas normales (sin colchón) — el frontend re-ordena si activa colchón
    ranking_data.sort(key=lambda x: (-x["puntos_ventas"], -x["ventas"], x["nombre"]))
    for i, row in enumerate(ranking_data):
        row["position"] = i + 1

    response = {
        "success": True,
        "message": "Datos de ranking obtenidos",
        "ranking": ranking_data,
        "data":    {"ranking": ranking_data},
        "meta": {
            "count":       len(ranking_data),
            "dateRange":   {"startDate": start_date, "endDate": end_date},
            "collectionUsed": "leads",
        },
    }
    _cache[cache_key] = {"ts": time.time(), "response": response}
    return response


@router.get("/instalaciones-dia")
async def instalaciones_dia(
    fecha: Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    """Instalaciones del día: total de leads con dia_instalacion = fecha
    y cuántos ya tienen status activo/completed. Para el KPI 'Activas del Día'."""
    if fecha and re.match(r"^\d{4}-\d{2}-\d{2}$", fecha):
        f = fecha
    else:
        f = _utcnow().strftime("%Y-%m-%d")

    total = 0
    completadas = 0
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE
                        WHEN UPPER(COALESCE(status,'')) LIKE '%COMPLET%'
                          OR UPPER(COALESCE(status,'')) LIKE '%ACTIV%'
                          OR UPPER(COALESCE(status,'')) LIKE '%VENDIDO%'
                          OR UPPER(COALESCE(status,'')) LIKE '%CERRAD%'
                        THEN 1 ELSE 0 END), 0) AS completadas
                FROM leads
                WHERE LEFT(dia_instalacion, 10) = :f
                  AND (excluir_de_reporte = FALSE OR excluir_de_reporte IS NULL)
            """), {"f": f})
            row = r.mappings().first()
            if row:
                total = int(row["total"] or 0)
                completadas = int(row["completadas"] or 0)
    except Exception as exc:
        import logging
        logging.getLogger("ranking").error("instalaciones-dia query error: %s", exc)

    return {
        "success": True,
        "fecha": f,
        "total": total,
        "completadas": completadas,
        "pendientes": max(total - completadas, 0),
    }


@router.get("/init")
async def ranking_init(
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    all:         Optional[str] = Query(None),
    limit:       int           = Query(500),
    user: dict = Depends(current_user),
):
    """Endpoint combinado: ranking + media en una sola llamada."""
    from datetime import date as _date, timezone
    # Fechas por defecto: mes actual
    now = datetime.now()
    fi = fechaInicio or f"{now.year}-{now.month:02d}-01"
    last_day = (datetime(now.year, now.month % 12 + 1, 1) - __import__('datetime').timedelta(days=1)).day if now.month < 12 else 31
    ff = fechaFin or f"{now.year}-{now.month:02d}-{last_day:02d}"

    # Reutilizar el endpoint de ranking existente
    ranking_resp = await get_ranking(
        fechaInicio=fi, fechaFin=ff,
        statuses=None, agente=None,
        limit=limit, debug=None,
        user=user
    )

    # Obtener última media de marketing
    media_data = None
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT id, filename, original_name, content_type, file_type, file_path, uploaded_at
                FROM note_files
                WHERE file_type IN ('image','video')
                  AND (original_name LIKE '%marketing%' OR file_path LIKE '%marketing%'
                       OR original_name LIKE '%promo%' OR file_path LIKE '%promo%')
                ORDER BY uploaded_at DESC
                LIMIT 1
            """))
            row = r.mappings().first()
            if row:
                fp = row["file_path"] or ""
                url = fp if fp.startswith("/") else f"/{fp}"
                media_data = {
                    "id":           row["id"],
                    "url":          url,
                    "content_type": row["content_type"],
                    "file_type":    row["file_type"],
                    "filename":     row["original_name"] or row["filename"],
                    "uploaded_at":  str(row["uploaded_at"]),
                }
    except Exception:
        pass

    return {
        "success": True,
        "ranking": ranking_resp.get("ranking", []),
        "media":   media_data,
        "meta":    ranking_resp.get("meta", {}),
    }
