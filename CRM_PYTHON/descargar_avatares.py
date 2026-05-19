"""Script para descargar avatares desde el servidor de producción al disco local."""
import asyncio, sys, os, httpx
import warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from database_mysql import AsyncSessionLocal, init_mysql, engine
from sqlalchemy import text

AVATAR_DIR = Path(__file__).parent.parent / "uploads" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
BASE_URL = "https://lineas-moviles.com"


async def main():
    await init_mysql()
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT username, avatar_url FROM users WHERE avatar_url IS NOT NULL"
        ))
        rows = r.mappings().all()
    await engine.dispose()

    print(f"Descargando {len(rows)} avatares desde {BASE_URL} ...")
    ok = skip = err = 0

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for row in rows:
            url_path = row["avatar_url"]
            fname = url_path.split("/")[-1]
            dest = AVATAR_DIR / fname
            if dest.exists():
                skip += 1
                continue
            try:
                resp = await client.get(BASE_URL + url_path)
                if resp.status_code == 200:
                    dest.write_bytes(resp.content)
                    ok += 1
                    print(f"  OK    {fname}")
                else:
                    err += 1
                    print(f"  ERR {resp.status_code}  {fname}")
            except Exception as e:
                err += 1
                print(f"  EXC   {fname}: {e}")

    print(f"\nListo: {ok} descargados, {skip} ya existían, {err} errores")


if __name__ == "__main__":
    asyncio.run(main())
