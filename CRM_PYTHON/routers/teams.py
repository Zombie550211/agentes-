from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId
from database import get_db
from deps import current_user, require_roles, ADMIN_ROLES
import re

router = APIRouter(tags=["Teams"])


@router.get("/api/teams")
async def list_teams(user: dict = Depends(current_user)):
    db = get_db()
    # Obtener supervisores activos de la BD
    cursor = db["users"].find(
        {"role": {"$regex": "supervisor", "$options": "i"}},
        {"username": 1, "name": 1, "nombre": 1, "fullName": 1, "team": 1}
    )
    supervisors = await cursor.to_list(None)

    teams = []
    seen = set()
    for s in supervisors:
        team_val = s.get("team", "").strip()
        if not team_val or team_val in seen:
            continue
        seen.add(team_val)
        sup_name = s.get("name") or s.get("nombre") or s.get("fullName") or s.get("username") or ""
        teams.append({
            "value":          team_val,
            "label":          team_val,
            "supervisor":     s.get("username", ""),
            "supervisorName": sup_name.strip(),
        })

    teams.sort(key=lambda t: t["value"])
    return {"success": True, "teams": teams}


@router.get("/api/teams/agents")
async def list_agents(supervisor: str = "", user: dict = Depends(current_user)):
    if not supervisor:
        raise HTTPException(400, "Missing supervisor parameter")
    db = get_db()
    users_col = db["users"]

    sup_user = None
    if re.match(r"^[a-fA-F0-9]{24}$", supervisor):
        try:
            sup_user = await users_col.find_one({"_id": ObjectId(supervisor)})
        except Exception:
            pass
    if not sup_user:
        sup_user = await users_col.find_one({
            "$or": [{"username": supervisor}, {"name": supervisor},
                    {"nombre": supervisor}, {"email": supervisor}]
        })

    agentes = []
    if sup_user:
        sup_name = (sup_user.get("username") or sup_user.get("name") or "").strip()
        or_query = [
            {"supervisorId": str(sup_user["_id"])},
        ]
        if sup_name:
            or_query += [
                {"supervisor":     {"$regex": sup_name, "$options": "i"}},
                {"supervisorName": {"$regex": sup_name, "$options": "i"}},
            ]
        if sup_user.get("team"):
            or_query.append({"team": sup_user["team"]})

        cursor = users_col.find({
            "$and": [
                {"$or": or_query},
                {"_id": {"$ne": sup_user["_id"]}},
                {"role": {"$not": re.compile("supervisor", re.IGNORECASE)}}
            ]
        })
        agentes = await cursor.to_list(None)
    else:
        cursor = users_col.find({
            "$and": [
                {"$or": [
                    {"supervisor":     {"$regex": supervisor, "$options": "i"}},
                    {"supervisorName": {"$regex": supervisor, "$options": "i"}}
                ]},
                {"role": {"$not": re.compile("supervisor", re.IGNORECASE)}}
            ]
        })
        agentes = await cursor.to_list(None)

    out = [
        {"id": str(a["_id"]), "username": a.get("username"),
         "name": a.get("name") or a.get("nombre"), "role": a.get("role")}
        for a in agentes
        if not re.search("supervisor", str(a.get("role", "")), re.IGNORECASE)
    ]
    return {"success": True, "count": len(out), "data": out}


@router.get("/api/supervisors-list")
@router.get("/api/teams/supervisors-list")
async def supervisors_list(user: dict = Depends(current_user)):
    db = get_db()
    cursor = db["users"].find(
        {"role": {"$regex": "supervisor", "$options": "i"}},
        {"username": 1, "name": 1, "nombre": 1, "fullName": 1, "team": 1, "role": 1}
    )
    supervisors = await cursor.to_list(None)

    normalized = []
    for s in supervisors:
        name = s.get("name") or s.get("nombre") or s.get("fullName") or s.get("username") or ""
        key = "".join(w[0].upper() for w in name.split() if w) or s.get("username", "").upper()
        normalized.append({
            "key": key, "name": name,
            "username": s.get("username", ""), "team": s.get("team", "")
        })

    return {"success": True, "supervisors": normalized}
