from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from typing import Optional
from datetime import datetime, date, timezone

def _utcnow() -> datetime:
    """UTC naive (reemplazo de _utcnow() deprecado en Python 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

router = APIRouter(prefix="/api/premios", tags=["Premios"])

TIPOS_VALIDOS = {"first", "second", "third", "special", "team", "bonus"}


def _doc(row) -> dict:
    r = dict(row)
    r["_id"] = str(r.get("id", ""))
    r["id"]  = str(r.get("id", ""))
    return r


class PremioActivo(BaseModel):
    tipo: str
    titulo: str
    descripcion: str
    categoria: str
    monto: float = 0


class Ganador(BaseModel):
    nombre: str
    iniciales: str
    tipo: Optional[str] = "second"
    monto: float = 0
    categoria: Optional[str] = ""
    fecha: Optional[str] = None
    status: Optional[str] = "asignado"


# ── ACTIVOS ────────────────────────────────────────────────────────
@router.get("/activos")
async def get_activos():
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM premios_activos ORDER BY created_at ASC"))
        items = [_doc(row) for row in r.mappings().all()]
    return {"success": True, "data": items}


@router.post("/activos")
async def create_activo(body: PremioActivo, user: dict = Depends(current_user)):
    if body.tipo not in TIPOS_VALIDOS:
        raise HTTPException(400, "Tipo inválido")
    now = _utcnow()
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            INSERT INTO premios_activos (tipo, titulo, descripcion, categoria, monto, creado_por, created_at)
            VALUES (:tipo, :titulo, :desc, :cat, :monto, :by, :now)
        """), {
            "tipo": body.tipo, "titulo": body.titulo.strip(),
            "desc": body.descripcion.strip(), "cat": body.categoria.strip(),
            "monto": body.monto, "by": user.get("username", ""), "now": now,
        })
        new_id = res.lastrowid  # antes del commit (el pool puede cambiar de conexión)
        await s.commit()
        r = await s.execute(text("SELECT * FROM premios_activos WHERE id = :id"), {"id": new_id or 0})
        row = r.mappings().first()
    return {"success": True, "data": _doc(row)}


@router.delete("/activos/{premio_id}")
async def delete_activo(premio_id: str, user: dict = Depends(current_user)):
    try:
        pid = int(premio_id)
    except ValueError:
        raise HTTPException(404, "No encontrado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM premios_activos WHERE id = :id"), {"id": pid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "No encontrado")
    return {"success": True}


# ── GANADORES ─────────────────────────────────────────────────────
@router.get("/ganadores")
async def get_ganadores():
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM premios_ganadores ORDER BY created_at ASC"))
        items = [_doc(row) for row in r.mappings().all()]
    return {"success": True, "data": items}


@router.post("/ganadores")
async def create_ganador(body: Ganador, user: dict = Depends(current_user)):
    if not body.nombre or not body.iniciales:
        raise HTTPException(400, "Nombre e iniciales requeridos")
    now = _utcnow()
    fecha_val = body.fecha or date.today().isoformat()
    async with AsyncSessionLocal() as s:
        res = await s.execute(text("""
            INSERT INTO premios_ganadores (tipo, nombre, iniciales, monto, categoria, fecha, status, creado_por, created_at)
            VALUES (:tipo, :nombre, :iniciales, :monto, :cat, :fecha, :status, :by, :now)
        """), {
            "tipo": body.tipo, "nombre": body.nombre.strip(),
            "iniciales": body.iniciales.strip().upper(), "monto": body.monto,
            "cat": (body.categoria or "").strip(), "fecha": fecha_val,
            "status": "pendiente" if body.status == "pendiente" else "asignado",
            "by": user.get("username", ""), "now": now,
        })
        new_id = res.lastrowid  # antes del commit (el pool puede cambiar de conexión)
        await s.commit()
        r = await s.execute(text("SELECT * FROM premios_ganadores WHERE id = :id"), {"id": new_id or 0})
        row = r.mappings().first()
    return {"success": True, "data": _doc(row)}


@router.delete("/ganadores/{ganador_id}")
async def delete_ganador(ganador_id: str, user: dict = Depends(current_user)):
    try:
        gid = int(ganador_id)
    except ValueError:
        raise HTTPException(404, "No encontrado")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM premios_ganadores WHERE id = :id"), {"id": gid})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "No encontrado")
    return {"success": True}
