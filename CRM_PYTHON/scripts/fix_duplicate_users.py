"""
Diagnostica y corrige la desincronización entre leads.agente y users.username.
El problema: en MongoDB el campo agente se guardaba como el nombre completo (name),
pero el sistema Python usa username. Hay leads con agente='Ingrid Garcia' cuando el
username real es 'INGRID.GARCIA'.

Uso:
  python fix_duplicate_users.py          -- solo diagnóstico (sin cambios)
  python fix_duplicate_users.py --apply  -- aplica las correcciones
"""
import asyncio, ssl, sys, re, os
from dotenv import load_dotenv
load_dotenv()
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
    return dict(host=host, port=int(port), user=user, password=pw,
                db=dbname or "crm_connecting", charset="utf8mb4", autocommit=False)


AIVEN = _db_cfg()
APPLY = "--apply" in sys.argv


async def get_conn():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return await aiomysql.connect(**AIVEN, ssl=ctx)


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


async def main():
    conn = await get_conn()
    cur = await conn.cursor(aiomysql.DictCursor)

    # Cargar todos los usuarios
    await cur.execute("SELECT id, username, name, role FROM users ORDER BY id")
    users = await cur.fetchall()

    # Cargar todos los valores únicos de agente en leads
    await cur.execute("""
        SELECT agente, COUNT(*) as cnt, COALESCE(SUM(puntaje),0) as pts
        FROM leads
        WHERE agente IS NOT NULL AND agente != ''
        GROUP BY agente
        ORDER BY cnt DESC
    """)
    agente_rows = await cur.fetchall()
    agentes = {r["agente"]: r for r in agente_rows}

    # Construir índice de usuarios por username (exacto) y por name normalizado
    by_username_exact = {u["username"]: u for u in users}  # username exacto
    by_username_norm  = {norm(u["username"]): u for u in users}  # username normalizado
    by_name_norm      = {}
    for u in users:
        if u["name"]:
            key = norm(u["name"])
            if key not in by_name_norm:
                by_name_norm[key] = u

    # Mapeos adicionales manuales conocidos (casos con puntos en username o variantes)
    EXTRA_MAP = {
        "Eduardo R":        "EduardoR",
        " mauricio martinez": "Mauricio Martinez",
        "Abigail Bernal":   "abigail.bernal",
        "Jairo.Flores":     "Jairo Flores",
        "Nicole Cruz":      "NICOLE.CRUZ",
        "Jorge Segovia":    "Jorge.Segovia",
    }

    print("=" * 70)
    print(f"Total usuarios: {len(users)}")
    print(f"Valores únicos de agente en leads: {len(agentes)}")
    print("=" * 70)

    # Clasificar cada valor de agente
    already_ok = []   # agente == algún username exacto
    fix_by_name = []  # agente == name de un usuario → reasignar a su username
    fix_extra   = []  # mapeos manuales
    orphans     = []  # no se puede identificar usuario

    for agente_val, row in agentes.items():
        cnt = row["cnt"]
        pts = float(row["pts"] or 0)

        if agente_val in by_username_exact:
            already_ok.append((agente_val, cnt, pts))
            continue

        # Buscar por name normalizado
        n = norm(agente_val)
        if n in by_name_norm:
            target_user = by_name_norm[n]
            fix_by_name.append((agente_val, target_user["username"], cnt, pts, "por name"))
            continue

        # Buscar por username normalizado
        if n in by_username_norm:
            target_user = by_username_norm[n]
            if target_user["username"] != agente_val:
                fix_by_name.append((agente_val, target_user["username"], cnt, pts, "por username_norm"))
                continue
            else:
                already_ok.append((agente_val, cnt, pts))
                continue

        # Mapeos manuales
        if agente_val in EXTRA_MAP:
            fix_extra.append((agente_val, EXTRA_MAP[agente_val], cnt, pts))
            continue

        orphans.append((agente_val, cnt, pts))

    print(f"\n[OK] {len(already_ok)} valores de agente ya coinciden con un username:")
    for a, c, p in already_ok:
        print(f"  {c:4d} leads  {a!r}")

    print(f"\n[FIX] {len(fix_by_name)} valores de agente que se reasignaran por nombre:")
    for a, target, c, p, reason in fix_by_name:
        print(f"  {c:4d} leads  {a!r}  -->  {target!r}  ({reason})")

    print(f"\n[FIX-MANUAL] {len(fix_extra)} valores con mapeo manual:")
    for a, target, c, p in fix_extra:
        print(f"  {c:4d} leads  {a!r}  -->  {target!r}")

    print(f"\n[ORPHAN] {len(orphans)} valores sin coincidencia (no se tocan):")
    for a, c, p in orphans:
        print(f"  {c:4d} leads  {a!r}")

    # Resumen del impacto
    total_fix = sum(c for _, _, c, *_ in fix_by_name) + sum(c for _, _, c, _ in fix_extra)
    print(f"\nTotal leads a reasignar: {total_fix}")

    if not APPLY:
        print("\n[DRY RUN] Para aplicar los cambios: python fix_duplicate_users.py --apply")
        conn.close()
        return

    print("\nAplicando correcciones...")
    total_updated = 0
    for agente_val, target_username, cnt, pts, _ in fix_by_name:
        await cur.execute(
            "UPDATE leads SET agente=%s WHERE agente=%s",
            (target_username, agente_val)
        )
        n = cur.rowcount
        total_updated += n
        if n != cnt:
            print(f"  WARN: esperaba {cnt} pero actualizo {n} para '{agente_val}'")

    for agente_val, target_username, cnt, pts in fix_extra:
        await cur.execute(
            "UPDATE leads SET agente=%s WHERE agente=%s",
            (target_username, agente_val)
        )
        n = cur.rowcount
        total_updated += n

    await conn.commit()
    print(f"\nListo: {total_updated} leads actualizados.")

    # Verificación final
    await cur.execute("""
        SELECT agente, COUNT(*) as cnt
        FROM leads
        WHERE agente IS NOT NULL AND agente != ''
        GROUP BY agente
        ORDER BY cnt DESC
        LIMIT 30
    """)
    print("\nTop 30 agentes en leads tras la corrección:")
    for r in await cur.fetchall():
        en_users = "OK" if r["agente"] in by_username_exact else "??"
        print(f"  [{r['cnt']:4d}] [{en_users}] {r['agente']!r}")

    conn.close()


asyncio.run(main())
