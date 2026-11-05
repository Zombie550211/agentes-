"""Registro de cambios de usuarios (Permisos → Registro).

Cada cambio que administración hace sobre una cuenta (alta, rol, equipo, contraseña,
estado, permiso de administrador, mercado, unificar, eliminar) deja una fila en
`usuarios_registro` (migración 0091 en main.py). Lo lee GET /api/users/registro.

`registrar()` nunca lanza: si falla, el cambio de negocio ya está hecho y no debe
romperse por no poder anotarlo.
"""
from sqlalchemy import text

from database_mysql import AsyncSessionLocal

TIPOS = ("alta", "rol", "equipo", "permisos", "cuenta", "mercado")  # «rol» también = crear o cambiar un rol


async def registrar(actor: dict, tipo: str, a_quien: str, cambio: str, session=None) -> None:
    try:
        params = {
            "actor": str((actor or {}).get("username") or "")[:150],
            "tipo": tipo if tipo in TIPOS else "cuenta",
            "a_quien": str(a_quien or "")[:150],
            "cambio": str(cambio or "")[:500],
        }
        sql = text("""INSERT INTO usuarios_registro (actor, tipo, a_quien, cambio)
                      VALUES (:actor, :tipo, :a_quien, :cambio)""")
        if session is not None:
            await session.execute(sql, params)
            return
        async with AsyncSessionLocal() as s:
            await s.execute(sql, params)
            await s.commit()
    except Exception as e:
        print(f"[registro-usuarios] no se pudo anotar ({tipo} {a_quien}): {e}")
