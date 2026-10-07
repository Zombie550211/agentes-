"""Horarios que llegan DESDE el Sistema de Cuadratura (sincronización en los dos sentidos).

El CRM manda los horarios a Cuadratura (cuadratura_sync.py) y Cuadratura le devuelve aquí
cada cambio que hace RRHH: un turno asignado o reagendado, un día libre, una vacación o un
compensatorio. Así /horarios.html y Horarios de Cuadratura muestran lo mismo.

POST /api/horarios/desde-cuadratura  (cabecera X-API-Key = CUADRATURA_ENTRADA_KEY)
{"changes": [
  {"crm_agent_id": "152", "date": "2026-10-12", "start": "08:00", "end": "17:00", "break_minutes": 60, "notes": null},
  {"crm_agent_id": "152", "date": "2026-10-13", "rest_day": true, "notes": "Vacación"},
  {"crm_agent_id": "152", "date": "2026-10-14", "clear": true}
]}

Cada cambio reemplaza el día del agente en agent_schedules (updated_by = "cuadratura");
"clear" lo deja sin datos (libre). El bucle de envío del CRM ve que la semana cambió y la
reenvía a Cuadratura, que ya la tiene igual: no hay rebote.

Variable de entorno:
  CUADRATURA_ENTRADA_KEY  clave compartida; la misma que CRM_API_KEY en el .env de Cuadratura.
"""
import hmac
import os
from datetime import date, time
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

from database_mysql import AsyncSessionLocal

router = APIRouter(prefix="/api/horarios", tags=["Horarios"])


class CambioIn(BaseModel):
    crm_agent_id: str = Field(min_length=1, max_length=64)
    date: date
    start: Optional[time] = None
    end: Optional[time] = None
    break_minutes: int = Field(default=60, ge=0, le=480)
    rest_day: bool = False
    clear: bool = False
    notes: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _check(self):
        if not (self.clear or self.rest_day) and (self.start is None or self.end is None):
            raise ValueError(f"{self.date}: indique start y end, rest_day o clear")
        return self


class CambiosIn(BaseModel):
    changes: List[CambioIn] = Field(min_length=1, max_length=2000)


def _verificar_clave(clave: Optional[str]) -> None:
    esperada = os.getenv("CUADRATURA_ENTRADA_KEY", "")
    if not esperada:
        raise HTTPException(503, "Falta CUADRATURA_ENTRADA_KEY en el .env del CRM")
    if not clave or not hmac.compare_digest(clave, esperada):
        raise HTTPException(401, "Clave inválida")


@router.post("/desde-cuadratura")
async def recibir_de_cuadratura(body: CambiosIn, x_api_key: Optional[str] = Header(None)):
    _verificar_clave(x_api_key)
    ids = sorted({c.crm_agent_id for c in body.changes if c.crm_agent_id.isdigit()})
    aplicados, errores = 0, []
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"SELECT id FROM users WHERE id IN ({','.join(ids) or '0'})"))
        existentes = {str(i) for i in r.scalars().all()}
        for c in body.changes:
            if c.crm_agent_id not in existentes:
                errores.append({"crm_agent_id": c.crm_agent_id, "date": c.date.isoformat(), "error": "Agente no existe en el CRM"})
                continue
            await s.execute(text("DELETE FROM agent_schedules WHERE user_id = :u AND work_date = :d"),
                            {"u": int(c.crm_agent_id), "d": c.date})
            if not c.clear:
                await s.execute(text("""
                    INSERT INTO agent_schedules
                        (user_id, work_date, start_time, end_time, break_minutes, rest_day, notes, updated_by)
                    VALUES (:u, :d, :st, :en, :b, :r, :n, 'cuadratura')
                """), {"u": int(c.crm_agent_id), "d": c.date,
                       "st": None if c.rest_day else c.start, "en": None if c.rest_day else c.end,
                       "b": 0 if c.rest_day else c.break_minutes, "r": 1 if c.rest_day else 0, "n": c.notes})
            aplicados += 1
        await s.commit()
    return {"success": True, "aplicados": aplicados, "errores": errores}
