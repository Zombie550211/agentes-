from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from scoring import score_for
import unicodedata

router = APIRouter(tags=["Productos"])

_ADMIN_BO = {"admin", "administrador", "administrativo", "backoffice", "back office", "bo"}


def _is_admin_or_bo(user: dict) -> bool:
    r = unicodedata.normalize("NFD", str(user.get("role", "") or "")).encode("ascii", "ignore").decode().lower()
    return any(a in r for a in _ADMIN_BO)


class ProductoBody(BaseModel):
    servicio:     str
    categoria:    Optional[str] = ""
    tipo:         Optional[str] = ""
    sistema:      Optional[str] = ""
    score_base:   Optional[float] = None
    score_low:    Optional[float] = None
    score_medium: Optional[float] = None
    score_high:   Optional[float] = None
    score_na:     Optional[float] = None


def _row(r) -> dict:
    d = dict(r)
    for k in ("score_base", "score_low", "score_medium", "score_high", "score_na"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    return d


# ── Lectura (cualquier usuario autenticado) ──────────────────────
@router.get("/api/productos")
async def list_productos(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, servicio, categoria, tipo, sistema, score_base,
                   score_low, score_medium, score_high, score_na, activo
            FROM productos ORDER BY categoria, servicio
        """))
        rows = [_row(x) for x in r.mappings().all()]
    return {"success": True, "productos": rows, "count": len(rows)}


@router.get("/api/productos/score")
async def producto_score(
    servicio:     str = Query(...),
    riesgo:       str = Query(""),
    tipoServicio: str = Query(""),
    user: dict = Depends(current_user),
):
    async with AsyncSessionLocal() as s:
        score = await score_for(s, servicio, riesgo, tipoServicio)
    return {"success": True, "score": score}


# ── Gestión (solo Admin + Backoffice) ────────────────────────────
@router.post("/api/productos")
async def create_producto(body: ProductoBody, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    servicio = (body.servicio or "").strip().upper()
    if not servicio:
        raise HTTPException(400, "servicio requerido")
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO productos (servicio, categoria, tipo, sistema, score_base, score_low, score_medium, score_high, score_na)
            VALUES (:s, :c, :tp, :sis, :b, :l, :m, :h, :n)
            ON DUPLICATE KEY UPDATE categoria=:c, tipo=:tp, sistema=:sis,
                score_base=:b, score_low=:l, score_medium=:m, score_high=:h, score_na=:n
        """), {
            "s": servicio, "c": body.categoria, "tp": body.tipo, "sis": body.sistema,
            "b": body.score_base, "l": body.score_low, "m": body.score_medium,
            "h": body.score_high, "n": body.score_na,
        })
        await s.commit()
    return {"success": True, "servicio": servicio}


@router.put("/api/productos/{pid}")
async def update_producto(pid: int, body: ProductoBody, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE productos SET servicio=:s, categoria=:c, tipo=:tp, sistema=:sis,
                score_base=:b, score_low=:l, score_medium=:m, score_high=:h, score_na=:n
            WHERE id = :id
        """), {
            "id": pid, "s": (body.servicio or "").strip().upper(),
            "c": body.categoria, "tp": body.tipo, "sis": body.sistema,
            "b": body.score_base, "l": body.score_low, "m": body.score_medium,
            "h": body.score_high, "n": body.score_na,
        })
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Producto no encontrado")
    return {"success": True}


@router.delete("/api/productos/{pid}")
async def delete_producto(pid: int, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM productos WHERE id = :id"), {"id": pid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Producto no encontrado")
    return {"success": True}
