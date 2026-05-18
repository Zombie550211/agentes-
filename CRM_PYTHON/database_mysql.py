"""
Capa de base de datos MySQL — SQLAlchemy 2.0 async
Coexiste con database.py (Mongo) durante la transición.
Cuando la migración esté completa, database.py será eliminado.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv
import os

load_dotenv()

# ── URL de conexión ──────────────────────────────────────────────
# Formato: mysql+aiomysql://usuario:password@host:puerto/dbname
MYSQL_URL = os.getenv(
    "MYSQL_URL",
    "mysql+aiomysql://root:@localhost:3306/crm_connecting?charset=utf8mb4"
)

# ── Engine async ─────────────────────────────────────────────────
engine = create_async_engine(
    MYSQL_URL,
    echo=False,          # True para ver SQL en consola (desarrollo)
    pool_pre_ping=True,  # Verifica conexión antes de usarla
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,
)

# ── Session factory ──────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

# ── Base para modelos ORM ────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── Dependency para FastAPI (get_mysql_db) ───────────────────────
async def get_mysql_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_mysql():
    """Crea las tablas si no existen (usa schema.sql o Alembic)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[MySQL] Conexión establecida ✓")


async def close_mysql():
    await engine.dispose()
    print("[MySQL] Conexión cerrada")
