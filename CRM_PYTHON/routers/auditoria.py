"""Auditoría de llamadas en la Lista de Clientes (botón de audífonos en «Acción»).

Las llamadas auditadas viven en el panel del auditor (Reintento/auditor/panel, base propia). Cada una
puede llevar teléfono y No. de cuenta; con eso se enlaza con el cliente. Esta ventana la ve TODO el
que ve la Lista de Clientes, pero solo en sus clientes: se decide por cliente con la misma frontera
que el listado (leads.lead_visible / fila_visible). La página «Auditoría de llamadas» sigue siendo solo para
administración, Back Office y Monitoreo (auditoria_acceso.py).

Al panel se le piden los datos con la clave de servicio que comparten (AUDITOR_SERVICIO_KEY); corre
en el mismo EC2 (AUDITOR_PANEL_URL, por defecto http://127.0.0.1:8010). Al navegador no le llegan
teléfonos ni cuentas de clientes que no puede ver.

  POST /api/auditoria/marcas           {ids: [...]} → cuáles de esos clientes tienen llamadas
  GET  /api/auditoria/cliente/{id}     las llamadas de un cliente (transcripción y faltas)

Enlace (igual que el panel): si la llamada y el cliente tienen No. de cuenta, manda la cuenta; el
teléfono solo enlaza cuando a alguno le falta.
"""
import os
import re
import time
import unicodedata

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import bindparam, text

from database_mysql import AsyncSessionLocal
from deps import current_user
from routers.leads import _find_id, _mercado_restrict, fila_visible

router = APIRouter(prefix="/api/auditoria", tags=["Auditoría de llamadas"])

_COLS = ("id, mongo_id, mercado, agente, agente_nombre, created_by, "
         "telefono_principal, telefono, telefono_alterno, numero_cuenta")
_POR_ID = text(f"SELECT {_COLS} FROM leads WHERE id IN :ids").bindparams(bindparam("ids", expanding=True))
_POR_MONGO = text(f"SELECT {_COLS} FROM leads WHERE mongo_id IN :ids").bindparams(bindparam("ids", expanding=True))
_CACHE_S = 30
_cache: dict = {"t": 0.0, "vinculos": []}


def _tel(s) -> str:
    d = re.sub(r"\D", "", str(s or ""))
    return d[-10:] if len(d) >= 10 else ""


def _cta(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return re.sub(r"[^0-9a-z]", "", "".join(c for c in s if unicodedata.category(c) != "Mn"))


def _claves(fila) -> tuple[set, str]:
    tels = {_tel(fila.get(k)) for k in ("telefono_principal", "telefono", "telefono_alterno")} - {""}
    return tels, _cta(fila.get("numero_cuenta"))


async def _panel(ruta: str, params=None) -> dict:
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
    if r.status_code >= 400:
        print(f"[auditoria] el panel respondió {r.status_code}: {r.text[:200]}")
        raise HTTPException(status_code=502, detail="El panel de auditoría respondió con error")
    return r.json()


async def _vinculos() -> list:
    if time.monotonic() - _cache["t"] > _CACHE_S:
        _cache["vinculos"] = (await _panel("/api/auditoria/servicio/vinculos")).get("vinculos", [])
        _cache["t"] = time.monotonic()
    return _cache["vinculos"]


async def _leads_visibles(ids: list[str], user: dict) -> dict:
    """{id pedido: fila} solo de los clientes que este usuario puede ver (frontera del listado)."""
    nums, mongos = {}, {}
    for i in ids:
        n, m = _find_id(i)
        if n is not None:
            nums[n] = i
        elif m:
            mongos[m] = i
    filas = []
    async with AsyncSessionLocal() as s:
        if nums:
            filas += (await s.execute(_POR_ID, {"ids": list(nums)})).mappings().all()
        if mongos:
            filas += (await s.execute(_POR_MONGO, {"ids": list(mongos)})).mappings().all()
    restr = await _mercado_restrict(user)
    salida = {}
    for f in filas:
        pedido = nums.get(f["id"]) or mongos.get(f.get("mongo_id"))
        if pedido and fila_visible(f, user, restr):
            salida[pedido] = f
    return salida


class MarcasIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=300)


@router.post("/marcas")
async def marcas(body: MarcasIn, user: dict = Depends(current_user)):
    ids = [str(i)[:64] for i in body.ids if str(i).strip()]
    vinculos = await _vinculos() if ids else []
    if not vinculos:
        return {"success": True, "marcas": {}}
    salida = {}
    for pedido, fila in (await _leads_visibles(ids, user)).items():
        tels, cta = _claves(fila)
        llamadas = faltas = 0
        for v in vinculos:
            ok = (v["cuenta"] == cta) if (v.get("cuenta") and cta) else (v.get("telefono") in tels)
            if ok:
                llamadas += v.get("llamadas", 0)
                faltas += v.get("faltas", 0)
        if llamadas:
            salida[pedido] = {"llamadas": llamadas, "faltas": faltas}
    return {"success": True, "marcas": salida}


@router.get("/cliente/{lead_id}")
async def cliente(lead_id: str, user: dict = Depends(current_user)):
    lid = lead_id[:64]
    fila = (await _leads_visibles([lid], user)).get(lid)
    if not fila:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    tels, cta = _claves(fila)
    if not tels and not cta:
        return {"success": True, "llamadas": []}
    params = [("telefono", t) for t in sorted(tels)] + ([("cuenta", cta)] if cta else [])
    return await _panel("/api/auditoria/servicio/cliente", params)
