from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from pathlib import Path
from typing import Optional
import datetime as _dt
import cloudinary
import cloudinary.uploader
import os

router = APIRouter(tags=["Files"])

# Configurar Cloudinary desde variables de entorno
cloudinary.config(
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", ""),
    api_key    = os.getenv("CLOUDINARY_API_KEY", ""),
    api_secret = os.getenv("CLOUDINARY_API_SECRET", ""),
    secure     = True,
)

# Directorio local como fallback si Cloudinary no está configurado
_FILES_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "files"
_FILES_DIR.mkdir(parents=True, exist_ok=True)

_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

_USE_CLOUDINARY = bool(
    os.getenv("CLOUDINARY_CLOUD_NAME") and
    os.getenv("CLOUDINARY_API_KEY") and
    os.getenv("CLOUDINARY_API_SECRET")
)


def _classify(mimetype: str) -> str:
    if mimetype.startswith("image/"):  return "image"
    if mimetype.startswith("audio/"):  return "audio"
    if mimetype.startswith("video/"):  return "video"
    if mimetype == "application/pdf":  return "pdf"
    return "document"


# ── POST /api/files/upload ────────────────────────────────────
@router.post("/api/files/upload")
async def upload_file(
    file:   UploadFile = File(...),
    leadId: Optional[str] = Form(None),
    user:   dict = Depends(current_user),
):
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Archivo demasiado grande (max 50 MB)")

    mimetype  = file.content_type or "application/octet-stream"
    file_type = _classify(mimetype)
    ts        = int(_dt.datetime.utcnow().timestamp() * 1000)
    orig      = file.filename or "file"
    upby      = user.get("username") or "unknown"
    now       = _dt.datetime.utcnow()

    if _USE_CLOUDINARY and file_type == "image":
        # Subir a Cloudinary — URL pública permanente (run_in_executor para no bloquear el loop)
        import asyncio as _aio
        result = await _aio.get_event_loop().run_in_executor(
            None,
            lambda: cloudinary.uploader.upload(
                data,
                folder        = "crm_leads",
                public_id     = f"{ts}-{Path(orig).stem}",
                resource_type = "image",
                overwrite     = True,
            )
        )
        file_url  = result["secure_url"]
        filename  = result["public_id"]
        file_path = file_url  # guardamos la URL completa
    else:
        # Fallback: disco local
        filename  = f"{ts}-{orig}"
        dest      = _FILES_DIR / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        file_path = f"/uploads/files/{filename}"
        file_url  = file_path

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO note_files
              (filename, original_name, content_type, file_type, file_size, file_path, lead_id, uploaded_by, uploaded_at)
            VALUES (:fn, :orig, :ct, :ft, :fs, :fp, :lid, :by, :now)
        """), {
            "fn":   filename, "orig": orig,     "ct":  mimetype,
            "ft":   file_type, "fs": len(data), "fp":  file_path,
            "lid":  leadId or None, "by": upby, "now": now,
        })
        new_id = r.lastrowid
        await s.commit()

    return {
        "success": True,
        "data": {
            "fileId":       str(new_id),
            "filename":     filename,
            "originalName": orig,
            "contentType":  mimetype,
            "fileType":     file_type,
            "size":         len(data),
            "url":          file_url,
        },
    }


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

    file_path    = row["file_path"] or ""
    content_type = row["content_type"] or "application/octet-stream"
    filename     = row["filename"] or ""
    file_size    = int(row["file_size"] or 0)

    # Si es URL de Cloudinary redirigir directo
    if file_path.startswith("http://") or file_path.startswith("https://"):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=file_path)

    # Archivo local
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

    file_path    = row["file_path"] or ""
    content_type = row["content_type"] or "application/octet-stream"
    orig_name    = row["original_name"] or row["filename"] or "file"
    file_size    = int(row["file_size"] or 0)

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


# ── DELETE /api/files/:id ─────────────────────────────────────
@router.delete("/api/files/{file_id}")
async def delete_file(file_id: str, user: dict = Depends(current_user)):
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

        # Borrar de Cloudinary si aplica
        if _USE_CLOUDINARY and (file_path.startswith("http://") or file_path.startswith("https://")):
            try:
                pub_id = row["filename"] or ""
                if pub_id:
                    cloudinary.uploader.destroy(pub_id, resource_type="image")
            except Exception:
                pass
        else:
            disk_path = _FILES_DIR.parent.parent / file_path.lstrip("/")
            if disk_path.exists():
                disk_path.unlink(missing_ok=True)

        await s.execute(text("DELETE FROM note_files WHERE id = :id"), {"id": fid})
        await s.commit()

    return {"success": True, "message": "Archivo eliminado"}
