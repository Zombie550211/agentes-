from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

load_dotenv()

MONGO_URL      = os.getenv("MONGO_DETAILS")
DB_NAME        = os.getenv("DB_NAME", "crmagente")
TEAM_LINEAS_DB = os.getenv("TEAM_LINEAS_DB", "TEAM_LINEAS")

client: AsyncIOMotorClient = None
db     = None
db_team_lineas = None

async def _ensure_indexes():
    """Crea índices críticos en background al arrancar. Sin impacto si ya existen."""
    try:
        cu = db["costumers_unified"]
        await cu.create_index([("dia_venta", 1)],         background=True)
        await cu.create_index([("createdAt", -1)],        background=True)
        await cu.create_index([("agenteNombre", 1)],      background=True)
        await cu.create_index([("agente", 1)],            background=True)
        await cu.create_index([("status", 1)],            background=True)
        await cu.create_index([("supervisor", 1)],        background=True)
        await cu.create_index([("agente", 1), ("status", 1), ("dia_venta", 1)], background=True)
        await cu.create_index([("agenteNombre", 1), ("dia_venta", 1)],          background=True)
        await cu.create_index([("telefono_principal", 1)], background=True)

        ah = db["agent_history"]
        await ah.create_index([("actor_username", 1), ("timestamp", -1)], background=True)
        await ah.create_index([("timestamp", -1)],   background=True)

        await db["users"].create_index([("username", 1)], unique=True, background=True)
        await db["users"].create_index([("supervisor", 1)], background=True)

        print("[DB] Índices verificados/creados ✓")
    except Exception as e:
        print(f"[DB] Advertencia al crear índices: {e}")


async def connect():
    global client, db, db_team_lineas
    client = AsyncIOMotorClient(MONGO_URL)
    db     = client[DB_NAME]
    db_team_lineas = client[TEAM_LINEAS_DB]
    print(f"[DB] Conectado a MongoDB — {DB_NAME} + {TEAM_LINEAS_DB}")
    await _ensure_indexes()

async def disconnect():
    global client
    if client:
        client.close()
        print("[DB] Conexión cerrada")

def get_db():
    return db

def get_team_lineas_db():
    return db_team_lineas
