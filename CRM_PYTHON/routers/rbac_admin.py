"""Roles y permisos editables (Permisos → Roles y permisos). Ver rbac.py.

- Ver: quien puede gestionar usuarios o roles.
- Cambiar: solo quien tiene «roles.gestionar».
Cada cambio queda en el Registro de cambios y se aplica al momento (recarga la caché).
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import rbac
from database_mysql import AsyncSessionLocal
from deps import current_user
from registro_usuarios import registrar

router = APIRouter(prefix="/api/rbac", tags=["Roles y permisos"])


def _puede_ver(user: dict) -> None:
    if not (rbac.tiene(user, "roles.gestionar") or rbac.tiene(user, "usuarios.gestionar")):
        raise HTTPException(403, "No autorizado")


async def _usuarios_por_rol(s) -> dict:
    r = await s.execute(text("""SELECT role, COUNT(*) FROM users
                                WHERE COALESCE(active,1)=1 AND COALESCE(acceso_crm,1)=1 GROUP BY role"""))
    n: dict = {}
    for role, c in r.all():
        k = rbac.rol_canonico(role) or role
        n[k] = n.get(k, 0) + int(c)
    return n


@router.get("")
async def ver(user: dict = Depends(current_user)):
    _puede_ver(user)
    async with AsyncSessionLocal() as s:
        roles = [dict(x) for x in (await s.execute(text(
            "SELECT clave, nombre, descripcion, orden, sistema, activo FROM roles ORDER BY orden, nombre"))).mappings().all()]
        perms: dict = {}
        for rol, acc in (await s.execute(text("SELECT rol, accion FROM rol_permisos"))).all():
            if acc in rbac.CLAVES:
                perms.setdefault(rol, []).append(acc)
        n = await _usuarios_por_rol(s)
    for r in roles:
        r["usuarios"] = n.get(r["clave"], 0)
    return {
        "success": True,
        "roles": roles,
        "acciones": [{"clave": c, "modulo": m, "etiqueta": e, "descripcion": d} for c, m, e, d, _ in rbac.ACCIONES],
        "permisos": perms,
        "protegidas_admin": sorted(rbac.PROTEGIDAS_ADMIN),
        "rol_admin": rbac.ADMIN,
        "puede_editar": rbac.tiene(user, "roles.gestionar"),
    }


@router.get("/mios")
async def mis_permisos(user: dict = Depends(current_user)):
    """Acciones del usuario conectado (para que las pantallas muestren u oculten botones)."""
    return {"success": True, "rol": rbac.rol_canonico(user.get("role")) or user.get("role"),
            "acciones": sorted(rbac.acciones_de(user))}


_NOMBRE_RE = re.compile(r"^[\w áéíóúñÁÉÍÓÚÑ.-]{3,60}$")


class RolNuevo(BaseModel):
    nombre: str = Field(..., min_length=3, max_length=60)
    descripcion: str = Field("", max_length=300)
    copiar_de: str | None = None


class RolCambio(BaseModel):
    nombre: str | None = Field(None, min_length=3, max_length=60)
    descripcion: str | None = Field(None, max_length=300)
    activo: bool | None = None


class Permisos(BaseModel):
    acciones: list[str]


@router.post("/roles")
async def crear_rol(body: RolNuevo, user: dict = Depends(rbac.requiere("roles.gestionar"))):
    nombre = " ".join(body.nombre.split())
    if not _NOMBRE_RE.match(nombre):
        raise HTTPException(400, "El nombre del rol solo admite letras, números, espacio, punto y guion.")
    if rbac.rol_canonico(nombre) or any(rbac.norm(r["clave"]) == rbac.norm(nombre) for r in rbac.roles_cache()):
        raise HTTPException(409, "Ya existe un rol con ese nombre.")
    copiar = rbac.rol_canonico(body.copiar_de) if body.copiar_de else None
    async with AsyncSessionLocal() as s:
        await s.execute(text("""INSERT INTO roles (clave, nombre, descripcion, orden, sistema, activo)
                                VALUES (:c, :n, :d, 50, 0, 1)"""),
                        {"c": nombre, "n": nombre, "d": body.descripcion.strip()})
        if copiar:
            await s.execute(text("""INSERT INTO rol_permisos (rol, accion)
                                    SELECT :n, accion FROM rol_permisos WHERE rol = :c"""), {"n": nombre, "c": copiar})
        await registrar(user, "rol", nombre, "Creó el rol" + (f" copiando los permisos de {copiar}" if copiar else " sin permisos"), session=s)
        await s.commit()
    await rbac.recargar()
    return {"success": True, "clave": nombre}


@router.put("/roles/{clave}")
async def cambiar_rol(clave: str, body: RolCambio, user: dict = Depends(rbac.requiere("roles.gestionar"))):
    async with AsyncSessionLocal() as s:
        row = (await s.execute(text("SELECT clave, nombre, sistema, activo FROM roles WHERE clave = :c"),
                               {"c": clave})).mappings().first()
        if not row:
            raise HTTPException(404, "Rol no encontrado")
        sets, p, cambios = [], {"c": clave}, []
        if body.nombre is not None and body.nombre.strip() != row["nombre"]:
            if not _NOMBRE_RE.match(body.nombre.strip()):
                raise HTTPException(400, "El nombre solo admite letras, números, espacio, punto y guion.")
            sets.append("nombre = :n"); p["n"] = body.nombre.strip(); cambios.append(f"nombre «{row['nombre']}» → «{p['n']}»")
        if body.descripcion is not None:
            sets.append("descripcion = :d"); p["d"] = body.descripcion.strip(); cambios.append("descripción")
        if body.activo is not None and bool(body.activo) != bool(row["activo"]):
            if not body.activo:
                if clave == rbac.ADMIN:
                    raise HTTPException(400, "El rol Administrador no se puede desactivar.")
                n = (await _usuarios_por_rol(s)).get(clave, 0)
                if n:
                    raise HTTPException(400, f"Lo tienen {n} persona(s) activas: cámbiales el rol antes de desactivarlo.")
            sets.append("activo = :a"); p["a"] = 1 if body.activo else 0
            cambios.append("lo activó" if body.activo else "lo desactivó")
        if not sets:
            return {"success": True}
        await s.execute(text(f"UPDATE roles SET {', '.join(sets)} WHERE clave = :c"), p)
        await registrar(user, "rol", clave, "Rol: " + ", ".join(cambios), session=s)
        await s.commit()
    await rbac.recargar()
    return {"success": True}


@router.delete("/roles/{clave}")
async def borrar_rol(clave: str, user: dict = Depends(rbac.requiere("roles.gestionar"))):
    async with AsyncSessionLocal() as s:
        row = (await s.execute(text("SELECT sistema FROM roles WHERE clave = :c"), {"c": clave})).first()
        if not row:
            raise HTTPException(404, "Rol no encontrado")
        if row[0]:
            raise HTTPException(400, "Es un rol de los de siempre: se puede desactivar, no borrar.")
        r = await s.execute(text("SELECT COUNT(*) FROM users WHERE role = :c"), {"c": clave})
        if int(r.scalar() or 0):
            raise HTTPException(400, "Hay personas con este rol (activas o suspendidas): cámbiales el rol antes de borrarlo.")
        await s.execute(text("DELETE FROM rol_permisos WHERE rol = :c"), {"c": clave})
        await s.execute(text("DELETE FROM roles WHERE clave = :c"), {"c": clave})
        await registrar(user, "rol", clave, "Borró el rol", session=s)
        await s.commit()
    await rbac.recargar()
    return {"success": True}


@router.put("/roles/{clave}/permisos")
async def guardar_permisos(clave: str, body: Permisos, user: dict = Depends(rbac.requiere("roles.gestionar"))):
    nuevas = set(body.acciones)
    desconocidas = nuevas - rbac.CLAVES
    if desconocidas:
        raise HTTPException(400, f"Acciones desconocidas: {', '.join(sorted(desconocidas))}")
    if clave == rbac.ADMIN and not rbac.PROTEGIDAS_ADMIN <= nuevas:
        raise HTTPException(400, "Al Administrador no se le puede quitar gestionar usuarios ni gestionar roles.")
    async with AsyncSessionLocal() as s:
        if not (await s.execute(text("SELECT 1 FROM roles WHERE clave = :c"), {"c": clave})).first():
            raise HTTPException(404, "Rol no encontrado")
        antes = {a for (a,) in (await s.execute(text("SELECT accion FROM rol_permisos WHERE rol = :c"), {"c": clave})).all()}
        dar, quitar = nuevas - antes, (antes & rbac.CLAVES) - nuevas
        for a in dar:
            await s.execute(text("INSERT IGNORE INTO rol_permisos (rol, accion) VALUES (:c, :a)"), {"c": clave, "a": a})
        for a in quitar:
            await s.execute(text("DELETE FROM rol_permisos WHERE rol = :c AND accion = :a"), {"c": clave, "a": a})
        etiqueta = {c: e for c, _m, e, _d, _r in rbac.ACCIONES}
        for a in sorted(dar):
            await registrar(user, "permisos", f"Rol {clave}", f"Dio «{etiqueta[a]}»", session=s)
        for a in sorted(quitar):
            await registrar(user, "permisos", f"Rol {clave}", f"Quitó «{etiqueta[a]}»", session=s)
        await s.commit()
    await rbac.recargar()
    return {"success": True, "dados": sorted(dar), "quitados": sorted(quitar)}
