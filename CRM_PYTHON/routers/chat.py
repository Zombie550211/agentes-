from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from datetime import datetime, timezone
from typing import List

def _utcnow() -> datetime:
    """UTC naive (reemplazo de _utcnow() deprecado en Python 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

router = APIRouter(prefix="/api/chat", tags=["Chat"])


def _fmt_msg(row) -> dict:
    r = dict(row)
    r["_id"] = str(r.get("id", ""))
    ts = r.get("timestamp")
    r["timestamp"] = ts.isoformat() if isinstance(ts, datetime) else str(ts or "")
    ra = r.get("read_at")
    r["readAt"] = ra.isoformat() if isinstance(ra, datetime) else None
    r["isRead"]     = bool(r.get("is_read"))
    r["isFollowup"] = bool(r.get("is_followup"))
    r["from"]       = r.pop("from_user", "")
    r["fromName"]   = r.pop("from_name", "")
    r["fromAvatar"] = r.pop("from_avatar", "")
    r["to"]         = r.pop("to_user", "")
    r["toName"]     = r.pop("to_name", "")
    return r


class SendMessage(BaseModel):
    to: str
    toName: str = ""
    body: str
    subject: str = ""
    type: str = "chat"


class _ReadAllBody(BaseModel):
    ids: List[str] = []


@router.get("/users")
async def chat_users(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, username, name, role, team, avatar_url FROM users
            WHERE username != :u ORDER BY name
        """), {"u": user["username"]})
        users = [
            {"_id": str(row["id"]), "username": row["username"], "name": row["name"],
             "role": row["role"], "team": row["team"], "avatarUrl": row["avatar_url"]}
            for row in r.mappings().all()
        ]
    return {"success": True, "users": users}


@router.get("/conversations")
async def conversations(user: dict = Depends(current_user)):
    uname = user["username"]
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT * FROM messages
            WHERE from_user = :u OR to_user = :u
            ORDER BY timestamp DESC
        """), {"u": uname})
        msgs = [_fmt_msg(row) for row in r.mappings().all()]

    seen = {}
    for m in msgs:
        peer       = m["to"]   if m["from"] == uname else m["from"]
        peer_name  = m["toName"]   if m["from"] == uname else m["fromName"]
        peer_avatar = "" if m["from"] == uname else m["fromAvatar"]
        if peer not in seen:
            seen[peer] = {
                "peer": peer, "peerName": peer_name, "peerAvatar": peer_avatar,
                "lastMessage": m.get("body", ""), "lastTime": m.get("timestamp"),
                "unread": 1 if (m.get("to") == uname and not m.get("isRead")) else 0,
            }
        elif m.get("to") == uname and not m.get("isRead"):
            seen[peer]["unread"] += 1

    return {"success": True, "conversations": list(seen.values())}


@router.get("/messages/{username}")
async def get_messages(username: str, user: dict = Depends(current_user)):
    uname = user["username"]
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT * FROM messages
            WHERE (from_user = :a AND to_user = :b) OR (from_user = :b AND to_user = :a)
            ORDER BY timestamp ASC LIMIT 100
        """), {"a": uname, "b": username})
        msgs = [_fmt_msg(row) for row in r.mappings().all()]

        unread_ids = [int(m["_id"]) for m in msgs if m.get("to") == uname and not m.get("isRead")]
        if unread_ids:
            await s.execute(text("""
                UPDATE messages SET is_read = TRUE, read_at = :now
                WHERE id IN :ids AND to_user = :u
            """), {"now": _utcnow(), "ids": tuple(unread_ids), "u": uname})
            await s.commit()

    return {"success": True, "messages": msgs}


@router.post("/messages")
async def send_message(body: SendMessage, user: dict = Depends(current_user)):
    if not body.to or not body.body:
        raise HTTPException(400, "Faltan campos")
    now = _utcnow()
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO messages (from_user, from_name, from_avatar, to_user, to_name,
                subject, body, type, is_read, is_followup, timestamp)
            VALUES (:from_user, :from_name, :from_avatar, :to_user, :to_name,
                :subject, :body, :type, FALSE, FALSE, :ts)
        """), {
            "from_user": user["username"],
            "from_name": user.get("name", user["username"]),
            "from_avatar": user.get("avatarUrl", ""),
            "to_user": body.to,
            "to_name": body.toName or body.to,
            "subject": body.subject, "body": body.body,
            "type": body.type, "ts": now,
        })
        await s.commit()
        r = await s.execute(text("SELECT * FROM messages WHERE id = LAST_INSERT_ID()"))
        msg = _fmt_msg(r.mappings().first())

    return {"success": True, "message": msg}


@router.get("/inbox")
async def inbox(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM messages WHERE to_user = :u ORDER BY timestamp DESC"), {"u": user["username"]})
        msgs = [_fmt_msg(row) for row in r.mappings().all()]
    return {"success": True, "messages": msgs}


@router.get("/sent")
async def sent(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM messages WHERE from_user = :u ORDER BY timestamp DESC"), {"u": user["username"]})
        msgs = [_fmt_msg(row) for row in r.mappings().all()]
    return {"success": True, "messages": msgs}


@router.get("/unread")
async def unread(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT * FROM messages WHERE to_user = :u AND is_read = FALSE ORDER BY timestamp DESC"), {"u": user["username"]})
        msgs = [_fmt_msg(row) for row in r.mappings().all()]
    return {"success": True, "messages": msgs}


@router.get("/followup")
async def followup(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT * FROM messages
            WHERE (from_user = :u OR to_user = :u) AND is_followup = TRUE
            ORDER BY timestamp DESC
        """), {"u": user["username"]})
        msgs = [_fmt_msg(row) for row in r.mappings().all()]
    return {"success": True, "messages": msgs}


@router.get("/unread-count")
async def unread_count(user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT COUNT(*) as cnt FROM messages WHERE to_user = :u AND is_read = FALSE"), {"u": user["username"]})
        count = r.scalar()
    return {"success": True, "count": count}


@router.patch("/messages/{msg_id}/read")
async def mark_read(msg_id: str, user: dict = Depends(current_user)):
    try:
        mid = int(msg_id)
    except ValueError:
        raise HTTPException(400, "ID inválido")
    async with AsyncSessionLocal() as s:
        await s.execute(text("UPDATE messages SET is_read = TRUE, read_at = :now WHERE id = :id AND to_user = :u"), {
            "now": _utcnow(), "id": mid, "u": user["username"],
        })
        await s.commit()
    return {"success": True}


@router.patch("/messages/{msg_id}/followup")
async def toggle_followup(msg_id: str, user: dict = Depends(current_user)):
    try:
        mid = int(msg_id)
    except ValueError:
        raise HTTPException(400, "ID inválido")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT is_followup FROM messages WHERE id = :id LIMIT 1"), {"id": mid})
        row = r.first()
        if not row:
            raise HTTPException(404, "Mensaje no encontrado")
        new_state = not bool(row[0])
        await s.execute(text("UPDATE messages SET is_followup = :v WHERE id = :id"), {"v": new_state, "id": mid})
        await s.commit()
    return {"success": True, "followup": new_state}


@router.patch("/messages/read-all")
async def mark_read_all(body: _ReadAllBody, user: dict = Depends(current_user)):
    if not body.ids:
        return {"success": True, "updated": 0}
    ids = []
    for i in body.ids:
        try:
            ids.append(int(i))
        except Exception:
            pass
    if not ids:
        return {"success": True, "updated": 0}
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE messages SET is_read = TRUE, read_at = :now
            WHERE id IN :ids AND to_user = :u
        """), {"now": _utcnow(), "ids": tuple(ids), "u": user["username"]})
        await s.commit()
    return {"success": True, "updated": r.rowcount}
