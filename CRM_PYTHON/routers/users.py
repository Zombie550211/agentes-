from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user, team_seccion
import session_guard
from registro_usuarios import registrar
from datetime import datetime, timezone
from typing import Optional, List
import unicodedata, json, re


def _utcnow() -> datetime:
    """UTC naive (reemplazo de datetime.utcnow() deprecado en Python 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
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


# Roles que el CRM entiende, en su forma canónica (la que ya usa la BD). Cualquier
# variante de mayúsculas o espacios se guarda con este nombre; un rol desconocido se
# rechaza (antes se guardaba tal cual y la persona se quedaba sin acceso a nada).
ROLES_CANONICOS = {
    "administrador": "Administrador", "admin": "Administrador",
    "backoffice": "Backoffice", "back office": "Backoffice", "back_office": "Backoffice", "bo": "Backoffice",
    "rol_icon": "Rol_icon", "rol-icon": "Rol_icon", "rolicon": "Rol_icon",
    "supervisor": "Supervisor", "supervisora": "Supervisor",
    "supervisor team lineas": "Supervisor Team Lineas",
    "agente": "Agente", "agent": "Agente",
    "vendedor": "vendedor",
    "lineas-agentes": "Lineas-Agentes", "lineas agentes": "Lineas-Agentes",
}


def rol_canonico(role: str) -> str:
    k = re.sub(r"\s+", " ", unicodedata.normalize("NFD", str(role or "")).encode("ascii", "ignore").decode().strip().lower())
    if k not in ROLES_CANONICOS:
        raise HTTPException(400, f"Rol no válido: «{role}». Elige uno de la lista.")
    return ROLES_CANONICOS[k]



def validar_username(username: str) -> None:
    """Letras, números, espacio, punto, guion, guion bajo, @ y ~ (3-100). Sin < > " '
    ni otros símbolos: el usuario se muestra en todo el CRM."""
    u = str(username or "")
    if not (3 <= len(u) <= 100) or re.search(r"[<>\"'`&\\/;{}()=]", u):
        raise HTTPException(400, "El usuario debe tener entre 3 y 100 caracteres: letras, números, espacio, punto o guion.")


def validar_equipo(team: str) -> None:
    """El nombre del equipo se pinta en muchas pantallas (y en atributos onclick):
    sin comillas ni < > para que no pueda inyectar código."""
    if len(str(team or "")) > 120 or re.search(r"[<>\"'`\\;{}]", str(team or "")):
        raise HTTPException(400, "El nombre del equipo no puede llevar comillas ni los símbolos < > ; { } \\.")


async def _otros_admins_activos(s, excepto_id: int) -> int:
    """Administradores activos (por rol o con admin:full) distintos de `excepto_id`."""
    r = await s.execute(text("""
        SELECT COUNT(*) FROM users
        WHERE id != :id AND COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1
          AND (LOWER(TRIM(role)) IN ('administrador','admin','administrativo','administrador general')
               OR permissions LIKE '%admin:full%')
    """), {"id": excepto_id})
    return int(r.scalar() or 0)


def _es_admin_fila(role, permissions) -> bool:
    from deps import rol_efectivo
    return _norm_role(rol_efectivo(role, permissions)).strip() in ADMIN_ROLES


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
        except (ValueError, TypeError): u["permissions"] = []
    elif perms is None:
        u["permissions"] = []
    u["_id"] = str(u["id"])
    return u


def _serialize(u: dict, nombre_real: bool = False) -> dict:
    """nombre_real=True solo para Permisos, que edita users.name; en el resto del CRM el
    nombre visible es el username."""
    return {
        "id":          str(u.get("id") or ""),
        "_id":         str(u.get("id") or ""),
        "username":    u.get("username"),
        "name":        (u.get("name") or u.get("username")) if nombre_real else u.get("username"),
        **({"nombre_completo": u.get("nombre_completo")} if nombre_real else {}),
        "email":       u.get("email"),
        "role":        u.get("role"),
        "team":        u.get("team"),
        "supervisor":  u.get("supervisor"),
        "avatar_url":  u.get("avatar_url"),
        "permissions": u.get("permissions") if isinstance(u.get("permissions"), list) else [],
        "active":      int(u.get("active", 1)),
        "created_at":  str(u.get("created_at") or ""),
        "fecha_ingreso": str(u.get("fecha_ingreso") or ""),
        # 0 = empleado dado de alta desde Horarios, aún sin usuario (no puede entrar).
        "acceso_crm":  int(u.get("acceso_crm", 1) if u.get("acceso_crm") is not None else 1),
    }


class UpdateRoleBody(BaseModel):
    role: str
    team: Optional[str] = None
    supervisor: Optional[str] = None


class UpdateCredentialsBody(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    name: Optional[str] = None
    # Nombre legal (Horarios / Cuadratura). "" lo borra; None = no tocar.
    nombre_completo: Optional[str] = None


class SuspendBody(BaseModel):
    active: bool


class UpdatePermissionsBody(BaseModel):
    permissions: List[str]


class MergeUsersBody(BaseModel):
    primary_id: str
    secondary_id: str


@router.post("/merge")
async def merge_users(body: MergeUsersBody, user: dict = Depends(current_user)):
    # Solo administración: unificar desactiva la segunda cuenta (podía ser la de un
    # administrador) y le pasa todos sus leads.
    if not _is_admin(user):
        raise HTTPException(403, "Solo administración puede unificar usuarios")
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

    await registrar(user, "cuenta", pu, f"Unificó «{su}» con «{pu}» (el duplicado quedó desactivado)")
    return {
        "success": True,
        "message": f"'{su}' unificado con '{pu}'. El usuario duplicado fue desactivado."
    }


@router.get("/admin-list")
async def admin_list(user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado para listar usuarios")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions, "
                                 "active, created_at, fecha_ingreso, acceso_crm, nombre_completo FROM users ORDER BY username"))
        users = [_row_to_user(row) for row in r.mappings().all()]
    sanitized = [_serialize(u, nombre_real=True) for u in users]
    return {"success": True, "users": sanitized, "agents": sanitized}


@router.get("/agents")
async def agents_list(seccion: str = "", user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        # active va en la consulta: sin él _serialize lo daba siempre como 1 y las
        # páginas no podían distinguir a los usuarios suspendidos.
        r = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions, active "
                                 "FROM users WHERE COALESCE(acceso_crm, 1) = 1 ORDER BY username"))
        users = [_row_to_user(row) for row in r.mappings().all()]
    sec = (seccion or "").strip().lower()
    if sec:
        users = [u for u in users if team_seccion(u.get("team", ""), u.get("role", "")) == sec]
    return {"success": True, "agents": [_serialize(u) for u in users], "count": len(users)}


@router.get("/registro")
async def registro(tipo: str = "", limit: int = 300, user: dict = Depends(current_user)):
    """Registro de cambios de usuarios (Permisos → Registro). Solo administración."""
    if not _is_admin(user):
        raise HTTPException(403, "No autorizado")
    limit = max(1, min(int(limit or 300), 1000))
    where, params = "", {"lim": limit}
    if tipo:
        where, params["tipo"] = "WHERE tipo = :tipo", tipo
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, created_at, actor, tipo, a_quien, cambio FROM usuarios_registro
            {where} ORDER BY id DESC LIMIT :lim
        """), params)
        items = [{**dict(x), "created_at": x["created_at"].isoformat() if x["created_at"] else None}
                 for x in r.mappings().all()]
    return {"success": True, "items": items}


@router.put("/{user_id}/role")
async def update_role(user_id: str, body: UpdateRoleBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para actualizar usuarios")
    if not body.role.strip():
        raise HTTPException(400, "El rol no puede estar vacío")
    body.role = rol_canonico(body.role)

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, role, team, supervisor, permissions FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Usuario no encontrado")

        final_team = body.team if body.team is not None else (row["team"] or "")
        if body.team is not None:
            validar_equipo(body.team)
        final_supervisor = body.supervisor if body.supervisor is not None else (row.get("supervisor") or "")
        new_perms = list(ROLE_PERMS.get(body.role) or ROLE_PERMS.get(body.role.lower()) or [])
        # admin:full es un permiso dado a mano: mover a alguien de equipo (que también pasa
        # por aquí) o cambiarle el rol no debe quitárselo sin avisar.
        try:
            old_perms = json.loads(row.get("permissions") or "[]")
        except (ValueError, TypeError):
            old_perms = []
        if isinstance(old_perms, list) and "admin:full" in old_perms and "admin:full" not in new_perms:
            new_perms.append("admin:full")
        old_role, old_team = str(row.get("role") or ""), str(row.get("team") or "")
        if _es_admin_fila(old_role, row.get("permissions")) and not _es_admin_fila(body.role, json.dumps(new_perms)):
            if str(user.get("id")) == str(uid):
                raise HTTPException(400, "No puedes quitarte tu propio rol de administrador. Pídeselo a otro administrador.")
            if await _otros_admins_activos(s, uid) == 0:
                raise HTTPException(400, "Es el último administrador activo: el CRM se quedaría sin nadie que pueda gestionarlo.")

        await s.execute(text("""
            UPDATE users SET role = :role, team = :team, supervisor = :supervisor,
                            permissions = :perms, updated_at = :now
            WHERE id = :id
        """), {
            "role": body.role, "team": final_team,
            "supervisor": final_supervisor,
            "perms": json.dumps(new_perms),
            "now": _utcnow(), "id": uid,
        })
        if old_role.strip() != body.role.strip():
            await registrar(user, "rol", row["username"], f"Rol: {old_role or '—'} → {body.role}", session=s)
        if old_team.strip() != str(final_team or "").strip():
            await registrar(user, "equipo", row["username"], f"Equipo: {old_team or 'sin equipo'} → {final_team or 'sin equipo'}", session=s)
        await s.commit()
        r2 = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions FROM users WHERE id = :id"), {"id": uid})
        updated = _row_to_user(r2.mappings().first())

    # El rol nuevo no está en el token que el usuario trae: session_guard detecta
    # el desajuste y lo obliga a reloguear.
    session_guard.invalidate_user(uid)

    return {"success": True, "user": _serialize(updated)}


class UpdateFechaIngresoBody(BaseModel):
    fecha_ingreso: Optional[str] = None


@router.put("/{user_id}/fecha-ingreso")
async def update_fecha_ingreso(user_id: str, body: UpdateFechaIngresoBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para actualizar usuarios")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        prev = r.mappings().first()
        if not prev:
            raise HTTPException(404, "Usuario no encontrado")
        await registrar(user, "cuenta", prev["username"],
                        f"Fecha de ingreso: {(body.fecha_ingreso or '').strip() or 'sin fecha'}", session=s)

        await s.execute(text("""
            UPDATE users SET fecha_ingreso = :fecha_ingreso, updated_at = :now WHERE id = :id
        """), {
            "fecha_ingreso": (body.fecha_ingreso or "").strip() or None,
            "now": _utcnow(), "id": uid,
        })
        await s.commit()
        r2 = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions, fecha_ingreso FROM users WHERE id = :id"), {"id": uid})
        updated = _row_to_user(r2.mappings().first())

    return {"success": True, "user": _serialize(updated)}


@router.put("/{user_id}/credentials")
async def update_credentials(user_id: str, body: UpdateCredentialsBody, response: Response, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado para actualizar credenciales")
    if not body.username and not body.password and not body.name and body.nombre_completo is None:
        raise HTTPException(400, "Se requiere username, password, name o nombre_completo")
    nombre_completo = None
    if body.nombre_completo is not None:
        # Misma validación que Horarios (letras, espacios, guion y apóstrofo).
        from routers.horarios import NombreIn
        try:
            nombre_completo = NombreIn(nombre_completo=body.nombre_completo).nombre_completo
        except ValueError:
            raise HTTPException(400, "El nombre completo solo admite letras, espacios, guion y apóstrofo")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    import bcrypt as _bcrypt
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        prev = r.mappings().first()
        if not prev:
            raise HTTPException(404, "Usuario no encontrado")

        set_parts = ["updated_at = :now"]
        params: dict = {"now": _utcnow(), "id": uid}

        if body.name is not None:
            set_parts.append("name = :name")
            params["name"] = body.name.strip()

        if body.nombre_completo is not None:
            set_parts.append("nombre_completo = :nombre_completo")
            params["nombre_completo"] = nombre_completo

        if body.username:
            validar_username(body.username)
            dup = await s.execute(text("SELECT id FROM users WHERE username = :u AND id != :id LIMIT 1"), {"u": body.username, "id": uid})
            if dup.first():
                raise HTTPException(409, "El nombre de usuario ya está en uso")
            set_parts.append("username = :username")
            params["username"] = body.username

        if body.password:
            from politica_password import exigir
            exigir(body.password, body.username or prev["username"])
            hashed = _bcrypt.hashpw(body.password[:72].encode(), _bcrypt.gensalt(rounds=12)).decode()
            set_parts.append("password_hash = :password_hash")
            params["password_hash"] = hashed

        await s.execute(text(f"UPDATE users SET {', '.join(set_parts)} WHERE id = :id"), params)
        cambios = []
        if body.username and body.username != prev["username"]:
            cambios.append(f"usuario «{prev['username']}» → «{body.username}»")
        if body.password:
            cambios.append("contraseña")
        if body.name is not None or body.nombre_completo is not None:
            cambios.append("nombre")
        if cambios:
            await registrar(user, "cuenta", body.username or prev["username"], "Cambió " + ", ".join(cambios), session=s)
        # Contraseña o usuario nuevos: las sesiones abiertas de esa cuenta dejan de valer.
        cierra = bool(body.password) or bool(body.username and body.username != prev["username"])
        if cierra:
            from routers.auth import marcar_cambio_password
            await marcar_cambio_password(s, uid)
        await s.commit()
        r2 = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, permissions FROM users WHERE id = :id"), {"id": uid})
        updated = _row_to_user(r2.mappings().first())

    if cierra:
        session_guard.invalidate_user(uid)
        # Si se lo cambió a sí mismo, se le da una sesión nueva para que no lo saque.
        if str(user.get("id")) == str(uid):
            r3 = None
            async with AsyncSessionLocal() as s:
                r3 = (await s.execute(text("SELECT * FROM users WHERE id = :id"), {"id": uid})).mappings().first()
            if r3:
                from deps import make_token, set_token_cookie, JWT_EXPIRES
                set_token_cookie(response, make_token(dict(r3), remember=bool(user.get("remember"))), max_age=JWT_EXPIRES)
    return {"success": True, "user": _serialize(updated), "message": "Credenciales actualizadas"}


class ActivarAccesoBody(BaseModel):
    username: str
    password: str


@router.put("/{user_id}/activar-acceso")
async def activar_acceso(user_id: str, body: ActivarAccesoBody, user: dict = Depends(current_user)):
    """Da acceso al CRM a un empleado dado de alta desde Horarios (acceso_crm = 0): le
    pone usuario y contraseña al MISMO registro, así conserva sus horarios y su enlace
    con Cuadratura (crm_agent_id = users.id) en vez de duplicarse."""
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "Solo administración puede dar acceso al CRM")
    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")
    username = (body.username or "").strip()
    validar_username(username)
    from politica_password import exigir
    exigir(body.password or "", username)

    import bcrypt as _bcrypt
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, acceso_crm FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Usuario no encontrado")
        if int(row["acceso_crm"] if row["acceso_crm"] is not None else 1) == 1:
            raise HTTPException(400, "Este usuario ya tiene acceso al CRM")
        dup = await s.execute(text("SELECT id FROM users WHERE username = :u AND id != :id LIMIT 1"),
                              {"u": username, "id": uid})
        if dup.first():
            raise HTTPException(409, "El nombre de usuario ya está en uso")
        hashed = _bcrypt.hashpw(body.password[:72].encode(), _bcrypt.gensalt(rounds=12)).decode()
        await s.execute(text("""
            UPDATE users SET username = :u, password_hash = :p, acceso_crm = 1, updated_at = :now
            WHERE id = :id AND acceso_crm = 0
        """), {"u": username, "p": hashed, "now": _utcnow(), "id": uid})
        await registrar(user, "alta", username, "Dio acceso al CRM", session=s)
        await s.commit()
        r2 = await s.execute(text("SELECT id, username, name, email, role, team, supervisor, avatar_url, "
                                  "permissions, active, created_at, fecha_ingreso, acceso_crm FROM users WHERE id = :id"),
                             {"id": uid})
        activado = _row_to_user(r2.mappings().first())
    return {"success": True, "user": _serialize(activado), "message": "Acceso al CRM activado"}


@router.put("/{user_id}/permissions")
async def update_permissions(user_id: str, body: UpdatePermissionsBody, user: dict = Depends(current_user)):
    if _norm_role(user.get("role","")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado")

    try:
        uid = int(user_id)
    except ValueError:
        raise HTTPException(404, "Usuario no encontrado")

    async with AsyncSessionLocal() as s:
        prev = (await s.execute(text("SELECT username, role, permissions FROM users WHERE id = :id"), {"id": uid})).mappings().first()
        if not prev:
            raise HTTPException(404, "Usuario no encontrado")
        if _es_admin_fila(prev["role"], prev["permissions"]) and not _es_admin_fila(prev["role"], json.dumps(body.permissions)):
            if str(user.get("id")) == str(uid):
                raise HTTPException(400, "No puedes quitarte tu propio permiso de administrador. Pídeselo a otro administrador.")
            if await _otros_admins_activos(s, uid) == 0:
                raise HTTPException(400, "Es el último administrador activo: no se le puede quitar el permiso.")
        try:
            antes = set(json.loads(prev["permissions"] or "[]"))
        except (ValueError, TypeError):
            antes = set()
        despues = set(body.permissions)
        await s.execute(text("UPDATE users SET permissions = :p, updated_at = :now WHERE id = :id"), {
            "p": json.dumps(body.permissions), "now": _utcnow(), "id": uid,
        })
        if ("admin:full" in despues) != ("admin:full" in antes):
            await registrar(user, "permisos", prev["username"],
                            ("Dio" if "admin:full" in despues else "Quitó") + " «Permisos de administrador (conserva su rol)»", session=s)
        elif despues != antes:
            await registrar(user, "permisos", prev["username"], "Cambió sus permisos individuales", session=s)
        await s.commit()

    # admin:full cambia el rol efectivo: sin esto la sesión abierta lo notaría al
    # caducar la caché de session_guard en vez de al momento.
    session_guard.invalidate_user(uid)
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
        r = await s.execute(text("SELECT id, username, role, permissions FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        prev = r.mappings().first()
        if not prev:
            raise HTTPException(404, "Usuario no encontrado")
        if not body.active and _es_admin_fila(prev["role"], prev["permissions"]) and await _otros_admins_activos(s, uid) == 0:
            raise HTTPException(400, "Es el último administrador activo: no se puede suspender.")
        await s.execute(
            text("UPDATE users SET active = :active, updated_at = :now WHERE id = :id"),
            {"active": 1 if body.active else 0, "now": _utcnow(), "id": uid},
        )
        await registrar(user, "cuenta", prev["username"],
                        "Reactivó la cuenta" if body.active else "Suspendió la cuenta", session=s)
        await s.commit()

    # Sin esto la suspensión no echaría al usuario hasta que caducara su token
    # (hasta 30 días con "Recordar sesión").
    session_guard.invalidate_user(uid)

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
        r = await s.execute(text("SELECT id, username, role, permissions FROM users WHERE id = :id LIMIT 1"), {"id": uid})
        prev = r.mappings().first()
        if not prev:
            raise HTTPException(404, "Usuario no encontrado")
        if _es_admin_fila(prev["role"], prev["permissions"]) and await _otros_admins_activos(s, uid) == 0:
            raise HTTPException(400, "Es el último administrador activo: no se puede eliminar.")
        await s.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
        await registrar(user, "cuenta", prev["username"], f"Eliminó la cuenta (rol {prev['role'] or '—'})", session=s)
        await s.commit()

    session_guard.invalidate_user(uid)

    return {"success": True, "message": "Usuario eliminado correctamente"}
