import asyncio, os
from dotenv import load_dotenv
load_dotenv()
import aiomysql

async def check():
    url = os.getenv("MYSQL_URL", "").replace("mysql+aiomysql://", "").replace("?charset=utf8mb4", "")
    userpass, rest = url.split("@", 1)
    user, pw = (userpass.split(":", 1) + [""])[:2]
    hostport, dbname = rest.split("/", 1)
    host, port = (hostport.split(":") + ["3306"])[:2]
    conn = await aiomysql.connect(host=host, port=int(port), user=user, password=pw, db=dbname, charset="utf8mb4")
    cur = await conn.cursor()

    await cur.execute("SELECT COUNT(*) FROM leads WHERE dia_venta IS NULL")
    null_dv = (await cur.fetchone())[0]
    await cur.execute("SELECT COUNT(*) FROM leads WHERE dia_venta IS NOT NULL")
    has_dv = (await cur.fetchone())[0]
    print(f"dia_venta NULL: {null_dv}  |  con fecha: {has_dv}")

    await cur.execute("SELECT COUNT(*) FROM leads WHERE dia_venta BETWEEN '2026-04-01' AND '2026-04-30'")
    print(f"Leads abril 2026 por dia_venta: {(await cur.fetchone())[0]}")

    await cur.execute("SELECT COUNT(*) FROM leads WHERE created_at BETWEEN '2026-04-01' AND '2026-04-30 23:59:59'")
    print(f"Leads abril 2026 por created_at: {(await cur.fetchone())[0]}")

    await cur.execute("""
        SELECT LOWER(TRIM(COALESCE(status,'sin-status'))) as s, COUNT(*) as n
        FROM leads
        WHERE created_at BETWEEN '2026-04-01' AND '2026-04-30 23:59:59'
        GROUP BY s ORDER BY n DESC
    """)
    rows = await cur.fetchall()
    print("Status de leads abril (por created_at):")
    for r in rows:
        print(f"  {r[0]}: {r[1]}")

    # Cuantos leads completados tiene cada mes (por dia_venta)
    print("\nLeads completados por mes (dia_venta):")
    await cur.execute("""
        SELECT DATE_FORMAT(dia_venta, '%Y-%m') as mes, COUNT(*) as n
        FROM leads
        WHERE dia_venta IS NOT NULL
          AND LOWER(TRIM(COALESCE(status,''))) REGEXP 'completed|completado|active|activo|activa'
        GROUP BY mes ORDER BY mes DESC LIMIT 12
    """)
    for r in await cur.fetchall():
        print(f"  {r[0]}: {r[1]}")

    conn.close()

asyncio.run(check())
