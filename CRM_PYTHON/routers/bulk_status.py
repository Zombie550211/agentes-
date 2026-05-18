from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database import get_db
from deps import current_user
from datetime import datetime
from typing import List
import re

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


def _escape_regex(s: str) -> str:
    return re.escape(str(s or ""))


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

    db = get_db()
    coll = db["costumers_unified"]

    phone_regexes = [re.compile(_escape_regex(p) + "$") for p in input_phones]
    query = {
        "$or": [
            {"telefono": {"$in": input_phones}},
            {"telefono_principal": {"$in": input_phones}},
            {"telefono_alterno": {"$in": input_phones}},
            {"telefono": {"$in": phone_regexes}},
            {"telefono_principal": {"$in": phone_regexes}},
            {"telefono_alterno": {"$in": phone_regexes}},
        ]
    }

    found_leads = await coll.find(
        query,
        {"_id": 1, "nombre_cliente": 1, "telefono": 1, "telefono_principal": 1, "telefono_alterno": 1, "status": 1}
    ).to_list(None)

    if not found_leads:
        return {
            "success": True, "updated": 0, "found": 0,
            "notFound": len(input_phones), "foundPhones": [],
            "notFoundPhones": input_phones, "updatedLeads": [],
            "message": "No se encontraron leads con esos teléfonos",
        }

    lead_ids = [l["_id"] for l in found_leads]
    update_result = await coll.update_many(
        {"_id": {"$in": lead_ids}},
        {"$set": {"status": body.newStatus, "updatedAt": datetime.utcnow(), "updatedBy": user.get("username", "Sistema")}},
    )

    found_phones_set = set()
    for l in found_leads:
        p = _normalize_phone(l.get("telefono_principal") or l.get("telefono") or l.get("telefono_alterno") or "")
        if p:
            found_phones_set.add(p)

    not_found_phones = [p for p in input_phones if p not in found_phones_set]
    updated_leads = [
        {"id": str(l["_id"]), "nombre_cliente": str(l.get("nombre_cliente") or "").strip(),
         "telefono": _normalize_phone(l.get("telefono_principal") or l.get("telefono") or l.get("telefono_alterno") or "")}
        for l in found_leads
    ]

    return {
        "success": True,
        "message": f"{update_result.modified_count} lead(s) actualizados a \"{body.newStatus}\"",
        "updated": update_result.modified_count,
        "found": len(found_leads),
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

    db = get_db()
    coll = db["costumers_unified"]

    regexes = [re.compile(f"^{_escape_regex(n)}$", re.IGNORECASE) for n in normalized_names[:300]]
    found_leads = await coll.find(
        {"nombre_cliente": {"$in": regexes}},
        {"_id": 1, "nombre_cliente": 1, "telefono": 1, "telefono_principal": 1, "status": 1},
    ).to_list(None)

    if not found_leads:
        return {
            "success": True, "updated": 0, "found": 0,
            "notFound": len(normalized_names), "foundNames": [],
            "notFoundNames": normalized_names, "updatedLeads": [],
            "message": "No se encontraron leads con esos nombres",
        }

    lead_ids = [l["_id"] for l in found_leads]
    update_result = await coll.update_many(
        {"_id": {"$in": lead_ids}},
        {"$set": {"status": body.newStatus, "updatedAt": datetime.utcnow(), "updatedBy": user.get("username", "Sistema")}},
    )

    found_names_set = {_normalize_name(l.get("nombre_cliente") or "") for l in found_leads}
    not_found_names = [n for n in normalized_names if n not in found_names_set]
    updated_leads = [
        {"id": str(l["_id"]), "nombre_cliente": str(l.get("nombre_cliente") or "").strip(),
         "telefono": _normalize_phone(l.get("telefono_principal") or l.get("telefono") or "")}
        for l in found_leads
    ]

    return {
        "success": True,
        "message": f"{update_result.modified_count} lead(s) actualizados a \"{body.newStatus}\"",
        "updated": update_result.modified_count,
        "found": len(found_names_set),
        "notFound": len(not_found_names),
        "foundNames": list(found_names_set),
        "notFoundNames": not_found_names,
        "updatedLeads": updated_leads,
        "totalNames": len(normalized_names),
    }
