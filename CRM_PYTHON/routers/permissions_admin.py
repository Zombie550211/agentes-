"""
CRUD del catálogo administrable de permisos y sus asignaciones por equipo/usuario.

Consumido por la pestaña "Permisos avanzados" y el modal "Permisos del equipo" de
frontend/crear-cuenta.html. Ver permissions_data.py (catálogo/seed) y permissions.py
(resolución en tiempo real usada por leads/ranking/equipo).
"""
import json
import unicodedata
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user

router = APIRouter(tags=["Permisos"])

ADMIN_ROLES = {"admin", "administrador", "administrativo", "administrador general"}


def _norm_role(r: str) -> str:
    return unicodedata.normalize("NFD", str(r or "")).encode("ascii", "ignore").decode().lower().strip()


def _require_admin(user: dict) -> None:
    if _norm_role(user.get("role", "")) not in ADMIN_ROLES:
        raise HTTPException(403, "No autorizado")


class PermDefBody(BaseModel):
    perm_key:    str
    label:       str
    description: Optional[str] = ""
    group_name:  Optional[str] = "General"
    scope:       Optional[str] = "user"   # 'user' | 'team' | 'both'


class PermDefUpdateBody(BaseModel):
    label:       Optional[str] = None
    description: Optional[str] = None
    group_name:  Optional[str] = None
    scope:       Optional[str] = None
    active:      Optional[bool] = None


class AssignmentBody(BaseModel):
    perm_key:    str
    scope_type:  str              # 'user' | 'team'
    scope_value: str
    enabled:     Optional[bool] = True
    config:      Optional[dict] = None


# ── Definiciones (catálogo) ──────────────────────────────────────
@router.get("/api/permission-defs")
async def list_permission_defs(user: dict = Depends(current_user)):
    _require_admin(user)
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, perm_key, label, description, group_name, scope,
                   enforced, is_system, active, created_by, created_at
            FROM permission_definitions ORDER BY group_name, label
        """))
        rows = [dict(x) for x in r.mappings().all()]
    return {"success": True, "items": rows, "count": len(rows)}


@router.post("/api/permission-defs")
async def create_permission_def(body: PermDefBody, user: dict = Depends(current_user)):
    _require_admin(user)
    perm_key = (body.perm_key or "").strip()
    label = (body.label or "").strip()
    if not perm_key or not label:
        raise HTTPException(400, "perm_key y label son requeridos")
    if body.scope not in ("user", "team", "both"):
        raise HTTPException(400, "scope inválido")
    async with AsyncSessionLocal() as s:
        existing = await s.execute(text("SELECT id FROM permission_definitions WHERE perm_key = :k"), {"k": perm_key})
        if existing.first():
            raise HTTPException(409, "Ya existe un permiso con esa key")
        # Todo permiso creado desde la UI queda enforced=0 (informativo) hasta que se
        # programe la lógica que lo aplique — no hay forma de "inventar" la restricción.
        await s.execute(text("""
            INSERT INTO permission_definitions
                (perm_key, label, description, group_name, scope, enforced, is_system, created_by)
            VALUES (:k, :l, :d, :g, :s, 0, 0, :by)
        """), {
            "k": perm_key, "l": label, "d": body.description or "",
            "g": body.group_name or "General", "s": body.scope,
            "by": user.get("username", ""),
        })
        await s.commit()
    return {"success": True, "perm_key": perm_key}


@router.put("/api/permission-defs/{def_id}")
async def update_permission_def(def_id: int, body: PermDefUpdateBody, user: dict = Depends(current_user)):
    _require_admin(user)
    async with AsyncSessionLocal() as s:
        row = await s.execute(text("SELECT is_system FROM permission_definitions WHERE id = :id"), {"id": def_id})
        rec = row.mappings().first()
        if not rec:
            raise HTTPException(404, "No encontrado")

        set_parts, params = [], {"id": def_id}
        if body.label is not None:
            set_parts.append("label = :label"); params["label"] = body.label
        if body.description is not None:
            set_parts.append("description = :description"); params["description"] = body.description
        if body.group_name is not None:
            set_parts.append("group_name = :group_name"); params["group_name"] = body.group_name
        if body.scope is not None:
            if body.scope not in ("user", "team", "both"):
                raise HTTPException(400, "scope inválido")
            set_parts.append("scope = :scope"); params["scope"] = body.scope
        if body.active is not None:
            set_parts.append("active = :active"); params["active"] = body.active

        if not set_parts:
            return {"success": True}

        await s.execute(text(f"UPDATE permission_definitions SET {', '.join(set_parts)} WHERE id = :id"), params)
        await s.commit()
    return {"success": True}


@router.delete("/api/permission-defs/{def_id}")
async def delete_permission_def(def_id: int, user: dict = Depends(current_user)):
    _require_admin(user)
    async with AsyncSessionLocal() as s:
        row = await s.execute(text("SELECT perm_key, is_system FROM permission_definitions WHERE id = :id"), {"id": def_id})
        rec = row.mappings().first()
        if not rec:
            raise HTTPException(404, "No encontrado")
        if rec["is_system"]:
            raise HTTPException(400, "Es un permiso del sistema: no se puede eliminar")
        await s.execute(text("DELETE FROM permission_assignments WHERE perm_key = :k"), {"k": rec["perm_key"]})
        await s.execute(text("DELETE FROM permission_definitions WHERE id = :id"), {"id": def_id})
        await s.commit()
    return {"success": True}


# ── Asignaciones (por equipo o por usuario) ──────────────────────
@router.get("/api/permission-assignments")
async def list_assignments(scope_type: Optional[str] = None, scope_value: Optional[str] = None,
                            user: dict = Depends(current_user)):
    _require_admin(user)
    where, params = ["1=1"], {}
    if scope_type:
        where.append("scope_type = :st"); params["st"] = scope_type
    if scope_value:
        where.append("scope_value = :sv"); params["sv"] = scope_value
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, perm_key, scope_type, scope_value, config, enabled, created_at
            FROM permission_assignments WHERE {' AND '.join(where)}
            ORDER BY perm_key
        """), params)
        rows = [dict(x) for x in r.mappings().all()]
    for row in rows:
        if isinstance(row.get("config"), str):
            try: row["config"] = json.loads(row["config"])
            except (ValueError, TypeError): row["config"] = None
    return {"success": True, "items": rows, "count": len(rows)}


@router.put("/api/permission-assignments")
async def upsert_assignment(body: AssignmentBody, user: dict = Depends(current_user)):
    _require_admin(user)
    if body.scope_type not in ("user", "team"):
        raise HTTPException(400, "scope_type inválido")
    if not body.scope_value.strip():
        raise HTTPException(400, "scope_value es requerido")
    async with AsyncSessionLocal() as s:
        exists = await s.execute(text("SELECT id FROM permission_definitions WHERE perm_key = :k"), {"k": body.perm_key})
        if not exists.first():
            raise HTTPException(404, "El permiso no existe en el catálogo")
        await s.execute(text("""
            INSERT INTO permission_assignments (perm_key, scope_type, scope_value, config, enabled, created_by)
            VALUES (:k, :st, :sv, :cfg, :en, :by)
            ON DUPLICATE KEY UPDATE config = :cfg, enabled = :en
        """), {
            "k": body.perm_key, "st": body.scope_type, "sv": body.scope_value.strip(),
            "cfg": json.dumps(body.config) if body.config else None,
            "en": body.enabled, "by": user.get("username", ""),
        })
        await s.commit()
    return {"success": True}


@router.delete("/api/permission-assignments/{assignment_id}")
async def delete_assignment(assignment_id: int, user: dict = Depends(current_user)):
    _require_admin(user)
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM permission_assignments WHERE id = :id"), {"id": assignment_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "No encontrado")
    return {"success": True}
