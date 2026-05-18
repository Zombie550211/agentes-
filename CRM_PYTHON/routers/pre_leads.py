from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from bson import ObjectId
from database import get_db
from deps import current_user
from datetime import datetime
from pathlib import Path
from typing import Optional
import random, re, aiofiles, datetime as _dt

router = APIRouter(prefix="/api/pre-leads", tags=["Pre-Leads"])

def _is_procesamiento(role: str) -> bool:
    r = str(role or "").lower().strip()
    return r in ("admin", "administrador", "administrator") or r.startswith("procesamiento")

async def _generar_lead_id(db) -> str:
    for _ in range(20):
        id_ = str(random.randint(10000, 99999))
        if not await db["pre_leads"].find_one({"leadId": id_}):
            return id_
    return str(random.randint(10000, 99999))

def _fmt(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    return doc

class PreLeadBody(BaseModel):
    nombre: str
    correo: str
    phone1: str
    phone2: Optional[str] = ""
    direccion: str
    fechaNacimiento: str
    servicio: str
    mercado: Optional[str] = ""
    nota: Optional[str] = ""
    agenteUsername: Optional[str] = ""
    agenteName: Optional[str] = ""

class UpdateLeadBody(BaseModel):
    status: Optional[str] = None
    notaProcesamiento: Optional[str] = None
    fechaVenta: Optional[str] = None
    fechaInstalacion: Optional[str] = None
    nombre: Optional[str] = None
    correo: Optional[str] = None
    phone1: Optional[str] = None
    phone2: Optional[str] = None
    direccion: Optional[str] = None
    fechaNacimiento: Optional[str] = None
    servicio: Optional[str] = None
    mercado: Optional[str] = None
    nota: Optional[str] = None

class ResolverBody(BaseModel):
    resolucion: str
    notaProcesamiento: Optional[str] = None
    fechaVenta: Optional[str] = None
    fechaInstalacion: Optional[str] = None

@router.post("/")
async def create_pre_lead(body: PreLeadBody, user: dict = Depends(current_user)):
    if not all([body.nombre, body.phone1, body.direccion, body.servicio, body.fechaNacimiento, body.correo]):
        raise HTTPException(400, "Faltan campos obligatorios")
    db = get_db()
    lead_id = await _generar_lead_id(db)
    now = datetime.utcnow()
    doc = {
        "leadId": lead_id, "nombre": body.nombre.strip(), "correo": body.correo.strip(),
        "phone1": body.phone1.strip(), "phone2": (body.phone2 or "").strip(),
        "direccion": body.direccion.strip(), "fechaNacimiento": body.fechaNacimiento.strip(),
        "servicio": body.servicio.strip(), "mercado": (body.mercado or "").strip(),
        "nota": (body.nota or "").strip(),
        "agenteUsername": user.get("username") or body.agenteUsername,
        "agenteName": user.get("name") or body.agenteName,
        "status": None, "notaProcesamiento": "", "fechaVenta": "", "fechaInstalacion": "",
        "resolucion": None, "creadoEn": now, "actualizadoEn": now,
    }
    result = await db["pre_leads"].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return {"success": True, "lead": doc}

@router.get("/mis-leads")
async def mis_leads(user: dict = Depends(current_user)):
    db = get_db()
    leads = await db["pre_leads"].find(
        {"agenteUsername": user["username"]}
    ).sort("creadoEn", -1).to_list(None)
    return {"success": True, "leads": [_fmt(l) for l in leads]}

@router.get("/")
async def list_pre_leads(user: dict = Depends(current_user)):
    if not _is_procesamiento(user.get("role", "")):
        raise HTTPException(403, "Acceso denegado")
    db = get_db()
    role = user.get("role", "").lower()
    query = {}
    if "icon" in role:
        query["mercado"] = re.compile("^icon$", re.IGNORECASE)
    elif "bamo" in role:
        query["mercado"] = re.compile("^bamo$", re.IGNORECASE)
    leads = await db["pre_leads"].find(query).sort("creadoEn", -1).to_list(None)
    return {"success": True, "leads": [_fmt(l) for l in leads]}

@router.put("/{lead_id}/resolver")
async def resolver(lead_id: str, body: ResolverBody, user: dict = Depends(current_user)):
    if not _is_procesamiento(user.get("role", "")):
        raise HTTPException(403, "Acceso denegado")
    if body.resolucion not in ("Venta Completada", "Venta Pendiente"):
        raise HTTPException(400, "Resolución inválida")
    try:
        oid = ObjectId(lead_id)
    except Exception:
        raise HTTPException(400, "ID inválido")
    db = get_db()
    update = {"resolucion": body.resolucion, "resueltoEn": datetime.utcnow(), "actualizadoEn": datetime.utcnow()}
    if body.notaProcesamiento is not None: update["notaProcesamiento"] = body.notaProcesamiento
    if body.fechaVenta:                    update["fechaVenta"]        = body.fechaVenta
    if body.fechaInstalacion:              update["fechaInstalacion"]  = body.fechaInstalacion
    result = await db["pre_leads"].update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Lead no encontrado")
    return {"success": True, "resolucion": body.resolucion}

_IMAGES_DIR = Path(__file__).parent.parent.parent / "uploads" / "pre_leads"
_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
_MAX_IMG_BYTES = 20 * 1024 * 1024  # 20 MB


@router.post("/{lead_id}/images")
async def upload_pre_lead_image(lead_id: str, image: UploadFile = File(...), user: dict = Depends(current_user)):
    try:
        oid = ObjectId(lead_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    data = await image.read()
    if len(data) > _MAX_IMG_BYTES:
        raise HTTPException(413, "Imagen demasiado grande (máx 20 MB)")

    ext      = Path(image.filename or "img.jpg").suffix.lower() or ".jpg"
    ts       = int(_dt.datetime.utcnow().timestamp() * 1000)
    filename = f"{lead_id}_{ts}{ext}"
    dest     = _IMAGES_DIR / filename

    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)

    url = f"/uploads/pre_leads/{filename}"

    db = get_db()
    await db["pre_leads"].update_one(
        {"_id": oid},
        {"$push": {"images": {"url": url, "filename": filename, "uploadedAt": _dt.datetime.utcnow()}},
         "$set":  {"actualizadoEn": _dt.datetime.utcnow()}},
    )

    return {"success": True, "url": url, "filename": filename}


@router.put("/{lead_id}")
async def update_pre_lead(lead_id: str, body: UpdateLeadBody, user: dict = Depends(current_user)):
    if not _is_procesamiento(user.get("role", "")):
        raise HTTPException(403, "Acceso denegado")
    try:
        oid = ObjectId(lead_id)
    except Exception:
        raise HTTPException(400, "ID inválido")
    db = get_db()
    allowed = ["status","notaProcesamiento","fechaVenta","fechaInstalacion",
               "nombre","correo","phone1","phone2","direccion","fechaNacimiento","servicio","mercado","nota"]
    update = {k: str(v).strip() for k, v in body.model_dump().items() if v is not None and k in allowed}
    if not update:
        raise HTTPException(400, "Sin campos para actualizar")
    update["actualizadoEn"] = datetime.utcnow()
    result = await db["pre_leads"].update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Lead no encontrado")
    return {"success": True}
