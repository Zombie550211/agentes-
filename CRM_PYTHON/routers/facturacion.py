from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, require_roles, ADMIN_ROLES
from datetime import datetime
from typing import Any
import re, json

router = APIRouter(prefix="/api/facturacion", tags=["Facturacion"])


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


def _campos_from_row(row) -> list:
    c = row.get("campos")
    if isinstance(c, str):
        try: c = json.loads(c)
        except: c = []
    return _ensure_len17(c or [])


class FacturacionBody(BaseModel):
    fecha: str
    campos: list


@router.get("/anual/{anio}")
async def get_anual(anio: int, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT mes, campos FROM facturacion WHERE anio = :y"), {"y": anio})
        docs = r.mappings().all()
    totales = [0.0] * 12
    for d in docs:
        mes_idx = (int(d.get("mes") or 0)) - 1
        if not (0 <= mes_idx <= 11):
            continue
        arr = _campos_from_row(d)
        totales[mes_idx] += _to_number(arr[12])
    return {"ok": True, "totalesPorMes": totales}


@router.get("/{anio}/{mes}")
async def get_mensual(anio: int, mes: int, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if not (1 <= mes <= 12):
        raise HTTPException(400, "Parámetros inválidos")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT fecha_str as fecha, campos, dia FROM facturacion
            WHERE anio = :y AND mes = :m ORDER BY dia ASC
        """), {"y": anio, "m": mes})
        docs = r.mappings().all()
    return {"ok": True, "data": [{"fecha": d.get("fecha"), "campos": _campos_from_row(d)} for d in docs]}


@router.post("")
@router.post("/")
async def save_facturacion(body: FacturacionBody, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    parsed = _parse_fecha(body.fecha)
    if not parsed:
        raise HTTPException(400, "Fecha inválida")
    campos17 = _ensure_len17(body.campos)
    now = datetime.utcnow()
    username = user.get("username")

    async with AsyncSessionLocal() as s:
        exists = await s.execute(text("""
            SELECT id FROM facturacion WHERE anio = :y AND mes = :m AND dia = :d LIMIT 1
        """), {"y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"]})
        row = exists.first()

        if row:
            await s.execute(text("""
                UPDATE facturacion SET fecha_str = :fecha, campos = :campos,
                    updated_at = :now, updated_by = :by
                WHERE anio = :y AND mes = :m AND dia = :d
            """), {
                "fecha": parsed["key"], "campos": json.dumps(campos17),
                "now": now, "by": username,
                "y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"],
            })
            upserted = False
        else:
            await s.execute(text("""
                INSERT INTO facturacion (anio, mes, dia, fecha_str, campos, created_by, updated_by, created_at, updated_at)
                VALUES (:y, :m, :d, :fecha, :campos, :by, :by, :now, :now)
            """), {
                "y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"],
                "fecha": parsed["key"], "campos": json.dumps(campos17),
                "by": username, "now": now,
            })
            upserted = True
        await s.commit()

    return {"ok": True, "upserted": upserted, "modifiedCount": 0 if upserted else 1}
