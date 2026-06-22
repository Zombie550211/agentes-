from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import random, re, aiofiles, datetime as _dt, json

def _utcnow() -> datetime:
    """UTC naive (reemplazo de _utcnow() deprecado en Python 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

router = APIRouter(prefix="/api/pre-leads", tags=["Pre-Leads"])


def _is_procesamiento(role: str) -> bool:
    r = str(role or "").lower().strip()
    return r in ("admin", "administrador", "administrator") or r.startswith("procesamiento")


async def _generar_lead_id(s) -> str:
    for _ in range(20):
        id_ = str(random.randint(10000, 99999))
        r = await s.execute(
            text("SELECT id FROM pre_leads WHERE lead_id = :lid LIMIT 1"), {"lid": id_}
        )
        if not r.first():
            return id_
    return str(random.randint(10000, 99999))


def _fmt(row) -> dict:
    d = dict(row)
    d["_id"] = str(d.get("id", ""))
    # Parse JSON images
    imgs = d.get("images")
    if isinstance(imgs, str):
        try: d["images"] = json.loads(imgs)
        except (ValueError, TypeError): d["images"] = []
    elif imgs is None:
        d["images"] = []
    # Normalize dates to strings
    for col in ("fecha_nacimiento", "fecha_venta", "fecha_instalacion", "resuelto_en", "created_at", "updated_at"):
        v = d.get(col)
        if v is not None:
            d[col] = str(v)
    return d


def _parse_date(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    # Already YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    # DD/MM/YYYY
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


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
    now = _utcnow()
    fn_date = _parse_date(body.fechaNacimiento)

    async with AsyncSessionLocal() as s:
        lead_id = await _generar_lead_id(s)
        r = await s.execute(text("""
            INSERT INTO pre_leads
                (lead_id, nombre, correo, phone1, phone2, direccion, fecha_nacimiento,
                 servicio, mercado, nota, agente_username, agente_name,
                 status, nota_procesamiento, created_at, updated_at)
            VALUES
                (:lid, :nombre, :correo, :phone1, :phone2, :dir, :fn,
                 :servicio, :mercado, :nota, :au, :an,
                 NULL, '', :now, :now)
        """), {
            "lid": lead_id,
            "nombre":   body.nombre.strip(),
            "correo":   body.correo.strip(),
            "phone1":   body.phone1.strip(),
            "phone2":   (body.phone2 or "").strip(),
            "dir":      body.direccion.strip(),
            "fn":       fn_date,
            "servicio": body.servicio.strip(),
            "mercado":  (body.mercado or "").strip(),
            "nota":     (body.nota or "").strip(),
            "au":       user.get("username") or body.agenteUsername,
            "an":       user.get("name") or body.agenteName,
            "now":      now,
        })
        await s.commit()
        new_id = r.lastrowid
        row = await s.execute(text("SELECT * FROM pre_leads WHERE id = :id"), {"id": new_id})
        doc = _fmt(row.mappings().first())

    return {"success": True, "lead": doc}


@router.get("/mis-leads")
async def mis_leads(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT * FROM pre_leads WHERE agente_username = :u ORDER BY created_at DESC
        """), {"u": user["username"]})
        leads = [_fmt(row) for row in r.mappings().all()]
    return {"success": True, "leads": leads}


@router.get("")
async def list_pre_leads(user: dict = Depends(current_user)):
    if not _is_procesamiento(user.get("role", "")):
        raise HTTPException(403, "Acceso denegado")
    role = user.get("role", "").lower()

    where = "1=1"
    params: dict = {}
    if "icon" in role:
        where = "LOWER(mercado) = 'icon'"
    elif "bamo" in role:
        where = "LOWER(mercado) = 'bamo'"

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text(f"SELECT * FROM pre_leads WHERE {where} ORDER BY created_at DESC"), params
        )
        leads = [_fmt(row) for row in r.mappings().all()]
    return {"success": True, "leads": leads}


@router.put("/{lead_id}/resolver")
async def resolver(lead_id: str, body: ResolverBody, user: dict = Depends(current_user)):
    if not _is_procesamiento(user.get("role", "")):
        raise HTTPException(403, "Acceso denegado")
    if body.resolucion not in ("Venta Completada", "Venta Pendiente"):
        raise HTTPException(400, "Resolución inválida")
    try:
        mid = int(lead_id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    now = _utcnow()
    sets = ["resolucion = :res", "resuelto_en = :now", "updated_at = :now"]
    params: dict = {"res": body.resolucion, "now": now, "id": mid}
    if body.notaProcesamiento is not None:
        sets.append("nota_procesamiento = :np")
        params["np"] = body.notaProcesamiento
    if body.fechaVenta:
        sets.append("fecha_venta = :fv")
        params["fv"] = _parse_date(body.fechaVenta)
    if body.fechaInstalacion:
        sets.append("fecha_instalacion = :fi")
        params["fi"] = _parse_date(body.fechaInstalacion)

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text(f"UPDATE pre_leads SET {', '.join(sets)} WHERE id = :id"), params
        )
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Lead no encontrado")

    return {"success": True, "resolucion": body.resolucion}


_IMAGES_DIR = Path(__file__).parent.parent.parent / "uploads" / "pre_leads"
_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
_MAX_IMG_BYTES = 20 * 1024 * 1024


@router.post("/{lead_id}/images")
async def upload_pre_lead_image(
    lead_id: str, image: UploadFile = File(...), user: dict = Depends(current_user)
):
    try:
        mid = int(lead_id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    data = await image.read()
    if len(data) > _MAX_IMG_BYTES:
        raise HTTPException(413, "Imagen demasiado grande (máx 20 MB)")

    ext      = Path(image.filename or "img.jpg").suffix.lower() or ".jpg"
    ts       = int(_utcnow().timestamp() * 1000)
    filename = f"{lead_id}_{ts}{ext}"
    dest     = _IMAGES_DIR / filename

    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)

    url = f"/uploads/pre_leads/{filename}"
    new_img = {"url": url, "filename": filename, "uploadedAt": str(_utcnow())}

    async with AsyncSessionLocal() as s:
        # Fetch existing images JSON and append
        row = await s.execute(
            text("SELECT images FROM pre_leads WHERE id = :id LIMIT 1"), {"id": mid}
        )
        r = row.mappings().first()
        if not r:
            raise HTTPException(404, "Lead no encontrado")
        imgs = r.get("images")
        if isinstance(imgs, str):
            try: imgs = json.loads(imgs)
            except (ValueError, TypeError): imgs = []
        imgs = imgs or []
        imgs.append(new_img)
        await s.execute(text("""
            UPDATE pre_leads SET images = :imgs, updated_at = :now WHERE id = :id
        """), {"imgs": json.dumps(imgs), "now": _utcnow(), "id": mid})
        await s.commit()

    return {"success": True, "url": url, "filename": filename}


@router.put("/{lead_id}")
async def update_pre_lead(lead_id: str, body: UpdateLeadBody, user: dict = Depends(current_user)):
    if not _is_procesamiento(user.get("role", "")):
        raise HTTPException(403, "Acceso denegado")
    try:
        mid = int(lead_id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    col_map = {
        "status":            "status",
        "notaProcesamiento": "nota_procesamiento",
        "fechaVenta":        "fecha_venta",
        "fechaInstalacion":  "fecha_instalacion",
        "nombre":            "nombre",
        "correo":            "correo",
        "phone1":            "phone1",
        "phone2":            "phone2",
        "direccion":         "direccion",
        "fechaNacimiento":   "fecha_nacimiento",
        "servicio":          "servicio",
        "mercado":           "mercado",
        "nota":              "nota",
    }
    date_cols = {"fechaVenta", "fechaInstalacion", "fechaNacimiento"}

    sets = []
    params: dict = {"id": mid, "now": _utcnow()}
    for field, col in col_map.items():
        val = getattr(body, field, None)
        if val is not None:
            if field in date_cols:
                val = _parse_date(str(val))
            else:
                val = str(val).strip()
            sets.append(f"{col} = :{field}")
            params[field] = val

    if not sets:
        raise HTTPException(400, "Sin campos para actualizar")
    sets.append("updated_at = :now")

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text(f"UPDATE pre_leads SET {', '.join(sets)} WHERE id = :id"), params
        )
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Lead no encontrado")

    return {"success": True}
