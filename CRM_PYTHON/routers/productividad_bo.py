"""Productividad Back Office — cambios de status por usuario.

Agrega los registros de status_change_log (ver notifications.py) por actor y
status destino, para la página /residencial/productividad-bo.html. Solo
admin/backoffice pueden consultarlo.
"""
import datetime as _dt
import os
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user

router = APIRouter(prefix="/api/productividad-bo", tags=["Productividad BO"])

# Los timestamps (created_at, fecha_completed) se guardan en UTC pero el "día"
# operativo del CRM es hora local (El Salvador, UTC-6, sin DST). Configurable
# por si el equipo se muda de huso horario.
_TZ_OFFSET_H = int(os.getenv("CRM_TZ_OFFSET_HOURS", "-6"))


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().strip()


def _is_admin_or_bo(user: dict) -> bool:
    r = _normalize(user.get("role", ""))
    return (
        "admin" in r or "backoffice" in r
        or "rol_icon" in r or "rol_bamo" in r
        or r == "icon" or r == "bamo"
    )


# Bucket de cada status destino (los valores reales en BD mezclan idiomas y mayúsculas)
def _bucket(status: str) -> str:
    s = _normalize(status)
    if s in ("completed", "complete", "active", "activo", "activa", "activado"):
        return "activas"
    if s.startswith("cancel"):          # cancelled / canceled / cancelado…
        return "cancel"
    if "hold" in s:
        return "hold"
    if s in ("pending", "pendiente"):
        return "pending"
    if s.startswith("repro") or s.startswith("resched") or "reagend" in s:
        return "repro"
    if s == "reserva":
        return "reserva"
    if s == "oficina":
        return "oficina"
    return "otros"


_BUCKETS = ("activas", "cancel", "hold", "pending", "repro", "reserva", "oficina", "otros")


def _parse_date(v: str, name: str) -> _dt.date:
    try:
        return _dt.date.fromisoformat(str(v).strip())
    except (TypeError, ValueError):
        raise HTTPException(400, f"{name} inválida (formato YYYY-MM-DD)")


@router.get("")
async def productividad_bo(
    start: str = Query(..., description="Fecha inicio YYYY-MM-DD (inclusive)"),
    end: str = Query(..., description="Fecha fin YYYY-MM-DD (inclusive)"),
    seccion: Optional[str] = Query(None, description="residencial | lineas (vacío = todas)"),
    user: dict = Depends(current_user),
):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    d_start = _parse_date(start, "start")
    d_end = _parse_date(end, "end")
    if d_end < d_start:
        raise HTTPException(400, "end debe ser >= start")

    # Límites del rango en UTC: medianoche local = medianoche - offset en UTC
    where = ["created_at >= :ini", "created_at < :fin", "COALESCE(actor,'') <> ''"]
    _off = _dt.timedelta(hours=_TZ_OFFSET_H)
    params = {"ini": _dt.datetime.combine(d_start, _dt.time.min) - _off,
              "fin": _dt.datetime.combine(d_end + _dt.timedelta(days=1), _dt.time.min) - _off}
    sec = _normalize(seccion or "")
    if sec in ("residencial", "lineas"):
        where.append("seccion = :sec")
        params["sec"] = sec

    # Instaladas del período → "25/45": el numerador es el MISMO dato que la
    # columna ACTIVAS (cambios a completed/active hechos en el día, cualquier
    # fecha de instalación); el denominador, las instalaciones programadas del
    # día (excluye canceladas).
    inst_params = {"ds": str(d_start), "de": str(d_end)}
    inst_sql = """
        SELECT COUNT(*) AS total
        FROM {tabla}
        WHERE dia_instalacion BETWEEN :ds AND :de
          AND LOWER(COALESCE(status,'')) NOT LIKE '%cancel%'
    """
    inst_total = 0

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT actor, new_status, COUNT(*) AS n
            FROM status_change_log
            WHERE {' AND '.join(where)}
            GROUP BY actor, new_status
        """), params)
        raw = r.mappings().all()

        tablas = []
        if sec in ("", "residencial", "todas"):
            tablas.append("leads")
        if sec in ("", "lineas", "todas"):
            tablas.append("lineas_clientes")
        for t in tablas:
            ri = await s.execute(text(inst_sql.format(tabla=t)), inst_params)
            row = ri.mappings().first() or {}
            inst_total += int(row.get("total") or 0)

    # Agrupar por actor (normalizado: 'lucia.ferman' ≈ 'Lucia Ferman')
    por_actor: dict[str, dict] = {}
    for row in raw:
        actor = str(row["actor"] or "").strip()
        key = _normalize(actor).replace(".", " ").replace("_", " ")
        item = por_actor.setdefault(key, {"usuario": actor, **{b: 0 for b in _BUCKETS}, "total": 0})
        # Preferir el nombre "bonito" (con espacios/mayúsculas) como etiqueta
        if " " in actor and " " not in item["usuario"]:
            item["usuario"] = actor
        n = int(row["n"] or 0)
        item[_bucket(row["new_status"])] += n
        item["total"] += n

    rows = sorted(por_actor.values(), key=lambda x: -x["total"])
    totales = {b: sum(r[b] for r in rows) for b in _BUCKETS}
    totales["total"] = sum(r["total"] for r in rows)

    return {
        "success": True,
        "start": str(d_start),
        "end": str(d_end),
        "seccion": sec or "todas",
        "rows": rows,
        "totales": totales,
        "instaladas": {"completed": totales["activas"], "total": inst_total},
    }
