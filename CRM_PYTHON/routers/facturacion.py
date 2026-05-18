from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database import get_db
from deps import current_user, require_roles, ADMIN_ROLES
from datetime import datetime
from typing import Any
import re

router = APIRouter(prefix="/api/facturacion", tags=["Facturacion"])

# ── Helpers ──────────────────────────────────────────────────────
def _to_fecha_key(fecha: str) -> str:
    s = str(fecha or "").strip()
    if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
        return s
    m = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", s)
    if m:
        yy, mm, dd = int(m[1]), int(m[2]), int(m[3])
        return f"{dd:02d}/{mm:02d}/{yy}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        dd, mm, yy = int(m[1]), int(m[2]), int(m[3])
        return f"{dd:02d}/{mm:02d}/{yy}"
    return s

def _parse_fecha(fecha: str) -> dict | None:
    key = _to_fecha_key(fecha)
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", key)
    if not m:
        return None
    dd, mm, yy = int(m[1]), int(m[2]), int(m[3])
    return {"key": key, "dia": dd, "mes": mm, "anio": yy}

def _ensure_len17(arr: Any) -> list:
    a = [str(v) if v is not None else "" for v in (arr if isinstance(arr, list) else [])]
    if len(a) == 14:
        a = [a[0],a[1],a[2], "","","", a[3],a[4],a[5], a[6],a[7],a[8], a[9],a[10],a[11],a[12],a[13]]
    while len(a) < 17:
        a.append("")
    return a[:17]

def _to_number(val: Any) -> float:
    if val is None:
        return 0.0
    s = re.sub(r"[^0-9.\-]", "", str(val))
    try:
        return float(s)
    except Exception:
        return 0.0

async def _get_coll():
    db = get_db()
    coll = db["Facturacion"]
    try:
        await coll.create_index([("anio", 1), ("mes", 1), ("dia", 1)], unique=True, name="uniq_anio_mes_dia")
        await coll.create_index([("fecha", 1)], name="idx_fecha")
    except Exception:
        pass
    return coll

# ── Modelos ──────────────────────────────────────────────────────
class FacturacionBody(BaseModel):
    fecha: str
    campos: list

# ── Rutas ────────────────────────────────────────────────────────
@router.get("/anual/{anio}")
async def get_anual(anio: int, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    coll = await _get_coll()
    docs = await coll.find({"anio": anio}, {"_id": 0, "mes": 1, "campos": 1}).to_list(None)
    totales = [0.0] * 12
    for d in docs:
        mes_idx = (int(d.get("mes") or 0)) - 1
        if not (0 <= mes_idx <= 11):
            continue
        arr = _ensure_len17(d.get("campos", []))
        totales[mes_idx] += _to_number(arr[12])
    return {"ok": True, "totalesPorMes": totales}

@router.get("/{anio}/{mes}")
async def get_mensual(anio: int, mes: int, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if not (1 <= mes <= 12):
        raise HTTPException(400, "Parámetros inválidos")
    coll = await _get_coll()
    docs = await coll.find(
        {"anio": anio, "mes": mes},
        {"_id": 0, "fecha": 1, "campos": 1, "dia": 1}
    ).sort("dia", 1).to_list(None)
    return {"ok": True, "data": [{"fecha": d.get("fecha"), "campos": _ensure_len17(d.get("campos", []))} for d in docs]}

@router.post("/")
async def save_facturacion(body: FacturacionBody, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    parsed = _parse_fecha(body.fecha)
    if not parsed:
        raise HTTPException(400, "Fecha inválida")
    campos17 = _ensure_len17(body.campos)
    coll = await _get_coll()
    now = datetime.utcnow()
    try:
        result = await coll.update_one(
            {"anio": parsed["anio"], "mes": parsed["mes"], "dia": parsed["dia"]},
            {
                "$set": {"fecha": parsed["key"], "campos": campos17, "updatedAt": now, "updatedBy": user.get("username")},
                "$setOnInsert": {"createdAt": now, "createdBy": user.get("username")}
            },
            upsert=True
        )
        return {"ok": True, "upserted": result.upserted_id is not None, "modifiedCount": result.modified_count}
    except Exception as e:
        if "11000" in str(e) or "duplicate" in str(e).lower():
            raise HTTPException(409, "Conflicto de duplicado para la fecha")
        raise HTTPException(500, "Error interno")
