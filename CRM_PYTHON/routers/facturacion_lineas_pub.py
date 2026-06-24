"""Facturación de publicidad de Líneas (Garay / Connecting).

Dataset independiente de `facturacion` (residencial) y de `facturacion_lineas`
(equipos Jonathan/Luis). Guarda por día un arreglo de 9 campos:

  [0] Garay      Cant. ventas
  [1] Garay      Cant. líneas
  [2] Garay      Monto
  [3] Connecting Cant. ventas
  [4] Connecting Cant. líneas
  [5] Connecting Monto
  [6] Total monto      (Garay + Connecting)  -> usado por la gráfica anual
  [7] Total ventas
  [8] Total líneas
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import require_roles
from datetime import datetime, timezone
from typing import Optional, List, Any
import re, json


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


router = APIRouter(prefix="/api/facturacion-lineas-pub", tags=["Facturacion Lineas Pub"])

_ADMIN_BO_ROLES = ("admin", "Administrador", "administrador", "backoffice", "Backoffice")

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS facturacion_lineas_pub (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    anio        SMALLINT     NOT NULL,
    mes         TINYINT      NOT NULL,
    dia         TINYINT      NOT NULL,
    fecha_str   VARCHAR(12)  NULL,
    campos      JSON         NOT NULL,
    created_by  VARCHAR(200) NULL,
    updated_by  VARCHAR(200) NULL,
    created_at  DATETIME     NULL,
    updated_at  DATETIME     NULL,
    UNIQUE KEY uq_faclineaspub_fecha (anio, mes, dia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


async def ensure_table() -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(text(CREATE_TABLE_SQL))
        await s.commit()


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


class FacturacionLineasPubBody(BaseModel):
    fecha: str
    campos: Optional[List[Any]] = None


@router.get("/anual/{anio}")
async def anual(anio: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT mes, campos FROM facturacion_lineas_pub WHERE anio = :y"), {"y": anio})
        docs = r.mappings().all()
    totales = [0.0] * 12
    for d in docs:
        mes_idx = (int(d.get("mes") or 0)) - 1
        if 0 <= mes_idx <= 11:
            totales[mes_idx] += _to_number(_campos_from_row(d)[6])
    return {"ok": True, "totalesPorMes": totales}


@router.get("/{anio}/{mes}")
async def mensual(anio: int, mes: int, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    if mes < 1 or mes > 12:
        raise HTTPException(400, "Parámetros inválidos")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT fecha_str as fecha, campos, dia FROM facturacion_lineas_pub
            WHERE anio = :y AND mes = :m ORDER BY dia ASC
        """), {"y": anio, "m": mes})
        docs = r.mappings().all()
    return {"ok": True, "data": [{"fecha": d.get("fecha"), "campos": _campos_from_row(d)} for d in docs]}


@router.post("")
@router.post("/")
async def save(body: FacturacionLineasPubBody, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    parsed = _parse_fecha(body.fecha)
    if not parsed:
        raise HTTPException(400, "Fecha inválida")
    campos9 = _ensure_len9(body.campos)
    now = _utcnow()
    username = user.get("username")

    async with AsyncSessionLocal() as s:
        exists = await s.execute(text("""
            SELECT id FROM facturacion_lineas_pub WHERE anio = :y AND mes = :m AND dia = :d LIMIT 1
        """), {"y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"]})
        row = exists.first()

        if row:
            await s.execute(text("""
                UPDATE facturacion_lineas_pub SET fecha_str = :fecha, campos = :campos,
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
                INSERT INTO facturacion_lineas_pub (anio, mes, dia, fecha_str, campos, created_by, updated_by, created_at, updated_at)
                VALUES (:y, :m, :d, :fecha, :campos, :by, :by, :now, :now)
            """), {
                "y": parsed["anio"], "m": parsed["mes"], "d": parsed["dia"],
                "fecha": parsed["key"], "campos": json.dumps(campos9),
                "by": username, "now": now,
            })
            upserted = True
        await s.commit()

    return {"ok": True, "upserted": upserted, "modifiedCount": 0 if upserted else 1}
