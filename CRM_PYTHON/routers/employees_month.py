from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
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
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM employees_month ORDER BY updated_at DESC"))
        docs = r.mappings().all()
    return [
        {
            "employee":    d.get("employee"),
            "name":        d.get("name", ""),
            "description": d.get("description", ""),
            "imageUrl":    _normalize_url(d.get("image_url", "")),
            "date":        str(d.get("period_date") or ""),
            "updatedAt":   str(d.get("updated_at") or ""),
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
    now = datetime.utcnow()
    async with AsyncSessionLocal() as s:
        exists = await s.execute(text("SELECT id FROM employees_month WHERE employee = :e LIMIT 1"), {"e": body.employee})
        if exists.first():
            await s.execute(text("""
                UPDATE employees_month SET name = :name, description = :desc, image_url = :img,
                    period_date = :date, updated_at = :now
                WHERE employee = :employee
            """), {
                "name": body.name or "", "desc": body.description or "",
                "img": body.imageUrl or "", "date": body.date,
                "now": now, "employee": body.employee,
            })
        else:
            await s.execute(text("""
                INSERT INTO employees_month (employee, name, description, image_url, period_date, updated_at)
                VALUES (:employee, :name, :desc, :img, :date, :now)
            """), {
                "employee": body.employee, "name": body.name or "",
                "desc": body.description or "", "img": body.imageUrl or "",
                "date": body.date, "now": now,
            })
        await s.commit()
    return {"success": True, "message": "Empleado del mes guardado"}


@router.delete("/{employee}")
async def delete_employee(employee: str, user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if employee not in VALID_EMPLOYEES:
        raise HTTPException(400, 'Parámetro "employee" inválido (first|second)')
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM employees_month WHERE employee = :e"), {"e": employee})
        await s.commit()
    return {"success": True, "message": "Empleado eliminado"}
