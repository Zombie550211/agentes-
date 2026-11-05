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

También se puede subir una imagen (JPG, PNG o WEBP) en lugar del video: ocupa el
mismo hueco (sustituye al video vigente y viceversa). Se reabre con Pillow, se gira
según su EXIF, se reduce a 1920 px como mucho y se guarda como WEBP sin metadatos.
Es rápido, así que se hace en la misma petición (responde 200, no 202).
"""
import asyncio
import logging
import shutil
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, ADMIN_ROLES, _normalize_role
import rbac

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

# Imágenes: extensión permitida y tope. Pillow abre lo que sea, pero sólo se aceptan
# estos formatos; MAX_IMAGE_PIXELS corta las «bombas de descompresión».
_IMAGENES = {".jpg", ".jpeg", ".png", ".webp"}
_FORMATOS_PIL = {"JPEG", "PNG", "WEBP"}
_MAX_MB_IMG = 20
_MAX_LADO_IMG = 1920
Image.MAX_IMAGE_PIXELS = 50_000_000

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


def _procesar_imagen(entrada: Path, salida: Path) -> None:
    with Image.open(entrada) as im:
        if im.format not in _FORMATOS_PIL:
            raise ValueError(f"formato {im.format}")
        im = ImageOps.exif_transpose(im)
        im.thumbnail((_MAX_LADO_IMG, _MAX_LADO_IMG))
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        im.save(salida, "WEBP", quality=85, method=4)


async def _a_disco(file: UploadFile, destino: Path, max_mb: int, que: str) -> int:
    # A disco por trozos: un video de cientos de MB no pasa entero por memoria.
    total = 0
    with open(destino, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > max_mb * 1024 * 1024:
                raise HTTPException(413, f"{que} pesa más de {max_mb} MB.")
            f.write(chunk)
    return total


async def _subir_imagen(file: UploadFile, ext: str, user: dict):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(415, "Sube una imagen (JPG, PNG o WEBP).")
    _DIR.mkdir(parents=True, exist_ok=True)
    marca = int(time.time() * 1000)
    entrada = _DIR / f"subida_{marca}{ext}"
    salida = _DIR / f"promo_{marca}.webp"
    try:
        total = await _a_disco(file, entrada, _MAX_MB_IMG, "La imagen")
        try:
            await asyncio.to_thread(_procesar_imagen, entrada, salida)
        except Exception as e:
            salida.unlink(missing_ok=True)
            log.warning("[promo-video] imagen no válida: %s", e)
            raise HTTPException(415, "No se pudo leer la imagen. Prueba con otro archivo (JPG, PNG o WEBP).")
    finally:
        entrada.unlink(missing_ok=True)
    anterior = await _leer_actual()
    await _guardar_actual(salida.name)
    _borrar(anterior)
    _estado["error"] = None
    log.info("[promo-video] %s subió una imagen: %.1f MB → %.2f MB", user.get("username", ""),
             total / 1e6, salida.stat().st_size / 1e6)
    return {"success": True, "procesando": False}


def _tipo(nombre: str | None) -> str | None:
    if not nombre:
        return None
    return "imagen" if Path(nombre).suffix.lower() == ".webp" else "video"


@router.get("")
async def ver(user: dict = Depends(current_user)):
    nombre = await _leer_actual()
    role_norm = _normalize_role(user.get("role"))
    allowed = {_normalize_role(r) for r in ADMIN_ROLES}
    return {
        "success": True,
        "url": f"/uploads/promo/{Path(nombre).name}" if nombre else None,
        "tipo": _tipo(nombre),
        "procesando": _estado["procesando"],
        "error": _estado["error"],
        # Sólo decide si la página enseña los botones; los endpoints lo vuelven a comprobar.
        "puede_editar": role_norm in allowed,
    }


@router.post("")
async def subir(file: UploadFile = File(...), user: dict = Depends(rbac.requiere("contenido.publicar"))):
    ext = Path(str(file.filename or "").replace("\\", "/")).suffix.lower()
    if ext in _IMAGENES:
        if _estado["procesando"]:
            raise HTTPException(409, "Se está procesando un video. Espera a que termine.")
        return await _subir_imagen(file, ext, user)
    formato = _FORMATOS.get(ext)
    if not formato or not (file.content_type or "").startswith("video/"):
        raise HTTPException(415, "Sube un video (MP4, MOV, WEBM, MKV o AVI) o una imagen (JPG, PNG o WEBP).")
    if _estado["procesando"]:
        raise HTTPException(409, "Ya se está procesando otro video. Espera a que termine.")
    exe = _ffmpeg()
    if not exe:
        raise HTTPException(503, "El servidor no tiene ffmpeg para comprimir el video.")

    _estado["procesando"], _estado["error"] = True, None
    _DIR.mkdir(parents=True, exist_ok=True)
    entrada = _DIR / f"subida_{int(time.time() * 1000)}{ext}"
    try:
        total = await _a_disco(file, entrada, _MAX_MB, "El video")
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
async def quitar(user: dict = Depends(rbac.requiere("contenido.publicar"))):
    if _estado["procesando"]:
        raise HTTPException(409, "Hay un video procesándose. Espera a que termine.")
    anterior = await _leer_actual()
    await _guardar_actual(None)
    _borrar(anterior)
    return {"success": True}
