"""
Capa de base de datos MySQL — SQLAlchemy 2.0 async
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv
from pathlib import Path
import ssl, os

# Ruta explícita, no búsqueda por cwd — ver el porqué en main.py (hay un .env
# legado en la raíz del repo, sin MYSQL_URL, que se colaba según desde dónde
# se arrancara).
# CRM_ENV_FILE permite apuntar a otro archivo (p.ej. .env.local, que va contra el
# MySQL en Docker) sin tocar el .env de produccion. Sin definir, se usa .env.
load_dotenv(Path(__file__).resolve().parent / os.getenv("CRM_ENV_FILE", ".env"))

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
    _ssl_ca  = os.getenv("MYSQL_SSL_CA")      # ruta a un archivo CA cert (p.ej. rds-ca.pem en el EC2)
    _ssl_pem = os.getenv("MYSQL_SSL_CA_PEM")  # contenido del CA cert inline, por si conviene ponerlo en la env var

    if _ssl_pem:
        # El CA cert viene pegado directamente en la variable de entorno.
        # Toleramos saltos de línea escapados (\n) por si la plataforma los almacena así.
        _ssl_ctx = ssl.create_default_context(cadata=_ssl_pem.replace("\\n", "\n"))
        _ssl_ctx.verify_mode    = ssl.CERT_REQUIRED
        _ssl_ctx.check_hostname = True
    elif _ssl_ca:
        _ssl_ctx = ssl.create_default_context(cafile=_ssl_ca)
        _ssl_ctx.verify_mode    = ssl.CERT_REQUIRED
        _ssl_ctx.check_hostname = True
    elif os.getenv("NODE_ENV") == "production":
        # En producción NO se permite conexión sin verificar el certificado del
        # servidor: sería vulnerable a MITM. Hay que configurar el CA cert.
        raise RuntimeError(
            "MYSQL_SSL_CA / MYSQL_SSL_CA_PEM no configurado en producción. La "
            "verificación TLS del servidor MySQL es obligatoria para evitar ataques "
            "MITM. Descarga el CA cert desde la consola de tu proveedor "
            "(Aiven/Railway/etc.) y configura MYSQL_SSL_CA=/ruta/ca.pem, o pega su "
            "contenido en MYSQL_SSL_CA_PEM."
        )
    else:
        # Solo en desarrollo: acepta el cert sin verificar, pero advierte.
        _ssl_ctx = ssl.create_default_context()
        _ssl_ctx.check_hostname = False
        _ssl_ctx.verify_mode    = ssl.CERT_NONE
        print("[AVISO SSL] MYSQL_SSL_CA / MYSQL_SSL_CA_PEM no configurado — verificación de "
              "certificado desactivada. Descarga el CA cert desde Aiven Console y configura "
              "MYSQL_SSL_CA=/ruta/ca.pem (o MYSQL_SSL_CA_PEM con su contenido).")
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


async def init_mysql():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[MySQL] Conexion establecida OK")


async def close_mysql():
    await engine.dispose()
    print("[MySQL] Conexion cerrada")
