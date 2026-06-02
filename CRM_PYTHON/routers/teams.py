from fastapi import APIRouter, Depends, HTTPException
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, require_roles, ADMIN_ROLES
import re

router = APIRouter(tags=["Teams"])


@router.get("/api/teams")
async def list_teams(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        # Todos los teams únicos registrados en la BD — fuente de verdad: página de permisos
        r = await s.execute(text("""
            SELECT DISTINCT TRIM(team) AS team FROM users
            WHERE team IS NOT NULL AND TRIM(team) != ''
            ORDER BY team
        """))
        rows = r.mappings().all()

    teams = [{"value": row["team"], "label": row["team"]} for row in rows if row["team"]]
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
async def supervisors_list(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT username, name, team, role FROM users
            WHERE LOWER(role) LIKE '%supervisor%'
            ORDER BY name
        """))
        supervisors = r.mappings().all()

    normalized = []
    for s_row in supervisors:
        name = (s_row.get("name") or s_row.get("username") or "").strip()
        key = "".join(w[0].upper() for w in name.split() if w) or (s_row.get("username") or "").upper()
        normalized.append({
            "key": key, "name": name,
            "username": s_row.get("username", ""), "team": s_row.get("team", "")
        })

    return {"success": True, "supervisors": normalized}
