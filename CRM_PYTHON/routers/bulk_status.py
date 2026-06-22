from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime, timezone
from typing import List
import re
import realtime

def _utcnow() -> datetime:
    """UTC naive (reemplazo de _utcnow() deprecado en Python 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

router = APIRouter(prefix="/api/leads", tags=["Bulk Status"])

_ALLOWED_ROLES = {
    "admin", "administrador", "administrator", "administrativo",
    "backoffice", "back office", "back_office", "bo", "b.o",
    "rol_icon", "rol-icon", "rol_bamo",
}


def _can_use(user: dict) -> bool:
    r = str(user.get("role") or "").lower().strip()
    return any(r == v or v in r for v in _ALLOWED_ROLES)


def _normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) < 10:
        return ""
    return digits[-10:]


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip()).lower()


class BulkByPhoneBody(BaseModel):
    phones: List[str]
    newStatus: str


class BulkByNameBody(BaseModel):
    names: List[str]
    newStatus: str


@router.post("/bulk-status-by-phone")
async def bulk_status_by_phone(body: BulkByPhoneBody, user: dict = Depends(current_user)):
    if not _can_use(user):
        raise HTTPException(403, "No autorizado")
    if not body.phones:
        raise HTTPException(400, "Se requiere array de teléfonos")
    if not body.newStatus:
        raise HTTPException(400, "Se requiere newStatus")

    input_phones = list({p for p in map(_normalize_phone, body.phones) if len(p) == 10})
    if not input_phones:
        raise HTTPException(400, "Sin números válidos de 10 dígitos")

    now = _utcnow()
    found_rows = []

    async with AsyncSessionLocal() as s:
        for phone in input_phones:
            r = await s.execute(text("""
                SELECT id, nombre_cliente, telefono, telefono_principal, telefono_alterno, status
                FROM leads
                WHERE telefono_principal LIKE :p
                   OR telefono LIKE :p
                   OR telefono_alterno LIKE :p
            """), {"p": f"%{phone}"})
            found_rows.extend(r.mappings().all())

        if not found_rows:
            return {
                "success": True, "updated": 0, "found": 0,
                "notFound": len(input_phones), "foundPhones": [],
                "notFoundPhones": input_phones, "updatedLeads": [],
                "message": "No se encontraron leads con esos teléfonos",
            }

        lead_ids = list({row["id"] for row in found_rows})
        placeholders = ",".join([f":id{i}" for i in range(len(lead_ids))])
        params: dict = {"status": body.newStatus, "now": now, "by": user.get("username", "Sistema")}
        for i, lid in enumerate(lead_ids):
            params[f"id{i}"] = lid
        r2 = await s.execute(text(f"""
            UPDATE leads SET status = :status, updated_at = :now, updated_by = :by
            WHERE id IN ({placeholders})
        """), params)
        await s.commit()
        updated = r2.rowcount

    found_phones_set = set()
    for row in found_rows:
        p = _normalize_phone(
            row.get("telefono_principal") or row.get("telefono") or row.get("telefono_alterno") or ""
        )
        if p:
            found_phones_set.add(p)

    not_found_phones = [p for p in input_phones if p not in found_phones_set]
    updated_leads = [
        {
            "id": str(row["id"]),
            "nombre_cliente": str(row.get("nombre_cliente") or "").strip(),
            "telefono": _normalize_phone(
                row.get("telefono_principal") or row.get("telefono") or row.get("telefono_alterno") or ""
            ),
        }
        for row in found_rows
    ]

    await realtime.publish("residencial", {"type": "residencial", "action": "bulk"})
    return {
        "success": True,
        "message": f"{updated} lead(s) actualizados a \"{body.newStatus}\"",
        "updated": updated,
        "found": len(lead_ids),
        "notFound": len(not_found_phones),
        "foundPhones": list(found_phones_set),
        "notFoundPhones": not_found_phones,
        "updatedLeads": updated_leads,
        "totalPhones": len(input_phones),
    }


@router.post("/bulk-status-by-name")
async def bulk_status_by_name(body: BulkByNameBody, user: dict = Depends(current_user)):
    if not _can_use(user):
        raise HTTPException(403, "No autorizado")
    if not body.names:
        raise HTTPException(400, "Se requiere array de nombres")
    if not body.newStatus:
        raise HTTPException(400, "Se requiere newStatus")

    normalized_names = list({n for n in map(_normalize_name, body.names) if len(n) >= 3})
    if not normalized_names:
        raise HTTPException(400, "Sin nombres válidos (mínimo 3 caracteres)")

    now = _utcnow()
    found_rows = []

    async with AsyncSessionLocal() as s:
        for name in normalized_names[:300]:
            r = await s.execute(text("""
                SELECT id, nombre_cliente, telefono, telefono_principal, status
                FROM leads WHERE LOWER(nombre_cliente) = :name
            """), {"name": name})
            found_rows.extend(r.mappings().all())

        if not found_rows:
            return {
                "success": True, "updated": 0, "found": 0,
                "notFound": len(normalized_names), "foundNames": [],
                "notFoundNames": normalized_names, "updatedLeads": [],
                "message": "No se encontraron leads con esos nombres",
            }

        lead_ids = list({row["id"] for row in found_rows})
        placeholders = ",".join([f":id{i}" for i in range(len(lead_ids))])
        params: dict = {"status": body.newStatus, "now": now, "by": user.get("username", "Sistema")}
        for i, lid in enumerate(lead_ids):
            params[f"id{i}"] = lid
        r2 = await s.execute(text(f"""
            UPDATE leads SET status = :status, updated_at = :now, updated_by = :by
            WHERE id IN ({placeholders})
        """), params)
        await s.commit()
        updated = r2.rowcount

    found_names_set = {_normalize_name(row.get("nombre_cliente") or "") for row in found_rows}
    not_found_names = [n for n in normalized_names if n not in found_names_set]
    updated_leads = [
        {
            "id": str(row["id"]),
            "nombre_cliente": str(row.get("nombre_cliente") or "").strip(),
            "telefono": _normalize_phone(
                row.get("telefono_principal") or row.get("telefono") or ""
            ),
        }
        for row in found_rows
    ]

    await realtime.publish("residencial", {"type": "residencial", "action": "bulk"})
    return {
        "success": True,
        "message": f"{updated} lead(s) actualizados a \"{body.newStatus}\"",
        "updated": updated,
        "found": len(found_names_set),
        "notFound": len(not_found_names),
        "foundNames": list(found_names_set),
        "notFoundNames": not_found_names,
        "updatedLeads": updated_leads,
        "totalNames": len(normalized_names),
    }
