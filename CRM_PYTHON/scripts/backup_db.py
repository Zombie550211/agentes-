"""Backup completo de la base de datos MySQL (Aiven) sin necesitar mysqldump.

Genera un dump SQL restaurable (SET FK checks + DROP/CREATE TABLE + INSERTs)
comprimido con gzip en db-backups/, y rota los antiguos (conserva los últimos
BACKUP_KEEP, por defecto 14).

Credenciales: MYSQL_URL desde CRM_PYTHON/.env (nunca hardcodeadas).

Uso:
  python backup_db.py            -- crea el backup y rota antiguos
  python backup_db.py --verify   -- además relee el dump y cuenta INSERTs

Restaurar:
  zcat db-backups/crm-backup-XXXX.sql.gz | mysql ... (o vía script Python)
"""
import asyncio, gzip, os, ssl, sys, time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent          # CRM_PYTHON/scripts
CRM_PYTHON = SCRIPT_DIR.parent                        # CRM_PYTHON
BASE_DIR   = CRM_PYTHON.parent                        # CRM_CONNECTING
BACKUP_DIR = BASE_DIR / "db-backups"
KEEP       = int(os.getenv("BACKUP_KEEP", "14"))

load_dotenv(CRM_PYTHON / ".env")
load_dotenv(BASE_DIR / ".env")

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import aiomysql


def _db_cfg():
    """Credenciales desde MYSQL_URL (.env), nunca hardcodeadas."""
    url = os.getenv("MYSQL_URL", "").replace("mysql+aiomysql://", "").replace("?charset=utf8mb4", "")
    if "@" not in url:
        sys.exit("ERROR: define MYSQL_URL en .env (mysql+aiomysql://user:pass@host:port/db)")
    userpass, rest = url.split("@", 1)
    user, pw = (userpass.split(":", 1) + [""])[:2]
    hostport, dbname = (rest.split("/", 1) + [""])[:2]
    host, port = (hostport.split(":") + ["3306"])[:2]
    cfg = dict(host=host, port=int(port), user=user, password=pw,
               db=dbname or "defaultdb", charset="utf8mb4", autocommit=True)
    # Aiven exige TLS; para localhost no hace falta
    if host not in ("localhost", "127.0.0.1"):
        ctx = ssl.create_default_context()
        ca = os.getenv("MYSQL_SSL_CA")
        if ca and Path(ca).exists():
            ctx = ssl.create_default_context(cafile=ca)
        else:
            # Sin CA local: cifra el canal igualmente (Aiven usa CA propia)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        cfg["ssl"] = ctx
    return cfg


def _sql_literal(v) -> str:
    """Convierte un valor Python a literal SQL seguro para el dump."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (bytes, bytearray)):
        return "0x" + v.hex() if v else "''"
    if isinstance(v, datetime):
        return f"'{v.strftime('%Y-%m-%d %H:%M:%S')}'"
    s = str(v)
    s = s.replace("\\", "\\\\").replace("'", "''")
    s = s.replace("\r", "\\r").replace("\n", "\\n").replace("\x00", "")
    return f"'{s}'"


async def dump(verify: bool = False) -> Path:
    cfg = _db_cfg()
    conn = await aiomysql.connect(**cfg)
    cur = await conn.cursor()

    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = BACKUP_DIR / f"crm-backup-{stamp}.sql.gz"

    await cur.execute("SHOW TABLES")
    tables = [r[0] for r in await cur.fetchall()]
    total_rows = 0
    t0 = time.time()

    with gzip.open(out_path, "wt", encoding="utf-8") as f:
        f.write(f"-- CRM Connecting backup {stamp}\n")
        f.write(f"-- Host: {cfg['host']}  DB: {cfg['db']}  Tablas: {len(tables)}\n")
        f.write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n")
        for table in tables:
            await cur.execute(f"SHOW CREATE TABLE `{table}`")
            create_sql = (await cur.fetchone())[1]
            f.write(f"DROP TABLE IF EXISTS `{table}`;\n{create_sql};\n\n")

            await cur.execute(f"SELECT * FROM `{table}`")
            rows = await cur.fetchall()
            if rows:
                cols = ", ".join(f"`{d[0]}`" for d in cur.description)
                # INSERTs por lotes de 200 filas (dump legible y restaurable)
                for i in range(0, len(rows), 200):
                    chunk = rows[i:i + 200]
                    values = ",\n".join(
                        "(" + ", ".join(_sql_literal(v) for v in row) + ")"
                        for row in chunk
                    )
                    f.write(f"INSERT INTO `{table}` ({cols}) VALUES\n{values};\n")
            total_rows += len(rows)
            print(f"  {table}: {len(rows)} filas")
        f.write("\nSET FOREIGN_KEY_CHECKS=1;\n")

    conn.close()
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\n[backup] {out_path.name} — {len(tables)} tablas, {total_rows} filas, "
          f"{size_mb:.2f} MB, {time.time() - t0:.1f}s")

    if verify:
        with gzip.open(out_path, "rt", encoding="utf-8") as f:
            content = f.read()
        n_inserts = content.count("INSERT INTO")
        n_creates = content.count("CREATE TABLE")
        print(f"[verify] {n_creates} CREATE TABLE, {n_inserts} bloques INSERT — dump legible OK")

    return out_path


def rotate():
    """Conserva los últimos KEEP backups; borra el resto."""
    dumps = sorted(BACKUP_DIR.glob("crm-backup-*.sql.gz"))
    for old in dumps[:-KEEP]:
        old.unlink()
        print(f"[rotate] eliminado {old.name}")


if __name__ == "__main__":
    asyncio.run(dump(verify="--verify" in sys.argv))
    rotate()
