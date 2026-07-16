"""Rotación de fines de semana — qué equipos residenciales trabajan cada sábado/domingo.

De lunes a viernes trabajan TODOS los equipos (sin filtro). Los fines de semana
rota: se define un CICLO de fines de semana (cada uno con su lista de equipos para
sábado y para domingo) anclado a una fecha de referencia; el backend calcula
automáticamente qué equipos tocan una fecha dada. Editable desde Permisos.

Almacenamiento: tabla system_settings, key = 'weekend_rotation', value = JSON.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, timedelta
import json, unicodedata
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user

router = APIRouter(tags=["Schedule"])

_KEY = "weekend_rotation"
_ADMIN_BO = {"admin", "administrador", "administrativo", "backoffice", "back office", "bo"}


def _is_admin_or_bo(user: dict) -> bool:
    r = unicodedata.normalize("NFD", str(user.get("role", "") or "")).encode("ascii", "ignore").decode().lower()
    return any(a in r for a in _ADMIN_BO)


# Config por defecto (editable): ciclo de 2 fines de semana que alterna dos grupos.
_DEFAULT = {
    "anchor": "2026-07-04",  # sábado de referencia = índice 0 del ciclo
    "cycle": [
        {"sat": ["TEAM MIGUEL NUÑEZ", "TEAM MARISOL BELTRAN", "TEAM RANDAL MARTINEZ"],
         "sun": ["TEAM IRANIA SERRANO", "TEAM GUADALUPE SANTANA"]},
        {"sat": ["TEAM IRANIA SERRANO", "TEAM GUADALUPE SANTANA"],
         "sun": ["TEAM MIGUEL NUÑEZ", "TEAM MARISOL BELTRAN", "TEAM RANDAL MARTINEZ"]},
    ],
}


class WeekendEntry(BaseModel):
    sat: List[str] = []
    sun: List[str] = []


class RotationBody(BaseModel):
    anchor: str
    cycle: List[WeekendEntry]


def teams_for_date(cfg: dict, d: date):
    """Equipos que trabajan la fecha d. None = sin filtro (lunes a viernes o sin config)."""
    wd = d.weekday()  # lunes=0 … sábado=5, domingo=6
    if wd < 5:
        return None  # entre semana: todos
    cyc = (cfg or {}).get("cycle") or []
    if not cyc:
        return None
    try:
        anchor = date.fromisoformat(str(cfg.get("anchor"))[:10])
    except (ValueError, TypeError):
        return None
    # Sábado de este fin de semana (si es domingo, resta 1 día)
    sat = d if wd == 5 else d - timedelta(days=1)
    weeks = (sat - anchor).days // 7          # floor; Python maneja negativos con %
    entry = cyc[weeks % len(cyc)]
    key = "sat" if wd == 5 else "sun"
    return list(entry.get(key) or [])


async def _load_cfg(session) -> dict:
    r = await session.execute(text("SELECT value FROM system_settings WHERE `key` = :k LIMIT 1"), {"k": _KEY})
    row = r.mappings().first()
    if row and row["value"]:
        try:
            return json.loads(row["value"])
        except (ValueError, TypeError):
            pass
    return dict(_DEFAULT)


async def ensure_schedule(session) -> None:
    """Crea system_settings si no existe y siembra la rotación por defecto (una vez)."""
    await session.execute(text("""
        CREATE TABLE IF NOT EXISTS system_settings (
            `key`      VARCHAR(80) PRIMARY KEY,
            value      TEXT,
            updated_by VARCHAR(120),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    """))
    r = await session.execute(text("SELECT 1 FROM system_settings WHERE `key` = :k LIMIT 1"), {"k": _KEY})
    if not r.first():
        await session.execute(text("""
            INSERT INTO system_settings (`key`, value, updated_by) VALUES (:k, :v, 'seed')
            ON DUPLICATE KEY UPDATE value = value
        """), {"k": _KEY, "v": json.dumps(_DEFAULT, ensure_ascii=False)})
    await session.commit()


# ── GET: config + (opcional) equipos de una fecha ────────────────────────────
@router.get("/api/weekend-rotation")
async def get_rotation(date_str: Optional[str] = Query(None, alias="date"),
                       user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        cfg = await _load_cfg(s)
    out = {"success": True, "config": cfg}
    if date_str:
        try:
            d = date.fromisoformat(date_str[:10])
            wd = d.weekday()
            out["today"] = {
                "date": date_str[:10],
                "isWeekend": wd >= 5,
                "day": "sat" if wd == 5 else ("sun" if wd == 6 else None),
                # teams=None → sin filtro (mostrar todos)
                "teams": teams_for_date(cfg, d),
            }
        except ValueError:
            pass
    return out


# ── PUT: guardar config (solo admin/backoffice) ──────────────────────────────
@router.put("/api/weekend-rotation")
async def put_rotation(body: RotationBody, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    try:
        date.fromisoformat(body.anchor[:10])
    except ValueError:
        raise HTTPException(400, "anchor debe ser YYYY-MM-DD")
    cfg = {"anchor": body.anchor[:10],
           "cycle": [{"sat": e.sat, "sun": e.sun} for e in body.cycle]}
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO system_settings (`key`, value, updated_by) VALUES (:k, :v, :by)
            ON DUPLICATE KEY UPDATE value = :v, updated_by = :by
        """), {"k": _KEY, "v": json.dumps(cfg, ensure_ascii=False), "by": user.get("username")})
        await s.commit()
    return {"success": True, "config": cfg}
