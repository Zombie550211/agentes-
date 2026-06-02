import asyncio, sys
sys.path.insert(0, '.')

async def test():
    from database_mysql import AsyncSessionLocal
    from sqlalchemy import text
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(
                "SELECT id, username, name, email, role, team, supervisor, "
                "avatar_url, permissions, active, created_at FROM users ORDER BY username LIMIT 3"
            ))
            rows = r.mappings().all()
            print(f"OK — {len(rows)} filas")
            if rows:
                print("Columnas:", list(rows[0].keys()))
    except Exception as e:
        print("ERROR:", type(e).__name__, str(e))

asyncio.run(test())
