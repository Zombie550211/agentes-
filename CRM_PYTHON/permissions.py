"""
Resolución de permisos dinámicos (permission_assignments) — fuente única.

Usado por routers que necesitan aplicar restricciones asignadas desde la pestaña
"Permisos avanzados" de crear-cuenta.html (ver permissions_data.py para el catálogo
y routers/permissions_admin.py para el CRUD).
"""
import json
import unicodedata
from database_mysql import AsyncSessionLocal
from sqlalchemy import text


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().strip()


async def resolve_market_restriction(user: dict) -> str:
    """'' = sin restricción; 'BAMO'/'ICON' = el usuario solo debe ver ese mercado.

    Prioridad: 1) el hack histórico de rol ("rol_bamo"/"bamo" en el nombre del rol,
    ver routers/leads.py) — se conserva por compatibilidad; 2) asignación dinámica del
    permiso 'market:restrict_view' por equipo o por usuario.
    """
    r = _normalize(user.get("role", ""))
    if "rol_bamo" in r or r == "bamo":
        return "BAMO"

    async with AsyncSessionLocal() as s:
        row = await s.execute(text("""
            SELECT config FROM permission_assignments
            WHERE perm_key = 'market:restrict_view' AND enabled = 1
              AND ((scope_type = 'team' AND scope_value = :team)
                OR (scope_type = 'user' AND scope_value = :uid))
            ORDER BY (scope_type = 'user') DESC
            LIMIT 1
        """), {"team": user.get("team", "") or "", "uid": str(user.get("id", "") or "")})
        rec = row.mappings().first()

    if rec and rec["config"]:
        cfg = rec["config"] if isinstance(rec["config"], dict) else json.loads(rec["config"])
        return (cfg.get("mercado") or "").strip().upper()
    return ""
