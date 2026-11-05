"""Política de contraseñas del CRM — fuente única.

La usan todas las rutas que ponen o cambian una contraseña: alta de usuario,
cambio por administración, activar acceso al CRM y «Olvidé mi contraseña».
Antes cada una exigía algo distinto (6, 8 o nada).
"""
import re
import unicodedata

from fastapi import HTTPException

MIN_LEN = 10
MAX_LEN = 128

REGLA = "Mínimo 10 caracteres, con letras y números, y que no sea una contraseña obvia ni contenga el usuario."

# Las más usadas (y las propias de la empresa). Se comparan sin acentos ni mayúsculas.
_COMUNES = {
    "1234567890", "12345678910", "0123456789", "1111111111", "0000000000",
    "qwertyuiop", "qwerty1234", "qwerty12345", "asdfghjkl1", "password12", "password123",
    "contraseña1", "contrasena1", "contrasena123", "contraseña123", "abc1234567", "abcd123456",
    "connecting1", "connecting123", "connecting2026", "connecting2025", "crmconnecting1",
    "admin12345", "admin123456", "administrador1", "bienvenido1", "bienvenido123",
    "elsalvador1", "salvador123", "iloveyou12", "123456789a", "a123456789", "1q2w3e4r5t",
}


def _plano(s: str) -> str:
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()


def problema(password: str, username: str = "") -> str | None:
    """Motivo por el que la contraseña no vale, o None si cumple la política."""
    pwd = password or ""
    if len(pwd) < MIN_LEN:
        return f"La contraseña debe tener al menos {MIN_LEN} caracteres."
    if len(pwd) > MAX_LEN:
        return "La contraseña es demasiado larga."
    if not re.search(r"[^\W\d_]", pwd) or not re.search(r"\d", pwd):
        return "La contraseña debe combinar letras y números."
    plano = _plano(pwd)
    if plano in _COMUNES or len(set(plano)) <= 3:
        return "Esa contraseña es demasiado fácil de adivinar. Elige otra."
    user = re.sub(r"[\s._-]+", "", _plano(username))
    if len(user) >= 3 and user in re.sub(r"[\s._-]+", "", plano):
        return "La contraseña no puede contener el nombre de usuario."
    return None


def exigir(password: str, username: str = "") -> None:
    """Lanza 400 con el motivo si la contraseña no cumple la política."""
    motivo = problema(password, username)
    if motivo:
        raise HTTPException(400, motivo)
