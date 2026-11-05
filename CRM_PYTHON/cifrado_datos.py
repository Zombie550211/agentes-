"""Cifrado de datos sensibles en la base de datos (hoy: el PIN de seguridad de Líneas).

El PIN sirve para entrar a la cuenta del cliente con la compañía: no debe quedar legible
en la BD, en sus copias de seguridad ni en un volcado. Se cifra con Fernet (AES-128-CBC +
HMAC-SHA256) usando la clave CRM_DATA_KEY del .env, y se guarda como «enc1:<token>».

- Sin CRM_DATA_KEY la app sigue funcionando y guarda en claro (con aviso en el log), para
  que un despliegue sin la clave no rompa nada.
- Los valores antiguos en claro se leen tal cual y `cifrar_pendientes()` los cifra al
  arrancar, una vez puesta la clave.
- PERDER LA CLAVE = PERDER LOS PIN cifrados. Debe tener copia fuera del servidor.
"""
import os

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text

PREFIJO = "enc1:"
_fernet = None
_avisado = False


def _f():
    global _fernet, _avisado
    if _fernet is None:
        clave = os.getenv("CRM_DATA_KEY", "").strip()
        if not clave:
            if not _avisado:
                print("[cifrado] CRM_DATA_KEY no está definida: los PIN se guardan sin cifrar")
                _avisado = True
            return None
        _fernet = Fernet(clave.encode())
    return _fernet


def cifrar(valor):
    """Cifra un texto; vacío, ya cifrado o sin clave → igual que llegó."""
    if valor is None:
        return None
    v = str(valor)
    if not v or v.startswith(PREFIJO):
        return v
    f = _f()
    if f is None:
        return v
    return PREFIJO + f.encrypt(v.encode()).decode()


def descifrar(valor):
    """Descifra «enc1:…»; cualquier otro valor (en claro, vacío) se devuelve tal cual."""
    if not isinstance(valor, str) or not valor.startswith(PREFIJO):
        return valor
    f = _f()
    if f is None:
        return ""
    try:
        return f.decrypt(valor[len(PREFIJO):].encode()).decode()
    except InvalidToken:
        print("[cifrado] no se pudo descifrar un PIN (¿cambió CRM_DATA_KEY?)")
        return ""


def descifrar_fila(d: dict) -> dict:
    """Descifra en sitio los campos sensibles de una fila ya convertida a dict."""
    if isinstance(d, dict) and "pin_seguridad" in d:
        d["pin_seguridad"] = descifrar(d.get("pin_seguridad"))
    return d


async def cifrar_pendientes(session) -> int:
    """Cifra los PIN que siguen en claro (idempotente). Devuelve cuántos cifró."""
    if _f() is None:
        return 0
    r = await session.execute(text(
        "SELECT id, pin_seguridad FROM lineas_clientes "
        "WHERE pin_seguridad IS NOT NULL AND pin_seguridad <> '' AND pin_seguridad NOT LIKE 'enc1:%'"))
    filas = r.all()
    for fid, pin in filas:
        await session.execute(text("UPDATE lineas_clientes SET pin_seguridad = :p, updated_at = updated_at WHERE id = :id"),
                              {"p": cifrar(pin), "id": fid})
    await session.commit()
    return len(filas)
