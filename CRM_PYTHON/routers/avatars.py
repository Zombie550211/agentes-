from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, Response
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from pathlib import Path
import datetime as _dt
import aiofiles, os, re

router = APIRouter(tags=["Avatars"])

_AVATAR_DIR = Path(__file__).parent.parent.parent / "uploads" / "avatars"
_AVATAR_DIR.mkdir(parents=True, exist_ok=True)

_CLD_CLOUD  = os.getenv("CLOUDINARY_CLOUD_NAME")
_CLD_KEY    = os.getenv("CLOUDINARY_API_KEY")
_CLD_SECRET = os.getenv("CLOUDINARY_API_SECRET")
_CLD_FOLDER = os.getenv("CLOUDINARY_AVATAR_FOLDER", "crm/avatars")
_CLD_BG     = os.getenv("CLOUDINARY_BG_REMOVAL_ENABLED", "false").lower() in ("1", "true", "yes")
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


async def _process_avatar(data: bytes, mimetype: str) -> tuple[bytes, str, str, dict]:
    details: dict = {"backgroundRemoved": False, "processor": None, "bytesBefore": len(data)}
    if not (_CLD_OK and _CLD_BG):
        details["bytesAfter"] = len(data)
        return data, mimetype or "image/png", _infer_ext(mimetype), details
    try:
        import cloudinary.uploader, httpx

        def _sync_upload():
            return cloudinary.uploader.upload(
                data, resource_type="image", folder=_CLD_FOLDER,
                background_removal="cloudinary_ai", overwrite=True, format="png",
                use_filename=False, unique_filename=True,
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
            "backgroundRemoved": True, "processor": "cloudinary_ai",
            "bytesAfter": len(processed),
            "cloudinaryPublicId": result.get("public_id"),
        })
        return processed, "image/png", "png", details
    except Exception as e:
        details["processingError"] = str(e)
        details["bytesAfter"] = len(data)
        return data, mimetype or "image/png", _infer_ext(mimetype), details


# ── POST /api/users/me/avatar ─────────────────────────────────
@router.post("/api/users/me/avatar")
async def upload_avatar(
    avatar: UploadFile = File(...),
    user:   dict = Depends(current_user),
):
    username = user.get("username")
    if not username:
        raise HTTPException(401, "No autenticado")

    data     = await avatar.read()
    mimetype = avatar.content_type or "image/png"
    sanitized = re.sub(r"[^a-zA-Z0-9_.\-]", "_", avatar.filename or "avatar.png") or "avatar.png"
    base_name = sanitized.rsplit(".", 1)[0] or "avatar"

    buf, content_type, ext, details = await _process_avatar(data, mimetype)
    ts         = int(_dt.datetime.utcnow().timestamp() * 1000)
    final_file = f"{ts}-{base_name}.{ext}"
    dest       = _AVATAR_DIR / final_file

    async with aiofiles.open(dest, "wb") as f:
        await f.write(buf)

    avatar_url = f"/uploads/avatars/{final_file}"

    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            UPDATE users SET avatar_url=:url, updated_at=:now WHERE username=:u
        """), {"url": avatar_url, "now": _dt.datetime.utcnow(), "u": username})
        await s.commit()

    return {
        "success": True,
        "message": "Avatar actualizado",
        "data": {
            "url": avatar_url,
            "fileId": final_file,
            "backgroundRemoved": bool(details.get("backgroundRemoved")),
        },
    }


# ── GET /api/user-avatars/:filename_or_id ─────────────────────
@router.get("/api/user-avatars/{file_ref}")
async def serve_avatar(file_ref: str):
    # Support old MongoDB ObjectId refs (24 hex chars) — return SVG fallback
    if re.match(r"^[0-9a-f]{24}$", file_ref):
        return Response(
            content=_SVG_FALLBACK.encode(),
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    # New refs are filenames stored in uploads/avatars/
    disk_path = _AVATAR_DIR / file_ref
    if not disk_path.exists():
        return Response(
            content=_SVG_FALLBACK.encode(),
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    ext  = disk_path.suffix.lower().lstrip(".")
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
            "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/png")

    async def _stream():
        async with aiofiles.open(disk_path, "rb") as f:
            while True:
                chunk = await f.read(65536)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        _stream(),
        media_type=mime,
        headers={"Cache-Control": "private, max-age=86400", "Accept-Ranges": "bytes"},
    )


# ── DELETE /api/users/me/avatar ───────────────────────────────
@router.delete("/api/users/me/avatar")
async def delete_avatar(user: dict = Depends(current_user)):
    username = user.get("username")
    if not username:
        raise HTTPException(401, "No autenticado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(
            text("SELECT avatar_url FROM users WHERE username=:u"), {"u": username}
        )
        row = r.mappings().first()
        old_url = (row or {}).get("avatar_url") or ""

        if old_url.startswith("/uploads/avatars/"):
            fname = old_url.split("/")[-1]
            fpath = _AVATAR_DIR / fname
            if fpath.exists():
                fpath.unlink(missing_ok=True)

        await s.execute(text("""
            UPDATE users SET avatar_url=NULL, updated_at=:now WHERE username=:u
        """), {"now": _dt.datetime.utcnow(), "u": username})
        await s.commit()

    return {"success": True, "message": "Avatar eliminado", "data": {"url": None}}
