"""Dependencias de autenticación — fuente única de verdad.

Aquí viven la configuración de JWT/cookie y los helpers de sesión que usan TODOS
los routers (incluido routers/auth.py). No dupliques esta lógica en otros módulos:
si necesitas crear/decodificar tokens o leer al usuario actual, impórtalo de aquí.
"""
from fastapi import Request, Response, HTTPException, Depends
from jose import jwt, JWTError
import os, time, math

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET no configurado en variables de entorno. "
                       "Genera uno con: python -c \"import secrets; print(secrets.token_hex(32))\"")
JWT_ALGO    = "HS256"
JWT_EXPIRES = 30 * 60  # 30 min — se renueva con cada petición (expira solo por inactividad)
IS_PROD     = os.getenv("NODE_ENV") == "production"
# Debe coincidir con routers/auth.py. Por defecto "lax": el frontend usa URLs
# relativas (API_BASE_URL=''), así que todas las peticiones son same-origin
# (incluido el proxy de Netlify a /api). Lax mitiga CSRF. Poner "none" solo si
# alguna vez el frontend hace fetch cross-origin directo a la API.
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").lower()

ADMIN_ROLES  = ("Administrador", "admin", "administrador", "Administrativo")


def _get_token(request: Request) -> str | None:
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token


def make_token(user: dict) -> str:
    """Crea un JWT firmado a partir de un registro de usuario (flujo de login)."""
    now = math.floor(time.time())
    payload = {
        "id":         str(user.get("_id") or user.get("id")),
        "username":   user.get("username", ""),
        "name":       user.get("name", "") or user.get("username", ""),
        "role":       user.get("role", ""),
        "team":       user.get("team", ""),
        "supervisor": user.get("supervisor", ""),
        "iat":        now,
        "exp":        now + JWT_EXPIRES,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict | None:
    """Devuelve el payload del JWT si es válido, o None."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except JWTError:
        return None


def set_token_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="token", value=token,
        httponly=True,
        secure=IS_PROD,
        samesite=COOKIE_SAMESITE,
        max_age=JWT_EXPIRES,
        path="/",
    )


def _renew_token_cookie(response: Response, payload: dict) -> None:
    """Sliding session: re-emite el token preservando sus claims con exp fresca."""
    now = math.floor(time.time())
    new_payload = dict(payload)
    new_payload["iat"] = now
    new_payload["exp"] = now + JWT_EXPIRES
    set_token_cookie(response, jwt.encode(new_payload, JWT_SECRET, algorithm=JWT_ALGO))


async def current_user(request: Request, response: Response) -> dict:
    token = _get_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")
    decoded = decode_token(token)
    if decoded is None:
        raise HTTPException(status_code=401, detail="Token inválido")
    # Renovar el token si le queda menos de la mitad de vida —
    # mientras el usuario esté activo, la sesión nunca se cierra.
    try:
        exp = int(decoded.get("exp") or 0)
        if exp - time.time() < JWT_EXPIRES / 2:
            _renew_token_cookie(response, decoded)
    except Exception:
        pass
    return decoded


def require_roles(*roles):
    async def checker(user: dict = Depends(current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Sin permiso")
        return user
    return checker
