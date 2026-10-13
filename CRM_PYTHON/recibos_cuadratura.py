"""Envío de los recibos de Google Ads al Sistema de Cuadratura (allí son solo lectura).

Cada recibo (tabla recibos_google, ver routers/recibos_google.py) viaja con su PDF a
POST {CUADRATURA_URL}/api/integrations/crm/google-ads-receipts con la clave X-API-Key
(la misma de los horarios, ver cuadratura_sync.py). Cuadratura es idempotente por
`crm_id`: reenviar un recibo que ya tiene no lo duplica.

Cuándo se envía:
- Al momento: después de guardar recibos en el CRM.
- Reintento (bucle_envio_recibos): cada 5 min se mandan los que siguen pendientes
  (cuadratura_enviado IS NULL). Así llegan también los que ya existían antes de esta
  integración y los que no pudieron enviarse porque Cuadratura no respondía.

Variables de entorno: CUADRATURA_URL y CUADRATURA_API_KEY (las de los horarios);
RECIBOS_CUADRATURA_SYNC=0 apaga el reintento automático (el de horarios es CUADRATURA_SYNC).
"""
import asyncio
import json
import os
from datetime import datetime, timezone

import httpx
from sqlalchemy import text

from cuadratura_sync import configurado
from database_mysql import AsyncSessionLocal

INTERVALO_SEG = 5 * 60
LOTE = 20  # recibos por pasada
_candado = asyncio.Lock()


def _ahora() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _marcar(rid: int, enviado: bool, error: str | None) -> None:
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            UPDATE recibos_google
               SET cuadratura_enviado = CASE WHEN :ok THEN :ahora ELSE cuadratura_enviado END,
                   cuadratura_error = :error
             WHERE id = :id
        """), {"ok": enviado, "ahora": _ahora(), "error": (error or None) and error[:255], "id": rid})
        await s.commit()


async def _enviar_uno(cli: httpx.AsyncClient, url: str, f: dict) -> tuple[bool, str | None]:
    from routers.recibos_google import PDF_DIR, _NOMBRE_CUENTA
    try:
        contenido = (PDF_DIR / os.path.basename(f["archivo_ruta"])).read_bytes()
    except OSError:
        return False, "El PDF no está en el servidor del CRM"
    datos = {
        "crm_id": f["id"],
        "fecha_pago": f["fecha_pago"].isoformat(),
        "cuenta": f["cuenta"],
        "cuenta_nombre": _NOMBRE_CUENTA.get(f["cuenta"], f["cuenta"]),
        "monto_centavos": int(f["monto_centavos"]),
        "billing_id": f["billing_id"],
        "metodo_pago": f["metodo_pago"],
        "archivo_nombre": f["archivo_nombre"],
        "sha256": f["sha256"],
        "subido_por": f["subido_por"],
        "creado": f["creado"].replace(tzinfo=timezone.utc).isoformat() if f["creado"] else None,
    }
    try:
        resp = await cli.post(
            url,
            headers={"X-API-Key": os.getenv("CUADRATURA_API_KEY", "")},
            data={"datos": json.dumps(datos, ensure_ascii=False)},
            files={"archivo": (f["archivo_nombre"], contenido, "application/pdf")},
        )
    except httpx.HTTPError as e:
        return False, f"No se pudo conectar con Cuadratura: {e}"
    if resp.status_code in (200, 201):
        return True, None
    try:
        detalle = resp.json().get("detail")
    except ValueError:
        detalle = None  # p. ej. la página de error del proxy cuando Cuadratura está caída
    return False, f"Cuadratura respondió {resp.status_code}" + (f": {detalle}" if detalle else "")


async def enviar_pendientes(limite: int = LOTE) -> dict:
    """Envía los recibos que aún no llegaron a Cuadratura (los más antiguos primero)."""
    if not configurado():
        return {"estado": "sin_configurar"}
    if _candado.locked():
        return {"estado": "en_curso"}  # otra pasada ya está enviando
    async with _candado:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT id, fecha_pago, cuenta, monto_centavos, billing_id, metodo_pago,
                       archivo_nombre, archivo_ruta, sha256, subido_por, creado
                FROM recibos_google WHERE cuadratura_enviado IS NULL
                ORDER BY id LIMIT :lim
            """), {"lim": limite})
            filas = [dict(f) for f in r.mappings().all()]
        if not filas:
            return {"estado": "sin_pendientes", "enviados": 0}
        url = os.getenv("CUADRATURA_URL", "").rstrip("/") + "/api/integrations/crm/google-ads-receipts"
        enviados, errores = 0, []
        async with httpx.AsyncClient(timeout=60) as cli:
            for f in filas:
                ok, error = await _enviar_uno(cli, url, f)
                await _marcar(f["id"], ok, error)
                if ok:
                    enviados += 1
                else:
                    errores.append(f"#{f['id']}: {error}")
        if errores:
            print(f"[recibos→cuadratura] {enviados} enviados, {len(errores)} con error: {errores[:3]}")
        return {"estado": "ok" if not errores else "parcial", "enviados": enviados, "errores": errores}


def enviar_en_segundo_plano() -> None:
    """Lanza un envío sin esperar el resultado (tras guardar recibos)."""
    async def _tarea():
        try:
            await enviar_pendientes()
        except Exception as e:  # nunca romper la petición que lo lanzó
            print(f"[recibos→cuadratura] error al enviar: {e}")
    asyncio.get_running_loop().create_task(_tarea())


async def bucle_envio_recibos():
    """Tarea de fondo (instancia dueña del esquema): reintenta los pendientes cada 5 min."""
    if os.getenv("RECIBOS_CUADRATURA_SYNC", "1").strip().lower() in ("0", "false", "no"):
        print("[recibos→cuadratura] reintento automático desactivado (RECIBOS_CUADRATURA_SYNC=0)")
        return
    await asyncio.sleep(90)  # dejar terminar el arranque
    while True:
        try:
            # Varias pasadas seguidas si hay muchos pendientes (p. ej. la primera vez).
            for _ in range(10):
                res = await enviar_pendientes()
                if res.get("estado") != "ok" or res.get("enviados", 0) < LOTE:
                    break
        except asyncio.CancelledError:
            raise
        except Exception as e:  # nunca tumbar la tarea
            print(f"[recibos→cuadratura] error en el bucle: {e}")
        await asyncio.sleep(INTERVALO_SEG)
