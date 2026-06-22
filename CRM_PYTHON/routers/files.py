from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from pathlib import Path
from typing import Optional
import datetime as _dt
import traceback
import io
import re


def _utcnow() -> _dt.datetime:
    """UTC naive (reemplazo de datetime.utcnow() deprecado en Python 3.12+)."""
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)
router = APIRouter(tags=["Files"])

_ADMIN_ROLES = {"admin", "administrador", "administrator", "backoffice", "bo"}


def _is_admin(user: dict) -> bool:
    return any(r in str(user.get("role", "")).lower() for r in _ADMIN_ROLES)

_FILES_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "files"
_FILES_DIR.mkdir(parents=True, exist_ok=True)

_MAX_IMAGE_BYTES   = 10 * 1024 * 1024   # 10 MB para imágenes en BD
_MAX_UPLOAD_BYTES  = 50 * 1024 * 1024   # 50 MB para archivos generales

# Extensiones permitidas para archivos guardados en disco (servidos desde /uploads).
# Sin html/svg/js/xml: servidos desde el mismo origen permitirían XSS almacenado.
ALLOWED_DISK_EXTENSIONS = {
    ".pdf", ".txt", ".csv",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus",
    ".mp4", ".webm", ".mov", ".avi", ".mkv", ".3gp",
    ".zip", ".rar", ".7z",
}


def safe_filename(name: str) -> str:
    """Neutraliza path traversal y caracteres peligrosos en nombres de archivo."""
    name = Path(str(name or "").replace("\\", "/")).name
    name = re.sub(r"[^A-Za-z0-9._\- ]", "_", name).strip(". ")
    return name[:200] or "file"


def _classify(mimetype: str) -> str:
    if mimetype.startswith("image/"):  return "image"
    if mimetype.startswith("audio/"):  return "audio"
    if mimetype.startswith("video/"):  return "video"
    if mimetype == "application/pdf":  return "pdf"
    return "document"


def _to_webp(data: bytes, mimetype: str) -> tuple[bytes, str, bool]:
    """Convierte una imagen a WebP (ahorra ~60-80% vs PNG).
    Devuelve (data, mimetype, converted). Si falla o no reduce, deja la original."""
    if mimetype == "image/webp":
        return data, mimetype, False
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        out = io.BytesIO()
        if getattr(img, "is_animated", False):
            img.save(out, format="WEBP", save_all=True, quality=80, method=4)
        else:
            if img.mode in ("P", "LA"):
                img = img.convert("RGBA")
            elif img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
            img.save(out, format="WEBP", quality=82, method=4)
        webp = out.getvalue()
        if webp and len(webp) < len(data):
            return webp, "image/webp", True
        return data, mimetype, False
    except Exception:
        return data, mimetype, False


# ── POST /api/files/upload ────────────────────────────────────
@router.post("/api/files/upload")
async def upload_file(
    file:   UploadFile = File(...),
    leadId: Optional[str] = Form(None),
    user:   dict = Depends(current_user),
):
    try:
        data = await file.read()
        if len(data) > _MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Archivo demasiado grande (max 50 MB)")

        mimetype  = file.content_type or "application/octet-stream"
        file_type = _classify(mimetype)
        ts        = int(_utcnow().timestamp() * 1000)
        orig      = safe_filename(file.filename or "file")
        upby      = user.get("username") or "unknown"
        now       = _utcnow()

        if file_type == "image":
            # Convertir a WebP antes de guardar (reduce tamaño en BD)
            data, mimetype, _converted = _to_webp(data, mimetype)
            if _converted:
                orig = (orig.rsplit(".", 1)[0] if "." in orig else orig) + ".webp"
            if len(data) > _MAX_IMAGE_BYTES:
                raise HTTPException(413, "Imagen demasiado grande (max 10 MB)")

            # Guardar binario en la BD — permanente, sobrevive deploys
            async with AsyncSessionLocal() as s:
                r = await s.execute(text("""
                    INSERT INTO note_files
                      (filename, original_name, content_type, file_type, file_size,
                       file_path, content, lead_id, uploaded_by, uploaded_at)
                    VALUES (:fn, :orig, :ct, :ft, :fs, :fp, :content, :lid, :by, :now)
                """), {
                    "fn":      orig,
                    "orig":    orig,
                    "ct":      mimetype,
                    "ft":      file_type,
                    "fs":      len(data),
                    "fp":      None,           # no hay path en disco
                    "content": data,
                    "lid":     leadId or None,
                    "by":      upby,
                    "now":     now,
                })
                new_id = r.lastrowid
                await s.commit()

            file_url = f"/api/files/{new_id}/image"

        else:
            # PDFs, audio, video → disco local
            ext = Path(orig).suffix.lower()
            if ext not in ALLOWED_DISK_EXTENSIONS:
                raise HTTPException(415, f"Tipo de archivo no permitido ({ext or 'sin extensión'})")
            filename = f"{ts}-{orig}"
            dest     = _FILES_DIR / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
            file_path = f"/uploads/files/{filename}"
            file_url  = file_path

            async with AsyncSessionLocal() as s:
                r = await s.execute(text("""
                    INSERT INTO note_files
                      (filename, original_name, content_type, file_type, file_size,
                       file_path, content, lead_id, uploaded_by, uploaded_at)
                    VALUES (:fn, :orig, :ct, :ft, :fs, :fp, NULL, :lid, :by, :now)
                """), {
                    "fn":   filename, "orig": orig,    "ct":  mimetype,
                    "ft":   file_type, "fs": len(data), "fp": file_path,
                    "lid":  leadId or None, "by": upby, "now": now,
                })
                new_id = r.lastrowid
                await s.commit()

        return {
            "success": True,
            "data": {
                "fileId":       str(new_id),
                "filename":     orig,
                "originalName": orig,
                "contentType":  mimetype,
                "fileType":     file_type,
                "size":         len(data),
                "url":          file_url,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[files/upload] ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error subiendo archivo: {str(e)}")


# ── GET /api/files/:id/image — sirve imagen desde BD ─────────
@router.get("/api/files/{file_id}/image")
async def serve_image(file_id: str):
    try:
        fid = int(file_id)
    except ValueError:
        raise HTTPException(400, "ID inválido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text("SELECT content, content_type, file_path FROM note_files WHERE id = :id"),
            {"id": fid}
        )
        row = r.mappings().first()

    if not row:
        raise HTTPException(404, "Imagen no encontrada")

    # Imagen guardada en BD (nuevo sistema)
    if row["content"]:
        content_type = row["content_type"] or "image/jpeg"
        data = bytes(row["content"])
        return Response(
            content=data,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Content-Length": str(len(data)),
            },
        )

    # Imagen antigua en Cloudinary o disco → redirigir
    file_path = row["file_path"] or ""
    if file_path.startswith("http://") or file_path.startswith("https://"):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=file_path)

    if file_path:
        disk_path = _FILES_DIR.parent.parent / file_path.lstrip("/")
        if disk_path.exists():
            data = disk_path.read_bytes()
            return Response(
                content=data,
                media_type=row["content_type"] or "image/jpeg",
                headers={"Cache-Control": "public, max-age=86400"},
            )

    raise HTTPException(404, "Imagen no disponible")


# ── GET /api/files/:id ────────────────────────────────────────
@router.get("/api/files/{file_id}")
async def serve_file(file_id: str, request: Request):
    try:
        fid = int(file_id)
    except ValueError:
        raise HTTPException(400, "ID invalido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text("SELECT * FROM note_files WHERE id = :id"), {"id": fid}
        )
        row = r.mappings().first()

    if not row:
        raise HTTPException(404, "Archivo no encontrado")

    # Si es imagen con content en BD → redirigir al endpoint correcto
    if row["content"] and (row["content_type"] or "").startswith("image/"):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"/api/files/{fid}/image")

    file_path    = row["file_path"] or ""
    content_type = row["content_type"] or "application/octet-stream"
    filename     = row["filename"] or ""
    file_size    = int(row["file_size"] or 0)

    if file_path.startswith("http://") or file_path.startswith("https://"):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=file_path)

    disk_path = _FILES_DIR.parent.parent / file_path.lstrip("/")
    if not disk_path.exists():
        raise HTTPException(404, "Archivo no encontrado en disco")

    range_header = request.headers.get("range")
    if range_header and (content_type.startswith("audio/") or content_type.startswith("video/")):
        raw   = range_header.replace("bytes=", "")
        parts = raw.split("-")
        start = int(parts[0])
        end   = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        end   = min(end, file_size - 1)
        chunk = end - start + 1
        with open(disk_path, "rb") as f:
            f.seek(start)
            data = f.read(chunk)
        return Response(
            content=data,
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range":  f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges":  "bytes",
                "Content-Length": str(chunk),
            },
        )

    def _stream():
        with open(disk_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers={
            "Content-Length":      str(file_size),
            "Accept-Ranges":       "bytes",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )


# ── GET /api/files/:id/download ───────────────────────────────
@router.get("/api/files/{file_id}/download")
async def download_file(file_id: str):
    try:
        fid = int(file_id)
    except ValueError:
        raise HTTPException(400, "ID invalido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text("SELECT * FROM note_files WHERE id = :id"), {"id": fid}
        )
        row = r.mappings().first()

    if not row:
        raise HTTPException(404, "Archivo no encontrado")

    content_type = row["content_type"] or "application/octet-stream"
    orig_name    = row["original_name"] or row["filename"] or "file"

    # Imagen en BD
    if row["content"]:
        data = bytes(row["content"])
        return Response(
            content=data,
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="{orig_name}"'},
        )

    file_path = row["file_path"] or ""
    file_size = int(row["file_size"] or 0)

    if file_path.startswith("http://") or file_path.startswith("https://"):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=file_path)

    disk_path = _FILES_DIR.parent.parent / file_path.lstrip("/")
    if not disk_path.exists():
        raise HTTPException(404, "Archivo no encontrado en disco")

    def _stream():
        with open(disk_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers={
            "Content-Length":      str(file_size),
            "Content-Disposition": f'attachment; filename="{orig_name}"',
        },
    )


# ── DELETE /api/files/:id — solo administradores ─────────────
@router.delete("/api/files/{file_id}")
async def delete_file(file_id: str, user: dict = Depends(current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Solo administradores pueden eliminar archivos")
    try:
        fid = int(file_id)
    except ValueError:
        raise HTTPException(400, "ID invalido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text("SELECT file_path FROM note_files WHERE id = :id"), {"id": fid}
        )
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Archivo no encontrado")

        file_path = row["file_path"] or ""

        # Si había archivo en disco, borrarlo
        if file_path and not file_path.startswith("http"):
            disk_path = _FILES_DIR.parent.parent / file_path.lstrip("/")
            if disk_path.exists():
                disk_path.unlink(missing_ok=True)

        await s.execute(text("DELETE FROM note_files WHERE id = :id"), {"id": fid})
        await s.commit()

    return {"success": True, "message": "Archivo eliminado"}
