from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database import get_db
from deps import current_user, require_roles, ADMIN_BO
from datetime import datetime
from typing import Optional, List, Any
import re

router = APIRouter(prefix="/api/facturacion-lineas", tags=["Facturacion Lineas"])

_ADMIN_BO_ROLES = ("admin", "Administrador", "administrador", "backoffice", "Backoffice")

def _to_fecha_key(fecha: str) -> str:
    if not fecha:
        return ""
    s = str(fecha).strip()
    if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
        return s
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", s)
    if m:
        yy, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{dd:02d}/{mm:02d}/{yy}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        dd, mm, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{dd:02d}/{mm:02d}/{yy}"
    return s

def _parse_fecha(fecha: str):
    key = _to_fecha_key(fecha)
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", key)
    if not m:
        return None
    return {"key": key, "dia": int(m.group(1)), "mes": int(m.group(2)), "anio": int(m.group(3))}

def _ensure_len9(arr) -> List[str]:
    a = [str(v) if v is not None else "" for v in (arr or [])]
    while len(a) < 9:
        a.append("")
    return a[:9]

def _to_number(val) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    cleaned = re.sub(r"[^0-9.\-]", "", str(val))
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


class FacturacionLineasBody(BaseModel):
    fecha: str
    campos: Optional[List[Any]] = None


@router.get("/anual/{anio}")
async def facturacion_lineas_anual(anio: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    db = get_db()
    docs = await db["FacturacionLineas"].find({"anio": anio}, {"_id": 0, "mes": 1, "campos": 1}).to_list(None)
    totales = [0.0] * 12
    for d in docs:
        mes_idx = (int(d.get("mes") or 0)) - 1
        if mes_idx < 0 or mes_idx > 11:
            continue
        arr = _ensure_len9(d.get("campos"))
        totales[mes_idx] += _to_number(arr[6])
    return {"ok": True, "totalesPorMes": totales}


@router.get("/{anio}/{mes}")
async def facturacion_lineas_mensual(anio: int, mes: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    if mes < 1 or mes > 12:
        raise HTTPException(400, "Parámetros inválidos")
    db = get_db()
    docs = await db["FacturacionLineas"].find(
        {"anio": anio, "mes": mes}, {"_id": 0, "fecha": 1, "campos": 1, "dia": 1}
    ).sort("dia", 1).to_list(None)
    return {"ok": True, "data": [{"fecha": d.get("fecha"), "campos": _ensure_len9(d.get("campos"))} for d in docs]}


@router.post("/")
async def facturacion_lineas_save(body: FacturacionLineasBody, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    parsed = _parse_fecha(body.fecha)
    if not parsed:
        raise HTTPException(400, "Fecha inválida")
    campos9 = _ensure_len9(body.campos)
    db = get_db()
    now = datetime.utcnow()
    username = user.get("username")
    try:
        result = await db["FacturacionLineas"].update_one(
            {"anio": parsed["anio"], "mes": parsed["mes"], "dia": parsed["dia"]},
            {
                "$set": {"fecha": parsed["key"], "campos": campos9, "updatedAt": now, "updatedBy": username},
                "$setOnInsert": {"createdAt": now, "createdBy": username},
            },
            upsert=True,
        )
        return {"ok": True, "upserted": result.upserted_id is not None, "modifiedCount": result.modified_count}
    except Exception as e:
        if "11000" in str(e) or "duplicate" in str(e).lower():
            raise HTTPException(409, "Conflicto de duplicado para la fecha")
        raise HTTPException(500, "Error interno")
