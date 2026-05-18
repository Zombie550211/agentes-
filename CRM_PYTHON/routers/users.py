from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from bson import ObjectId
from database import get_db
from deps import current_user
from datetime import datetime
from typing import Optional, List
import unicodedata
from passlib.context import CryptContext

router = APIRouter(prefix="/api/users", tags=["Users"])

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

ROLE_PERMS = {
    "Administrador":          ["read:all","write:all","delete:all","manage:users","manage:employees"],
    "administrador":          ["read:all","write:all","delete:all","manage:users","manage:employees"],
    "admin":                  ["read:all","write:all","delete:all","manage:users","manage:employees"],
    "Backoffice":             ["read:all","write:all","export:data"],
    "backoffice":             ["read:all","write:all","export:data"],
    "Supervisor":             ["read:team","write:team","view:reports"],
    "supervisor":             ["read:team","write:team","view:reports"],
    "Agente":                 ["read:own","write:own"],
    "agente":                 ["read:own","write:own"],
    "vendedor":               ["read:own","write:own"],
    "Lineas-Agentes":         ["read:own:lineas","write:own:lineas","form:lineas"],
    "Supervisor Team Lineas": ["read:team:lineas","write:team:lineas","manage:lineas"],
}

ALLOWED_ROLES = [
    "admin","Administrador","administrador","Administrativo",
    "supervisor","supervisora",
    "vendedor","usuario","agente","agent",
    "backoffice","back office","Back Office","back_office","bo","BO","b.o","b:o",
]

ADMIN_ROLES = {"admin","administrador","administrativo","administrador general"}


def _norm_role(r: str) -> str:
    return unicodedata.normalize("NFD", str(r or "")).encode("ascii","ignore").decode().lower()


def _is_admin(user: dict) -> bool:
    return _norm_role(user.get("role","")) in ADMIN_ROLES


def _is_admin_or_bo(user: dict) -> bool:
    r = _norm_role(user.get("role",""))
    return "admin" in r or "backoffice" in r


def _oid(user_id: str):
    try:
        return ObjectId(str(user_id))
    except Exception:
        return None


def _filter_by_id(user_id: str):
    oid = _oid(user_id)
    return {"_id": oid} if oid else {"_id": str(user_id)}


def _serialize(u: dict) -> dict:
    return {
        "id": str(u.get("_id") or ""),
        "username": u.get("username"),
        "name": u.get("name") or u.get("fullName") or u.get("nombre") or u.get("username"),
        "email": u.get("email"),
        "role": u.get("role"),
        "team": u.get("team"),
        "equipo": u.get("equipo"),
        "TEAM": u.get("TEAM"),
        "Team": u.get("Team"),
        "supervisor": u.get("supervisor"),
        "supervisorName": u.get("supervisorName") or u.get("supervisor_nombre") or u.get("supervisorNombre"),
        "supervisorId": str(u["supervisorId"]) if u.get("supervisorId") else None,
        "supervisor_id": str(u["supervisor_id"]) if u.get("supervisor_id") else None,
        "supervisorObjId": str(u["supervisorObjId"]) if u.get("supervisorObjId") else None,
        "supervisorObjectId": str(u["supervisorObjectId"]) if u.get("supervisorObjectId") else None,
        "permissions": u.get("permissions") if isinstance(u.get("permissions"), list) else [],
        "createdAt": u.get("createdAt"),
    }


class UpdateRoleBody(BaseModel):
    role: str
    team: Optional[str] = None


class UpdateCredentialsBody(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


class UpdatePermissionsBody(BaseModel):
    permissions: List[str]


@router.get("/admin-list")
async def admin_list(user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado para listar usuarios")
    db = get_db()
    users = await db["users"].find({}, {"password": 0}).sort("username", 1).to_list(None)
    sanitized = [_serialize(u) for u in users]
    return {"success": True, "users": sanitized, "agents": sanitized}


@router.get("/agents")
async def agents_list(user: dict = Depends(current_user)):
    db = get_db()
    projection = {
        "username":1,"name":1,"nombre":1,"fullName":1,"email":1,
        "role":1,"rol":1,"roles":1,"cargo":1,"team":1,
        "supervisor":1,"supervisorName":1,"supervisorId":1,
        "manager":1,"managerId":1,"avatarUrl":1,"avatarFileId":1,
        "avatarUpdatedAt":1,"photoUrl":1,"photo":1,"imageUrl":1,
        "picture":1,"profilePhoto":1,"avatar":1,"_id":1,"id":1,
    }
    users = await db["users"].find({}, projection).sort("name", 1).to_list(None)
    for u in users:
        u["_id"] = str(u["_id"])
    return {"success": True, "agents": users, "count": len(users)}


@router.put("/{user_id}/role")
async def update_role(user_id: str, body: UpdateRoleBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para actualizar usuarios")
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(400, "Rol no permitido")

    db = get_db()
    filt = _filter_by_id(user_id)
    current_doc = await db["users"].find_one(filt)
    if not current_doc:
        raise HTTPException(404, "Usuario no encontrado")

    final_team = body.team or current_doc.get("team")
    new_perms = ROLE_PERMS.get(body.role) or ROLE_PERMS.get(body.role.lower()) or []

    update = {"$set": {
        "role": body.role, "team": final_team,
        "permissions": new_perms,
        "updatedAt": datetime.utcnow(),
        "updatedBy": user.get("username","system"),
    }}
    await db["users"].update_one(filt, update)
    updated = await db["users"].find_one(filt, {"password": 0})
    if updated:
        updated["_id"] = str(updated["_id"])
    return {"success": True, "user": updated}


@router.put("/{user_id}/credentials")
async def update_credentials(user_id: str, body: UpdateCredentialsBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para actualizar credenciales")

    if not body.username and not body.password:
        raise HTTPException(400, "Se requiere username o password")

    db = get_db()
    filt = _filter_by_id(user_id)
    if not await db["users"].find_one(filt):
        raise HTTPException(404, "Usuario no encontrado")

    set_fields: dict = {"updatedAt": datetime.utcnow(), "updatedBy": user.get("username","system")}
    if body.username:
        existing = await db["users"].find_one({"username": body.username})
        if existing and str(existing["_id"]) != user_id:
            raise HTTPException(409, "El nombre de usuario ya está en uso")
        set_fields["username"] = body.username
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres")
        set_fields["password"] = pwd_ctx.hash(body.password)

    await db["users"].update_one(filt, {"$set": set_fields})
    updated = await db["users"].find_one(filt, {"password": 0})
    if updated:
        updated["_id"] = str(updated["_id"])
    return {"success": True, "user": updated, "message": "Credenciales actualizadas"}


@router.put("/{user_id}/permissions")
async def update_permissions(user_id: str, body: UpdatePermissionsBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado")

    db = get_db()
    filt = _filter_by_id(user_id)
    result = await db["users"].update_one(
        filt,
        {"$set": {"permissions": body.permissions, "updatedAt": datetime.utcnow(), "updatedBy": user.get("username","system")}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Usuario no encontrado")
    return {"success": True, "message": "Permisos actualizados", "permissions": body.permissions}


@router.delete("/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para eliminar usuarios")

    my_id = str(user.get("id") or user.get("_id") or "")
    if my_id and my_id == user_id:
        raise HTTPException(400, "No puedes eliminar tu propia cuenta")

    db = get_db()
    filt = _filter_by_id(user_id)
    if not await db["users"].find_one(filt):
        raise HTTPException(404, "Usuario no encontrado")
    await db["users"].delete_one(filt)
    return {"success": True, "message": "Usuario eliminado correctamente"}
