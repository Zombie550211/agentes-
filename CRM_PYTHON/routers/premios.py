from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from bson import ObjectId
from database import get_db
from deps import current_user
from typing import Optional

router = APIRouter(prefix="/api/premios", tags=["Premios"])

TIPOS_VALIDOS = {"first", "second", "third", "special", "team", "bonus"}

def _doc(d: dict) -> dict:
    d["_id"] = str(d["_id"])
    return d

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
    db = get_db()
    items = await db["premios_activos"].find({}).sort("createdAt", 1).to_list(None)
    return {"success": True, "data": [_doc(i) for i in items]}

@router.post("/activos")
async def create_activo(body: PremioActivo, user: dict = Depends(current_user)):
    if body.tipo not in TIPOS_VALIDOS:
        raise HTTPException(400, "Tipo inválido")
    db = get_db()
    from datetime import datetime
    doc = {
        "tipo": body.tipo, "titulo": body.titulo.strip(),
        "descripcion": body.descripcion.strip(), "categoria": body.categoria.strip(),
        "monto": body.monto, "creadoPor": user.get("username", ""),
        "createdAt": datetime.utcnow()
    }
    result = await db["premios_activos"].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return {"success": True, "data": doc}

@router.delete("/activos/{premio_id}")
async def delete_activo(premio_id: str, user: dict = Depends(current_user)):
    db = get_db()
    try:
        filter_ = {"_id": ObjectId(premio_id)}
    except Exception:
        filter_ = {"_id": premio_id}
    deleted = await db["premios_activos"].find_one_and_delete(filter_)
    if not deleted:
        raise HTTPException(404, "No encontrado")
    return {"success": True}

# ── GANADORES ─────────────────────────────────────────────────────
@router.get("/ganadores")
async def get_ganadores():
    db = get_db()
    items = await db["premios_ganadores"].find({}).sort("createdAt", 1).to_list(None)
    return {"success": True, "data": [_doc(i) for i in items]}

@router.post("/ganadores")
async def create_ganador(body: Ganador, user: dict = Depends(current_user)):
    if not body.nombre or not body.iniciales:
        raise HTTPException(400, "Nombre e iniciales requeridos")
    db = get_db()
    from datetime import datetime, date
    doc = {
        "tipo": body.tipo, "nombre": body.nombre.strip(),
        "iniciales": body.iniciales.strip().upper(), "monto": body.monto,
        "categoria": (body.categoria or "").strip(),
        "fecha": body.fecha or date.today().isoformat(),
        "status": "pendiente" if body.status == "pendiente" else "asignado",
        "creadoPor": user.get("username", ""), "createdAt": datetime.utcnow()
    }
    result = await db["premios_ganadores"].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return {"success": True, "data": doc}

@router.delete("/ganadores/{ganador_id}")
async def delete_ganador(ganador_id: str, user: dict = Depends(current_user)):
    db = get_db()
    try:
        filter_ = {"_id": ObjectId(ganador_id)}
    except Exception:
        filter_ = {"_id": ganador_id}
    deleted = await db["premios_ganadores"].find_one_and_delete(filter_)
    if not deleted:
        raise HTTPException(404, "No encontrado")
    return {"success": True}
