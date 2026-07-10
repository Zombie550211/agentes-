"""Aplica schema.sql en Aiven y verifica las tablas creadas.

Credenciales: se leen de la variable de entorno MYSQL_URL (archivo .env), NUNCA
hardcodeadas. Formato: mysql+aiomysql://user:pass@host:port/dbname
"""
import asyncio, ssl, sys, os
from dotenv import load_dotenv
load_dotenv()
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
import aiomysql


def _db_cfg():
    url = os.getenv("MYSQL_URL", "").replace("mysql+aiomysql://", "").replace("?charset=utf8mb4", "")
    if "@" not in url:
        sys.exit("ERROR: define MYSQL_URL en .env (mysql+aiomysql://user:pass@host:port/db)")
    userpass, rest = url.split("@", 1)
    user, pw = (userpass.split(":", 1) + [""])[:2]
    hostport, dbname = (rest.split("/", 1) + [""])[:2]
    host, port = (hostport.split(":") + ["3306"])[:2]
    return dict(host=host, port=int(port), user=user, password=pw,
                db=dbname or "defaultdb", charset="utf8mb4", autocommit=True)


AIVEN = _db_cfg()
SCHEMA = os.path.join(os.path.dirname(__file__), "schema.sql")


async def main():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    conn = await aiomysql.connect(**AIVEN, ssl=ctx)
    cur = await conn.cursor()

    with open(SCHEMA, "r", encoding="utf-8") as f:
        raw = f.read()

    stmts = [s.strip() for s in raw.split(";") if s.strip()]
    ok = err = 0
    for stmt in stmts:
        try:
            await cur.execute(stmt)
            ok += 1
        except Exception as e:
            msg = str(e)
            if "already exists" in msg or "Duplicate entry" in msg:
                ok += 1
            else:
                print(f"  WARN: {msg[:150]}")
                err += 1

    print(f"Schema aplicado: {ok} OK, {err} errores")

    await cur.execute("SHOW TABLES")
    tables = [r[0] for r in await cur.fetchall()]
    print(f"Tablas en Aiven ({len(tables)}): {', '.join(tables)}")

    conn.close()

asyncio.run(main())
