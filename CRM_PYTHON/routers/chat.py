from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from bson import ObjectId
from database import get_db
from deps import current_user
from datetime import datetime

router = APIRouter(prefix="/api/chat", tags=["Chat"])

COL = "chat_messages"

def _id(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    return doc

# ── Message helpers (ported from Node Message model) ─────────────
async def _send(db, from_, from_name, from_avatar, to, to_name, body, subject="", type_="chat"):
    doc = {
        "from": from_, "fromName": from_name, "fromAvatar": from_avatar or "",
        "to": to, "toName": to_name,
        "subject": subject, "body": body, "type": type_,
        "isRead": False, "isFollowup": False, "readAt": None,
        "timestamp": datetime.utcnow()
    }
    result = await db[COL].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    return doc

async def _get_conversation(db, user_a, user_b, limit=100):
    cursor = db[COL].find({
        "$or": [{"from": user_a, "to": user_b}, {"from": user_b, "to": user_a}]
    }).sort("timestamp", 1).limit(limit)
    return await cursor.to_list(None)

async def _conversation_list(db, username):
    msgs = await db[COL].find({
        "$or": [{"from": username}, {"to": username}]
    }).sort("timestamp", -1).to_list(None)
    seen = {}
    for m in msgs:
        peer = m["to"] if m["from"] == username else m["from"]
        peer_name   = m["toName"]   if m["from"] == username else m["fromName"]
        peer_avatar = ""            if m["from"] == username else m.get("fromAvatar", "")
        if peer not in seen:
            seen[peer] = {
                "peer": peer, "peerName": peer_name, "peerAvatar": peer_avatar,
                "lastMessage": m.get("body", ""), "lastTime": m.get("timestamp"),
                "unread": 1 if (m.get("to") == username and not m.get("isRead")) else 0
            }
        elif m.get("to") == username and not m.get("isRead"):
            seen[peer]["unread"] += 1
    return list(seen.values())

# ── Modelos ──────────────────────────────────────────────────────
class SendMessage(BaseModel):
    to: str
    toName: str = ""
    body: str
    subject: str = ""
    type: str = "chat"

# ── Rutas ────────────────────────────────────────────────────────
@router.get("/users")
async def chat_users(user: dict = Depends(current_user)):
    db = get_db()
    cursor = db["users"].find(
        {"username": {"$ne": user["username"]}},
        {"username": 1, "name": 1, "role": 1, "team": 1, "avatarUrl": 1}
    )
    users = await cursor.to_list(None)
    return {"success": True, "users": [_id(u) for u in users]}

@router.get("/conversations")
async def conversations(user: dict = Depends(current_user)):
    db = get_db()
    lst = await _conversation_list(db, user["username"])
    return {"success": True, "conversations": lst}

@router.get("/messages/{username}")
async def get_messages(username: str, user: dict = Depends(current_user)):
    db = get_db()
    msgs = await _get_conversation(db, user["username"], username)
    unread_ids = [str(m["_id"]) for m in msgs if m.get("to") == user["username"] and not m.get("isRead")]
    if unread_ids:
        oids = [ObjectId(i) for i in unread_ids]
        await db[COL].update_many({"_id": {"$in": oids}, "to": user["username"]},
                                   {"$set": {"isRead": True, "readAt": datetime.utcnow()}})
    return {"success": True, "messages": [_id(m) for m in msgs]}

@router.post("/messages")
async def send_message(body: SendMessage, user: dict = Depends(current_user)):
    if not body.to or not body.body:
        raise HTTPException(400, "Faltan campos")
    db = get_db()
    msg = await _send(db, user["username"], user.get("name", user["username"]),
                      user.get("avatarUrl", ""), body.to, body.toName or body.to,
                      body.body, body.subject, body.type)
    return {"success": True, "message": msg}

@router.get("/inbox")
async def inbox(user: dict = Depends(current_user)):
    db = get_db()
    msgs = await db[COL].find({"to": user["username"]}).sort("timestamp", -1).to_list(None)
    return {"success": True, "messages": [_id(m) for m in msgs]}

@router.get("/sent")
async def sent(user: dict = Depends(current_user)):
    db = get_db()
    msgs = await db[COL].find({"from": user["username"]}).sort("timestamp", -1).to_list(None)
    return {"success": True, "messages": [_id(m) for m in msgs]}

@router.get("/unread")
async def unread(user: dict = Depends(current_user)):
    db = get_db()
    msgs = await db[COL].find({"to": user["username"], "isRead": False}).sort("timestamp", -1).to_list(None)
    return {"success": True, "messages": [_id(m) for m in msgs]}

@router.get("/followup")
async def followup(user: dict = Depends(current_user)):
    db = get_db()
    msgs = await db[COL].find({
        "$or": [{"from": user["username"]}, {"to": user["username"]}],
        "isFollowup": True
    }).sort("timestamp", -1).to_list(None)
    return {"success": True, "messages": [_id(m) for m in msgs]}

@router.get("/unread-count")
async def unread_count(user: dict = Depends(current_user)):
    db = get_db()
    count = await db[COL].count_documents({"to": user["username"], "isRead": False})
    return {"success": True, "count": count}

@router.patch("/messages/{msg_id}/read")
async def mark_read(msg_id: str, user: dict = Depends(current_user)):
    db = get_db()
    await db[COL].update_many(
        {"_id": ObjectId(msg_id), "to": user["username"]},
        {"$set": {"isRead": True, "readAt": datetime.utcnow()}}
    )
    return {"success": True}

@router.patch("/messages/{msg_id}/followup")
async def toggle_followup(msg_id: str, user: dict = Depends(current_user)):
    db = get_db()
    msg = await db[COL].find_one({"_id": ObjectId(msg_id)})
    if not msg:
        raise HTTPException(404, "Mensaje no encontrado")
    new_state = not msg.get("isFollowup", False)
    await db[COL].update_one({"_id": ObjectId(msg_id)}, {"$set": {"isFollowup": new_state}})
    return {"success": True, "followup": new_state}


from pydantic import BaseModel as _BM
from typing import List as _List

class _ReadAllBody(_BM):
    ids: _List[str] = []

@router.patch("/messages/read-all")
async def mark_read_all(body: _ReadAllBody, user: dict = Depends(current_user)):
    if not body.ids:
        return {"success": True, "updated": 0}
    db = get_db()
    oids = []
    for i in body.ids:
        try:
            oids.append(ObjectId(i))
        except Exception:
            pass
    if not oids:
        return {"success": True, "updated": 0}
    result = await db[COL].update_many(
        {"_id": {"$in": oids}, "to": user["username"]},
        {"$set": {"isRead": True, "readAt": datetime.utcnow()}},
    )
    return {"success": True, "updated": result.modified_count}
