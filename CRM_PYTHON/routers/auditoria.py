"""Auditoría de llamadas en la Lista de Clientes (botón de audífonos en «Acción»).

Las llamadas auditadas viven en el panel del auditor (Reintento/auditor/panel, base propia). Cada una
puede llevar teléfono y No. de cuenta; con eso se enlaza con el cliente. Este router comprueba quién
puede verlo (auditoria_acceso.py: Monitoreo, administración y Back Office) y le pide los datos al
panel con la clave de servicio que ya comparten (AUDITOR_SERVICIO_KEY). El panel corre en el mismo
EC2 (AUDITOR_PANEL_URL, por defecto http://127.0.0.1:8010).

  GET /api/auditoria/vinculos          teléfonos y cuentas que tienen llamadas (para pintar el botón)
  GET /api/auditoria/cliente           las llamadas de un cliente (?telefono=…&telefono=…&cuenta=…)
"""
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

import auditoria_acceso
from deps import current_user

router = APIRouter(prefix="/api/auditoria", tags=["Auditoría de llamadas"])


def _auditor(user: dict = Depends(current_user)) -> dict:
    if not auditoria_acceso.puede_ver(user):
        raise HTTPException(status_code=403, detail="La Auditoría de llamadas no está disponible para tu usuario")
    return user


async def _panel(ruta: str, params=None) -> httpx.Response:
    clave = os.getenv("AUDITOR_SERVICIO_KEY", "")
    if not clave:
        raise HTTPException(status_code=503, detail="Falta AUDITOR_SERVICIO_KEY en el .env del CRM")
    url = os.getenv("AUDITOR_PANEL_URL", "http://127.0.0.1:8010").rstrip("/") + ruta
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(url, params=params, headers={"X-Api-Key": clave})
    except httpx.HTTPError as e:
        print(f"[auditoria] el panel no responde: {e}")
        raise HTTPException(status_code=503, detail="El panel de auditoría no responde")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="No encontrado")
    if r.status_code >= 400:
        print(f"[auditoria] el panel respondió {r.status_code}: {r.text[:200]}")
        raise HTTPException(status_code=502, detail="El panel de auditoría respondió con error")
    return r


@router.get("/vinculos")
async def vinculos(user: dict = Depends(_auditor)):
    return (await _panel("/api/auditoria/servicio/vinculos")).json()


@router.get("/cliente")
async def cliente(telefono: list[str] = Query(default=[]), cuenta: str = Query(default="", max_length=60),
                  user: dict = Depends(_auditor)):
    params = [("telefono", t[:40]) for t in telefono[:4]] + ([("cuenta", cuenta)] if cuenta else [])
    return (await _panel("/api/auditoria/servicio/cliente", params)).json()
