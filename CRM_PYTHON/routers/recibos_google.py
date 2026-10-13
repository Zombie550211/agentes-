"""Recibos de Google Ads: registro de los pagos de publicidad con su comprobante PDF.

Solo administradores. Cada PDF se escanea antes de guardarlo (recibos_escaner.py) y
el usuario revisa los datos en la página (frontend/residencial/recibos-google.html).

Los PDF NO van en uploads/ (esa carpeta se sirve por /uploads a cualquier sesión,
agentes incluidos): se guardan en RECIBOS_GOOGLE_DIR (por defecto
<repo>/datos_privados/recibos_google, fuera de git) con un nombre uuid, y solo se
sirven por esta API.

Cada recibo se envía también al Sistema de Cuadratura, donde es solo lectura
(recibos_cuadratura.py): al guardarlo y, si no llega, en el reintento cada 5 min.

Las cuentas son las de la facturación residencial. `campo` es el índice del monto de
esa cuenta en `facturacion.campos` (ver routers/facturacion.py), para conectar ambas
cosas más adelante; por ahora no se escribe en facturación.
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import os
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from database_mysql import AsyncSessionLocal
from deps import ADMIN_ROLES, require_roles
from recibos_escaner import escanear
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/recibos-google", tags=["Recibos Google Ads"])
solo_admin = require_roles(*ADMIN_ROLES)

PDF_DIR = Path(os.environ.get("RECIBOS_GOOGLE_DIR")
               or Path(__file__).resolve().parent.parent.parent / "datos_privados" / "recibos_google")
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_ARCHIVOS = 20
TIMEOUT_ESCANEO = 20  # segundos

# (clave, nombre, índice del monto en facturacion.campos, clase de color en facturación)
CUENTAS = (
    ("alexis", "Alexis", 0, "gh-alexis"),
    ("alexis2", "Alexis 2", 17, "gh-alexis2"),
    ("garay_lineas", "Garay Residencial", 3, "gh-alejandro"),  # clave antigua: así está guardada en la BD
    ("tito", "Tito", 9, "gh-tito"),
    ("tito_lineas", "Tito Líneas", 6, "gh-tito-lineas"),
)
_NOMBRE_CUENTA = {c[0]: c[1] for c in CUENTAS}
_ORDEN_CUENTA = {c[0]: i for i, c in enumerate(CUENTAS)}
_BILLING = re.compile(r"\d{4}-\d{4}-\d{4}")

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS recibos_google (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    fecha_pago      DATE         NOT NULL,
    cuenta          VARCHAR(40)  NOT NULL,
    monto_centavos  INT          NOT NULL,
    billing_id      VARCHAR(14)  NULL,
    metodo_pago     VARCHAR(40)  NULL,
    archivo_nombre  VARCHAR(160) NOT NULL,
    archivo_ruta    VARCHAR(64)  NOT NULL,
    sha256          CHAR(64)     NOT NULL,
    subido_por      VARCHAR(150) NOT NULL,
    creado          DATETIME     NOT NULL,
    cuadratura_enviado DATETIME  NULL,
    cuadratura_error   VARCHAR(255) NULL,
    UNIQUE KEY uq_recibos_google_sha (sha256),
    KEY ix_recibos_google_fecha (fecha_pago),
    KEY ix_recibos_google_billing (billing_id),
    CONSTRAINT ck_recibos_google_monto CHECK (monto_centavos > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


# Columnas añadidas después de crear la tabla (la de producción ya existía).
_COLUMNAS_NUEVAS = {
    "cuadratura_enviado": "DATETIME NULL",
    "cuadratura_error": "VARCHAR(255) NULL",
}


async def ensure_table() -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    async with AsyncSessionLocal() as s:
        await s.execute(text(CREATE_TABLE_SQL))
        r = await s.execute(text(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_schema = DATABASE() AND table_name = 'recibos_google'"))
        existentes = {str(f[0]).lower() for f in r.all()}
        for col, tipo in _COLUMNAS_NUEVAS.items():
            if col not in existentes:
                await s.execute(text(f"ALTER TABLE recibos_google ADD COLUMN {col} {tipo}"))
        await s.commit()


# ── utilidades ───────────────────────────────────────────────────
def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _centavos(valor, nombre: str) -> int:
    s = str(valor if valor is not None else "").strip().replace(",", "")
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s):
        raise HTTPException(422, f"{nombre}: monto inválido")
    n = round(float(s) * 100)
    if n <= 0:
        raise HTTPException(422, f"{nombre}: el monto debe ser mayor que 0")
    if n > 2_000_000_000:
        raise HTTPException(422, f"{nombre}: monto demasiado grande")
    return n


def _fecha(valor: Optional[str], campo: str) -> Optional[str]:
    if not valor:
        return None
    try:
        return date.fromisoformat(str(valor)).isoformat()
    except ValueError:
        raise HTTPException(422, f"{campo}: usa el formato AAAA-MM-DD")


def _nombre_seguro(nombre: Optional[str]) -> str:
    base = Path(str(nombre or "recibo.pdf").replace("\\", "/")).name
    base = re.sub(r"[^\w.\- ]", "_", base)[:150].strip(". ") or "recibo.pdf"
    return base if base.lower().endswith(".pdf") else base + ".pdf"


def _texto_corto(valor, maximo: int) -> Optional[str]:
    s = re.sub(r"[\x00-\x1f\x7f]", "", str(valor or "")).strip()
    return s[:maximo] or None


async def _leer_pdf(archivo: UploadFile) -> tuple[str, bytes]:
    nombre = _nombre_seguro(archivo.filename)
    contenido = await archivo.read(MAX_PDF_BYTES + 1)
    if len(contenido) > MAX_PDF_BYTES:
        raise HTTPException(413, f"{nombre} pasa de 10 MB")
    # Se mira la cabecera, no la extensión ni el content-type que manda el navegador.
    if not contenido.startswith(b"%PDF-"):
        raise HTTPException(415, f"{nombre} no es un PDF")
    return nombre, contenido


def _filtro_sql(desde, hasta, cuenta, q) -> tuple[str, dict]:
    where, params = [], {}
    if d := _fecha(desde, "desde"):
        where.append("fecha_pago >= :desde"); params["desde"] = d
    if h := _fecha(hasta, "hasta"):
        where.append("fecha_pago <= :hasta"); params["hasta"] = h
    if cuenta:
        if cuenta not in _NOMBRE_CUENTA:
            raise HTTPException(422, "Cuenta desconocida")
        where.append("cuenta = :cuenta"); params["cuenta"] = cuenta
    if q and q.strip():
        where.append("billing_id LIKE :q")
        params["q"] = "%" + re.sub(r"[%_\\]", "", q.strip()) + "%"
    return (" WHERE " + " AND ".join(where)) if where else "", params


async def _recibos(desde, hasta, cuenta, q) -> list[dict]:
    where, params = _filtro_sql(desde, hasta, cuenta, q)
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT id, fecha_pago, cuenta, monto_centavos, billing_id, metodo_pago,"
            " archivo_nombre, subido_por, cuadratura_enviado IS NOT NULL AS en_cuadratura"
            " FROM recibos_google" + where +
            " ORDER BY fecha_pago DESC, id ASC"), params)
        filas = [dict(f) for f in r.mappings().all()]
    for f in filas:
        f["fecha_pago"] = f["fecha_pago"].isoformat()
        f["en_cuadratura"] = bool(f["en_cuadratura"])
        f["cuenta_nombre"] = _NOMBRE_CUENTA.get(f["cuenta"], f["cuenta"])
    # Dentro de cada fecha, en el orden de las cuentas de facturación.
    filas.sort(key=lambda f: (f["fecha_pago"], -_ORDEN_CUENTA.get(f["cuenta"], 99), -f["id"]),
               reverse=True)
    return filas


# ── API ──────────────────────────────────────────────────────────
@router.get("/cuentas")
async def cuentas(_: dict = Depends(solo_admin)):
    return {"success": True, "cuentas": [
        {"clave": c, "nombre": n, "campo": campo, "clase": clase} for c, n, campo, clase in CUENTAS]}


@router.get("/resumen")
async def resumen(_: dict = Depends(solo_admin)):
    mes = ahora_sv().strftime("%Y-%m")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT COALESCE(SUM(CASE WHEN DATE_FORMAT(fecha_pago, '%Y-%m') = :mes
                                     THEN monto_centavos END), 0) AS total_mes,
                   COUNT(*) AS recibos, MAX(fecha_pago) AS ultimo
            FROM recibos_google
        """), {"mes": mes})
        f = r.mappings().first()
    return {"success": True, "mes": mes, "total_mes_centavos": int(f["total_mes"] or 0),
            "recibos": int(f["recibos"] or 0),
            "ultimo_pago": f["ultimo"].isoformat() if f["ultimo"] else None}


@router.get("")
@router.get("/")
async def listar(desde: Optional[str] = None, hasta: Optional[str] = None,
                 cuenta: Optional[str] = None, q: Optional[str] = Query(None, max_length=40),
                 _: dict = Depends(solo_admin)):
    return {"success": True, "recibos": await _recibos(desde, hasta, cuenta, q)}


@router.post("/escanear")
async def escanear_pdf(archivo: UploadFile = File(...), _: dict = Depends(solo_admin)):
    """Lee el PDF y devuelve los datos del pago. No guarda nada."""
    nombre, contenido = await _leer_pdf(archivo)
    try:
        datos = await asyncio.wait_for(asyncio.to_thread(escanear, contenido), timeout=TIMEOUT_ESCANEO)
    except asyncio.TimeoutError:
        raise HTTPException(422, f"{nombre}: el PDF tardó demasiado en leerse")
    except Exception:
        raise HTTPException(422, f"{nombre}: el PDF está dañado o protegido con contraseña")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT 1 FROM recibos_google WHERE sha256 = :h LIMIT 1"),
                            {"h": hashlib.sha256(contenido).hexdigest()})
        datos["duplicado"] = r.first() is not None
        # Cuenta sugerida: la que se usó la última vez con ese mismo Billing ID.
        datos["cuenta_sugerida"] = None
        if datos.get("billing_id"):
            r = await s.execute(text("SELECT cuenta FROM recibos_google WHERE billing_id = :b"
                                     " ORDER BY id DESC LIMIT 1"), {"b": datos["billing_id"]})
            f = r.first()
            datos["cuenta_sugerida"] = f[0] if f and f[0] in _NOMBRE_CUENTA else None
    return {"success": True, **datos}


@router.post("", status_code=201)
@router.post("/", status_code=201)
async def subir(
    detalles: str = Form(..., max_length=20000),
    archivos: List[UploadFile] = File(...),
    usuario: dict = Depends(solo_admin),
):
    """Guarda uno o varios recibos ya revisados. Se guardan todos o ninguno.

    `detalles`: JSON con un objeto por archivo, en el mismo orden:
    {cuenta, fecha_pago, monto, billing_id, metodo_pago}."""
    try:
        items = json.loads(detalles)
    except ValueError:
        raise HTTPException(422, "Los datos de los recibos no son válidos")
    if not 1 <= len(archivos) <= MAX_ARCHIVOS:
        raise HTTPException(422, f"Sube entre 1 y {MAX_ARCHIVOS} PDF a la vez")
    if not isinstance(items, list) or len(items) != len(archivos):
        raise HTTPException(422, "Cada PDF necesita sus datos")

    PDF_DIR.mkdir(parents=True, exist_ok=True)
    filas, escritos, hashes = [], [], set()
    try:
        for archivo, item in zip(archivos, items):
            nombre, contenido = await _leer_pdf(archivo)
            if not isinstance(item, dict):
                raise HTTPException(422, f"{nombre}: datos inválidos")
            cuenta = str(item.get("cuenta") or "")
            if cuenta not in _NOMBRE_CUENTA:
                raise HTTPException(422, f"{nombre}: elige a qué cuenta pertenece")
            fecha = _fecha(item.get("fecha_pago"), f"{nombre}: fecha de pago")
            if not fecha:
                raise HTTPException(422, f"{nombre}: falta la fecha de pago")
            billing_id = _texto_corto(item.get("billing_id"), 14)
            if billing_id and not _BILLING.fullmatch(billing_id):
                raise HTTPException(422, f"{nombre}: el Billing ID debe tener el formato 0000-0000-0000")
            sha = hashlib.sha256(contenido).hexdigest()
            if sha in hashes:
                raise HTTPException(409, f"{nombre}: ese PDF está dos veces en la subida")
            hashes.add(sha)

            ruta = f"{uuid.uuid4().hex}.pdf"
            (PDF_DIR / ruta).write_bytes(contenido)
            escritos.append(PDF_DIR / ruta)
            filas.append({
                "fecha": fecha, "cuenta": cuenta, "monto": _centavos(item.get("monto"), nombre),
                "billing": billing_id, "metodo": _texto_corto(item.get("metodo_pago"), 40),
                "nombre": nombre, "ruta": ruta, "sha": sha,
                "por": usuario.get("username") or "", "creado": _utcnow(),
            })

        async with AsyncSessionLocal() as s:
            try:
                for f in filas:
                    await s.execute(text("""
                        INSERT INTO recibos_google (fecha_pago, cuenta, monto_centavos, billing_id,
                            metodo_pago, archivo_nombre, archivo_ruta, sha256, subido_por, creado)
                        VALUES (:fecha, :cuenta, :monto, :billing, :metodo, :nombre, :ruta,
                                :sha, :por, :creado)
                    """), f)
                await s.commit()
            except IntegrityError:
                await s.rollback()
                raise HTTPException(409, "Uno de esos PDF ya está registrado")
    except BaseException:
        for p in escritos:
            p.unlink(missing_ok=True)
        raise
    # Copia de solo lectura en Cuadratura, sin hacer esperar al usuario.
    from recibos_cuadratura import enviar_en_segundo_plano
    enviar_en_segundo_plano()
    return {"success": True, "registrados": len(filas)}


@router.get("/exportar")
async def exportar(desde: Optional[str] = None, hasta: Optional[str] = None,
                   cuenta: Optional[str] = None, q: Optional[str] = Query(None, max_length=40),
                   _: dict = Depends(solo_admin)):
    buf = io.StringIO()
    buf.write("﻿")  # BOM: Excel abre bien los acentos
    w = csv.writer(buf)
    w.writerow(["Fecha", "Cuenta", "Billing ID", "Monto", "Método", "Archivo", "Subido por"])
    for r in await _recibos(desde, hasta, cuenta, q):
        # Un valor que empiece por = + - @ lo ejecutaría Excel como fórmula.
        seguro = lambda v: ("'" + v) if v and v[0] in "=+-@" else v  # noqa: E731
        w.writerow([r["fecha_pago"], r["cuenta_nombre"], r["billing_id"] or "",
                    f'{r["monto_centavos"] / 100:.2f}', seguro(r["metodo_pago"] or ""),
                    seguro(r["archivo_nombre"]), seguro(r["subido_por"])])
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="recibos-google-ads-{ahora_sv().date()}.csv"',
                 "Cache-Control": "private, no-store"})


@router.get("/{recibo_id}/pdf")
async def ver_pdf(recibo_id: int, descargar: bool = False, _: dict = Depends(solo_admin)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT archivo_nombre, archivo_ruta FROM recibos_google WHERE id = :id"),
                            {"id": recibo_id})
        f = r.mappings().first()
    if not f:
        raise HTTPException(404, "Recibo no encontrado")
    ruta = PDF_DIR / Path(f["archivo_ruta"]).name
    if not ruta.is_file():
        raise HTTPException(404, "El PDF de este recibo no está en el servidor")
    resp = FileResponse(ruta, media_type="application/pdf", filename=f["archivo_nombre"],
                        content_disposition_type="attachment" if descargar else "inline")
    resp.headers["Cache-Control"] = "private, no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp
