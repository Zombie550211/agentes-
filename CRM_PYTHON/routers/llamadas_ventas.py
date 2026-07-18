from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
import datetime as _dt, re, calendar

def _utcnow() -> _dt.datetime:
    """UTC naive (reemplazo de datetime.utcnow() deprecado en Python 3.12+)."""
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)

router = APIRouter(tags=["Llamadas Ventas"])

_ADMIN_ROLES = {"admin", "administrador", "administrator", "backoffice", "bo"}
_DATE_RE     = re.compile(r"^(0[1-9]|1[0-2])/(0[1-9]|[12]\d|3[01])/\d{4}$")


def _is_admin(role: str) -> bool:
    r = role.strip().lower()
    return any(a in r for a in _ADMIN_ROLES)


def _is_supervisor(user: dict) -> bool:
    role = str(user.get("role", "") or "").strip().lower()
    return "supervisor" in role


def _is_backoffice(user: dict) -> bool:
    role = str(user.get("role", "") or "").strip().lower()
    return "backoffice" in role or role in {"bo"}


def _normalize_team_key(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    normalized = text.normalize("NFD")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", ascii_text.lower())


def _can_access_excel(user: dict) -> bool:
    return _is_admin(user.get("role", "")) or _is_supervisor(user) or _is_backoffice(user)


def _can_edit_team(user: dict, team: Optional[str]) -> bool:
    if _is_admin(user.get("role", "")) or _is_backoffice(user):
        return True
    if not _is_supervisor(user):
        return False
    team_key = _normalize_team_key(team)
    if not team_key:
        return False
    user_team_key = _normalize_team_key(user.get("team") or user.get("equipo") or "")
    if user_team_key and team_key == user_team_key:
        return True
    supervisor_key = _normalize_team_key(user.get("supervisor") or "")
    if supervisor_key and team_key:
        return supervisor_key in team_key or team_key in supervisor_key
    return False


def _check_excel_access(user: dict):
    if not _can_access_excel(user):
        raise HTTPException(403, "No autorizado")


def _sid(sheet_id: str) -> int:
    try:
        return int(sheet_id)
    except (ValueError, TypeError):
        raise HTTPException(400, "sheetId inválido")


# ── LLAMADAS-VENTAS ──────────────────────────────────────────────────

@router.get("/api/llamadas-ventas")
async def get_llamadas_ventas(
    month: Optional[int] = Query(None),
    year:  Optional[int] = Query(None),
    user:  dict = Depends(current_user),
):
    if not _is_admin(user.get("role", "")):
        raise HTTPException(403, "No autorizado")

    now          = _utcnow()
    target_month = month if month else now.month
    target_year  = year  if year  else now.year

    _, last_day = calendar.monthrange(target_year, target_month)
    start_date  = f"{target_year}-{target_month:02d}-01"
    end_date    = f"{target_year}-{target_month:02d}-{last_day:02d}"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, fecha, team, tipo, valor, created_at, created_by, updated_at, updated_by
            FROM llamadas_ventas
            WHERE fecha BETWEEN :s AND :e
            ORDER BY fecha ASC, team ASC, tipo ASC
        """), {"s": start_date, "e": end_date})
        rows = r.mappings().all()

    registros = []
    for row in rows:
        d = dict(row)
        d["_id"] = str(d["id"])
        for col in ("fecha", "created_at", "updated_at"):
            if d.get(col) is not None:
                d[col] = str(d[col])
        registros.append(d)

    return {
        "success": True, "data": registros,
        "count": len(registros), "month": target_month, "year": target_year,
    }


class LlamadasVentasBody(BaseModel):
    day:   Any
    team:  str
    type:  str
    value: Any = None


@router.post("/api/llamadas-ventas")
async def post_llamadas_ventas(body: LlamadasVentasBody, user: dict = Depends(current_user)):
    if not _is_admin(user.get("role", "")):
        raise HTTPException(403, "No autorizado")

    if body.type in ("LLAMADAS", "VENTAS"):
        raw = str(body.value or "").strip()
        if not raw or raw == "-":
            raise HTTPException(400, "Valor inválido para LLAMADAS/VENTAS")
        try:
            float(raw)
        except ValueError:
            raise HTTPException(400, "Valor no numérico para LLAMADAS/VENTAS")

    now         = _utcnow()
    day         = int(body.day)
    fecha       = f"{now.year}-{now.month:02d}-{day:02d}"
    valor_final = body.value if body.type == "TOTALES" else (float(body.value) if body.value is not None else 0)
    by          = user.get("username", "unknown")

    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO llamadas_ventas
                (fecha, team, tipo, valor, created_at, created_by, updated_at, updated_by)
            VALUES
                (:fecha, :team, :tipo, :valor, :now, :by, :now, :by)
            ON DUPLICATE KEY UPDATE
                valor = :valor, updated_at = :now, updated_by = :by
        """), {
            "fecha": fecha, "team": body.team, "tipo": body.type,
            "valor": valor_final, "now": now, "by": by,
        })
        await s.commit()

    return {
        "success": True, "message": "Datos guardados",
        "data": {
            "day": day, "team": body.team, "type": body.type, "value": valor_final,
        },
    }


# ── LLAMADAS-VENTAS-EXCEL ─────────────────────────────────────────────

# ── Puntos del día por sección (KPI automático de la página Llamadas y Ventas) ──
# Mismo criterio que equipos/estadisticas: cuentan pendientes + activas/completadas.
@router.get("/api/llamadas-ventas-excel/puntos-dia")
async def lv_puntos_dia(fecha: str = Query(...), user: dict = Depends(current_user)):
    _check_excel_access(user)
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", fecha or ""):
        raise HTTPException(400, "fecha inválida (YYYY-MM-DD)")
    sql = """
        SELECT COALESCE(SUM(puntaje), 0)
        FROM {t}
        WHERE dia_venta = :f
          AND LOWER(COALESCE(status,'')) NOT REGEXP 'cancel|reser|hold|resched|reagend|reprogram|oficina'
    """
    async with AsyncSessionLocal() as s:
        r1 = await s.execute(text(sql.format(t="leads")), {"f": fecha})
        resi = float(r1.scalar() or 0)
        r2 = await s.execute(text(sql.format(t="lineas_clientes")), {"f": fecha})
        lin = float(r2.scalar() or 0)
    return {"success": True, "resi": round(resi, 2), "lineas": round(lin, 2)}


@router.get("/api/llamadas-ventas-excel/sheets")
async def excel_get_sheets(user: dict = Depends(current_user)):
    _check_excel_access(user)
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, name, created_at, created_by, updated_at, updated_by
            FROM lv_excel_sheets
            ORDER BY created_at ASC, id ASC
        """))
        sheets = r.mappings().all()

    return {"success": True, "data": [
        {
            "_id":       str(s["id"]),
            "name":      s.get("name"),
            "createdAt": str(s["created_at"]) if s.get("created_at") else None,
            "createdBy": s.get("created_by"),
            "updatedAt": str(s["updated_at"]) if s.get("updated_at") else None,
            "updatedBy": s.get("updated_by"),
        }
        for s in sheets
    ]}


class CreateSheetBody(BaseModel):
    name: Optional[str] = None


@router.post("/api/llamadas-ventas-excel/sheets")
async def excel_create_sheet(body: CreateSheetBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    now       = _utcnow()
    base_name = (body.name or "").strip() or now.strftime("%Y-%m-%d")
    by        = user.get("username", "unknown")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id FROM lv_excel_sheets WHERE name = :n LIMIT 1"), {"n": base_name})
        if r.first():
            base_name = f"{base_name} ({now.strftime('%H:%M:%S')})"

        r2 = await s.execute(text("""
            INSERT INTO lv_excel_sheets (name, created_at, created_by, updated_at, updated_by)
            VALUES (:name, :now, :by, :now, :by)
        """), {"name": base_name, "now": now, "by": by})
        await s.commit()
        new_id = r2.lastrowid

    return {"success": True, "data": {
        "_id":       str(new_id),
        "name":      base_name,
        "createdAt": str(now),
        "createdBy": by,
        "updatedAt": str(now),
        "updatedBy": by,
    }}


@router.get("/api/llamadas-ventas-excel/sheets/{sheet_id}")
async def excel_get_sheet(sheet_id: str, user: dict = Depends(current_user)):
    _check_excel_access(user)
    sid = _sid(sheet_id)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, name FROM lv_excel_sheets WHERE id = :id"), {"id": sid})
        sheet = r.mappings().first()
        if not sheet:
            raise HTTPException(404, "Sheet no encontrado")

        r2 = await s.execute(text("""
            SELECT kind, team, person, col, metric, value
            FROM lv_excel_data WHERE sheet_id = :sid
        """), {"sid": sid})
        data = [dict(row) for row in r2.mappings().all()]

        r3 = await s.execute(text("""
            SELECT name, role, team FROM lv_excel_users WHERE sheet_id = :sid
        """), {"sid": sid})
        users = [dict(row) for row in r3.mappings().all()]

    if _is_supervisor(user) and not _is_admin(user.get("role", "")) and not _is_backoffice(user):
        allowed_team = _normalize_team_key(user.get("team") or user.get("equipo") or "")
        if allowed_team:
            data = [row for row in data if _normalize_team_key(row.get("team") or "") == allowed_team]
            users = [row for row in users if _normalize_team_key(row.get("team") or "") == allowed_team]

    return {
        "success": True,
        "sheet":   {"_id": str(sheet["id"]), "name": sheet["name"]},
        "data":    data,
        "users":   users,
    }


class ExcelCellBody(BaseModel):
    sheetId: str
    team:    Optional[str] = None
    person:  Optional[str] = None
    col:     Optional[str] = None
    metric:  Optional[str] = None
    value:   Any = None


@router.post("/api/llamadas-ventas-excel/cell")
async def excel_save_cell(body: ExcelCellBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    sid = _sid(body.sheetId.strip())
    now = _utcnow()
    v   = str(body.value or "").strip()
    by  = user.get("username", "unknown")

    if body.metric:
        kind   = "summary"
        metric = str(body.metric).strip().upper()
        where  = "sheet_id = :sid AND kind = :kind AND metric = :metric"
        wp     = {"sid": sid, "kind": kind, "metric": metric}
        ins    = {"metric": metric, "team": None, "person": None, "col": None}
    else:
        if not body.team or not body.person or not body.col:
            raise HTTPException(400, "Faltan campos: team, person, col")
        if not _can_edit_team(user, body.team):
            raise HTTPException(403, "No autorizado para editar este equipo")
        kind   = "cell"
        team   = str(body.team).strip()
        person = str(body.person).strip()
        col    = str(body.col).strip().upper()
        where  = "sheet_id = :sid AND kind = :kind AND team = :team AND person = :person AND col = :col"
        wp     = {"sid": sid, "kind": kind, "team": team, "person": person, "col": col}
        ins    = {"metric": None, "team": team, "person": person, "col": col}

    async with AsyncSessionLocal() as s:
        if v == "":
            await s.execute(text(f"DELETE FROM lv_excel_data WHERE {where}"), wp)
        else:
            r = await s.execute(text(f"""
                UPDATE lv_excel_data
                SET value = :v, updated_at = :now, updated_by = :by
                WHERE {where}
            """), {**wp, "v": v, "now": now, "by": by})
            if r.rowcount == 0:
                await s.execute(text("""
                    INSERT INTO lv_excel_data
                        (sheet_id, kind, team, person, col, metric, value,
                         created_at, created_by, updated_at, updated_by)
                    VALUES
                        (:sid, :kind, :team, :person, :col, :metric, :v,
                         :now, :by, :now, :by)
                """), {
                    "sid": sid, "kind": kind, "v": v, "now": now, "by": by,
                    **ins,
                })

        await s.execute(text("""
            UPDATE lv_excel_sheets
            SET updated_at = :now, updated_by = :by
            WHERE id = :id
        """), {"now": now, "by": by, "id": sid})
        await s.commit()

    return {"success": True}


class ExcelUserBody(BaseModel):
    sheetId: str
    name:    str
    team:    str
    role:    Optional[str] = ""


@router.post("/api/llamadas-ventas-excel/user")
async def excel_save_user(body: ExcelUserBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    sid = _sid(body.sheetId.strip())
    if not body.name or not body.team:
        raise HTTPException(400, "Faltan campos: name, team")
    now    = _utcnow()
    name   = body.name.strip().upper()
    team   = body.team.strip()
    role   = (body.role or "").strip()
    by     = user.get("username", "unknown")

    if not _can_edit_team(user, body.team):
        raise HTTPException(403, "No autorizado para editar este equipo")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE lv_excel_users
            SET role = :role, updated_at = :now, updated_by = :by
            WHERE sheet_id = :sid AND name = :name AND team = :team
        """), {"role": role, "now": now, "by": by, "sid": sid, "name": name, "team": team})
        if r.rowcount == 0:
            await s.execute(text("""
                INSERT INTO lv_excel_users
                    (sheet_id, name, role, team, created_at, created_by, updated_at, updated_by)
                VALUES
                    (:sid, :name, :role, :team, :now, :by, :now, :by)
            """), {"sid": sid, "name": name, "role": role, "team": team, "now": now, "by": by})
        await s.commit()

    return {"success": True, "data": {"name": name, "role": role, "team": team}}


class ExcelUserDeleteBody(BaseModel):
    sheetId: str
    name:    str
    team:    str


@router.post("/api/llamadas-ventas-excel/user-delete")
async def excel_delete_user(body: ExcelUserDeleteBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    sid  = _sid(body.sheetId.strip())
    name = body.name.strip().upper()
    team = body.team.strip()
    if not name or not team:
        raise HTTPException(400, "Faltan campos: name, team")

    if not _can_edit_team(user, body.team):
        raise HTTPException(403, "No autorizado para editar este equipo")

    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            DELETE FROM lv_excel_users
            WHERE sheet_id = :sid AND name = :name AND team = :team
        """), {"sid": sid, "name": name, "team": team})
        await s.execute(text("""
            DELETE FROM lv_excel_data
            WHERE sheet_id = :sid AND kind = 'cell' AND team = :team AND person = :name
        """), {"sid": sid, "team": team, "name": name})
        await s.commit()

    return {"success": True}


@router.delete("/api/llamadas-ventas-excel/sheets/{sheet_id}")
async def excel_delete_sheet(sheet_id: str, user: dict = Depends(current_user)):
    _check_excel_access(user)
    sid = _sid(sheet_id)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM lv_excel_sheets WHERE id = :id"), {"id": sid})
        if r.rowcount == 0:
            raise HTTPException(404, "Sheet no encontrado")
        await s.execute(text("DELETE FROM lv_excel_users WHERE sheet_id = :sid"), {"sid": sid})
        await s.execute(text("DELETE FROM lv_excel_data  WHERE sheet_id = :sid"), {"sid": sid})
        await s.commit()

    return {"success": True, "message": "Sheet eliminado"}


class PatchSheetBody(BaseModel):
    name: str


@router.patch("/api/llamadas-ventas-excel/sheets/{sheet_id}")
async def excel_rename_sheet(sheet_id: str, body: PatchSheetBody, user: dict = Depends(current_user)):
    _check_excel_access(user)
    sid      = _sid(sheet_id)
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(400, "Nombre requerido")
    if not _DATE_RE.match(new_name):
        raise HTTPException(400, "Formato de fecha inválido. Use MM/DD/YYYY")

    now = _utcnow()
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE lv_excel_sheets
            SET name = :name, updated_at = :now, updated_by = :by
            WHERE id = :id
        """), {"name": new_name, "now": now, "by": user.get("username", "unknown"), "id": sid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Sheet no encontrado")

    return {"success": True, "message": "Nombre actualizado", "data": {"name": new_name}}
