from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database import get_db
from deps import current_user, require_roles, ADMIN_ROLES
from datetime import datetime
from typing import Optional
import re

router = APIRouter(prefix="/api/employees-of-month", tags=["Employees of Month"])

VALID_EMPLOYEES = {"first", "second"}

def _normalize_url(v: str) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    if s.startswith("data:"):
        return s
    s = s.replace("\\", "/")
    if re.match(r"^https?://", s, re.IGNORECASE):
        return s
    if "/" not in s and re.search(r"\.[a-z0-9]{2,6}$", s, re.IGNORECASE):
        return "/uploads/" + s
    return s if s.startswith("/") else "/" + s

class EmployeeBody(BaseModel):
    employee: str
    name: Optional[str] = ""
    description: Optional[str] = ""
    imageUrl: Optional[str] = ""
    date: Optional[str] = None

@router.get("/")
async def get_employees():
    db = get_db()
    docs = await db["employeesOfMonth"].find({}).sort("updatedAt", -1).to_list(None)
    return [
        {
            "employee":    d.get("employee"),
            "name":        d.get("name", ""),
            "description": d.get("description", ""),
            "imageUrl":    _normalize_url(d.get("imageUrl", "")),
            "imageData":   _normalize_url(d.get("imageData")) if d.get("imageData") else None,
            "date":        d.get("date"),
            "updatedAt":   d.get("updatedAt"),
        }
        for d in docs
    ]

@router.post("/migrate-cloudinary")
async def migrate_cloudinary(user: dict = Depends(require_roles(*ADMIN_ROLES))):
    return {"success": False, "message": "Migración Cloudinary no implementada en Python aún"}

@router.post("/")
async def upsert_employee(body: EmployeeBody, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if body.employee not in VALID_EMPLOYEES:
        raise HTTPException(400, 'Parámetro "employee" inválido (first|second)')
    db = get_db()
    now = datetime.utcnow()
    doc = {
        "employee": body.employee, "name": body.name or "",
        "description": body.description or "", "imageUrl": body.imageUrl or "",
        "date": body.date, "updatedAt": now
    }
    await db["employeesOfMonth"].update_one({"employee": body.employee}, {"$set": doc}, upsert=True)
    return {"success": True, "message": "Empleado del mes guardado", "data": doc}

@router.delete("/{employee}")
async def delete_employee(employee: str, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if employee not in VALID_EMPLOYEES:
        raise HTTPException(400, 'Parámetro "employee" inválido (first|second)')
    db = get_db()
    await db["employeesOfMonth"].delete_one({"employee": employee})
    return {"success": True, "message": "Empleado eliminado"}
