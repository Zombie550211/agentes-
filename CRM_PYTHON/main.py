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
from contextlib import asynccontextmanager
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

from database_mysql import init_mysql, close_mysql, engine
from sqlalchemy import text as _sa_text
from routers import auth as auth_router
from routers import (
    teams, premios, facturacion, chat, media, pre_leads, employees_month,
    facturacion_lineas, llamadas_ventas_lineas, bulk_status,
    users as users_router, lineas as lineas_router,
    ranking as ranking_router, equipo as equipo_router,
    leads as leads_router,
    llamadas_ventas as llamadas_ventas_router,
    init as init_router,
    comentarios as comentarios_router,
    files as files_router,
    avatars as avatars_router,
    misc as misc_router,
)

# ── Rutas base ──────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent.parent          # CRM_CONNECTING/
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR  = BASE_DIR / "uploads"
COMPONENTS   = BASE_DIR / "components"

_MIGRATIONS = [
    "ALTER TABLE lineas_clientes ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(500) NULL AFTER fuente",
]

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_mysql()
    async with engine.begin() as conn:
        for sql in _MIGRATIONS:
            try:
                await conn.execute(_sa_text(sql))
            except Exception as e:
                print(f"[migration] {e}")
    yield
    await close_mysql()

app = FastAPI(
    title="CRM Connecting — Python",
    description="FastAPI — migración completa desde Node.js",
    docs_url="/py-docs",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────
_CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
if not _CORS_ORIGINS:
    _CORS_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(teams.router)
app.include_router(premios.router)
app.include_router(facturacion.router)
app.include_router(facturacion_lineas.router)
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

# ── Archivos estáticos ───────────────────────────────────────────
# Orden: de más específico a más general
app.mount("/images",     StaticFiles(directory=str(FRONTEND_DIR / "images")),  name="images")
app.mount("/css",        StaticFiles(directory=str(FRONTEND_DIR / "css")),     name="css")
app.mount("/js",         StaticFiles(directory=str(FRONTEND_DIR / "js")),      name="js")
app.mount("/vendor",     StaticFiles(directory=str(FRONTEND_DIR / "vendor")),  name="vendor")

if UPLOADS_DIR.exists():
    app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

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
    FRONTEND_DIR / "agentes",
    FRONTEND_DIR / "TEAM LINEAS",
]

def find_html(name: str) -> Path | None:
    if not name.endswith(".html"):
        name += ".html"
    for d in HTML_DIRS:
        candidate = d / name
        if candidate.is_file():
            return candidate
    return None

@app.get("/")
async def root():
    return RedirectResponse(url="/login.html")

@app.get("/inicio")
async def inicio():
    f = find_html("lead")
    if f:
        return FileResponse(str(f))
    return RedirectResponse(url="/login.html")

@app.get("/{page:path}")
async def serve_page(page: str):
    # 1. Intentar como archivo HTML exacto
    for d in HTML_DIRS:
        candidate = d / page
        if candidate.is_file():
            return FileResponse(str(candidate))

    # 2. Intentar añadiendo .html
    f = find_html(page)
    if f:
        return FileResponse(str(f))

    # 3. Fallback — 404
    not_found = FRONTEND_DIR / "public" / "404.html"
    if not_found.is_file():
        return FileResponse(str(not_found), status_code=404)

    return Response(content="404 — Página no encontrada", status_code=404)
