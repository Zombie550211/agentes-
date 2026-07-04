from fastapi import APIRouter, Depends, HTTPException
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, require_roles, ADMIN_ROLES, team_seccion
from pydantic import BaseModel
from typing import Optional
import re, unicodedata
from datetime import datetime

router = APIRouter(tags=["Teams"])


def _norm(s: str) -> str:
    try:
        return unicodedata.normalize("NFD", str(s or "")).encode("ascii","ignore").decode().lower().strip()
    except Exception:
        return str(s or "").lower().strip()


# ── GET /api/teams/renames ──────────────────────────────────────────
@router.get("/api/teams/renames")
async def get_renames(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, old_name, new_name,
                   DATE_FORMAT(changed_at, '%Y-%m-%d') AS changed_at,
                   created_by
            FROM team_renames ORDER BY changed_at ASC
        """))
        rows = r.mappings().all()
    return {"success": True, "renames": [dict(row) for row in rows]}


class RenameIn(BaseModel):
    old_name:   str
    new_name:   str
    changed_at: str           # YYYY-MM-DD
    created_by: Optional[str] = None


# ── POST /api/teams/rename  (solo admin/backoffice) ─────────────────
@router.post("/api/teams/rename")
async def add_rename(body: RenameIn, user: dict = Depends(current_user)):
    role = _norm(user.get("role", ""))
    if not any(r in role for r in ("admin", "backoffice")):
        raise HTTPException(403, "Solo administradores pueden registrar renombres de equipo")
    try:
        dt = datetime.strptime(body.changed_at, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "changed_at debe ser YYYY-MM-DD")
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO team_renames (old_name, new_name, changed_at, created_by)
            VALUES (:old, :new, :dt, :by)
        """), {"old": body.old_name.strip(), "new": body.new_name.strip(),
               "dt": dt, "by": body.created_by or user.get("username")})
        await s.commit()
    return {"success": True, "message": f"Rename registrado: {body.old_name} → {body.new_name} desde {body.changed_at}"}


# ── DELETE /api/teams/rename/{id}  (solo admin) ──────────────────────
@router.delete("/api/teams/rename/{rename_id}")
async def delete_rename(rename_id: int, user: dict = Depends(current_user)):
    role = _norm(user.get("role", ""))
    if not any(r in role for r in ("admin",)):
        raise HTTPException(403, "Solo administradores")
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM team_renames WHERE id = :id"), {"id": rename_id})
        await s.commit()
    return {"success": True}


@router.get("/api/teams")
async def list_teams(seccion: str = "", sales: str = "", user: dict = Depends(current_user)):
    # sales=1 → solo equipos de VENTA (los que tienen al menos un supervisor).
    # Excluye Administración, Backoffice, TEAM BAMO/ICON, etc. (no tienen supervisor).
    only_sales = str(sales or "").strip().lower() in ("1", "true", "yes")
    async with AsyncSessionLocal() as s:
        if only_sales:
            r = await s.execute(text("""
                SELECT TRIM(team) AS team FROM users
                WHERE team IS NOT NULL AND TRIM(team) != ''
                GROUP BY TRIM(team)
                HAVING SUM(LOWER(role) LIKE '%supervisor%') > 0
                ORDER BY team
            """))
        else:
            # Todos los teams únicos registrados en la BD — fuente de verdad: página de permisos
            r = await s.execute(text("""
                SELECT DISTINCT TRIM(team) AS team FROM users
                WHERE team IS NOT NULL AND TRIM(team) != ''
                ORDER BY team
            """))
        rows = r.mappings().all()

    sec = (seccion or "").strip().lower()
    teams = []
    for row in rows:
        if not row["team"]:
            continue
        tsec = team_seccion(row["team"])
        if sec and tsec != sec:
            continue
        teams.append({"value": row["team"], "label": row["team"], "seccion": tsec})
    return {"success": True, "teams": teams}


@router.get("/api/teams/agents")
async def list_agents(supervisor: str = "", user: dict = Depends(current_user)):
    if not supervisor:
        raise HTTPException(400, "Missing supervisor parameter")

    async with AsyncSessionLocal() as s:
        # Try numeric ID first
        sup_user = None
        if supervisor.isdigit():
            r = await s.execute(text("SELECT id, username, name, team FROM users WHERE id = :id LIMIT 1"), {"id": int(supervisor)})
            sup_user = r.mappings().first()
        if not sup_user:
            r = await s.execute(text("""
                SELECT id, username, name, team FROM users
                WHERE username = :s OR name = :s OR email = :s LIMIT 1
            """), {"s": supervisor})
            sup_user = r.mappings().first()

        agentes = []
        if sup_user:
            sup_name = (sup_user.get("username") or sup_user.get("name") or "").strip()
            team_cond = ""
            params: dict = {"sup_id": sup_user["id"], "sup_name": sup_name}
            if sup_user.get("team"):
                team_cond = "OR team = :team"
                params["team"] = sup_user["team"]

            r2 = await s.execute(text(f"""
                SELECT id, username, name, role FROM users
                WHERE id != :sup_id
                  AND LOWER(role) NOT LIKE '%supervisor%'
                  AND (supervisor = :sup_name {team_cond})
            """), params)
            agentes = r2.mappings().all()
        else:
            r2 = await s.execute(text("""
                SELECT id, username, name, role FROM users
                WHERE LOWER(role) NOT LIKE '%supervisor%'
                  AND (supervisor LIKE :s OR supervisor LIKE :s)
            """), {"s": f"%{supervisor}%"})
            agentes = r2.mappings().all()

    out = [
        {"id": str(a["id"]), "username": a.get("username"),
         "name": a.get("name"), "role": a.get("role")}
        for a in agentes
        if not re.search("supervisor", str(a.get("role", "")), re.IGNORECASE)
    ]
    return {"success": True, "count": len(out), "data": out}


@router.get("/api/supervisors-list")
@router.get("/api/teams/supervisors-list")
async def supervisors_list(seccion: str = "", user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT username, name, team, role FROM users
            WHERE LOWER(role) LIKE '%supervisor%'
            ORDER BY name
        """))
        supervisors = r.mappings().all()

    sec = (seccion or "").strip().lower()
    normalized = []
    for s_row in supervisors:
        tsec = team_seccion(s_row.get("team", ""), s_row.get("role", ""))
        if sec and tsec != sec:
            continue
        name = (s_row.get("name") or s_row.get("username") or "").strip()
        key = "".join(w[0].upper() for w in name.split() if w) or (s_row.get("username") or "").upper()
        normalized.append({
            "key": key, "name": name,
            "username": s_row.get("username", ""), "team": s_row.get("team", ""),
            "seccion": tsec,
        })

    return {"success": True, "supervisors": normalized}
