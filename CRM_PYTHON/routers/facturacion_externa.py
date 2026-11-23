"""API externa de facturación (para que Claude la llene desde un documento).

Pensada para un servicio de fuera del CRM (sin sesión de navegador): se autentica con
una llave en la cabecera `X-API-Key` (o `Authorization: Bearer <llave>`).

  POST /api/externo/facturacion/residencial   guarda un día de facturación residencial
  POST /api/externo/facturacion/lineas        guarda un día de facturación de Líneas
  GET  /api/externo/facturacion/resumen       lee un día y el acumulado del mes

Al guardar se envían los datos con NOMBRES (no el arreglo de posiciones de la página):
solo se cambian las cuentas que vengan en el cuerpo; el resto del día queda como estaba.
El valor por venta, los costos y los totales los calcula el servidor con las mismas
fórmulas que la página (frontend/residencial/facturacion.html).

Seguridad:
  - Esta llave solo sirve para estas rutas: no abre ninguna otra parte del CRM.
  - Llaves en FACTURACION_API_KEYS del .env, separadas por coma (para rotar sin cortes).
    Sin la variable, la API responde 503 y queda apagada.
  - Comparación en tiempo constante, límite de peticiones por IP, montos y cantidades
    validados (no negativos, con tope), fechas solo de hoy hacia atrás.
  - Cada guardado queda con updated_by = "api-externa" y en el log.
"""
from __future__ import annotations

import hmac
import json
import logging
import math
import os
import unicodedata
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from limiter import limiter
from routers.facturacion import _campos_from_row as _campos_res
from routers.facturacion_lineas_pub import _campos_from_row as _campos_lin
from tiempo_sv import ahora_sv

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/externo/facturacion", tags=["Facturación (API externa)"])

AUTOR = "api-externa"

# Residencial: nombre → (índice monto, índice ventas, índice valor venta) en facturacion.campos.
PUBLICISTAS = {
    "Alexis": (0, 1, 2),
    "Alexis 2": (17, 18, 19),
    "Garay Residencial": (3, 4, 5),
    "Tito": (9, 10, 11),
    "Tito Líneas": (6, 7, 8),
}
_TOTAL_DIA, _TOTAL_VENTAS, _VALOR_VENTA, _PUNTOS = 12, 13, 14, 15
_LARGO_RES = 20

# Líneas: nombre → (índice ventas, índice líneas, índice monto) en facturacion_lineas_pub.campos.
CUENTAS_LINEAS = {
    "Líneas Garay": (0, 1, 2),
    "Líneas Connecting": (3, 4, 5),
}
_LIN_TOTAL_MONTO, _LIN_TOTAL_VENTAS, _LIN_TOTAL_LINEAS = 6, 7, 8

def _clave(nombre: str) -> str:
    """Nombre comparable: sin tildes, sin mayúsculas ni espacios de más ("lineas  GARAY")."""
    s = unicodedata.normalize("NFD", str(nombre)).encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


_PUB_POR_CLAVE = {_clave(n): n for n in PUBLICISTAS}
_LIN_POR_CLAVE = {_clave(n): n for n in CUENTAS_LINEAS}


def _canonicos(recibido: dict, por_clave: dict, que: str, validos) -> dict:
    """Pasa los nombres recibidos a los oficiales; 422 si alguno no existe o se repite."""
    out, malos = {}, []
    for nombre, datos in recibido.items():
        oficial = por_clave.get(_clave(nombre))
        if oficial is None:
            malos.append(nombre)
        elif oficial in out:
            raise HTTPException(422, f"{que} repetido: {oficial}")
        else:
            out[oficial] = datos
    if malos:
        raise HTTPException(422, f"{que} desconocido: {', '.join(sorted(malos))}. Válidos: {', '.join(validos)}")
    return out


_MAX_MONTO = 1_000_000
_MAX_CANTIDAD = 100_000


# ── Autenticación por llave ──────────────────────────────────────

def _llaves() -> list[str]:
    return [k.strip() for k in os.getenv("FACTURACION_API_KEYS", "").split(",") if k.strip()]


def verificar_llave(x_api_key: Optional[str], authorization: Optional[str]) -> None:
    llaves = _llaves()
    if not llaves:
        raise HTTPException(503, "API de facturación desactivada (falta FACTURACION_API_KEYS)")
    recibida = (x_api_key or "").strip()
    if not recibida and (authorization or "").startswith("Bearer "):
        recibida = authorization[7:].strip()
    ok = False
    for k in llaves:   # sin cortar en la primera: no filtra tiempos
        ok |= hmac.compare_digest(recibida.encode(), k.encode())
    if not recibida or not ok:
        raise HTTPException(401, "Llave inválida")


async def llave(x_api_key: Optional[str] = Header(None),
                authorization: Optional[str] = Header(None)) -> None:
    """Dependencia: se evalúa ANTES que el cuerpo, así sin llave no se revela el formato."""
    verificar_llave(x_api_key, authorization)


def _validar_fecha(dia: date) -> None:
    if dia > ahora_sv().date() or dia.year < 2020:
        raise HTTPException(400, "Fecha fuera de rango (debe ser de hoy hacia atrás)")


# ── Números con el mismo formato que guarda la página ────────────

def _n(v) -> float:
    try:
        return float(str(v or "").replace("$", "").replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def _dinero(x: float) -> str:
    """Como money() de la página: TRUNCA a 2 decimales (37.625 → "37.62"), no redondea."""
    return f"{math.trunc(x * 100) / 100:.2f}"


def _num(x: float) -> str:
    """Como String(número) en JS: 3 → "3", 120.5 → "120.5"."""
    x = round(x, 2)
    return str(int(x)) if x == int(x) else str(x)


def _r(x: float) -> float:
    return round(x, 2)


# ── Escritura: mezclar lo recibido con lo guardado y recalcular ──

class MontoVentas(BaseModel):
    model_config = ConfigDict(extra="forbid")
    monto: Optional[float] = Field(None, ge=0, le=_MAX_MONTO)
    ventas: Optional[int] = Field(None, ge=0, le=_MAX_CANTIDAD)


class ResidencialIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fecha: date
    publicistas: Dict[str, MontoVentas] = Field(default_factory=dict)
    puntos: Optional[float] = Field(None, ge=0, le=_MAX_CANTIDAD)


class VentasLineasMonto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ventas: Optional[int] = Field(None, ge=0, le=_MAX_CANTIDAD)
    lineas: Optional[int] = Field(None, ge=0, le=_MAX_CANTIDAD)
    monto: Optional[float] = Field(None, ge=0, le=_MAX_MONTO)


class LineasIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fecha: date
    cuentas: Dict[str, VentasLineasMonto]


def validar_residencial(body: ResidencialIn) -> None:
    body.publicistas = _canonicos(body.publicistas, _PUB_POR_CLAVE, "Publicista", PUBLICISTAS)
    if not body.publicistas and body.puntos is None:
        raise HTTPException(422, "No se envió ningún dato")


def aplicar_residencial(campos: list, body: ResidencialIn) -> list:
    """Devuelve los 20 campos del día con lo recibido aplicado y los cálculos rehechos."""
    validar_residencial(body)
    c = [str(v) for v in campos] + [""] * (_LARGO_RES - len(campos))
    c = c[:_LARGO_RES]
    for nombre, datos in body.publicistas.items():
        im, iv, _ = PUBLICISTAS[nombre]
        if datos.monto is not None:
            c[im] = _dinero(datos.monto)
        if datos.ventas is not None:
            c[iv] = str(datos.ventas)
    if body.puntos is not None:
        c[_PUNTOS] = _num(body.puntos)
    # Igual que recalcularFila() de la página.
    total_monto = total_ventas = 0.0
    for im, iv, ival in PUBLICISTAS.values():
        monto, ventas = _n(c[im]), _n(c[iv])
        c[ival] = _dinero(monto / ventas) if ventas > 0 else ""
        total_monto += monto
        total_ventas += ventas
    c[_TOTAL_DIA] = _dinero(total_monto) if total_monto > 0 else ""
    c[_TOTAL_VENTAS] = _num(total_ventas) if total_ventas > 0 else ""
    c[_VALOR_VENTA] = _dinero(total_monto / total_ventas) if total_ventas > 0 else ""
    return c


def validar_lineas(body: LineasIn) -> None:
    body.cuentas = _canonicos(body.cuentas, _LIN_POR_CLAVE, "Cuenta", CUENTAS_LINEAS)
    if not body.cuentas:
        raise HTTPException(422, "No se envió ningún dato")


def aplicar_lineas(campos: list, body: LineasIn) -> list:
    """Devuelve los 9 campos del día de Líneas con lo recibido aplicado y los totales rehechos."""
    validar_lineas(body)
    c = ([str(v) for v in campos] + [""] * 9)[:9]
    for nombre, datos in body.cuentas.items():
        iv, il, im = CUENTAS_LINEAS[nombre]
        if datos.ventas is not None:
            c[iv] = str(datos.ventas)
        if datos.lineas is not None:
            c[il] = str(datos.lineas)
        if datos.monto is not None:
            c[im] = _num(datos.monto)
    # Igual que guardarLineas() de la página.
    c[_LIN_TOTAL_MONTO] = _num(sum(_n(c[im]) for _, _, im in CUENTAS_LINEAS.values()))
    c[_LIN_TOTAL_VENTAS] = _num(sum(_n(c[iv]) for iv, _, _ in CUENTAS_LINEAS.values()))
    c[_LIN_TOTAL_LINEAS] = _num(sum(_n(c[il]) for _, il, _ in CUENTAS_LINEAS.values()))
    return c


async def _guardar(tabla: str, dia: date, leer, aplicar) -> list:
    """Lee el día, aplica los cambios y hace upsert en la misma transacción."""
    q = {"y": dia.year, "m": dia.month, "d": dia.day}
    ahora = datetime.now(timezone.utc).replace(tzinfo=None)
    fecha_str = dia.strftime("%d/%m/%Y")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            f"SELECT campos FROM {tabla} WHERE anio = :y AND mes = :m AND dia = :d LIMIT 1 FOR UPDATE"), q)
        fila = r.mappings().first()
        campos = aplicar(leer(fila) if fila else [])
        params = {**q, "fecha": fecha_str, "campos": json.dumps(campos), "by": AUTOR, "now": ahora}
        if fila:
            await s.execute(text(
                f"UPDATE {tabla} SET fecha_str = :fecha, campos = :campos, updated_at = :now, updated_by = :by "
                f"WHERE anio = :y AND mes = :m AND dia = :d"), params)
        else:
            await s.execute(text(
                f"INSERT INTO {tabla} (anio, mes, dia, fecha_str, campos, created_by, updated_by, created_at, updated_at) "
                f"VALUES (:y, :m, :d, :fecha, :campos, :by, :by, :now, :now)"), params)
        await s.commit()
    log.info("facturación externa: %s %s guardado", tabla, dia.isoformat())
    return campos


@router.post("/residencial")
@limiter.limit("60/minute")
async def guardar_residencial(
    request: Request, body: ResidencialIn,
    _: None = Depends(llave),
):
    _validar_fecha(body.fecha)
    validar_residencial(body)
    campos = await _guardar("facturacion", body.fecha, _campos_res, lambda c: aplicar_residencial(c, body))
    return {"ok": True, "fecha": body.fecha.isoformat(), "dia": resumen_residencial([campos])}


@router.post("/lineas")
@limiter.limit("60/minute")
async def guardar_lineas(
    request: Request, body: LineasIn,
    _: None = Depends(llave),
):
    _validar_fecha(body.fecha)
    validar_lineas(body)
    campos = await _guardar("facturacion_lineas_pub", body.fecha, _campos_lin, lambda c: aplicar_lineas(c, body))
    return {"ok": True, "fecha": body.fecha.isoformat(), "dia": resumen_lineas([campos])}


# ── Lectura: resumen del día y del mes ───────────────────────────

def resumen_residencial(filas: list[list]) -> dict:
    """Suma una o varias filas (días) de `facturacion.campos`."""
    por, total_monto, total_ventas = {}, 0.0, 0.0
    for nombre, (im, iv, _) in PUBLICISTAS.items():
        monto = sum(_n(f[im]) for f in filas)
        ventas = sum(_n(f[iv]) for f in filas)
        por[nombre] = {"monto": _r(monto), "ventas": int(ventas),
                       "valor_venta": _r(monto / ventas) if ventas else None}
        total_monto += monto
        total_ventas += ventas
    puntos = sum(_n(f[_PUNTOS]) for f in filas)
    return {
        "monto": _r(total_monto),
        "ventas": int(total_ventas),
        "valor_venta": _r(total_monto / total_ventas) if total_ventas else None,
        "puntos": _r(puntos),
        "cpa_puntos": _r(total_monto / puntos) if puntos else None,
        "por_publicista": por,
    }


def resumen_lineas(filas: list[list]) -> dict:
    """Suma una o varias filas (días) de `facturacion_lineas_pub.campos`."""
    por, total_monto, total_ventas, total_lineas = {}, 0.0, 0.0, 0.0
    for nombre, (iv, il, im) in CUENTAS_LINEAS.items():
        ventas = sum(_n(f[iv]) for f in filas)
        lineas = sum(_n(f[il]) for f in filas)
        monto = sum(_n(f[im]) for f in filas)
        por[nombre] = {"monto": _r(monto), "ventas": int(ventas), "lineas": int(lineas),
                       "costo_venta": _r(monto / ventas) if ventas else None,
                       "costo_linea": _r(monto / lineas) if lineas else None}
        total_monto += monto
        total_ventas += ventas
        total_lineas += lineas
    return {"monto": _r(total_monto), "ventas": int(total_ventas), "lineas": int(total_lineas),
            "por_cuenta": por}


def armar_resumen(dia: date, res_mes: dict[int, list], lin_mes: dict[int, list]) -> dict:
    """res_mes / lin_mes: {día del mes: campos} del mes de `dia`, ya leídos de la BD."""
    hasta = range(1, dia.day + 1)

    def bloque(res: list[list], lin: list[list]) -> dict:
        r, l = resumen_residencial(res), resumen_lineas(lin)
        return {"monto_total": _r(r["monto"] + l["monto"]), "residencial": r, "lineas": l}

    del_dia = bloque([res_mes[dia.day]] if dia.day in res_mes else [],
                     [lin_mes[dia.day]] if dia.day in lin_mes else [])
    del_dia["hay_datos"] = dia.day in res_mes or dia.day in lin_mes
    return {
        "ok": True,
        "fecha": dia.isoformat(),
        "moneda": "USD",
        "dia": del_dia,
        "mes_hasta_la_fecha": {
            "desde": dia.replace(day=1).isoformat(),
            "hasta": dia.isoformat(),
            "dias_con_datos": len({d for d in hasta if d in res_mes or d in lin_mes}),
            **bloque([res_mes[d] for d in hasta if d in res_mes],
                     [lin_mes[d] for d in hasta if d in lin_mes]),
        },
    }


@router.get("/resumen")
@limiter.limit("60/minute")
async def resumen(
    request: Request,
    fecha: Optional[date] = Query(None, description="AAAA-MM-DD. Por defecto, ayer (hora de El Salvador)."),
    _: None = Depends(llave),
):
    dia = fecha or (ahora_sv().date() - timedelta(days=1))
    _validar_fecha(dia)
    q = {"y": dia.year, "m": dia.month, "d": dia.day}
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT dia, campos FROM facturacion WHERE anio = :y AND mes = :m AND dia <= :d"), q)
        res_mes = {int(row["dia"]): _campos_res(row) for row in r.mappings().all()}
        r = await s.execute(text(
            "SELECT dia, campos FROM facturacion_lineas_pub WHERE anio = :y AND mes = :m AND dia <= :d"), q)
        lin_mes = {int(row["dia"]): _campos_lin(row) for row in r.mappings().all()}
    return armar_resumen(dia, res_mes, lin_mes)
