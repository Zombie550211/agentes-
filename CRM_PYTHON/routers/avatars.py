from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, Response
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from database import get_db
from deps import current_user
from bson import ObjectId
import datetime as _dt
import os, re

router = APIRouter(tags=["Avatars GridFS"])

# ── Optional Cloudinary ───────────────────────────────────────────
_CLD_CLOUD  = os.getenv("CLOUDINARY_CLOUD_NAME")
_CLD_KEY    = os.getenv("CLOUDINARY_API_KEY")
_CLD_SECRET = os.getenv("CLOUDINARY_API_SECRET")
_CLD_FOLDER = os.getenv("CLOUDINARY_AVATAR_FOLDER", "crm/avatars")
_CLD_BG_REMOVAL = os.getenv("CLOUDINARY_BG_REMOVAL_ENABLED", "false").lower() in ("1", "true", "yes")
_CLD_OK     = bool(_CLD_CLOUD and _CLD_KEY and _CLD_SECRET)

if _CLD_OK:
    try:
        import cloudinary
        import cloudinary.uploader
        cloudinary.config(cloud_name=_CLD_CLOUD, api_key=_CLD_KEY, api_secret=_CLD_SECRET, secure=True)
    except ImportError:
        _CLD_OK = False

_MIME_EXT = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}

_SVG_FALLBACK = (
    '<?xml version="1.0"?>'
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">'
    '<rect width="100%" height="100%" fill="#e2e8f0"/>'
    '<circle cx="60" cy="45" r="26" fill="#f8fafc"/>'
    '<rect x="15" y="80" width="90" height="22" rx="10" fill="#f8fafc"/>'
    "</svg>"
)


def _infer_ext(mime: str, fallback: str = "png") -> str:
    return _MIME_EXT.get((mime or "").lower(), fallback)


def _to_oid(sid: str) -> ObjectId:
    try:
        return ObjectId(sid)
    except Exception:
        raise HTTPException(400, "ID inválido")


def _get_bucket(db) -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name="userAvatars")


async def _process_avatar(data: bytes, mimetype: str) -> tuple[bytes, str, str, dict]:
    """Returns (buffer, content_type, extension, details)."""
    details: dict = {"backgroundRemoved": False, "processor": None, "bytesBefore": len(data)}

    if not (_CLD_OK and _CLD_BG_REMOVAL):
        details["bytesAfter"] = len(data)
        return data, mimetype or "image/png", _infer_ext(mimetype), details

    try:
        import cloudinary.uploader
        import httpx

        def _sync_upload():
            return cloudinary.uploader.upload(
                data,
                resource_type="image",
                folder=_CLD_FOLDER,
                background_removal="cloudinary_ai",
                overwrite=True,
                format="png",
                use_filename=False,
                unique_filename=True,
                transformation=[{"width": 800, "height": 800, "crop": "limit"}],
            )

        import asyncio
        result = await asyncio.get_event_loop().run_in_executor(None, _sync_upload)
        secure_url = result.get("secure_url") or ""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(secure_url, follow_redirects=True)
            resp.raise_for_status()
            processed = resp.content

        details.update({
            "backgroundRemoved": True,
            "processor": "cloudinary_ai",
            "bytesAfter": len(processed),
            "cloudinaryPublicId": result.get("public_id"),
            "cloudinaryAssetId": result.get("asset_id"),
            "cloudinaryVersion": result.get("version"),
            "secureUrl": secure_url,
        })
        return processed, "image/png", "png", details
    except Exception as e:
        details["processingError"] = str(e)
        details["bytesAfter"] = len(data)
        return data, mimetype or "image/png", _infer_ext(mimetype), details


# ── POST /api/users/me/avatar ─────────────────────────────────────
@router.post("/api/users/me/avatar")
async def upload_avatar(
    avatar: UploadFile = File(...),
    user:   dict = Depends(current_user),
):
    username = user.get("username")
    if not username:
        raise HTTPException(401, "No autenticado")

    db     = get_db()
    bucket = _get_bucket(db)

    data     = await avatar.read()
    mimetype = avatar.content_type or "image/png"

    sanitized = re.sub(r"[^a-zA-Z0-9_.\-]", "_", avatar.filename or "avatar.png") or "avatar.png"
    base_name = sanitized.rsplit(".", 1)[0] or "avatar"

    buf, content_type, ext, details = await _process_avatar(data, mimetype)
    final_file = f"{int(_dt.datetime.utcnow().timestamp() * 1000)}-{base_name}.{ext}"

    existing = await db["users"].find_one({"username": username}, {"avatarFileId": 1, "avatarCloudinaryPublicId": 1})

    metadata = {
        "userId":           str(user.get("_id") or ""),
        "username":         username,
        "uploadedAt":       _dt.datetime.utcnow(),
        "originalName":     avatar.filename,
        "originalMimeType": mimetype,
        "sanitizedFilename": sanitized,
        "backgroundRemoved": bool(details.get("backgroundRemoved")),
        "backgroundProcessor": details.get("processor"),
        "cloudinaryPublicId": details.get("cloudinaryPublicId"),
        "bytesOriginal":    details.get("bytesBefore"),
        "bytesProcessed":   details.get("bytesAfter"),
        "processingMs":     details.get("processingMs"),
        "processingError":  details.get("processingError"),
    }
    metadata = {k: v for k, v in metadata.items() if v is not None}

    grid_in = bucket.open_upload_stream(final_file, metadata=metadata, chunk_size_bytes=255 * 1024)
    await grid_in.write(buf)
    await grid_in.close()

    file_id    = str(grid_in._id)
    avatar_url = f"/api/user-avatars/{file_id}"

    set_doc: dict = {"avatarFileId": file_id, "avatarUrl": avatar_url, "avatarUpdatedAt": _dt.datetime.utcnow(), "avatarBackgroundRemoved": bool(details.get("backgroundRemoved"))}
    unset_doc: dict = {}
    if details.get("backgroundRemoved"):
        set_doc["avatarProcessor"] = details.get("processor")
    else:
        unset_doc["avatarProcessor"] = ""
    if details.get("cloudinaryPublicId"):
        set_doc["avatarCloudinaryPublicId"] = details["cloudinaryPublicId"]
        if details.get("cloudinaryVersion") is not None:
            set_doc["avatarCloudinaryVersion"] = details["cloudinaryVersion"]
        else:
            unset_doc["avatarCloudinaryVersion"] = ""
    else:
        unset_doc["avatarCloudinaryPublicId"] = ""
        unset_doc["avatarCloudinaryVersion"]  = ""

    update: dict = {"$set": set_doc}
    if unset_doc:
        update["$unset"] = unset_doc
    await db["users"].update_one({"username": username}, update)

    # Delete old file from GridFS
    old_fid = (existing or {}).get("avatarFileId")
    if old_fid and old_fid != file_id:
        try:
            await bucket.delete(ObjectId(old_fid))
        except Exception:
            pass

    # Delete old Cloudinary asset if replaced
    old_cld = (existing or {}).get("avatarCloudinaryPublicId")
    new_cld = details.get("cloudinaryPublicId")
    if old_cld and old_cld != new_cld and _CLD_OK:
        try:
            import cloudinary.uploader
            import asyncio
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: cloudinary.uploader.destroy(old_cld, invalidate=True)
            )
        except Exception:
            pass

    return {
        "success": True,
        "message": "Avatar actualizado",
        "data": {"url": avatar_url, "fileId": file_id, "backgroundRemoved": bool(details.get("backgroundRemoved"))},
    }


# ── GET /api/user-avatars/:id ─────────────────────────────────────
@router.get("/api/user-avatars/{file_id}")
async def serve_avatar(file_id: str):
    db     = get_db()
    bucket = _get_bucket(db)
    oid    = _to_oid(file_id)

    file_doc = await db["userAvatars.files"].find_one({"_id": oid})
    if not file_doc:
        return Response(
            content=_SVG_FALLBACK.encode(),
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    content_type = file_doc.get("contentType") or "image/png"
    grid_out     = await bucket.open_download_stream(oid)

    async def _stream():
        async for chunk in grid_out:
            yield chunk

    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "Accept-Ranges": "bytes",
        },
    )


# ── DELETE /api/users/me/avatar ───────────────────────────────────
@router.delete("/api/users/me/avatar")
async def delete_avatar(user: dict = Depends(current_user)):
    username = user.get("username")
    if not username:
        raise HTTPException(401, "No autenticado")

    db     = get_db()
    bucket = _get_bucket(db)

    existing = await db["users"].find_one({"username": username}, {"avatarFileId": 1})
    if not (existing or {}).get("avatarFileId"):
        return {"success": True, "message": "Sin avatar", "data": {"url": None}}

    try:
        await bucket.delete(ObjectId(existing["avatarFileId"]))
    except Exception:
        pass

    await db["users"].update_one(
        {"username": username},
        {"$unset": {"avatarFileId": "", "avatarUrl": "", "avatarUpdatedAt": ""}},
    )
    return {"success": True, "message": "Avatar eliminado", "data": {"url": None}}
