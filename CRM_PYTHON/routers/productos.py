from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
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
    # None = no tocar (clientes que no envían el campo); [] = quitar todos.
    equivalentes: Optional[list[str]] = None


def _row(r) -> dict:
    d = dict(r)
    for k in ("score_base", "score_low", "score_medium", "score_high", "score_na"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    eq = d.get("equivalentes")
    if isinstance(eq, str):
        try:
            eq = json.loads(eq)
        except ValueError:
            eq = None
    d["equivalentes"] = eq if isinstance(eq, list) else []
    return d


async def _validar_equivalentes(s, servicio: str, nombres: Optional[list[str]], pid: Optional[int]) -> Optional[str]:
    """Normaliza los nombres equivalentes (mayúsculas, sin repetir) y comprueba que
    ninguno sea ya un servicio del catálogo ni equivalente de otro. Devuelve el JSON
    a guardar, o None si el cliente no envió el campo."""
    if nombres is None:
        return None
    limpios = []
    for n in nombres:
        n = " ".join(str(n or "").split()).upper()
        if n and n != servicio and n not in limpios:
            if len(n) > 120:
                raise HTTPException(400, f"Nombre equivalente demasiado largo: {n[:30]}…")
            limpios.append(n)
    if len(limpios) > 30:
        raise HTTPException(400, "Máximo 30 nombres equivalentes por servicio")
    r = await s.execute(text("SELECT id, servicio, equivalentes FROM productos"))
    for x in r.mappings().all():
        if pid is not None and x["id"] == pid:
            continue
        if pid is None and str(x["servicio"] or "").upper() == servicio:
            continue  # el POST con un nombre existente actualiza esa misma fila
        otros = _row(x)["equivalentes"]
        for n in limpios:
            if n == str(x["servicio"] or "").upper():
                raise HTTPException(400, f"«{n}» ya es un servicio del catálogo")
            if n in [str(o).upper() for o in otros]:
                raise HTTPException(400, f"«{n}» ya es equivalente de {x['servicio']}")
    return json.dumps(limpios, ensure_ascii=False)


# ── Lectura (cualquier usuario autenticado) ──────────────────────
@router.get("/api/productos")
async def list_productos(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, servicio, categoria, tipo, sistema, score_base,
                   score_low, score_medium, score_high, score_na, equivalentes, activo
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
        eq = await _validar_equivalentes(s, servicio, body.equivalentes, None)
        await s.execute(text("""
            INSERT INTO productos (servicio, categoria, tipo, sistema, score_base, score_low, score_medium, score_high, score_na, equivalentes)
            VALUES (:s, :c, :tp, :sis, :b, :l, :m, :h, :n, :eq)
            ON DUPLICATE KEY UPDATE categoria=:c, tipo=:tp, sistema=:sis,
                score_base=:b, score_low=:l, score_medium=:m, score_high=:h, score_na=:n,
                equivalentes=COALESCE(:eq, equivalentes)
        """), {
            "s": servicio, "c": body.categoria, "tp": body.tipo, "sis": body.sistema,
            "b": body.score_base, "l": body.score_low, "m": body.score_medium,
            "h": body.score_high, "n": body.score_na, "eq": eq,
        })
        await s.commit()
    return {"success": True, "servicio": servicio}


@router.put("/api/productos/{pid}")
async def update_producto(pid: int, body: ProductoBody, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "No autorizado")
    servicio = (body.servicio or "").strip().upper()
    async with AsyncSessionLocal() as s:
        eq = await _validar_equivalentes(s, servicio, body.equivalentes, pid)
        r = await s.execute(text("""
            UPDATE productos SET servicio=:s, categoria=:c, tipo=:tp, sistema=:sis,
                score_base=:b, score_low=:l, score_medium=:m, score_high=:h, score_na=:n,
                equivalentes=COALESCE(:eq, equivalentes)
            WHERE id = :id
        """), {
            "id": pid, "s": servicio, "eq": eq,
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
