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
    "Rol_icon":               ["read:all","write:all","export:data"],
    "rol_icon":               ["read:all","write:all","export:data"],
}

ALLOWED_ROLES = [
    "admin","Administrador","administrador","Administrativo",
    "Supervisor","supervisor","supervisora","Supervisor Team Lineas","supervisor team lineas",
    "vendedor","usuario","Agente","agente","agent",
    "Backoffice","backoffice","back office","Back Office","back_office","bo","BO","b.o","b:o",
    "Lineas-Agentes","lineas-agentes","Lineas Agentes","lineas agentes",
    "Rol_icon","rol_icon","ROL_ICON","Rol-icon","rol-icon","ROL-ICON","rolicon","RolIcon",
]

# Set normalizado para chequeo rápido case-insensitive
_ALLOWED_ROLES_LOWER = {r.lower() for r in ALLOWED_ROLES}

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
        "active":      int(u.get("active", 1)),
        "created_at":  str(u.get("created_at") or ""),
    }


class UpdateRoleBody(BaseModel):
    role: str
    team: Optional[str] = None
    supervisor: Optional[str] = None


class UpdateCredentialsBody(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    name: Optional[str] = None


class SuspendBody(BaseModel):
    active: bool


class UpdatePermissionsBody(BaseModel):
    permissions: List[str]


class MergeUsersBody(BaseModel):
    primary_id: str
    secondary_id: str


@router.post("/merge")
async def merge_users(body: MergeUsersBody, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado para unificar usuarios")
    if body.primary_id == body.secondary_id:
        raise HTTPException(400, "No puedes unificar un usuario consigo mismo")

    async with AsyncSessionLocal() as s:
        r1 = await s.execute(text("SELECT id, username, name, aliases FROM users WHERE id = :id"), {"id": body.primary_id})
        primary = r1.mappings().first()
        r2 = await s.execute(text("SELECT id, username, name FROM users WHERE id = :id"), {"id": body.secondary_id})
        secondary = r2.mappings().first()

        if not primary or not secondary:
            raise HTTPException(404, "Usuario no encontrado")

        pu  = primary["username"]
        su  = secondary["username"]
        pname = primary["name"] or pu

        updates = [
            # leads
            ("UPDATE leads SET agente=:pu, agente_nombre=:pname WHERE agente=:su",    True),
            ("UPDATE leads SET usuario=:pu WHERE usuario=:su",                         False),
            ("UPDATE leads SET created_by=:pu WHERE created_by=:su",                  False),
            ("UPDATE leads SET updated_by=:pu WHERE updated_by=:su",                  False),
            # lineas_clientes
            ("UPDATE lineas_clientes SET agente=:pu, agente_nombre=:pname WHERE agente=:su", True),
            ("UPDATE lineas_clientes SET agente_asignado=:pu WHERE agente_asignado=:su",     False),
            # lineas_internal
            ("UPDATE lineas_internal SET agente=:pu, agente_nombre=:pname WHERE agente=:su", True),
            ("UPDATE lineas_internal SET created_by=:pu WHERE created_by=:su",              False),
            ("UPDATE lineas_internal SET registered_by=:pu WHERE registered_by=:su",        False),
            # pre_leads
            ("UPDATE pre_leads SET agente_username=:pu, agente_name=:pname WHERE agente_username=:su", True),
            # activities
            ("UPDATE activities SET actor_username=:pu WHERE actor_username=:su",     False),
            # messages
            ("UPDATE messages SET from_user=:pu, from_name=:pname WHERE from_user=:su", True),
            ("UPDATE messages SET to_user=:pu, to_name=:pname WHERE to_user=:su",      True),
            # lead_comments
            ("UPDATE lead_comments SET autor=:pu WHERE autor=:su",                    False),
            # note_files
            ("UPDATE note_files SET uploaded_by=:pu WHERE uploaded_by=:su",           False),
            # media_files
            ("UPDATE media_files SET uploaded_by=:pu WHERE uploaded_by=:su",          False),
            # facturacion
            ("UPDATE facturacion SET created_by=:pu WHERE created_by=:su",            False),
            ("UPDATE facturacion SET updated_by=:pu WHERE updated_by=:su",            False),
            ("UPDATE facturacion_lineas SET created_by=:pu WHERE created_by=:su",     False),
            ("UPDATE facturacion_lineas SET updated_by=:pu WHERE updated_by=:su",     False),
        ]

        for sql, needs_name in updates:
            params = {"pu": pu, "su": su}
            if needs_name:
                params["pname"] = pname
            await s.execute(text(sql), params)

        # Guardar el username secundario como alias del primario
        try:
            existing = json.loads(primary.get("aliases") or "[]")
            if not isinstance(existing, list):
                existing = []
        except Exception:
            existing = []
        if su not in existing:
            existing.append(su)
        await s.execute(
            text("UPDATE users SET aliases=:aliases WHERE id=:id"),
            {"aliases": json.dumps(existing), "id": body.primary_id}
        )

        # Desactivar usuario secundario
        await s.execute(
            text("UPDATE users SET active=0 WHERE id=:id"),
            {"id": body.secondary_id}
        )
        await s.commit()

    return {
        "success": True,
        "message": f"'{su}' unificado con '{pu}'. El usuario duplicado fue desactivado."
    }


@router.get("/admin-list")
async def admin_list(user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado para listar usuarios")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions, active, created_at FROM users ORDER BY username"))
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
    if not body.role.strip():
        raise HTTPException(400, "El rol no puede estar vacío")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, team, supervisor FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Usuario no encontrado")

        final_team = body.team if body.team is not None else (row["team"] or "")
        final_supervisor = body.supervisor if body.supervisor is not None else (row.get("supervisor") or "")
        new_perms = ROLE_PERMS.get(body.role) or ROLE_PERMS.get(body.role.lower()) or []

        await s.execute(text("""
            UPDATE users SET role = :role, team = :team, supervisor = :supervisor,
                            permissions = :perms, updated_at = :now
            WHERE id = :id
        """), {
            "role": body.role, "team": final_team,
            "supervisor": final_supervisor,
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
    if not body.username and not body.password and not body.name:
        raise HTTPException(400, "Se requiere username, password o name")

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

        if body.name is not None:
            set_parts.append("name = :name")
            params["name"] = body.name.strip()

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


@router.put("/{user_id}/suspend")
async def suspend_user(user_id: str, body: SuspendBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado")

    my_id = str(user.get("id") or user.get("_id") or "")
    if my_id and my_id == user_id:
        raise HTTPException(400, "No puedes suspender tu propia cuenta")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        if not r.first():
            raise HTTPException(404, "Usuario no encontrado")
        await s.execute(
            text("UPDATE users SET active = :active, updated_at = :now WHERE id = :id"),
            {"active": 1 if body.active else 0, "now": datetime.utcnow(), "id": uid},
        )
        await s.commit()

    estado = "activado" if body.active else "suspendido"
    return {"success": True, "message": f"Usuario {estado} correctamente", "active": int(body.active)}


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
