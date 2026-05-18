"""
Capa de base de datos MySQL — SQLAlchemy 2.0 async
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv
import ssl, os

load_dotenv()

MYSQL_URL = os.getenv(
    "MYSQL_URL",
    "mysql+aiomysql://root:@localhost:3306/crm_connecting?charset=utf8mb4"
)

# Habilitar SSL si la URL es remota (Aiven, Railway, etc.) o si MYSQL_SSL=1
_use_ssl = os.getenv("MYSQL_SSL", "").lower() in ("1", "true", "yes") or (
    "localhost" not in MYSQL_URL and "127.0.0.1" not in MYSQL_URL
)

_connect_args: dict = {}
if _use_ssl:
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode   = ssl.CERT_NONE  # sin verificar CA (acepta cualquier cert)
    _connect_args["ssl"] = _ssl_ctx

engine = create_async_engine(
    MYSQL_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=1800,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_mysql_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_mysql():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[MySQL] Conexion establecida OK")


async def close_mysql():
    await engine.dispose()
    print("[MySQL] Conexion cerrada")
