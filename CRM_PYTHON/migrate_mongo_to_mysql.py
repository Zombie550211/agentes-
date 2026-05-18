"""
Script de migración: MongoDB → MySQL
Ejecutar una sola vez después de tener MySQL configurado.

Uso:
    python migrate_mongo_to_mysql.py

Variables de entorno requeridas (en .env):
    MONGO_DETAILS   = mongodb+srv://...
    MYSQL_URL       = mysql+aiomysql://root:password@localhost:3306/crm_connecting
"""
import asyncio
import json
import os
import sys
from datetime import datetime, date
from typing import Any

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import aiomysql

load_dotenv()

MONGO_URL       = os.getenv("MONGO_DETAILS")
MONGO_DB        = os.getenv("DB_NAME", "crmagente")
MONGO_LINEAS_DB = os.getenv("TEAM_LINEAS_DB", "TEAM_LINEAS")

# Parsear MYSQL_URL manualmente para aiomysql
# Formato: mysql+aiomysql://user:pass@host:port/dbname
MYSQL_URL = os.getenv("MYSQL_URL", "mysql+aiomysql://root:@localhost:3306/crm_connecting")

def _parse_mysql_url(url: str) -> dict:
    url = url.replace("mysql+aiomysql://", "")
    userpass, rest = url.split("@", 1)
    user, password = (userpass.split(":", 1) + [""])[:2]
    hostport, dbname = rest.split("/", 1)
    dbname = dbname.split("?")[0]
    host, port = (hostport.split(":") + ["3306"])[:2]
    return {"host": host, "port": int(port), "user": user,
            "password": password, "db": dbname, "charset": "utf8mb4"}

MYSQL_CFG = _parse_mysql_url(MYSQL_URL)


# ── Helpers de serialización ─────────────────────────────────────
def _str(v) -> str | None:
    return str(v) if v is not None else None

def _date(v) -> str | None:
    """Convierte datetime, date o string YYYY-MM-DD a string para MySQL DATE."""
    if v is None: return None
    if isinstance(v, datetime): return v.strftime("%Y-%m-%d")
    if isinstance(v, date):     return v.isoformat()
    s = str(v).strip()[:10]
    return s if len(s) == 10 else None

def _dt(v) -> str | None:
    """Convierte a string DATETIME para MySQL."""
    if v is None: return None
    if isinstance(v, datetime): return v.strftime("%Y-%m-%d %H:%M:%S")
    return None

def _json(v) -> str | None:
    if v is None: return None
    if isinstance(v, (dict, list)): return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)

def _float(v) -> float:
    try: return float(v or 0)
    except: return 0.0

def _int(v) -> int:
    try: return int(v or 0)
    except: return 0

def _bool(v) -> int:
    return 1 if v else 0

def _oid(doc) -> str | None:
    v = doc.get("_id")
    return str(v) if v else None


# ── Migración por tabla ──────────────────────────────────────────
async def migrate_users(mongo_db, conn):
    print("  → Migrando users...")
    cursor = await conn.cursor()
    docs = await mongo_db["users"].find({}).to_list(None)
    ok = 0
    for d in docs:
        try:
            await cursor.execute("""
                INSERT IGNORE INTO users
                  (username, password_hash, name, email, role, team, supervisor,
                   avatar_url, aliases, permissions,
                   reset_code_hash, reset_code_expires_at, reset_code_attempts,
                   reset_token_hash, reset_token_expires_at, reset_token_used,
                   created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                _str(d.get("username")),
                _str(d.get("password") or d.get("password_hash") or ""),
                _str(d.get("name") or d.get("nombre") or d.get("fullName")),
                _str(d.get("email")),
                _str(d.get("role", "agente")),
                _str(d.get("team")),
                _str(d.get("supervisor")),
                _str(d.get("avatarUrl") or d.get("photoUrl") or d.get("avatar")),
                _json(d.get("aliases")),
                _json(d.get("permissions")),
                _str(d.get("reset_code_hash")),
                _dt(d.get("reset_code_expires_at")),
                _int(d.get("reset_code_attempts", 0)),
                _str(d.get("reset_token_hash")),
                _dt(d.get("reset_token_expires_at")),
                _bool(d.get("reset_token_used", False)),
                _dt(d.get("createdAt") or d.get("created_at")),
                _dt(d.get("updatedAt") or d.get("updated_at")),
            ))
            ok += 1
        except Exception as e:
            print(f"    ✗ user {d.get('username')}: {e}")
    await conn.commit()
    print(f"    ✓ {ok}/{len(docs)} usuarios migrados")


async def migrate_leads(mongo_db, conn):
    print("  → Migrando costumers_unified (leads)...")
    cursor = await conn.cursor()
    docs = await mongo_db["costumers_unified"].find({}).to_list(None)
    ok = 0
    for d in docs:
        try:
            servicios = d.get("servicios") or d.get("tipo_servicios") or d.get("tipo_servicio")
            if isinstance(servicios, str): servicios = [servicios]
            await cursor.execute("""
                INSERT INTO leads
                  (mongo_id, nombre_cliente, telefono_principal, telefono, telefono_alterno,
                   telefonos, status, dia_venta, dia_instalacion, fecha_contratacion,
                   servicios, tipo_servicio, puntaje, agente, agente_nombre, usuario,
                   supervisor, team, equipo, direccion, zip_code, numero_cuenta,
                   autopago, pin_seguridad, mercado, motivo_llamada, nota, producto,
                   was_reserva, excluir_de_reporte, source_collection,
                   created_at, created_by, updated_at, updated_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                        %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                _oid(d),
                _str(d.get("nombre_cliente")),
                _str(d.get("telefono_principal")),
                _str(d.get("telefono")),
                _str(d.get("telefono_alterno") or d.get("telefono_alt")),
                _json(d.get("telefonos")),
                _str(d.get("status", "pending")),
                _date(d.get("dia_venta")),
                _date(d.get("dia_instalacion")),
                _date(d.get("fecha_contratacion")),
                _json(servicios),
                _str(d.get("tipo_servicio")),
                _float(d.get("puntaje")),
                _str(d.get("agente")),
                _str(d.get("agenteNombre")),
                _str(d.get("usuario")),
                _str(d.get("supervisor")),
                _str(d.get("team") or d.get("equipo")),
                _str(d.get("equipo")),
                _str(d.get("direccion")),
                _str(d.get("zip_code") or d.get("zip")),
                _str(d.get("numero_cuenta")),
                _bool(d.get("autopago")),
                _str(d.get("pin_seguridad")),
                _str(d.get("mercado")),
                _str(d.get("motivo_llamada")),
                _str(d.get("nota") or d.get("notas")),
                _str(d.get("producto") or d.get("producto_contratado")),
                _bool(d.get("was_reserva")),
                _bool(d.get("excluirDeReporte")),
                _str(d.get("sourceCollection")),
                _dt(d.get("creadoEn") or d.get("createdAt")),
                _str(d.get("createdBy") or d.get("creadoPor")),
                _dt(d.get("updatedAt")),
                _str(d.get("updatedBy")),
            ))
            ok += 1
        except Exception as e:
            print(f"    ✗ lead {_oid(d)}: {e}")
        if ok % 500 == 0 and ok > 0:
            await conn.commit()
            print(f"    ... {ok} leads procesados")
    await conn.commit()
    print(f"    ✓ {ok}/{len(docs)} leads migrados")


async def migrate_activities(mongo_db, conn):
    print("  → Migrando activities...")
    cursor = await conn.cursor()
    for col_name in ("activities", "agent_history"):
        docs = await mongo_db[col_name].find({}).to_list(None)
        ok = 0
        for d in docs:
            try:
                await cursor.execute("""
                    INSERT INTO activities
                      (mongo_id, activity_type, lead_client_name, description,
                       actor_username, actor_role, new_status, old_status, campos, timestamp)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (
                    _oid(d),
                    _str(d.get("activity_type")),
                    _str(d.get("lead_client_name")),
                    _str(d.get("description")),
                    _str(d.get("actor_username")),
                    _str(d.get("actor_role")),
                    _str(d.get("new_status")),
                    _str(d.get("old_status")),
                    _json(d.get("campos")),
                    _dt(d.get("timestamp")),
                ))
                ok += 1
            except Exception as e:
                print(f"    ✗ activity {_oid(d)}: {e}")
        await conn.commit()
        print(f"    ✓ {ok}/{len(docs)} actividades de '{col_name}' migradas")


async def migrate_messages(mongo_db, conn):
    print("  → Migrando messages (chat)...")
    cursor = await conn.cursor()
    docs = await mongo_db["messages"].find({}).to_list(None)
    ok = 0
    for d in docs:
        try:
            await cursor.execute("""
                INSERT INTO messages
                  (mongo_id, from_user, from_name, from_avatar, to_user, to_name,
                   subject, body, type, is_read, is_followup, read_at, timestamp)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                _oid(d),
                _str(d.get("from")),
                _str(d.get("fromName")),
                _str(d.get("fromAvatar")),
                _str(d.get("to")),
                _str(d.get("toName")),
                _str(d.get("subject")),
                _str(d.get("body")),
                _str(d.get("type", "message")),
                _bool(d.get("isRead", False)),
                _bool(d.get("isFollowup", False)),
                _dt(d.get("readAt")),
                _dt(d.get("timestamp") or d.get("createdAt")),
            ))
            ok += 1
        except Exception as e:
            print(f"    ✗ message {_oid(d)}: {e}")
    await conn.commit()
    print(f"    ✓ {ok}/{len(docs)} mensajes migrados")


async def migrate_lineas(mongo_lineas_db, conn):
    print("  → Migrando TEAM_LINEAS collections...")
    cursor = await conn.cursor()
    col_names = await mongo_lineas_db.list_collection_names()
    total_ok = 0
    for col_name in col_names:
        docs = await mongo_lineas_db[col_name].find({}).to_list(None)
        ok = 0
        for d in docs:
            try:
                servicios = d.get("servicios")
                if isinstance(servicios, str): servicios = [servicios]
                await cursor.execute("""
                    INSERT INTO lineas_clientes
                      (mongo_id, collection_name, nombre_cliente, telefono_principal, telefono_alt,
                       telefonos, numero_cuenta, autopago, pin_seguridad, direccion, zip_code,
                       mercado, supervisor, team, servicio_interes, notas, status,
                       dia_venta, dia_instalacion, cantidad_lineas, servicios,
                       lineas_status, lines, agente, agente_nombre, agente_asignado,
                       puntaje, fuente, created_at, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                            %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (
                    _oid(d),
                    col_name,
                    _str(d.get("nombre_cliente")),
                    _str(d.get("telefono_principal")),
                    _str(d.get("telefono_alt") or d.get("telefono_alterno")),
                    _json(d.get("telefonos")),
                    _str(d.get("numero_cuenta")),
                    _bool(d.get("autopago") or d.get("autopay")),
                    _str(d.get("pin_seguridad")),
                    _str(d.get("direccion")),
                    _str(d.get("zip_code")),
                    _str(d.get("mercado")),
                    _str(d.get("supervisor")),
                    _str(d.get("team") or d.get("Team")),
                    _str(d.get("servicio_interes")),
                    _str(d.get("notas") or d.get("nota")),
                    _str(d.get("status", "pending")),
                    _date(d.get("dia_venta")),
                    _date(d.get("dia_instalacion")),
                    _int(d.get("cantidad_lineas", 1)),
                    _json(servicios),
                    _json(d.get("lineas_status")),
                    _json(d.get("lines")),
                    _str(d.get("agente")),
                    _str(d.get("agenteNombre")),
                    _str(d.get("agenteAsignado")),
                    _float(d.get("puntaje")),
                    _str(d.get("fuente")),
                    _dt(d.get("creadoEn") or d.get("createdAt")),
                    _dt(d.get("actualizadoEn") or d.get("updatedAt")),
                ))
                ok += 1
            except Exception as e:
                print(f"    ✗ linea {_oid(d)} [{col_name}]: {e}")
        await conn.commit()
        total_ok += ok
        print(f"    ✓ {ok}/{len(docs)} registros de '{col_name}'")
    print(f"    TOTAL lineas_clientes: {total_ok}")


async def migrate_premios(mongo_db, conn):
    print("  → Migrando premios...")
    cursor = await conn.cursor()
    for col, table in [("premios_activos", "premios_activos"), ("premios_ganadores", "premios_ganadores")]:
        docs = await mongo_db[col].find({}).to_list(None)
        ok = 0
        for d in docs:
            try:
                if table == "premios_activos":
                    await cursor.execute("""
                        INSERT INTO premios_activos
                          (mongo_id, tipo, titulo, descripcion, categoria, monto, creado_por, created_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    """, (_oid(d), _str(d.get("tipo")), _str(d.get("titulo")),
                          _str(d.get("descripcion")), _str(d.get("categoria")),
                          _float(d.get("monto")), _str(d.get("creadoPor")),
                          _dt(d.get("createdAt"))))
                else:
                    await cursor.execute("""
                        INSERT INTO premios_ganadores
                          (mongo_id, tipo, nombre, iniciales, monto, categoria, fecha, status, creado_por, created_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """, (_oid(d), _str(d.get("tipo")), _str(d.get("nombre")),
                          _str(d.get("iniciales")), _float(d.get("monto")),
                          _str(d.get("categoria")), _date(d.get("fecha")),
                          _str(d.get("status")), _str(d.get("creadoPor")),
                          _dt(d.get("createdAt"))))
                ok += 1
            except Exception as e:
                print(f"    ✗ premio {_oid(d)}: {e}")
        await conn.commit()
        print(f"    ✓ {ok}/{len(docs)} de {col}")


async def migrate_system_settings(mongo_db, conn):
    print("  → Migrando system_settings...")
    cursor = await conn.cursor()
    docs = await mongo_db["system_settings"].find({}).to_list(None)
    ok = 0
    for d in docs:
        try:
            await cursor.execute("""
                INSERT INTO system_settings (`key`, value, updated_at, updated_by)
                VALUES (%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE value=VALUES(value), updated_at=VALUES(updated_at)
            """, (
                _str(d.get("key")),
                _json(d.get("value")),
                _dt(d.get("updatedAt")),
                _str(d.get("updatedBy")),
            ))
            ok += 1
        except Exception as e:
            print(f"    ✗ setting {d.get('key')}: {e}")
    await conn.commit()
    print(f"    ✓ {ok}/{len(docs)} settings migrados")


# ── Main ─────────────────────────────────────────────────────────
async def main():
    if not MONGO_URL:
        print("✗ ERROR: MONGO_DETAILS no configurado en .env")
        sys.exit(1)

    print("=" * 60)
    print(" MIGRACIÓN MongoDB → MySQL")
    print("=" * 60)
    print(f"  Mongo:  {MONGO_DB}")
    print(f"  MySQL:  {MYSQL_CFG['host']}:{MYSQL_CFG['port']}/{MYSQL_CFG['db']}")
    print()

    # Conectar Mongo
    mongo_client = AsyncIOMotorClient(MONGO_URL)
    mongo_db     = mongo_client[MONGO_DB]
    mongo_lineas = mongo_client[MONGO_LINEAS_DB]

    # Conectar MySQL
    conn = await aiomysql.connect(**MYSQL_CFG, autocommit=False)

    try:
        await migrate_users(mongo_db, conn)
        await migrate_leads(mongo_db, conn)
        await migrate_activities(mongo_db, conn)
        await migrate_messages(mongo_db, conn)
        await migrate_lineas(mongo_lineas, conn)
        await migrate_premios(mongo_db, conn)
        await migrate_system_settings(mongo_db, conn)

        print()
        print("=" * 60)
        print(" ✓ MIGRACIÓN COMPLETADA")
        print("=" * 60)

    except Exception as e:
        print(f"\n✗ ERROR durante migración: {e}")
        raise
    finally:
        conn.close()
        mongo_client.close()


if __name__ == "__main__":
    asyncio.run(main())
