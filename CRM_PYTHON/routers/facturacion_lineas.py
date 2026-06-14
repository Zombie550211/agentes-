from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, require_roles, ADMIN_BO
from datetime import datetime
from typing import Optional, List, Any
import re, json

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


def _campos_from_row(row) -> list:
    c = row.get("campos")
    if isinstance(c, str):
        try: c = json.loads(c)
        except (ValueError, TypeError): c = []
    return _ensure_len9(c or [])


class FacturacionLineasBody(BaseModel):
    fecha: str
    campos: Optional[List[Any]] = None


@router.get("/anual/{anio}")
async def facturacion_lineas_anual(anio: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT mes, campos FROM facturacion_lineas WHERE anio = :y"), {"y": anio})
        docs = r.mappings().all()
    totales = [0.0] * 12
    for d in docs:
        mes_idx = (int(d.get("mes") or 0)) - 1
        if mes_idx < 0 or mes_idx > 11:
            continue
        arr = _campos_from_row(d)
        totales[mes_idx] += _to_number(arr[6])
    return {"ok": True, "totalesPorMes": totales}


@router.get("/{anio}/{mes}")
async def facturacion_lineas_mensual(anio: int, mes: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    if mes < 1 or mes > 12:
        raise HTTPException(400, "Parámetros inválidos")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT fecha_str as fecha, campos, dia FROM facturacion_lineas
            WHERE anio = :y AND mes = :m ORDER BY dia ASC
        """), {"y": anio, "m": mes})
        docs = r.mappings().all()
    return {"ok": True, "data": [{"fecha": d.get("fecha"), "campos": _campos_from_row(d)} for d in docs]}


@router.post("/")
async def facturacion_lineas_save(body: FacturacionLineasBody, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    parsed = _parse_fecha(body.fecha)
    if not parsed:
        raise HTTPException(400, "Fecha inválida")
    campos9 = _ensure_len9(body.campos)
    now = datetime.utcnow()
    username = user.get("username")

    async with AsyncSessionLocal() as s:
        exists = await s.execute(text("""
            SELECT id FROM facturacion_lineas WHERE anio = :y AND mes = :m AND dia = :d LIMIT 1
        """), {"y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"]})
        row = exists.first()

        if row:
            await s.execute(text("""
                UPDATE facturacion_lineas SET fecha_str = :fecha, campos = :campos,
                    updated_at = :now, updated_by = :by
                WHERE anio = :y AND mes = :m AND dia = :d
            """), {
                "fecha": parsed["key"], "campos": json.dumps(campos9),
                "now": now, "by": username,
                "y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"],
            })
            upserted = False
        else:
            await s.execute(text("""
                INSERT INTO facturacion_lineas (anio, mes, dia, fecha_str, campos, created_by, updated_by, created_at, updated_at)
                VALUES (:y, :m, :d, :fecha, :campos, :by, :by, :now, :now)
            """), {
                "y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"],
                "fecha": parsed["key"], "campos": json.dumps(campos9),
                "by": username, "now": now,
            })
            upserted = True
        await s.commit()

    return {"ok": True, "upserted": upserted, "modifiedCount": 0 if upserted else 1}
