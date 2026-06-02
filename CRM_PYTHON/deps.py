from fastapi import Request, HTTPException, Depends
from jose import jwt, JWTError
import os

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET no configurado en variables de entorno. "
                       "Genera uno con: python -c \"import secrets; print(secrets.token_hex(32))\"")
JWT_ALGO   = "HS256"

def _get_token(request: Request) -> str | None:
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token

async def current_user(request: Request) -> dict:
    token = _get_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="No autenticado")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido")

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
