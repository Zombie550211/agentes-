"""Portal de facturación — connecting.lat/portal (frontend/portal/).

Un portal aparte del CRM, con sus propios usuarios, que solo da acceso a Facturación y a
Recibos de Google Ads (los mismos datos que en el CRM: lo que se cambia en un lado se ve
en el otro). Sus usuarios NO pueden entrar al CRM:

- Viven en `portal_users`, no en `users`; el login del CRM no los conoce.
- Su sesión es la cookie `portal_token`, firmada con una clave DERIVADA de JWT_SECRET
  (no la misma): deps.decode_token no la acepta, así que ninguna API del CRM la reconoce.
  Al revés, un token del CRM tampoco vale aquí.
- Solo las APIs que usan `admin_o_portal(...)` (facturación, facturación de líneas
  publicidad y recibos de Google Ads) aceptan esta sesión, además de la del CRM.

Los usuarios del portal los crean y gestionan los administradores del CRM
(/api/portal/usuarios, página crear-cuenta.html → pestaña Portal).
"""
import hashlib
import hmac
import re
import time
from datetime import datetime
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
import jwt
from jwt import PyJWTError as JWTError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

import audit
from database_mysql import AsyncSessionLocal
from deps import ADMIN_ROLES, IS_PROD, COOKIE_SAMESITE, JWT_ALGO, JWT_SECRET, current_user, require_roles, _normalize_role
from limiter import limiter
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/portal", tags=["Portal de facturación"])
solo_admin = require_roles(*ADMIN_ROLES)

COOKIE = "portal_token"
# Clave propia del portal: HMAC de JWT_SECRET. Un token firmado con ella no pasa por
# deps.decode_token (que usa JWT_SECRET tal cual) y viceversa.
_SECRET = hmac.new(JWT_SECRET.encode(), b"portal-facturacion", hashlib.sha256).hexdigest()
_DURACION = 12 * 60 * 60            # una jornada; se renueva al usarla
_RENOVAR_SI_QUEDA = 6 * 60 * 60

_MAX_FALLOS, _BLOQUEO = 8, 15 * 60  # mismo freno por cuenta que el login del CRM
_fallos: dict[str, dict] = {}

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS portal_users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(60)  NOT NULL,
    nombre        VARCHAR(120) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    activo        TINYINT(1)   NOT NULL DEFAULT 1,
    -- Se sube al cambiar la contraseña o desactivar: invalida las sesiones abiertas.
    version       INT          NOT NULL DEFAULT 1,
    creado        DATETIME     NOT NULL,
    creado_por    VARCHAR(150) NOT NULL,
    ultimo_acceso DATETIME     NULL,
    UNIQUE KEY uq_portal_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


async def ensure_table() -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(text(CREATE_TABLE_SQL))
        await s.commit()


# ── Sesión del portal ────────────────────────────────────────────
def _token(u: dict) -> str:
    ahora = int(time.time())
    return jwt.encode({"pid": int(u["id"]), "v": int(u["version"]), "scope": "portal",
                       "iat": ahora, "exp": ahora + _DURACION}, _SECRET, algorithm=JWT_ALGO)


def _poner_cookie(response: Response, token: str) -> None:
    response.set_cookie(COOKIE, token, max_age=_DURACION, httponly=True, secure=IS_PROD,
                        samesite=COOKIE_SAMESITE, path="/")


async def _usuario_portal(request: Request, response: Optional[Response] = None) -> Optional[dict]:
    """El usuario del portal de esta petición, o None. Comprueba en la BD que siga activo
    y que la sesión sea de su contraseña actual (version)."""
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    try:
        p = jwt.decode(token, _SECRET, algorithms=[JWT_ALGO])
    except JWTError:
        return None
    if p.get("scope") != "portal":
        return None
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, nombre, activo, version FROM portal_users WHERE id = :i"),
                            {"i": p.get("pid")})
        u = r.mappings().first()
    if not u or not u["activo"] or int(u["version"]) != int(p.get("v") or 0):
        return None
    u = dict(u)
    if response is not None and int(p.get("exp", 0)) - time.time() < _RENOVAR_SI_QUEDA:
        _poner_cookie(response, _token(u))
    return u


def _como_usuario(u: dict) -> dict:
    """Forma de usuario que esperan los routers del CRM (username, role…)."""
    return {"id": f"portal:{u['id']}", "username": f"{u['nombre']} (portal)", "name": u["nombre"],
            "role": "portal", "portal": True}


def admin_o_portal(*roles):
    """Dependencia: un usuario del CRM con alguno de esos roles, o un usuario del portal.
    Solo la usan las APIs que el portal necesita (facturación y recibos de Google Ads)."""
    permitidos = {_normalize_role(r) for r in roles}

    async def checker(request: Request, response: Response):
        if request.cookies.get("token") or request.headers.get("Authorization"):
            try:
                user = await current_user(request, response)
            except HTTPException:
                user = None
            if user and _normalize_role(user.get("role")) in permitidos:
                return user
        u = await _usuario_portal(request, response)
        if u:
            return _como_usuario(u)
        raise HTTPException(401 if not request.cookies.get("token") else 403, "Sin permiso")
    return checker


# ── Login del portal ─────────────────────────────────────────────
def _hash(pwd: str) -> str:
    return bcrypt.hashpw(pwd[:72].encode(), bcrypt.gensalt(rounds=10)).decode()


def _ok(pwd: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pwd[:72].encode(), h.encode())
    except ValueError:
        return False


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=200)


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, body: LoginIn, response: Response):
    clave = body.username.strip().lower()
    f = _fallos.get(clave)
    if f and f.get("hasta", 0) > time.time():
        raise HTTPException(429, f"Demasiados intentos fallidos. Intenta de nuevo en {int(f['hasta'] - time.time()) // 60 + 1} min.")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, nombre, password_hash, activo, version FROM portal_users"
                                 " WHERE LOWER(username) = :u"), {"u": clave})
        u = r.mappings().first()
        if not u or not u["activo"] or not _ok(body.password, u["password_hash"]):
            e = _fallos.setdefault(clave, {"n": 0, "hasta": 0})
            e["n"] += 1
            if e["n"] >= _MAX_FALLOS:
                e.update(n=0, hasta=time.time() + _BLOQUEO)
            audit._log("portal_login_fallo", body.username[:60], request.client.host if request.client else "", {})
            raise HTTPException(401, "Usuario o contraseña incorrectos")
        _fallos.pop(clave, None)
        await s.execute(text("UPDATE portal_users SET ultimo_acceso = :a WHERE id = :i"),
                        {"a": ahora_sv().replace(tzinfo=None), "i": u["id"]})
        await s.commit()
    _poner_cookie(response, _token(dict(u)))
    audit._log("portal_login", u["username"], request.client.host if request.client else "", {})
    return {"success": True, "usuario": {"username": u["username"], "nombre": u["nombre"]}}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"success": True}


@router.get("/me")
async def me(request: Request, response: Response):
    u = await _usuario_portal(request, response)
    if not u:
        raise HTTPException(401, "Sin sesión")
    return {"success": True, "usuario": {"username": u["username"], "nombre": u["nombre"]}}


# ── Gestión de usuarios (administradores del CRM) ────────────────
_USUARIO = re.compile(r"^[a-z0-9][a-z0-9._-]{2,59}$")


def _validar_clave(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    if len(v) < 8 or not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
        raise ValueError("La contraseña necesita al menos 8 caracteres, con letras y números")
    return v


class UsuarioIn(BaseModel):
    username: str
    nombre: str = Field(min_length=2, max_length=120)
    password: str

    @field_validator("username")
    @classmethod
    def _u(cls, v):
        v = v.strip().lower()
        if not _USUARIO.match(v):
            raise ValueError("Usuario: de 3 a 60 caracteres, letras minúsculas, números, punto, guion o guion bajo")
        return v

    @field_validator("password")
    @classmethod
    def _p(cls, v):
        return _validar_clave(v)


class UsuarioCambio(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=2, max_length=120)
    password: Optional[str] = None
    activo: Optional[bool] = None

    @field_validator("password")
    @classmethod
    def _p(cls, v):
        return _validar_clave(v)


def _fila(u) -> dict:
    return {"id": u["id"], "username": u["username"], "nombre": u["nombre"], "activo": bool(u["activo"]),
            "creado": u["creado"].isoformat() if u["creado"] else None, "creado_por": u["creado_por"],
            "ultimo_acceso": u["ultimo_acceso"].isoformat() if u["ultimo_acceso"] else None}


@router.get("/usuarios")
async def listar_usuarios(_: dict = Depends(solo_admin)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id, username, nombre, activo, creado, creado_por, ultimo_acceso"
                                 " FROM portal_users ORDER BY activo DESC, nombre"))
        return {"success": True, "usuarios": [_fila(u) for u in r.mappings().all()]}


@router.post("/usuarios", status_code=201)
async def crear_usuario(body: UsuarioIn, request: Request, admin: dict = Depends(solo_admin)):
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text("""
                INSERT INTO portal_users (username, nombre, password_hash, creado, creado_por)
                VALUES (:u, :n, :h, :c, :por)
            """), {"u": body.username, "n": body.nombre.strip(), "h": _hash(body.password),
                   "c": ahora_sv().replace(tzinfo=None), "por": admin.get("username", "")})
            await s.commit()
    except IntegrityError:
        raise HTTPException(409, f"Ya existe el usuario {body.username}")
    audit._log("portal_usuario_crear", admin.get("username", ""), request.client.host if request.client else "",
               {"usuario": body.username})
    return {"success": True}


@router.put("/usuarios/{uid}")
async def cambiar_usuario(uid: int, body: UsuarioCambio, request: Request, admin: dict = Depends(solo_admin)):
    sets, params = [], {"i": uid}
    if body.nombre is not None:
        sets.append("nombre = :n"); params["n"] = body.nombre.strip()
    if body.password is not None:
        sets.append("password_hash = :h"); params["h"] = _hash(body.password)
    if body.activo is not None:
        sets.append("activo = :a"); params["a"] = 1 if body.activo else 0
    if not sets:
        raise HTTPException(400, "Nada que cambiar")
    if body.password is not None or body.activo is False:
        sets.append("version = version + 1")   # cierra las sesiones abiertas
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"UPDATE portal_users SET {', '.join(sets)} WHERE id = :i"), params)
        await s.commit()
    if not r.rowcount:
        raise HTTPException(404, "Usuario no encontrado")
    audit._log("portal_usuario_cambiar", admin.get("username", ""), request.client.host if request.client else "",
               {"id": uid, "campos": [k for k, v in body.model_dump().items() if v is not None and k != "password"]
                + (["password"] if body.password else [])})
    return {"success": True}
