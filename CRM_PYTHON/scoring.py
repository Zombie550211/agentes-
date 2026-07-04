"""
Servicios y puntajes — GESTIONADOS POR EL BACKEND (fuente única, BD).

El catálogo vive en la tabla `productos` y se edita desde la página de permisos.
El frontend NO tiene tabla de puntajes hardcodeada: consulta /api/productos.

- SCORING_SEED: catálogo inicial (se siembra solo si la tabla está vacía).
- service_meta(): deriva tipo_servicio y sistema por categoría.
- Reglas especiales XFINITY / DOUBLE PLAY se aplican en el router (lógica de negocio del backend).
- ensure_productos(): crea la tabla y siembra si está vacía (no pisa ediciones del admin).
"""

# ── Catálogo inicial (por nombre de servicio, incluye la velocidad) ──
SCORING_SEED = {
    'VIDEO DIRECTV VIA INTERNET': {'categoria': 'VIDEO', 'byRisk': {'LOW': 1.0, 'MEDIUM': 0.35, 'HIGH': 0.35, 'N/A': 1.0}},
    'VIDEO DIRECTV VIA SATELITE': {'categoria': 'VIDEO', 'byRisk': {'LOW': 1.0, 'MEDIUM': 0.35, 'HIGH': 1.0, 'N/A': 1.0}},
    'AIR': {'categoria': 'ATT', 'base': 0.45},
    'ATT AIR': {'categoria': 'ATT', 'base': 0.45},
    'ATT 18 - 25 MB': {'categoria': 'ATT', 'base': 0.25},
    'ATT 50 - 100 MB': {'categoria': 'ATT', 'base': 0.35},
    'ATT 100 FIBRA': {'categoria': 'ATT', 'base': 0.7},
    'ATT 300': {'categoria': 'ATT', 'base': 1.25},
    'ATT 500': {'categoria': 'ATT', 'base': 1.25},
    'ATT 1G': {'categoria': 'ATT', 'base': 1.5},
    'SPECTRUM 500': {'categoria': 'SPECTRUM', 'base': 1.0},
    'SPECTRUM 1G': {'categoria': 'SPECTRUM', 'base': 1.0},
    'SPECTRUM 2G': {'categoria': 'SPECTRUM', 'base': 1.25},
    'SPECTRUM BUSINESS': {'categoria': 'SPECTRUM', 'base': 1.0},
    'FRONTIER 7G': {'categoria': 'FRONTIER', 'base': 1.5},
    'FRONTIER 5G': {'categoria': 'FRONTIER', 'base': 1.5},
    'FRONTIER 2G': {'categoria': 'FRONTIER', 'base': 1.5},
    'FRONTIER 1G': {'categoria': 'FRONTIER', 'base': 1.25},
    'FRONTIER 500 MB': {'categoria': 'FRONTIER', 'base': 1.0},
    'FRONTIER -500 MB': {'categoria': 'FRONTIER', 'base': 0.35},
    'CONSOLIDATED 100 MB': {'categoria': 'CONSOLIDATED', 'base': 0.35},
    'CONSOLIDATED 300 MB': {'categoria': 'CONSOLIDATED', 'base': 0.35},
    'CONSOLIDATED 1G': {'categoria': 'CONSOLIDATED', 'base': 1.25},
    'CONSOLIDATED 2G': {'categoria': 'CONSOLIDATED', 'base': 1.25},
    'XFINITY 300': {'categoria': 'XFINITY', 'base': 0.35},
    'XFINITY 500': {'categoria': 'XFINITY', 'base': 0.75},
    'XFINITY 1G': {'categoria': 'XFINITY', 'base': 0.75},
    'BRIGHTSPEED 900 MB': {'categoria': 'BRIGHTSPEED', 'base': 1.0},
    'BRIGHTSPEED 100-899 MB': {'categoria': 'BRIGHTSPEED', 'base': 1.0},
    'BRIGHTSPEED 40-99 MB': {'categoria': 'BRIGHTSPEED', 'base': 0.35},
    'BRIGHTSPEED 10-39 MB': {'categoria': 'BRIGHTSPEED', 'base': 0.35},
    'CENTURYLINK ALL FIBER': {'categoria': 'CENTURYLINK', 'base': 1.25},
    'CENTURYLINK 40-99 MB': {'categoria': 'CENTURYLINK', 'base': 0.35},
    'CENTURYLINK 10-39 MB': {'categoria': 'CENTURYLINK', 'base': 0.25},
    'EARTHLINK 300+': {'categoria': 'EARTHLINK', 'base': 1.0},
    'ZIPLY FIBER 10G': {'categoria': 'ZIPLY', 'base': 1.0},
    'ZIPLY FIBER 5G': {'categoria': 'ZIPLY', 'base': 1.25},
    'ZIPLY FIBER 2G': {'categoria': 'ZIPLY', 'base': 1.0},
    'ZIPLY FIBER 1G': {'categoria': 'ZIPLY', 'base': 1.0},
    'ZIPLY FIBER 300': {'categoria': 'ZIPLY', 'base': 0.35},
    'ZIPLY FIBER 200': {'categoria': 'ZIPLY', 'base': 0.35},
    'ALTAFIBER 100 MB': {'categoria': 'ALTAFIBER', 'base': 0.25},
    'ALTAFIBER 200 MB': {'categoria': 'ALTAFIBER', 'base': 0.25},
    'ALTAFIBER 300 MB': {'categoria': 'ALTAFIBER', 'base': 0.25},
    'ALTAFIBER 400 MB': {'categoria': 'ALTAFIBER', 'base': 0.25},
    'ALTAFIBER 500 MB': {'categoria': 'ALTAFIBER', 'base': 0.25},
    'ALTAFIBER 600 MB': {'categoria': 'ALTAFIBER', 'base': 0.25},
    'ALTAFIBER 800 MB': {'categoria': 'ALTAFIBER', 'base': 0.35},
    'ALTAFIBER 1G': {'categoria': 'ALTAFIBER', 'base': 0.35},
    'HAWAIIAN 1G': {'categoria': 'HAWAIIAN', 'base': 0.35},
    'HAWAIIAN 750 MB': {'categoria': 'HAWAIIAN', 'base': 0.25},
    'HAWAIIAN 500 MB': {'categoria': 'HAWAIIAN', 'base': 0.25},
    'HAWAIIAN 300 MB': {'categoria': 'HAWAIIAN', 'base': 0.25},
    'OPTIMUM 5G': {'categoria': 'OPTIMUM', 'base': 1.25},
    'OPTIMUM 2G': {'categoria': 'OPTIMUM', 'base': 1.25},
    'OPTIMUM 1G': {'categoria': 'OPTIMUM', 'base': 1.0},
    'OPTIMUM 500': {'categoria': 'OPTIMUM', 'base': 0.35},
    'WINDSTREAM 1G+': {'categoria': 'WINDSTREAM', 'base': 1.25},
    'WINDSTREAM 500-999 MB': {'categoria': 'WINDSTREAM', 'base': 1.0},
    'WINDSTREAM -499 MB': {'categoria': 'WINDSTREAM', 'base': 1.0},
    'WOW 1200 MB': {'categoria': 'WOW', 'base': 0.35},
    'WOW 1G': {'categoria': 'WOW', 'base': 0.35},
    'WOW 500 MB': {'categoria': 'WOW', 'base': 0.25},
    'WOW 200 MB': {'categoria': 'WOW', 'base': 0.25},
    'HUGHESNET': {'categoria': 'HUGHESNET', 'base': 0.35},
    'VIASAT': {'categoria': 'VIASAT', 'base': 0.75},
    'STARLINK': {'categoria': 'STARLINK', 'base': 0.35},
    'METRONET': {'categoria': 'METRONET', 'base': 1.0},
    'VIVINT': {'categoria': 'VIVINT', 'base': 1.0},
    'MOBILITY': {'categoria': 'MOBILITY', 'base': 0.5},
}

# ── tipo_servicio / sistema por categoría ────────────────────────
_TIPO_BY_CAT = {
    'VIDEO': 'VIDEO', 'XFINITY': 'XFINITY', 'SPECTRUM': 'INTERNET',
    'FRONTIER': 'FRONTIER', 'CONSOLIDATED': 'CONSOLIDATE', 'ALTAFIBER': 'ALTAFIBER',
    'BRIGHTSPEED': 'BRIGHTSPEED', 'CENTURYLINK': 'CENTURYLINK', 'HAWAIIAN': 'HAWAIIAN',
    'OPTIMUM': 'OPTIMUM', 'WINDSTREAM': 'WINDSTREAM', 'WOW': 'WOW', 'ZIPLY': 'ZIPLY FIBER',
    'EARTHLINK': 'EARTHLINK', 'STARLINK': 'STARLINK', 'VIASAT': 'VIASAT',
    'HUGHESNET': 'HUGHESNET', 'MOBILITY': 'WIRELESS', 'VIVINT': 'VIVINT', 'METRONET': 'METRONET',
}
_SISTEMA_CHUZO = {'HUGHESNET', 'VIASAT', 'STARLINK', 'VIVINT', 'MOBILITY'}


def service_meta(servicio: str, categoria: str) -> tuple:
    """(tipo_servicio, sistema) para un servicio, según su categoría."""
    if categoria == 'ATT':
        tipo = 'AT&T AIR' if 'AIR' in (servicio or '').upper() else 'INTERNET'
    else:
        tipo = _TIPO_BY_CAT.get(categoria, 'INTERNET')
    if categoria == 'XFINITY':
        sistema = 'N/A'
    elif categoria in _SISTEMA_CHUZO:
        sistema = 'CHUZO'
    else:
        sistema = 'SARA'
    return tipo, sistema


def special_score(servicio: str, tipo_servicio: str):
    """Reglas especiales XFINITY / DOUBLE PLAY. Devuelve el puntaje o None."""
    svc = str(servicio or '').strip().upper()
    tipo = str(tipo_servicio or '').strip().upper()
    if tipo == 'DOUBLE PLAY':
        if svc == 'XFINITY 1G':
            return 1.0
        if svc in ('XFINITY 500', 'XFINITY 300'):
            return 0.85
    if tipo == 'XFINITY':
        if svc == 'XFINITY 1G':
            return 0.75
        if svc == 'XFINITY 500':
            return 0.60
    return None


async def score_for(session, servicio: str, riesgo: str = "", tipo_servicio: str = "") -> float:
    """Puntaje autoritativo desde la BD (tabla productos) + reglas especiales.
    Fuente única: se usa tanto en el endpoint como al crear/editar leads."""
    from sqlalchemy import text
    sp = special_score(servicio, tipo_servicio)
    if sp is not None:
        return float(sp)
    svc = str(servicio or "").strip().upper()
    if not svc:
        return 0.0
    r = await session.execute(text("""
        SELECT score_base, score_low, score_medium, score_high, score_na
        FROM productos WHERE UPPER(servicio) = :s LIMIT 1
    """), {"s": svc})
    row = r.mappings().first()
    if not row:
        return 0.0
    if row["score_base"] is not None:
        return float(row["score_base"])
    risk = str(riesgo or "").strip().upper()
    col = {"LOW": "score_low", "MEDIUM": "score_medium", "HIGH": "score_high", "N/A": "score_na"}.get(risk, "score_na")
    val = row[col] if row[col] is not None else row["score_na"]
    return float(val or 0)


async def ensure_productos(session) -> None:
    """Crea la tabla `productos` y la siembra SOLO si está vacía (no pisa ediciones)."""
    from sqlalchemy import text
    await session.execute(text("""
        CREATE TABLE IF NOT EXISTS productos (
            id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            servicio     VARCHAR(120) NOT NULL UNIQUE,
            categoria    VARCHAR(60),
            tipo         VARCHAR(60),
            sistema      VARCHAR(30),
            score_base   DECIMAL(4,2) NULL,
            score_low    DECIMAL(4,2) NULL,
            score_medium DECIMAL(4,2) NULL,
            score_high   DECIMAL(4,2) NULL,
            score_na     DECIMAL(4,2) NULL,
            activo       BOOLEAN DEFAULT TRUE,
            updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_categoria (categoria)
        ) ENGINE=InnoDB
    """))
    r = await session.execute(text("SELECT COUNT(*) FROM productos"))
    if (r.scalar() or 0) > 0:
        return  # ya sembrada; el admin la gestiona desde permisos
    for servicio, cfg in SCORING_SEED.items():
        base = cfg.get("base")
        br = cfg.get("byRisk") or {}
        tipo, sistema = service_meta(servicio, cfg.get("categoria") or "")
        await session.execute(text("""
            INSERT INTO productos (servicio, categoria, tipo, sistema, score_base, score_low, score_medium, score_high, score_na)
            VALUES (:s, :c, :tp, :sis, :b, :l, :m, :h, :n)
        """), {
            "s": servicio, "c": cfg.get("categoria"), "tp": tipo, "sis": sistema,
            "b": base, "l": br.get("LOW"), "m": br.get("MEDIUM"),
            "h": br.get("HIGH"), "n": br.get("N/A"),
        })
    await session.commit()
