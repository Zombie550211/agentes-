from fastapi import APIRouter, Depends, Request, Response, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from pathlib import Path
from typing import Optional
import httpx, aiofiles, os, re, datetime as _dt

router = APIRouter(prefix="/api/media", tags=["Media"])

ALLOWED_HOSTS = ("res.cloudinary.com", ".cloudinary.com")

_UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads" / "media"
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

_MAX_MB    = 100
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


# ── POST /api/media/upload ────────────────────────────────────
@router.post("/upload")
async def upload_media(
    request:  Request,
    file:     UploadFile = File(...),
    category: Optional[str] = Form(None),
    user:     dict = Depends(current_user),
):
    cat  = category or request.headers.get("x-media-category", "general")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(413, f"Archivo demasiado grande (max {_MAX_MB} MB)")

    ext      = _ext(file.filename or "")
    ts       = int(_dt.datetime.utcnow().timestamp() * 1000)
    safe_cat = re.sub(r"[^a-z0-9_-]", "_", cat.lower())
    filename = f"{safe_cat}_{ts}{ext}"
    dest     = _UPLOADS_DIR / filename

    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)

    url      = f"/uploads/media/{filename}"
    now      = _dt.datetime.utcnow()
    upby     = user.get("username", "")
    origname = file.filename or filename
    mimetype = file.content_type or "application/octet-stream"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO media_files (file_name, file_type, file_size, file_path, category, uploaded_by, upload_date)
            VALUES (:fn, :ft, :fs, :fp, :cat, :by, :now)
        """), {"fn": origname, "ft": mimetype, "fs": len(data), "fp": url, "cat": cat, "by": upby, "now": now})
        new_id = r.lastrowid
        await s.commit()

    return {"success": True, "url": url, "id": str(new_id), "filename": filename, "category": cat}


# ── Alias /api/upload (sin prefix /api/media) ────────────────
from fastapi import APIRouter as _AR
_upload_alias = _AR(tags=["Media"])


@_upload_alias.post("/api/upload")
async def upload_media_alias(
    request:  Request,
    file:     UploadFile = File(...),
    category: Optional[str] = Form(None),
    user:     dict = Depends(current_user),
):
    return await upload_media(request=request, file=file, category=category, user=user)


# ── GET /api/media ────────────────────────────────────────────
@router.get("")
async def list_media(
    category: Optional[str] = None,
    limit:    int            = 100,
    sort:     Optional[str] = "desc",
    orderBy:  Optional[str] = "upload_date",
    user:     dict = Depends(current_user),
):
    limit = min(limit, 500)
    order = "DESC" if sort != "asc" else "ASC"
    safe_order = orderBy if orderBy in {"upload_date", "file_name", "file_size"} else "upload_date"

    where = "1=1"
    params: dict = {"lim": limit}
    if category:
        where += " AND category = :cat"
        params["cat"] = category

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, file_name, file_type, file_size, file_path, category, uploaded_by, upload_date
            FROM media_files WHERE {where}
            ORDER BY {safe_order} {order} LIMIT :lim
        """), params)
        rows = r.mappings().all()

    result = []
    for row in rows:
        result.append({
            "_id":         str(row["id"]),
            "filename":    row["file_name"],
            "originalName": row["file_name"],
            "url":         row["file_path"],
            "category":    row["category"] or "",
            "mimetype":    row["file_type"] or "",
            "size":        row["file_size"] or 0,
            "uploadedBy":  row["uploaded_by"] or "",
            "uploadDate":  row["upload_date"].isoformat() if row["upload_date"] else None,
        })
    return result


# ── DELETE /api/media/{id} ────────────────────────────────────
@router.delete("/{file_id}")
async def delete_media(file_id: str, user: dict = Depends(current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "No autorizado")

    try:
        fid = int(file_id)
    except ValueError:
        raise HTTPException(400, "ID invalido")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT file_path FROM media_files WHERE id = :id"), {"id": fid})
        row = r.mappings().first()
        if not row:
            raise HTTPException(404, "Archivo no encontrado")

        file_path = row["file_path"] or ""
        if file_path.startswith("/uploads/media/"):
            fname = file_path.split("/")[-1]
            fpath = _UPLOADS_DIR / fname
            if fpath.exists():
                fpath.unlink(missing_ok=True)

        await s.execute(text("DELETE FROM media_files WHERE id = :id"), {"id": fid})
        await s.commit()

    return {"success": True, "message": "Archivo eliminado"}


# ── POST /api/media/fix-dates (no-op, kept for compat) ───────
@router.post("/fix-dates")
async def fix_dates(user: dict = Depends(current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "No autorizado")
    return {"success": True, "message": "Fechas corregidas en 0 archivos", "fixed": 0}
