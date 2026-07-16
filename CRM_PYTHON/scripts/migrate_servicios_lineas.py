"""Asimila los nombres antiguos de servicio en lineas_clientes a los nuevos (jul 2026).

Mapeo:  WIRELESS → LINEA + EQUIPO   |  SIM WIRELES → ESIM CARD
        TABLETS  → WEARABLE         |  RELOJ       → WEARABLE

Actualiza los campos JSON `servicios` y `lines_data` fila a fila (parseando el
JSON, nunca REPLACE a ciegas). Antes de tocar nada guarda los valores originales
de cada fila afectada en backups/servicios-pre-migracion-<fecha>.json para poder
revertir quirúrgicamente sin restaurar toda la BD.

Uso:
  python migrate_servicios_lineas.py           -- dry-run (muestra qué haría)
  python migrate_servicios_lineas.py --apply   -- aplica los cambios
  python migrate_servicios_lineas.py --revert backups/servicios-pre-migracion-X.json
"""
import asyncio, json, os, ssl, sys
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_DIR   = SCRIPT_DIR.parent.parent
load_dotenv(SCRIPT_DIR.parent / ".env")
load_dotenv(BASE_DIR / ".env")

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import aiomysql

MAPEO = {
    "WIRELESS":    "LINEA + EQUIPO",
    "SIM WIRELES": "ESIM CARD",
    "TABLETS":     "WEARABLE",
    "RELOJ":       "WEARABLE",
}


def _db_cfg():
    """Credenciales desde MYSQL_URL (.env), nunca hardcodeadas."""
    url = os.getenv("MYSQL_URL", "").replace("mysql+aiomysql://", "").replace("?charset=utf8mb4", "")
    if "@" not in url:
        sys.exit("ERROR: define MYSQL_URL en .env")
    userpass, rest = url.split("@", 1)
    user, pw = (userpass.split(":", 1) + [""])[:2]
    hostport, dbname = (rest.split("/", 1) + [""])[:2]
    host, port = (hostport.split(":") + ["3306"])[:2]
    cfg = dict(host=host, port=int(port), user=user, password=pw,
               db=dbname or "defaultdb", charset="utf8mb4", autocommit=False)
    if host not in ("localhost", "127.0.0.1"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        cfg["ssl"] = ctx
    return cfg


def _map_val(v: str) -> str:
    return MAPEO.get(str(v or "").strip().upper(), v)


def _migrar_servicios(raw):
    """servicios: lista JSON de strings. Devuelve (nuevo_raw, cambió)."""
    try:
        arr = json.loads(raw)
    except Exception:
        return raw, False
    if not isinstance(arr, list):
        return raw, False
    nuevo = [_map_val(v) for v in arr]
    if nuevo == arr:
        return raw, False
    return json.dumps(nuevo, ensure_ascii=False), True


def _migrar_lines_data(raw):
    """lines_data: lista (o dict) de objetos con clave 'servicio'/'svc'."""
    try:
        data = json.loads(raw)
    except Exception:
        return raw, False
    cambio = False

    def _fix(item):
        nonlocal cambio
        if isinstance(item, dict):
            for k in ("servicio", "svc"):
                if k in item:
                    nv = _map_val(item[k])
                    if nv != item[k]:
                        item[k] = nv
                        cambio = True
        return item

    if isinstance(data, list):
        data = [_fix(x) for x in data]
    elif isinstance(data, dict):
        data = {k: _fix(v) for k, v in data.items()}
    else:
        return raw, False
    if not cambio:
        return raw, False
    return json.dumps(data, ensure_ascii=False), True


async def migrar(apply: bool):
    conn = await aiomysql.connect(**_db_cfg())
    cur = await conn.cursor()
    await cur.execute("""SELECT id, servicios, lines_data FROM lineas_clientes
                         WHERE (servicios IS NOT NULL AND servicios != '')
                            OR (lines_data IS NOT NULL AND lines_data != '')""")
    rows = await cur.fetchall()

    cambios = []   # (id, new_serv|None, new_ld|None)
    originales = []  # respaldo por fila
    for rid, serv_raw, ld_raw in rows:
        new_serv, c1 = _migrar_servicios(serv_raw) if serv_raw else (serv_raw, False)
        new_ld, c2   = _migrar_lines_data(ld_raw) if ld_raw else (ld_raw, False)
        if c1 or c2:
            cambios.append((rid, new_serv if c1 else None, new_ld if c2 else None))
            originales.append({"id": rid, "servicios": serv_raw, "lines_data": ld_raw})

    print(f"Registros examinados: {len(rows)}  |  con cambios: {len(cambios)}")
    if not cambios:
        conn.close()
        return

    if not apply:
        for rid, ns, nl in cambios[:5]:
            print(f"  [dry-run] id={rid}  servicios→{ns}  lines_data→{'(cambia)' if nl else '(igual)'}")
        print(f"  ... y {max(0, len(cambios)-5)} más. Ejecuta con --apply para aplicar.")
        conn.close()
        return

    # Respaldo por fila ANTES de escribir (reversión quirúrgica)
    bdir = BASE_DIR / "backups"
    bdir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    respaldo = bdir / f"servicios-pre-migracion-{stamp}.json"
    respaldo.write_text(json.dumps(originales, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Respaldo por fila: {respaldo}")

    try:
        for rid, ns, nl in cambios:
            sets, params = [], []
            if ns is not None:
                sets.append("servicios = %s");  params.append(ns)
            if nl is not None:
                sets.append("lines_data = %s"); params.append(nl)
            params.append(rid)
            await cur.execute(f"UPDATE lineas_clientes SET {', '.join(sets)} WHERE id = %s", params)
        await conn.commit()
        print(f"[OK] {len(cambios)} registros actualizados y commiteados.")
    except Exception as e:
        await conn.rollback()
        print(f"[ERROR] rollback ejecutado, la BD queda intacta: {e}")
        raise
    finally:
        conn.close()


async def revertir(path: str):
    datos = json.loads(Path(path).read_text(encoding="utf-8"))
    conn = await aiomysql.connect(**_db_cfg())
    cur = await conn.cursor()
    try:
        for row in datos:
            await cur.execute(
                "UPDATE lineas_clientes SET servicios = %s, lines_data = %s WHERE id = %s",
                (row["servicios"], row["lines_data"], row["id"]))
        await conn.commit()
        print(f"[OK] {len(datos)} registros revertidos a sus valores originales.")
    except Exception as e:
        await conn.rollback()
        print(f"[ERROR] rollback: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    if "--revert" in sys.argv:
        asyncio.run(revertir(sys.argv[sys.argv.index("--revert") + 1]))
    else:
        asyncio.run(migrar(apply="--apply" in sys.argv))
