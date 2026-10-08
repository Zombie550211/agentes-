"""Video promocional de la página de inicio (tarjeta «promo» de inicio.html).
Se gestiona desde el cuadro grande de Promociones activas (residencial/promociones-validas.html).

Hay un solo video vigente. Todos los usuarios con sesión lo ven; sólo ADMIN_ROLES
lo cambian o lo quitan. Al subirlo se recomprime con ffmpeg (H.264, como mucho
1280 px y 30 fps, sin audio ni metadatos, «faststart») para que pese una fracción
del original y empiece a reproducirse sin descargarlo entero. El audio se descarta:
la tarjeta nunca reproduce sonido.

La compresión tarda (de segundos a pocos minutos según el video), así que corre en
segundo plano: POST responde enseguida con 202 y la página consulta GET hasta que
`procesando` vuelve a false. El estado vive en memoria: el servicio corre con un
solo worker, y si se reinicia a medio comprimir basta con volver a subirlo.

El archivo final queda en uploads/promo/ (fuera de git, el despliegue no lo toca)
y su nombre en app_config.promo_video. /uploads ya exige sesión.
"""
import asyncio
import logging
import shutil
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, require_roles, ADMIN_ROLES, _normalize_role

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/promo-video", tags=["Promociones"])

_DIR = Path(__file__).parent.parent.parent / "uploads" / "promo"
_CLAVE = "promo_video"
_MAX_MB = 300
_TIMEOUT_S = 15 * 60

# Extensión → demuxer de ffmpeg. Se fuerza el formato de entrada (-f) en vez de
# dejar que ffmpeg lo adivine: un .mp4 que en realidad fuera una lista HLS o un
# «concat» le haría abrir otras rutas o URLs. Con -f mov/matroska/avi sólo lee
# ese contenedor, y -protocol_whitelist file le cierra la red.
_FORMATOS = {
    ".mp4": "mov", ".m4v": "mov", ".mov": "mov", ".3gp": "mov",
    ".webm": "matroska", ".mkv": "matroska",
    ".avi": "avi",
}

_estado = {"procesando": False, "error": None}
_tareas: set = set()   # referencia a la tarea en curso: asyncio sólo guarda una débil


def _ffmpeg() -> str | None:
    """ffmpeg del sistema si lo hay; si no, el binario que trae imageio-ffmpeg."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


async def _leer_actual() -> str | None:
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT valor FROM app_config WHERE clave = :k"), {"k": _CLAVE})
        row = r.first()
    return row[0] if row and row[0] else None


async def _guardar_actual(nombre: str | None) -> None:
    async with AsyncSessionLocal() as s:
        if nombre is None:
            await s.execute(text("DELETE FROM app_config WHERE clave = :k"), {"k": _CLAVE})
        else:
            await s.execute(text("""
                INSERT INTO app_config (clave, valor) VALUES (:k, :v)
                ON DUPLICATE KEY UPDATE valor = VALUES(valor)
            """), {"k": _CLAVE, "v": nombre})
        await s.commit()


def _borrar(nombre: str | None) -> None:
    # El nombre sale de app_config, pero se reduce a su basename por si acaso.
    if nombre:
        (_DIR / Path(nombre).name).unlink(missing_ok=True)


def _comprimir(exe: str, entrada: Path, formato: str, salida: Path) -> None:
    # Escala: el lado mayor a 1280 px como mucho, sin agrandar; -2 deja el otro lado par.
    escala = ("scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))'")
    cmd = [
        exe, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-protocol_whitelist", "file", "-f", formato, "-i", str(entrada),
        "-map", "0:v:0", "-an", "-map_metadata", "-1", "-sn", "-dn",
        "-vf", escala, "-fpsmax", "30",
        "-c:v", "libx264", "-preset", "medium", "-crf", "28",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(salida),
    ]
    r = subprocess.run(cmd, capture_output=True, timeout=_TIMEOUT_S)
    if r.returncode != 0 or not salida.exists() or salida.stat().st_size == 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[-500:] or "ffmpeg falló")


async def _procesar(exe: str, entrada: Path, formato: str) -> None:
    salida = _DIR / f"promo_{int(time.time() * 1000)}.mp4"
    try:
        # El servidor usa SelectorEventLoop en Windows (sin subprocesos asyncio):
        # ffmpeg corre en un hilo para no bloquear el bucle.
        await asyncio.to_thread(_comprimir, exe, entrada, formato, salida)
        anterior = await _leer_actual()
        await _guardar_actual(salida.name)
        _borrar(anterior)
        log.info("[promo-video] %s: %.1f MB → %.1f MB", salida.name,
                 entrada.stat().st_size / 1e6, salida.stat().st_size / 1e6)
        _estado["error"] = None
    except Exception as e:
        log.error("[promo-video] no se pudo comprimir: %s", e)
        salida.unlink(missing_ok=True)
        _estado["error"] = "No se pudo procesar el video. Prueba con otro archivo (MP4, MOV, WEBM…)."
    finally:
        entrada.unlink(missing_ok=True)
        _estado["procesando"] = False


@router.get("")
async def ver(user: dict = Depends(current_user)):
    nombre = await _leer_actual()
    role_norm = _normalize_role(user.get("role"))
    allowed = {_normalize_role(r) for r in ADMIN_ROLES}
    return {
        "success": True,
        "url": f"/uploads/promo/{Path(nombre).name}" if nombre else None,
        "procesando": _estado["procesando"],
        "error": _estado["error"],
        # Sólo decide si la página enseña los botones; los endpoints lo vuelven a comprobar.
        "puede_editar": role_norm in allowed,
    }


@router.post("")
async def subir(file: UploadFile = File(...), user: dict = Depends(require_roles(*ADMIN_ROLES))):
    ext = Path(str(file.filename or "").replace("\\", "/")).suffix.lower()
    formato = _FORMATOS.get(ext)
    if not formato or not (file.content_type or "").startswith("video/"):
        raise HTTPException(415, "Sube un video (MP4, MOV, WEBM, MKV o AVI).")
    if _estado["procesando"]:
        raise HTTPException(409, "Ya se está procesando otro video. Espera a que termine.")
    exe = _ffmpeg()
    if not exe:
        raise HTTPException(503, "El servidor no tiene ffmpeg para comprimir el video.")

    _estado["procesando"], _estado["error"] = True, None
    _DIR.mkdir(parents=True, exist_ok=True)
    entrada = _DIR / f"subida_{int(time.time() * 1000)}{ext}"
    try:
        # A disco por trozos: un video de cientos de MB no pasa entero por memoria.
        total = 0
        with open(entrada, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > _MAX_MB * 1024 * 1024:
                    raise HTTPException(413, f"El video pesa más de {_MAX_MB} MB.")
                f.write(chunk)
    except BaseException:
        entrada.unlink(missing_ok=True)
        _estado["procesando"] = False
        raise

    tarea = asyncio.create_task(_procesar(exe, entrada, formato))
    _tareas.add(tarea)
    tarea.add_done_callback(_tareas.discard)
    log.info("[promo-video] %s subió %.1f MB", user.get("username", ""), total / 1e6)
    return JSONResponse({"success": True, "procesando": True}, status_code=202)


@router.delete("")
async def quitar(user: dict = Depends(require_roles(*ADMIN_ROLES))):
    if _estado["procesando"]:
        raise HTTPException(409, "Hay un video procesándose. Espera a que termine.")
    anterior = await _leer_actual()
    await _guardar_actual(None)
    _borrar(anterior)
    return {"success": True}
