from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import require_roles
from datetime import datetime
from typing import Optional, Any
import json

router = APIRouter(prefix="/api/llamadas-ventas-lineas", tags=["Llamadas Ventas Lineas"])

_ADMIN_BO_ROLES = ("admin", "Administrador", "administrador", "backoffice", "Backoffice")


def _doc(row) -> dict:
    r = dict(row)
    equipos = r.get("equipos")
    if isinstance(equipos, str):
        try: r["equipos"] = json.loads(equipos)
        except: r["equipos"] = {}
    r["_id"] = str(r.get("id", ""))
    return r


class LlamadasBody(BaseModel):
    fecha: str
    equipos: Optional[Any] = None


@router.get("/mes/{anio}/{mes}")
async def llamadas_mes(anio: int, mes: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    if mes < 1 or mes > 12:
        raise HTTPException(400, "Parámetros inválidos")
    prefix = f"{anio}-{str(mes).zfill(2)}-"
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT * FROM llamadas_ventas_lineas
            WHERE fecha LIKE :prefix ORDER BY fecha ASC
        """), {"prefix": f"{prefix}%"})
        docs = [_doc(row) for row in r.mappings().all()]
    return {"ok": True, "data": docs}


@router.get("/{fecha}")
async def llamadas_por_fecha(fecha: str, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM llamadas_ventas_lineas WHERE fecha = :f LIMIT 1"), {"f": fecha})
        row = r.mappings().first()
    return {"ok": True, "data": _doc(row) if row else None}


@router.post("/")
async def llamadas_save(body: LlamadasBody, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    if not body.fecha:
        raise HTTPException(400, "Fecha requerida")
    now = datetime.utcnow()
    username = user.get("username")
    equipos_json = json.dumps(body.equipos or {})

    async with AsyncSessionLocal() as s:
        exists = await s.execute(text("SELECT id FROM llamadas_ventas_lineas WHERE fecha = :f LIMIT 1"), {"f": body.fecha})
        row = exists.first()
        if row:
            await s.execute(text("""
                UPDATE llamadas_ventas_lineas SET equipos = :eq, updated_at = :now, updated_by = :by
                WHERE fecha = :f
            """), {"eq": equipos_json, "now": now, "by": username, "f": body.fecha})
            upserted = False
        else:
            await s.execute(text("""
                INSERT INTO llamadas_ventas_lineas (fecha, equipos, created_at, created_by, updated_at, updated_by)
                VALUES (:f, :eq, :now, :by, :now, :by)
            """), {"f": body.fecha, "eq": equipos_json, "now": now, "by": username})
            upserted = True
        await s.commit()

    return {"ok": True, "upserted": upserted, "modifiedCount": 0 if upserted else 1}
