"""Promociones activas (frontend/residencial/promociones-validas.html).

Todos los usuarios con sesión las ven; sólo ADMIN_ROLES las crean, editan,
destacan o quitan. Cada promoción lleva una lista de montos (`items`) y, como
mucho, una está destacada: es la que la página pinta en grande.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, require_roles, ADMIN_ROLES

router = APIRouter(prefix="/api/promociones", tags=["Promociones"])


class Item(BaseModel):
    label: str = Field("", max_length=60)
    amount: float = Field(..., ge=0, le=1_000_000)


class Promocion(BaseModel):
    titulo: str = Field(..., max_length=120)
    items: list[Item] = Field(..., min_length=1, max_length=10)
    destacada: bool = False


def _doc(row) -> dict:
    items = row["items"]
    if isinstance(items, (str, bytes)):
        items = json.loads(items)
    return {
        "id": row["id"],
        "titulo": row["titulo"],
        "items": items,
        "destacada": bool(row["destacada"]),
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        "actualizado_por": row["actualizado_por"] or row["creado_por"],
    }


def _limpiar(body: Promocion) -> tuple[str, str]:
    titulo = body.titulo.strip()
    if not titulo:
        raise HTTPException(400, "Escribe un nombre.")
    items = [{"label": i.label.strip(), "amount": round(i.amount, 2)} for i in body.items]
    return titulo, json.dumps(items, ensure_ascii=False)


async def _quitar_destacada(s, excepto: int) -> None:
    await s.execute(
        text("UPDATE promociones SET destacada = 0 WHERE destacada = 1 AND id <> :id"),
        {"id": excepto},
    )


@router.get("")
async def listar(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM promociones ORDER BY destacada DESC, id ASC"))
        data = [_doc(row) for row in r.mappings().all()]
    return {
        "success": True,
        "data": data,
        # La página sólo enseña los botones de edición si esto es true; el
        # permiso real lo vuelven a comprobar los endpoints de escritura.
        "puede_editar": user.get("role") in ADMIN_ROLES,
    }


@router.post("")
async def crear(body: Promocion, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    titulo, items = _limpiar(body)
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            INSERT INTO promociones (titulo, items, destacada, creado_por)
            VALUES (:titulo, :items, :dest, :by)
        """), {"titulo": titulo, "items": items, "dest": int(body.destacada),
               "by": user.get("username", "")})
        new_id = res.lastrowid  # antes del commit (el pool puede cambiar de conexión)
        if body.destacada:
            await _quitar_destacada(s, new_id)
        await s.commit()
        r = await s.execute(text("SELECT * FROM promociones WHERE id = :id"), {"id": new_id})
        row = r.mappings().first()
    return {"success": True, "data": _doc(row)}


@router.put("/{promo_id}")
async def editar(promo_id: int, body: Promocion, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    titulo, items = _limpiar(body)
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            UPDATE promociones
               SET titulo = :titulo, items = :items, destacada = :dest, actualizado_por = :by
             WHERE id = :id
        """), {"titulo": titulo, "items": items, "dest": int(body.destacada),
               "by": user.get("username", ""), "id": promo_id})
        if res.rowcount == 0:
            raise HTTPException(404, "No encontrada")
        if body.destacada:
            await _quitar_destacada(s, promo_id)
        await s.commit()
        r = await s.execute(text("SELECT * FROM promociones WHERE id = :id"), {"id": promo_id})
        row = r.mappings().first()
    return {"success": True, "data": _doc(row)}


@router.post("/{promo_id}/destacar")
async def destacar(promo_id: int, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            UPDATE promociones SET destacada = 1, actualizado_por = :by WHERE id = :id
        """), {"by": user.get("username", ""), "id": promo_id})
        # SQLAlchemy conecta con FOUND_ROWS: rowcount cuenta filas encontradas,
        # no cambiadas, así que 0 sólo es "no existe".
        if res.rowcount == 0:
            raise HTTPException(404, "No encontrada")
        await _quitar_destacada(s, promo_id)
        await s.commit()
    return {"success": True}


@router.delete("/{promo_id}")
async def quitar(promo_id: int, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM promociones WHERE id = :id"), {"id": promo_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "No encontrada")
    return {"success": True}
