from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime
from typing import Optional, List
import unicodedata, json

router = APIRouter(prefix="/api/users", tags=["Users"])

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


def _row_to_user(row) -> dict:
    u = dict(row)
    perms = u.get("permissions")
    if isinstance(perms, str):
        try: u["permissions"] = json.loads(perms)
        except: u["permissions"] = []
    elif perms is None:
        u["permissions"] = []
    u["_id"] = str(u["id"])
    return u


def _serialize(u: dict) -> dict:
    return {
        "id":          str(u.get("id") or ""),
        "_id":         str(u.get("id") or ""),
        "username":    u.get("username"),
        "name":        u.get("name") or u.get("username"),
        "email":       u.get("email"),
        "role":        u.get("role"),
        "team":        u.get("team"),
        "supervisor":  u.get("supervisor"),
        "avatar_url":  u.get("avatar_url"),
        "permissions": u.get("permissions") if isinstance(u.get("permissions"), list) else [],
        "created_at":  str(u.get("created_at") or ""),
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
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions, created_at FROM users ORDER BY username"))
        users = [_row_to_user(row) for row in r.mappings().all()]
    sanitized = [_serialize(u) for u in users]
    return {"success": True, "users": sanitized, "agents": sanitized}


@router.get("/agents")
async def agents_list(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions FROM users ORDER BY name"))
        users = [_row_to_user(row) for row in r.mappings().all()]
    return {"success": True, "agents": [_serialize(u) for u in users], "count": len(users)}


@router.put("/{user_id}/role")
async def update_role(user_id: str, body: UpdateRoleBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para actualizar usuarios")
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(400, "Rol no permitido")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, team FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Usuario no encontrado")

        final_team = body.team or row["team"]
        new_perms = ROLE_PERMS.get(body.role) or ROLE_PERMS.get(body.role.lower()) or []

        await s.execute(text("""
            UPDATE users SET role = :role, team = :team, permissions = :perms, updated_at = :now
            WHERE id = :id
        """), {
            "role": body.role, "team": final_team,
            "perms": json.dumps(new_perms),
            "now": datetime.utcnow(), "id": uid,
        })
        await s.commit()
        r2 = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions FROM users WHERE id = :id"), {"id": uid})
        updated = _row_to_user(r2.mappings().first())

    return {"success": True, "user": _serialize(updated)}


@router.put("/{user_id}/credentials")
async def update_credentials(user_id: str, body: UpdateCredentialsBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para actualizar credenciales")
    if not body.username and not body.password:
        raise HTTPException(400, "Se requiere username o password")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    import bcrypt as _bcrypt
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        if not r.first():
            raise HTTPException(404, "Usuario no encontrado")

        set_parts = ["updated_at = :now"]
        params: dict = {"now": datetime.utcnow(), "id": uid}

        if body.username:
            dup = await s.execute(text("SELECT id FROM users WHERE username = :u AND id != :id LIMIT 1"), {"u": body.username, "id": uid})
            if dup.first():
                raise HTTPException(409, "El nombre de usuario ya está en uso")
            set_parts.append("username = :username")
            params["username"] = body.username

        if body.password:
            if len(body.password) < 6:
                raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres")
            hashed = _bcrypt.hashpw(body.password[:72].encode(), _bcrypt.gensalt(rounds=10)).decode()
            set_parts.append("password_hash = :password_hash")
            params["password_hash"] = hashed

        await s.execute(text(f"UPDATE users SET {', '.join(set_parts)} WHERE id = :id"), params)
        await s.commit()
        r2 = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions FROM users WHERE id = :id"), {"id": uid})
        updated = _row_to_user(r2.mappings().first())

    return {"success": True, "user": _serialize(updated), "message": "Credenciales actualizadas"}


@router.put("/{user_id}/permissions")
async def update_permissions(user_id: str, body: UpdatePermissionsBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("UPDATE users SET permissions = :p, updated_at = :now WHERE id = :id"), {
            "p": json.dumps(body.permissions), "now": datetime.utcnow(), "id": uid,
        })
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Usuario no encontrado")

    return {"success": True, "message": "Permisos actualizados", "permissions": body.permissions}


@router.delete("/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para eliminar usuarios")

    my_id = str(user.get("id") or user.get("_id") or "")
    if my_id and my_id == user_id:
        raise HTTPException(400, "No puedes eliminar tu propia cuenta")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        if not r.first():
            raise HTTPException(404, "Usuario no encontrado")
        await s.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
        await s.commit()

    return {"success": True, "message": "Usuario eliminado correctamente"}
