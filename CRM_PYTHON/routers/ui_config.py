"""Configuración de UI controlada desde el backend.

Los temas (tokens de color/tipografía) viven en system_settings bajo la
clave 'ui_theme'. Las páginas los leen en GET /api/ui-config y aplican
los tokens como variables CSS; un admin puede cambiarlos con POST sin
tocar el HTML.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
from sqlalchemy import text
from database_mysql import AsyncSessionLocal
from deps import current_user
import json, re

router = APIRouter(prefix="/api/ui-config", tags=["UI Config"])

_SETTINGS_KEY = "ui_theme"

# Tema claro por defecto — paleta "Vantage" (lavanda/morado) con contraste AA
DEFAULT_THEME = {
    "theme": "light",
    "tokens": {
        "bg":          "#F5F3FB",
        "panel":       "#FFFFFF",
        "card":        "#FFFFFF",
        "bdr":         "#E7E3F5",
        "bdr-soft":    "#F0EDF9",
        "t1":          "#211D2E",
        "t2":          "#4A415F",
        "t3":          "#716A8B",
        "accent":      "#6D54D6",
        "accent-2":    "#8A6FE8",
        "accent-soft": "#ECE7FB",
        "cyan":        "#0891B2",
        "green":       "#059669",
        "red":         "#D1477C",
        "amber":       "#D97706",
        "purple":      "#8A6FE8",
    },
}

_TOKEN_NAME_RE = re.compile(r"^[a-z0-9-]{1,32}$")
_TOKEN_VAL_RE  = re.compile(r"^[#a-zA-Z0-9(),.%\s-]{1,64}$")


def _is_admin(user: dict) -> bool:
    r = str(user.get("role", "")).strip().lower()
    return any(a in r for a in ("admin", "backoffice", "bo"))


@router.get("")
async def get_ui_config(user: dict = Depends(current_user)):
    saved = None
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(
                "SELECT value FROM system_settings WHERE `key` = :k LIMIT 1"
            ), {"k": _SETTINGS_KEY})
            row = r.first()
            if row and row[0]:
                saved = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    except Exception:
        saved = None

    theme = dict(DEFAULT_THEME)
    if isinstance(saved, dict):
        if saved.get("theme") in ("light", "dark"):
            theme["theme"] = saved["theme"]
        if isinstance(saved.get("tokens"), dict):
            merged = dict(DEFAULT_THEME["tokens"])
            merged.update({k: v for k, v in saved["tokens"].items() if isinstance(v, str)})
            theme["tokens"] = merged
    return {"success": True, **theme}


class UiConfigBody(BaseModel):
    theme:  Optional[str] = None
    tokens: Optional[Dict[str, str]] = None


@router.post("")
async def set_ui_config(body: UiConfigBody, user: dict = Depends(current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "No autorizado")

    payload: dict = {}
    if body.theme:
        if body.theme not in ("light", "dark"):
            raise HTTPException(400, "theme debe ser 'light' o 'dark'")
        payload["theme"] = body.theme
    if body.tokens:
        clean = {}
        for k, v in body.tokens.items():
            if not _TOKEN_NAME_RE.match(str(k)) or not _TOKEN_VAL_RE.match(str(v)):
                raise HTTPException(400, f"Token inválido: {k}")
            clean[str(k)] = str(v).strip()
        payload["tokens"] = clean
    if not payload:
        raise HTTPException(400, "Nada que guardar")

    # merge con lo ya guardado para no perder tokens previos
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT value FROM system_settings WHERE `key` = :k LIMIT 1"
        ), {"k": _SETTINGS_KEY})
        row = r.first()
        current = {}
        if row and row[0]:
            try:
                current = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            except (ValueError, TypeError):
                current = {}
        if "tokens" in payload and isinstance(current.get("tokens"), dict):
            merged = dict(current["tokens"])
            merged.update(payload["tokens"])
            payload["tokens"] = merged
        current.update(payload)

        await s.execute(text("""
            INSERT INTO system_settings (`key`, value, updated_by)
            VALUES (:k, :v, :by)
            ON DUPLICATE KEY UPDATE value = :v, updated_by = :by
        """), {"k": _SETTINGS_KEY, "v": json.dumps(current), "by": user.get("username", "")})
        await s.commit()

    return {"success": True, "message": "Tema actualizado", **current}
