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

# Solo el .env del backend. El de la raíz era de la época Node/Mongo: no tiene
# ninguna variable que use este script y sí credenciales viejas y otro JWT_SECRET.
load_dotenv(CRM_PYTHON / ".env")

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

    # El volcado lleva la base entera (datos de clientes y hashes de contraseñas),
    # así que se restringe a su dueño antes de escribir nada: con el umask normal
    # nacería 644 y lo podría leer cualquier usuario de la máquina.
    out_path.touch(mode=0o600, exist_ok=True)
    os.chmod(out_path, 0o600)

    with gzip.open(out_path, "wt", encoding="utf-8") as f:
        f.write(f"-- CRM Connecting backup {stamp}\n")
        f.write(f"-- Host: {cfg['host']}  DB: {cfg['db']}  Tablas: {len(tables)}\n")
        f.write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n")
        for table in tables:
            await cur.execute(f"SHOW CREATE TABLE `{table}`")
            create_sql = (await cur.fetchone())[1]
            f.write(f"DROP TABLE IF EXISTS `{table}`;\n{create_sql};\n\n")

            # Cursor NO bufferizado (SSCursor) + fetchmany: las filas se piden al
            # servidor a medida que se escriben.
            #
            # Antes esto era `SELECT *` + fetchall(), que se traía la tabla ENTERA a
            # memoria antes de escribir un solo byte. Con note_files —LONGBLOB con
            # los adjuntos, hoy ~300 MB— el backup se quedaba colgado consumiendo
            # cientos de MB de RAM sin avanzar, que es la razón por la que existe
            # backup_ec2.sh (mysqldump, streaming nativo). Con SSCursor la memoria
            # que se usa es la del lote, no la de la tabla.
            #
            # OJO: mientras un SSCursor está abierto no se puede lanzar otra consulta
            # por la misma conexión — de ahí que se agote y se cierre dentro del
            # bucle, antes de pasar a la siguiente tabla.
            filas_tabla = 0
            data_cur = await conn.cursor(aiomysql.SSCursor)
            try:
                await data_cur.execute(f"SELECT * FROM `{table}`")
                cols = ", ".join(f"`{d[0]}`" for d in data_cur.description)
                while True:
                    chunk = await data_cur.fetchmany(200)   # INSERTs por lotes de 200
                    if not chunk:
                        break
                    values = ",\n".join(
                        "(" + ", ".join(_sql_literal(v) for v in row) + ")"
                        for row in chunk
                    )
                    f.write(f"INSERT INTO `{table}` ({cols}) VALUES\n{values};\n")
                    filas_tabla += len(chunk)
            finally:
                await data_cur.close()
            total_rows += filas_tabla
            print(f"  {table}: {filas_tabla} filas")
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
