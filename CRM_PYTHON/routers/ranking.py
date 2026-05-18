from fastapi import APIRouter, Depends, Query
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime
from typing import Optional
import unicodedata, re, time, json

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
    limit:       Optional[int] = Query(None),
    debug:       Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    now = datetime.utcnow()

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

    cache_key = f"{start_date}|{end_date}|{statuses}|{agente}|{hard_limit}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached["ts"] < _CACHE_TTL and debug != "1":
        return cached["response"]

    # ── SQL query ──────────────────────────────────────────────────
    where = [
        "dia_venta BETWEEN :s AND :e OR (created_at BETWEEN :s AND :e AND dia_venta IS NULL)",
        "(agente_nombre IS NOT NULL AND agente_nombre != '') OR (agente IS NOT NULL AND agente != '')",
        "excluir_de_reporte = FALSE OR excluir_de_reporte IS NULL",
        "UPPER(TRIM(COALESCE(status,''))) NOT REGEXP 'RESERVA'",
    ]
    params: dict = {"s": start_date, "e": end_date, "lim": hard_limit}

    if agente:
        where.append("(LOWER(agente_nombre) LIKE :ag OR LOWER(agente) LIKE :ag)")
        params["ag"] = f"%{agente.lower()}%"

    where_sql = " AND ".join(f"({w})" for w in where)

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT
                    COALESCE(agente_nombre, agente)             AS agente_fuente,
                    UPPER(TRIM(COALESCE(status, '')))           AS status_u,
                    COALESCE(puntaje, 0)                        AS puntaje,
                    numero_cuenta, telefono_principal, nombre_cliente, dia_venta
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
    agg: dict = {}
    for row in rows:
        agente_raw  = str(row["agente_fuente"] or "")
        status_u    = str(row["status_u"] or "")
        puntaje_val = float(row["puntaje"] or 0)
        is_cancel   = "CANCEL" in status_u

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

        key = _norm_strip(agente_raw)
        if not key:
            continue
        if key not in agg:
            agg[key] = {
                "nombreOriginal": agente_raw,
                "nombreNormalizado": key,
                "ventas": 0,
                "sumPuntaje": 0.0,
                "sigs": set(),
            }
        entry = agg[key]
        if not is_cancel:
            entry["ventas"] += 1
            entry["sumPuntaje"] += puntaje_val
        # Keep original name (prefer non-empty longer)
        if len(agente_raw) > len(entry["nombreOriginal"]):
            entry["nombreOriginal"] = agente_raw

    # ── Enrich with user data ──────────────────────────────────────
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT id, username, name, email, aliases, avatar_url, role
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
            except: aliases = []
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
        candidates = [norm_key, _normalize_key(raw_name)]
        matched_user = next((user_map[c] for c in candidates if c and c in user_map), None)

        avatar_info  = build_avatar(matched_user)
        display_name = (
            (matched_user or {}).get("name")
            or (matched_user or {}).get("username")
            or _humanize_name(raw_name)
            or "—"
        )
        ventas  = int(item["ventas"])
        puntos  = float(item["sumPuntaje"])

        ranking_data.append({
            "nombre":           display_name,
            "nombreOriginal":   raw_name,
            "nombreLimpio":     _humanize_name(raw_name),
            "nombreNormalizado": norm_key,
            "username":         (matched_user or {}).get("username"),
            "userId":           str(matched_user["id"]) if matched_user else None,
            "avatarUrl":        avatar_info["url"],
            "imageUrl":         avatar_info["url"],
            "ventas":           ventas,
            "puntos":           puntos,
            "sumPuntaje":       puntos,
            "avgPuntaje":       puntos / ventas if ventas > 0 else 0,
            "promedio":         puntos / ventas if ventas > 0 else 0,
            "position":         i + 1,
            "signatures":       None,
        })

    ranking_data.sort(key=lambda x: (-x["puntos"], -x["ventas"], x["nombre"]))
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
