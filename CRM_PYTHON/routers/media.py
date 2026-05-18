from fastapi import APIRouter, Depends, Request, Response, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from database import get_db
from deps import current_user
from bson import ObjectId
from pathlib import Path
from typing import Optional
import httpx, aiofiles, os, re, datetime as _dt

router = APIRouter(prefix="/api/media", tags=["Media"])

ALLOWED_HOSTS = ("res.cloudinary.com", ".cloudinary.com")

_UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads" / "media"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

_MAX_MB = 100
_MAX_BYTES = _MAX_MB * 1024 * 1024

_ADMIN_ROLES = {"admin", "administrador", "administrator", "backoffice", "bo"}


def _is_admin(user: dict) -> bool:
    return any(r in str(user.get("role", "")).lower() for r in _ADMIN_ROLES)


def _ext(filename: str) -> str:
    return Path(filename).suffix.lower() if filename else ""


# ── GET /api/media/proxy ──────────────────────────────────────
@router.api_route("/proxy", methods=["GET", "HEAD"])
async def media_proxy(request: Request, url: str = ""):
    if not url:
        return Response(content="Missing url param", status_code=400)
    try:
        if not any(h in url for h in ALLOWED_HOSTS):
            return Response(content="Forbidden", status_code=403)
        method = request.method.upper()
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            try:
                upstream = await client.request(method, url)
            except Exception:
                upstream = None
            if method == "HEAD" and (upstream is None or upstream.status_code >= 400):
                try:
                    upstream = await client.get(url)
                except Exception:
                    pass
            if upstream is None or upstream.status_code >= 400:
                return Response(content="", status_code=200, headers={"Content-Type": "image/png"})
            headers = {}
            for key in ("content-type", "cache-control", "content-length"):
                val = upstream.headers.get(key)
                if val:
                    headers[key] = val
            if method == "HEAD":
                return Response(status_code=200, headers=headers)
            return StreamingResponse(content=upstream.aiter_bytes(), status_code=200, headers=headers)
    except Exception as e:
        return Response(content=f"Proxy error: {e}", status_code=500)


# ── POST /api/upload  (también accesible como /api/media/upload) ─
@router.post("/upload")
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    category: Optional[str] = Form(None),
    user: dict = Depends(current_user),
):
    cat = category or request.headers.get("x-media-category", "general")

    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(413, f"Archivo demasiado grande (máx {_MAX_MB} MB)")

    ext      = _ext(file.filename or "")
    ts       = int(_dt.datetime.utcnow().timestamp() * 1000)
    safe_cat = re.sub(r"[^a-z0-9_-]", "_", cat.lower())
    filename = f"{safe_cat}_{ts}{ext}"
    dest     = _UPLOADS_DIR / filename

    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)

    url = f"/uploads/media/{filename}"

    db  = get_db()
    doc = {
        "filename":   filename,
        "originalName": file.filename or filename,
        "url":        url,
        "category":   cat,
        "mimetype":   file.content_type or "application/octet-stream",
        "size":       len(data),
        "uploadedBy": user.get("username", ""),
        "uploadDate": _dt.datetime.utcnow(),
        "createdAt":  _dt.datetime.utcnow(),
    }
    result = await db["media_files"].insert_one(doc)

    return {"success": True, "url": url, "id": str(result.inserted_id), "filename": filename, "category": cat}


# También exponer /api/upload directamente (sin prefix /api/media)
from fastapi import APIRouter as _AR
_upload_alias = _AR(tags=["Media"])


@_upload_alias.post("/api/upload")
async def upload_media_alias(
    request: Request,
    file: UploadFile = File(...),
    category: Optional[str] = Form(None),
    user: dict = Depends(current_user),
):
    return await upload_media(request=request, file=file, category=category, user=user)


# ── GET /api/media ────────────────────────────────────────────
@router.get("")
async def list_media(
    category: Optional[str] = None,
    limit:    int            = 100,
    sort:     Optional[str] = "desc",
    orderBy:  Optional[str] = "uploadDate",
    user: dict = Depends(current_user),
):
    db    = get_db()
    query = {}
    if category:
        query["category"] = category

    sort_field = orderBy if orderBy in {"uploadDate", "createdAt", "filename", "size"} else "uploadDate"
    sort_dir   = -1 if sort != "asc" else 1
    limit      = min(limit, 500)

    docs = await db["media_files"].find(query).sort(sort_field, sort_dir).limit(limit).to_list(None)
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs


# ── DELETE /api/media/{id} ────────────────────────────────────
@router.delete("/{file_id}")
async def delete_media(file_id: str, user: dict = Depends(current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "No autorizado")
    try:
        oid = ObjectId(file_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    db  = get_db()
    doc = await db["media_files"].find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Archivo no encontrado")

    # Eliminar archivo físico si existe
    filename = doc.get("filename", "")
    if filename:
        fpath = _UPLOADS_DIR / filename
        if fpath.exists():
            fpath.unlink(missing_ok=True)

    await db["media_files"].delete_one({"_id": oid})
    return {"success": True, "message": "Archivo eliminado"}


# ── POST /api/media/fix-dates ────────────────────────────────
@router.post("/fix-dates")
async def fix_dates(user: dict = Depends(current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "No autorizado")

    db    = get_db()
    fixed = 0
    async for doc in db["media_files"].find({"uploadDate": {"$exists": False}}):
        created = doc.get("createdAt") or _dt.datetime.utcnow()
        await db["media_files"].update_one(
            {"_id": doc["_id"]},
            {"$set": {"uploadDate": created}},
        )
        fixed += 1

    return {"success": True, "message": f"Fechas corregidas en {fixed} archivos", "fixed": fixed}
