from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, require_roles
from datetime import datetime, timezone
from typing import Optional, List, Any
import re, json

def _utcnow() -> datetime:
    """UTC naive (reemplazo de _utcnow() deprecado en Python 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

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


# Mapeo del formato LEGADO (array de 9 posiciones): [0..2]=jonathan, [3..5]=luis,
# [6..8]=totales (los totales ya no se guardan: se calculan).
_LEGACY_TEAM_ORDER = ["jonathan", "luis"]


def _row_to_teams(row) -> dict:
    """Devuelve {token: {"total": float, "ventas": float}} desde la fila,
    aceptando el formato nuevo (dict v2) y el legado (array de 9)."""
    c = row.get("campos")
    if isinstance(c, str):
        try: c = json.loads(c)
        except (ValueError, TypeError): c = []
    if isinstance(c, dict) and c.get("v2"):
        out = {}
        for tok, d in (c.get("teams") or {}).items():
            if isinstance(d, dict):
                out[str(tok)] = {"total": _to_number(d.get("total")), "ventas": _to_number(d.get("ventas"))}
        return out
    arr = _ensure_len9(c or [])
    out = {}
    for i, tok in enumerate(_LEGACY_TEAM_ORDER):
        base = i * 3
        total, ventas = _to_number(arr[base]), _to_number(arr[base + 1])
        if total or ventas:
            out[tok] = {"total": total, "ventas": ventas}
    return out


async def _lineas_team_cols() -> list:
    """Columnas de team para la tabla, desde la página de permisos (sin hardcode)."""
    try:
        from routers.lineas import get_lineas_teams
        teams = [{"token": re.sub(r"[^a-z0-9]", "", str(t["token"]).lower()), "label": t["label"]}
                 for t in await get_lineas_teams()]
        if teams:
            return teams
    except Exception:
        pass
    return [{"token": tok, "label": "TEAM " + tok.upper()} for tok in _LEGACY_TEAM_ORDER]


class FacturacionLineasBody(BaseModel):
    fecha: str
    campos: Optional[List[Any]] = None          # formato legado
    teams: Optional[dict] = None                # formato nuevo {token: {total, ventas}}


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
        totales[mes_idx] += sum(t["total"] for t in _row_to_teams(d).values())
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
    return {
        "ok": True,
        "teams": await _lineas_team_cols(),
        "data": [{"fecha": d.get("fecha"), "teams": _row_to_teams(d)} for d in docs],
    }


@router.post("/")
async def facturacion_lineas_save(body: FacturacionLineasBody, user: dict = Depends(require_roles(*_ADMIN_BO_ROLES))):
    parsed = _parse_fecha(body.fecha)
    if not parsed:
        raise HTTPException(400, "Fecha inválida")
    if body.teams is not None:
        teams_clean = {}
        for tok, d in (body.teams or {}).items():
            if isinstance(d, dict):
                teams_clean[re.sub(r"[^a-z0-9]", "", str(tok).lower())] = {
                    "total": _to_number(d.get("total")), "ventas": _to_number(d.get("ventas")),
                }
        campos_payload = {"v2": True, "teams": teams_clean}
    else:
        campos_payload = _ensure_len9(body.campos)
    now = _utcnow()
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
                "fecha": parsed["key"], "campos": json.dumps(campos_payload),
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
                "fecha": parsed["key"], "campos": json.dumps(campos_payload),
                "by": username, "now": now,
            })
            upserted = True
        await s.commit()

    return {"ok": True, "upserted": upserted, "modifiedCount": 0 if upserted else 1}
