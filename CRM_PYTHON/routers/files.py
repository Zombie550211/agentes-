from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from pathlib import Path
from typing import Optional
import datetime as _dt
import aiofiles, os

router = APIRouter(tags=["Files"])

_FILES_DIR = Path(__file__).parent.parent.parent / "uploads" / "files"
_FILES_DIR.mkdir(parents=True, exist_ok=True)

_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


def _classify(mimetype: str) -> str:
    if mimetype.startswith("image/"):    return "image"
    if mimetype.startswith("audio/"):    return "audio"
    if mimetype.startswith("video/"):    return "video"
    if mimetype == "application/pdf":    return "pdf"
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
    filename  = f"{ts}-{orig}"
    dest      = _FILES_DIR / filename

    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)

    file_path = f"/uploads/files/{filename}"
    upby      = user.get("username") or "unknown"
    now       = _dt.datetime.utcnow()

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO note_files
              (filename, original_name, content_type, file_type, file_size, file_path, lead_id, uploaded_by, uploaded_at)
            VALUES (:fn, :orig, :ct, :ft, :fs, :fp, :lid, :by, :now)
        """), {
            "fn":   filename, "orig": orig,    "ct":  mimetype,
            "ft":   file_type, "fs":  len(data), "fp": file_path,
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
            "url":          f"/api/files/{new_id}",
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

    # Resolves disk path from stored URL
    disk_path = Path(__file__).parent.parent.parent / file_path.lstrip("/")
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

        async with aiofiles.open(disk_path, "rb") as f:
            await f.seek(start)
            data = await f.read(chunk)

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

    async def _stream():
        async with aiofiles.open(disk_path, "rb") as f:
            while True:
                chunk = await f.read(65536)
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

    disk_path = Path(__file__).parent.parent.parent / file_path.lstrip("/")
    if not disk_path.exists():
        raise HTTPException(404, "Archivo no encontrado en disco")

    async def _stream():
        async with aiofiles.open(disk_path, "rb") as f:
            while True:
                chunk = await f.read(65536)
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
        disk_path = Path(__file__).parent.parent.parent / file_path.lstrip("/")
        if disk_path.exists():
            disk_path.unlink(missing_ok=True)

        await s.execute(text("DELETE FROM note_files WHERE id = :id"), {"id": fid})
        await s.commit()

    return {"success": True, "message": "Archivo eliminado"}
