"""Exporta de PRODUCCIÓN, solo con SELECT, lo que cambió desde un momento dado, como SQL
que el CRM local aplica en su propia base (scripts/sync_prod_local.sh).

Corre en el EC2 (allí están las credenciales; nunca salen del servidor):
    ~/app/CRM_PYTHON/.venv/bin/python prod_export_cambios.py --desde "2026-10-30 21:00:00"
    ~/app/CRM_PYTHON/.venv/bin/python prod_export_cambios.py --desde ... --completas

Por cada tabla:
  - con updated_at / created_at / resultado_at: las filas cuyo timestamp es >= --desde;
  - sin timestamps y con menos de MAX_COMPLETA filas: la tabla entera, solo con --completas;
  - con --completas además se borran en el local las filas que ya no existen en producción
    (tablas con clave primaria de una columna y menos de MAX_IDS filas).
La primera línea es «-- corte: AAAA-MM-DD HH:MM:SS» (hora de la BD al empezar), que el local
guarda como el --desde de la siguiente vuelta. Nada de esto escribe en producción.
"""
import argparse
import pathlib
import re
import sys

import pymysql

COLS_TIEMPO = ("updated_at", "created_at", "resultado_at")
MAX_COMPLETA = 5000
MAX_IDS = 50000
LOTE = 200


def conectar():
    env = (pathlib.Path.home() / "app/CRM_PYTHON/.env").read_text()
    url = re.search(r"^MYSQL_URL=(.*)$", env, re.M).group(1).strip()
    usuario, clave, host, puerto, base = re.match(
        r"[^/]*//([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)", url).groups()
    ssl = None
    ca = re.search(r"^MYSQL_SSL_CA=(.*)$", env, re.M)
    if re.search(r"^MYSQL_SSL=1", env, re.M) and ca:
        ssl = {"ca": ca.group(1).strip()}
    cn = pymysql.connect(host=host, user=usuario, password=clave, port=int(puerto or 3306),
                         database=base, charset="utf8mb4", ssl=ssl, autocommit=True,
                         cursorclass=pymysql.cursors.DictCursor)
    with cn.cursor() as c:
        # Lectura pura: la sesión no puede escribir aunque el script tuviera un error.
        c.execute("SET SESSION TRANSACTION READ ONLY")
    return cn, base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", required=True)
    ap.add_argument("--completas", action="store_true")
    a = ap.parse_args()

    cn, base = conectar()
    out = sys.stdout
    c = cn.cursor()
    c.execute("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS ahora")
    out.write(f"-- corte: {c.fetchone()['ahora']}\n")
    out.write("SET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\n")

    c.execute("""SELECT table_name AS t, table_rows AS n FROM information_schema.tables
                 WHERE table_schema = %s AND table_type = 'BASE TABLE'""", (base,))
    tablas = c.fetchall()
    for tb in tablas:
        t = tb["t"]
        c.execute("""SELECT column_name AS col, extra AS ex, column_key AS k FROM information_schema.columns
                     WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position""", (base, t))
        info = c.fetchall()
        cols = [x["col"] for x in info if "GENERATED" not in (x["ex"] or "").upper()]
        pk = [x["col"] for x in info if x["k"] == "PRI"]
        tiempo = [x for x in COLS_TIEMPO if x in cols]
        if tiempo:
            where = " OR ".join(f"`{x}` >= %s" for x in tiempo)
            params = [a.desde] * len(tiempo)
        elif a.completas and (tb["n"] or 0) <= MAX_COMPLETA:
            where, params = "1=1", []
        else:
            where = None
        lista = ",".join(f"`{x}`" for x in cols)
        if where:
            c.execute(f"SELECT {lista} FROM `{t}` WHERE {where}", params)
            filas = c.fetchall()
            for i in range(0, len(filas), LOTE):
                valores = ",".join(
                    "(" + ",".join(cn.escape(f[x]) for x in cols) + ")" for f in filas[i:i + LOTE])
                out.write(f"REPLACE INTO `{t}` ({lista}) VALUES {valores};\n")
        if a.completas and len(pk) == 1 and (tb["n"] or 0) <= MAX_IDS:
            c.execute(f"SELECT `{pk[0]}` AS id FROM `{t}`")
            ids = [r["id"] for r in c.fetchall()]
            if ids:
                out.write(f"DELETE FROM `{t}` WHERE `{pk[0]}` NOT IN ("
                          + ",".join(cn.escape(x) for x in ids) + ");\n")
    out.write("SET UNIQUE_CHECKS=1;\nSET FOREIGN_KEY_CHECKS=1;\n")
    cn.close()


if __name__ == "__main__":
    main()
