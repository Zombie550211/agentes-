"""Productividad B.O — cambios de status por usuario en un día.

Cuenta, para la fecha (día local UTC-6), cuántos cambios de status hizo cada
usuario, desglosado por status destino. Fuente: tabla activities
(activity_type='Cambio de estado', description 'Estado → X').
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import text
from database_mysql import AsyncSessionLocal
from deps import current_user
import re

router = APIRouter(prefix="/api/productividad-bo", tags=["Productividad BO"])

# Offset del huso local respecto a UTC (El Salvador = UTC-6, sin horario de verano)
_LOCAL_OFFSET_HOURS = 6

# Orden preferido de columnas; el resto se agrega alfabético después
_STATUS_ORDER = ["COMPLETED", "CANCELLED", "HOLD", "PENDING"]
_STATUS_LABEL = {
    "COMPLETED": "Completed",
    "CANCELLED": "Cancelled",
    "HOLD":      "Hold",
    "PENDING":   "Pending",
}


def _local_today() -> str:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    from datetime import timedelta
    return (now - timedelta(hours=_LOCAL_OFFSET_HOURS)).strftime("%Y-%m-%d")


def _norm_status(desc: str) -> Optional[str]:
    if not desc or "→" not in desc:
        return None
    st = desc.split("→", 1)[1].strip().upper()
    st = re.sub(r"[^A-ZÁÉÍÓÚÑ ]", "", st).strip()
    return st or None


@router.get("")
async def productividad_bo(
    fecha: Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    f = fecha if (fecha and re.match(r"^\d{4}-\d{2}-\d{2}$", fecha)) else _local_today()

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT a.actor_username AS actor, a.actor_role AS rol, a.description AS descr
                FROM activities a
                WHERE a.activity_type = 'Cambio de estado'
                  AND DATE(a.timestamp - INTERVAL :off HOUR) = :f
            """), {"off": _LOCAL_OFFSET_HOURS, "f": f})
            rows = r.mappings().all()

            # nombres reales para enriquecer
            ur = await s.execute(text("SELECT username, name, role FROM users"))
            name_by_user = {}
            for u in ur.mappings().all():
                if u["username"]:
                    name_by_user[u["username"].strip().lower()] = (u.get("name") or "", u.get("role") or "")
    except Exception as exc:
        import logging
        logging.getLogger("productividad_bo").error("query error: %s", exc)
        rows, name_by_user = [], {}

    # Agregar por actor y status
    agg: dict = {}
    statuses_present: set = set()
    for row in rows:
        actor = (row["actor"] or "Sistema").strip()
        st = _norm_status(row["descr"])
        if not st:
            continue
        statuses_present.add(st)
        if actor not in agg:
            info = name_by_user.get(actor.lower(), ("", row["rol"] or ""))
            agg[actor] = {
                "agente": actor,
                "nombre": info[0] or "",
                "rol": (row["rol"] or info[1] or ""),
                "counts": {},
                "total": 0,
            }
        agg[actor]["counts"][st] = agg[actor]["counts"].get(st, 0) + 1
        agg[actor]["total"] += 1

    # Orden de columnas: preferidas primero, luego el resto alfabético
    extras = sorted(s for s in statuses_present if s not in _STATUS_ORDER)
    ordered = [s for s in _STATUS_ORDER if s in statuses_present] + extras
    columns = [{"key": s, "label": _STATUS_LABEL.get(s, s.title())} for s in ordered]

    # Filas ordenadas por total desc
    filas = sorted(agg.values(), key=lambda x: (-x["total"], x["agente"].lower()))

    totales = {s: 0 for s in ordered}
    for fr in filas:
        for s in ordered:
            totales[s] += fr["counts"].get(s, 0)
    total_general = sum(totales.values())

    # ── Instalaciones del día ──────────────────────────────────────
    # instalan_hoy  = ventas cuya fecha de instalación (programada) es 'f'
    # instaladas_hoy = ventas que se COMPLETARON ese día (completed = instalada),
    #                  contadas como clientes únicos, sin importar su fecha
    #                  programada (una venta completada hoy = instalada hoy).
    instalan_hoy = 0
    instaladas_hoy = 0
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT COUNT(*) FROM leads
                WHERE LEFT(dia_instalacion, 10) = :f
                  AND (excluir_de_reporte = FALSE OR excluir_de_reporte IS NULL)
            """), {"f": f})
            instalan_hoy = int((r.first() or [0])[0] or 0)

            r2 = await s.execute(text("""
                SELECT COUNT(DISTINCT lead_client_name) FROM activities
                WHERE activity_type = 'Cambio de estado'
                  AND UPPER(description) LIKE '%COMPLETED%'
                  AND DATE(timestamp - INTERVAL :off HOUR) = :f
            """), {"off": _LOCAL_OFFSET_HOURS, "f": f})
            instaladas_hoy = int((r2.first() or [0])[0] or 0)
    except Exception:
        pass

    return {
        "success": True,
        "fecha": f,
        "columns": columns,
        "rows": filas,
        "totales": totales,
        "total_general": total_general,
        "agentes": len(filas),
        "instalan_hoy": instalan_hoy,
        "instaladas_hoy": instaladas_hoy,
    }
