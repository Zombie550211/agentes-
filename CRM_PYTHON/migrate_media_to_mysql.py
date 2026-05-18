"""
Migra media_files, noteFiles GridFS y userAvatars GridFS de MongoDB a MySQL/disco.
Ejecutar una sola vez: python migrate_media_to_mysql.py
"""
import asyncio, os, sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

import aiomysql
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
import io

MONGO_URI  = os.getenv("MONGO_DETAILS") or os.getenv("MONGODB_URI", "mongodb://localhost:27017/crm")
MYSQL_URL  = os.getenv("MYSQL_URL", "").replace("mysql+aiomysql://", "").replace("?charset=utf8mb4", "")

BASE_DIR   = Path(__file__).parent.parent
MEDIA_DIR  = BASE_DIR / "uploads" / "media"
FILES_DIR  = BASE_DIR / "uploads" / "files"
AVATAR_DIR = BASE_DIR / "uploads" / "avatars"
for d in (MEDIA_DIR, FILES_DIR, AVATAR_DIR):
    d.mkdir(parents=True, exist_ok=True)


def _parse_mysql(url: str):
    userpass, rest = url.split("@", 1)
    user, pw = (userpass.split(":", 1) + [""])[:2]
    hostport, dbname = rest.split("/", 1)
    host, port = (hostport.split(":") + ["3306"])[:2]
    return host, int(port), user, pw, dbname


async def get_conn():
    host, port, user, pw, db = _parse_mysql(MYSQL_URL)
    return await aiomysql.connect(
        host=host, port=port, user=user, password=pw,
        db=db, charset="utf8mb4", autocommit=True,
    )


async def migrate_media_files(mongo_db, mysql):
    """media_files collection → MySQL media_files tabla."""
    cur = await mysql.cursor()
    docs = await mongo_db["media_files"].find({}).to_list(None)
    ok = skip = err = 0
    for d in docs:
        mid = str(d["_id"])
        fname   = d.get("filename") or d.get("file_name") or ""
        ftype   = d.get("mimetype") or d.get("file_type") or ""
        fsize   = int(d.get("size") or d.get("file_size") or 0)
        fpath   = d.get("url") or d.get("file_path") or f"/uploads/media/{fname}"
        cat     = d.get("category") or ""
        upby    = d.get("uploadedBy") or d.get("uploaded_by") or ""
        update  = d.get("uploadDate") or d.get("createdAt") or d.get("upload_date")
        origname = d.get("originalName") or fname
        try:
            await cur.execute("""
                INSERT IGNORE INTO media_files
                  (mongo_id, file_name, file_type, file_size, file_path, category, uploaded_by, upload_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (mid, origname, ftype, fsize, fpath, cat, upby, update))
            ok += 1
        except Exception as e:
            print(f"  ERR media {mid}: {e}")
            err += 1
    print(f"  media_files: {ok} migrados, {skip} skip, {err} errores")


async def migrate_note_files(mongo_db, mysql):
    """noteFiles GridFS → disco (uploads/files/) + MySQL note_files."""
    cur = await mysql.cursor()
    bucket = AsyncIOMotorGridFSBucket(mongo_db, bucket_name="noteFiles")
    ok = err = 0
    async for file_doc in mongo_db["noteFiles.files"].find({}):
        mid = str(file_doc["_id"])
        fname  = file_doc.get("filename") or f"file_{mid}"
        fsize  = int(file_doc.get("length") or 0)
        ctype  = file_doc.get("contentType") or "application/octet-stream"
        meta   = file_doc.get("metadata") or {}
        orig   = meta.get("originalName") or fname
        ftype  = meta.get("fileType") or ""
        lead   = str(meta.get("leadId") or "")
        upby   = meta.get("uploadedBy") or ""
        upat   = meta.get("uploadedAt") or file_doc.get("uploadDate")

        dest = FILES_DIR / fname
        try:
            # Extraer binario de GridFS
            buf = io.BytesIO()
            grid_out = await bucket.open_download_stream(file_doc["_id"])
            async for chunk in grid_out:
                buf.write(chunk)
            dest.write_bytes(buf.getvalue())
        except Exception as e:
            print(f"  ERR descarga GridFS noteFile {mid}: {e}")
            err += 1
            continue

        fpath = f"/uploads/files/{fname}"
        try:
            await cur.execute("""
                INSERT IGNORE INTO note_files
                  (mongo_id, filename, original_name, content_type, file_type,
                   file_size, file_path, lead_id, uploaded_by, uploaded_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (mid, fname, orig, ctype, ftype, fsize, fpath, lead or None, upby, upat))
            ok += 1
        except Exception as e:
            print(f"  ERR insert note_file {mid}: {e}")
            err += 1
    print(f"  note_files: {ok} migrados, {err} errores")


async def migrate_avatars(mongo_db, mysql):
    """userAvatars GridFS → disco (uploads/avatars/) + users.avatar_url en MySQL."""
    cur = await mysql.cursor()
    bucket = AsyncIOMotorGridFSBucket(mongo_db, bucket_name="userAvatars")
    ok = err = 0
    async for file_doc in mongo_db["userAvatars.files"].find({}):
        mid    = str(file_doc["_id"])
        fname  = file_doc.get("filename") or f"avatar_{mid}.png"
        ctype  = file_doc.get("contentType") or "image/png"
        meta   = file_doc.get("metadata") or {}
        username = meta.get("username") or ""

        dest = AVATAR_DIR / fname
        try:
            buf = io.BytesIO()
            grid_out = await bucket.open_download_stream(file_doc["_id"])
            async for chunk in grid_out:
                buf.write(chunk)
            dest.write_bytes(buf.getvalue())
        except Exception as e:
            print(f"  ERR descarga avatar {mid}: {e}")
            err += 1
            continue

        new_url = f"/uploads/avatars/{fname}"
        if username:
            try:
                await cur.execute("""
                    UPDATE users SET avatar_url=%s WHERE username=%s AND (avatar_url IS NULL OR avatar_url LIKE '/api/user-avatars/%%')
                """, (new_url, username))
            except Exception as e:
                print(f"  ERR update user avatar {username}: {e}")
        ok += 1
    print(f"  avatars: {ok} migrados, {err} errores")


async def create_note_files_table(mysql):
    cur = await mysql.cursor()
    await cur.execute("""
        CREATE TABLE IF NOT EXISTS note_files (
            id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            mongo_id     VARCHAR(24),
            filename     VARCHAR(300) NOT NULL,
            original_name VARCHAR(300),
            content_type VARCHAR(150) DEFAULT 'application/octet-stream',
            file_type    VARCHAR(50),
            file_size    INT UNSIGNED DEFAULT 0,
            file_path    VARCHAR(500),
            lead_id      VARCHAR(100),
            uploaded_by  VARCHAR(150),
            uploaded_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_lead (lead_id),
            INDEX idx_uploader (uploaded_by)
        ) ENGINE=InnoDB
    """)


async def main():
    print("Conectando a MongoDB y MySQL...")
    mongo  = AsyncIOMotorClient(MONGO_URI)
    db_name = (MONGO_URI.rsplit("/", 1)[-1].split("?")[0]) or "crmagente"
    mongo_db = mongo[db_name]
    mysql  = await get_conn()

    print("Creando tabla note_files si no existe...")
    await create_note_files_table(mysql)

    print("\nMigrando media_files...")
    await migrate_media_files(mongo_db, mysql)

    print("\nMigrando noteFiles GridFS a disco + MySQL...")
    await migrate_note_files(mongo_db, mysql)

    print("\nMigrando userAvatars GridFS a disco + MySQL...")
    await migrate_avatars(mongo_db, mysql)

    mysql.close()
    mongo.close()
    print("\nListo.")


asyncio.run(main())
