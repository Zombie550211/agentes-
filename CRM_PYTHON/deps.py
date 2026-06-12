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

def _get_token(request: Request) -> str | None:
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token

def _renew_token_cookie(response: Response, payload: dict):
    """Sliding session: re-emite el token con expiración fresca."""
    now = math.floor(time.time())
    new_payload = dict(payload)
    new_payload["iat"] = now
    new_payload["exp"] = now + JWT_EXPIRES
    new_token = jwt.encode(new_payload, JWT_SECRET, algorithm=JWT_ALGO)
    response.set_cookie(
        key="token", value=new_token,
        httponly=True,
        secure=IS_PROD,
        samesite="none" if IS_PROD else "lax",
        max_age=JWT_EXPIRES,
        path="/",
    )

async def current_user(request: Request, response: Response) -> dict:
    token = _get_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")
    try:
        decoded = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except JWTError:
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

ADMIN_ROLES  = ("Administrador", "admin", "administrador", "Administrativo")
ADMIN_BO     = (*ADMIN_ROLES, "Backoffice", "backoffice")
ALL_ROLES    = ("Administrador", "admin", "administrador", "Administrativo",
                "Backoffice", "backoffice", "Supervisor", "supervisor",
                "Supervisor Team Lineas", "Agente", "agente")
