from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
import unicodedata

router = APIRouter(tags=["Catalogos"])

_ADMIN_BO = {"admin", "administrador", "administrativo", "backoffice", "back office", "bo"}


def _is_admin_or_bo(user: dict) -> bool:
    r = unicodedata.normalize("NFD", str(user.get("role", "") or "")).encode("ascii", "ignore").decode().lower()
    return any(a in r for a in _ADMIN_BO)


class CatalogoBody(BaseModel):
    tipo:  str
    valor: str
    label: Optional[str] = ""
    orden: Optional[int] = 0
    activo: Optional[bool] = True


@router.get("/api/catalogos")
async def list_catalogos(user: dict = Depends(current_user)):
    """Todos los catálogos agrupados por tipo."""
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, tipo, valor, label, orden, activo
            FROM catalogos ORDER BY tipo, orden, valor
        """))
        rows = [dict(x) for x in r.mappings().all()]
    grouped: dict = {}
    for row in rows:
        grouped.setdefault(row["tipo"], []).append(row)
    return {"success": True, "catalogos": grouped, "items": rows}


@router.get("/api/catalogos/{tipo}")
async def list_by_tipo(tipo: str, user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, tipo, valor, label, orden, activo
            FROM catalogos WHERE tipo = :t AND activo = TRUE ORDER BY orden, valor
        """), {"t": tipo})
        rows = [dict(x) for x in r.mappings().all()]
    return {"success": True, "items": rows, "count": len(rows)}


@router.post("/api/catalogos")
async def create_catalogo(body: CatalogoBody, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    tipo = (body.tipo or "").strip().lower()
    valor = (body.valor or "").strip()
    if not tipo or not valor:
        raise HTTPException(400, "tipo y valor son requeridos")
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO catalogos (tipo, valor, label, orden, activo)
            VALUES (:t, :v, :l, :o, :a)
            ON DUPLICATE KEY UPDATE label=:l, orden=:o, activo=:a
        """), {"t": tipo, "v": valor, "l": body.label or valor, "o": body.orden or 0, "a": body.activo})
        await s.commit()
    return {"success": True, "tipo": tipo, "valor": valor}


@router.put("/api/catalogos/{cid}")
async def update_catalogo(cid: int, body: CatalogoBody, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE catalogos SET tipo=:t, valor=:v, label=:l, orden=:o, activo=:a WHERE id=:id
        """), {"id": cid, "t": (body.tipo or "").strip().lower(), "v": (body.valor or "").strip(),
               "l": body.label or "", "o": body.orden or 0, "a": body.activo})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "No encontrado")
    return {"success": True}


@router.delete("/api/catalogos/{cid}")
async def delete_catalogo(cid: int, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM catalogos WHERE id = :id"), {"id": cid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "No encontrado")
    return {"success": True}
