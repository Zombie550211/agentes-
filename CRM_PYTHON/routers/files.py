from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from database import get_db
from deps import current_user
from bson import ObjectId
from typing import Optional
import datetime as _dt
import io

router = APIRouter(tags=["Files GridFS"])

_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


def _get_bucket(db) -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name="noteFiles")


def _to_oid(sid: str) -> ObjectId:
    try:
        return ObjectId(sid)
    except Exception:
        raise HTTPException(400, "ID inválido")


def _classify(mimetype: str) -> str:
    if mimetype.startswith("image/"):       return "image"
    if mimetype.startswith("audio/"):       return "audio"
    if mimetype.startswith("video/"):       return "video"
    if mimetype == "application/pdf":       return "pdf"
    return "document"


# ── POST /api/files/upload ────────────────────────────────────────
@router.post("/api/files/upload")
async def upload_file(
    file:   UploadFile = File(...),
    leadId: Optional[str] = Form(None),
    user:   dict = Depends(current_user),
):
    db = get_db()
    bucket = _get_bucket(db)

    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Archivo demasiado grande (máx 50 MB)")

    mimetype  = file.content_type or "application/octet-stream"
    file_type = _classify(mimetype)
    filename  = f"{int(_dt.datetime.utcnow().timestamp() * 1000)}-{file.filename}"

    metadata = {
        "leadId":       leadId or None,
        "uploadedBy":   user.get("username") or "unknown",
        "uploadedAt":   _dt.datetime.utcnow(),
        "originalName": file.filename,
        "fileType":     file_type,
    }

    grid_in = bucket.open_upload_stream(filename, metadata=metadata, chunk_size_bytes=255 * 1024)
    await grid_in.write(data)
    await grid_in.close()

    file_id = str(grid_in._id)
    return {
        "success": True,
        "data": {
            "fileId":       file_id,
            "filename":     filename,
            "originalName": file.filename,
            "contentType":  mimetype,
            "fileType":     file_type,
            "size":         len(data),
            "url":          f"/api/files/{file_id}",
        },
    }


# ── GET /api/files/:id ────────────────────────────────────────────
@router.get("/api/files/{file_id}")
async def serve_file(file_id: str, request: Request):
    db     = get_db()
    bucket = _get_bucket(db)
    oid    = _to_oid(file_id)

    file_doc = await db["noteFiles.files"].find_one({"_id": oid})
    if not file_doc:
        raise HTTPException(404, "Archivo no encontrado")

    file_size    = file_doc.get("length", 0)
    content_type = file_doc.get("contentType") or "application/octet-stream"
    range_header = request.headers.get("range")

    if range_header and (content_type.startswith("audio/") or content_type.startswith("video/")):
        raw = range_header.replace("bytes=", "")
        parts = raw.split("-")
        start = int(parts[0])
        end   = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        end   = min(end, file_size - 1)
        chunk_size = end - start + 1

        # Motor GridFS doesn't support range parameters; stream and slice
        buf = io.BytesIO()
        grid_out = await bucket.open_download_stream(oid)
        async for chunk in grid_out:
            buf.write(chunk)
        data = buf.getvalue()[start : end + 1]

        return Response(
            content=data,
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range":  f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges":  "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    grid_out = await bucket.open_download_stream(oid)

    async def _full():
        async for chunk in grid_out:
            yield chunk

    return StreamingResponse(
        _full(),
        media_type=content_type,
        headers={
            "Content-Length":      str(file_size),
            "Accept-Ranges":       "bytes",
            "Content-Disposition": f'inline; filename="{file_doc.get("filename","")}"',
        },
    )


# ── GET /api/files/:id/download ───────────────────────────────────
@router.get("/api/files/{file_id}/download")
async def download_file(file_id: str):
    db     = get_db()
    bucket = _get_bucket(db)
    oid    = _to_oid(file_id)

    file_doc = await db["noteFiles.files"].find_one({"_id": oid})
    if not file_doc:
        raise HTTPException(404, "Archivo no encontrado")

    content_type  = file_doc.get("contentType") or "application/octet-stream"
    original_name = (file_doc.get("metadata") or {}).get("originalName") or file_doc.get("filename") or "file"

    grid_out = await bucket.open_download_stream(oid)

    async def _stream():
        async for chunk in grid_out:
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers={
            "Content-Length":      str(file_doc.get("length", 0)),
            "Content-Disposition": f'attachment; filename="{original_name}"',
        },
    )


# ── DELETE /api/files/:id ─────────────────────────────────────────
@router.delete("/api/files/{file_id}")
async def delete_file(file_id: str, user: dict = Depends(current_user)):
    db     = get_db()
    bucket = _get_bucket(db)
    oid    = _to_oid(file_id)
    try:
        await bucket.delete(oid)
    except Exception as e:
        raise HTTPException(500, f"Error al eliminar: {e}")
    return {"success": True, "message": "Archivo eliminado"}
