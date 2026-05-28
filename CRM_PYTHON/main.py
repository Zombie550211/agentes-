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
    # Crear tabla note_files si no existe (necesaria para subida de archivos)
    """CREATE TABLE IF NOT EXISTS note_files (
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
    )""",
    "ALTER TABLE lineas_clientes ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(500) NULL AFTER fuente",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS sistema VARCHAR(100) NULL",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS riesgo VARCHAR(50) NULL",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS notas JSON NULL",
    """UPDATE leads SET sistema = CASE
        WHEN servicios LIKE '%VIDEO DIRECTV%'     THEN 'SARA'
        WHEN servicios LIKE '%ATT 300%'           THEN 'SARA'
        WHEN servicios LIKE '%ATT 500%'           THEN 'SARA'
        WHEN servicios LIKE '%ATT 1G%'            THEN 'SARA'
        WHEN servicios LIKE '%ATT 100%'           THEN 'SARA'
        WHEN servicios LIKE '%ATT 50%'            THEN 'SARA'
        WHEN servicios LIKE '%ATT 18%'            THEN 'SARA'
        WHEN servicios LIKE '%ATT AIR%'           THEN 'SARA'
        WHEN servicios LIKE '%AIR%'               THEN 'SARA'
        WHEN servicios LIKE '%SPECTRUM%'          THEN 'SARA'
        WHEN servicios LIKE '%FRONTIER%'          THEN 'SARA'
        WHEN servicios LIKE '%CONSOLIDATED%'      THEN 'SARA'
        WHEN servicios LIKE '%BRIGHTSPEED%'       THEN 'SARA'
        WHEN servicios LIKE '%EARTHLINK%'         THEN 'SARA'
        WHEN servicios LIKE '%ZIPLY%'             THEN 'SARA'
        WHEN servicios LIKE '%OPTIMUM%'           THEN 'SARA'
        WHEN servicios LIKE '%ALTAFIBER%'         THEN 'SARA'
        WHEN servicios LIKE '%WINDSTREAM%'        THEN 'SARA'
        WHEN servicios LIKE '%CENTURYLINK%'       THEN 'SARA'
        WHEN servicios LIKE '%METRONET%'          THEN 'SARA'
        WHEN servicios LIKE '%HAWAIIAN%'          THEN 'SARA'
        WHEN servicios LIKE '%WOW%'               THEN 'SARA'
        WHEN servicios LIKE '%XFINITY%'           THEN 'N/A'
        WHEN servicios LIKE '%HUGHESNET%'         THEN 'CHUZO'
        WHEN servicios LIKE '%VIASAT%'            THEN 'CHUZO'
        WHEN servicios LIKE '%VIVINT%'            THEN 'CHUZO'
        WHEN servicios LIKE '%MOBILITY%'          THEN 'CHUZO'
        ELSE sistema
    END
    WHERE (sistema IS NULL OR sistema = '')
      AND servicios IS NOT NULL AND servicios != '' AND servicios != '[]'""",
    "UPDATE leads SET autopago = 1 WHERE autopago IS NULL",
    # Normalizar riesgo: valores en español → inglés estándar
    """UPDATE leads SET riesgo = CASE
        WHEN LOWER(TRIM(riesgo)) IN ('bajo','low')    THEN 'LOW'
        WHEN LOWER(TRIM(riesgo)) IN ('medio','medium') THEN 'MEDIUM'
        WHEN LOWER(TRIM(riesgo)) IN ('alto','high')   THEN 'HIGH'
        WHEN LOWER(TRIM(riesgo)) IN ('n/a','na')      THEN 'N/A'
        ELSE riesgo
    END
    WHERE riesgo IS NOT NULL AND TRIM(riesgo) != ''""",
    # Normalizar team en lineas_clientes según supervisor
    """UPDATE lineas_clientes
       SET team = 'TEAM LINEAS JONATHAN'
       WHERE UPPER(TRIM(COALESCE(supervisor,''))) LIKE 'JONATHAN%'""",
    """UPDATE lineas_clientes
       SET team = 'TEAM LINEAS LUIS'
       WHERE UPPER(TRIM(COALESCE(supervisor,''))) LIKE 'LUIS%'""",
    # Backfill supervisor en leads históricos con supervisor vacío,
    # tomando el supervisor asignado en el perfil del agente.
    """UPDATE leads l
       INNER JOIN users u
         ON (   LOWER(TRIM(l.agente_nombre)) = LOWER(TRIM(u.username))
             OR LOWER(TRIM(l.agente))        = LOWER(TRIM(u.username))
             OR LOWER(TRIM(l.created_by))    = LOWER(TRIM(u.username))
            )
       SET l.supervisor = u.supervisor
       WHERE (l.supervisor IS NULL OR TRIM(l.supervisor) = '')
         AND u.supervisor IS NOT NULL AND TRIM(u.supervisor) != ''""",
    # Backfill supervisor en lineas_clientes desde columna team (si ya estaba seteada)
    """UPDATE lineas_clientes
       SET supervisor = CASE
         WHEN UPPER(TRIM(COALESCE(team,''))) LIKE '%LUIS%'     THEN 'LUIS G'
         WHEN UPPER(TRIM(COALESCE(team,''))) LIKE '%JONATHAN%' THEN 'JONATHAN F'
         ELSE supervisor
       END
       WHERE (supervisor IS NULL OR TRIM(supervisor) = '')
         AND COALESCE(TRIM(team),'') != ''""",
    # Backfill supervisor en lineas_clientes desde perfil del agente en users
    """UPDATE lineas_clientes lc
       INNER JOIN users u
         ON (   LOWER(TRIM(lc.agente))          = LOWER(TRIM(u.username))
             OR LOWER(TRIM(lc.agente_nombre))   = LOWER(TRIM(u.username))
             OR LOWER(TRIM(lc.agente_asignado)) = LOWER(TRIM(u.username))
             OR LOWER(TRIM(lc.agente))          = LOWER(TRIM(u.name))
             OR LOWER(TRIM(lc.agente_nombre))   = LOWER(TRIM(u.name))
             OR LOWER(TRIM(lc.agente_asignado)) = LOWER(TRIM(u.name))
            )
       SET lc.supervisor = CASE
         WHEN LOWER(TRIM(COALESCE(u.team,''))) LIKE '%lineas luis%'
              OR LOWER(TRIM(COALESCE(u.supervisor,''))) LIKE '%luis%' THEN 'LUIS G'
         WHEN LOWER(TRIM(COALESCE(u.team,''))) LIKE '%lineas jonathan%'
              OR LOWER(TRIM(COALESCE(u.supervisor,''))) LIKE '%jonathan%' THEN 'JONATHAN F'
         ELSE lc.supervisor
       END
       WHERE (lc.supervisor IS NULL OR TRIM(lc.supervisor) = '')""",
]

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
    # Cada migración en su propia transacción para que los ALTER TABLE
    # que fallen (columna ya existe) no aborte los UPDATE posteriores.
    for sql in _MIGRATIONS:
        try:
            async with engine.begin() as conn:
                await conn.execute(_sa_text(sql))
        except Exception as e:
            print(f"[migration] {e}")
    try:
        await _fix_api_file_urls()
    except Exception as e:
        print(f"[fix-images] {e}")
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
    _CORS_ORIGINS = ["http://localhost:8001", "http://127.0.0.1:8001", "http://localhost:3000"]

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
# Condicionales: no crashea si el directorio no existe (ej. en Render sin frontend)
_static_dirs = {"images": "images", "css": "css", "js": "js", "vendor": "vendor"}
for _name, _rel in _static_dirs.items():
    _d = FRONTEND_DIR / _rel
    if _d.exists():
        app.mount(f"/{_name}", StaticFiles(directory=str(_d)), name=_name)

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
    FRONTEND_DIR / "residencial",
    FRONTEND_DIR / "lineas",
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

@app.head("/")
async def root_head():
    return Response(status_code=200)

@app.get("/inicio")
async def inicio():
    f = find_html("residencial/inicio")
    if f:
        return FileResponse(str(f))
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
