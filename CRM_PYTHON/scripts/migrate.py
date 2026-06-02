"""
Script de migración — ejecutar una sola vez para agregar columnas faltantes.
Uso: python migrate.py
"""
import asyncio, sys, warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from database_mysql import engine
from sqlalchemy import text

MIGRATIONS = [
    ("imagen_url en lineas_clientes",
     "ALTER TABLE lineas_clientes ADD COLUMN imagen_url VARCHAR(500) NULL AFTER fuente"),
]

async def run():
    async with engine.begin() as conn:
        for name, sql in MIGRATIONS:
            # Verificar si ya existe la columna
            check = await conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema = DATABASE() "
                "AND table_name = :tbl AND column_name = :col"
            ), {"tbl": sql.split()[2], "col": sql.split()[-3]})
            exists = check.scalar()
            if exists:
                print(f"[OK] '{name}' ya existe, saltando.")
            else:
                await conn.execute(text(sql))
                print(f"[OK] '{name}' creada correctamente.")

asyncio.run(run())
print("Migración completada.")
