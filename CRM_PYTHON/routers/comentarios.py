from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db
from deps import current_user
from bson import ObjectId
import datetime as _dt

router = APIRouter(tags=["Comentarios"])


def _to_oid(sid: str, label: str = "ID") -> ObjectId:
    try:
        return ObjectId(sid)
    except Exception:
        raise HTTPException(400, f"{label} inválido")


async def _log_activity(db, action: str, lead_id, client_name: str, username: str, role: str, detail: str, extra: dict = None):
    try:
        doc = {
            "action": action, "leadId": lead_id, "clientName": client_name,
            "username": username, "role": role, "detail": detail,
            "createdAt": _dt.datetime.utcnow(),
            **(extra or {}),
        }
        await db["activities"].insert_one(doc)
    except Exception:
        pass


# ── GET /api/comments?leadId= ────────────────────────────────────
@router.get("/api/comments")
async def get_comments(leadId: str = Query(...)):
    db = get_db()
    lead_oid = _to_oid(leadId, "leadId")
    comments = await db["Vcomments"].find({"leadId": lead_oid}).sort("createdAt", 1).to_list(None)
    return {
        "success": True,
        "comments": [
            {
                "_id": str(c["_id"]),
                "autor": c.get("autor") or c.get("author") or "Desconocido",
                "texto": c.get("texto") or c.get("text") or "",
                "fecha": c["createdAt"].isoformat() if isinstance(c.get("createdAt"), _dt.datetime) else _dt.datetime.utcnow().isoformat(),
            }
            for c in comments
        ],
    }


# ── GET /api/leads/:id/comentarios ───────────────────────────────
@router.get("/api/leads/{lead_id}/comentarios")
async def list_comentarios(lead_id: str, user: dict = Depends(current_user)):
    db = get_db()
    lead_oid = _to_oid(lead_id)
    items = await db["Vcomments"].find({"leadId": lead_oid}).sort("createdAt", 1).to_list(None)
    return [
        {
            "_id": str(c["_id"]),
            "autor": c.get("autor") or c.get("author") or "Desconocido",
            "fecha": c["createdAt"].isoformat() if isinstance(c.get("createdAt"), _dt.datetime) else _dt.datetime.utcnow().isoformat(),
            "texto": c.get("texto") or c.get("text") or "",
        }
        for c in items
    ]


class ComentarioBody(BaseModel):
    texto:     Optional[str] = None
    comentario: Optional[str] = None
    autor:     Optional[str] = None


# ── POST /api/leads/:id/comentarios ──────────────────────────────
@router.post("/api/leads/{lead_id}/comentarios", status_code=201)
async def create_comentario(lead_id: str, body: ComentarioBody, user: dict = Depends(current_user)):
    db = get_db()
    lead_oid = _to_oid(lead_id)
    now = _dt.datetime.utcnow()
    texto = (body.texto or body.comentario or "")[:1000]
    autor = body.autor or user.get("username") or "Sistema"
    doc = {"leadId": lead_oid, "texto": texto, "autor": autor, "createdAt": now, "updatedAt": now}
    result = await db["Vcomments"].insert_one(doc)

    try:
        lead = await db["costumers_unified"].find_one({"_id": lead_oid})
        client_name = (lead or {}).get("nombre_cliente") or "Sin nombre"
        await _log_activity(
            db, "Nota agregada", lead_oid, client_name,
            user.get("username") or "Sistema", user.get("role") or "Usuario",
            f'Nota en {client_name}: "{texto[:50]}"',
            {"note_author": autor},
        )
    except Exception:
        pass

    return {"success": True, "message": "Comentario creado", "data": {"_id": str(result.inserted_id), **{k: v for k, v in doc.items() if k != "leadId"}}}


class ComentarioUpdateBody(BaseModel):
    texto: str = ""


# ── PUT /api/leads/:id/comentarios/:comentarioId ─────────────────
@router.put("/api/leads/{lead_id}/comentarios/{comentario_id}")
async def update_comentario(lead_id: str, comentario_id: str, body: ComentarioUpdateBody, user: dict = Depends(current_user)):
    db = get_db()
    lead_oid    = _to_oid(lead_id)
    comment_oid = _to_oid(comentario_id, "comentarioId")
    result = await db["Vcomments"].find_one_and_update(
        {"_id": comment_oid, "leadId": lead_oid},
        {"$set": {"texto": body.texto[:1000], "updatedAt": _dt.datetime.utcnow()}},
        return_document=True,
    )
    if not result:
        raise HTTPException(404, "Comentario no encontrado")
    return {
        "success": True,
        "data": {
            "_id": str(result["_id"]),
            "autor": result.get("autor") or "Desconocido",
            "texto": result.get("texto") or "",
            "fecha": result["createdAt"].isoformat() if isinstance(result.get("createdAt"), _dt.datetime) else "",
        },
    }


# ── DELETE /api/leads/:id/comentarios/:comentarioId ──────────────
@router.delete("/api/leads/{lead_id}/comentarios/{comentario_id}")
async def delete_comentario(lead_id: str, comentario_id: str, user: dict = Depends(current_user)):
    db = get_db()
    lead_oid    = _to_oid(lead_id)
    comment_oid = _to_oid(comentario_id, "comentarioId")
    result = await db["Vcomments"].delete_one({"_id": comment_oid, "leadId": lead_oid})
    if not result.deleted_count:
        raise HTTPException(404, "Comentario no encontrado")
    return {"success": True, "message": "Comentario eliminado"}
