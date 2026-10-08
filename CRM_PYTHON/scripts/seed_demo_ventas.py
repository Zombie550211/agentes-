"""Siembra ventas de DEMOSTRACIÓN en la BD local (Docker) para ver las gráficas de inicio.

    python scripts/seed_demo_ventas.py            # siembra (borra antes las de demo previas)
    python scripts/seed_demo_ventas.py --borrar   # sólo las quita

Sólo corre contra el MySQL local de .env.local (127.0.0.1:3309): si la URL apunta a
otro sitio, se niega. Todas las filas llevan created_by = 'seed_demo', así que se
quitan sin tocar nada más; los agentes de Residencial
de demostración llevan el usuario «demo.res.*». Cubre del 1 de enero del año en curso a hoy.
"""
import json
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import pymysql

MARCA = "seed_demo"
PREFIJO_USUARIOS = "demo.res."   # agentes de Residencial de demostración (se borran con --borrar)
AGENTES_RESIDENCIAL = [
    ("ana", "Ana Demo", "TEAM NORTE"), ("bruno", "Bruno Demo", "TEAM NORTE"), ("carla", "Carla Demo", "TEAM NORTE"),
    ("diego", "Diego Demo", "TEAM SUR"), ("elena", "Elena Demo", "TEAM SUR"),
    ("fabio", "Fabio Demo", "TEAM CENTRO"), ("gina", "Gina Demo", "TEAM CENTRO"), ("hugo", "Hugo Demo", "TEAM CENTRO"),
    ("ines", "Ines Demo", "TEAM ORIENTE"), ("jose", "Jose Demo", "TEAM ORIENTE"),
    ("karla", "Karla Demo", "TEAM OCCIDENTE"),
]
ENV = Path(__file__).resolve().parent.parent / ".env.local"


def conectar():
    url = next((l.split("=", 1)[1].strip() for l in ENV.read_text(encoding="utf-8").splitlines()
                if l.startswith("MYSQL_URL=")), "")
    u = urlparse(url.replace("mysql+aiomysql://", "mysql://"))
    if (u.hostname, u.port) != ("127.0.0.1", 3309):
        sys.exit(f"Abortado: {ENV.name} no apunta al MySQL local (127.0.0.1:3309).")
    return pymysql.connect(host=u.hostname, port=u.port, user=u.username, password=u.password or "",
                           database=u.path.lstrip("/"), charset="utf8mb4")


SERVICIOS = ["INTERNET 300MB", "INTERNET 500MB", "INTERNET 1GB", "TV BASICA", "TV PREMIUM",
             "TELEFONIA", "XFINITY 400MB", "SPECTRUM 500MB"]
NOMBRES = ["María", "José", "Ana", "Carlos", "Lucía", "Jorge", "Sofía", "Luis", "Elena", "Pedro",
           "Carmen", "Miguel", "Rosa", "Andrés", "Paula", "Ricardo"]
APELLIDOS = ["García", "Martínez", "López", "Hernández", "Pérez", "Ramírez", "Flores", "Torres",
             "Rivera", "Gómez", "Díaz", "Cruz"]


def main():
    c = conectar()
    cur = c.cursor()
    cur.execute("DELETE FROM leads WHERE created_by = %s", (MARCA,))
    print(f"Quitadas {cur.rowcount} ventas de demo anteriores.")
    cur.execute("DELETE FROM users WHERE username LIKE %s", (PREFIJO_USUARIOS + "%",))
    if "--borrar" in sys.argv:
        c.commit()
        return

    # La BD local sólo trae usuarios de Líneas: se añaden agentes de Residencial para que
    # el semáforo de teams de residencial/inicio.html tenga datos. Sin acceso al CRM y con
    # un hash que no corresponde a ninguna contraseña: no se puede entrar con ellos.
    cur.executemany("""
        INSERT INTO users (username, password_hash, name, role, team, active, acceso_crm)
        VALUES (%s, '!', %s, 'Agente', %s, 1, 0)
    """, [(PREFIJO_USUARIOS + u, n, t) for u, n, t in AGENTES_RESIDENCIAL])

    cur.execute("SELECT username, COALESCE(name, username), team FROM users "
                "WHERE team IS NOT NULL AND TRIM(team) <> ''")
    agentes = cur.fetchall() or [("agente.demo", "Agente Demo", "TEAM DEMO")]

    rnd = random.Random(2026)
    hoy = (datetime.utcnow() - timedelta(hours=6)).date()   # «hoy» en El Salvador
    filas = []
    d = date(hoy.year, 1, 1)
    while d <= hoy:
        # Tendencia al alza a lo largo del año, menos ventas el fin de semana.
        base = 4 + d.timetuple().tm_yday / 40
        if d.weekday() >= 5:
            base *= 0.45
        for _ in range(max(0, round(rnd.gauss(base, base * 0.35)))):
            user, _nombre, team = rnd.choice(agentes)
            servs = rnd.sample(SERVICIOS, rnd.choice([1, 1, 2, 2, 3]))
            status = rnd.choices(["COMPLETED", "PENDING", "ACTIVE", "CANCELLED", "HOLD"],
                                 [45, 25, 15, 10, 5])[0]
            # created_at va en UTC, como lo guarda el CRM (El Salvador = UTC-6).
            hora = datetime(d.year, d.month, d.day, rnd.randint(8, 19), rnd.randint(0, 59)) + timedelta(hours=6)
            filas.append((
                f"{rnd.choice(NOMBRES)} {rnd.choice(APELLIDOS)}", f"555{rnd.randint(1000000, 9999999)}",
                status, d, json.dumps(servs), round(0.5 * len(servs) + rnd.choice([0, 0.25, 0.5]), 2),
                user, user, team, hora, hora, MARCA,   # agente_nombre = username: el semáforo de teams cruza con users.username
                hora if status == "COMPLETED" else None,
            ))
        d += timedelta(days=1)

    cur.executemany("""
        INSERT INTO leads (nombre_cliente, telefono_principal, status, dia_venta, servicios, puntaje,
                           agente, agente_nombre, team, created_at, updated_at, created_by, fecha_completed)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, filas)

    # Casos del Semáforo pendientes en algunas ventas completadas recientes: reloj
    # (riesgo_cx_at, UTC) arrancado hace unas horas, con riesgo variado → verde/amarillo/rojo.
    cur.execute("SELECT id FROM leads WHERE created_by = %s AND status = 'COMPLETED' "
                "AND dia_venta >= %s ORDER BY id", (MARCA, hoy - timedelta(days=6)))
    ids = [r[0] for r in cur.fetchall()]
    ahora_utc = datetime.utcnow().replace(microsecond=0)
    motivos = ["El cliente no recibió la instalación", "Cobro duplicado en la primera factura",
               "Pide cambiar la fecha de instalación", "No le llega el correo de activación",
               "Quiere bajar de plan antes de instalar", "Dirección de servicio incorrecta"]
    casos = []
    for lead_id in rnd.sample(ids, min(12, len(ids))):
        # El riesgo adelanta el reloj (medio +72 h, alto +120 h): se resta para no pasar de 140 h.
        riesgo = rnd.choice(["bajo", "bajo", "medio", "alto"])
        ini = ahora_utc - timedelta(hours=rnd.randint(2, 140 - {"bajo": 0, "medio": 72, "alto": 120}[riesgo]))
        casos.append((rnd.choice(motivos), ini, riesgo, ini, lead_id))
    cur.executemany("""
        UPDATE leads SET caso_estado = 'pendiente', caso_solventar = %s, caso_creado_at = %s,
                         riesgo_cx = %s, riesgo_cx_at = %s
        WHERE id = %s
    """, casos)
    c.commit()
    print(f"Sembradas {len(filas)} ventas de demo ({date(hoy.year, 1, 1)} a {hoy}), {len(casos)} con caso pendiente.")


if __name__ == "__main__":
    main()
