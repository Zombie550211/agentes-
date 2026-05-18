from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from typing import Optional
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
import datetime as _dt

router = APIRouter(tags=["Comentarios"])


def _fmt_comment(row) -> dict:
    r = dict(row)
    created = r.get("created_at")
    fecha = created.isoformat() if isinstance(created, _dt.datetime) else _dt.datetime.utcnow().isoformat()
    return {
        "_id":   str(r["id"]),
        "autor": r.get("autor") or "Desconocido",
        "texto": r.get("texto") or "",
        "fecha": fecha,
    }


async def _get_lead_id_for_mongo(mongo_id: str) -> int | None:
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT id FROM leads WHERE mongo_id = :m OR id = :n LIMIT 1"), {
            "m": mongo_id, "n": int(mongo_id) if mongo_id.isdigit() else -1
        })
        row = r.first()
        return row[0] if row else None


# ── GET /api/comments?leadId= ────────────────────────────────────
@router.get("/api/comments")
async def get_comments(leadId: str = Query(...)):
    lead_id = await _get_lead_id_for_mongo(leadId)
    if not lead_id:
        return {"success": True, "comments": []}
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, autor, texto, created_at FROM lead_comments
            WHERE lead_id = :lid ORDER BY created_at ASC
        """), {"lid": lead_id})
        rows = r.mappings().all()
    return {"success": True, "comments": [_fmt_comment(row) for row in rows]}


# ── GET /api/leads/:id/comentarios ───────────────────────────────
@router.get("/api/leads/{lead_id}/comentarios")
async def list_comentarios(lead_id: str, user: dict = Depends(current_user)):
    db_lead_id = await _get_lead_id_for_mongo(lead_id)
    if not db_lead_id:
        return []
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, autor, texto, created_at FROM lead_comments
            WHERE lead_id = :lid ORDER BY created_at ASC
        """), {"lid": db_lead_id})
        rows = r.mappings().all()
    return [_fmt_comment(row) for row in rows]


class ComentarioBody(BaseModel):
    texto:      Optional[str] = None
    comentario: Optional[str] = None
    autor:      Optional[str] = None


# ── POST /api/leads/:id/comentarios ──────────────────────────────
@router.post("/api/leads/{lead_id}/comentarios", status_code=201)
async def create_comentario(lead_id: str, body: ComentarioBody, user: dict = Depends(current_user)):
    db_lead_id = await _get_lead_id_for_mongo(lead_id)
    if not db_lead_id:
        raise HTTPException(404, "Lead no encontrado")

    texto = (body.texto or body.comentario or "")[:1000]
    autor = body.autor or user.get("username") or "Sistema"
    now = _dt.datetime.utcnow()

    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            INSERT INTO lead_comments (lead_id, texto, autor, created_at, updated_at)
            VALUES (:lid, :texto, :autor, :now, :now)
        """), {"lid": db_lead_id, "texto": texto, "autor": autor, "now": now})
        await s.commit()
        r = await s.execute(text("SELECT LAST_INSERT_ID() as lid"))
        new_id = r.scalar()

        # Log activity
        try:
            lead_r = await s.execute(text("SELECT nombre_cliente FROM leads WHERE id = :id LIMIT 1"), {"id": db_lead_id})
            lead_row = lead_r.first()
            client_name = lead_row[0] if lead_row else "Sin nombre"
            await s.execute(text("""
                INSERT INTO activities (activity_type, lead_client_name, description, actor_username, actor_role, timestamp)
                VALUES (:type, :client, :desc, :actor, :role, :ts)
            """), {
                "type": "Nota agregada", "client": client_name,
                "desc": f'Nota en {client_name}: "{texto[:50]}"',
                "actor": user.get("username") or "Sistema",
                "role": user.get("role") or "Usuario",
                "ts": now,
            })
            await s.commit()
        except Exception:
            pass

    return {
        "success": True, "message": "Comentario creado",
        "data": {"_id": str(new_id), "texto": texto, "autor": autor,
                 "fecha": now.isoformat()},
    }


class ComentarioUpdateBody(BaseModel):
    texto: str = ""


# ── PUT /api/leads/:id/comentarios/:comentarioId ─────────────────
@router.put("/api/leads/{lead_id}/comentarios/{comentario_id}")
async def update_comentario(lead_id: str, comentario_id: str, body: ComentarioUpdateBody, user: dict = Depends(current_user)):
    try:
        cid = int(comentario_id)
    except ValueError:
        raise HTTPException(400, "comentarioId inválido")

    db_lead_id = await _get_lead_id_for_mongo(lead_id)
    if not db_lead_id:
        raise HTTPException(404, "Lead no encontrado")

    now = _dt.datetime.utcnow()
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            UPDATE lead_comments SET texto = :texto, updated_at = :now
            WHERE id = :cid AND lead_id = :lid
        """), {"texto": body.texto[:1000], "now": now, "cid": cid, "lid": db_lead_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Comentario no encontrado")
        r2 = await s.execute(text("SELECT id, autor, texto, created_at FROM lead_comments WHERE id = :cid"), {"cid": cid})
        updated = r2.mappings().first()

    return {"success": True, "data": _fmt_comment(updated)}


# ── DELETE /api/leads/:id/comentarios/:comentarioId ──────────────
@router.delete("/api/leads/{lead_id}/comentarios/{comentario_id}")
async def delete_comentario(lead_id: str, comentario_id: str, user: dict = Depends(current_user)):
    try:
        cid = int(comentario_id)
    except ValueError:
        raise HTTPException(400, "comentarioId inválido")

    db_lead_id = await _get_lead_id_for_mongo(lead_id)
    if not db_lead_id:
        raise HTTPException(404, "Lead no encontrado")

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("DELETE FROM lead_comments WHERE id = :cid AND lead_id = :lid"), {"cid": cid, "lid": db_lead_id})
        await s.commit()
        if r.rowcount == 0:
            raise HTTPException(404, "Comentario no encontrado")

    return {"success": True, "message": "Comentario eliminado"}
