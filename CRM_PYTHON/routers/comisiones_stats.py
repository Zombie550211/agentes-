"""Agregados mensuales para el dashboard de Comisiones (residencial).

Una sola llamada devuelve puntos/ventas/ventas-por-team de varios meses,
para la tendencia de 6 meses y las metas de team (antes el frontend bajaba
los leads completos de cada mes: 5 llamadas pesadas).

Criterio idéntico al frontend (cuentaParaComision): cuenta la venta en el mes
en que se INSTALA (colchón) o en el de venta si no hay instalación en otro
mes; solo status de comisión del grupo completed (lleva ACTIVE).
"""
import datetime as _dt
import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user

router = APIRouter(prefix="/api/comisiones", tags=["Comisiones stats"])

# Mes efectivo de la venta para comisión: el de instalación si difiere del de
# venta; si no, el de venta. (dia_venta/dia_instalacion son DATE.)
_EFECTIVO_YM = """
    CASE WHEN dia_instalacion IS NOT NULL
              AND DATE_FORMAT(dia_instalacion,'%Y-%m') <> DATE_FORMAT(COALESCE(dia_venta, dia_instalacion),'%Y-%m')
         THEN DATE_FORMAT(dia_instalacion,'%Y-%m')
         ELSE DATE_FORMAT(COALESCE(dia_venta, dia_instalacion),'%Y-%m')
    END
"""

_COMPLETED = "status_grupo = 'completed'"


def _is_admin_or_bo(user: dict) -> bool:
    r = unicodedata.normalize("NFD", str(user.get("role") or "")).encode("ascii", "ignore").decode().lower()
    return ("admin" in r or "backoffice" in r or "rol_icon" in r or "rol_bamo" in r
            or r == "icon" or r == "bamo")


@router.get("/tendencia")
async def tendencia(
    year: int = Query(..., ge=2020, le=2100),
    month: int = Query(..., ge=1, le=12),
    n: int = Query(5, ge=1, le=12, description="Cuántos meses ANTERIORES al mes dado devolver"),
    user: dict = Depends(current_user),
):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")

    # Meses anteriores al mes activo (el activo lo calcula el frontend con sus leads)
    yms = []
    y, m = year, month
    for _ in range(n):
        m -= 1
        if m < 1:
            m, y = 12, y - 1
        yms.append(f"{y}-{m:02d}")

    placeholders = ",".join(f":ym{i}" for i in range(len(yms)))
    params = {f"ym{i}": ym for i, ym in enumerate(yms)}

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT {_EFECTIVO_YM} AS ym,
                   TRIM(COALESCE(supervisor,'')) AS team,
                   COUNT(*) AS ventas,
                   COALESCE(SUM(puntaje),0) AS pts
            FROM leads
            WHERE {_COMPLETED}
              AND {_EFECTIVO_YM} IN ({placeholders})
            GROUP BY 1, 2
        """), params)
        rows = r.mappings().all()

    months = {ym: {"pts": 0.0, "ventas": 0, "teamVentas": {}} for ym in yms}
    for row in rows:
        mo = months.get(row["ym"])
        if mo is None:
            continue
        team = row["team"] or "Sin equipo"
        n_v = int(row["ventas"] or 0)
        mo["ventas"] += n_v
        mo["pts"] += float(row["pts"] or 0)
        mo["teamVentas"][team] = mo["teamVentas"].get(team, 0) + n_v
    for mo in months.values():
        mo["pts"] = round(mo["pts"], 2)

    return {"success": True, "months": months}


# ── Agentes que NO comisionan un mes ────────────────────────────────────────
# La casilla «Comisiona este mes» de Comisiones. Antes vivía en el localStorage de
# cada navegador; aquí la ven todos y el total del mes la descuenta.
# agente_key = nombre del agente en minúsculas con _ (el mismo que arma el frontend).
_YM_RE = re.compile(r"^\d{4}-\d{2}$")


@router.get("/excluidos")
async def excluidos(ym: str = Query(...), user: dict = Depends(current_user)):
    if not _YM_RE.match(ym):
        raise HTTPException(400, "Mes no válido")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT agente_key FROM comision_excluidos WHERE ym = :ym"), {"ym": ym})
        return {"success": True, "ym": ym, "excluidos": [row[0] for row in r.all()]}


@router.put("/excluidos")
async def set_excluido(body: dict, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    ym = str(body.get("ym") or "")
    key = str(body.get("agente_key") or "").strip().lower()[:150]
    if not _YM_RE.match(ym) or not key:
        raise HTTPException(400, "Datos no válidos")
    async with AsyncSessionLocal() as s:
        if body.get("excluido"):
            await s.execute(text("""INSERT IGNORE INTO comision_excluidos (ym, agente_key, excluido_por)
                                    VALUES (:ym, :k, :por)"""),
                            {"ym": ym, "k": key, "por": user.get("username", "")})
        else:
            await s.execute(text("DELETE FROM comision_excluidos WHERE ym = :ym AND agente_key = :k"),
                            {"ym": ym, "k": key})
        await s.commit()
    return {"success": True}
