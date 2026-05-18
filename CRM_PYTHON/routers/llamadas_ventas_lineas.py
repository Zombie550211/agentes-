from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database import get_db
from deps import require_roles
from datetime import datetime
from typing import Optional, Any
import re

router = APIRouter(prefix="/api/llamadas-ventas-lineas", tags=["Llamadas Ventas Lineas"])

_ADMIN_BO_ROLES = ("admin", "Administrador", "administrador", "backoffice", "Backoffice")


class LlamadasBody(BaseModel):
    fecha: str
    equipos: Optional[Any] = None


@router.get("/mes/{anio}/{mes}")
async def llamadas_mes(anio: int, mes: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    if mes < 1 or mes > 12:
        raise HTTPException(400, "Parámetros inválidos")
    db = get_db()
    prefix = f"{anio}-{str(mes).zfill(2)}-"
    docs = await db["LlamadasVentasLineas"].find(
        {"fecha": {"$regex": f"^{re.escape(prefix)}"}}
    ).sort("fecha", 1).to_list(None)
    for d in docs:
        d["_id"] = str(d["_id"])
    return {"ok": True, "data": docs}


@router.get("/{fecha}")
async def llamadas_por_fecha(fecha: str, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    db = get_db()
    doc = await db["LlamadasVentasLineas"].find_one({"fecha": fecha})
    if doc:
        doc["_id"] = str(doc["_id"])
    return {"ok": True, "data": doc}


@router.post("/")
async def llamadas_save(body: LlamadasBody, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    if not body.fecha:
        raise HTTPException(400, "Fecha requerida")
    db = get_db()
    now = datetime.utcnow()
    username = user.get("username")
    try:
        result = await db["LlamadasVentasLineas"].update_one(
            {"fecha": body.fecha},
            {
                "$set": {"equipos": body.equipos or {}, "updatedAt": now, "updatedBy": username},
                "$setOnInsert": {"createdAt": now, "createdBy": username},
            },
            upsert=True,
        )
        return {"ok": True, "upserted": result.upserted_id is not None, "modifiedCount": result.modified_count}
    except Exception as e:
        if "11000" in str(e) or "duplicate" in str(e).lower():
            raise HTTPException(409, "Conflicto de duplicado para la fecha")
        raise HTTPException(500, "Error interno")
