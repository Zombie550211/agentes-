"""
Migración de facturación: MongoDB → MySQL
Colecciones: Facturacion (487 docs) + FacturacionLineas (1 doc)

Uso:
    python migrate_facturacion.py

No requiere argumentos adicionales — lee .env automáticamente.
"""

import asyncio
import json
import os
import re
import sys
from datetime import datetime

if sys.platform == "win32":
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import aiomysql

load_dotenv()

MONGO_URL = os.getenv("MONGO_DETAILS")
MONGO_DB  = os.getenv("DB_NAME", "crmagente")
MYSQL_URL = os.getenv("MYSQL_URL", "mysql+aiomysql://root:@localhost:3306/crm_connecting")


# ── Parser de MySQL URL ──────────────────────────────────────────────────────
def _parse_mysql_url(url: str) -> dict:
    url = url.replace("mysql+aiomysql://", "").split("?")[0]
    userpass, rest = url.split("@", 1)
    user, password = (userpass.split(":", 1) + [""])[:2]
    hostport, dbname = rest.split("/", 1)
    host, port = (hostport.split(":") + ["3306"])[:2]
    return {"host": host, "port": int(port), "user": user,
            "password": password, "db": dbname, "charset": "utf8mb4"}

MYSQL_CFG = _parse_mysql_url(MYSQL_URL)


# ── Helpers ─────────────────────────────────────────────────────────────────
def _str(v) -> str | None:
    return str(v).strip() if v is not None else None

def _dt(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    s = str(v).strip()
    # "2025-10-09 19:03:25.397000"  →  tomar solo los primeros 19 chars
    if len(s) >= 19:
        return s[:19]
    return None

def _int(v, default=0) -> int:
    try:
        return int(v)
    except Exception:
        return default

def _json(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)

def _ensure_len(arr, n: int) -> list:
    a = [str(x) if x is not None else "" for x in (arr if isinstance(arr, list) else [])]
    while len(a) < n:
        a.append("")
    return a[:n]

def _to_fecha_key(v) -> str | None:
    s = str(v or "").strip()
    if not s:
        return None
    # DD/MM/YYYY ya OK
    if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
        return s
    # YYYY-MM-DD → DD/MM/YYYY
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m[3]}/{m[2]}/{m[1]}"
    return s


# ── CREATE TABLE (idempotente) ───────────────────────────────────────────────
CREATE_FACTURACION = """
CREATE TABLE IF NOT EXISTS facturacion (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    anio        SMALLINT     NOT NULL,
    mes         TINYINT      NOT NULL,
    dia         TINYINT      NOT NULL,
    fecha_str   VARCHAR(12)  NULL,
    campos      JSON         NOT NULL,
    created_by  VARCHAR(200) NULL,
    updated_by  VARCHAR(200) NULL,
    created_at  DATETIME     NULL,
    updated_at  DATETIME     NULL,
    UNIQUE KEY uq_facturacion_fecha (anio, mes, dia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""

CREATE_FACTURACION_LINEAS = """
CREATE TABLE IF NOT EXISTS facturacion_lineas (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    anio        SMALLINT     NOT NULL,
    mes         TINYINT      NOT NULL,
    dia         TINYINT      NOT NULL,
    fecha_str   VARCHAR(12)  NULL,
    campos      JSON         NOT NULL,
    created_by  VARCHAR(200) NULL,
    updated_by  VARCHAR(200) NULL,
    created_at  DATETIME     NULL,
    updated_at  DATETIME     NULL,
    UNIQUE KEY uq_faclineas_fecha (anio, mes, dia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


# ── Migración facturacion residencial ────────────────────────────────────────
async def migrate_facturacion(mongo_db, conn):
    print("  → Leyendo Facturacion desde MongoDB...")
    docs = await mongo_db["Facturacion"].find({}).to_list(None)
    print(f"    {len(docs)} documentos encontrados")

    cursor = await conn.cursor()

    # Crear tabla si no existe
    await cursor.execute(CREATE_FACTURACION)
    await conn.commit()

    # Ver cuántos ya existen en MySQL
    await cursor.execute("SELECT COUNT(*) FROM facturacion")
    row = await cursor.fetchone()
    existing = row[0] if row else 0
    if existing > 0:
        print(f"    ⚠  Ya existen {existing} filas en MySQL. Se usará INSERT IGNORE (no duplica).")

    ok = skip = err = 0
    for d in docs:
        try:
            anio = _int(d.get("anio"))
            mes  = _int(d.get("mes"))
            dia  = _int(d.get("dia"))
            if not (anio and mes and dia):
                # Intentar parsear desde "fecha"
                fecha_raw = str(d.get("fecha") or "").strip()
                m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", fecha_raw)
                if m:
                    dia, mes, anio = int(m[1]), int(m[2]), int(m[3])
                else:
                    print(f"    ✗ fecha inválida: {d.get('fecha')} — omitiendo")
                    err += 1
                    continue

            campos = _ensure_len(d.get("campos"), 17)
            fecha_str = _to_fecha_key(d.get("fecha")) or f"{dia:02d}/{mes:02d}/{anio}"

            await cursor.execute("""
                INSERT IGNORE INTO facturacion
                  (anio, mes, dia, fecha_str, campos, created_by, updated_by, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                anio, mes, dia, fecha_str,
                _json(campos),
                _str(d.get("createdBy")),
                _str(d.get("updatedBy")),
                _dt(d.get("createdAt")),
                _dt(d.get("updatedAt")),
            ))
            if cursor.rowcount == 0:
                skip += 1   # ya existía (IGNORE)
            else:
                ok += 1
        except Exception as e:
            print(f"    ✗ doc {d.get('fecha','?')}: {e}")
            err += 1

    await conn.commit()
    await cursor.close()
    print(f"    ✓ {ok} insertados | {skip} ya existían | {err} errores")


# ── Migración facturacion líneas ─────────────────────────────────────────────
async def migrate_facturacion_lineas(mongo_db, conn):
    print("  → Leyendo FacturacionLineas desde MongoDB...")
    docs = await mongo_db["FacturacionLineas"].find({}).to_list(None)
    print(f"    {len(docs)} documentos encontrados")

    cursor = await conn.cursor()
    await cursor.execute(CREATE_FACTURACION_LINEAS)
    await conn.commit()

    ok = skip = err = 0
    for d in docs:
        try:
            anio = _int(d.get("anio"))
            mes  = _int(d.get("mes"))
            dia  = _int(d.get("dia"))
            if not (anio and mes and dia):
                err += 1
                continue

            campos = _ensure_len(d.get("campos"), 9)
            fecha_str = _to_fecha_key(d.get("fecha")) or f"{dia:02d}/{mes:02d}/{anio}"

            await cursor.execute("""
                INSERT IGNORE INTO facturacion_lineas
                  (anio, mes, dia, fecha_str, campos, created_by, updated_by, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                anio, mes, dia, fecha_str,
                _json(campos),
                _str(d.get("createdBy")),
                _str(d.get("updatedBy")),
                _dt(d.get("createdAt")),
                _dt(d.get("updatedAt")),
            ))
            if cursor.rowcount == 0:
                skip += 1
            else:
                ok += 1
        except Exception as e:
            print(f"    ✗ doc {d.get('fecha','?')}: {e}")
            err += 1

    await conn.commit()
    await cursor.close()
    print(f"    ✓ {ok} insertados | {skip} ya existían | {err} errores")


# ── Main ─────────────────────────────────────────────────────────────────────
async def main():
    if not MONGO_URL:
        print("✗ ERROR: MONGO_DETAILS no está en .env")
        sys.exit(1)

    print("=" * 60)
    print("  MIGRACIÓN FACTURACIÓN  MongoDB → MySQL")
    print("=" * 60)
    print(f"  Mongo : {MONGO_DB}")
    print(f"  MySQL : {MYSQL_CFG['host']}:{MYSQL_CFG['port']}/{MYSQL_CFG['db']}")
    print()

    mongo_client = AsyncIOMotorClient(MONGO_URL)
    mongo_db     = mongo_client[MONGO_DB]

    import ssl as _ssl
    ssl_ctx = _ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = _ssl.CERT_NONE
    cfg = dict(MYSQL_CFG, ssl=ssl_ctx)

    conn = await aiomysql.connect(**cfg, autocommit=False)

    try:
        await migrate_facturacion(mongo_db, conn)
        print()
        await migrate_facturacion_lineas(mongo_db, conn)

        print()
        print("=" * 60)
        print("  ✓ MIGRACIÓN COMPLETADA")
        print("=" * 60)

    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        conn.close()
        mongo_client.close()


if __name__ == "__main__":
    asyncio.run(main())
