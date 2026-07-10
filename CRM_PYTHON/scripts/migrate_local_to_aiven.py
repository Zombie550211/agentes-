"""
Copia todos los datos del MySQL local al MySQL de Aiven.
Ejecutar una sola vez desde tu PC: python migrate_local_to_aiven.py
"""
import asyncio, os, sys
from dotenv import load_dotenv
load_dotenv()

# aiomysql con SSL en Windows requiere SelectorEventLoop (no ProactorEventLoop)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import aiomysql

# Credenciales desde .env (NUNCA hardcodeadas):
#   MYSQL_URL       = destino Aiven (mysql+aiomysql://user:pass@host:port/db)
#   LOCAL_MYSQL_URL = origen local (opcional; por defecto root sin contraseña)
AIVEN_URL  = os.getenv("MYSQL_URL", "")
LOCAL_URL  = os.getenv("LOCAL_MYSQL_URL", "mysql+aiomysql://root:@localhost:3306/crm_connecting?charset=utf8mb4")
if not AIVEN_URL:
    sys.exit("ERROR: define MYSQL_URL en .env (destino Aiven)")

SCHEMA_FILE = os.path.join(os.path.dirname(__file__), "schema.sql")

TABLES = [
    "users",
    "leads",
    "lead_comments",
    "activities",
    "messages",
    "pre_leads",
    "lineas_clientes",
    "lineas_notes",
    "lineas_internal",
    "media_files",
    "note_files",
    "employees_month",
    "premios_activos",
    "premios_ganadores",
    "facturacion",
    "facturacion_lineas",
    "system_settings",
    "rr_config",
    "llamadas_ventas",
    "llamadas_ventas_lineas",
    "lv_excel_sheets",
    "lv_excel_data",
    "lv_excel_users",
]


def _parse(url: str):
    url = url.replace("mysql+aiomysql://", "").split("?")[0]
    userpass, rest = url.split("@", 1)
    user, pw = (userpass.split(":", 1) + [""])[:2]
    hostport, db = rest.split("/", 1)
    host, port = (hostport.split(":") + ["3306"])[:2]
    return host, int(port), user, pw, db


async def connect_local():
    h, p, u, pw, db = _parse(LOCAL_URL)
    return await aiomysql.connect(host=h, port=p, user=u, password=pw, db=db,
                                   charset="utf8mb4", autocommit=True)


async def connect_aiven():
    import ssl
    h, p, u, pw, db = _parse(AIVEN_URL)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return await aiomysql.connect(host=h, port=p, user=u, password=pw, db=db,
                                   charset="utf8mb4", autocommit=True, ssl=ctx)


async def apply_schema(aiven):
    """Crea las tablas en Aiven usando schema.sql"""
    with open(SCHEMA_FILE, "r", encoding="utf-8") as f:
        raw = f.read()

    # Ejecutar cada statement por separado
    statements = [s.strip() for s in raw.split(";") if s.strip()]
    cur = await aiven.cursor()
    ok = err = 0
    for stmt in statements:
        try:
            await cur.execute(stmt)
            ok += 1
        except Exception as e:
            msg = str(e)
            if "already exists" in msg or "Duplicate" in msg:
                ok += 1
            else:
                print(f"  SCHEMA WARN: {msg[:120]}")
                err += 1
    print(f"  Schema: {ok} OK, {err} avisos")


async def migrate_table(local, aiven, table: str):
    lcur = await local.cursor()
    acur = await aiven.cursor()

    # Obtener columnas
    await lcur.execute(f"DESCRIBE `{table}`")
    cols = [row[0] for row in await lcur.fetchall()]
    col_list = ", ".join(f"`{c}`" for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))

    # Leer todos los registros locales
    await lcur.execute(f"SELECT {col_list} FROM `{table}`")
    rows = await lcur.fetchall()

    if not rows:
        print(f"  {table}: vacio")
        return

    inserted = skipped = 0
    BATCH = 200
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i+BATCH]
        try:
            await acur.executemany(
                f"INSERT IGNORE INTO `{table}` ({col_list}) VALUES ({placeholders})",
                batch,
            )
            inserted += len(batch)
        except Exception as e:
            # Intentar fila por fila para identificar el problema
            for row in batch:
                try:
                    await acur.execute(
                        f"INSERT IGNORE INTO `{table}` ({col_list}) VALUES ({placeholders})",
                        row,
                    )
                    inserted += 1
                except Exception as e2:
                    print(f"  SKIP {table}: {str(e2)[:100]}")
                    skipped += 1

    print(f"  {table}: {inserted} insertados, {skipped} errores")


async def main():
    print("Conectando a MySQL local...")
    local = await connect_local()

    print("Conectando a Aiven MySQL...")
    aiven = await connect_aiven()

    print("\nCreando schema en Aiven...")
    await apply_schema(aiven)

    print("\nMigrando tablas...")
    for table in TABLES:
        try:
            await migrate_table(local, aiven, table)
        except Exception as e:
            print(f"  ERR {table}: {e}")

    local.close()
    aiven.close()
    print("\nMigracion completa.")


asyncio.run(main())
