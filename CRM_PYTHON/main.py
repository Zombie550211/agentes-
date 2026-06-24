import asyncio, sys, warnings

# Python 3.14 en Windows: ProactorEventLoop no soporta SSL con aiomysql.
# SelectorEventLoop sí. El API está marcado deprecated en 3.14 → silenciar.
if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from contextlib import asynccontextmanager
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

from limiter import limiter
from database_mysql import init_mysql, close_mysql, engine
from sqlalchemy import text as _sa_text
from routers import auth as auth_router
from routers import dashboard as dashboard_router
from routers import (
    teams, premios, facturacion, chat, media, pre_leads, employees_month,
    facturacion_lineas, facturacion_lineas_pub, llamadas_ventas_lineas, bulk_status,
    users as users_router, lineas as lineas_router,
    ranking as ranking_router, equipo as equipo_router,
    leads as leads_router,
    llamadas_ventas as llamadas_ventas_router,
    init as init_router,
    comentarios as comentarios_router,
    files as files_router,
    avatars as avatars_router,
    misc as misc_router,
    stream as stream_router,
)

# ── Rutas base ──────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent.parent          # CRM_CONNECTING/
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR  = BASE_DIR / "uploads"
COMPONENTS   = BASE_DIR / "components"

# Migraciones estructurales (DDL). Cada una lleva un NOMBRE estable y se registra
# en la tabla `schema_migrations` tras aplicarse: así solo corren UNA vez en vez de
# ejecutarse (y fallar con "ya existe") en cada arranque. Para añadir una nueva,
# agrégala al final con un nombre nuevo; nunca renombres ni reordenes las previas.
# Las migraciones de datos (UPDATE masivos) viven en scripts/data_migrations.py.
_MIGRATIONS: list[tuple[str, str]] = [
    ("0001_create_note_files", """CREATE TABLE note_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(500) NOT NULL,
        original_name VARCHAR(500),
        content_type VARCHAR(200),
        file_type VARCHAR(50),
        file_size INT,
        file_path VARCHAR(1000),
        lead_id VARCHAR(100),
        uploaded_by VARCHAR(200),
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )"""),
    ("0002_lineas_clientes_imagen_url", "ALTER TABLE lineas_clientes ADD COLUMN imagen_url VARCHAR(500) NULL AFTER fuente"),
    ("0003_leads_sistema", "ALTER TABLE leads ADD COLUMN sistema VARCHAR(100) NULL"),
    ("0004_leads_riesgo", "ALTER TABLE leads ADD COLUMN riesgo VARCHAR(50) NULL"),
    ("0005_leads_notas", "ALTER TABLE leads ADD COLUMN notas JSON NULL"),
    ("0006_users_active", "ALTER TABLE users ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1"),
    ("0007_note_files_content", "ALTER TABLE note_files ADD COLUMN content LONGBLOB NULL"),
    # Índices para consultas frecuentes en leads
    ("0008_idx_leads_dia_venta",  "CREATE INDEX idx_leads_dia_venta   ON leads (dia_venta)"),
    ("0009_idx_leads_dia_inst",   "CREATE INDEX idx_leads_dia_inst    ON leads (dia_instalacion)"),
    ("0010_idx_leads_created",    "CREATE INDEX idx_leads_created     ON leads (created_at)"),
    ("0011_idx_leads_status",     "CREATE INDEX idx_leads_status      ON leads (status(50))"),
    ("0012_idx_leads_agente",     "CREATE INDEX idx_leads_agente      ON leads (agente_nombre(100))"),
    ("0013_idx_leads_supervisor", "CREATE INDEX idx_leads_supervisor  ON leads (supervisor(100))"),
    ("0014_idx_leads_venta_stat", "CREATE INDEX idx_leads_venta_stat  ON leads (dia_venta, status(50))"),
    # Índices para lineas_clientes
    ("0015_idx_lc_agente",        "CREATE INDEX idx_lc_agente         ON lineas_clientes (agente(100))"),
    ("0016_idx_lc_supervisor",    "CREATE INDEX idx_lc_supervisor     ON lineas_clientes (supervisor(100))"),
    ("0017_idx_lc_status",        "CREATE INDEX idx_lc_status         ON lineas_clientes (status(50))"),
    ("0018_idx_lc_created",       "CREATE INDEX idx_lc_created        ON lineas_clientes (created_at)"),
    ("0019_employees_month_period_date", "ALTER TABLE employees_month MODIFY COLUMN period_date VARCHAR(100)"),
    # Coordenadas para el mapa de clientes
    ("0020_leads_lat", "ALTER TABLE leads ADD COLUMN lat  DOUBLE NULL"),
    ("0021_leads_lng", "ALTER TABLE leads ADD COLUMN lng  DOUBLE NULL"),
    ("0022_idx_leads_coords", "CREATE INDEX idx_leads_coords ON leads (lat, lng)"),
    ("0023_create_employees_month", """CREATE TABLE IF NOT EXISTS employees_month (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL DEFAULT '',
        description TEXT,
        image_url TEXT,
        period_date VARCHAR(50),
        updated_at DATETIME
    )"""),
    # Historial de cambios de nombre de equipos
    ("0024_create_team_renames", """CREATE TABLE IF NOT EXISTS team_renames (
        id INT AUTO_INCREMENT PRIMARY KEY,
        old_name VARCHAR(200) NOT NULL,
        new_name VARCHAR(200) NOT NULL,
        changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(200) NULL,
        INDEX idx_tr_old (old_name(100))
    )"""),
    # ── Llamadas de verificación/seguimiento (bloqueo de agentes) ──
    ("0025_leads_fecha_completed",      "ALTER TABLE leads ADD COLUMN fecha_completed DATETIME NULL"),
    ("0026_leads_llamada_cliente",      "ALTER TABLE leads ADD COLUMN llamada_cliente VARCHAR(20) NULL"),
    ("0027_leads_llamadas_realizadas",  "ALTER TABLE leads ADD COLUMN llamadas_realizadas TINYINT NOT NULL DEFAULT 0"),
    ("0028_leads_fecha_ultima_llamada", "ALTER TABLE leads ADD COLUMN fecha_ultima_llamada DATETIME NULL"),
    ("0029_create_lead_llamadas", """CREATE TABLE IF NOT EXISTS lead_llamadas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lead_id VARCHAR(100) NOT NULL,
        numero_llamada TINYINT NOT NULL,
        tipo VARCHAR(30) NOT NULL DEFAULT 'verificacion',
        imagen_url VARCHAR(500) NOT NULL,
        nota TEXT NOT NULL,
        created_by VARCHAR(200),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ll_lead (lead_id)
    )"""),
    # Llamadas de verificación también para la sección de líneas
    ("0030_lead_llamadas_source",          "ALTER TABLE lead_llamadas ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'leads'"),
    ("0031_lc_fecha_completed",            "ALTER TABLE lineas_clientes ADD COLUMN fecha_completed DATETIME NULL"),
    ("0032_lc_llamada_cliente",            "ALTER TABLE lineas_clientes ADD COLUMN llamada_cliente VARCHAR(20) NULL"),
    ("0033_lc_llamadas_realizadas",        "ALTER TABLE lineas_clientes ADD COLUMN llamadas_realizadas TINYINT NOT NULL DEFAULT 0"),
    ("0034_lc_fecha_ultima_llamada",       "ALTER TABLE lineas_clientes ADD COLUMN fecha_ultima_llamada DATETIME NULL"),
    # Status de comisión: columna independiente del status normal. SOLO la usa la página de
    # Comisiones residenciales; no afecta semáforo/estadísticas/inicio ni nada del status normal.
    ("0035_leads_status_comision",         "ALTER TABLE leads ADD COLUMN status_comision VARCHAR(50) NULL"),
    # Inicializar con el status actual para que la comisión no cambie al desplegar (transición transparente).
    ("0036_leads_status_comision_init",    "UPDATE leads SET status_comision = status WHERE status_comision IS NULL"),
]

# Subcadenas de error MySQL que significan "el objeto ya existe" → la migración
# ya estaba aplicada (DB previa al control de versión): se marca como aplicada.
_MIGRATION_ALREADY_APPLIED = (
    "duplicate column", "already exists", "duplicate key name",
    "check that column/key exists",
)


async def _run_migrations():
    """Aplica las migraciones DDL pendientes UNA sola vez (ver tabla schema_migrations)."""
    from database_mysql import AsyncSessionLocal
    # 1. Tabla de control (idempotente).
    async with engine.begin() as conn:
        await conn.execute(_sa_text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name VARCHAR(190) PRIMARY KEY,
                applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
    # 2. Migraciones ya aplicadas.
    async with AsyncSessionLocal() as s:
        r = await s.execute(_sa_text("SELECT name FROM schema_migrations"))
        applied = {row[0] for row in r.fetchall()}

    pending = [(n, sql) for n, sql in _MIGRATIONS if n not in applied]
    if not pending:
        return
    done = 0
    for name, sql in pending:
        record = True
        try:
            async with engine.begin() as conn:
                await conn.execute(_sa_text(sql))
        except Exception as e:
            if any(sig in str(e).lower() for sig in _MIGRATION_ALREADY_APPLIED):
                pass  # el objeto ya existía: estado deseado alcanzado → registrar
            else:
                print(f"[migration:{name}] ERROR (se reintentará en el próximo arranque): {e}")
                record = False
        if record:
            try:
                async with engine.begin() as conn:
                    await conn.execute(
                        _sa_text("INSERT IGNORE INTO schema_migrations (name) VALUES (:n)"),
                        {"n": name},
                    )
                done += 1
            except Exception as e:
                print(f"[migration:{name}] no se pudo registrar: {e}")
    print(f"[migrations] {done}/{len(pending)} migraciones aplicadas/registradas en este arranque")

async def _fix_api_file_urls():
    """Resuelve /api/files/{id} → /uploads/files/... para leads y lineas_clientes."""
    from database_mysql import AsyncSessionLocal
    uploads_root = BASE_DIR / "uploads"
    async with AsyncSessionLocal() as s:
        for table in ("leads", "lineas_clientes"):
            r = await s.execute(_sa_text(
                f"SELECT id, imagen_url FROM {table} WHERE imagen_url REGEXP '^/api/files/[0-9]+$'"
            ))
            rows = r.fetchall()
            for row in rows:
                lead_id, img_url = row[0], row[1]
                file_id = int(img_url.split("/")[-1])
                nf = await s.execute(_sa_text(
                    "SELECT file_path FROM note_files WHERE id = :fid"
                ), {"fid": file_id})
                nf_row = nf.mappings().first()
                if nf_row:
                    fp = nf_row["file_path"] or ""
                    disk = uploads_root / fp.lstrip("/").replace("uploads/", "", 1)
                    new_url = fp if disk.exists() else None
                else:
                    new_url = None
                await s.execute(_sa_text(
                    f"UPDATE {table} SET imagen_url = :u WHERE id = :id"
                ), {"u": new_url, "id": lead_id})
        await s.commit()
        print("[fix-images] URLs de imágenes resueltas")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_mysql()
    # Migraciones DDL: solo las pendientes, registradas en schema_migrations
    # (ya no se ejecutan ni fallan en cada arranque).
    try:
        await _run_migrations()
    except Exception as e:
        print(f"[migrations] error general: {e}")
    try:
        await _fix_api_file_urls()
    except Exception as e:
        print(f"[fix-images] {e}")
    try:
        await _seed_team_renames()
    except Exception as e:
        print(f"[team-renames] {e}")
    try:
        await facturacion_lineas_pub.ensure_table()
    except Exception as e:
        print(f"[facturacion-lineas-pub] ensure_table: {e}")
    yield
    await close_mysql()


async def _seed_team_renames():
    """Inserta renames conocidos si aún no existen (idempotente)."""
    from database_mysql import AsyncSessionLocal
    _known = [
        # Todas las variantes de Bryan/Pleitez → TEAM RANDAL MARTINEZ desde 25 mayo 2026 14:00
        ("TEAM BRYAN PLEITEZ", "TEAM RANDAL MARTINEZ", "2026-05-25 14:00:00"),
        ("TEAM_BRYAN",         "TEAM RANDAL MARTINEZ", "2026-05-25 14:00:00"),
        ("BRYAN PLEITEZ",      "TEAM RANDAL MARTINEZ", "2026-05-25 14:00:00"),
        ("BRYAN",              "TEAM RANDAL MARTINEZ", "2026-05-25 14:00:00"),
        ("PLEITEZ",            "TEAM RANDAL MARTINEZ", "2026-05-25 14:00:00"),
    ]
    async with AsyncSessionLocal() as s:
        for old, new, dt in _known:
            exists = await s.execute(
                _sa_text("SELECT id FROM team_renames WHERE old_name=:o AND new_name=:n LIMIT 1"),
                {"o": old, "n": new}
            )
            if not exists.first():
                await s.execute(
                    _sa_text("INSERT INTO team_renames (old_name,new_name,changed_at,created_by) VALUES(:o,:n,:d,'system')"),
                    {"o": old, "n": new, "d": dt}
                )
        await s.commit()
    print("[team-renames] Seeds aplicados")

# En producción no exponemos la documentación interactiva ni el esquema OpenAPI
# (evita filtrar el mapa completo de la API a usuarios no autenticados).
_IS_PROD = os.getenv("NODE_ENV") == "production"

app = FastAPI(
    title="CRM Connecting — Python",
    description="FastAPI — migración completa desde Node.js",
    docs_url=None if _IS_PROD else "/py-docs",
    redoc_url=None if _IS_PROD else "/py-redoc",
    openapi_url=None if _IS_PROD else "/openapi.json",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ─────────────────────────────────────────────────────────
_CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if not _CORS_ORIGINS:
    _CORS_ORIGINS = ["http://localhost:8001", "http://127.0.0.1:8001", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Cabeceras de seguridad ───────────────────────────────────────
# Defensa en profundidad para todas las respuestas (incluidas las páginas HTML).
# La CSP es deliberadamente acotada: NO fija script-src/default-src porque el
# frontend usa scripts inline y CDNs (Tailwind, jsdelivr, cdnjs, unpkg). Aun así
# bloquea clickjacking (frame-ancestors), plugins (object-src) e inyección de
# <base> (base-uri), sin romper la app.

@app.middleware("http")
async def _security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Content-Security-Policy"] = (
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
    )
    if _IS_PROD:
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return resp

# ── Routers ──────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(dashboard_router.router)
app.include_router(teams.router)
app.include_router(premios.router)
app.include_router(facturacion.router)
app.include_router(facturacion_lineas.router)
app.include_router(facturacion_lineas_pub.router)
app.include_router(llamadas_ventas_lineas.router)
app.include_router(chat.router)
app.include_router(media.router)
app.include_router(media._upload_alias)
app.include_router(pre_leads.router)
app.include_router(employees_month.router)
app.include_router(bulk_status.router)
app.include_router(users_router.router)
app.include_router(lineas_router.router)
app.include_router(ranking_router.router)
app.include_router(equipo_router.router)
app.include_router(leads_router.router)
app.include_router(llamadas_ventas_router.router)
app.include_router(init_router.router)
app.include_router(comentarios_router.router)
app.include_router(files_router.router)
app.include_router(avatars_router.router)
app.include_router(misc_router.router)
app.include_router(stream_router.router)

# ── Archivos estáticos ───────────────────────────────────────────
# Condicionales: no crashea si el directorio no existe (ej. en Render sin frontend)
_static_dirs = {"images": "images", "css": "css", "js": "js", "vendor": "vendor"}
for _name, _rel in _static_dirs.items():
    _d = FRONTEND_DIR / _rel
    if _d.exists():
        app.mount(f"/{_name}", StaticFiles(directory=str(_d)), name=_name)

class _UploadsStaticFiles(StaticFiles):
    """Sirve /uploads con nosniff; contenido activo (html/svg/js/xml) se fuerza
    como descarga para que un archivo subido no pueda ejecutar scripts (XSS)."""
    _ACTIVE_TYPES = ("html", "svg", "javascript", "xml")

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        ctype = resp.headers.get("content-type", "")
        if any(t in ctype for t in self._ACTIVE_TYPES):
            resp.headers["Content-Disposition"] = "attachment"
            resp.headers["Content-Type"] = "application/octet-stream"
        return resp

if UPLOADS_DIR.exists():
    app.mount("/uploads", _UploadsStaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

if COMPONENTS.exists():
    app.mount("/components", StaticFiles(directory=str(COMPONENTS)), name="components")

# Archivos de frontend/agentes/js accesibles en /agentes/js
agentes_js = FRONTEND_DIR / "agentes" / "js"
if agentes_js.exists():
    app.mount("/agentes/js", StaticFiles(directory=str(agentes_js)), name="agentes-js")

# frontend/public (404.html, images extra)
public_dir = FRONTEND_DIR / "public"
if public_dir.exists():
    app.mount("/public", StaticFiles(directory=str(public_dir)), name="public")

# ── HTML — sirve páginas del frontend ──────────────────────────
# Directorios donde buscar HTML, en orden de prioridad
HTML_DIRS = [
    FRONTEND_DIR,
    FRONTEND_DIR / "public",
    FRONTEND_DIR / "residencial",
    FRONTEND_DIR / "lineas",
]

def _resolve_within(base: Path, rel: str) -> Path | None:
    """Resuelve base/rel y garantiza que el resultado quede DENTRO de base.

    Defensa contra path traversal (../, rutas absolutas, symlinks): si la ruta
    pedida se sale del directorio permitido, devuelve None en vez de la ruta.
    """
    try:
        candidate = (base / rel).resolve()
    except (ValueError, OSError):
        return None
    if candidate.is_relative_to(base.resolve()):
        return candidate
    return None

def find_html(name: str) -> Path | None:
    if not name.endswith(".html"):
        name += ".html"
    for d in HTML_DIRS:
        candidate = _resolve_within(d, name)
        if candidate and candidate.is_file():
            return candidate
    return None

@app.get("/")
async def root():
    return RedirectResponse(url="/login.html")

@app.head("/")
async def root_head():
    return Response(status_code=200)

_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}

@app.get("/inicio")
async def inicio():
    f = find_html("residencial/inicio")
    if f:
        return FileResponse(str(f), headers=_NO_CACHE)
    return RedirectResponse(url="/login.html")

# ── Mapa de rutas antiguas → nuevas (redirects 301) ─────────────
_LEGACY_REDIRECTS: dict[str, str] = {
    # TEAM LINEAS/ → /lineas/
    "TEAM LINEAS/COSTUMER-LINEAS.html":        "/lineas/costumer.html",
    "TEAM LINEAS/LEAD-LINEAS.html":            "/lineas/lead.html",
    "TEAM LINEAS/INICIO-LINEAS.html":          "/lineas/inicio.html",
    "TEAM LINEAS/FACTURACION-LINEAS.html":     "/lineas/facturacion.html",
    "TEAM LINEAS/COMISIONES-LINEAS.html":      "/lineas/comisiones.html",
    "TEAM LINEAS/ESTADISTICAS-LINEAS.html":    "/lineas/estadisticas.html",
    "TEAM LINEAS/EMPLEADO-LINEAS.html":        "/lineas/empleado-mes.html",
    "TEAM LINEAS/RANKING-LINEAS.html":         "/lineas/ranking.html",
    "TEAM LINEAS/LLAMADAS-VENTAS-LINEAS.html": "/lineas/llamadas-ventas.html",
    "TEAM LINEAS/REGLAS-LINEAS.html":          "/lineas/reglas.html",
    # Rutas raíz antiguas → /residencial/
    "Costumer.html":               "/residencial/costumer.html",
    "formulario-registro.html":    "/residencial/formulario-registro.html",
    "Estadisticas.html":           "/residencial/estadisticas.html",
    "facturacion.html":            "/residencial/facturacion.html",
    "inicio.html":                 "/residencial/inicio.html",
    "Premios.html":                "/residencial/premios.html",
    "Comisiones.html":             "/residencial/comisiones.html",
    "Reglas.html":                 "/residencial/reglas.html",
    "El semaforo.html":            "/residencial/semaforo.html",
    "empleado-del-mes.html":       "/residencial/empleado-mes.html",
    "historial-agentes.html":      "/residencial/historial-agentes.html",
    "multimedia.html":             "/residencial/multimedia.html",
    "Ranking y Promociones.html":  "/residencial/ranking.html",
    "rankingAgente.html":          "/residencial/ranking-agente.html",
    "Tabla de puntaje.html":       "/residencial/tabla-puntaje.html",
    "llamadas y ventas por team.html": "/residencial/llamadas-ventas.html",
    "lead-lineas.html":            "/lineas/lead.html",
    "costumer-lineas.html":        "/lineas/costumer.html",
    "permisos.html":               "/crear-cuenta.html",
}

@app.get("/{page:path}")
async def serve_page(page: str):
    # 0. Revisar mapa de redirects legacy (case-insensitive)
    page_lower = page.lower()
    for old, new in _LEGACY_REDIRECTS.items():
        if page_lower == old.lower():
            return RedirectResponse(url=new, status_code=301)

    # 1. Intentar como archivo HTML exacto (con contención anti-traversal)
    for d in HTML_DIRS:
        candidate = _resolve_within(d, page)
        if candidate and candidate.is_file():
            return FileResponse(str(candidate), headers=_NO_CACHE)

    # 2. Intentar añadiendo .html
    f = find_html(page)
    if f:
        return FileResponse(str(f), headers=_NO_CACHE)

    # 3. Fallback — 404
    not_found = FRONTEND_DIR / "public" / "404.html"
    if not_found.is_file():
        return FileResponse(str(not_found), status_code=404, headers=_NO_CACHE)

    return Response(content="404 — Página no encontrada", status_code=404)
